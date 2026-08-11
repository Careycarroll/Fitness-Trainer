#!/usr/bin/env python3
"""
build_seed.py — data/exercises/*.csv  ->  js/data/exercises.seed.json

Implements ADR-016 (CSV is the authoring surface, JSON is generated) and the
derivation table in ADR-026 (the engine vocabulary widens to the catalog's).

    python3 tools/build_seed.py
    python3 tools/build_seed.py --check     # verify the committed file matches

Determinism is the contract: the same CSVs must always produce byte-identical
JSON, or `--check` in CI is meaningless and the file drifts back into being
hand-edited. Rows are emitted in (file, row) order; no dicts are iterated
without sorting; floats never appear.

No third-party dependencies.
"""

from __future__ import annotations

import argparse
import csv
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CSV_DIR = os.path.join(ROOT, "data", "exercises")
OUT = os.path.join(ROOT, "js", "data", "exercises.seed.json")

NOTE = (
    "GENERATED FILE — do not edit. Built from data/exercises/*.csv by "
    "tools/build_seed.py (ADR-016, ADR-026). Edit the CSVs and re-run "
    "`npm run build:seed`."
)

# ---------------------------------------------------------------------------
# ADR-026 derivations
# ---------------------------------------------------------------------------

# `loadType` is the FIRST match in this ordered list against the row's
# equipment. Order encodes "what is actually loading the movement": a barbell
# bench press needs a bench and a rack, but the load is the bar.
LOAD_TYPE_PRECEDENCE: list[tuple[str, tuple[str, ...]]] = [
    ("barbell",    ("barbell", "trap_bar", "safety_bar", "ez_bar", "smith_machine")),
    ("dumbbell",   ("dumbbell",)),
    ("kettlebell", ("kettlebell",)),
    ("cable",      ("cable",)),
    ("machine",    ("leg_press", "hack_squat", "belt_squat", "leg_extension_machine",
                    "leg_curl_machine", "plate_loaded", "pec_deck",
                    "back_extension_bench", "calf_machine", "hip_abductor_machine",
                    "captains_chair")),
    ("band",       ("bands",)),
    ("implement",  ("sled", "med_ball", "plate", "ab_wheel", "suspension_trainer",
                    "stability_ball", "slant_board", "landmine", "platform",
                    "dip_belt", "parallettes", "rings", "sandbag")),
    ("bodyweight", ("bodyweight", "pullup_bar", "dip_bar", "box", "bench", "rack")),
]

# Families that are unilateral-stance quad work rather than bilateral squatting.
# ADR-026 §3: `lunge` is DERIVED here, never authored. No CSV row is edited.
LUNGE_FAMILIES = {"lunge", "split_squat", "step_up"}

# scoring:
#   weight_reps / weight_distance / reps_only -> "load"  (timeDomain null)
#   time / time_load                          -> "both"  (timeDomain from the
#                                                         rep columns, which
#                                                         hold SECONDS on
#                                                         these rows)
#
# reps_only is load-domain deliberately. Check 03 enforces
# scoring === "load" <=> timeDomain === null, and a push-up has no honest time
# bounds: its default_rep_low/high are reps. Inventing a window from
# default_rest_sec would make check 03 pass on a fabricated number.
#
# Accepted consequence: roundsCapable is false for bodyweight rep work, so
# push-ups cannot appear in an AMRAP until M7 gives the interval domain a
# rep-based rounds model.
TIME_TRACKING = {"time", "time_load"}
LOAD_TRACKING = {"weight_reps", "weight_distance", "reps_only"}


def split_tokens(value: str) -> list[str]:
    return [t.strip() for t in (value or "").split("|") if t.strip()]


def to_bool(value: str) -> bool:
    return (value or "").strip().upper() == "TRUE"


def to_int(value: str, field: str, slug: str) -> int:
    try:
        return int((value or "").strip())
    except ValueError:
        sys.exit(f"{slug}: {field} is not an integer ({value!r})")


def derive_load_type(equipment: list[str]) -> str:
    owned = set(equipment)
    for load_type, tokens in LOAD_TYPE_PRECEDENCE:
        if owned.intersection(tokens):
            return load_type
    return "none"


def derive_pattern(row: dict) -> str:
    if row["exercise_family"].strip() in LUNGE_FAMILIES:
        return "lunge"
    return row["movement_pattern"].strip()


