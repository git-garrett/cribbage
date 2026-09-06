use std::env;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde_json::json;

use super::{email_audit, open_game_database};

const DELIVERY_RETRY_SECONDS: u64 = 60;
const CLAIM_LEASE_SECONDS: i64 = 5 * 60;

struct QueuedEmail {
    payload: String,
    expires_at: Option<i64>,
}

#[derive(Clone, Copy)]
struct Mailbox<'a> {
    email: &'a str,
    name: &'a str,
}

#[derive(Clone, Copy, Default)]
struct QueuePolicy<'a> {
    dedupe_key: Option<&'a str>,
    expires_at: Option<i64>,
}

pub fn initialize(data_dir: &Path) -> Result<(), String> {
    let connection = open_game_database(data_dir)?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS email_delivery_queue (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               dedupe_key TEXT,
               payload_json TEXT NOT NULL,
               expires_at INTEGER,
               status TEXT NOT NULL DEFAULT 'pending',
               attempts INTEGER NOT NULL DEFAULT 0,
               last_error TEXT,
               claimed_at INTEGER,
               created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL,
               sent_at INTEGER,
               CHECK(status IN ('pending', 'sending', 'sent', 'expired', 'superseded'))
             );
             CREATE INDEX IF NOT EXISTS email_delivery_queue_pending
               ON email_delivery_queue(status, id);",
        )
        .map_err(|error| format!("create email delivery queue: {}", error))?;
    Ok(())
}

pub fn run_delivery_worker(data_dir: std::path::PathBuf) {
    if delivery_paused() {
        return;
    }
    loop {
        if let Err(error) = deliver_pending(&data_dir) {
            eprintln!("Could not process queued email: {}", error);
        }
        std::thread::sleep(Duration::from_secs(DELIVERY_RETRY_SECONDS));
    }
}

pub fn deliver_pending(data_dir: &Path) -> Result<(), String> {
    if delivery_paused() {
        return Ok(());
    }
    recover_stale_claims(data_dir)?;
    let connection = open_game_database(data_dir)?;

    let mut statement = connection
        .prepare(
            "SELECT id FROM email_delivery_queue
             WHERE status = 'pending'
             ORDER BY id",
        )
        .map_err(|error| format!("prepare pending email query: {}", error))?;
    let ids = statement
        .query_map([], |row| row.get::<_, i64>(0))
        .map_err(|error| format!("read pending emails: {}", error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("collect pending emails: {}", error))?;
    drop(statement);
    drop(connection);

    for id in ids {
        if let Err(error) = deliver_queued_with(data_dir, id, send_via_sendgrid) {
            eprintln!("Could not deliver queued email {}: {}", id, error);
        }
    }
    Ok(())
}

fn recover_stale_claims(data_dir: &Path) -> Result<(), String> {
    let connection = open_game_database(data_dir)?;
    let now = unix_seconds();
    connection
        .execute(
            "UPDATE email_delivery_queue
             SET status = 'pending', claimed_at = NULL, updated_at = ?1
             WHERE status = 'sending' AND COALESCE(claimed_at, updated_at) <= ?2",
            params![now, now - CLAIM_LEASE_SECONDS],
        )
        .map_err(|error| format!("recover stale email delivery claims: {}", error))?;
    Ok(())
}

pub fn delivery_paused() -> bool {
    env::var("CRIBBAGE_EMAIL_DELIVERY_PAUSED")
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false)
}

