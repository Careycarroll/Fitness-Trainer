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
    # Stations, named by FUNCTION. `plate_loaded` is gone (#58): it described a
    # loading mechanism, not an implement, and answered no ownership question --
    # "I own a plate-loaded thing" says nothing about what movement it performs.
    # Every station below stays in the `machine` bucket, so no retagged row
    # changes loadType except the pulldown/row rows moving out of `cable`, which
    # is deliberate: a pulldown station IS a machine.
    ("machine",    ("leg_press", "hack_squat", "belt_squat", "leg_extension_machine",
                    "leg_curl_machine", "pec_deck",
                    "back_extension_bench", "calf_machine", "hip_abductor_machine",
                    "captains_chair",
                    "lat_pulldown", "seated_row", "chest_supported_row",
                    "chest_press_machine", "incline_press_machine",
                    "shoulder_press_machine", "lateral_raise_machine",
                    "preacher_curl_machine", "triceps_extension_machine",
                    "ab_crunch_machine", "hip_thrust_machine")),
    ("band",       ("bands",)),
    ("implement",  ("sled", "med_ball", "plate", "ab_wheel", "suspension_trainer",
                    "stability_ball", "slant_board", "landmine", "platform",
                    "dip_belt", "parallettes", "rings", "sandbag")),
    ("bodyweight", ("bodyweight", "pullup_bar", "dip_bar", "box", "bench", "rack")),
]

# STABILITY — an ordinal 1-5, DERIVED from loadType with an override table.
#
#   1 fixed_path    the path is constrained by the machine
#   2 guided        one end is anchored; the arc is partly constrained
#   3 free          bilateral free weight
#   4 independent   each limb loaded separately
#   5 unstable      the support itself moves
#
# ORDINAL rather than categorical, deliberately. `emphasis` failed because five
# categorical values spanning five axes could not be ranked, so no scoring term
# ever read it. A scale can be ranked: a style can say "prefer 3+ for the main
# lift" and score() can act on it.
#
# Measured: loadType alone is correct for 256 of 307 rows. The overrides are the
# three cases where it lies -- a smith machine is `barbell` by loadType and
# fixed-path in reality; rings and suspension are `implement` and the least
# stable rows in the catalog; a landmine is `barbell` and a guided arc.
#
# is_unilateral is NOT consulted: a dumbbell bench press is bilateral and each
# arm still moves independently, which is exactly the property level 4 names.
STABILITY_BY_LOAD_TYPE = {
    "machine": 1,
    "cable": 2,
    "band": 2,
    "barbell": 3,
    "bodyweight": 3,
    "implement": 3,
    "none": 3,
    "dumbbell": 4,
    "kettlebell": 4,
}

# equipment token -> stability, checked BEFORE the loadType table. First match
# in this order wins.
STABILITY_OVERRIDE = [
    (("rings", "suspension_trainer", "stability_ball"), 5),
    (("smith_machine",), 1),
    (("landmine",), 2),
]


def stability_of(load_type: str, equipment: list[str]) -> int:
    have = set(equipment or ())
    for tokens, value in STABILITY_OVERRIDE:
        if have & set(tokens):
            return value
    return STABILITY_BY_LOAD_TYPE.get(load_type, 3)


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

