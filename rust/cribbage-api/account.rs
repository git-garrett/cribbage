//! Private account sign-in methods. Mutations require a recently authenticated
//! session; a phone replacement becomes active only after its own code succeeds.
use super::*;
use sms::VerifyProvider;

const RECENT_SECONDS: i64 = 10 * 60;

struct AccountSession {
    user: AuthUser,
    hash: String,
    created_at: i64,
}

fn database_error(error: impl std::fmt::Display) -> Response {
    internal_error(format!("account settings: {error}"))
}

fn sign_in_again() -> Response {
    Response::json(
        403,
        json!({
            "error": "Please sign in again before changing your sign-in methods.",
            "reauthenticate": true
        })
        .to_string(),
    )
}

fn session(
    connection: &rusqlite::Connection,
    request: &Request,
    recent: bool,
) -> Result<AccountSession, Response> {
    let token = cookie_value(request, SESSION_COOKIE).ok_or_else(sign_in_again)?;
    let hash = digest(&token);
    let found = connection
        .query_row(
            "SELECT u.id,u.username,u.display_name,u.email,u.password_hash,s.created_at
         FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id
         WHERE s.token_hash=?1 AND s.expires_at>?2",
            params![hash, unix_seconds()],
            |row| Ok((user_from_row(row)?, row.get::<_, i64>(5)?)),
        )
        .optional()
        .map_err(database_error)?;
    let (user, created_at) = found.ok_or_else(sign_in_again)?;
    if recent && created_at <= unix_seconds() - RECENT_SECONDS {
        return Err(sign_in_again());
    }
    Ok(AccountSession {
        user,
        hash,
        created_at,
    })
}

fn same_origin_json(request: &Request) -> bool {
    let json = request.headers.get("content-type").is_some_and(|value| {
        value
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .eq_ignore_ascii_case("application/json")
    });
    let origin_ok = request.headers.get("origin").is_none_or(|origin| {
        origin == &public_origin()
            || request.headers.get("host").is_some_and(|host| {
                (host.starts_with("127.0.0.1:") || host.starts_with("localhost:"))
                    && origin == &format!("http://{host}")
            })
    });
    json && origin_ok
}

pub(super) fn handle(server: &Server, request: &Request) -> Option<Response> {
    let path = request.path.strip_prefix("/api/auth/account")?;
    if !matches!(
        (request.method.as_str(), path),
        ("GET", "")
            | (
                "POST",
                "/phone/request" | "/phone/verify" | "/phone/remove" | "/password"
            )
    ) {
        return None;
    }
    let response = if request.method == "POST" && !same_origin_json(request) {
        Response::json(
            403,
            json!({"error":"Use the account page to change sign-in methods."}).to_string(),
        )
    } else {
        let result = match path {
            "" => status(server, request),
            "/password" => change_password(server, request),
            "/phone/remove" => remove_phone(server, request),
            _ => match sms::TwilioVerify::configured() {
                Ok(Some(provider)) if path == "/phone/request" => {
                    request_phone(server, request, &provider)
                }
                Ok(Some(provider)) => verify_phone(server, request, &provider),
                _ => Err(Response::json(
                    503,
                    json!({"error":"Text verification is temporarily unavailable."}).to_string(),
                )),
            },
        };
        result.unwrap_or_else(|response| response)
    };
    Some(response.with_header("Cache-Control", "no-store".to_string()))
}

fn status(server: &Server, request: &Request) -> Result<Response, Response> {
    let connection = open_game_database(&server.data_dir).map_err(database_error)?;
    let account = session(&connection, request, false)?;
    let phone = connection
        .query_row(
            "SELECT phone,verified_at IS NOT NULL FROM auth_phone_numbers WHERE user_id=?1",
            [account.user.id],
            |row| Ok(json!({"number":row.get::<_, String>(0)?,"verified":row.get::<_, bool>(1)?})),
        )
        .optional()
        .map_err(database_error)?;
    Ok(Response::json(
        200,
        json!({
            "smsEnabled":sms::enabled(), "phone":phone,
            "hasPassword":account.user.password_hash.is_some(),
            "recentSignIn":account.created_at > unix_seconds()-RECENT_SECONDS
        })
        .to_string(),
    ))
}

