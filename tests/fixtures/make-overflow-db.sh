#!/bin/sh
# Regenerate tests/fixtures/overflow.db (#24).
#
# The committed .db is a binary and therefore unreviewable. This script is the
# reviewable part: it says exactly what is in the fixture and lets anyone
# reproduce it byte for byte.
#
# Usage, from the repo root:
#     sh tests/fixtures/make-overflow-db.sh
#
# WHY THE FIXTURE EXISTS
#
# The real FitNotes export cannot exercise two whole code paths in
# js/storage/sqlite.js:
#
#   1. OVERFLOW. Page size 1024 with no reserved bytes leaves a 989-byte local
#      limit in the real export, and training_log's widest column is an integer.
#      No record comes
#      close, so payload()'s overflow branch never ran against real data.
#
#   2. INTERIOR PAGES. Every table in that export fits in one or two leaf pages,
#      and a single leaf is trivially in rowid order. The b-tree walk had a real
#      ordering bug -- children pushed ascending onto a LIFO stack pop
#      descending -- that 1323 real rows could not reveal, partly because the
#      verification sorted both sides before diffing.
#
# Both bugs surfaced on the first run against a fixture built to be awkward.
#
# WHY page_size 512
#
# It is the format's legal minimum, so the boundary itself gets tested, and it
# shrinks the local payload to 465 bytes. A 30000-byte body then spans about 66
# overflow pages instead of about 30 at page size 1024 -- a longer chain from a
# smaller file.
#
# NOTE ON RESERVED BYTES. Apple's system sqlite3 writes 12 reserved bytes per
# page for its own page-level extension, so usable is 500 rather than 512 and
# the local limit is 465 rather than 477. The committed fixture carries them and
# the tests assert 12, which is deliberate: reserved space moves every overflow
# threshold, so this fixture exercises a path a zero-reserved database does not.
# Regenerating on a build that writes 0 will fail that assertion, which is the
# test telling you the fixture changed rather than a defect.
#
# WHY NOT randomblob
#
# The content must be deterministic or regenerating the fixture produces a
# different file and a meaningless diff. hex(zeroblob(n)) is n*2 characters of
# '0'; replacing each '00' pair with 'ab' yields exactly n*2 characters of
# repeating text, identical on every run.
set -e

out="$(git rev-parse --show-toplevel)/tests/fixtures/overflow.db"
mkdir -p "$(dirname "$out")"
rm -f "$out"

sqlite3 "$out" <<'SQL'
PRAGMA page_size = 512;

CREATE TABLE big (
  id    INTEGER PRIMARY KEY,
  label TEXT,
  body  TEXT,
  n     INTEGER,
  f     REAL
);

-- Row 2 sits just under the local limit; row 3 just over it. Those two
-- bracket the exact threshold where the local-payload formula starts to
-- matter, which is the part of the spec most easily got wrong.
INSERT INTO big VALUES (1, 'short',      'tiny',                                        1, 1.5);
INSERT INTO big VALUES (2, 'just under', replace(hex(zeroblob(200)),  '00', 'ab'),      2, -2.25);
INSERT INTO big VALUES (3, 'just over',  replace(hex(zeroblob(450)),  '00', 'ab'),      3, 3.125);
INSERT INTO big VALUES (4, 'over',       replace(hex(zeroblob(2500)), '00', 'ab'),      4, -4.0);
INSERT INTO big VALUES (5, 'long chain', replace(hex(zeroblob(15000)),'00', 'ab'),      5, 5.5);
INSERT INTO big VALUES (6, 'nulls',      NULL,                                       NULL, NULL);

-- A second table, so tables() has to find more than one root page, and enough
-- rows to force interior pages in a table whose records are all small.
CREATE TABLE many (id INTEGER PRIMARY KEY, v TEXT);
INSERT INTO many (v)
  WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 400)
  SELECT 'row-' || x FROM c;

-- Integer serial-type widths 1..6 and 8, plus the two constants (serial types
-- 8 and 9) that store no bytes at all.
CREATE TABLE widths (id INTEGER PRIMARY KEY, v INTEGER);
INSERT INTO widths (v) VALUES
  (0), (1), (-1), (127), (-128), (32767), (-32768),
  (8388607), (-8388608), (2147483647), (-2147483648),
  (140737488355327), (-140737488355328),
  (9007199254740991), (-9007199254740991);
SQL

echo "wrote $out"
echo
sqlite3 "$out" 'PRAGMA page_size; PRAGMA page_count; PRAGMA encoding;'
echo
sqlite3 "$out" 'SELECT id, label, LENGTH(body), n, f FROM big;'
echo
echo "many:   $(sqlite3 "$out" 'SELECT COUNT(*) FROM many;') rows"
echo "widths: $(sqlite3 "$out" 'SELECT COUNT(*) FROM widths;') rows"
