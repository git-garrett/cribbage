use std::env;
use std::time::Duration;

use rand_core::{OsRng, RngCore};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use super::email::unix_seconds;

struct Config {
    url: String,
    secret: String,
    source_id: String,
    required: bool,
}

struct Tag {
    audit_id: String,
    source_id: String,
}

pub fn reserve_and_tag(payload: &mut Value) -> Result<(), String> {
    let required = bool_env("EMAIL_AUDIT_REQUIRED");
    let url = env::var("EMAIL_AUDIT_URL").unwrap_or_default();
    let secret = env::var("EMAIL_AUDIT_SECRET").unwrap_or_default();
    if url.trim().is_empty() || secret.trim().is_empty() {
        return if required {
            Err("email audit is required but not configured".to_string())
        } else {
            Ok(())
        };
    }
    if !valid_endpoint(&url) {
        return configuration_error(
            required,
            "EMAIL_AUDIT_URL must use HTTPS outside localhost".to_string(),
        );
    }
    let source_id =
        env::var("EMAIL_AUDIT_SOURCE_ID").unwrap_or_else(|_| "strong-cribbage".to_string());
    if !valid_source_id(&source_id) {
        return configuration_error(required, "EMAIL_AUDIT_SOURCE_ID is invalid".to_string());
    }
    let config = Config {
        url,
        secret,
        source_id,
        required,
    };
    let tag = Tag {
        audit_id: audit_uuid(),
        source_id: config.source_id.clone(),
    };
    add_tag(payload, &tag)?;
    let timestamp = unix_seconds();
    let body = reservation_body(payload, &tag, timestamp)?;
    let signature = signature(&config.secret, &config.source_id, timestamp, &body);
    let response = ureq::post(&config.url)
        .timeout(Duration::from_secs(5))
        .set("Content-Type", "application/json")
        .set("X-Email-Audit-Source", &config.source_id)
        .set("X-Email-Audit-Timestamp", &timestamp.to_string())
        .set("X-Email-Audit-Signature", &signature)
        .send_string(&body);
    let result = match response {
        Ok(response) if (200..300).contains(&response.status()) => Ok(()),
        Ok(response) => Err(format!("email audit returned HTTP {}", response.status())),
        Err(ureq::Error::Status(status, _)) => Err(format!("email audit returned HTTP {}", status)),
        Err(error) => Err(format!("email audit request failed: {}", error)),
    };
    match result {
        Ok(()) => Ok(()),
        Err(error) if config.required => Err(error),
        Err(error) => {
            eprintln!("{}", error);
            Ok(())
        }
    }
}

fn configuration_error(required: bool, error: String) -> Result<(), String> {
    if required {
        Err(error)
    } else {
        eprintln!("{}", error);
        Ok(())
    }
}