fn normalize_phone(input: &str) -> Option<String> {
    if input.len() > 40
        || input
            .chars()
            .any(|c| !c.is_ascii_digit() && !"+(). -".contains(c))
    {
        return None;
    }
    let compact: String = input
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '+')
        .collect();
    let phone = if compact.len() == 10 && !compact.contains('+') {
        format!("+1{compact}")
    } else if compact.len() == 11 && compact.starts_with('1') {
        format!("+{compact}")
    } else {
        compact
    };
    ((9..=16).contains(&phone.len())
        && phone.starts_with('+')
        && phone.as_bytes()[1] != b'0'
        && phone.as_bytes()[1..].iter().all(u8::is_ascii_digit))
    .then_some(phone)
}

#[derive(Deserialize)]
struct PhoneRequest {
    phone: String,
}

fn phone_available(
    connection: &rusqlite::Connection,
    phone: &str,
    user_id: i64,
) -> Result<(), Response> {
    let taken: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM auth_phone_numbers WHERE phone=?1 AND user_id<>?2)",
            params![phone, user_id],
            |row| row.get(0),
        )
        .map_err(database_error)?;
    if taken {
        return Err(Response::json(
            409,
            json!({"error":"That number cannot be added to this account."}).to_string(),
        ));
    }
    Ok(())
}

fn request_phone(
    server: &Server,
    request: &Request,
    provider: &impl VerifyProvider,
) -> Result<Response, Response> {
    let input =
        parse::<PhoneRequest>(request).map_err(|_| bad_request("Enter a mobile number."))?;
    let phone = normalize_phone(&input.phone).ok_or_else(|| {
        bad_request("Enter a US mobile number or include + and the country code.")
    })?;
    let mut connection = open_game_database(&server.data_dir).map_err(database_error)?;
    let account = session(&connection, request, true)?;
    phone_available(&connection, &phone, account.user.id)?;
    let ip = request
        .headers
        .get("x-cribbage-client-ip")
        .map(String::as_str)
        .unwrap_or("unknown");
    if !sms::reserve_send(&mut connection, account.user.id, ip).map_err(database_error)? {
        return Err(too_many_requests());
    }
    let sid = provider.send(&phone).map_err(|_| {
        Response::json(
            503,
            json!({"error":"The verification text could not be sent. Please try again later."})
                .to_string(),
        )
    })?;
    let token = random_token(32);
    let now = unix_seconds();
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(database_error)?;
    session(&transaction, request, true)?;
    phone_available(&transaction, &phone, account.user.id)?;
    transaction
        .execute(
            "DELETE FROM auth_sms_challenges WHERE expires_at<=?1",
            [now],
        )
        .map_err(database_error)?;
    // Keep old rows as the provider-SID attempt/expiry ledger, but only the
    // latest request from this account may change its phone number.
    transaction.execute("UPDATE auth_sms_challenges SET consumed_at=?2 WHERE user_id=?1 AND purpose='enroll' AND consumed_at IS NULL", params![account.user.id,now]).map_err(database_error)?;
    transaction.execute(
        "INSERT INTO auth_sms_challenges(token_hash,user_id,phone,verification_sid,expires_at,attempts,purpose,session_hash)
         VALUES(?1,?2,?3,?4,COALESCE((SELECT MIN(expires_at) FROM auth_sms_challenges WHERE verification_sid=?4),?5),
         COALESCE((SELECT MAX(attempts) FROM auth_sms_challenges WHERE verification_sid=?4),0),'enroll',?6)",
        params![digest(&token),account.user.id,phone,sid,now+OTP_SECONDS,account.hash],
    ).map_err(database_error)?;
    transaction.commit().map_err(database_error)?;
    Ok(Response::json(200, json!({"ok":true,"challenge":token,"phone":phone,"message":"Enter the six-digit text code to enable SMS sign-in."}).to_string()))
}

#[derive(Deserialize)]
struct PhoneCheck {
    challenge: String,
    code: String,
}

