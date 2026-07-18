#!/usr/bin/env bash
set -euo pipefail

SOURCE_DB="${1:?usage: scripts/build-model16-training-corpus.sh SOURCE_DB OUTPUT_TSV}"
OUTPUT_TSV="${2:?usage: scripts/build-model16-training-corpus.sh SOURCE_DB OUTPUT_TSV}"

if [[ ! -f "$SOURCE_DB" ]]; then
  echo "Missing source database: $SOURCE_DB" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_TSV")"
TEMPORARY="${OUTPUT_TSV}.tmp.$$"
trap 'rm -f "$TEMPORARY"' EXIT

sqlite3 -batch -noheader -separator $'\t' "$SOURCE_DB" "
SELECT
  dealer,
  start_left_score,
  start_right_score,
  cut_card,
  hex(left_dealt),
  hex(right_dealt),
  hex(left_keep),
  hex(right_keep),
  hex(crib)
FROM compact_hands
WHERE dealer IN (0, 1)
  AND start_left_score BETWEEN 0 AND 120
  AND start_right_score BETWEEN 0 AND 120
  AND length(left_dealt) = 6
  AND length(right_dealt) = 6
  AND length(left_keep) = 4
  AND length(right_keep) = 4
  AND length(crib) = 4
  AND cut_card BETWEEN 0 AND 51
ORDER BY game_id, hand_number;
" > "$TEMPORARY"

if [[ ! -s "$TEMPORARY" ]]; then
  echo "Corpus query produced no rows" >&2
  exit 1
fi

mv "$TEMPORARY" "$OUTPUT_TSV"
trap - EXIT
ROWS="$(wc -l < "$OUTPUT_TSV" | tr -d ' ')"
BYTES="$(wc -c < "$OUTPUT_TSV" | tr -d ' ')"
CHECKSUM="$(shasum -a 256 "$OUTPUT_TSV" | awk '{print $1}')"
echo "rows=${ROWS} bytes=${BYTES} sha256=${CHECKSUM} output=${OUTPUT_TSV}"
