#!/usr/bin/env python3
"""Compile data/fitnotes/fitnotes-mapping.csv into js/data/fitnotes-mapping.json.

Usage:
    python3 tools/build_fitnotes_manifest.py            # write the JSON
    python3 tools/build_fitnotes_manifest.py --check     # verify it matches

WHY THIS EXISTS

The manifest is authored as CSV, which is correct: it is reviewable in-editor,
it diffs sanely, and ADR-016 already makes CSV the authoring surface. But the
browser cannot read it. `js/data/exercises.seed.json` exists for exactly this
reason and this file follows the same path -- authored CSV in, generated JSON
out, `--check` in CI so the committed artifact cannot drift from its source.

WHY RESOLUTION HAPPENS HERE AND NOT IN THE BROWSER

Most manifest rows carry `trainer_name` and leave `trainer_id` blank, so a
display name has to become a catalog slug somewhere. Doing it at build time
means the catalog is available and a name that does NOT resolve FAILS THE BUILD.

That converts a silent runtime failure into a broken `npm run check`. The failure
it prevents is specific: rename a catalog row, and every FitNotes exercise
pointing at the old name would quietly import as unresolved. The sets would
survive -- they land in the review queue rather than being dropped -- but the
athlete's history would go missing from progression with nothing saying why.
ADR-023 computes e1RM from `exerciseId`, so an unresolved row contributes
nothing.

WHY NOT js/engine/defs.js

`defs.js` loads engine definitions. ADR-031 keeps FitNotes identity out of the
engine, and #26's last acceptance criterion is that FitNotes names and ids never
become engine-level identities. The storage layer imports this JSON directly, so
the engine's loader never sees a FitNotes field.

WHAT IS DELIBERATELY NOT RESOLVED

Rows whose `match_tier` is unapproved -- `review`, and anything the manifest does
not authorise -- emit with `exerciseId: null`. They are recorded, not applied.
An early automated pass scored `Incline Barbell Bench Press` against
`Barbell Bench Press` while `Incline Barbell Press` existed, which would have
carried 18 completed sets onto the wrong lift (#33). The 40 review rows carry 0
completed sets between them, so this costs nothing today and is the honest
outcome regardless.
"""
import argparse
import csv
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "fitnotes", "fitnotes-mapping.csv")
SEED = os.path.join(ROOT, "js", "data", "exercises.seed.json")
OUT = os.path.join(ROOT, "js", "data", "fitnotes-mapping.json")

# Tiers a mapping may be APPLIED from. `review` is absent on purpose: see the
# module docstring. Keep this in sync with APPROVED_TIERS in js/storage/fitnotes.js
# -- a mismatch there means the browser applies a tier the build refused to
# resolve, or refuses one the build resolved.
APPROVED_TIERS = frozenset({
    "exact",
    "exact/normalised",
    "alias",
    "alias-manual",
    "token-set",
    "judgement",
})

# Format version for the generated artifact. Bump when the SHAPE below changes,
# and log it in docs/MIGRATIONS.md -- this file ships to the browser and is read
# by js/storage/fitnotes.js, so it is an interchange contract like any other.
FORMAT_VERSION = 1


def load_catalog() -> dict[str, str]:
    """Catalog display name -> slug. Read from the generated seed, not the CSVs.

    The seed is what the app actually ships, so resolving against it means the
    manifest cannot point at an exercise the browser does not have. Reading the
    source CSVs instead would let a stale seed hide a broken mapping.
    """
    if not os.path.exists(SEED):
        sys.exit(f"FAIL  {SEED} does not exist; run tools/build_seed.py first")

    with open(SEED, encoding="utf-8") as fh:
        doc = json.load(fh)

    by_name: dict[str, str] = {}
    for ex in doc["exercises"]:
        by_name[ex["name"]] = ex["id"]
    return by_name