fn verify_phone(
    server: &Server,
    request: &Request,
    provider: &impl VerifyProvider,
) -> Result<Response, Response> {
    let input = parse::<PhoneCheck>(request).map_err(|_| invalid_code())?;
    if input.challenge.len() != 43
        || input.code.len() != 6
        || !input.code.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(invalid_code());
    }
    let mut connection = open_game_database(&server.data_dir).map_err(database_error)?;
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(database_error)?;
    let account = session(&transaction, request, true)?;
    let token_hash = digest(&input.challenge);
    let (phone, sid) = transaction.query_row(
        "SELECT phone,verification_sid FROM auth_sms_challenges WHERE token_hash=?1 AND user_id=?2 AND session_hash=?3
         AND purpose='enroll' AND consumed_at IS NULL AND expires_at>?4 AND attempts<5",
        params![token_hash,account.user.id,account.hash,unix_seconds()],
        |row| Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?)),
    ).optional().map_err(database_error)?.ok_or_else(invalid_code)?;
    transaction
        .execute(
            "UPDATE auth_sms_challenges SET attempts=attempts+1 WHERE verification_sid=?1",
            [&sid],
        )
        .map_err(database_error)?;
    transaction.commit().map_err(database_error)?;
    if !provider.check(&sid, &input.code).map_err(|_| {
        Response::json(
            503,
            json!({"error":"Text verification is temporarily unavailable."}).to_string(),
        )
    })? {
        return Err(invalid_code());
    }
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(database_error)?;
    session(&transaction, request, true)?;
    let consumed = transaction.execute(
        "UPDATE auth_sms_challenges SET consumed_at=?2 WHERE token_hash=?1 AND purpose='enroll' AND consumed_at IS NULL AND expires_at>?2",
        params![token_hash,unix_seconds()],
    ).map_err(database_error)?;
    if consumed != 1 {
        return Err(invalid_code());
    }
    phone_available(&transaction, &phone, account.user.id)?;
    transaction.execute(
        "INSERT INTO auth_phone_numbers(user_id,phone,enrolled_at,verified_at) VALUES(?1,?2,?3,?3)
         ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone,enrolled_at=excluded.enrolled_at,verified_at=excluded.verified_at",
        params![account.user.id,phone,unix_seconds()],
    ).map_err(database_error)?;
    transaction
        .execute(
            "DELETE FROM auth_sms_challenges WHERE user_id=?1",
            [account.user.id],
        )
        .map_err(database_error)?;
    transaction.commit().map_err(database_error)?;
    Ok(generic_email_response(
        "Phone verified. SMS sign-in is enabled.",
    ))
}

fn remove_phone(server: &Server, request: &Request) -> Result<Response, Response> {
    let mut connection = open_game_database(&server.data_dir).map_err(database_error)?;
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(database_error)?;
    let account = session(&transaction, request, true)?;
    if account.user.password_hash.is_none() && email::delivery_paused() {
        return Err(bad_request(
            "Set a password before removing your phone number while email delivery is paused.",
        ));
    }
    transaction
        .execute(
            "DELETE FROM auth_phone_numbers WHERE user_id=?1",
            [account.user.id],
        )
        .map_err(database_error)?;
    transaction
        .execute(
            "DELETE FROM auth_sms_challenges WHERE user_id=?1",
            [account.user.id],
        )
        .map_err(database_error)?;
    transaction.commit().map_err(database_error)?;
    Ok(generic_email_response(
        "Phone removed. SMS sign-in is disabled.",
    ))
}

#[derive(Deserialize)]
struct NewPassword {
    password: String,
}

