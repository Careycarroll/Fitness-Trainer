/**
 * Minimal READ-ONLY SQLite reader (#24).
 *
 * Enough of the file format to read the tables a FitNotes export needs, and
 * deliberately nothing more. No writes, no SQL, no index b-trees, no journal,
 * no WAL, no ALTER, no vacuum. If you need any of those, this is the wrong
 * module and sql.js is the right one.
 *
 * WHY HAND-ROLLED. sql.js is SQLite compiled to WebAssembly: correct, complete,
 * ~1.2MB, and would be this project's first runtime dependency. Reading one
 * known export occasionally does not need a full engine, and the parts of the
 * format that are genuinely hard -- write-ahead logging, index b-trees,
 * incremental vacuum, savepoints -- are all on the write side. Reading table
 * b-trees is a page walk.
 *
 * ---------------------------------------------------------------------------
 * VERIFIED against the sqlite3 CLI on the real export, 2026-08-20.
 *
 * Row counts match on all 24 tables. `training_log` and `exercise` were diffed
 * field by field: 1323 and 149 rows, no differences.
 *
 * The float check is worth describing, because two earlier attempts at it
 * reported false failures. Comparing through TEXT does not work: `sqlite3`
 * prints 15 significant digits by default, so 54.431039999999996 renders as
 * 54.43104, which parses back to a DIFFERENT double. `printf('%.20e')` was no
 * better. The conclusive test writes this reader's values into a temp table and
 * asks SQLite to compare them in double arithmetic:
 *
 *   rows in mine       1323
 *   unmatched ids         0
 *   value mismatches      0
 *
 * So the reader is bit-exact on every stored float. The two apparent
 * discrepancies were the harness, not the parser.
 *
 * Measured from `PRAGMA` output on the same file:
 *
 *   page size          1024
 *   text encoding      UTF-8
 *   page count         110
 *   freelist pages     0
 *   exercise           149 rows   (matches data/fitnotes/fitnotes-mapping.csv)
 *   training_log      1323 rows   (matches the manifest)
 *   Category             8 rows
 *   MeasurementUnit      7 rows
 *
 * STILL UNEXERCISED: the overflow path. Page size 1024 with zero reserved bytes
 * gives a 989-byte local limit, and `training_log`'s widest column is an
 * integer, so nothing in this export comes close. That branch has never run and
 * must be tested against a synthetic database before it is trusted.
 *
 * ENCODING IS ASSERTED, NOT ASSUMED. UTF-16 databases are legal SQLite and this
 * reader rejects them rather than returning mojibake. This export is UTF-8.
 *
 * DECLARED TYPES ARE ADVISORY. `training_log.metric_weight` is declared INTEGER
 * and stores REAL values such as 102.0582. SQLite is dynamically typed; the
 * serial type in each record header is the truth. This reader returns what is
 * stored, not what the column claims.
 *
 * NOTE FOR #24: `training_log` has NO `notes` column. Its columns are
 * _id, exercise_id, date, metric_weight, reps, unit,
 * routine_section_exercise_set_id, timer_auto_start, is_personal_record,
 * is_personal_record_first, is_complete, is_pending_update, distance,
 * duration_seconds. docs/INTERCHANGE.md specifies `notes` on the normalised
 * record; nothing in this table can populate it.
 */

export class SqliteError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SqliteError';
  }
}

const MAGIC = 'SQLite format 3\0';

/** Serial types 0-9 are fixed width; 10 and 11 are reserved and must not appear. */
const FIXED_WIDTH = [0, 1, 2, 3, 4, 6, 8, 8, 0, 0];

export class SqliteFile {
  /** @param {ArrayBuffer|Uint8Array} buffer the whole .fitnotes / .db file */
  constructor(buffer) {
    this.bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);

    if (this.bytes.length < 512) throw new SqliteError('file is too short to be a SQLite database');

    const magic = new TextDecoder('latin1').decode(this.bytes.subarray(0, 16));
    if (magic !== MAGIC) {
      throw new SqliteError('not a SQLite database: the 16-byte magic header does not match');
    }

