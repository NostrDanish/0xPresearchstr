/**
 * Tiny safe arithmetic evaluator for instant answers.
 *
 * Handles + - * / % ^ (power), parentheses, unary minus, and decimals —
 * plus the operator symbols people actually type on phones and keyboards:
 * × (U+00D7), ÷ (U+00F7), − (U+2212), and casual x ("8x5" → 8*5).
 * Implemented as a recursive-descent parser — never uses eval().
 *
 * Examples:
 *   "2 + 2"            → 4
 *   "1+2-8×5"          → -37
 *   "(3 + 4) * 5"      → 35
 *   "2^10"             → 1024
 *   "15% of 80"        → 12   (percent-of sugar)
 *   "100 / 7"          → 14.285714…
 */

/**
 * Normalize the operator symbols humans type into ASCII parser tokens:
 *   × → *   ÷ → /   − (U+2212) → -   x/X between operands → *
 */
function normalizeMathInput(input: string): string {
  return input
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/([\d)])\s*[xX]\s*(?=[\d(])/g, '$1*');
}

/** Detect whether a query looks like a pure arithmetic expression. */
export function isMathQuery(query: string): boolean {
  const q = normalizeMathInput(query.trim());
  if (q.length < 3 || q.length > 64) return false;

  // Percent-of sugar: "15% of 80"
  if (/^[\d.]+\s*%\s*of\s*[\d.]+$/i.test(q)) return true;

  // Only arithmetic characters allowed.
  if (!/^[\d\s.+\-*/()%^]+$/.test(q)) return false;
  // Must contain at least one binary operator between digits/parens.
  if (!/\d\s*[+\-*/%^]\s*[\d(]/.test(q) && !/\)\s*[+\-*/%^]/.test(q)) return false;
  // Must contain a digit.
  return /\d/.test(q);
}

/** Evaluate a math query. Returns null when the expression is invalid. */
export function evaluateMath(query: string): number | null {
  const q = normalizeMathInput(query.trim());

  // Percent-of sugar: "15% of 80" → (15 / 100) * 80
  const pctMatch = q.match(/^([\d.]+)\s*%\s*of\s*([\d.]+)$/i);
  if (pctMatch) {
    const pct = parseFloat(pctMatch[1]);
    const base = parseFloat(pctMatch[2]);
    if (Number.isFinite(pct) && Number.isFinite(base)) return (pct / 100) * base;
    return null;
  }

  try {
    const tokens = tokenize(q);
    if (!tokens) return null;
    const parser = new Parser(tokens);
    const value = parser.parseExpression();
    if (parser.peek() !== undefined) return null; // trailing garbage
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return value;
  } catch {
    return null;
  }
}

/** Format the result for display: trim float noise, add thousand separators. */
export function formatMathResult(value: number): string {
  // Round to 10 significant decimals to kill float noise like 0.30000000000000004.
  const rounded = Math.round(value * 1e10) / 1e10;

  if (Number.isInteger(rounded) && Math.abs(rounded) < 1e15) {
    return rounded.toLocaleString('en-US');
  }

  const str = String(rounded);
  // Limit display length for long decimals.
  if (str.replace('-', '').replace('.', '').length > 12) {
    return rounded.toPrecision(10).replace(/\.?0+$/, '');
  }
  return str;
}

/* ─── Internals ─── */

type Token = { type: 'num'; value: number } | { type: 'op'; value: string };

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (ch === ' ') { i++; continue; }

    if (/[\d.]/.test(ch)) {
      let num = '';
      let dots = 0;
      while (i < input.length && /[\d.]/.test(input[i])) {
        if (input[i] === '.') {
          dots++;
          if (dots > 1) return null;
        }
        num += input[i];
        i++;
      }
      if (num === '.') return null;
      tokens.push({ type: 'num', value: parseFloat(num) });
      continue;
    }

    if ('+-*/%^()'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }

    return null; // invalid character
  }

  return tokens.length > 0 ? tokens : null;
}

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token | undefined {
    return this.tokens[this.pos++];
  }

  /** expression := term (('+' | '-') term)* */
  parseExpression(): number {
    let left = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (t?.type === 'op' && (t.value === '+' || t.value === '-')) {
        this.next();
        const right = this.parseTerm();
        left = t.value === '+' ? left + right : left - right;
      } else {
        return left;
      }
    }
  }

  /** term := factor (('*' | '/' | '%') factor)* */
  private parseTerm(): number {
    let left = this.parseFactor();
    for (;;) {
      const t = this.peek();
      if (t?.type === 'op' && (t.value === '*' || t.value === '/' || t.value === '%')) {
        this.next();
        const right = this.parseFactor();
        if (t.value === '*') left *= right;
        else if (t.value === '/') left /= right;
        else left %= right;
      } else {
        return left;
      }
    }
  }

  /** factor := unary ('^' factor)?  — right-associative power */
  private parseFactor(): number {
    const base = this.parseUnary();
    const t = this.peek();
    if (t?.type === 'op' && t.value === '^') {
      this.next();
      const exp = this.parseFactor();
      return Math.pow(base, exp);
    }
    return base;
  }

  /** unary := '-' unary | primary */
  private parseUnary(): number {
    const t = this.peek();
    if (t?.type === 'op' && t.value === '-') {
      this.next();
      return -this.parseUnary();
    }
    if (t?.type === 'op' && t.value === '+') {
      this.next();
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  /** primary := number | '(' expression ')' */
  private parsePrimary(): number {
    const t = this.next();
    if (!t) throw new Error('Unexpected end of expression');

    if (t.type === 'num') return t.value;

    if (t.type === 'op' && t.value === '(') {
      const value = this.parseExpression();
      const closing = this.next();
      if (closing?.type !== 'op' || closing.value !== ')') {
        throw new Error('Missing closing parenthesis');
      }
      return value;
    }

    throw new Error(`Unexpected token: ${t.value}`);
  }
}
