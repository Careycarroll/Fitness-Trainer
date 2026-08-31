#!/usr/bin/env python3
"""
build_images.py — free-exercise-db photos -> public/exercise-images/<slug>/

    python3 tools/build_images.py            # convert what is missing
    python3 tools/build_images.py --force    # reconvert everything
    python3 tools/build_images.py --check    # fail if any expected file is absent

TWO TIERS, and the reason for each.

  <slug>/0.webp, 1.webp    q60, 300px wide. PRECACHED — they join the workbox
                           glob, so the library works offline. ~3.5 KB each.
  <slug>/0.jpg,  1.jpg     the ORIGINAL, byte-for-byte. Loaded on tap only.

The full tier is a straight copy rather than a re-encode: at q95 WebP the output
was LARGER than the source, because the source is already compressed and
near-lossless re-encoding only adds overhead. Copying is both smaller and
unambiguously the original.

WHICH SOURCE ROW SUPPLIED EACH SLUG

Recovered from the instruction files, two ways, in order:

  1. the H1 matches a source name exactly
  2. the FIRST STEP matches a source row's first instruction verbatim

The second exists because tools/seed_instructions.py wrote OUR name as the H1
while later batches wrote the SOURCE's name, so 21 rows have an H1 that matches
nothing. Their text was copied unchanged, so step 1 is an exact fingerprint —
no normalisation, no edit distance, no judgement. Every one of the 21 resolved.

Rows whose instructions are AUTHORED have no source row and no images. That is
the same coverage inversion the instructions had, and there is no authoring
equivalent for a photograph.

No third-party dependencies. Requires cwebp on PATH.
"""

from __future__ import annotations
import argparse, json, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC_JSON = os.path.join(ROOT, "import-sources/free-exercise-db/dist/exercises.json")
SRC_IMG  = os.path.join(ROOT, "import-sources/free-exercise-db/exercises")
MD_DIR   = os.path.join(ROOT, "data/exercises/instructions")
OUT      = os.path.join(ROOT, "public/exercise-images")

THUMB_Q, THUMB_W = 60, 300
H1   = re.compile(r"^# (.+)$", re.M)
STEP = re.compile(r"^1\. (.+)$", re.M)
TAG  = re.compile(r"source:\s*free-exercise-db")


def resolve() -> dict[str, str]:
    """slug -> source row id, for every row whose instructions came from the source."""
    if not os.path.exists(SRC_JSON):
        sys.exit(f"{SRC_JSON} not found; import-sources/ is gitignored — clone it first")
    src = json.load(open(SRC_JSON, encoding="utf-8"))
    by_name = {r["name"]: r for r in src}
    by_step = {}
    for r in src:
        steps = r.get("instructions") or []
        if steps:
            by_step.setdefault(steps[0].strip(), r)

    out, unresolved = {}, []
    for fn in sorted(os.listdir(MD_DIR)):
        if not fn.endswith(".md"):
            continue
        slug = fn[:-3]
        txt = open(os.path.join(MD_DIR, fn), encoding="utf-8").read()
        if not TAG.search(txt):
            continue                      # authored: no source row, no images
        m = H1.search(txt)
        row = by_name.get(m.group(1).strip()) if m else None
        if row is None:
            s = STEP.search(txt)
            row = by_step.get(s.group(1).strip()) if s else None
        if row is None:
            unresolved.append(slug); continue
        if not os.path.isdir(os.path.join(SRC_IMG, row["id"])):
            unresolved.append(f"{slug} (no image dir for {row['id']})"); continue
        out[slug] = row["id"]

    if unresolved:
        print(f"  {len(unresolved)} row(s) carry source text but resolved to no image:")
        for u in unresolved[:10]:
            print(f"      {u}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    if not args.check and shutil.which("cwebp") is None:
        sys.exit("cwebp not on PATH — brew install webp")

    mapping = resolve()
    made = skipped = copied = 0
    missing: list[str] = []
    thumb_bytes = full_bytes = 0

    for slug, src_id in sorted(mapping.items()):
        d = os.path.join(OUT, slug)
        if not args.check:
            os.makedirs(d, exist_ok=True)
        for frame in ("0", "1"):
            jpg = os.path.join(SRC_IMG, src_id, f"{frame}.jpg")
            if not os.path.exists(jpg):
                continue
            webp_out = os.path.join(d, f"{frame}.webp")
            jpg_out  = os.path.join(d, f"{frame}.jpg")

            if args.check:
                for p in (webp_out, jpg_out):
                    if not os.path.exists(p):
                        missing.append(os.path.relpath(p, ROOT))
                continue

            if args.force or not os.path.exists(webp_out):
                r = subprocess.run(
                    ["cwebp", "-q", str(THUMB_Q), "-resize", str(THUMB_W), "0",
                     jpg, "-o", webp_out],
                    capture_output=True, text=True)
                if r.returncode != 0:
                    sys.exit(f"cwebp failed on {jpg}:\n{r.stderr}")
                made += 1
            else:
                skipped += 1

            if args.force or not os.path.exists(jpg_out):
                shutil.copy2(jpg, jpg_out); copied += 1

            thumb_bytes += os.path.getsize(webp_out)
            full_bytes  += os.path.getsize(jpg_out)

    if args.check:
        if missing:
            print(f"FAIL  {len(missing)} image file(s) missing; run `npm run build:images`")
            for m in missing[:10]:
                print(f"        {m}")
            return 1
        print(f"  ok    exercise images present ({len(mapping)} exercises)")
        return 0

    mb = lambda n: f"{n / 1048576:.1f} MB"
    print(f"  {len(mapping)} exercises with images")
    print(f"  thumbnails: {made} converted, {skipped} already present  ->  {mb(thumb_bytes)} PRECACHED")
    print(f"  full size:  {copied} copied                              ->  {mb(full_bytes)} on demand")
    return 0


if __name__ == "__main__":
    sys.exit(main())
