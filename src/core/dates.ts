import type { FuzzyDate, Person } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function yearOf(d?: FuzzyDate): number | undefined {
  if (!d) return undefined;
  const y = parseInt(d.slice(0, 4), 10);
  return Number.isFinite(y) ? y : undefined;
}

/** "1938-11-02" -> "2 Nov 1938", "1938-11" -> "Nov 1938", "1938" -> "1938". */
export function formatFuzzy(d?: FuzzyDate): string {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  if (day && m) return `${parseInt(day, 10)} ${MONTHS[parseInt(m, 10) - 1] ?? ''} ${y}`;
  if (m) return `${MONTHS[parseInt(m, 10) - 1] ?? ''} ${y}`;
  return y ?? '';
}

/** Accepts what people type ("1938", "Nov 1938", "2/11/1938", "1938-11-02") and returns a FuzzyDate or undefined. */
export function parseFuzzy(input: string): FuzzyDate | undefined {
  const s = input.trim();
  if (!s) return undefined;
  let m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(s);
  if (m) return join(m[1], m[2], m[3]);
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s); // day/month/year
  if (m) return join(m[3], m[2], m[1]);
  m = /^(?:(\d{1,2})\s+)?([A-Za-z]{3,})\.?\s+(\d{4})$/.exec(s);
  if (m) {
    const mi = MONTHS.findIndex((x) => m![2].toLowerCase().startsWith(x.toLowerCase()));
    if (mi >= 0) return join(m[3], String(mi + 1), m[1]);
  }
  return undefined;
}

function join(y: string, mo?: string, d?: string): FuzzyDate | undefined {
  const mi = mo ? parseInt(mo, 10) : undefined;
  const di = d ? parseInt(d, 10) : undefined;
  if (mi !== undefined && (mi < 1 || mi > 12)) return undefined;
  if (di !== undefined && (di < 1 || di > 31)) return undefined;
  let out = y;
  if (mi !== undefined) out += '-' + String(mi).padStart(2, '0');
  if (mi !== undefined && di !== undefined) out += '-' + String(di).padStart(2, '0');
  return out;
}

/** Ledger-style lifespan for cards: "1938 – 2019" or "b. 1993". */
export function lifespan(p: Person): string {
  const b = yearOf(p.birthDate);
  const d = yearOf(p.deathDate);
  if (b && d) return `${b} – ${d}`;
  if (d) return `d. ${d}`;
  if (b) return `b. ${b}`;
  return '';
}

export function fullName(p: Pick<Person, 'givenName' | 'surname'> & { middleName?: string }): string {
  return [p.givenName, p.middleName, p.surname].filter(Boolean).join(' ') || 'Unnamed';
}

/** Search: names (given, middle, surname, nickname, birth surname) and birthplace. */
export function personMatches(p: Person, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [p.givenName, p.middleName, p.surname, p.nickname, p.birthSurname, p.birthplace].some((v) => v?.toLowerCase().includes(q));
}

export function initials(p: Pick<Person, 'givenName' | 'surname'>): string {
  return ((p.givenName[0] ?? '') + (p.surname[0] ?? '')).toUpperCase() || '?';
}
