"""Learning-source eligibility. See docs/adr/0002-exclude-defunct-models-from-learning-data.md."""

import re


def model_version(engine):
    match = re.fullmatch(r"schell_table-peg_table-(\d+(?:\.\d+)+)", engine or "")
    return match.group(1) if match else None


def discard_cohort(engine, historical=False):
    version = model_version(engine)
    major = int(version.split(".")[0]) if version else None
    # Positive eligibility also rejects suffix aliases and unidentified exports.
    if major in (13, 14, 20):
        return "quality"
    if historical and major == 9:
        return "historical-9.x"
    return None