pub struct EmailMessage {
    pub subject: String,
    pub text: String,
    pub html: String,
    pub attachments: Vec<EmailAttachment>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EmailAttachment {
    pub filename: String,
    pub mime_type: String,
    pub content: String,
}

pub fn one_time_code(display_name: &str, code: &str) -> EmailMessage {
    let safe_name = html_escape(display_name);
    let safe_code = html_escape(code);
    EmailMessage {
        subject: "Your Strong Cribbage sign-in code".to_string(),
        text: format!(
            "Hi {},\n\nUse {} to sign in to Strong Cribbage. It expires in 10 minutes and works once.\n\nIf you did not request this code, you can ignore this email.",
            display_name, code
        ),
        html: frame(
            "Your secure sign-in code",
            "Sign in to Strong Cribbage",
            &format!(
                "Hi {}, use this one-time code to return to the table.",
                safe_name
            ),
            &format!(
                "<div style=\"margin:28px 0 24px;padding:20px 16px;border:1px solid #d6c087;border-radius:14px;background:#f3eddf;text-align:center;\"><div style=\"color:#52615b;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;\">One-time code</div><div style=\"margin-top:8px;color:#073c30;font-family:'Courier New',Courier,monospace;font-size:36px;font-weight:700;letter-spacing:8px;line-height:1.2;\">{}</div></div>",
                safe_code
            ),
            "This code expires in 10 minutes and works once. Strong Cribbage will never ask you to send this code to another person.",
        ),
        attachments: Vec::new(),
    }
}

pub fn password_reset(display_name: &str, reset_url: &str) -> EmailMessage {
    let safe_name = html_escape(display_name);
    let safe_url = html_escape(reset_url);
    EmailMessage {
        subject: "Reset your Strong Cribbage password".to_string(),
        text: format!(
            "Hi {},\n\nChoose a new Strong Cribbage password: {}\n\nThis link expires in 30 minutes and can only be used once. If you did not request a reset, you can ignore this email.",
            display_name, reset_url
        ),
        html: frame(
            "Password reset requested",
            "Choose a new password",
            &format!(
                "Hi {}, we received a request to reset the password for your Strong Cribbage account.",
                safe_name
            ),
            &button("Choose a new password", &safe_url),
            "This private link expires in 30 minutes and works once. If you did not request a reset, no action is required.",
        ),
        attachments: Vec::new(),
    }
}

pub fn invitation(display_name: &str, invite_url: &str) -> EmailMessage {
    let safe_name = html_escape(display_name);
    let safe_url = html_escape(invite_url);
    EmailMessage {
        subject: "Your invitation to Strong Cribbage".to_string(),
        text: format!(
            "Hi {},\n\nYour seat at the Strong Cribbage table is ready. Set up your account: {}\n\nThis invitation expires in 7 days and can only be used once.",
            display_name, invite_url
        ),
        html: frame(
            "Invitation only · your seat is ready",
            "Welcome to the table",
            &format!(
                "Hi {}, you have been invited to play one-on-one against the Strong Cribbage engine and track your results over time.",
                safe_name
            ),
            &button("Set up your account", &safe_url),
            "This invitation is tied to your email address, expires in 7 days, and works once.",
        ),
        attachments: Vec::new(),
    }
}

pub fn access_request(
    first_name: &str,
    last_name: &str,
    username: &str,
    email: &str,
) -> EmailMessage {
    let full_name = format!("{} {}", first_name, last_name);
    let details = format!(
        "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"margin:24px 0;padding:18px;border:1px solid #d6c087;border-radius:14px;background:#f3eddf;color:#17231f;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;\"><tr><td><strong>Name</strong></td><td>{}</td></tr><tr><td><strong>Username</strong></td><td>{}</td></tr><tr><td><strong>Email</strong></td><td>{}</td></tr></table>",
        html_escape(&full_name),
        html_escape(username),
        html_escape(email),
    );
    EmailMessage {
        subject: format!("Strong Cribbage preview request from {}", full_name),
        text: format!(
            "A player requested Strong Cribbage preview access.\n\nName: {}\nUsername: {}\nEmail: {}",
            full_name, username, email
        ),
        html: frame(
            "Preview access request",
            "A player would like a seat",
            "A prospective player completed the preview access form.",
            &details,
            "Reply to this email to contact the player.",
        ),
        attachments: Vec::new(),
    }
}

pub fn bug_report(
    display_name: &str,
    username: &str,
    email: &str,
    description: &str,
    page: &str,
    screenshot: Option<EmailAttachment>,
) -> EmailMessage {
    let attachment_note = if screenshot.is_some() {
        "A screenshot is attached."
    } else {
        "No screenshot was attached."
    };
    let details = feedback_details(username, email, description, page, attachment_note);
    EmailMessage {
        subject: format!("Strong Cribbage bug report from {}", display_name),
        text: format!(
            "Bug report from {} (@{}, {})\n\nPage: {}\n\n{}\n\n{}",
            display_name, username, email, page, description, attachment_note
        ),
        html: frame(
            "Player bug report",
            "Something needs attention",
            "A signed-in player found something that may be wrong.",
            &details,
            attachment_note,
        ),
        attachments: screenshot.into_iter().collect(),
    }
}

pub fn feature_request(
    display_name: &str,
    username: &str,
    email: &str,
    description: &str,
    page: &str,
) -> EmailMessage {
    let details = feedback_details(username, email, description, page, "Feature request");
    EmailMessage {
        subject: format!("Strong Cribbage feature request from {}", display_name),
        text: format!(
            "Feature request from {} (@{}, {})\n\nPage: {}\n\n{}",
            display_name, username, email, page, description
        ),
        html: frame(
            "Player feature request",
            "A new way to strengthen the game",
            "A signed-in player suggested an improvement.",
            &details,
            "Reply to this email if you would like to follow up with the player.",
        ),
        attachments: Vec::new(),
    }
}

pub fn send_feedback(
    data_dir: &Path,
    message: &EmailMessage,
    reply_to_email: &str,
    reply_to_name: &str,
) -> Result<(), String> {
    let recipient = env::var("CRIBBAGE_FEEDBACK_TO")
        .or_else(|_| env::var("CRIBBAGE_MAIL_REPLY_TO"))
        .unwrap_or_else(|_| "founder@evenvision.com".to_string());
    queue_with_reply_to(
        data_dir,
        Mailbox {
            email: &recipient,
            name: "Strong Cribbage",
        },
        message,
        Mailbox {
            email: reply_to_email,
            name: reply_to_name,
        },
        QueuePolicy::default(),
    )
}

pub fn send_access_request(
    data_dir: &Path,
    first_name: &str,
    last_name: &str,
    username: &str,
    email: &str,
) -> Result<(), String> {
    let recipient = env::var("CRIBBAGE_ACCESS_REQUEST_TO")
        .or_else(|_| env::var("CRIBBAGE_MAIL_REPLY_TO"))
        .unwrap_or_else(|_| "founder@evenvision.com".to_string());
    let full_name = format!("{} {}", first_name, last_name);
    let dedupe_key = format!("access-request:{}", email.to_ascii_lowercase());
    queue_with_reply_to(
        data_dir,
        Mailbox {
            email: &recipient,
            name: "Strong Cribbage",
        },
        &access_request(first_name, last_name, username, email),
        Mailbox {
            email,
            name: &full_name,
        },
        QueuePolicy {
            dedupe_key: Some(&dedupe_key),
            expires_at: None,
        },
    )
}

pub fn send(
    data_dir: &Path,
    to_email: &str,
    to_name: &str,
    message: &EmailMessage,
    dedupe_key: &str,
    expires_at: i64,
) -> Result<(), String> {
    let reply_to =
        env::var("CRIBBAGE_MAIL_REPLY_TO").unwrap_or_else(|_| "founder@evenvision.com".to_string());
    queue_with_reply_to(
        data_dir,
        Mailbox {
            email: to_email,
            name: to_name,
        },
        message,
        Mailbox {
            email: &reply_to,
            name: "Strong Cribbage",
        },
        QueuePolicy {
            dedupe_key: Some(dedupe_key),
            expires_at: Some(expires_at),
        },
    )
}

fn queue_with_reply_to(
    data_dir: &Path,
    recipient: Mailbox<'_>,
    message: &EmailMessage,
    reply_to: Mailbox<'_>,
    policy: QueuePolicy<'_>,
) -> Result<(), String> {
    let payload = sendgrid_payload(recipient, message, reply_to);
    let id = enqueue(
        data_dir,
        policy.dedupe_key,
        &payload.to_string(),
        policy.expires_at,
    )?;
    if !delivery_paused() {
        if let Err(error) = deliver_queued_with(data_dir, id, send_via_sendgrid) {
            eprintln!("Could not deliver queued email {}: {}", id, error);
        }
    }
    Ok(())
}

fn enqueue(
    data_dir: &Path,
    dedupe_key: Option<&str>,
    payload: &str,
    expires_at: Option<i64>,
) -> Result<i64, String> {
    let mut connection = open_game_database(data_dir)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("start email queue transaction: {}", error))?;
    let now = unix_seconds();
    if let Some(dedupe_key) = dedupe_key {
        transaction
            .execute(
                "UPDATE email_delivery_queue
                 SET status = 'superseded', payload_json = '', updated_at = ?2
                 WHERE dedupe_key = ?1 AND status = 'pending'",
                params![dedupe_key, now],
            )
            .map_err(|error| format!("supersede queued email: {}", error))?;
    }
    transaction
        .execute(
            "INSERT INTO email_delivery_queue
             (dedupe_key, payload_json, expires_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)",
            params![dedupe_key, payload, expires_at, now],
        )
        .map_err(|error| format!("queue email: {}", error))?;
    let id = transaction.last_insert_rowid();
    transaction
        .commit()
        .map_err(|error| format!("commit queued email: {}", error))?;
    Ok(id)
}

