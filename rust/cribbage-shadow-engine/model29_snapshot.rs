//! Generation manifests are available only in the training binary.
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

#[derive(Default)]
struct Session {
    enabled: bool,
    generation: String,
    code: String,
    stats: serde_json::Value,
    root: String,
}
thread_local! {
    static SESSION: std::cell::RefCell<Session> = std::cell::RefCell::new(Session::default());
}
pub fn activate(root: &str, enabled: bool) -> Result<(), String> {
    let raw = fs::read(Path::new(root).join("rust/cribbage-shadow-engine/assets/model29-generation.json")).map_err(|e|e.to_string())?;
    let manifest: serde_json::Value = serde_json::from_slice(&raw).map_err(|e|e.to_string())?;
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        s.enabled = enabled;
        s.root = root.into();
        s.generation = format!("{:x}", Sha256::digest(raw));
        s.code = manifest["policy"]["binarySha256"].as_str().unwrap_or("").into();
    });
    Ok(())
}
pub fn cache_enabled() -> bool { SESSION.with(|s|s.borrow().enabled) }
pub fn generation() -> String { SESSION.with(|s|s.borrow().generation.clone()) }
pub fn active_root() -> String { SESSION.with(|s|s.borrow().root.clone()) }
pub fn code_identity() -> String { SESSION.with(|s|s.borrow().code.clone()) }
pub fn reset_cache_stats() {
    SESSION.with(|s|s.borrow_mut().stats = serde_json::json!({"hits":0,"misses":0,"expired":0,"writes":0,"maxAgeGames":0,"generations":{}}));
}
pub fn cache_stats() -> serde_json::Value { SESSION.with(|s|s.borrow().stats.clone()) }
pub(crate) fn cache_event(kind: &str, age: u64, generation: &str) {
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        let n = s.stats[kind].as_u64().unwrap_or(0);
        s.stats[kind] = (n+1).into();
        let max = s.stats["maxAgeGames"].as_u64().unwrap_or(0).max(age);
        s.stats["maxAgeGames"] = max.into();
        if !generation.is_empty() {
            let n = s.stats["generations"][generation].as_u64().unwrap_or(0);
            s.stats["generations"][generation] = (n+1).into();
        }
    });
}

pub fn matches(path: &Path, bytes: &[u8], frozen: &str) -> bool {
    let actual = format!("{:x}", Sha256::digest(bytes));
    let manifest = path.parent().unwrap().join("model29-generation.json");
    if !manifest.exists() {
        return actual == frozen;
    }
    let Ok(bytes) = fs::read(manifest) else {
        return false;
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return false;
    };
    value["model"] == "29.0"
        && value["schemaVersion"] == 1
        && value["assets"][path.file_name().unwrap().to_str().unwrap()].as_str() == Some(&actual)
}

pub fn verify(root: &str) -> Result<String, String> {
    let directory = Path::new(root).join("rust/cribbage-shadow-engine/assets");
    let raw = fs::read(directory.join("model29-generation.json")).map_err(|e| e.to_string())?;
    let manifest: serde_json::Value = serde_json::from_slice(&raw).map_err(|e| e.to_string())?;
    if manifest["model"] != "29.0" || manifest["schemaVersion"] != 1 {
        return Err("invalid Model 29 generation manifest".into());
    }
    let files = manifest["assets"]
        .as_object()
        .ok_or("missing asset manifest")?;
    for name in [
        "model202-board-win-matrix.bin",
        "model203-hold.bin",
        "model203-crib.bin",
        "model203-opponent-discards.bin",
        "model203-decline-factors.json",
        "model1323-corrections.bin",
    ] {
        if !files.contains_key(name) {
            return Err(format!("missing required asset {name}"));
        }
    }
    for (name, expected) in files {
        if Path::new(name).components().count() != 1 || name.starts_with('.') {
            return Err("invalid manifest asset path".into());
        }
        let data = fs::read(directory.join(name)).map_err(|e| e.to_string())?;
        if expected.as_str() != Some(&format!("{:x}", Sha256::digest(&data))) {
            return Err(format!("generation asset changed: {name}"));
        }
    }
    Ok(format!("{:x}", Sha256::digest(&raw)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn manifest_cannot_silently_admit_a_changed_asset() {
        let directory =
            std::env::temp_dir().join(format!("model29-manifest-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("sample.bin");
        let bytes = b"snapshot";
        let digest = format!("{:x}", Sha256::digest(bytes));
        fs::write(
            directory.join("model29-generation.json"),
            serde_json::json!({"model":"29.0","schemaVersion":1,"assets":{"sample.bin":digest}})
                .to_string(),
        )
        .unwrap();
        assert!(matches(&path, bytes, ""));
        assert!(!matches(
            &path,
            b"changed",
            &format!("{:x}", Sha256::digest(b"changed"))
        ));
        fs::remove_dir_all(directory).unwrap();
    }
}
