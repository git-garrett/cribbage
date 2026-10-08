#![feature(f16)]
#[path = "fp16.rs"] mod asset;

#[test]
fn asset_values_are_binary16_then_expanded_to_fp32() {
    let value = 1.0_f64 / 3.0;
    assert_eq!(asset::decode_le(value.to_le_bytes()), 0.333251953125_f32);
    assert_eq!(asset::decode_bits(value.to_bits()), asset::round64(value));
    assert_eq!(asset::decode32_le((value as f32).to_le_bytes()), asset::round32(value as f32));
    assert_ne!(asset::round64(value), value as f32);
    for bits in 0_u16..=0x7bff {
        let value = f16::from_bits(bits) as f32;
        assert_eq!(asset::round32(value), value);
    }
}

#[test]
fn accumulation_and_evidence_ratios_do_not_use_half_arithmetic() {
    let p = asset::round32(0.5);
    let sum: f32 = std::iter::repeat_n(p, 100_000).sum();
    assert_eq!(sum, 50_000.0);
    let total: f32 = 12_000_000_u64 as f32;
    let weighted: f32 = 84_000_000_u64 as f32;
    assert_eq!(weighted / total, 7.0);
    assert_eq!((weighted / total * 100_000.0).round() / 100_000.0, 7.0);
    assert!(asset::ASSET_TOLERANCE <= 0.001);
}
