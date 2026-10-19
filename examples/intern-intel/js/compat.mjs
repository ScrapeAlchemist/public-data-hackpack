// Helpers that make JavaScript treat text and numbers the way Python does, so the
// JavaScript and Python versions turn the same pages into the same output, byte for byte.
//
// Where the two languages differ by default:
//   whitespace   Python's str.strip() and regex \s include U+001C-U+001F and U+0085,
//                JavaScript's trim() and \s include U+FEFF instead.
//   line breaks  Python's splitlines() also breaks on \v \f U+001C-U+001E U+0085 U+2028 U+2029.
//   digits       Python's regex \d and float() accept every Unicode decimal digit.
//   \b           Python's word boundary knows Unicode letters, JavaScript's only [A-Za-z0-9_].
//   length       len() counts code points, JavaScript's .length counts UTF-16 units.
//   numbers      repr(float), format(x, '.0f'), json.dumps and csv all format a little differently.
//   URLs         urllib.parse.quote_plus keeps '~' and encodes '*', URLSearchParams does the opposite.

// ---------------------------------------------------------------- whitespace and lines

/** Python's whitespace set (str.isspace() and regex \s), as a regex character-class body. */
export const WS = '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';

export function isSpaceCode(c) {
  return (c >= 0x09 && c <= 0x0d) || (c >= 0x1c && c <= 0x20) || c === 0x85 || c === 0xa0 || c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000;
}

/** Python str.strip() with no argument. */
export function strip(s) {
  let a = 0;
  let b = s.length;
  while (a < b && isSpaceCode(s.charCodeAt(a))) a++;
  while (b > a && isSpaceCode(s.charCodeAt(b - 1))) b--;
  return s.slice(a, b);
}

/** Python str.split() with no argument. */
export function splitWords(s) {
  const out = [];
  let word = '';
  for (let i = 0; i < s.length; i++) {
    if (isSpaceCode(s.charCodeAt(i))) {
      if (word) out.push(word);
      word = '';
    } else {
      word += s[i];
    }
  }
  if (word) out.push(word);
  return out;
}

const LINE_BREAK = new RegExp('\\r\\n|[\\n\\r\\v\\f\\x1c\\x1d\\x1e\\x85\\u2028\\u2029]');

