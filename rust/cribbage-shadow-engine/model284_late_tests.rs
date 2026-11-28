//! Offline candidate contract checks. No production dispatch is enabled.
use crate::board::Role;
use crate::cards::{rank_combination_count, rank_counts_from_key};
use crate::model203_discards::Model203DiscardAsset;
use crate::model91::Model91EmpiricalBeliefs;
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

#[test]
#[ignore = "requires prepared late-game candidate assets and hypothetical panel"]
fn prepared_late_assets_match_native_conditioning_on_hypotheticals() {
    let root = std::env::var("CRIBBAGE_284_LATE_ASSET_ROOT").expect("candidate root required");
    let root = Path::new(&root);
    let manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(manifest["activation"], "disabled");
    assert_eq!(manifest["lateMinimum"], 111);
    for (name, identity) in manifest["assets"].as_object().unwrap() {
        let bytes = fs::read(root.join(name)).unwrap();
        assert_eq!(bytes.len() as u64, identity["bytes"].as_u64().unwrap());
        assert_eq!(
            format!("{:x}", Sha256::digest(bytes)),
            identity["sha256"].as_str().unwrap()
        );
    }
    let broad_h = Model91EmpiricalBeliefs::load_model203(&root.join("broad-hold.bin")).unwrap();
    let late_h = Model91EmpiricalBeliefs::load_model203(&root.join("late-hold.bin")).unwrap();
    let broad_d = Model203DiscardAsset::load(&root.join("broad-discards.bin")).unwrap();
    let late_bytes = fs::read(root.join("late-discards.bin")).unwrap();
    let late_d = Model203DiscardAsset::decode_model284_candidate(&late_bytes).unwrap();
    let mut corrupt = late_bytes.clone();
    *corrupt.last_mut().unwrap() ^= 1;
    assert!(Model203DiscardAsset::decode_model284_candidate(&corrupt).is_err());
    let panel_bytes = fs::read(root.join("hypotheticals.json")).unwrap();
    assert_eq!(
        format!("{:x}", Sha256::digest(&panel_bytes)),
        manifest["hypotheticalsSha256"].as_str().unwrap()
    );
    let panel: serde_json::Value = serde_json::from_slice(&panel_bytes).unwrap();
    let scenarios = panel["scenarios"].as_array().unwrap();
    assert_eq!(scenarios.len(), 256);
    for case in scenarios {
        let role = match case["role"].as_str().unwrap() {
            "dealer" => Role::Dealer,
            "pone" => Role::Pone,
            _ => panic!("invalid role"),
        };
        let keep = rank_counts_from_key(case["keep"].as_str().unwrap()).unwrap();
        let own = rank_counts_from_key(case["ownSix"].as_str().unwrap()).unwrap();
        let truth = rank_counts_from_key(case["discard"].as_str().unwrap()).unwrap();
        let cut = case["cutRank"].as_u64().unwrap() as usize;
        let is_late = case["actorStartScore"].as_u64().unwrap() >= 111;
        assert_eq!(is_late, case["regime"] == "late");
        let discards = if is_late { &late_d } else { &broad_d };
        let weights = discards.conditioned(role, &keep, &own, cut as u8).unwrap();
        assert_eq!(
            weights.len() as u64,
            case["discardSupport"].as_u64().unwrap()
        );
        let mass: f64 = weights.iter().map(|(_, w)| *w).sum();
        let probability = weights.iter().find(|(r, _)| *r == truth).unwrap().1 / mass;
        assert!((probability - case["discardProbability"].as_f64().unwrap()).abs() < 1e-12);
        let beliefs = if is_late { &late_h } else { &broad_h };
        for check in case["hold"].as_array().unwrap() {
            let prefix = rank_counts_from_key(check["prefix"].as_str().unwrap()).unwrap();
            let truth = rank_counts_from_key(check["remaining"].as_str().unwrap()).unwrap();
            let available: [u8; 13] =
                std::array::from_fn(|r| 4 - prefix[r] - own[r] - u8::from(r == cut));
            let baseline: [u8; 13] = std::array::from_fn(|r| 4 - prefix[r]);
            let weights: Vec<_> = beliefs
                .score_block_hands(role, prefix)
                .unwrap()
                .filter_map(|(r, w)| {
                    let combinations = rank_combination_count(&r, &available);
                    (combinations > 0.0)
                        .then(|| (r, w * combinations / rank_combination_count(&r, &baseline)))
                })
                .collect();
            assert_eq!(weights.len() as u64, check["support"].as_u64().unwrap());
            let mass: f64 = weights.iter().map(|(_, w)| *w).sum();
            let p = weights.iter().find(|(r, _)| *r == truth).unwrap().1 / mass;
            assert!((p - check["probability"].as_f64().unwrap()).abs() < 1e-12);
        }
    }
}