def build_record(row: dict, source: str) -> dict:
    slug = row["slug"].strip()
    tracking = row["tracking_type"].strip()
    equipment = split_tokens(row["equipment"])
    fatigue = to_int(row["fatigue_cost"], "fatigue_cost", slug)
    skill = to_int(row["technical_demand"], "technical_demand", slug)
    rep_low = to_int(row["default_rep_low"], "default_rep_low", slug)
    rep_high = to_int(row["default_rep_high"], "default_rep_high", slug)

    if tracking in TIME_TRACKING:
        scoring = "both"
        # On time-tracked rows the rep columns hold seconds by authoring
        # convention (plank 30-90, farmer's carry 30-60). Check 03 requires
        # 0 < min < max, so a degenerate row is a data error, not a clamp.
        if not 0 < rep_low < rep_high:
            sys.exit(f"{slug}: time-tracked row needs 0 < rep_low < rep_high "
                     f"(got {rep_low}, {rep_high}) — these columns are seconds")
        time_domain = {"minSeconds": rep_low, "maxSeconds": rep_high}
    elif tracking in LOAD_TRACKING:
        scoring = "load"
        time_domain = None
    else:
        sys.exit(f"{slug}: unmapped tracking_type {tracking!r}")

    return {
        "id": slug,
        "name": row["name"].strip(),
        "pattern": derive_pattern(row),
        "loadType": derive_load_type(equipment),
        "equipment": equipment,
        "primaryMuscles": split_tokens(row["primary_muscles"]),
        "secondaryMuscles": split_tokens(row["secondary_muscles"]),
        "fatigueCost": fatigue,
        "skill": skill,
        "defaultRIR": 2,
        "restSeconds": to_int(row["default_rest_sec"], "default_rest_sec", slug),
        "warmupRequired": fatigue >= 4,
        "unilateral": to_bool(row["is_unilateral"]),
        "scoring": scoring,
        "timeDomain": time_domain,
        "roundsCapable": scoring != "load",
        "kipAllowed": None,          # non-null iff pattern === "gymnastic" (none)
        "monostructural": False,     # load-domain catalog; M7 owns this
        "skillGate": "olympic-lift" if skill == 5 else None,
        # --- pass-through, authored and already validated (ADR-026) ----------
        # Discarding these at the boundary would make ADR-020's
        # prioritize_joint_load unimplementable.
        "exerciseFamily": row["exercise_family"].strip(),
        "jointLoad": split_tokens(row.get("joint_load", "")),
        "emphasis": (row.get("emphasis") or "").strip() or None,
        "repLow": rep_low,
        "repHigh": rep_high,
        "sourceFile": source,
    }


def build() -> dict:
    files = sorted(glob.glob(os.path.join(CSV_DIR, "[0-9][0-9]_*.csv")))
    if not files:
        sys.exit(f"no CSVs found in {CSV_DIR}")

    exercises: list[dict] = []
    seen: dict[str, str] = {}

    for path in files:
        source = os.path.basename(path)
        with open(path, newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                if not (row.get("slug") or "").strip():
                    continue
                record = build_record(row, source)
                if record["id"] in seen:
                    sys.exit(f"duplicate slug {record['id']!r} in {source} "
                             f"(already in {seen[record['id']]}) — ADR-017")
                seen[record["id"]] = source
                exercises.append(record)

    return {"schemaVersion": 1, "note": NOTE, "exercises": exercises}


def serialize(doc: dict) -> str:
    return json.dumps(doc, indent=2, ensure_ascii=False, sort_keys=False) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="fail if the committed file differs from a fresh build")
    args = ap.parse_args()

    text = serialize(build())
    count = text.count('"id":')

    if args.check:
        if not os.path.exists(OUT):
            print(f"FAIL  {OUT} does not exist; run tools/build_seed.py")
            return 1
        current = open(OUT, encoding="utf-8").read()
        if current != text:
            print("FAIL  exercises.seed.json is stale — "
                  "regenerate with `npm run build:seed`")
            return 1
        print(f"  ok    exercises.seed.json matches source ({count} exercises)")
        return 0

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(text)
    print(f"  wrote {os.path.relpath(OUT, ROOT)}  ({count} exercises)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