# ADR-009's domain table names three time-domain scoring modes: work/rest
# intervals, rounds, and REPS-FOR-TIME. A compound `reps_only` movement is the
# third one -- "push-ups for 40 seconds" is reps-for-time, not load work -- so
# excluding it from the time domain contradicted the ADR that defined the
# domain. 36 rows were invisible to conditioning as a result (#37).
#
# What deliberately does NOT change:
#   - `scoring` stays "load". It drives the load-domain filter, so flipping it
#     would remove these rows from powerlifting and bodybuilding.
#   - `timeDomain` stays null. These rows' rep columns hold REPS, not seconds;
#     inventing a window from default_rest_sec is exactly the dishonesty the
#     original derivation refused, and that refusal was right. The interval
#     domain prescribes the STYLE's work window for these rows instead of
#     clamping to per-exercise bounds that do not exist.
#
# Isolation rows are excluded deliberately. "40 seconds of band glute kickbacks"
# is not conditioning, and a blanket flip would admit 46 such rows to HIIT
# circuits. Compound-only keeps the rule defensible.
REPS_FOR_TIME_TRACKING = {"reps_only"}


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
    compound = to_bool(row["is_compound"])
    if "skill_gate" not in row:
        sys.exit(f"{slug}: no skill_gate column — data/exercises/*.csv needs the #53 migration")
    gate = (row["skill_gate"] or "").strip() or None
    reps_for_time = tracking in REPS_FOR_TIME_TRACKING and compound

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
        # Muscles that BRACE rather than work through a range (#44). Recorded
        # because it is true, counted at ZERO in weekly volume: bracing under a
        # squat is not ab training and does not drive the hypertrophy the
        # landmarks were measured for.
        #
        # Split from secondary_muscles for 97 rows. `secondaryMuscles` was
        # carrying two meanings -- anatomical involvement on squats and
        # deadlifts, genuine shortening work on rows and presses -- and volume
        # counting needs it to mean one. Abs measured 33 indirect sets in a
        # bodybuilding week, reading over MRV on bracing alone.
        "stabilises": split_tokens(row.get("stabilises", "")),
        "fatigueCost": fatigue,
        "skill": skill,
        "defaultRIR": 2,
        "restSeconds": to_int(row["default_rest_sec"], "default_rest_sec", slug),
        "warmupRequired": fatigue >= 4,
        "unilateral": to_bool(row["is_unilateral"]),
        # SELECTABLE (#63). May the GENERATOR pick this row?
        #
        # The bulk import brings in hundreds of implement variants of lifts the
        # catalog already holds. A dumbbell bench press is not a lesser barbell
        # bench press -- longer ROM, independent limbs, real stabiliser demand --
        # but score() cannot tell them apart, so importing eight bench variants
        # gives the generator eight rows it reads as identical and one more
        # family to penalise.
        #
        # So: the row EXISTS, carries instructions, and is browsable and
        # swappable. The generator skips it until someone promotes it by
        # calibrating fatigue_cost, technical_demand and movement_pattern.
        #
        # EXPLICIT on every row, never blank. to_bool reads blank as False, so a
        # missed cell would silently remove a row from generation -- exactly the
        # silent-drop failure this repo keeps finding.
        "selectable": to_bool(row["selectable"]),
        # ADR-023 anchors percentage prescription on compound + weight_reps +
        # fatigueCost >= 3 + barbell/trap_bar. This column was parsed for
        # repsForTime and then DISCARDED, so the filter was unimplementable and
        # anything written against it silently passed every row (#53).
        "isCompound": compound,
        # ADR-023 names `tracking_type = weight_reps` specifically, and
        # `scoring` cannot express it: weight_reps, weight_distance and
        # reps_only all derive to "load". Carrying isCompound alone left the
        # anchored filter approximate -- a Zercher carry is compound, barbell,
        # fatigueCost 3, and scored "both", so it passed. Nobody has a one-rep
        # max for a carry.
        "trackingType": tracking,
        "scoring": scoring,
        "timeDomain": time_domain,
        "roundsCapable": scoring != "load" or reps_for_time,
        # A non-null timeDomain is no longer the only route into the time
        # domain; see REPS_FOR_TIME_TRACKING above. Check 03 admits the pairing
        # explicitly rather than leaving it implied.
        "repsForTime": reps_for_time,
        "kipAllowed": None,          # non-null iff pattern === "gymnastic" (none)
        # Derived, not hardcoded. This read False for all 300 rows including
        # the 14 conditioning modalities whose pattern IS monostructural, so
        # every setGroup carried `monostructural: false` while its pattern
        # said otherwise. "M7 owns this" was true when the catalog had no
        # such rows; 13_conditioning.csv landed them in #28.
        "monostructural": derive_pattern(row) == "monostructural",
        # AUTHORED, not derived from skill (#53). This read
        # `"olympic-lift" if skill == 5 else None`, which conflated difficulty
        # with gate-worthiness: every skill-5 row was tagged an Olympic lift
        # whatever the movement, and every technical skill-4 row -- power clean,
        # push jerk, Turkish get-up -- was ungated. It held only because all four
        # skill-5 rows happen to BE Olympic lifts. Authoring a ring muscle-up
        # (#58) would have silently declared it an Olympic lift.
        #
        # ADR-012: data REFERENCES a gate, code defines it. Check 04 resolves
        # every reference and fails on a dangling one.
        "skillGate": gate,
        # --- pass-through, authored and already validated (ADR-026) ----------
        # Discarding these at the boundary would make ADR-020's
        # prioritize_joint_load unimplementable.
        "exerciseFamily": row["exercise_family"].strip(),
        "jointLoad": split_tokens(row.get("joint_load", "")),
        # --- variant axes (#63) ------------------------------------------
        #
        # These replace the single `emphasis` column, which held FIVE unrelated
        # axes in one string and was therefore unrankable: `flat` and
        # `stretch_bias` are both true of different rows and cannot be compared.
        # It was also lossy -- an incline curl is long-head biased AND
        # stretch-biased, and one field could only say one.
        #
        # Null means NOT ASSESSED, never "neutral". Check 15 enforces the
        # vocabularies; nothing reads these yet, and that is deliberate --
        # a style-side preference is a separate change with its own before/after.
        "romBias": (row.get("rom_bias") or "").strip() or None,
        "angle": (row.get("angle") or "").strip() or None,
        # GRIP is TWO axes, not one. The single `grip` column conflated width
        # with orientation: chin-up was recorded `close` when a chin-up is
        # roughly shoulder-width and what distinguishes it is SUPINATION — the
        # reason it trains biceps harder than a pull-up. Five rows were misfiled
        # this way and twelve more implied an orientation the column could not
        # hold. Same failure `emphasis` had, one level down.
        "gripWidth": (row.get("grip_width") or "").strip() or None,
        "gripOrientation": (row.get("grip_orientation") or "").strip() or None,
        "headBias": (row.get("head_bias") or "").strip() or None,
        # DERIVED, not authored (ADR-012). See STABILITY below.
        "stability": stability_of(derive_load_type(equipment), equipment),
        "repLow": rep_low,
        "repHigh": rep_high,
        # AUTHORED, one at a time, as good instructional video is found.
        # Blank on every row today. A URL rather than embedded media: nothing is
        # redistributed, the licence question does not arise, and it costs no
        # bytes in the bundle.
        "videoUrl": (row.get("video_url") or "").strip() or None,
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
