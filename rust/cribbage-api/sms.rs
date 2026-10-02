//! Account-bound SMS sign-in. Phone enrollment is an explicit administrator action;
//! public requests can never select the destination or create an account.
use super::*;
use std::time::Duration;

const GENERIC_MESSAGE: &str = "If that account has an enrolled mobile number, a sign-in code is on its way. If no text arrives, use email sign-in.";

pub(super) fn initialize(connection: &rusqlite::Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS auth_phone_numbers (
           user_id INTEGER PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
           phone TEXT NOT NULL UNIQUE,
           enrolled_at INTEGER NOT NULL,
           verified_at INTEGER
         );
         CREATE TABLE IF NOT EXISTS auth_sms_challenges (
           token_hash TEXT PRIMARY KEY,
           user_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
           phone TEXT NOT NULL,
           verification_sid TEXT NOT NULL,
           expires_at INTEGER NOT NULL,
           attempts INTEGER NOT NULL DEFAULT 0,
           consumed_at INTEGER
         );",
        )
        .map_err(|error| format!("initialize SMS authentication: {error}"))
}

struct TwilioVerify {
    service: String,
    authorization: String,
}

trait VerifyProvider {
    fn send(&self, phone: &str) -> Result<String, String>;
    fn check(&self, sid: &str, code: &str) -> Result<bool, String>;
}

fn valid_sid(value: &str, prefix: &str) -> bool {
    value.len() == 34
        && value.starts_with(prefix)
        && value.as_bytes()[2..].iter().all(u8::is_ascii_hexdigit)
}

impl TwilioVerify {
    fn configured() -> Result<Option<Self>, String> {
        let names = [
            "TWILIO_VERIFY_SERVICE_SID",
            "TWILIO_API_KEY_SID",
            "TWILIO_API_KEY_SECRET",
        ];
        let values = names.map(|name| env::var(name).unwrap_or_default());
        if values.iter().all(|value| value.is_empty()) {
            return Ok(None);
        }
        if !valid_sid(&values[0], "VA") || !valid_sid(&values[1], "SK") || values[2].is_empty() {
            return Err("Configure TWILIO_VERIFY_SERVICE_SID, TWILIO_API_KEY_SID, and TWILIO_API_KEY_SECRET together".to_string());
        }
        Ok(Some(Self {
            service: values[0].clone(),
            authorization: format!(
                "Basic {}",
                base64::engine::general_purpose::STANDARD
                    .encode(format!("{}:{}", values[1], values[2]))
            ),
        }))
    }

    fn post(&self, resource: &str, form: &[(&str, &str)]) -> Result<Value, String> {
        let url = format!(
            "https://verify.twilio.com/v2/Services/{}/{}",
            self.service, resource
        );
        // No redirects: the credential must only be sent to this fixed HTTPS origin.
        let agent = ureq::AgentBuilder::new()
            .redirects(0)
            .timeout(Duration::from_secs(10))
            .build();
        match agent
            .post(&url)
            .set("Authorization", &self.authorization)
            .send_form(form)
        {
            Ok(response) => {
                let body = response
                    .into_string()
                    .map_err(|_| "Could not read Twilio Verify response".to_string())?;
                serde_json::from_str(&body)
                    .map_err(|_| "Invalid Twilio Verify response".to_string())
            }
            // Verify removes expired/consumed challenges and limits incorrect checks.
            Err(ureq::Error::Status(404 | 429, _)) if resource == "VerificationCheck" => {
                Ok(json!({"status": "invalid"}))
            }
            Err(ureq::Error::Status(status, _)) => {
                Err(format!("Twilio Verify returned HTTP {status}"))
            }
            Err(_) => Err("Twilio Verify transport failed".to_string()),
        }
    }
}

impl VerifyProvider for TwilioVerify {
    fn send(&self, phone: &str) -> Result<String, String> {
        let value = self.post("Verifications", &[("To", phone), ("Channel", "sms")])?;
        let sid = value["sid"].as_str().unwrap_or_default();
        if value["status"] != "pending" || !valid_sid(sid, "VE") {
            return Err("Twilio Verify did not create a pending verification".to_string());
        }
        Ok(sid.to_string())
    }

