/**
 * Tests for the hand-rolled SQLite reader (#24).
 *
 * Runs against `tests/fixtures/overflow.db`, which is committed, and never
 * against the athlete's real export. That is deliberate on two counts: personal
 * training data is not in this repo (ADR-031), and the real file is too SIMPLE
 * to test the reader. Every table in it fits in one or two leaf pages and its
 * widest column is an integer, so two whole code paths -- overflow and interior
 * b-tree pages -- never execute.
 *
 * Both paths had real bugs. Both were found by this fixture on its first run:
 *
 *   1. Interior pages pushed children ascending onto a LIFO stack, so rows came
 *      back in roughly reverse order. 1323 real rows could not show it, and the
 *      verification against the sqlite3 CLI sorted both sides before diffing,
 *      which made it structurally invisible.
 *
 *   2. Overflow was simply unexercised and therefore untrusted.
 *
 * `tests/fixtures/make-overflow-db.sh` regenerates the fixture and documents
 * what is in it. The .db is a binary and cannot be reviewed; the script can.
 *
 * WHAT IS NOT TESTED HERE. Index b-trees, WAL, freelist pages, UTF-16, and
 * anything on the write side. The reader rejects all of them by design, and two
 * of those rejections are asserted below.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SqliteFile, SqliteError } from '../js/storage/sqlite.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/overflow.db', import.meta.url));
const bytes = () => readFileSync(FIXTURE);
const open = () => new SqliteFile(bytes());

/** Body lengths as authored. Row 2 sits under the local limit, row 3 over it. */
const BODY_LENGTHS = [4, 400, 900, 5000, 30000, null];

describe('fixture sanity', () => {
  test('the fixture is a 512-byte-page database', () => {
    const db = open();
    assert.equal(db.pageSize, 512, 'page size changed - regenerate the fixture');
    // 12 RESERVED BYTES, not zero. Apple's system sqlite3 writes them for its
    // own page-level extension, and the committed fixture carries them. That is
    // luck worth keeping: reserved space shrinks the usable area and therefore
    // moves every overflow threshold, so this fixture exercises a path a
    // zero-reserved database would not. The reader reads byte 20 rather than
    // assuming zero, which is why it handled this without a change.
    assert.equal(db.reserved, 12, 'reserved bytes changed - the fixture was regenerated elsewhere');
    assert.equal(db.usable, 500);
  });

  test('every table is found', () => {
    assert.deepEqual(open().tables().sort(), ['big', 'many', 'widths']);
  });
});

describe('overflow payloads reassemble exactly', () => {
  /**
   * The local-payload formula is the part of the format most easily got wrong,
   * and getting it wrong corrupts ONLY the records that overflow while every
   * other record reads correctly. Rows 2 and 3 bracket the threshold.
   */
  test('body lengths are exact from 4 bytes to 30000', () => {
    const rows = open().table('big');
    assert.equal(rows.length, 6);
    assert.deepEqual(
      rows.map((r) => (r.body === null ? null : r.body.length)),
      BODY_LENGTHS
    );
  });

  test('a 30000-byte body spans a long chain and its content survives', () => {
    // Roughly 66 overflow pages at this page size. Asserting the content, not
    // just the length, so a chain that reassembles the right NUMBER of bytes in
    // the wrong ORDER still fails.
    const row = open().table('big').find((r) => r.id === 5);
    assert.equal(row.body.length, 30000);
    assert.match(row.body, /^(ab)+$/, 'overflow pages were concatenated out of order');
  });

  test('the row just over the threshold is not truncated', () => {
    const row = open().table('big').find((r) => r.id === 3);
    assert.equal(row.body.length, 900);
    assert.match(row.body, /^(ab)+$/);
  });
});