def build() -> dict:
    if not os.path.exists(SRC):
        sys.exit(f"FAIL  {SRC} does not exist")

    by_name = load_catalog()
    by_id = set(by_name.values())

    with open(SRC, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))

    for column in ("fitnotes_id", "fitnotes_name", "trainer_id", "trainer_name",
                   "match_tier", "completed_sets"):
        if column not in (rows[0] if rows else {}):
            sys.exit(f"FAIL  {SRC} has no {column} column")

    out: list[dict] = []
    seen_ids: dict[int, str] = {}
    unresolved: list[str] = []

    for row in rows:
        raw_id = (row["fitnotes_id"] or "").strip()
        if not raw_id:
            sys.exit(f"FAIL  a row has no fitnotes_id: {row['fitnotes_name']!r}")
        try:
            fitnotes_id = int(raw_id)
        except ValueError:
            sys.exit(f"FAIL  non-numeric fitnotes_id {raw_id!r} for {row['fitnotes_name']!r}")

        # Keyed on the numeric id, never the name: FitNotes lets the athlete
        # rename any row, and a name-keyed join is how a renamed row lands its
        # history on a different lift (#33).
        if fitnotes_id in seen_ids:
            sys.exit(f"FAIL  duplicate fitnotes_id {fitnotes_id} "
                     f"({seen_ids[fitnotes_id]!r} and {row['fitnotes_name']!r})")
        seen_ids[fitnotes_id] = row["fitnotes_name"]

        tier = (row["match_tier"] or "").strip()
        trainer_id = (row["trainer_id"] or "").strip()
        trainer_name = (row["trainer_name"] or "").strip()
        sets = int((row["completed_sets"] or "0").strip() or 0)

        exercise_id = None
        if tier in APPROVED_TIERS:
            if trainer_id:
                # An explicit slug still has to exist. A typo here is otherwise
                # a mapping that silently resolves to nothing.
                if trainer_id not in by_id:
                    unresolved.append(
                        f"  fitnotes_id {fitnotes_id} ({row['fitnotes_name']!r}, tier {tier}, "
                        f"{sets} sets): trainer_id {trainer_id!r} is not in the catalog"
                    )
                else:
                    exercise_id = trainer_id
            elif trainer_name:
                resolved = by_name.get(trainer_name)
                if resolved is None:
                    unresolved.append(
                        f"  fitnotes_id {fitnotes_id} ({row['fitnotes_name']!r}, tier {tier}, "
                        f"{sets} sets): trainer_name {trainer_name!r} is not in the catalog"
                    )
                else:
                    exercise_id = resolved
            else:
                unresolved.append(
                    f"  fitnotes_id {fitnotes_id} ({row['fitnotes_name']!r}, tier {tier}, "
                    f"{sets} sets): approved tier with no trainer_id or trainer_name"
                )

        out.append({
            "fitnotesId": fitnotes_id,
            "fitnotesName": row["fitnotes_name"].strip(),
            "exerciseId": exercise_id,
            "tier": tier or None,
            # Carried for the dry-run summary the import screen shows before it
            # commits anything (#24). Authored, so it can be compared against
            # what the database actually yields -- a mismatch means the manifest
            # was built from a different export.
            "completedSets": sets,
        })

    # A single unresolved APPROVED mapping fails the build. Every name here was
    # authorised by a human against a specific issue; if one no longer resolves,
    # either the catalog was renamed or the manifest is wrong, and both need a
    # decision rather than a default.
    if unresolved:
        print(f"FAIL  {len(unresolved)} approved mapping(s) do not resolve against the catalog:")
        for line in unresolved:
            print(line)
        print()
        print("Either the catalog row was renamed -- in which case fix trainer_name in")
        print(f"{os.path.relpath(SRC, ROOT)} -- or the mapping is wrong and needs an issue.")
        sys.exit(1)

    out.sort(key=lambda r: r["fitnotesId"])

    return {
        "formatVersion": FORMAT_VERSION,
        # Provenance, so a stale artifact is identifiable. Not a timestamp:
        # a clock read would make every rebuild a diff and --check meaningless.
        "source": "data/fitnotes/fitnotes-mapping.csv",
        "exercises": out,
    }


def serialize(doc: dict) -> str:
    return json.dumps(doc, indent=2, ensure_ascii=False, sort_keys=False) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true",
                    help="verify the committed JSON matches the CSV; write nothing")
    args = ap.parse_args()

    doc = build()
    text = serialize(doc)
    total = len(doc["exercises"])
    mapped = sum(1 for r in doc["exercises"] if r["exerciseId"])
    sets = sum(r["completedSets"] for r in doc["exercises"])

    if args.check:
        if not os.path.exists(OUT):
            print(f"FAIL  {OUT} does not exist; run tools/build_fitnotes_manifest.py")
            return 1
        current = open(OUT, encoding="utf-8").read()
        if current != text:
            print(f"FAIL  {os.path.relpath(OUT, ROOT)} does not match "
                  f"{os.path.relpath(SRC, ROOT)}; run tools/build_fitnotes_manifest.py")
            return 1
        print(f"  PASS  fitnotes manifest  {total} definitions, {mapped} mapped, {sets} sets")
        return 0

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(text)
    print(f"  wrote {os.path.relpath(OUT, ROOT)}  "
          f"({total} definitions, {mapped} mapped, {sets} completed sets)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