    fn check(&self, sid: &str, code: &str) -> Result<bool, String> {
        let value = self.post(
            "VerificationCheck",
            &[("VerificationSid", sid), ("Code", code)],
        )?;
        Ok(value["status"] == "approved" && value["sid"] == sid)
    }
}

pub(super) fn validate_configuration() -> Result<(), String> {
    TwilioVerify::configured().map(|_| ())
}

pub(super) fn enabled() -> bool {
    matches!(TwilioVerify::configured(), Ok(Some(_)))
}

fn unavailable() -> Response {
    Response::json(
        503,
        json!({"error": "Text sign-in is unavailable. Please use email or your password."})
            .to_string(),
    )
}

pub(super) fn request_code(server: &Server, request: &Request) -> Response {
    match TwilioVerify::configured() {
        Ok(Some(provider)) => request_with(server, request, &provider),
        _ => unavailable(),
    }
}

// Reserve all applicable limits in one transaction, before contacting Twilio.
fn reserve_send(
    connection: &mut rusqlite::Connection,
    user_id: i64,
    ip: &str,
) -> Result<bool, String> {
    let user = user_id.to_string();
    reserve_limits(
        connection,
        &[
            ("sms-send-user", user.as_str(), 30, 1),
            ("sms-send-user", user.as_str(), 3600, 6),
            ("sms-send-ip", ip, 3600, 15),
            ("sms-send-global", "all", 3600, 30),
        ],
    )
}