fn change_password(server: &Server, request: &Request) -> Result<Response, Response> {
    let input = parse::<NewPassword>(request).map_err(|_| bad_request("Enter a new password."))?;
    validate_password(&input.password).map_err(bad_request)?;
    let mut connection = open_game_database(&server.data_dir).map_err(database_error)?;
    let account = session(&connection, request, true)?;
    if !sms::reserve_limits(
        &mut connection,
        &[("password-change", &account.user.id.to_string(), 900, 5)],
    )
    .map_err(database_error)?
    {
        return Err(too_many_requests());
    }
    let hash = hash_password(&input.password).map_err(database_error)?;
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(database_error)?;
    session(&transaction, request, true)?;
    transaction
        .execute(
            "UPDATE auth_users SET password_hash=?2,updated_at=?3 WHERE id=?1",
            params![account.user.id, hash, unix_seconds()],
        )
        .map_err(database_error)?;
    transaction
        .execute(
            "DELETE FROM auth_sessions WHERE user_id=?1",
            [account.user.id],
        )
        .map_err(database_error)?;
    transaction
        .execute(
            "DELETE FROM auth_challenges WHERE user_id=?1",
            [account.user.id],
        )
        .map_err(database_error)?;
    transaction
        .execute(
            "DELETE FROM auth_sms_challenges WHERE user_id=?1",
            [account.user.id],
        )
        .map_err(database_error)?;
    transaction.commit().map_err(database_error)?;
    Ok(create_session_response(server, request, &account.user))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    const PHONE: &str = "+12025550123";
    const NEW_PHONE: &str = "+12025550124";
    const PASSWORD: &str = "a memorable new cribbage passphrase";
    #[derive(Default)]
    struct Provider {
        sends: AtomicUsize,
        checks: AtomicUsize,
        fail: AtomicBool,
    }
    impl VerifyProvider for Provider {
        fn send(&self, phone: &str) -> Result<String, String> {
            self.sends.fetch_add(1, Ordering::SeqCst);
            if self.fail.load(Ordering::SeqCst) {
                return Err("unavailable".into());
            }
            Ok(format!("VE{}", &digest(phone)[..32]))
        }
        fn check(&self, _: &str, code: &str) -> Result<bool, String> {
            self.checks.fetch_add(1, Ordering::SeqCst);
            if self.fail.load(Ordering::SeqCst) {
                return Err("unavailable".into());
            }
            Ok(code == "482193")
        }
    }
    fn setup(name: &str) -> Server {
        let server = super::super::tests::test_server(name);
        let connection = open_game_database(&server.data_dir).unwrap();
        for (token, user) in [("owner", 1), ("other-session", 1), ("other-account", 2)] {
            connection
                .execute(
                    "INSERT INTO auth_sessions VALUES(?1,?2,?3,?4,?4)",
                    params![
                        digest(token),
                        user,
                        unix_seconds() + SESSION_SECONDS,
                        unix_seconds()
                    ],
                )
                .unwrap();
        }
        connection
            .execute(
                "INSERT INTO auth_phone_numbers VALUES(1,?1,?2,?2)",
                params![PHONE, unix_seconds()],
            )
            .unwrap();
        server
    }
    fn request(token: &str, path: &str, body: Value) -> Request {
        Request {
            method: "POST".into(),
            path: format!("/api/auth/account{path}"),
            headers: [
                ("cookie".into(), format!("{SESSION_COOKIE}={token}")),
                ("content-type".into(), "application/json".into()),
            ]
            .into(),
            body: body.to_string(),
        }
    }
    fn response(result: Result<Response, Response>) -> Response {
        result.unwrap_or_else(|r| r)
    }
    fn send(server: &Server, provider: &Provider, phone: &str) -> String {
        let result = response(request_phone(
            server,
            &request("owner", "/phone/request", json!({"phone":phone})),
            provider,
        ));
        assert_eq!(result.status, 200, "{}", result.body);
        serde_json::from_str::<Value>(&result.body).unwrap()["challenge"]
            .as_str()
            .unwrap()
            .to_string()
    }
    fn check(
        server: &Server,
        provider: &Provider,
        owner: &str,
        token: &str,
        code: &str,
    ) -> Response {
        response(verify_phone(
            server,
            &request(
                owner,
                "/phone/verify",
                json!({"challenge":token,"code":code}),
            ),
            provider,
        ))
    }
    fn saved_phone(server: &Server) -> Option<String> {
        open_game_database(&server.data_dir)
            .unwrap()
            .query_row(
                "SELECT phone FROM auth_phone_numbers WHERE user_id=1",
                [],
                |row| row.get(0),
            )
            .optional()
            .unwrap()
    }
    fn cool_down(server: &Server) {
        open_game_database(&server.data_dir)
            .unwrap()
            .execute("UPDATE auth_rate_events SET occurred_at=occurred_at-31", [])
            .unwrap();
    }

    #[test]
    fn account_status_is_private_and_modifications_require_recent_sign_in_and_json() {
        let server = setup("account-auth");
        let mut get = request("owner", "", json!({}));
        get.method = "GET".into();
        let own = handle(&server, &get).unwrap();
        assert_eq!(own.status, 200);
        assert!(own.body.contains(PHONE));
        get.headers.remove("cookie");
        assert_eq!(handle(&server, &get).unwrap().status, 403);
        get.headers
            .insert("cookie".into(), format!("{SESSION_COOKIE}=other-account"));
        assert!(!handle(&server, &get).unwrap().body.contains(PHONE));
        let mut write = request("owner", "/password", json!({"password":PASSWORD}));
        write
            .headers
            .insert("origin".into(), "https://untrusted.example".into());
        assert_eq!(handle(&server, &write).unwrap().status, 403);
        write.headers.remove("origin");
        write
            .headers
            .insert("content-type".into(), "text/plain".into());
        assert_eq!(handle(&server, &write).unwrap().status, 403);
        open_game_database(&server.data_dir)
            .unwrap()
            .execute("UPDATE auth_sessions SET created_at=created_at-601", [])
            .unwrap();
        let provider = Provider::default();
        assert_eq!(
            response(request_phone(
                &server,
                &request("owner", "/phone/request", json!({"phone":NEW_PHONE})),
                &provider
            ))
            .status,
            403
        );
        assert_eq!(
            response(change_password(
                &server,
                &request("owner", "/password", json!({"password":PASSWORD}))
            ))
            .status,
            403
        );
        assert_eq!(
            response(remove_phone(
                &server,
                &request("owner", "/phone/remove", json!({}))
            ))
            .status,
            403
        );
        assert_eq!(provider.sends.load(Ordering::SeqCst), 0);
        assert_eq!(saved_phone(&server).as_deref(), Some(PHONE));
    }

    #[test]
    fn verified_phone_change_is_bound_to_account_session_and_is_single_use() {
        let server = setup("account-phone");
        let provider = Provider::default();
        let token = send(&server, &provider, "(202) 555-0124");
        assert_eq!(saved_phone(&server).as_deref(), Some(PHONE));
        for wrong in ["other-account", "other-session", "missing"] {
            assert_ne!(
                check(&server, &provider, wrong, &token, "482193").status,
                200
            );
        }
        assert_eq!(provider.checks.load(Ordering::SeqCst), 0);
        assert_eq!(
            check(&server, &provider, "owner", &token, "000000").status,
            401
        );
        assert_eq!(saved_phone(&server).as_deref(), Some(PHONE));
        assert_eq!(
            check(&server, &provider, "owner", &token, "482193").status,
            200
        );
        assert_eq!(saved_phone(&server).as_deref(), Some(NEW_PHONE));
        assert_eq!(
            check(&server, &provider, "owner", &token, "482193").status,
            401
        );
        let verified: bool = open_game_database(&server.data_dir)
            .unwrap()
            .query_row(
                "SELECT verified_at IS NOT NULL FROM auth_phone_numbers WHERE user_id=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(verified);
    }

    #[test]
    fn attempts_survive_resends_even_when_switching_phone_numbers() {
        let server = setup("account-attempts");
        let provider = Provider::default();
        let first = send(&server, &provider, NEW_PHONE);
        for _ in 0..3 {
            assert_eq!(
                check(&server, &provider, "owner", &first, "000000").status,
                401
            );
        }
        cool_down(&server);
        send(&server, &provider, "+12025550125");
        cool_down(&server);
        let last = send(&server, &provider, NEW_PHONE);
        assert_eq!(
            check(&server, &provider, "owner", &first, "482193").status,
            401
        );
        for _ in 0..2 {
            assert_eq!(
                check(&server, &provider, "owner", &last, "000000").status,
                401
            );
        }
        assert_eq!(
            check(&server, &provider, "owner", &last, "482193").status,
            401
        );
        assert_eq!(provider.checks.load(Ordering::SeqCst), 5);
        assert_eq!(saved_phone(&server).as_deref(), Some(PHONE));
    }

    #[test]
    fn rejected_resend_and_provider_failure_preserve_the_pending_change() {
        let server = setup("account-provider");
        let provider = Provider::default();
        let token = send(&server, &provider, NEW_PHONE);
        let again = response(request_phone(
            &server,
            &request("owner", "/phone/request", json!({"phone":NEW_PHONE})),
            &provider,
        ));
        assert_eq!(again.status, 429);
        assert!(!again.body.contains("challenge"));
        assert_eq!(provider.sends.load(Ordering::SeqCst), 1);
        provider.fail.store(true, Ordering::SeqCst);
        assert_eq!(
            check(&server, &provider, "owner", &token, "482193").status,
            503
        );
        cool_down(&server);
        assert_eq!(
            response(request_phone(
                &server,
                &request("owner", "/phone/request", json!({"phone":NEW_PHONE})),
                &provider
            ))
            .status,
            503
        );
        provider.fail.store(false, Ordering::SeqCst);
        assert_eq!(
            check(&server, &provider, "owner", &token, "482193").status,
            200
        );
    }

    #[test]
    fn expired_or_revoked_session_and_challenges_cannot_change_phone() {
        for mode in ["code", "session", "logout"] {
            let server = setup(&format!("account-expiry-{mode}"));
            let provider = Provider::default();
            let token = send(&server, &provider, NEW_PHONE);
            let db = open_game_database(&server.data_dir).unwrap();
            db.execute(
                match mode {
                    "code" => "UPDATE auth_sms_challenges SET expires_at=0",
                    "session" => "UPDATE auth_sessions SET created_at=0",
                    _ => "DELETE FROM auth_sessions",
                },
                [],
            )
            .unwrap();
            assert_ne!(
                check(&server, &provider, "owner", &token, "482193").status,
                200
            );
            assert_eq!(provider.checks.load(Ordering::SeqCst), 0);
            assert_eq!(saved_phone(&server).as_deref(), Some(PHONE));
        }
    }

    #[test]
    fn phone_uniqueness_is_checked_before_sending_and_again_before_saving() {
        let server = setup("account-unique");
        let provider = Provider::default();
        let token = send(&server, &provider, NEW_PHONE);
        open_game_database(&server.data_dir)
            .unwrap()
            .execute(
                "INSERT INTO auth_phone_numbers VALUES(2,?1,?2,?2)",
                params![NEW_PHONE, unix_seconds()],
            )
            .unwrap();
        assert_eq!(
            check(&server, &provider, "owner", &token, "482193").status,
            409
        );
        cool_down(&server);
        assert_eq!(
            response(request_phone(
                &server,
                &request("owner", "/phone/request", json!({"phone":NEW_PHONE})),
                &provider
            ))
            .status,
            409
        );
        assert_eq!(provider.sends.load(Ordering::SeqCst), 1);
        assert_eq!(saved_phone(&server).as_deref(), Some(PHONE));
    }

    #[test]
    fn password_change_retires_old_sessions_and_pending_credentials() {
        let server = setup("account-password");
        let provider = Provider::default();
        let token = send(&server, &provider, NEW_PHONE);
        let user = find_user_by_email(&server.data_dir, "founder@evenvision.com")
            .unwrap()
            .unwrap();
        create_challenge(
            &server,
            &user,
            "password-reset",
            "prior-reset",
            RESET_SECONDS,
        )
        .unwrap();
        let short = response(change_password(
            &server,
            &request("owner", "/password", json!({"password":"too short"})),
        ));
        assert_eq!(short.status, 400);
        let result = response(change_password(
            &server,
            &request(
                "owner",
                "/password",
                json!({"password":PASSWORD,"userId":2}),
            ),
        ));
        assert_eq!(result.status, 200);
        let fresh_cookie = result
            .headers
            .iter()
            .find(|(k, _)| k == "Set-Cookie")
            .unwrap()
            .1
            .split(';')
            .next()
            .unwrap()
            .to_string();
        let mut fresh = request("owner", "", json!({}));
        fresh.headers.insert("cookie".into(), fresh_cookie);
        let db = open_game_database(&server.data_dir).unwrap();
        assert!(session(&db, &fresh, true).is_ok());
        for old in ["owner", "other-session"] {
            assert!(session(&db, &request(old, "", json!({})), false).is_err());
        }
        assert!(session(&db, &request("other-account", "", json!({})), false).is_ok());
        let hash: String = db
            .query_row(
                "SELECT password_hash FROM auth_users WHERE id=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(verify_password(&hash, PASSWORD));
        let remaining: i64 = db
            .query_row(
                "SELECT count(*) FROM auth_challenges WHERE user_id=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(remaining, 0);
        assert_ne!(
            check(&server, &provider, "owner", &token, "482193").status,
            200
        );
        assert_eq!(response(remove_phone(&server, &fresh)).status, 200);
        assert!(saved_phone(&server).is_none());
    }

    #[test]
    fn phone_format_accepts_us_punctuation_and_explicit_international_numbers() {
        for input in ["202.555.0123", "(202) 555-0123", "1 202 555 0123", PHONE] {
            assert_eq!(normalize_phone(input).as_deref(), Some(PHONE));
        }
        assert_eq!(
            normalize_phone("+44 7700 900123").as_deref(),
            Some("+447700900123")
        );
        for input in [
            "",
            "+0 12345678",
            "202x5550123",
            "++12025550123",
            "123",
            "+12025550123 ext 1",
        ] {
            assert!(normalize_phone(input).is_none());
        }
    }
}