fn deliver_queued_with<F>(data_dir: &Path, id: i64, deliver: F) -> Result<(), String>
where
    F: FnOnce(&QueuedEmail) -> Result<(), String>,
{
    let connection = open_game_database(data_dir)?;
    let now = unix_seconds();
    let claimed = connection
        .execute(
            "UPDATE email_delivery_queue
             SET status = 'sending', attempts = attempts + 1,
                 claimed_at = ?2, updated_at = ?2
             WHERE id = ?1 AND status = 'pending'",
            params![id, now],
        )
        .map_err(|error| format!("claim queued email: {}", error))?;
    if claimed == 0 {
        return Ok(());
    }
    let queued = connection
        .query_row(
            "SELECT payload_json, expires_at FROM email_delivery_queue WHERE id = ?1",
            [id],
            |row| {
                Ok(QueuedEmail {
                    payload: row.get(0)?,
                    expires_at: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(|error| format!("read claimed email: {}", error))?
        .ok_or_else(|| format!("queued email {} disappeared", id))?;
    if queued
        .expires_at
        .is_some_and(|expires_at| expires_at <= now)
    {
        connection
            .execute(
                "UPDATE email_delivery_queue
                 SET status = 'expired', payload_json = '', claimed_at = NULL, updated_at = ?2
                 WHERE id = ?1",
                params![id, now],
            )
            .map_err(|error| format!("expire queued email: {}", error))?;
        return Ok(());
    }

    match deliver(&queued) {
        Ok(()) => connection
            .execute(
                "UPDATE email_delivery_queue
                 SET status = 'sent', payload_json = '', last_error = NULL,
                     claimed_at = NULL, sent_at = ?2, updated_at = ?2
                 WHERE id = ?1",
                params![id, unix_seconds()],
            )
            .map(|_| ())
            .map_err(|error| format!("record delivered email: {}", error)),
        Err(error) => {
            connection
                .execute(
                    "UPDATE email_delivery_queue
                     SET status = 'pending', last_error = ?2,
                         claimed_at = NULL, updated_at = ?3
                     WHERE id = ?1",
                    params![id, error, unix_seconds()],
                )
                .map_err(|db_error| format!("record email delivery failure: {}", db_error))?;
            Err(error)
        }
    }
}

fn sendgrid_payload(
    recipient: Mailbox<'_>,
    message: &EmailMessage,
    reply_to: Mailbox<'_>,
) -> serde_json::Value {
    let from_email =
        env::var("CRIBBAGE_MAIL_FROM").unwrap_or_else(|_| "hello@strongcribbage.com".to_string());
    let from_name =
        env::var("CRIBBAGE_MAIL_FROM_NAME").unwrap_or_else(|_| "Strong Cribbage".to_string());
    let mut payload = json!({
        "personalizations": [{"to": [{"email": recipient.email, "name": recipient.name}]}],
        "from": {"email": from_email, "name": from_name},
        "reply_to": {"email": reply_to.email, "name": reply_to.name},
        "subject": message.subject,
        "content": [
            {"type": "text/plain", "value": message.text},
            {"type": "text/html", "value": message.html}
        ],
        "tracking_settings": {
            "click_tracking": {"enable": false, "enable_text": false},
            "open_tracking": {"enable": false}
        }
    });
    if !message.attachments.is_empty() {
        payload["attachments"] = json!(message
            .attachments
            .iter()
            .map(|attachment| json!({
                "content": attachment.content,
                "type": attachment.mime_type,
                "filename": attachment.filename,
                "disposition": "attachment"
            }))
            .collect::<Vec<_>>());
    }
    payload
}

fn send_via_sendgrid(queued: &QueuedEmail) -> Result<(), String> {
    let api_key = env::var("SENDGRID_API_KEY")
        .map_err(|_| "SENDGRID_API_KEY is not configured".to_string())?;
    if api_key == "local-email-disabled" {
        return Ok(());
    }
    let mut payload: serde_json::Value = serde_json::from_str(&queued.payload)
        .map_err(|error| format!("parse queued email: {}", error))?;
    email_audit::reserve_and_tag(&mut payload)?;
    match ureq::post("https://api.sendgrid.com/v3/mail/send")
        .timeout(Duration::from_secs(10))
        .set("Authorization", &format!("Bearer {}", api_key))
        .set("Content-Type", "application/json")
        .send_string(&payload.to_string())
    {
        Ok(response) if response.status() == 202 => Ok(()),
        Ok(response) => Err(format!("SendGrid returned HTTP {}", response.status())),
        Err(ureq::Error::Status(status, _)) => Err(format!("SendGrid returned HTTP {}", status)),
        Err(error) => Err(format!("SendGrid request failed: {}", error)),
    }
}

pub(super) fn unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn feedback_details(
    username: &str,
    email: &str,
    description: &str,
    page: &str,
    note: &str,
) -> String {
    format!(
        "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"margin:24px 0;padding:18px;border:1px solid #d6c087;border-radius:14px;background:#f3eddf;color:#17231f;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;\"><tr><td><strong>Player</strong></td><td>@{}</td></tr><tr><td><strong>Email</strong></td><td>{}</td></tr><tr><td><strong>Page</strong></td><td>{}</td></tr></table><div style=\"margin:0 0 18px;padding:18px;border-left:4px solid #0b5b43;background:#f8f4ea;white-space:pre-wrap;\">{}</div><p style=\"margin:0;\">{}</p>",
        html_escape(username),
        html_escape(email),
        html_escape(page),
        html_escape(description),
        html_escape(note),
    )
}

fn button(label: &str, url: &str) -> String {
    format!(
        "<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"margin:28px 0 24px;\"><tr><td style=\"border-radius:999px;background:#0b5b43;\"><a href=\"{}\" style=\"display:inline-block;padding:15px 24px;border:2px solid #d7b65e;border-radius:999px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;line-height:20px;text-decoration:none;\">{}</a></td></tr></table>",
        url,
        html_escape(label)
    )
}

fn frame(eyebrow: &str, title: &str, intro: &str, action: &str, security: &str) -> String {
    format!(
        r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>{title}</title></head>
<body style="margin:0;padding:0;background:#073c30;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;">{eyebrow}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#073c30;"><tr><td align="center" style="padding:32px 14px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;border:1px solid #d7b65e;border-radius:22px;background:#fbf8f0;box-shadow:0 18px 40px rgba(0,0,0,.18);overflow:hidden;">
<tr><td style="padding:26px 30px 22px;background:#071f38;"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td><img src="https://cribbage.strongcribbage.com/icon-512.png" width="54" height="54" alt="" style="display:block;border:0;border-radius:13px;"></td><td style="padding-left:14px;color:#fbf8f0;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;line-height:28px;">Strong Cribbage<div style="margin-top:3px;color:#e8c575;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Play and Strengthen Your Game</div></td></tr></table></td></tr>
<tr><td style="padding:34px 30px 30px;color:#17231f;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:25px;"><div style="color:#8b6724;font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;">{eyebrow}</div><h1 style="margin:8px 0 14px;color:#073c30;font-family:Georgia,'Times New Roman',serif;font-size:31px;line-height:37px;">{title}</h1><p style="margin:0;">{intro}</p>{action}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" aria-hidden="true" style="margin:25px 0 20px;"><tr><td style="height:1px;background:#d7cba9;"></td><td width="12" style="font-size:0;line-height:0;">&nbsp;</td><td width="8" height="8" style="border:2px solid #c59b3d;border-radius:50%;font-size:0;line-height:0;">&nbsp;</td><td width="9" style="font-size:0;line-height:0;">&nbsp;</td><td width="8" height="8" style="border:2px solid #c59b3d;border-radius:50%;font-size:0;line-height:0;">&nbsp;</td><td width="12" style="font-size:0;line-height:0;">&nbsp;</td><td style="height:1px;background:#d7cba9;"></td></tr></table>
<p style="margin:0;color:#52615b;font-size:13px;line-height:20px;">{security}</p></td></tr>
<tr><td style="padding:18px 30px;background:#f1eadb;color:#66736e;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;">Sent securely by Strong Cribbage · <a href="https://cribbage.strongcribbage.com" style="color:#0b5b43;">cribbage.strongcribbage.com</a></td></tr>
</table></td></tr></table></body></html>"#,
        eyebrow = html_escape(eyebrow),
        title = html_escape(title),
        intro = intro,
        action = action,
        security = html_escape(security),
    )
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn queue_data_dir(name: &str) -> std::path::PathBuf {
        let data_dir = std::env::temp_dir().join(format!(
            "cribbage-email-{}-{}-{}",
            name,
            std::process::id(),
            unix_seconds()
        ));
        super::super::initialize_game_database(&data_dir).unwrap();
        initialize(&data_dir).unwrap();
        data_dir
    }

    #[test]
    fn queue_supersedes_an_older_auth_message_with_the_same_key() {
        let data_dir = queue_data_dir("supersede");
        enqueue(
            &data_dir,
            Some("otp:1"),
            "{\"message\":\"old secret\"}",
            Some(unix_seconds() + 600),
        )
        .unwrap();
        let current = enqueue(
            &data_dir,
            Some("otp:1"),
            "{\"message\":\"current secret\"}",
            Some(unix_seconds() + 600),
        )
        .unwrap();

        let connection = open_game_database(&data_dir).unwrap();
        let superseded: (String, String) = connection
            .query_row(
                "SELECT status, payload_json FROM email_delivery_queue WHERE id < ?1",
                [current],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let pending: String = connection
            .query_row(
                "SELECT status FROM email_delivery_queue WHERE id = ?1",
                [current],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(superseded, ("superseded".to_string(), String::new()));
        assert_eq!(pending, "pending");
        drop(connection);
        std::fs::remove_dir_all(data_dir).unwrap();
    }

    #[test]
    fn successful_delivery_redacts_content_and_failure_stays_pending() {
        let data_dir = queue_data_dir("delivery");
        let sent_id = enqueue(&data_dir, None, "{\"message\":\"send me\"}", None).unwrap();
        deliver_queued_with(&data_dir, sent_id, |queued| {
            assert!(queued.payload.contains("send me"));
            Ok(())
        })
        .unwrap();
        let failed_id = enqueue(&data_dir, None, "{\"message\":\"retry me\"}", None).unwrap();
        assert!(
            deliver_queued_with(&data_dir, failed_id, |_| Err("provider down".to_string()))
                .is_err()
        );

        let connection = open_game_database(&data_dir).unwrap();
        let sent: (String, String, i64) = connection
            .query_row(
                "SELECT status, payload_json, attempts FROM email_delivery_queue WHERE id = ?1",
                [sent_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        let failed: (String, String, i64) = connection
            .query_row(
                "SELECT status, last_error, attempts FROM email_delivery_queue WHERE id = ?1",
                [failed_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(sent, ("sent".to_string(), String::new(), 1));
        assert_eq!(
            failed,
            ("pending".to_string(), "provider down".to_string(), 1)
        );
        drop(connection);
        std::fs::remove_dir_all(data_dir).unwrap();
    }

    #[test]
    fn expired_auth_message_is_not_delivered_and_is_redacted() {
        let data_dir = queue_data_dir("expired");
        let id = enqueue(
            &data_dir,
            Some("password-reset:1"),
            "{\"message\":\"expired secret\"}",
            Some(unix_seconds() - 1),
        )
        .unwrap();
        deliver_queued_with(&data_dir, id, |_| {
            panic!("expired email must not be delivered")
        })
        .unwrap();

        let connection = open_game_database(&data_dir).unwrap();
        let row: (String, String) = connection
            .query_row(
                "SELECT status, payload_json FROM email_delivery_queue WHERE id = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(row, ("expired".to_string(), String::new()));
        drop(connection);
        std::fs::remove_dir_all(data_dir).unwrap();
    }

    #[test]
    fn only_stale_delivery_claims_are_recovered() {
        let data_dir = queue_data_dir("claim-lease");
        let stale = enqueue(&data_dir, None, "{\"message\":\"stale\"}", None).unwrap();
        let fresh = enqueue(&data_dir, None, "{\"message\":\"fresh\"}", None).unwrap();
        let now = unix_seconds();
        let connection = open_game_database(&data_dir).unwrap();
        connection
            .execute(
                "UPDATE email_delivery_queue
                 SET status = 'sending', claimed_at = ?2, updated_at = ?2
                 WHERE id = ?1",
                params![stale, now - CLAIM_LEASE_SECONDS - 1],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE email_delivery_queue
                 SET status = 'sending', claimed_at = ?2, updated_at = ?2
                 WHERE id = ?1",
                params![fresh, now],
            )
            .unwrap();
        drop(connection);

        recover_stale_claims(&data_dir).unwrap();

        let connection = open_game_database(&data_dir).unwrap();
        let stale_status: String = connection
            .query_row(
                "SELECT status FROM email_delivery_queue WHERE id = ?1",
                [stale],
                |row| row.get(0),
            )
            .unwrap();
        let fresh_status: String = connection
            .query_row(
                "SELECT status FROM email_delivery_queue WHERE id = ?1",
                [fresh],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stale_status, "pending");
        assert_eq!(fresh_status, "sending");
        drop(connection);
        std::fs::remove_dir_all(data_dir).unwrap();
    }

    #[test]
    fn otp_email_contains_code_expiry_and_brand() {
        let message = one_time_code("Garrett", "482193");
        assert_eq!(message.subject, "Your Strong Cribbage sign-in code");
        assert!(!message.subject.contains("482193"));
        assert!(message.html.contains("Strong Cribbage"));
        assert!(message.html.contains("Play and Strengthen Your Game"));
        assert!(!message.html.contains("Play the stronger game"));
        assert!(message.html.contains("482193"));
        assert!(message.html.contains("10 minutes"));
        assert!(message.text.contains("works once"));
    }

    #[test]
    fn reset_and_invite_escape_names_and_link_to_actions() {
        let reset = password_reset("A <B>", "https://example.test/?reset=abc");
        let invite = invitation("A <B>", "https://example.test/?invite=xyz");
        assert!(reset.html.contains("A &lt;B&gt;"));
        assert!(reset.html.contains("reset=abc"));
        assert!(invite.html.contains("invite=xyz"));
        assert!(!invite.html.contains("A <B>"));
    }

    #[test]
    fn preview_request_contains_all_requested_fields_and_escapes_html() {
        let message = access_request("Ada <", "Lovelace", "Analyst & Player", "ada@example.com");
        assert!(message.subject.contains("Ada < Lovelace"));
        assert!(message.text.contains("Analyst & Player"));
        assert!(message.text.contains("ada@example.com"));
        assert!(message.html.contains("Ada &lt; Lovelace"));
        assert!(message.html.contains("Analyst &amp; Player"));
        assert!(!message.html.contains("Analyst & Player"));
    }

    #[test]
    fn feedback_messages_escape_player_copy_and_attach_screenshots() {
        let attachment = EmailAttachment {
            filename: "bug-report.png".to_string(),
            mime_type: "image/png".to_string(),
            content: "cG5n".to_string(),
        };
        let bug = bug_report(
            "Ada",
            "ada",
            "ada@example.com",
            "Cards < overlap & vanish",
            "https://example.test/play",
            Some(attachment),
        );
        assert!(bug.html.contains("Cards &lt; overlap &amp; vanish"));
        assert!(!bug.html.contains("Cards < overlap"));
        assert_eq!(bug.attachments.len(), 1);
        assert_eq!(bug.attachments[0].mime_type, "image/png");

        let feature = feature_request(
            "Ada",
            "ada",
            "ada@example.com",
            "Add daily boards",
            "https://example.test/",
        );
        assert!(feature.text.contains("Add daily boards"));
        assert!(feature.attachments.is_empty());
    }
}
