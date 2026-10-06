#![feature(f16)]
// Copied beside the generated fp16.rs; wider arithmetic is an independent
// test oracle only, never part of the inference executable.
mod fp16;
#[test]
fn integer_conversion_rounds_and_overflows_like_ieee_binary16() {
    for n in 0..=65536_u128 {
        assert_eq!(fp16::__floatuntihf(n).to_bits(), (n as f64 as f16).to_bits(), "{n}");
    }
    for n in [u64::MAX as u128, u128::MAX, 1_u128 << 127] {
        assert!(fp16::__floatuntihf(n).is_infinite());
    }
}
#[test]
fn ratios_handle_exact_large_counts_without_infinity() {
    for (n,d) in [(15505,69637),(1,1_000_000),(14597976,880056130146220),
                  (u128::MAX,u128::MAX),(1_u128<<100,1_u128<<110)] {
        let actual=fp16::ratio(n,d);
        let expected=(n as f64 / d as f64) as f16;
        assert!(actual.is_finite());
        assert!((actual.to_bits() as i32-expected.to_bits() as i32).abs() <= 2);
    }
    assert!(fp16::ratio(1,0).is_nan());
    assert_eq!(fp16::ratio(0,3),0.0);
    assert_eq!(fp16::smoothed_rate(15505,69637,0.0,0.25),fp16::ratio(15505,69637));
}
#[test]
fn arithmetic_really_rounds_at_half_precision() {
    let one=std::hint::black_box(1.0_f16);
    let small=std::hint::black_box(0.0001_f16);
    assert_eq!(one+small,one);
    assert_eq!(std::mem::size_of::<f16>(),2);
}