fn reserve_limits(
    connection: &mut rusqlite::Connection,
    limits: &[(&str, &str, i64, i64)],
) -> Result<bool, String> {
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let now = unix_seconds();
    for (kind, subject, window, maximum) in limits {
        let count: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM auth_rate_events WHERE kind=?1 AND subject=?2 AND occurred_at>?3",
            params![kind, subject, now - window], |row| row.get(0)).map_err(|error| error.to_string())?;
        if count >= *maximum {
            return Ok(false);
        }
    }
    transaction
        .execute(
            "DELETE FROM auth_rate_events WHERE occurred_at < ?1",
            [now - 86400],
        )
        .map_err(|error| error.to_string())?;
    let subjects = limits
        .iter()
        .map(|(kind, subject, _, _)| (*kind, *subject))
        .collect::<std::collections::BTreeSet<_>>();
    for (kind, subject) in subjects {
        transaction
            .execute(
                "INSERT INTO auth_rate_events(kind,subject,occurred_at) VALUES(?1,?2,?3)",
                params![kind, subject, now],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(true)
}

fn request_with(server: &Server, request: &Request, provider: &impl VerifyProvider) -> Response {
    let Ok(input) = parse::<EmailRequest>(request) else {
        return bad_request("Enter a valid email address.");
    };
    let token = random_token(32);
    let generic = || {
        Response::json(
            200,
            json!({"ok": true, "message": GENERIC_MESSAGE, "challenge": token}).to_string(),
        )
    };
    let result = (|| -> Result<bool, String> {
        let normalized = normalize_email(&input.email);
        let identity = digest(&normalized);
        let ip = request
            .headers
            .get("x-cribbage-client-ip")
            .map(String::as_str)
            .unwrap_or("unknown");
        let mut connection = open_game_database(&server.data_dir)?;
        // Apply request throttles to unknown and unenrolled accounts as well.
        if !reserve_limits(
            &mut connection,
            &[
                ("sms-request-email", &identity, 30, 1),
                ("sms-request-email", &identity, 3600, 6),
                ("sms-request-ip", ip, 3600, 15),
            ],
        )? {
            return Ok(false);
        }
        let Some(user) = find_user_by_email(&server.data_dir, &normalized)? else {
            return Ok(true);
        };
        let phone: Option<String> = connection
            .query_row(
                "SELECT phone FROM auth_phone_numbers WHERE user_id=?1",
                [user.id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let Some(phone) = phone else {
            return Ok(true);
        };
        if !reserve_send(&mut connection, user.id, ip)? {
            return Ok(false);
        }
        let sid = provider.send(&phone)?;
        let now = unix_seconds();
        connection
            .execute(
                "DELETE FROM auth_sms_challenges WHERE expires_at <= ?1",
                [now],
            )
            .map_err(|error| error.to_string())?;
        // Preserve the original expiry when a resend returns the same Verify SID.
        connection.execute(
            "INSERT INTO auth_sms_challenges(token_hash,user_id,phone,verification_sid,expires_at,attempts)
             VALUES(?1,?2,?3,?4,COALESCE((SELECT MIN(expires_at) FROM auth_sms_challenges WHERE verification_sid=?4),?5),
                    COALESCE((SELECT MAX(attempts) FROM auth_sms_challenges WHERE verification_sid=?4),0))",
            params![digest(&token), user.id, phone, sid, now + OTP_SECONDS]).map_err(|error| error.to_string())?;
        Ok(true)
    })();
    match result {
        Ok(true) => generic(),
        Ok(false) => too_many_requests(),
        Err(error) => {
            eprintln!("SMS sign-in request failed: {error}");
            unavailable()
        }
    }
}

#[derive(Deserialize)]
struct SmsCheck {
    challenge: String,
    code: String,
}

pub(super) fn verify_code(server: &Server, request: &Request) -> Response {
    match TwilioVerify::configured() {
        Ok(Some(provider)) => verify_with(server, request, &provider),
        _ => unavailable(),
    }
}

fn verify_with(server: &Server, request: &Request, provider: &impl VerifyProvider) -> Response {
    let Ok(input) = parse::<SmsCheck>(request) else {
        return invalid_code();
    };
    if input.challenge.len() != 43
        || input.code.len() != 6
        || !input.code.bytes().all(|b| b.is_ascii_digit())
    {
        return invalid_code();
    }
    let result = (|| -> Result<Option<AuthUser>, String> {
        let mut connection = open_game_database(&server.data_dir)?;
        let token_hash = digest(&input.challenge);
        let now = unix_seconds();
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let challenge: Option<(i64, String, String)> = transaction
            .query_row(
                "SELECT c.user_id,c.phone,c.verification_sid FROM auth_sms_challenges c
             JOIN auth_phone_numbers p ON p.user_id=c.user_id AND p.phone=c.phone
             WHERE c.token_hash=?1 AND c.expires_at>?2 AND c.consumed_at IS NULL AND c.attempts<5",
                params![token_hash, now],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let Some((user_id, phone, sid)) = challenge else {
            return Ok(None);
        };
        // All resend tokens share the provider's attempt budget.
        transaction
            .execute(
                "UPDATE auth_sms_challenges SET attempts=attempts+1 WHERE verification_sid=?1",
                [&sid],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        if !provider.check(&sid, &input.code)? {
            return Ok(None);
        }
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let consumed = transaction.execute(
            "UPDATE auth_sms_challenges SET consumed_at=?2 WHERE token_hash=?1 AND consumed_at IS NULL AND expires_at>?2
             AND EXISTS(SELECT 1 FROM auth_phone_numbers WHERE user_id=?3 AND phone=?4)",
            params![token_hash, unix_seconds(), user_id, phone]).map_err(|error| error.to_string())?;
        if consumed != 1 {
            return Ok(None);
        }
        transaction.execute("UPDATE auth_sms_challenges SET consumed_at=?2 WHERE user_id=?1 AND consumed_at IS NULL", params![user_id, unix_seconds()]).map_err(|error| error.to_string())?;
        transaction
            .execute(
                "UPDATE auth_phone_numbers SET verified_at=?2 WHERE user_id=?1",
                params![user_id, unix_seconds()],
            )
            .map_err(|error| error.to_string())?;
        let user = transaction
            .query_row(
                "SELECT id,username,display_name,email,password_hash FROM auth_users WHERE id=?1",
                [user_id],
                user_from_row,
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(Some(user))
    })();
    match result {
        Ok(Some(user)) => create_session_response(server, request, &user),
        Ok(None) => invalid_code(),
        Err(error) => {
            eprintln!("SMS verification failed: {error}");
            unavailable()
        }
    }
}

#[derive(Deserialize)]
struct Enrollment {
    email: String,
    phone: String,
}

pub(super) fn enroll(server: &Server, request: &Request) -> Response {
    if !admin_authorized(request) {
        return Response::json(
            403,
            "{\"error\":\"Administrator authorization required.\"}".to_string(),
        );
    }
    let Ok(input) = parse::<Enrollment>(request) else {
        return bad_request("Provide an account email and E.164 phone number.");
    };
    let phone = input.phone.trim();
    if !(9..=16).contains(&phone.len())
        || !phone.starts_with('+')
        || phone.as_bytes()[1] == b'0'
        || !phone.as_bytes()[1..].iter().all(u8::is_ascii_digit)
    {
        return bad_request("Use an E.164 phone number, including its + country code.");
    }
    let result = (|| -> Result<bool, String> {
        let Some(user) = find_user_by_email(&server.data_dir, &normalize_email(&input.email))?
        else {
            return Ok(false);
        };
        let mut connection = open_game_database(&server.data_dir)?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        transaction.execute(
            "INSERT INTO auth_phone_numbers(user_id,phone,enrolled_at) VALUES(?1,?2,?3)
             ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone,enrolled_at=excluded.enrolled_at,verified_at=NULL",
            params![user.id, phone, unix_seconds()]).map_err(|_| "Phone enrollment conflicts with another account".to_string())?;
        transaction
            .execute(
                "DELETE FROM auth_sms_challenges WHERE user_id=?1",
                [user.id],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(true)
    })();
    match result {
        Ok(true) => generic_email_response(
            "Phone enrolled. Ownership will be verified at the first successful text sign-in.",
        ),
        Ok(false) => bad_request("Account not found."),
        Err(error) => internal_error(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Barrier,
    };

    const PHONE: &str = "+12025550123";
    const SID: &str = "VEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    struct Provider {
        sends: AtomicUsize,
        checks: AtomicUsize,
        fail: bool,
        barrier: Option<Barrier>,
    }
    impl Default for Provider {
        fn default() -> Self {
            Self {
                sends: AtomicUsize::new(0),
                checks: AtomicUsize::new(0),
                fail: false,
                barrier: None,
            }
        }
    }
    impl VerifyProvider for Provider {
        fn send(&self, phone: &str) -> Result<String, String> {
            assert_eq!(phone, PHONE);
            self.sends.fetch_add(1, Ordering::SeqCst);
            if self.fail {
                Err("provider unavailable".to_string())
            } else {
                Ok(SID.to_string())
            }
        }
        fn check(&self, sid: &str, code: &str) -> Result<bool, String> {
            assert_eq!(sid, SID);
            self.checks.fetch_add(1, Ordering::SeqCst);
            if let Some(barrier) = &self.barrier {
                barrier.wait();
            }
            if self.fail {
                Err("provider unavailable".to_string())
            } else {
                Ok(code == "482193")
            }
        }
    }
    fn request(body: Value) -> Request {
        Request {
            method: "POST".to_string(),
            path: String::new(),
            headers: Default::default(),
            body: body.to_string(),
        }
    }
    fn setup(name: &str) -> Server {
        let server = super::super::tests::test_server(name);
        let connection = open_game_database(&server.data_dir).unwrap();
        connection
            .execute(
                "INSERT INTO auth_phone_numbers(user_id,phone,enrolled_at) VALUES(1,?1,?2)",
                params![PHONE, unix_seconds()],
            )
            .unwrap();
        server
    }
    fn send(server: &Server, provider: &Provider) -> String {
        let response = request_with(
            server,
            &request(json!({"email":"founder@evenvision.com", "phone":"+12025550999"})),
            provider,
        );
        assert_eq!(response.status, 200);
        let value: Value = serde_json::from_str(&response.body).unwrap();
        value["challenge"].as_str().unwrap().to_string()
    }
    fn check(server: &Server, provider: &Provider, token: &str, code: &str) -> Response {
        verify_with(
            server,
            &request(json!({"challenge":token,"code":code})),
            provider,
        )
    }

    #[test]
    fn approved_code_signs_in_enrolled_account_once_and_marks_phone_verified() {
        let server = setup("sms-approved");
        let provider = Provider::default();
        let token = send(&server, &provider);
        let response = check(&server, &provider, &token, "482193");
        assert_eq!(response.status, 200);
        let value: Value = serde_json::from_str(&response.body).unwrap();
        assert_eq!(value["user"]["id"], 1);
        assert!(response
            .headers
            .iter()
            .any(|(name, value)| name == "Set-Cookie" && value.contains("HttpOnly")));
        assert_eq!(check(&server, &provider, &token, "482193").status, 401);
        let connection = open_game_database(&server.data_dir).unwrap();
        let verified: bool = connection
            .query_row(
                "SELECT verified_at IS NOT NULL FROM auth_phone_numbers WHERE user_id=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(verified);
        assert_eq!(provider.checks.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn unknown_and_unenrolled_accounts_have_the_same_generic_response_and_never_send() {
        let server = setup("sms-unknown");
        let provider = Provider::default();
        for email in ["nobody@example.test", "hollywood2742@gmail.com"] {
            let response = request_with(&server, &request(json!({"email":email})), &provider);
            let value: Value = serde_json::from_str(&response.body).unwrap();
            assert_eq!(response.status, 200);
            assert_eq!(value["message"], GENERIC_MESSAGE);
            assert_eq!(
                request_with(&server, &request(json!({"email":email})), &provider).status,
                429
            );
            assert_eq!(
                check(
                    &server,
                    &provider,
                    value["challenge"].as_str().unwrap(),
                    "482193"
                )
                .status,
                401
            );
        }
        assert_eq!(provider.sends.load(Ordering::SeqCst), 0);
        assert_eq!(provider.checks.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn send_cooldown_prevents_repeat_sms_and_retains_the_first_challenge() {
        let server = setup("sms-cooldown");
        let provider = Provider::default();
        let first = send(&server, &provider);
        let throttled = request_with(
            &server,
            &request(json!({"email":"founder@evenvision.com"})),
            &provider,
        );
        assert_eq!(throttled.status, 429);
        assert!(!throttled.body.contains("challenge"));
        assert_eq!(provider.sends.load(Ordering::SeqCst), 1);
        assert_eq!(check(&server, &provider, &first, "482193").status, 200);
    }

    #[test]
    fn incorrect_codes_are_limited_across_resends() {
        let server = setup("sms-attempts");
        let provider = Provider::default();
        let first = send(&server, &provider);
        for _ in 0..4 {
            assert_eq!(check(&server, &provider, &first, "000000").status, 401);
        }
        let connection = open_game_database(&server.data_dir).unwrap();
        connection
            .execute("UPDATE auth_rate_events SET occurred_at=occurred_at-31", [])
            .unwrap();
        let second = send(&server, &provider);
        assert_eq!(check(&server, &provider, &second, "000000").status, 401);
        for token in [&first, &second] {
            assert_eq!(check(&server, &provider, token, "482193").status, 401);
        }
        assert_eq!(provider.checks.load(Ordering::SeqCst), 5);
    }

    #[test]
    fn expired_challenges_and_changed_phones_cannot_sign_in() {
        for mode in ["expired", "changed"] {
            let server = setup(&format!("sms-{mode}"));
            let provider = Provider::default();
            let token = send(&server, &provider);
            let connection = open_game_database(&server.data_dir).unwrap();
            if mode == "expired" {
                connection
                    .execute("UPDATE auth_sms_challenges SET expires_at=0", [])
                    .unwrap();
            } else {
                connection
                    .execute("UPDATE auth_phone_numbers SET phone='+12025550124'", [])
                    .unwrap();
            }
            assert_eq!(check(&server, &provider, &token, "482193").status, 401);
            assert_eq!(provider.checks.load(Ordering::SeqCst), 0);
        }
    }

    #[test]
    fn provider_failure_never_creates_a_session() {
        let server = setup("sms-provider-failure");
        let provider = Provider::default();
        let token = send(&server, &provider);
        let failed = Provider {
            fail: true,
            ..Default::default()
        };
        assert_eq!(check(&server, &failed, &token, "482193").status, 503);
        let unsent = request_with(
            &setup("sms-send-failure"),
            &request(json!({"email":"founder@evenvision.com"})),
            &failed,
        );
        assert_eq!(unsent.status, 503);
        let count: i64 = open_game_database(&server.data_dir)
            .unwrap()
            .query_row("SELECT COUNT(*) FROM auth_sessions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn concurrent_approved_checks_issue_only_one_session() {
        let server = setup("sms-concurrent-checks");
        let provider = Provider {
            barrier: Some(Barrier::new(2)),
            ..Default::default()
        };
        let token = send(&server, &provider);
        let mut statuses = std::thread::scope(|scope| {
            let first = scope.spawn(|| check(&server, &provider, &token, "482193").status);
            let second = scope.spawn(|| check(&server, &provider, &token, "482193").status);
            vec![first.join().unwrap(), second.join().unwrap()]
        });
        statuses.sort_unstable();
        assert_eq!(statuses, [200, 401]);
    }

    #[test]
    fn phone_enrollment_requires_administrator_authorization() {
        let server = setup("sms-enrollment");
        let response = enroll(
            &server,
            &request(json!({"email":"founder@evenvision.com","phone":"+12025550124"})),
        );
        assert_eq!(response.status, 403);
        let phone: String = open_game_database(&server.data_dir)
            .unwrap()
            .query_row(
                "SELECT phone FROM auth_phone_numbers WHERE user_id=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(phone, PHONE);
    }

    #[test]
    fn concurrent_send_reservations_enforce_the_cooldown_atomically() {
        let server = setup("sms-concurrent-send");
        let results = std::thread::scope(|scope| {
            let run = || {
                reserve_send(
                    &mut open_game_database(&server.data_dir).unwrap(),
                    1,
                    "127.0.0.1",
                )
                .unwrap()
            };
            let first = scope.spawn(run);
            let second = scope.spawn(run);
            vec![first.join().unwrap(), second.join().unwrap()]
        });
        assert_eq!(results.iter().filter(|allowed| **allowed).count(), 1);
    }

    #[test]
    fn hourly_user_ip_and_global_send_limits_are_enforced() {
        for (kind, subject, count) in [
            ("sms-send-user", "1", 6),
            ("sms-send-ip", "127.0.0.1", 15),
            ("sms-send-global", "all", 30),
        ] {
            let server = setup(kind);
            let provider = Provider::default();
            let token = send(&server, &provider);
            let connection = open_game_database(&server.data_dir).unwrap();
            connection
                .execute("UPDATE auth_rate_events SET occurred_at=occurred_at-60", [])
                .unwrap();
            for _ in 0..count {
                connection
                    .execute(
                        "INSERT INTO auth_rate_events(kind,subject,occurred_at) VALUES(?1,?2,?3)",
                        params![kind, subject, unix_seconds() - 60],
                    )
                    .unwrap();
            }
            let mut request = request(json!({"email":"founder@evenvision.com"}));
            request
                .headers
                .insert("x-cribbage-client-ip".into(), "127.0.0.1".into());
            let response = request_with(&server, &request, &provider);
            assert_eq!(response.status, 429);
            assert!(!response.body.contains("challenge"));
            assert_eq!(provider.sends.load(Ordering::SeqCst), 1);
            assert_eq!(check(&server, &provider, &token, "482193").status, 200);
        }
    }
}
