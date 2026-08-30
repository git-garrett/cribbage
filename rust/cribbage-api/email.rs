use std::env;

use serde_json::json;

pub struct EmailMessage {
    pub subject: String,
    pub text: String,
    pub html: String,
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
    }
}

pub fn send(to_email: &str, to_name: &str, message: &EmailMessage) -> Result<(), String> {
    let api_key = env::var("SENDGRID_API_KEY")
        .map_err(|_| "SENDGRID_API_KEY is not configured".to_string())?;
    let from_email =
        env::var("CRIBBAGE_MAIL_FROM").unwrap_or_else(|_| "hello@strongcribbage.com".to_string());
    let from_name =
        env::var("CRIBBAGE_MAIL_FROM_NAME").unwrap_or_else(|_| "Strong Cribbage".to_string());
    let reply_to =
        env::var("CRIBBAGE_MAIL_REPLY_TO").unwrap_or_else(|_| "founder@evenvision.com".to_string());
    let payload = json!({
        "personalizations": [{"to": [{"email": to_email, "name": to_name}]}],
        "from": {"email": from_email, "name": from_name},
        "reply_to": {"email": reply_to, "name": "Strong Cribbage"},
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
    match ureq::post("https://api.sendgrid.com/v3/mail/send")
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
<tr><td style="padding:26px 30px 22px;background:#071f38;"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td><img src="https://cribbage.strongcribbage.com/icon-512.png" width="54" height="54" alt="" style="display:block;border:0;border-radius:13px;"></td><td style="padding-left:14px;color:#fbf8f0;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;line-height:28px;">Strong Cribbage<div style="margin-top:3px;color:#e8c575;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Play the stronger game</div></td></tr></table></td></tr>
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

    #[test]
    fn otp_email_contains_code_expiry_and_brand() {
        let message = one_time_code("Garrett", "482193");
        assert_eq!(message.subject, "Your Strong Cribbage sign-in code");
        assert!(!message.subject.contains("482193"));
        assert!(message.html.contains("Strong Cribbage"));
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
}
