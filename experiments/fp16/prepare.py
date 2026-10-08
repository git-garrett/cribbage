#!/usr/bin/env python3
"""Generate Ace with FP16 asset precision and FP32 inference arithmetic."""
import argparse
import hashlib
import importlib.util
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('fp32_prepare', ROOT / 'experiments/fp32/prepare.py')
fp32 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fp32)


def generate(destination):
    fp32.generate(destination)
    # Start from the FP32 engine, never from the pure-FP16 experiment. In
    # particular, preserve counts, normalization, accumulators and comparisons.
    for path in sorted(destination.rglob('*.rs')):
        text = path.read_text()
        if path.name == 'fp32.rs':
            text = text.replace('f64::from_le_bytes(bytes) as f32', 'crate::fp16::decode_le(bytes)')
            text = text.replace('f64::from_bits(bits) as f32', 'crate::fp16::decode_bits(bits)')
            text = text.replace('//! Only FP64 boundary: read the unchanged asset format and round immediately.',
                                '//! Integer conversions remain FP32; asset decoding rounds through FP16.')
        if path.name == 'artifacts.rs':
            text = text.replace('f32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]])',
                                'crate::fp16::decode32_le([slice[0], slice[1], slice[2], slice[3]])')
            text = text.replace('text.parse::<f32>()', 'text.parse::<f32>().map(crate::fp16::round32)')
        # Current Ace's floating JSON calibration is read only by these asset
        # loaders. Integer evidence and fixed-point likelihoods stay exact.
        if path.name in ('model203_discards.rs', 'model20_discards.rs', 'artifacts.rs'):
            text = text.replace('.as_f64().map(|v| v as f32)', '.as_f64().map(crate::fp16::round64)')
        if path.name in ('model203_discards.rs', 'model203_crib.rs', 'model20_discards.rs'):
            # Bound binary16 input rounding, not FP32 computation error. Asset
            # hashes and the original FP64 loader are independently verified.
            text = text.replace('128.0 * f32::EPSILON', 'crate::fp16::ASSET_TOLERANCE')
            text = text.replace('8.0 * f32::EPSILON', 'crate::fp16::ASSET_TOLERANCE')
        if path.name == 'lib.rs':
            text = '#![feature(f16)]\n' + text + '\nmod fp16;\n'
        if path.name == 'decision-worker.rs':
            text = text.replace('response["arithmeticBits"] =',
                                'response["assetBits"] = json!(16);\n        response["arithmeticBits"] =')
        path.write_text(text)
    (destination / 'fp16.rs').write_text('''//! Binary16 asset rounding only. All callers receive FP32 values.
// Expanded CPU caches measure quantization/strength, not packed memory or GPU speed.
pub const ASSET_TOLERANCE: f32 = 1.0 / 1024.0;
#[inline] pub fn round32(value: f32) -> f32 { (value as f16) as f32 }
#[inline] pub fn round64(value: f64) -> f32 { (value as f16) as f32 }
#[inline] pub fn decode_le(bytes: [u8; 8]) -> f32 { round64(f64::from_le_bytes(bytes)) }
#[inline] pub fn decode_bits(bits: u64) -> f32 { round64(f64::from_bits(bits)) }
#[inline] pub fn decode32_le(bytes: [u8; 4]) -> f32 { round32(f32::from_le_bytes(bytes)) }
''')
    subprocess.run(['cargo', 'generate-lockfile', '--offline', '--manifest-path', str(destination / 'Cargo.toml')], check=True)
    hashes = {str(p.relative_to(destination)): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in sorted(destination.rglob('*')) if p.is_file() and p.name != 'precision-manifest.json'}
    (destination / 'precision-manifest.json').write_text(json.dumps(hashes, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    generate(parser.parse_args().destination)
