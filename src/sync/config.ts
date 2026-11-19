/**
 * Which tree this page is showing.
 *
 * - No `?tree=` in the address: the private tree in this browser (as before).
 * - `?tree=<id>`: a shared tree from Supabase, cached in its own IndexedDB database so it
 *   never mixes with the private one.
 *
 * Sharing needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY at build time (see .env.example).
 */
const env = import.meta.env as Record<string, string | undefined>;

export const SUPABASE_URL = env.VITE_SUPABASE_URL?.trim() || '';
export const SUPABASE_KEY = env.VITE_SUPABASE_ANON_KEY?.trim() || '';
export const syncConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readTreeId(): string | null {
  if (typeof location === 'undefined') return null;
  const id = new URLSearchParams(location.search).get('tree');
  return id && UUID.test(id) ? id.toLowerCase() : null;
}

/** The shared tree's id, or null for the private local tree. */
export const sharedTreeId: string | null = syncConfigured ? readTreeId() : null;

/** The link that opens a shared tree. */
export function treeLink(id: string): string {
  const u = new URL(location.href);
  u.search = `?tree=${id}`;
  u.hash = '';
  return u.toString();
}

/** Bucket path prefix for a media file. */
export const mediaPath = (tree: string, mediaId: string, which: 'blob' | 'thumb') => `${tree}/${mediaId}/${which}`;

/** Public URL of a shared tree's media file (the bucket is public; paths are random ids). */
export function remoteMediaUrl(tree: string, mediaId: string, which: 'blob' | 'thumb'): string {
  return `${SUPABASE_URL}/storage/v1/object/public/family-media/${mediaPath(tree, mediaId, which)}`;
}
