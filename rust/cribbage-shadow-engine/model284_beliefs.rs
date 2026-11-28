//! Opt-in benchmark beliefs. Production Ace never selects these profiles.
use crate::model1323::PolicyAssets;
use sha2::{Digest, Sha256};
use std::{fs, path::{Path, PathBuf}};

pub(crate) fn configured_manifest() -> Option<PathBuf> {
    std::env::var_os("CRIBBAGE_284_BELIEFS_MANIFEST")
        .filter(|v| !v.is_empty()).map(PathBuf::from)
}

pub(crate) fn segment(scores: Option<[i32; 2]>) -> Result<usize, String> {
    let [dealer, pone] = scores.ok_or("28.4 segmented beliefs require public hand-start scores")?;
    if !(0..121).contains(&dealer) || !(0..121).contains(&pone) {
        return Err("invalid 28.4 hand-start scores".into());
    }
    Ok(usize::from(dealer > 109) + 2 * usize::from(pone > 111))
}

pub(crate) fn load(directory: &Path) -> Result<Vec<PolicyAssets>, String> {
    let manifest = configured_manifest().ok_or("missing 28.4 belief manifest")?;
    let parent = manifest.parent().ok_or("invalid belief manifest path")?;
    let body = fs::read(&manifest).map_err(|e| e.to_string())?;
    let expected = std::env::var("EXPECTED_BELIEFS_MANIFEST_SHA256")
        .map_err(|_| "28.4 belief manifest requires a pinned checksum")?;
    if expected != format!("{:x}", Sha256::digest(&body)) {
        return Err("28.4 belief manifest checksum mismatch".into());
    }
    let value: serde_json::Value = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
    if value["schemaVersion"] != 1 || value["dealerLastEarly"] != 109
        || value["poneLastEarly"] != 111 || value["regimeScore"] != "hand-start"
        || value["profiles"].as_array().map(Vec::len) != Some(4) {
        return Err("incompatible 28.4 belief routing/provenance".into());
    }
    let mut assets = Vec::new();
    for (index, profile) in value["profiles"].as_array().unwrap().iter().enumerate() {
        if profile["index"] != index || profile["dealerLate"] != (index & 1 != 0)
            || profile["poneLate"] != (index & 2 != 0) {
            return Err("28.4 belief profile order mismatch".into());
        }
        let checked = |kind: &str| -> Result<PathBuf, String> {
            let name = profile[kind]["file"].as_str().ok_or("missing belief filename")?;
            if Path::new(name).components().count() != 1 || name.starts_with('.') {
                return Err("invalid belief filename".into());
            }
            let path = parent.join(name);
            let bytes = fs::read(&path).map_err(|e| e.to_string())?;
            if profile[kind]["sha256"] != format!("{:x}", Sha256::digest(&bytes)) {
                return Err("28.4 belief asset checksum mismatch".into());
            }
            Ok(path)
        };
        let hold = checked("hold")?;
        let discard = fs::read(checked("discards")?).map_err(|e| e.to_string())?;
        assets.push(PolicyAssets::with_model284_beliefs(directory, &hold, &discard)?);
    }
    Ok(assets)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn role_boundaries_are_independent_and_require_hand_start_scores() {
        assert_eq!(segment(Some([109, 111])).unwrap(), 0);
        assert_eq!(segment(Some([110, 111])).unwrap(), 1);
        assert_eq!(segment(Some([109, 112])).unwrap(), 2);
        assert_eq!(segment(Some([120, 120])).unwrap(), 3);
        assert!(segment(None).is_err());
        assert!(segment(Some([-1, 10])).is_err());
        assert!(segment(Some([10, 121])).is_err());
    }
}
