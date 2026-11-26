/**
 * A tolerant reader for a JSON document that is still arriving (ADR 0054).
 *
 * AG-UI streams a tool call's arguments as string fragments (`TOOL_CALL_ARGS.delta`), and the
 * protocol does not promise that any prefix is a document. This reads the longest meaningful value
 * out of a prefix: open objects and arrays are closed, a key with no value yet is dropped, and a
 * string cut mid-way is kept as far as it got — which is what makes a question stream in letter by
 * letter. The caller learns which values were complete through `isComplete`, so it can refuse to act
 * on a truncated `"1."` where only a whole string will do.
 *
 * Nothing here validates. The result is a partial payload, and partial payloads are never
 * validated (ADR 0019).
 */

export type PartialJson = {
  /** The value read so far; `undefined` when the prefix holds nothing usable yet. */
  value: unknown;
  /**
   * True when the string at `path` (object keys from the root) was read to its closing quote.
   * Paths that do not lead to a string are reported as incomplete.
   */
  isComplete: (path: readonly string[]) => boolean;
};

type Cursor = { text: string; at: number };

class EndOfInput extends Error {}

function skipSpace(cursor: Cursor): void {
  while (cursor.at < cursor.text.length && /\s/.test(cursor.text.charAt(cursor.at))) cursor.at++;
}

/** A value and whether the prefix ended inside it. */
type Read = { value: unknown; cut: boolean };

function readString(cursor: Cursor): Read {
  cursor.at++; // opening quote
  let out = '';
  while (cursor.at < cursor.text.length) {
    const ch = cursor.text.charAt(cursor.at);
    if (ch === '"') {
      cursor.at++;
      return { value: out, cut: false };
    }
    if (ch === '\\') {
      const next = cursor.text.charAt(cursor.at + 1);
      if (next === '') break;
      if (next === 'u') {
        const hex = cursor.text.slice(cursor.at + 2, cursor.at + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(Number.parseInt(hex, 16));
        cursor.at += 6;
        continue;
      }
      const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' };
      out += map[next] ?? next;
      cursor.at += 2;
      continue;
    }
    out += ch;
    cursor.at++;
  }
  cursor.at = cursor.text.length;
  return { value: out, cut: true };
}

function readLiteral(cursor: Cursor): Read {
  const rest = cursor.text.slice(cursor.at);
  const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
  if (number) {
    // A number at the very end of the prefix may still grow (`12` → `125`); it is kept, because
    // a number is never what decides `type@version`.
    cursor.at += number[0].length;
    return { value: Number(number[0]), cut: cursor.at >= cursor.text.length };
  }
  for (const [word, value] of [
    ['true', true],
    ['false', false],
    ['null', null],
  ] as const) {
    if (rest.startsWith(word)) {
      cursor.at += word.length;
      return { value, cut: false };
    }
    if (word.startsWith(rest)) throw new EndOfInput();
  }
  throw new SyntaxError(`Unexpected token at ${cursor.at}`);
}

type Node = { value: unknown; cut: boolean; children?: Map<string, Node> };

function readValue(cursor: Cursor): Node {
  skipSpace(cursor);
  if (cursor.at >= cursor.text.length) throw new EndOfInput();
  const ch = cursor.text.charAt(cursor.at);
  if (ch === '"') return readString(cursor);
  if (ch === '{') return readObject(cursor);
  if (ch === '[') return readArray(cursor);
  return readLiteral(cursor);
}

function readObject(cursor: Cursor): Node {
  cursor.at++;
  const value: Record<string, unknown> = {};
  const children = new Map<string, Node>();
  const node: Node = { value, cut: true, children };
  for (;;) {
    skipSpace(cursor);
    if (cursor.at >= cursor.text.length) return node;
    const ch = cursor.text.charAt(cursor.at);
    if (ch === '}') {
      cursor.at++;
      node.cut = false;
      return node;
    }
    if (ch === ',') {
      cursor.at++;
      continue;
    }
    if (ch !== '"') throw new SyntaxError(`Expected a key at ${cursor.at}`);
    const key = readString(cursor);
    // A key the prefix cut off names nothing yet.
    if (key.cut) return node;
    skipSpace(cursor);
    if (cursor.at >= cursor.text.length) return node;
    if (cursor.text.charAt(cursor.at) !== ':') throw new SyntaxError(`Expected ':' at ${cursor.at}`);
    cursor.at++;
    let child: Node;
    try {
      child = readValue(cursor);
    } catch (error) {
      if (error instanceof EndOfInput) return node;
      throw error;
    }
    value[key.value as string] = child.value;
    children.set(key.value as string, child);
    if (child.cut) return node;
  }
}

function readArray(cursor: Cursor): Node {
  cursor.at++;
  const value: unknown[] = [];
  const node: Node = { value, cut: true };
  for (;;) {
    skipSpace(cursor);
    if (cursor.at >= cursor.text.length) return node;
    const ch = cursor.text.charAt(cursor.at);
    if (ch === ']') {
      cursor.at++;
      node.cut = false;
      return node;
    }
    if (ch === ',') {
      cursor.at++;
      continue;
    }
    let child: Node;
    try {
      child = readValue(cursor);
    } catch (error) {
      if (error instanceof EndOfInput) return node;
      throw error;
    }
    value.push(child.value);
    if (child.cut) return node;
  }
}

/**
 * Reads a JSON prefix. Returns `undefined` for a prefix that is not the start of any JSON
 * document, so a caller can tell "nothing yet" (`value: undefined`) from "never will be".
 */
export function parsePartialJson(text: string): PartialJson | undefined {
  const cursor: Cursor = { text, at: 0 };
  let root: Node | undefined;
  try {
    root = readValue(cursor);
  } catch (error) {
    if (error instanceof EndOfInput) return { value: undefined, isComplete: () => false };
    return undefined;
  }

  // A complete document followed by anything but whitespace is not a prefix of JSON.
  skipSpace(cursor);
  if (!root.cut && cursor.at < cursor.text.length) return undefined;

  const found = root;
  return {
    value: found.value,
    isComplete: (path) => {
      let node: Node | undefined = found;
      for (const key of path) node = node?.children?.get(key);
      return node !== undefined && typeof node.value === 'string' && !node.cut;
    },
  };
}
