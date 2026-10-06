#!/usr/bin/env python3
"""Generate an isolated native-FP16 engine and JSON-only serde boundary."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('fp32_prepare', ROOT / 'experiments/fp32/prepare.py')
fp32 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fp32)


def generate(destination):
    fp32.generate(destination)
    for path in sorted(destination.rglob('*.rs')):
        if path.name == 'fp32.rs':
            path.unlink()
            continue
        text = path.read_text().replace('crate::fp32::', 'crate::fp16::')
        text = text.replace('f32::from_le_bytes(', 'crate::fp16::decode32_le(')
        text = text.replace('f32::from_bits(', 'crate::fp16::decode32_bits(')
        text = text.replace('f32::from(', 'crate::fp16::convert(')
        text = re.sub(r'\bf32\b', 'f16', text)
        text = re.sub(r'(?<=[0-9])_?f32\b', '_f16', text)
        if '.as_secs_f32()' in text:
            text = text.replace('.as_secs_f32()', '.as_secs_f16()')
            text += '\n#[allow(unused_imports)] use crate::fp16::HalfDuration;\n'
        # Decode integer fixed-point likelihoods before FP16 policy arithmetic:
        # their millionths representation itself exceeds binary16's range.
        text = re.sub(r'crate::fp16::convert\(([^()\n;]+)\) / 1_000_000\.0',
                      r'crate::fp16::ratio(\1 as u128, 1_000_000)', text)
        if path.name == 'model.rs':
            text = text.replace('let total_weight = row.moments.total_weight as f16;',
                                'let total_weight = row.moments.total_weight as u128;')
            for numerator in ('weight', 'row.moments.my_weighted_points', 'row.moments.opponent_weighted_points'):
                text = text.replace(f'{numerator} as f16 / total_weight',
                                    f'crate::fp16::ratio({numerator} as u128, total_weight)')
        if path.name == 'model91.rs':
            text = text.replace('let available = *available;\n        Some(',
                'let available = *available;\n        let scale = rows.iter().map(|(_, w)| *w).max().unwrap_or(1);\n        Some(')
            text = text.replace('.map(|(hand, weight)| (*hand, *weight as f16)),',
                '.map(move |(hand, weight)| (*hand, crate::fp16::ratio(*weight as u128 * 16, scale as u128))),')
        if path.name == 'model203_discards.rs':
            text = text.replace('(entry.same_suit as f16 + strength * prior) / (entry.observations as f16 + strength)',
                'crate::fp16::smoothed_rate(entry.same_suit, entry.observations, strength, prior)')
            text = text.replace('entry.observations as f16 + strength > 0.0', 'entry.observations > 0 || strength > 0.0')
            text = text.replace('let n: f16 = evidence.iter().map(|e| e.observations as f16).sum();',
                'let n: u128 = evidence.iter().map(|e| e.observations as u128).sum();')
            text = text.replace('let same: f16 = evidence.iter().map(|e| e.same_suit as f16).sum();',
                'let same: u128 = evidence.iter().map(|e| e.same_suit as u128).sum();')
            text = text.replace('let distinct_n: f16', 'let distinct_n: u128').replace('.map(|(_,e)| e.observations as f16)', '.map(|(_,e)| e.observations as u128)')
            text = text.replace('n <= 0.0 || (overall_rate - same/n)', 'n == 0 || (overall_rate - crate::fp16::ratio(same,n))')
            text = text.replace('(prior - (same+1.0)/(distinct_n+4.0))', '(prior - crate::fp16::ratio(same+1,distinct_n+4))')
            text = text.replace('if entry.same_suit > entry.observations', 'if !expected.is_finite() || entry.same_suit > entry.observations')
        if path.name == 'model283_counting.rs':
            text = text.replace('(4096.0 * f16::EPSILON)', '(128.0 * f16::EPSILON)')
        if path.name in ('model203_discards.rs', 'model203_crib.rs'):
            text = text.replace('128.0 * f16::EPSILON', '16.0 * f16::EPSILON')
        if path.name == 'game.rs':
            text = text.replace('crate::fp16::convert(self.rng_state) / 4_294_967_296.0',
                                'crate::fp16::ratio(self.rng_state as u128, 1_u128 << 32)')
        if path.name == 'model203_crib.rs':
            text = text.replace('(points / total * 100_000.0).round() / 100_000.0', 'points / total')
        if path.name == 'lib.rs':
            text = '#![feature(f16)]\n' + text.replace('mod fp32;', 'mod fp16;')
        if path.parent.name == 'bin' or path.name == 'main.rs':
            text = '#![feature(f16)]\n' + text
        path.write_text(text)
    (destination / 'fp16.rs').write_text('''//! Wider floats occur only at file/JSON/time transport boundaries.
#[inline] pub fn decode_le(bytes: [u8; 8]) -> f16 { f64::from_le_bytes(bytes) as f16 }
#[inline] pub fn decode_bits(bits: u64) -> f16 { f64::from_bits(bits) as f16 }
#[inline] pub fn decode32_le(bytes: [u8; 4]) -> f16 { f32::from_le_bytes(bytes) as f16 }
#[inline] pub fn decode32_bits(bits: u32) -> f16 { f32::from_bits(bits) as f16 }
// Represent exact integer counts as a rounded 11-bit significand and a binary
// scale. Their ratio then uses FP16 division and multiplication exclusively.
fn significand(value: u128) -> (f16, i32) {
    let shift = (128 - value.leading_zeros()).saturating_sub(11);
    let mut top = value >> shift;
    if shift > 0 {
        let rest = value & ((1_u128 << shift) - 1);
        let half = 1_u128 << (shift - 1);
        if rest > half || (rest == half && top & 1 == 1) { top += 1; }
    }
    ((top as u16) as f16, shift as i32)
}
pub fn ratio(numerator: u128, denominator: u128) -> f16 {
    if denominator == 0 { return f16::NAN; }
    if numerator == 0 { return 0.0; }
    let (n, ne) = significand(numerator);
    let (d, de) = significand(denominator);
    let mut value = n / d;
    let mut exponent = ne - de;
    while exponent > 15 { value *= 32768.0; exponent -= 15; }
    while exponent < -14 { value *= 0.00006103515625; exponent += 14; }
    value * f16::from_bits(((exponent + 15) as u16) << 10)
}
// LLVM does not ship this conversion builtin in the pinned Darwin runtime.
// Construct the correctly rounded IEEE binary16 bits without wider floats.
#[no_mangle]
pub extern "C" fn __floatuntihf(value: u128) -> f16 {
    if value == 0 { return 0.0; }
    if value >= 65520 { return f16::INFINITY; }
    let mut exponent = 127 - value.leading_zeros();
    let mut significand = if exponent <= 10 {
        value << (10 - exponent)
    } else {
        let shift = exponent - 10;
        let mut top = value >> shift;
        let rest = value & ((1_u128 << shift) - 1);
        let half = 1_u128 << (shift - 1);
        if rest > half || (rest == half && top & 1 == 1) { top += 1; }
        top
    };
    if significand == 2048 { significand = 1024; exponent += 1; }
    f16::from_bits((((exponent + 15) << 10) | (significand as u32 - 1024)) as u16)
}
pub fn smoothed_rate(same: u64, total: u64, strength: f16, prior: f16) -> f16 {
    if strength == 0.0 { return ratio(same as u128, total as u128); }
    let scale = 1_u128 << (64 - total.leading_zeros()).saturating_sub(10);
    let inverse = ratio(1, scale);
    (ratio(same as u128, scale) + strength * inverse * prior)
        / (ratio(total as u128, scale) + strength * inverse)
}
pub trait IntoFloat { fn into_float(self) -> f16; }
#[inline] pub fn convert<T: IntoFloat>(value: T) -> f16 { value.into_float() }
macro_rules! integer { ($($t:ty),*) => { $(impl IntoFloat for $t {
    #[inline] fn into_float(self) -> f16 { self as f16 }
})* }; }
integer!(u8, u16, u32, u64, u128, usize, i8, i16, i32, i64, isize);
impl IntoFloat for bool { #[inline] fn into_float(self) -> f16 { u8::from(self) as f16 } }
pub trait HalfDuration { fn as_secs_f16(&self) -> f16; }
impl HalfDuration for std::time::Duration {
    fn as_secs_f16(&self) -> f16 { self.as_secs_f32() as f16 }
}
''')
    # Serde has no primitive f16 implementation yet. Add only transport casts
    # to an isolated copy of the pinned serde_core; never change policy math.
    metadata = json.loads(subprocess.check_output([
        'cargo', 'metadata', '--offline', '--format-version=1', '--manifest-path', str(destination / 'Cargo.toml')]))
    package = next(p for p in metadata['packages'] if p['name'] == 'serde_core')
    serde = destination / 'vendor/serde_core'
    shutil.copytree(Path(package['manifest_path']).parent, serde)
    lib = serde / 'src/lib.rs'
    lib.write_text('#![feature(f16)]\n' + lib.read_text())
    with (serde / 'src/ser/impls.rs').open('a') as out:
        out.write('''\nimpl Serialize for f16 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
        serializer.serialize_f32(*self as f32)
    }
}
''')
    with (serde / 'src/de/impls.rs').open('a') as out:
        out.write('''\nimpl_deserialize_num! {
    f16, deserialize_f32
    num_as_self!(f32:visit_f32 f64:visit_f64);
    num_as_self!(i8:visit_i8 i16:visit_i16 i32:visit_i32 i64:visit_i64);
    num_as_self!(u8:visit_u8 u16:visit_u16 u32:visit_u32 u64:visit_u64);
}
''')
    with (destination / 'Cargo.toml').open('a') as out:
        out.write('\n[patch.crates-io]\nserde_core = { path = "vendor/serde_core" }\n')
    subprocess.run(['cargo', 'generate-lockfile', '--offline', '--manifest-path', str(destination / 'Cargo.toml')], check=True)
    hashes = {str(p.relative_to(destination)): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in sorted(destination.rglob('*')) if p.is_file() and p.name != 'precision-manifest.json'}
    (destination / 'precision-manifest.json').write_text(json.dumps(hashes, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    generate(parser.parse_args().destination)
