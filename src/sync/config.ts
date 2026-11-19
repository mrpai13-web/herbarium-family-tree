/**
 * Which tree this page is showing.
 *
 * - No `?repo=` in the address: the private tree in this browser (as before).
 * - `?repo=owner/name`: a shared tree kept in a private GitHub repository, cached in its
 *   own IndexedDB database so it never mixes with the private one. Reading and writing it
 *   needs a GitHub token from someone the owner added to that repository.
 */
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

function readRepo(): string | null {
  if (typeof location === 'undefined') return null;
  const r = new URLSearchParams(location.search).get('repo');
  return r && REPO.test(r) ? r : null;
}

/** "owner/name" of the shared tree's data repository, or null for the private local tree. */
export const sharedRepo: string | null = readRepo();

/** Where the app is published (GitHub Pages). Links made on a local copy point here. */
export const PUBLIC_APP_URL = 'https://mrpai13-web.github.io/herbarium-family-tree/';

/** The link that opens a shared tree. */
export function treeLink(repo: string): string {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const u = new URL(local ? PUBLIC_APP_URL : location.href);
  u.search = `?repo=${repo}`;
  u.hash = '';
  return u.toString();
}

/* ------------------------------------------------------------ GitHub token */

const TOKEN_KEY = 'herbarium-github-token';

/** The GitHub token saved in this browser (only ever sent to api.github.com). */
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked: the token works for this visit only */
  }
}

/** Creating a classic token with the one scope the app needs, pre-filled. */
export const NEW_TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=Herbarium%20family%20tree';

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
