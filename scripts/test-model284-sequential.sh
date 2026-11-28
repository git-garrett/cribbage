#!/usr/bin/env bash
set -euo pipefail
python3 -m unittest scripts/test_model284_sequential.py scripts.test_benchmark_workbench.ConfidenceSequenceTests
node --no-warnings --test scripts/report-paired-live-benchmark.test.cjs
