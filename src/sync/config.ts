/**
 * Which tree this page is showing, and where shared trees live.
 *
 * - No `?tree=` in the address: the private tree in this browser (as before).
 * - `?tree=<id>`: a shared tree kept in Supabase (members only), cached in its own
 *   IndexedDB database so it never mixes with the private one.
 */

/**
 * The Supabase project. Both values are meant to be public: the publishable key only
 * lets a browser ask; the database's own rules (supabase/schema.sql) decide what a
 * signed-in member may read or change. A local `.env` can override them for testing.
 */
const PROJECT_URL = 'https://uzpcqcvljkgdwofipuoe.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_9o9urMxfX1Y2a-yx61T0Vw_G8k_Kkan';

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || PROJECT_URL;
export const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_KEY as string | undefined) || PUBLISHABLE_KEY;
export const syncConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readTree(): string | null {
  if (typeof location === 'undefined') return null;
  const t = new URLSearchParams(location.search).get('tree');
  return t && UUID.test(t) ? t.toLowerCase() : null;
}

/** Id of the shared tree in the address, or null for the private local tree. */
export const sharedTree: string | null = readTree();

/** Where the app is published (GitHub Pages). Links made on a local copy point here. */
export const PUBLIC_APP_URL = 'https://mrpai13-web.github.io/herbarium-family-tree/';

/** The link that opens a shared tree. */
export function treeLink(id: string): string {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const u = new URL(local ? PUBLIC_APP_URL : location.href);
  u.search = `?tree=${id}`;
  u.hash = '';
  return u.toString();
}

export const mediaPath = (tree: string, mediaId: string, which: 'blob' | 'thumb') => `${tree}/${mediaId}/${which}`;

/* ------------------------------------------------------------ remote media */

type Fetcher = (mediaId: string, which: 'blob' | 'thumb') => Promise<Blob | undefined>;
let fetcher: Fetcher | null = null;

/** The sync engine registers how to download a shared tree's photo or recording. */
export function setRemoteMediaFetcher(f: Fetcher) {
  fetcher = f;
}

export function fetchRemoteMedia(mediaId: string, which: 'blob' | 'thumb'): Promise<Blob | undefined> {
  return fetcher ? fetcher(mediaId, which) : Promise.resolve(undefined);
}