/** Python str.splitlines(): no trailing empty line. */
export function splitLines(s) {
  const lines = s.split(LINE_BREAK);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Python's \w (Unicode letters, numbers and '_'), for building \b look-arounds. */
export const WORD = '[\\p{L}\\p{N}_]';

// ---------------------------------------------------------------- code points

/** Python len(): code points, not UTF-16 units. */
export function cpLen(s) {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** Python s[a:b] for 0 <= a <= b, counted in code points. */
export function cpSlice(s, a, b) {
  return Array.from(s).slice(a, b).join('');
}

// ---------------------------------------------------------------- digits and float()

const ND = /^\p{Nd}$/u;

/** Value 0-9 of a Unicode decimal digit. Unicode assigns them in runs of ten, 0 to 9. */
function digitValue(cp) {
  if (cp >= 0x30 && cp <= 0x39) return cp - 0x30;
  let start = cp;
  while (start > 0 && ND.test(String.fromCodePoint(start - 1))) start--;
  return (cp - start) % 10;
}

/**
 * Python float() for the strings the parsers pass it: Unicode digits plus an optional '.'.
 * Python accepts Arabic-Indic digits ('3.4' written as U+0663 '.' U+0664); Number() would not.
 */
export function pyFloat(s) {
  let ascii = '';
  for (const ch of s) {
    ascii += ND.test(ch) ? String(digitValue(ch.codePointAt(0))) : ch;
  }
  return Number(ascii);
}

/** Python math.floor(), which raises on infinity and NaN instead of passing them through. */
export function pyFloor(x) {
  if (Number.isNaN(x)) throw new RangeError('cannot convert float NaN to integer');
  if (!Number.isFinite(x)) throw new RangeError('cannot convert float infinity to integer');
  return Math.floor(x);
}

// ---------------------------------------------------------------- number formatting

/** str() of a whole number as Python prints an int: every digit, never an exponent. */
function intText(x) {
  return BigInt(x).toString();
}

/** Python repr(float) for a finite float. */
export function floatRepr(x) {
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const sign = x < 0 ? '-' : '';
  const [mant, expText] = Math.abs(x).toExponential().split('e'); // shortest round-trip digits
  const digits = mant.replace('.', '');
  const decpt = Number(expText) + 1; // x = 0.<digits> * 10^decpt
  if (decpt <= -4 || decpt > 16) {
    const e = decpt - 1;
    const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    return `${sign}${m}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
  }
  if (decpt <= 0) return `${sign}0.${'0'.repeat(-decpt)}${digits}`;
  if (decpt >= digits.length) return `${sign}${digits}${'0'.repeat(decpt - digits.length)}.0`;
  return `${sign}${digits.slice(0, decpt)}.${digits.slice(decpt)}`;
}

/**
 * Text of a number the way the Python version writes it after plain_number():
 * whole floats as ints (62.0 -> '62'), everything else as repr(float).
 */
export function numberText(x) {
  return Number.isInteger(x) ? intText(x) : floatRepr(x);
}

/** Python f"{x:.0f}": round half to even on the exact value (toFixed rounds ties up). */
export function fixed0(x) {
  if (!Number.isFinite(x)) return floatRepr(x);
  const f = Math.floor(x);
  const d = x - f; // exact for doubles
  const n = d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1);
  return (n === 0 && (x < 0 || Object.is(x, -0)) ? '-' : '') + intText(n);
}

/** Python f"{x:.1f}" (ties to even; ties only happen at exact quarters like 0.25). */
export function fixed1(x) {
  if (!Number.isFinite(x)) return floatRepr(x);
  if (Number.isInteger(x * 4) && !Number.isInteger(x * 2) && Math.abs(x) < 2 ** 50) {
    const lo = Math.floor(x * 10) / 10;
    const hi = Math.ceil(x * 10) / 10;
    const pick = Math.round(Math.abs(lo) * 10) % 2 === 0 ? lo : hi;
    return pick.toFixed(1);
  }
  return Math.abs(x) >= 1e21 ? `${intText(Math.trunc(x))}.0` : x.toFixed(1);
}

// ---------------------------------------------------------------- JSON and CSV

// One UTF-16 unit at a time, so an emoji becomes two \u escapes, as in Python.
const NON_ASCII_UNITS = new RegExp('[\\x7f-\\uffff]', 'g');

function jsonString(s, ensureAscii) {
  const text = JSON.stringify(s);
  // Python's ensure_ascii=True escapes everything outside ' '..'~', DEL included.
  return ensureAscii ? text.replace(NON_ASCII_UNITS, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`) : text;
}

/** Python json.dumps(value, indent=2, ensure_ascii=ensureAscii) for strings, numbers, lists and dicts. */
export function pyJsonDumps(value, { ensureAscii = true, indent = '  ' } = {}) {
  const enc = (v, cur) => {
    if (v === null || v === undefined) return 'null';
    if (v === true) return 'true';
    if (v === false) return 'false';
    if (typeof v === 'number') {
      if (Number.isNaN(v)) return 'NaN';
      if (!Number.isFinite(v)) return v > 0 ? 'Infinity' : '-Infinity';
      return numberText(v);
    }
    if (typeof v === 'string') return jsonString(v, ensureAscii);
    const inner = cur + indent;
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      return `[\n${v.map((x) => inner + enc(x, inner)).join(',\n')}\n${cur}]`;
    }
    const keys = Object.keys(v);
    if (!keys.length) return '{}';
    return `{\n${keys.map((k) => `${inner}${jsonString(k, ensureAscii)}: ${enc(v[k], inner)}`).join(',\n')}\n${cur}}`;
  };
  return enc(value, '');
}

/** One field as Python's csv.writer (excel dialect, QUOTE_MINIMAL) writes it. */
function csvField(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? numberText(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** Python csv.writer(f, lineterminator="\n").writerow(fields). */
export function csvRow(fields) {
  if (fields.length === 1 && (fields[0] === '' || fields[0] === null || fields[0] === undefined)) return '""\n';
  return `${fields.map(csvField).join(',')}\n`;
}

// ---------------------------------------------------------------- URLs

const ALWAYS_SAFE = new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-~');

/** urllib.parse.quote(s, safe). */
export function quote(s, safe = '/') {
  let out = '';
  for (const b of new TextEncoder().encode(s)) {
    const ch = String.fromCharCode(b);
    out += b < 128 && (ALWAYS_SAFE.has(ch) || safe.includes(ch)) ? ch : `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** urllib.parse.quote_plus(s): spaces become '+'. */
export function quotePlus(s) {
  return s.includes(' ') ? quote(s, ' ').replaceAll(' ', '+') : quote(s, '');
}

/** urllib.parse.urlencode(dict) with string values. */
export function urlencode(pairs) {
  return Object.entries(pairs).map(([k, v]) => `${quotePlus(k)}=${quotePlus(v)}`).join('&');
}

// ---------------------------------------------------------------- repr() for messages

const NOT_PRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;

/** Python repr(str), used only inside error messages. */
export function pyRepr(s) {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (ch === q || ch === '\\') out += `\\${ch}`;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch !== ' ' && NOT_PRINTABLE.test(ch)) {
      const hex = cp.toString(16);
      out += cp < 0x100 ? `\\x${hex.padStart(2, '0')}` : cp < 0x10000 ? `\\u${hex.padStart(4, '0')}` : `\\U${hex.padStart(8, '0')}`;
    } else out += ch;
  }
  return out + q;
}
