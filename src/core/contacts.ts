/**
 * Contact lists for a family group, from each person's Phone and Email fields.
 * Numbers and addresses are picked out of the text so they can be linked and exported.
 */
import { fullName } from './dates';
import type { FamilyGraph, Group, Person } from './types';

const EMAIL = /[^\s,;<>()]+@[^\s,;<>()]+\.[A-Za-z]{2,}/g;
const PHONE = /\+?\(?\d[\d\s().-]{5,}\d/g;

export interface ContactPart {
  text: string;
  kind?: 'email' | 'phone';
}

/** Splits a contact line into plain text, emails and phone numbers, in order. */
export function contactParts(contact: string): ContactPart[] {
  const hits: { start: number; end: number; kind: 'email' | 'phone' }[] = [];
  for (const m of contact.matchAll(EMAIL)) hits.push({ start: m.index!, end: m.index! + m[0].length, kind: 'email' });
  for (const m of contact.matchAll(PHONE)) {
    const start = m.index!, end = start + m[0].trimEnd().length;
    const digits = m[0].replace(/\D/g, '').length;
    if (digits >= 7 && !hits.some((h) => start < h.end && end > h.start)) hits.push({ start, end, kind: 'phone' });
  }
  hits.sort((a, b) => a.start - b.start);
  const out: ContactPart[] = [];
  let at = 0;
  for (const h of hits) {
    if (h.start > at) out.push({ text: contact.slice(at, h.start) });
    out.push({ text: contact.slice(h.start, h.end), kind: h.kind });
    at = h.end;
  }
  if (at < contact.length) out.push({ text: contact.slice(at) });
  return out;
}

/** Moves an older single "Contact" line into the separate phone and email fields. */
export function upgradePerson(p: Person): Person {
  if (!p.contact) return p;
  const { contact, ...rest } = p;
  const parts = contactParts(contact);
  const emails = parts.filter((x) => x.kind === 'email').map((x) => x.text);
  const phones = parts.filter((x) => x.kind === 'phone').map((x) => x.text);
  const leftover = parts.filter((x) => !x.kind).map((x) => x.text).join('').replace(/[\s,;·|/]+/g, ' ').trim();
  return {
    ...rest,
    phone: rest.phone ?? (phones.join(', ') || (emails.length ? undefined : leftover || undefined)),
    email: rest.email ?? (emails.join(', ') || undefined),
  };
}

const split = (v?: string) => (v ?? '').split(/\s*[,;]\s*/).map((x) => x.trim()).filter(Boolean);

export interface ContactRow {
  person: Person;
  name: string;
  emails: string[];
  phones: string[];
}

export interface ContactList {
  rows: ContactRow[];
  /** Members who have died: left off the list. */
  deceased: number;
}

/** Living members of the group, sorted by surname then given name. */
export function contactList(g: FamilyGraph, group: Group): ContactList {
  const people = group.memberIds.map((id) => g.people[id]).filter((p): p is Person => !!p && !p.placeholder);
  const living = people.filter((p) => !p.deathDate);
  const rows = living
    .map(upgradePerson)
    .map((p) => ({ person: p, name: fullName(p), emails: split(p.email), phones: split(p.phone) }))
    .sort(
      (a, b) =>
        (a.person.surname || '~').localeCompare(b.person.surname || '~') || a.person.givenName.localeCompare(b.person.givenName),
    );
  return { rows, deceased: people.length - living.length };
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function contactCsv(list: ContactList): string {
  const lines = [['Name', 'Phone', 'Email']];
  for (const r of list.rows) lines.push([r.name, r.phones.join('; '), r.emails.join('; ')]);
  return lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function contactText(title: string, list: ContactList): string {
  const line = (r: ContactRow) => [...r.phones, ...r.emails].join(' · ') || '(no contact yet)';
  return [title, '', ...list.rows.map((r) => `${r.name}: ${line(r)}`)].join('\n');
}
