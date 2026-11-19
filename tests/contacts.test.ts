import { describe, expect, it } from 'vitest';
import { contactCsv, contactList, contactParts, upgradePerson } from '../src/core/contacts';
import type { FamilyGraph } from '../src/core/types';

describe('contactParts', () => {
  it('picks out emails and phone numbers and keeps the rest as text', () => {
    const parts = contactParts('cell (808) 555-0142 · ann.pai@example.com, work +1 808 555 0199');
    expect(parts.filter((p) => p.kind === 'phone').map((p) => p.text)).toEqual(['(808) 555-0142', '+1 808 555 0199']);
    expect(parts.filter((p) => p.kind === 'email').map((p) => p.text)).toEqual(['ann.pai@example.com']);
    expect(parts.map((p) => p.text).join('')).toBe('cell (808) 555-0142 · ann.pai@example.com, work +1 808 555 0199');
  });
  it('does not call a short number a phone', () => {
    expect(contactParts('apt 12').every((p) => !p.kind)).toBe(true);
  });
});

describe('contactList', () => {
  const person = (id: string, givenName: string, surname: string, extra = {}) => ({
    id, givenName, surname, sex: 'unknown' as const, galleryIds: [], audioIds: [], createdAt: 0, updatedAt: 0, ...extra,
  });
  const g: FamilyGraph = {
    people: {
      a: person('a', 'Sherri', 'Pai', { email: 'sherri@example.com, s.pai@example.org' }),
      b: person('b', 'Michael', 'Pai', { phone: '808-555-0100' }),
      c: person('c', 'Grandpa', 'Pai', { deathDate: '2001' }),
      d: person('d', 'Irene', 'Sakoda'),
    },
    parentLinks: {},
    unions: {},
  };
  const group = { id: 'g', name: 'The Pai Family', memberIds: ['a', 'b', 'c', 'd'], color: '#000', createdAt: 0 };
  it('lists living members by surname, leaving out those who have died', () => {
    const list = contactList(g, group);
    expect(list.rows.map((r) => r.name)).toEqual(['Michael Pai', 'Sherri Pai', 'Irene Sakoda']);
    expect(list.deceased).toBe(1);
    expect(list.rows[1].emails).toEqual(['sherri@example.com', 's.pai@example.org']);
    expect(list.rows[0].phones).toEqual(['808-555-0100']);
  });
  it('exports a spreadsheet with email and phone columns', () => {
    const csv = contactCsv(contactList(g, group));
    expect(csv.split('\r\n')[0]).toBe('Name,Phone,Email');
    expect(csv).toContain('Michael Pai,808-555-0100,\r\n');
    expect(csv).toContain('Sherri Pai,,sherri@example.com; s.pai@example.org');
  });
});

describe('upgradePerson', () => {
  const base = { id: 'x', givenName: 'A', surname: 'B', sex: 'unknown' as const, galleryIds: [], audioIds: [], createdAt: 0, updatedAt: 0 };
  it('splits an older Contact line into phone and email', () => {
    const p = upgradePerson({ ...base, contact: '(808) 555-0142 · ann@example.com' });
    expect(p.phone).toBe('(808) 555-0142');
    expect(p.email).toBe('ann@example.com');
    expect(p.contact).toBeUndefined();
  });
  it('keeps text it cannot read as the phone, so nothing is lost', () => {
    expect(upgradePerson({ ...base, contact: 'ask Grandma' }).phone).toBe('ask Grandma');
  });
});
