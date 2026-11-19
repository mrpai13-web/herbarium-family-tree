/** Deleting people and media, always behind the confirm dialog. */
import { fullName } from '../core/dates';
import { childLinksOf, parentLinksOf, unionsOf } from '../core/relations';
import type { Id } from '../core/types';
import { useStore } from './store';

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export async function confirmDeletePerson(id: Id): Promise<boolean> {
  const s = useStore.getState();
  const p = s.graph.people[id];
  if (!p) return false;
  const photos = Object.values(s.media).filter((m) => m.personId === id && m.kind === 'image').length;
  const memories = Object.values(s.media).filter((m) => m.personId === id && m.kind === 'audio').length;
  const links = parentLinksOf(s.graph, id).length + childLinksOf(s.graph, id).length + unionsOf(s.graph, id).length;
  const name = fullName(p);
  const media = [photos && plural(photos, 'photo'), memories && plural(memories, 'voice memory', 'voice memories')].filter(Boolean);
  const ok = await s.ask({
    title: `Delete ${name}?`,
    body:
      `${name} will be removed from the tree` +
      (media.length ? `, along with their ${media.join(' and ')}` : '') +
      '.' +
      (links ? ` Their ${plural(links, 'family link')} will be removed too; the relatives themselves stay.` : '') +
      ' You can undo this with Ctrl+Z.',
    confirmLabel: 'Delete person',
    danger: true,
  });
  if (!ok) return false;
  await useStore.getState().deletePerson(id);
  useStore.getState().toast(`${name} was removed from the tree. Ctrl+Z brings them back.`);
  return true;
}

export async function confirmDeleteMedia(id: Id): Promise<boolean> {
  const s = useStore.getState();
  const m = s.media[id];
  if (!m) return false;
  const owner = s.graph.people[m.personId];
  const whose = owner ? ` from ${fullName(owner)}’s profile` : '';
  const isAudio = m.kind === 'audio';
  const label = isAudio ? `“${m.title || 'Untitled memory'}”` : m.caption ? `“${m.caption}”` : 'this photo';
  const ok = await s.ask({
    title: isAudio ? 'Delete this voice memory?' : 'Delete this photo?',
    body: `${label[0].toUpperCase() + label.slice(1)} will be deleted${whose}. You can undo this with Ctrl+Z.`,
    confirmLabel: isAudio ? 'Delete memory' : 'Delete photo',
    danger: true,
  });
  if (!ok) return false;
  await useStore.getState().removeMedia(id);
  return true;
}
