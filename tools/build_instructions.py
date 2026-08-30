#!/usr/bin/env python3
"""
build_instructions.py — data/exercises/instructions/*.md  ->  js/data/instructions.json

Mirrors tools/build_seed.py (ADR-016: markdown is the authoring surface, JSON is
generated). Same determinism contract, same --check mode, same failure posture.

    python3 tools/build_instructions.py
    python3 tools/build_instructions.py --check     # fail if the committed file is stale

WHY JSON AND NOT THE MARKDOWN ITSELF

vite.config.js precaches `**/*.{js,css,html,json,svg,png,webmanifest}`. Markdown
is NOT in that list, so 868 .md files fetched on demand would break ADR-001 the
moment the app is offline — and adding `md` to the glob would put 868 entries in
the service worker precache manifest, which is its own problem.

So: author markdown, ship JSON. The generated file matches the existing glob and
is precached for free.

WHY NOT IN defs.js

At ~4.3 steps per row the full corpus is roughly 590 KB of text. Loading it in
defs.js means every cold start parses it to render a plan that never shows it.
The UI imports js/data/instructions.json dynamically, on first disclosure open,
so Vite emits it as its own chunk.

DETERMINISM IS THE CONTRACT

Same markdown must always produce byte-identical JSON, or `--check` in CI is
meaningless and the file drifts back into being hand-edited. Slugs are emitted
in sorted order; no dict is iterated without sorting.

AN UNKNOWN SLUG IS A HARD ERROR

An instruction file named for a slug that is not in the catalog is either a typo
or a row that was renamed and left an orphan behind. Both are silent-drop
failures, which is the class AGENTS.md opens with. Same posture as ADR-017's
duplicate-slug rule: fail the build, name the file.

No third-party dependencies.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MD_DIR = os.path.join(ROOT, "data", "exercises", "instructions")
SEED = os.path.join(ROOT, "js", "data", "exercises.seed.json")
OUT = os.path.join(ROOT, "js", "data", "instructions.json")

# The slugs that HAVE text, as a sorted array. ~2 KB.
#
# js/ui/app.js needs to know whether to render a disclosure at all, and
# renderSetGroup is SYNCHRONOUS — it cannot await the lazy chunk. Importing the
# full instructions.json eagerly to answer a yes/no question would put ~250 KB of
# prose on the cold-start path at full coverage. This answers it for 2 KB and
# leaves the prose lazy.
OUT_SLUGS = os.path.join(ROOT, "js", "data", "instruction-slugs.json")

SLUGS_NOTE = (
    "GENERATED FILE — do not edit. Built by tools/build_instructions.py. "
    "The slugs that have instruction text, so the UI can decide whether to "
    "render a disclosure without loading the prose."
)

NOTE = (
    "GENERATED FILE — do not edit. Built from data/exercises/instructions/*.md "
    "by tools/build_instructions.py. Edit the markdown and re-run "
    "`npm run build:instructions`."
)

# A step is a numbered or bulleted line. Everything else — headings, blank
# lines, the source comment — is structure rather than content.
STEP = re.compile(r"^\s*(?:\d+[.)]|[-*+])\s+(.*\S)\s*$")

# `<!-- source: free-exercise-db -->`, so an imported file is distinguishable
# from a hand-authored one without reading the prose. Optional.
SOURCE = re.compile(r"^\s*<!--\s*source:\s*(.+?)\s*-->\s*$")


def parse(path: str) -> tuple[str | None, list[str]]:
    """Return (source, steps) for one markdown file."""
    source: str | None = None
    steps: list[str] = []

    with open(path, encoding="utf-8") as fh:
        for line in fh:
            m = SOURCE.match(line)
            if m:
                source = m.group(1)
                continue
            m = STEP.match(line)
            if m:
                steps.append(m.group(1))

    return source, steps


def catalog_slugs() -> set[str]:
    if not os.path.exists(SEED):
        sys.exit(f"{SEED} does not exist; run `npm run build:seed` first")
    with open(SEED, encoding="utf-8") as fh:
        doc = json.load(fh)
    return {e["id"] for e in doc.get("exercises", [])}


def build() -> dict:
    known = catalog_slugs()
    files = sorted(glob.glob(os.path.join(MD_DIR, "*.md")))

    instructions: dict[str, dict] = {}
    orphans: list[str] = []
    empty: list[str] = []

    for path in files:
        slug = os.path.splitext(os.path.basename(path))[0]

        if slug not in known:
            orphans.append(slug)
            continue

        source, steps = parse(path)
        if not steps:
            empty.append(slug)
            continue

        entry: dict = {"steps": steps}
        if source:
            entry["source"] = source
        instructions[slug] = entry

    if orphans:
        sys.exit(
            "instruction file(s) name a slug that is not in the catalog:\n  "
            + "\n  ".join(f"{s}.md" for s in sorted(orphans))
            + "\nRename the file, or add the row to data/exercises/*.csv."
        )

    if empty:
        sys.exit(
            "instruction file(s) contain no numbered or bulleted steps:\n  "
            + "\n  ".join(f"{s}.md" for s in sorted(empty))
            + "\nA file that parses to nothing is worse than an absent one — it "
              "reads as authored."
        )

    return {
        "schemaVersion": 1,
        "note": NOTE,
        # Sorted, so the same markdown always emits the same bytes.
        "instructions": {k: instructions[k] for k in sorted(instructions)},
    }


def serialize(doc: dict) -> str:
    return json.dumps(doc, indent=2, ensure_ascii=False, sort_keys=False) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="fail if the committed file differs from a fresh build")
    args = ap.parse_args()

    os.makedirs(MD_DIR, exist_ok=True)

    doc = build()
    text = serialize(doc)
    count = len(doc["instructions"])
    steps = sum(len(v["steps"]) for v in doc["instructions"].values())
    size = len(text.encode("utf-8")) / 1024

    slugs_doc = {
        "schemaVersion": 1,
        "note": SLUGS_NOTE,
        "slugs": sorted(doc["instructions"]),
    }
    slugs_text = serialize(slugs_doc)

    if args.check:
        for path, want, label in ((OUT, text, "instructions.json"),
                                  (OUT_SLUGS, slugs_text, "instruction-slugs.json")):
            if not os.path.exists(path):
                print(f"FAIL  {path} does not exist; run tools/build_instructions.py")
                return 1
            if open(path, encoding="utf-8").read() != want:
                print(f"FAIL  {label} is stale — "
                      f"regenerate with `npm run build:instructions`")
                return 1
        print(f"  ok    instructions.json matches source "
              f"({count} exercises, {steps} steps)")
        return 0

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(text)
    with open(OUT_SLUGS, "w", encoding="utf-8") as fh:
        fh.write(slugs_text)
    print(f"  wrote {os.path.relpath(OUT, ROOT)}  "
          f"({count} exercises, {steps} steps, {size:.0f} KB)")
    print(f"  wrote {os.path.relpath(OUT_SLUGS, ROOT)}  ({count} slugs)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