describe('b-tree traversal', () => {
  /**
   * The bug this test exists for: children pushed ascending onto a LIFO stack
   * pop descending. `many` holds 400 rows precisely so the table needs interior
   * pages; `big` alone would not.
   */
  test('rows come back in ascending rowid order', () => {
    const db = open();
    for (const name of ['big', 'many', 'widths']) {
      const ids = db.table(name).map((r) => r.id);
      assert.ok(ids.length > 0, `${name}: no rows`);
      assert.deepEqual(ids, [...ids].sort((a, b) => a - b), `${name}: rows are out of rowid order`);
    }
  });

  test('an interior-paged table returns every row exactly once', () => {
    const rows = open().table('many');
    assert.equal(rows.length, 400, 'a page was skipped or visited twice');
    assert.equal(new Set(rows.map((r) => r.id)).size, 400);
    assert.equal(rows[0].v, 'row-1');
    assert.equal(rows[399].v, 'row-400');
  });
});

describe('value decoding', () => {
  test('INTEGER PRIMARY KEY comes from the rowid, not the record', () => {
    // It is stored as NULL in the payload; without the alias every id is null.
    assert.deepEqual(open().table('big').map((r) => r.id), [1, 2, 3, 4, 5, 6]);
  });

  test('every integer serial-type width round-trips, including negatives', () => {
    const expected = [
      0, 1, -1, 127, -128, 32767, -32768,
      8388607, -8388608, 2147483647, -2147483648,
      140737488355327, -140737488355328,
      9007199254740991, -9007199254740991
    ];
    assert.deepEqual(open().table('widths').map((r) => r.v), expected);
  });

  test('reals are exact, and a negative real is not read as an integer', () => {
    const byId = new Map(open().table('big').map((r) => [r.id, r]));
    assert.equal(byId.get(1).f, 1.5);
    assert.equal(byId.get(2).f, -2.25);
    assert.equal(byId.get(3).f, 3.125);
    assert.equal(byId.get(4).f, -4);
    assert.equal(byId.get(5).f, 5.5);
  });

  test('NULL is null, and not confused with 0 or an empty string', () => {
    const row = open().table('big').find((r) => r.id === 6);
    assert.equal(row.body, null);
    assert.equal(row.n, null);
    assert.equal(row.f, null);
  });

  test('short text decodes', () => {
    assert.equal(open().table('big').find((r) => r.id === 1).body, 'tiny');
  });
});

describe('malformed input is refused, never guessed at', () => {
  test('a file that is not SQLite throws', () => {
    const junk = new Uint8Array(1024);
    junk.fill(0x41);
    assert.throws(() => new SqliteFile(junk), SqliteError);
  });

  test('a file too short to hold a header throws', () => {
    assert.throws(() => new SqliteFile(new Uint8Array(64)), SqliteError);
  });

  test('a truncated database throws rather than returning partial rows', () => {
    // Half a file is the shape a failed download or a copy off a phone takes.
    const half = bytes().subarray(0, Math.floor(bytes().length / 2));
    assert.throws(() => {
      const db = new SqliteFile(half);
      for (const name of db.tables()) db.table(name);
    }, SqliteError);
  });

  test('a UTF-16 database is rejected rather than decoded as mojibake', () => {
    const utf16 = Uint8Array.from(bytes());
    new DataView(utf16.buffer, utf16.byteOffset, utf16.byteLength).setUint32(56, 2);
    assert.throws(() => new SqliteFile(utf16), SqliteError);
  });

  test('an unknown table name throws instead of returning nothing', () => {
    // Returning [] would let a schema change read as "no history" (#24).
    assert.throws(() => open().table('no_such_table'), SqliteError);
  });
});

describe('varint decoding', () => {
  test('single-byte values', () => {
    assert.deepEqual(SqliteFile.varint(Uint8Array.from([0x00]), 0), [0, 1]);
    assert.deepEqual(SqliteFile.varint(Uint8Array.from([0x7f]), 0), [127, 1]);
  });

  test('two-byte continuation', () => {
    assert.deepEqual(SqliteFile.varint(Uint8Array.from([0x81, 0x00]), 0), [128, 2]);
  });

  test('the ninth byte contributes all eight bits, not seven', () => {
    // The one case a naive loop gets wrong.
    const buf = Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    const [, next] = SqliteFile.varint(buf, 0);
    assert.equal(next, 9, 'a nine-byte varint did not consume nine bytes');
  });

  test('running off the end of a page throws', () => {
    assert.throws(() => SqliteFile.varint(Uint8Array.from([0x81]), 0), SqliteError);
  });
});