fn reservation_body(payload: &Value, tag: &Tag, timestamp: i64) -> Result<String, String> {
    let personalization = payload
        .get("personalizations")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(Value::as_object)
        .ok_or_else(|| "SendGrid payload is missing a personalization".to_string())?;
    let addresses = |key: &str| {
        personalization
            .get(key)
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.get("email").and_then(Value::as_str))
                    .map(|email| email.trim().to_ascii_lowercase())
                    .filter(|email| !email.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    };
    let from_email = payload
        .get("from")
        .and_then(|from| from.get("email"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let subject = payload
        .get("subject")
        .and_then(Value::as_str)
        .unwrap_or_default();
    serde_json::to_string(&json!({
        "schema_version": 1,
        "audit_id": tag.audit_id,
        "source_id": tag.source_id,
        "sent_at_unix": timestamp,
        "from_email": from_email,
        "to": addresses("to"),
        "cc": addresses("cc"),
        "bcc": addresses("bcc"),
        "subject": subject,
        "message_key": "",
        "source_message_id": ""
    }))
    .map_err(|error| format!("serialize email audit reservation: {}", error))
}

fn add_tag(payload: &mut Value, tag: &Tag) -> Result<(), String> {
    let personalization = payload
        .get_mut("personalizations")
        .and_then(Value::as_array_mut)
        .and_then(|items| items.first_mut())
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "SendGrid payload is missing a personalization".to_string())?;
    let custom_args = personalization
        .entry("custom_args")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or_else(|| "SendGrid custom arguments are invalid".to_string())?;
    custom_args.insert(
        "status_audit_id".to_string(),
        Value::String(tag.audit_id.clone()),
    );
    custom_args.insert(
        "status_audit_source".to_string(),
        Value::String(tag.source_id.clone()),
    );
    Ok(())
}

fn signature(secret: &str, source_id: &str, timestamp: i64, body: &str) -> String {
    let content = format!("{}\n{}\n{}", timestamp, source_id, body);
    format!(
        "sha256={}",
        hex(&hmac_sha256(secret.as_bytes(), content.as_bytes()))
    )
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
    const BLOCK_SIZE: usize = 64;
    let mut normalized = [0_u8; BLOCK_SIZE];
    if key.len() > BLOCK_SIZE {
        normalized[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        normalized[..key.len()].copy_from_slice(key);
    }
    let mut inner_pad = [0x36_u8; BLOCK_SIZE];
    let mut outer_pad = [0x5c_u8; BLOCK_SIZE];
    for index in 0..BLOCK_SIZE {
        inner_pad[index] ^= normalized[index];
        outer_pad[index] ^= normalized[index];
    }
    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(data);
    let inner_hash = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_hash);
    outer.finalize().into()
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut result = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        result.push(DIGITS[(byte >> 4) as usize] as char);
        result.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    result
}

fn audit_uuid() -> String {
    let mut bytes = [0_u8; 16];
    OsRng.fill_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let value = hex(&bytes);
    format!(
        "{}-{}-{}-{}-{}",
        &value[0..8],
        &value[8..12],
        &value[12..16],
        &value[16..20],
        &value[20..32]
    )
}

fn bool_env(name: &str) -> bool {
    env::var(name)
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

fn valid_source_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 64
        && (bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit())
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(byte))
}

fn valid_endpoint(value: &str) -> bool {
    value.starts_with("https://")
        || value.starts_with("http://127.0.0.1:")
        || value.starts_with("http://localhost:")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload() -> Value {
        json!({
            "personalizations": [{"to": [{"email": "PLAYER@EXAMPLE.COM"}]}],
            "from": {"email": "hello@strongcribbage.com"},
            "subject": "Your sign-in code",
            "content": [{"type": "text/plain", "value": "private body"}]
        })
    }

    #[test]
    fn reservation_contains_metadata_but_not_content() {
        let tag = Tag {
            audit_id: "11111111-1111-4111-8111-111111111111".to_string(),
            source_id: "strong-cribbage".to_string(),
        };
        let body = reservation_body(&payload(), &tag, 1_700_000_000).unwrap();
        let value: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(value["to"], json!(["player@example.com"]));
        assert_eq!(value["from_email"], "hello@strongcribbage.com");
        assert_eq!(value["audit_id"], tag.audit_id);
        assert!(!body.contains("private body"));
        assert!(!body.contains("content"));
    }

    #[test]
    fn sendgrid_tag_contains_only_correlation_fields() {
        let tag = Tag {
            audit_id: "11111111-1111-4111-8111-111111111111".to_string(),
            source_id: "strong-cribbage".to_string(),
        };
        let mut value = payload();
        add_tag(&mut value, &tag).unwrap();
        assert_eq!(
            value["personalizations"][0]["custom_args"],
            json!({
                "status_audit_id": tag.audit_id,
                "status_audit_source": tag.source_id
            })
        );
    }

    #[test]
    fn hmac_matches_the_sha256_reference_vector() {
        assert_eq!(
            hex(&hmac_sha256(
                b"key",
                b"The quick brown fox jumps over the lazy dog"
            )),
            "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8"
        );
    }

    #[test]
    fn rollout_configuration_errors_fail_open_until_required() {
        assert!(configuration_error(false, "bad config".to_string()).is_ok());
        assert_eq!(
            configuration_error(true, "bad config".to_string()).unwrap_err(),
            "bad config"
        );
    }
}
