//! Explicit candidate activation, independent of the frozen 28.3 asset loader.
use crate::artifacts::Model1323CorrectionTable;
use serde::Deserialize;
use std::path::Path;

pub(crate) const MANIFEST_ENV: &str = "CRIBBAGE_284_CORRECTIONS_MANIFEST";

pub(crate) fn configured_manifest() -> Option<std::path::PathBuf> {
    std::env::var_os(MANIFEST_ENV)
        .filter(|path| !path.is_empty())
        .map(Into::into)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    schema_version: u32,
    model_version: String,
    asset_sha256: String,
}

pub(crate) fn load(manifest_path: &Path) -> Result<Model1323CorrectionTable, String> {
    let manifest: Manifest = serde_json::from_slice(
        &std::fs::read(manifest_path).map_err(|e| format!("read 28.4 correction manifest: {e}"))?,
    )
    .map_err(|e| format!("parse 28.4 correction manifest: {e}"))?;
    if manifest.schema_version != 1
        || manifest.model_version != "28.4"
        || manifest.asset_sha256.len() != 64
        || !manifest
            .asset_sha256
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        return Err("invalid 28.4 correction manifest".into());
    }
    // These identities are reviewed source inputs, rather than values supplied
    // by the activation manifest. A new evidence snapshot requires code review.
    let pinned: serde_json::Value =
        serde_json::from_str(include_str!("assets/model284-correction-inputs.json"))
            .map_err(|e| format!("invalid pinned 28.4 inputs: {e}"))?;
    let values = pinned["inputChecksums"]
        .as_array()
        .filter(|v| v.len() == 5)
        .ok_or("28.4 requires five pinned input checksums")?;
    let mut checksums = [0; 5];
    for (output, value) in checksums.iter_mut().zip(values) {
        *output = u64::from_str_radix(value.as_str().ok_or("invalid 28.4 input checksum")?, 16)
            .map_err(|e| e.to_string())?;
    }
    Model1323CorrectionTable::load_normalized(
        manifest_path.with_file_name("model284-corrections.bin"),
        &manifest.asset_sha256,
        checksums,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_activation_never_falls_back_on_missing_or_bad_manifest() {
        let path =
            std::env::temp_dir().join(format!("bad-284-manifest-{}.json", std::process::id()));
        assert!(load(&path).is_err());
        for value in [
            r#"{}"#,
            r#"{"schemaVersion":1,"modelVersion":"28.3","assetSha256":"x"}"#,
        ] {
            std::fs::write(&path, value).unwrap();
            assert!(load(&path).is_err());
        }
        std::fs::remove_file(path).unwrap();
    }
}