    // Page size 1 means 65536 -- it does not fit in the two bytes the header
    // allots, so the format encodes it as 1.
    const raw = this.view.getUint16(16);
    this.pageSize = raw === 1 ? 65536 : raw;
    if (this.pageSize < 512 || (this.pageSize & (this.pageSize - 1)) !== 0) {
      throw new SqliteError(`page size ${this.pageSize} is not a power of two >= 512`);
    }

    // Reserved space at the end of every page, used by encryption extensions.
    // It shrinks the usable area, which changes the overflow thresholds, so it
    // is read rather than assumed to be zero.
    this.reserved = this.bytes[20];
    this.usable = this.pageSize - this.reserved;
    if (this.usable < 480) throw new SqliteError('usable page size is implausibly small');

    const encoding = this.view.getUint32(56);
    if (encoding !== 1) {
      throw new SqliteError(
        `text encoding ${encoding} is not UTF-8. This reader does not decode UTF-16 databases ` +
        'rather than returning wrong strings for them.'
      );
    }

    this.pageCount = this.view.getUint32(28) || Math.floor(this.bytes.length / this.pageSize);
  }

  /** One page, 1-indexed as the format numbers them. */
  page(n) {
    if (n < 1 || n > this.pageCount) throw new SqliteError(`page ${n} is outside the database`);
    const start = (n - 1) * this.pageSize;
    if (start + this.pageSize > this.bytes.length) {
      throw new SqliteError(`page ${n} runs past the end of the file (truncated export?)`);
    }
    return this.bytes.subarray(start, start + this.pageSize);
  }

  /**
   * Big-endian varint, 1-9 bytes. The ninth byte contributes all 8 bits rather
   * than 7, which is the one case a naive loop gets wrong.
   *
   * Returns a Number, not a BigInt: rowids and record sizes are far inside the
   * safe range, and returning BigInt would infect every caller.
   */
  static varint(buf, offset) {
    let value = 0;
    for (let i = 0; i < 9; i += 1) {
      const byte = buf[offset + i];
      if (byte === undefined) throw new SqliteError('varint runs past the end of the page');
      if (i === 8) return [value * 256 + byte, offset + 9];
      value = value * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) return [value, offset + i + 1];
    }
    throw new SqliteError('unreachable varint state');
  }

  /**
   * Assemble a cell payload, following the overflow chain when the record does
   * not fit on its page.
   *
   * The local-payload formula is from the format spec and is NOT obvious: a
   * record slightly over the limit keeps `minLocal` bytes on the page rather
   * than `maxLocal`, so b-tree pages stay reasonably full. Getting this wrong
   * corrupts exactly the records that overflow while every other record reads
   * correctly -- a defect that hides until someone's data grows.
   *
   * UNEXERCISED by the FitNotes export: `training_log` has no text column and
   * its widest value is an integer, so nothing approaches the 989-byte local
   * limit. Test this against a synthetic database before trusting it.
   */
  payload(page, offset, totalSize, isLeafTable) {
    const maxLocal = isLeafTable ? this.usable - 35 : ((this.usable - 12) * 64 / 255 | 0) - 23;
    const minLocal = ((this.usable - 12) * 32 / 255 | 0) - 23;

    if (totalSize <= maxLocal) {
      return page.subarray(offset, offset + totalSize);
    }

    const surplus = minLocal + (totalSize - minLocal) % (this.usable - 4);
    const local = surplus > maxLocal ? minLocal : surplus;

    const out = new Uint8Array(totalSize);
    out.set(page.subarray(offset, offset + local), 0);

    let written = local;
    let next = new DataView(page.buffer, page.byteOffset + offset + local, 4).getUint32(0);
    const seen = new Set();

    while (next !== 0 && written < totalSize) {
      if (seen.has(next)) throw new SqliteError('overflow chain loops -- refusing to spin');
      seen.add(next);

      const ov = this.page(next);
      const take = Math.min(this.usable - 4, totalSize - written);
      out.set(ov.subarray(4, 4 + take), written);
      written += take;
      next = new DataView(ov.buffer, ov.byteOffset, 4).getUint32(0);
    }

    if (written !== totalSize) {
      throw new SqliteError(`overflow chain ended early: ${written} of ${totalSize} bytes`);
    }
    return out;
  }

  /** Decode one record body into an array of JS values. */
  record(payload) {
    const [headerSize, afterHeaderSize] = SqliteFile.varint(payload, 0);
    let cursor = afterHeaderSize;
    const serials = [];
    while (cursor < headerSize) {
      const [type, next] = SqliteFile.varint(payload, cursor);
      serials.push(type);
      cursor = next;
    }

    const values = [];
    let body = headerSize;

    for (const type of serials) {
      if (type === 0) { values.push(null); continue; }
      if (type === 8) { values.push(0); continue; }
      if (type === 9) { values.push(1); continue; }
      if (type === 10 || type === 11) {
        throw new SqliteError(`serial type ${type} is reserved and must not appear in a database file`);
      }

      if (type < 10) {
        const width = FIXED_WIDTH[type];
        const slice = payload.subarray(body, body + width);
        body += width;

        if (type === 7) {
          values.push(new DataView(slice.buffer, slice.byteOffset, 8).getFloat64(0));
          continue;
        }

        // Signed big-endian, two's complement, 1-6 or 8 bytes wide.
        //
        // The 8-byte case cannot accumulate with `n * 256 + byte` and subtract
        // afterwards: the unsigned value exceeds Number.MAX_SAFE_INTEGER before
        // the subtraction happens, so the low bits are already lost. BigInt is
        // used for the width where it matters, then narrowed back to Number.
        if (width === 8) {
          const big = new DataView(slice.buffer, slice.byteOffset, 8).getBigInt64(0);
          values.push(Number(big));
          continue;
        }

        let n = 0;
        for (const byte of slice) n = n * 256 + byte;
        const limit = 2 ** (width * 8 - 1);
        values.push(n >= limit ? n - limit * 2 : n);
        continue;
      }

      // >= 12: even is a BLOB, odd is TEXT. Length is (type - 12) / 2 either way.
      const length = (type - (type % 2 === 0 ? 12 : 13)) / 2;
      const slice = payload.subarray(body, body + length);
      body += length;
      values.push(type % 2 === 0 ? new Uint8Array(slice) : new TextDecoder('utf-8').decode(slice));
    }

    return values;
  }

  /**
   * Walk a table b-tree from its root, yielding [rowid, values] per row.
   *
   * Iterative rather than recursive: a deep tree on a large export would risk a
   * stack overflow, and the loop is no harder to read.
   */
  *rows(rootPage) {
    const stack = [rootPage];
    const visited = new Set();

    while (stack.length) {
      const pageNo = stack.pop();
      if (visited.has(pageNo)) throw new SqliteError(`page ${pageNo} is reachable twice -- cycle in the b-tree`);
      visited.add(pageNo);

      const page = this.page(pageNo);
      // Page 1 carries the 100-byte file header before its b-tree header.
      const base = pageNo === 1 ? 100 : 0;
      const type = page[base];

      if (type !== 5 && type !== 13) {
        throw new SqliteError(
          `page ${pageNo} has b-tree type ${type}. Only table pages (5 interior, 13 leaf) are ` +
          'supported; this reader does not walk index b-trees.'
        );
      }

      const cellCount = new DataView(page.buffer, page.byteOffset + base + 3, 2).getUint16(0);

      // The cell-pointer array follows the page header. A LEAF header is 8
      // bytes; an INTERIOR header is 12, the extra four being the rightmost
      // child pointer. Reading an interior page at offset 8 yields two bytes of
      // that pointer as a bogus cell offset.
      const headerSize = type === 5 ? 12 : 8;
      const pointers = base + headerSize;

      if (type === 5) {
        // A LIFO stack pops in REVERSE push order, so children must be pushed
        // descending to be visited ascending. The previous version pushed the
        // rightmost child and then cells 0..n in order, which popped them
        // n..0 -- rows came back roughly reversed.
        //
        // The real export never revealed it: every table fits in one or two
        // leaves and a single leaf is trivially in order. A synthetic table with
        // a 120KB row, needing real interior pages, exposed it at once (#24).
        stack.push(new DataView(page.buffer, page.byteOffset + base + 8, 4).getUint32(0));
        for (let i = cellCount - 1; i >= 0; i -= 1) {
          const cell = new DataView(page.buffer, page.byteOffset + pointers + i * 2, 2).getUint16(0);
          stack.push(new DataView(page.buffer, page.byteOffset + cell, 4).getUint32(0));
        }
        continue;
      }

      for (let i = 0; i < cellCount; i += 1) {
        const cell = new DataView(page.buffer, page.byteOffset + pointers + i * 2, 2).getUint16(0);

        const [size, afterSize] = SqliteFile.varint(page, cell);
        const [rowid, afterRowid] = SqliteFile.varint(page, afterSize);
        yield [rowid, this.record(this.payload(page, afterRowid, size, true))];
      }
    }
  }

  /**
   * The schema table, always rooted at page 1.
   * Columns: type, name, tbl_name, rootpage, sql.
   */
  schema() {
    const out = [];
    for (const [, [type, name, tblName, rootPage, sql]] of this.rows(1)) {
      out.push({ type, name, tblName, rootPage, sql });
    }
    return out;
  }

  /**
   * Column names for a table, parsed from its CREATE statement.
   *
   * Deliberately narrow: it handles the DDL SQLite itself emits, which is what
   * a database file contains. It is not a SQL parser and would not survive
   * arbitrary hand-written DDL.
   */
  columns(createSql) {
    const open = createSql.indexOf('(');
    const close = createSql.lastIndexOf(')');
    if (open < 0 || close < open) throw new SqliteError(`cannot read column list from: ${createSql}`);

    const names = [];
    let depth = 0;
    let current = '';

    for (const char of createSql.slice(open + 1, close)) {
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      // Split on commas at depth 0 only, so DECIMAL(10,2) stays one column.
      if (char === ',' && depth === 0) { names.push(current); current = ''; continue; }
      current += char;
    }
    names.push(current);

    return names
      .map((part) => part.trim())
      .filter((part) => part && !/^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)\b/i.test(part))
      .map((part) => {
        // A quoted name may contain spaces -- "quoted name" INTEGER -- so the
        // quoted form is matched first. Splitting on whitespace and taking the
        // first token silently truncates it.
        const quoted = part.match(/^"((?:[^"]|"")*)"/);
        if (quoted) return quoted[1].replace(/""/g, '"');
        const bracketed = part.match(/^\[([^\]]*)\]/);
        if (bracketed) return bracketed[1];
        const backticked = part.match(/^`((?:[^`]|``)*)`/);
        if (backticked) return backticked[1].replace(/``/g, '`');
        return part.split(/\s+/)[0];
      });
  }

  /** Every row of one table as objects keyed by column name. */
  table(name) {
    const entry = this.schema().find((s) => s.type === 'table' && s.name === name);
    if (!entry) throw new SqliteError(`no table named ${JSON.stringify(name)} in this database`);

    const cols = this.columns(entry.sql);
    const out = [];

    for (const [rowid, values] of this.rows(entry.rootPage)) {
      const row = {};
      cols.forEach((col, i) => { row[col] = values[i] ?? null; });

      // INTEGER PRIMARY KEY is an alias for the rowid and is stored as NULL in
      // the record itself. Without this, _id comes back null on every row.
      const pk = cols.find((c) => new RegExp(`\\b${c}\\b[^,]*INTEGER PRIMARY KEY`, 'i').test(entry.sql));
      if (pk && row[pk] == null) row[pk] = rowid;

      out.push(row);
    }
    return out;
  }

  /** Table names, in the order SQLite stores them. */
  tables() {
    return this.schema()
      .filter((s) => s.type === 'table' && !s.name.startsWith('sqlite_'))
      .map((s) => s.name);
  }
}
