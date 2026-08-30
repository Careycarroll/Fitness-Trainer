#!/usr/bin/env python3
"""
seed_instructions.py — write data/exercises/instructions/<slug>.md from
free-exercise-db, for EXACT-tier name matches only.

    python3 tools/seed_instructions.py --dry-run
    python3 tools/seed_instructions.py

ONE-TIME-ISH. Safe to re-run: an existing .md file is NEVER overwritten, so a
hand edit survives a second run and this can be re-run after the review adds
more confirmed pairs.

WHY ONLY THE EXACT TIER

A false match is worse than a miss twice over: it attaches the wrong
instructions to a lift AND suppresses a genuinely new row at import time. The
EXACT tier is the only one safe to apply unattended — identical content tokens
after normalisation, with the equipment veto passing. Everything else
(STRONG/LIKELY/CONFLICT) is a human decision and belongs in the review
workbook, not here.

Measured against the current catalog: 78 of 307 rows match at EXACT.

THE EQUIPMENT VETO READS THE COLUMN, NOT THE NAME

An earlier version of this matcher read implements out of the exercise NAME and
matched `front-squat` to `Front Squats With Two Kettlebells` at EXACT, because
neither name carries an implement word. Both catalogs declare equipment as
data, so the veto reads that instead:

    ours:   ["barbell", "rack"]      -> barbell
    theirs: "kettlebells"            -> kettlebell
    disagree -> VETO, no match

One side blank is NOT disagreement — free-exercise-db leaves `equipment` empty
on 30-odd rows and "other" on many more, and refusing those would drop real
matches. Only two NON-EMPTY, DIFFERENT families veto.

LICENCE

free-exercise-db is Unlicense (public domain dedication), which is what makes
copying instruction prose into this repo lawful. The other three clones in
import-sources/ are NOT: exercises-dataset carries © Gym Visual media, the
wger-derived set has per-exercise licences, and `Exercise Demonstrations` has no
recorded provenance at all. This script reads ONLY free-exercise-db, and each
generated file records its source so the origin is never in doubt.

No third-party dependencies.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "import-sources", "free-exercise-db", "dist", "exercises.json")
SEED = os.path.join(ROOT, "js", "data", "exercises.seed.json")
MD_DIR = os.path.join(ROOT, "data", "exercises", "instructions")

SOURCE_TAG = "free-exercise-db"

# Categories that belong in a strength catalog. `stretching` is M10 and needs an
# ADR before any data lands; `strongman` rows (atlas stones, keg load, car
# deadlift) have no equipment token and no movement pattern; `cardio` and
# `plyometrics` are judgement calls that belong in the review, not here.
KEEP_CATEGORIES = {"strength", "powerlifting", "olympic weightlifting"}

# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------

# Words that carry no identity. `Alternate Hammer Curl` and `hammer-curl` are the
# same movement; `alternate` is a cue. `bench` is deliberately absent — in
# `bench press` it is part of the movement name.
FILLER = {
    "the", "a", "an", "with", "and", "or", "to", "on", "in", "of", "for",
    "alternate", "alternating", "exercise", "version", "variation", "style",
    "medium", "grip",          # "Bench Press - Medium Grip" is a bench press
}

# Spelling and vocabulary differences that are NOT distinctions. Measured across
# both catalogs; anything that changes WHICH muscle or WHICH implement is absent
# here deliberately.
SYNONYM = {
    "pressdown": "pushdown",
    "flye": "fly", "flyes": "fly", "flys": "fly", "flies": "fly",
    "situp": "sit-up", "situps": "sit-up", "sit-ups": "sit-up",
    "pullup": "pull-up", "pullups": "pull-up", "pull-ups": "pull-up",
    "pushup": "push-up", "pushups": "push-up", "push-ups": "push-up",
    "chinup": "chin-up", "chinups": "chin-up", "chin-ups": "chin-up",
    "dumbbells": "dumbbell", "bands": "band", "kettlebells": "kettlebell",
    "barbells": "barbell", "cables": "cable", "machines": "machine",
    "raises": "raise", "curls": "curl", "presses": "press", "rows": "row",
    "extensions": "extension", "squats": "squat", "lunges": "lunge",
    "crunches": "crunch", "dips": "dip", "shrugs": "shrug",
    "pulldowns": "pulldown", "pushdowns": "pushdown", "thrusts": "thrust",
}


def tokens(name: str) -> set[str]:
    flat = re.sub(r"[^a-z0-9\s-]", " ", str(name).lower())
    flat = re.sub(r"\s+", " ", flat).strip()
    out = set()
    for raw in re.split(r"[\s-]+", flat):
        if not raw:
            continue
        raw = SYNONYM.get(raw, raw)
        if raw in FILLER:
            continue
        out.add(raw)
    return out


# ---------------------------------------------------------------------------
# The equipment veto
# ---------------------------------------------------------------------------

# free-exercise-db's 13 coarse values -> a family. "other" and "" are
# deliberately unmapped: they say nothing, so they cannot disagree with anything.
THEIRS_EQUIP = {
    "barbell": "barbell",
    "e-z curl bar": "barbell",
    "dumbbell": "dumbbell",
    "kettlebells": "kettlebell",
    "cable": "cable",
    "machine": "machine",
    "bands": "band",
    "body only": "bodyweight",
    "medicine ball": "implement",
    "exercise ball": "implement",
    "foam roll": "implement",
}

# Our rich token vocabulary -> the same families. First match wins, in this
# order, mirroring LOAD_TYPE_PRECEDENCE in build_seed.py: what is actually
# loading the movement. A barbell bench press needs a bench and a rack, but the
# load is the bar.
OURS_EQUIP = [
    ("barbell", {"barbell", "trap_bar", "safety_bar", "ez_bar", "smith_machine"}),
    ("dumbbell", {"dumbbell"}),
    ("kettlebell", {"kettlebell"}),
    ("cable", {"cable"}),
    ("machine", {
        "leg_press", "hack_squat", "belt_squat", "leg_extension_machine",
        "leg_curl_machine", "pec_deck", "back_extension_bench", "calf_machine",
        "hip_abductor_machine", "captains_chair", "lat_pulldown", "seated_row",
        "chest_supported_row", "chest_press_machine", "incline_press_machine",
        "shoulder_press_machine", "lateral_raise_machine",
        "preacher_curl_machine", "triceps_extension_machine",
        "ab_crunch_machine", "hip_thrust_machine",
    }),
    ("band", {"bands"}),
    ("implement", {
        "sled", "med_ball", "plate", "ab_wheel", "suspension_trainer",
        "stability_ball", "slant_board", "landmine", "platform", "dip_belt",
        "parallettes", "rings", "sandbag",
    }),
    ("bodyweight", {"bodyweight", "pullup_bar", "dip_bar", "box", "bench", "rack"}),
]


def ours_family(equipment: list[str]) -> str | None:
    have = set(equipment or [])
    for family, tokens_ in OURS_EQUIP:
        if have & tokens_:
            return family
    return None


def theirs_family(equipment: str) -> str | None:
    return THEIRS_EQUIP.get((equipment or "").strip().lower())


def vetoed(ours: list[str], theirs: str) -> bool:
    a, b = ours_family(ours), theirs_family(theirs)
    # One side silent is not disagreement.
    return bool(a and b and a != b)


# ---------------------------------------------------------------------------

def load_json(path: str, what: str):
    if not os.path.exists(path):
        sys.exit(f"FAILED to read {what}\n  {path}\n"
                 f"  import-sources/ is gitignored — clone free-exercise-db there first.")
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def render(name: str, steps: list[str]) -> str:
    lines = [f"<!-- source: {SOURCE_TAG} -->", "", f"# {name}", ""]
    for i, step in enumerate(steps, 1):
        lines.append(f"{i}. {step}")
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would be written, write nothing")
    args = ap.parse_args()

    source = load_json(SRC, "free-exercise-db")
    catalog = load_json(SEED, "exercises.seed.json")["exercises"]

    # Index the source by its normalised token set, strength categories only.
    theirs: dict[frozenset, list[dict]] = {}
    for row in source:
        if row.get("category") not in KEEP_CATEGORIES:
            continue
        if not (row.get("instructions") or []):
            continue
        theirs.setdefault(frozenset(tokens(row["name"])), []).append(row)

    os.makedirs(MD_DIR, exist_ok=True)

    written: list[tuple[str, str, int]] = []
    skipped_existing: list[str] = []
    skipped_veto: list[tuple[str, str]] = []
    ambiguous: list[tuple[str, int]] = []
    no_match = 0

    for ex in catalog:
        slug, name = ex["id"], ex["name"]
        path = os.path.join(MD_DIR, f"{slug}.md")

        if os.path.exists(path):
            skipped_existing.append(slug)
            continue

        candidates = theirs.get(frozenset(tokens(name)))
        if not candidates:
            no_match += 1
            continue

        # Equipment must not disagree.
        usable = [c for c in candidates if not vetoed(ex.get("equipment", []), c.get("equipment", ""))]
        if not usable:
            skipped_veto.append((slug, candidates[0]["name"]))
            continue

        # Two source rows normalising to the same tokens AND surviving the veto
        # is not a match, it is a coin toss. Refuse rather than guess.
        if len(usable) > 1:
            ambiguous.append((slug, len(usable)))
            continue

        row = usable[0]
        steps = row["instructions"]
        written.append((slug, row["name"], len(steps)))

        if not args.dry_run:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(render(ex["name"], steps))

    verb = "would write" if args.dry_run else "wrote"
    print(f"--- {verb} {len(written)} instruction file(s)\n")
    for slug, src_name, n in written:
        print(f"    {slug:<34}<- {src_name}  ({n} steps)")

    if skipped_existing:
        print(f"\n--- {len(skipped_existing)} already had a file, left untouched")
    if skipped_veto:
        print(f"\n--- {len(skipped_veto)} refused by the EQUIPMENT VETO "
              f"(name matched, implement did not):")
        for slug, src_name in skipped_veto:
            print(f"    {slug:<34}vs {src_name}")
    if ambiguous:
        print(f"\n--- {len(ambiguous)} refused as AMBIGUOUS "
              f"(several source rows normalise identically):")
        for slug, n in ambiguous:
            print(f"    {slug:<34}{n} candidates")
    print(f"\n--- {no_match} of our rows had no EXACT-tier counterpart. "
          f"They stay text-less until the review pass.")

    if args.dry_run:
        print("\n--- dry run, nothing written. Re-run without --dry-run to apply.")
        return 0

    print("\nnext:  python3 tools/build_instructions.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
