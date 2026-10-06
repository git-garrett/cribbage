#!/usr/bin/env python3
"""Make an isolated, auditable FP32 engine; never alter production policy sources."""
import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def generate(destination):
    source = ROOT / 'rust/cribbage-shadow-engine'
    destination.mkdir(parents=True, exist_ok=False)
    # Floating point asset formats remain eight-byte on disk. Decoding is the
    # only FP64 operation allowed: convert immediately, before any policy math.
    files = {}
    for path in sorted(source.rglob('*')):
        if not path.is_file() or path.suffix not in ('.rs', '.toml'):
            continue
        relative = path.relative_to(source)
        if 'assets' in relative.parts:
            continue
        original = path.read_text()
        text = original
        if path.suffix == '.rs':
            text = text.replace('f64::from_le_bytes(', 'crate::fp32::decode_le(')
            text = text.replace('f64::from_bits(', 'crate::fp32::decode_bits(')
            text = text.replace('f64::from(', 'crate::fp32::convert(')
            text = re.sub(r'\bf64\b', 'f32', text)
            text = re.sub(r'(?<=[0-9])_?f64\b', '_f32', text)
            text = text.replace('as_secs_f64()', 'as_secs_f32()')
            text = text.replace('.as_f64()', '.as_f64().map(|v| v as f32)')
        # Checks compare rounded FP64 asset probabilities against FP32 sums.
        # Change only validation thresholds, never action comparison/tie rules.
        if path.name in ('model203_discards.rs', 'model203_crib.rs'):
            text = text.replace('1e-12', '(128.0 * f32::EPSILON)').replace('5.1e-9', '(8.0 * f32::EPSILON)')
        if path.name == 'model20_discards.rs':
            text = text.replace('5.1e-9', '(8.0 * f32::EPSILON)')
        if path.name == 'model283_counting.rs':
            text = text.replace('(mass - 1.0).abs() > 1e-10', '(mass - 1.0).abs() > (4096.0 * f32::EPSILON)')
        text = text.replace('{ (128.0 * f32::EPSILON) }', '{ 128.0 * f32::EPSILON }').replace('{ (8.0 * f32::EPSILON) }', '{ 8.0 * f32::EPSILON }')
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
        files[str(relative)] = {'source': hashlib.sha256(original.encode()).hexdigest(),
                                'generated': hashlib.sha256(text.encode()).hexdigest()}
    shutil.copytree(source / 'assets', destination / 'assets', ignore=shutil.ignore_patterns('*.bin', '*.xz'))
    # An independent workspace prevents compiling unrelated applications at FP32.
    with (destination / 'Cargo.toml').open('a') as out:
        out.write('\n[workspace]\n\n[profile.release]\ncodegen-units = 1\nlto = "thin"\n')
    shutil.copyfile(ROOT / 'rust/Cargo.lock', destination / 'Cargo.lock')
    with (destination / 'lib.rs').open('a') as out:
        out.write('\nmod fp32;\n')
    (destination / 'fp32.rs').write_text('''//! Only FP64 boundary: read the unchanged asset format and round immediately.
#[inline] pub fn decode_le(bytes: [u8; 8]) -> f32 { f64::from_le_bytes(bytes) as f32 }
#[inline] pub fn decode_bits(bits: u64) -> f32 { f64::from_bits(bits) as f32 }
pub trait IntoFloat { fn into_float(self) -> f32; }
#[inline] pub fn convert<T: IntoFloat>(value: T) -> f32 { value.into_float() }
macro_rules! integer { ($($t:ty),*) => { $(impl IntoFloat for $t {
    #[inline] fn into_float(self) -> f32 { self as f32 }
})* }; }
integer!(u8, u16, u32, u64, usize, i8, i16, i32, i64, isize);
impl IntoFloat for bool { #[inline] fn into_float(self) -> f32 { u8::from(self) as f32 } }
''')
    for relative in files:
        files[relative]['generated'] = hashlib.sha256((destination / relative).read_bytes()).hexdigest()
    (destination / 'precision-manifest.json').write_text(json.dumps(files, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    generate(parser.parse_args().destination)
