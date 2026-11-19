/**
 * Family groups: named sets of people ("The Ashby Family", "Mum's side").
 * One group can be the main family, which titles the archive. A shown group gets a
 * box drawn around its members on the tree.
 */
import { CARD_H, CARD_W, type Point } from './layout';
import type { FamilyGraph, Group, Id } from './types';

/** Herbarium inks for group boxes, in the order new groups take them. */
export const GROUP_COLORS = ['#3E6B48', '#A9566B', '#4F6D8A', '#8A6A4A', '#B08A2E', '#6E4F7A'];

export function groupList(g: FamilyGraph): Group[] {
  return Object.values(g.groups ?? {}).sort((a, b) => Number(!!b.core) - Number(!!a.core) || a.createdAt - b.createdAt);
}

export function coreGroup(g: FamilyGraph): Group | undefined {
  return Object.values(g.groups ?? {}).find((x) => x.core);
}

/** The archive's title: the main family group's name, else "The <most common surname> Family". */
export function familyTitle(g: FamilyGraph): string {
  const core = coreGroup(g);
  if (core?.name.trim()) return core.name.trim();
  const counts = new Map<string, number>();
  for (const p of Object.values(g.people)) if (p.surname && !p.placeholder) counts.set(p.surname, (counts.get(p.surname) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  return top ? `The ${top} Family` : 'Our Family';
}

/** A suggested name for a new group built around someone: "The Ashby Family". */
export function suggestGroupName(g: FamilyGraph, memberIds: Id[]): string {
  const surname = memberIds.map((id) => g.people[id]?.surname).find(Boolean);
  const taken = new Set(Object.values(g.groups ?? {}).map((x) => x.name));
  const base = surname ? `The ${surname} Family` : 'New group';
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}

export function nextGroupColor(g: FamilyGraph): string {
  const used = Object.values(g.groups ?? {}).map((x) => x.color);
  return GROUP_COLORS.find((c) => !used.includes(c)) ?? GROUP_COLORS[used.length % GROUP_COLORS.length];
}

/** The box drawn around a group's cards, with room above for its name tab. */
export function groupBox(memberIds: Id[], pos: Record<Id, Point>, pad = 26): { x: number; y: number; w: number; h: number } | null {
  const ps = memberIds.map((id) => pos[id]).filter(Boolean);
  if (!ps.length) return null;
  const minX = Math.min(...ps.map((p) => p.x)), maxX = Math.max(...ps.map((p) => p.x + CARD_W));
  const minY = Math.min(...ps.map((p) => p.y)), maxY = Math.max(...ps.map((p) => p.y + CARD_H));
  return { x: minX - pad, y: minY - pad - 18, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 + 18 };
}
