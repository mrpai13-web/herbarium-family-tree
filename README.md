# Herbarium · Family Tree & Living Archive

A local-first family tree that runs in your browser. People sit on an infinite
"herbarium sheet" as taped specimen cards, joined by growing roots. Photos and
voice memories are stored only in this browser's IndexedDB on this computer.

```powershell
pnpm install
pnpm dev          # http://localhost:5190
pnpm test         # layout + relationship tests (vitest)
pnpm typecheck
pnpm build        # static site in dist/ (open with `pnpm preview`)
```

First launch opens an empty tree with an **Add the first person** button. A fictional
sample family (the Ashby–Lund family, three generations) is one click away: *Explore a
sample family* on the empty tree, or **Archive → Restore the sample family**.
**Archive → Start a new tree** empties it again.

## Using it

- **Pick whip:** hover a card to show a vine handle on each side. The side you drag from
  sets the direction:
  - **up** = a parent (a generation above), **down** = a child (a generation below),
    **left** = a sibling, **right** = a partner (same generation).
  - Drop it on another card to connect the two: a menu asks how they're related, already
    set from the direction ("Lucia is Samuel's [child]"), with the kind (birth, adoptive,
    step, foster; or married / partners and status). You can change any of it before
    pressing Connect. A chip by the pointer says what letting go will do.
  - Drop it on empty sheet to add a brand-new relative in that direction straight away
    (Ctrl+Z undoes).
  - Click a handle (or Tab to it and press Enter) for the same menu with a person list.
- **Child of a couple:** hover the ring on the line between two partners and drag from it.
  Drop on a card to make that person the child of both (kind: birth, adopted, step,
  foster); drop on empty sheet to add a new child of both; click it for a menu.
- **Lines:** hover any line to read how the two are related ("Daniel is the son of
  Walter and Margaret", "Claire and Daniel were married in 1994 and divorced in 2003").
  Click a line to select it: a menu offers to break it (for a couple's shared line: unlink
  from either parent, or both). Delete breaks a selected line after asking; Esc closes;
  Ctrl+Z undoes. The ring between partners shows the same description, and its click menu
  can break the partnership.
- **Family groups:** click the title to open *Family groups*. A group is a named set of
  people ("The Ashby Family", "Mum's side"); save as many as you like.
  - The star makes a group the **main family**: its name becomes the title (otherwise the
    title is "The <most common surname> Family").
  - The eye **shows** a group: a coloured box with the group's name is drawn around its
    members, everyone else fades, and the view zooms to it.
  - The pencil (or *Add or remove people* on the banner) **edits** it: click cards to add
    or remove them, then *Done* (or Esc / Enter).
  - Rename inline, click the dot to change colour, or delete the group (people stay).
  - In a profile, *Groups* shows chips to add or remove that person, and *New group*.
  - The tree is **arranged around the group last shown**: its central couple in the
    middle, one partner's family to the left and the other's to the right.
  - The book icon opens the group's **contact list** from everyone's *Phone* and *Email*
    (living members only): copy it, save it as a spreadsheet (CSV), print it, or email
    everyone. People with no contact yet have a link to their profile.
  Groups are saved with the tree, included in backups, and undoable.
- **Canvas never empties:** panning and zooming always keep part of the tree on screen.
- **Add people:** *Add person* (beside the search box) adds someone not yet connected. In a profile,
  *Family → Add a new relative* has Parent / Partner / Child / Sibling buttons, and
  *Connect someone already in the tree* links two existing people (it refuses loops, such
  as someone becoming their own ancestor).
- **Undo / redo:** Ctrl+Z (Cmd+Z on a Mac) undoes the last change: adding, editing,
  connecting, unlinking or deleting people, and adding, editing or deleting photos and voice
  memories (deleted files come back too). Ctrl+Shift+Z or Ctrl+Y redoes. The arrow buttons
  at the top right do the same and name the step. Inside a text field, Ctrl+Z undoes
  typing instead. History holds 60 steps for this session; it's cleared by reloading,
  importing a backup, restoring the sample or starting a new tree.
- **Delete:** press Delete (or Backspace) to remove what has focus: a photo or voice
  memory in the profile, a card on the tree, or otherwise the open profile. A dialog
  always asks first; Cancel has focus, and Esc cancels. Keys typed in text fields never delete.
- **Profile drawer:** click a card. Everything is edited in place and saved as you go
  (on blur / Enter): names, dates (`1938`, `Nov 1938`, `2 Nov 1938`, `2/11/1938`),
  birthplace, phone, email, story, relationships. Hover or focus any field for a short explanation.
- **Dates:** type them, or press the calendar button next to any date. The calendar
  can save an exact day, just a month, or just a year (type a year to jump to it;
  arrow keys move between days).
- **Photos:** drop images on the portrait or the Photos area, or click to choose.
  They're resized on this computer (max 1600 px, WebP) with a 360 px thumbnail for cards.
- **Voice memories:** *Record a memory* uses the microphone (MediaRecorder); *Upload
  audio* or drop MP3 / WAV / M4A. A waveform is computed once and stored.
- **Canvas:** drag to pan, scroll or pinch to zoom, `F` fits the tree, `+`/`-` zoom,
  `Esc` closes the drawer. The mini-map appears while you pan or zoom (and fades a few seconds after) and moves the view on click or drag. On touch screens, a drag can start anywhere, cards included; lifting one finger of a pinch keeps panning.
- **Backups:** *Archive → Export archive (.zip)* saves everything (photos and audio
  included) to a file you choose. *Import archive…* restores a .zip or .json backup,
  replacing the current tree after a confirmation. Browsers can clear site data, so
  export now and then.

## Sharing (`src/sync/`, `supabase/schema.sql`)

The app itself is public (GitHub Pages, built by `.github/workflows/pages.yml`); it holds
no family data. Without sharing it is exactly as before: one private tree in this browser.

A shared tree lives in the family's **Supabase** project (Postgres + private file storage).
Access is **members only**, enforced by the database's row-level security rules, not by
the app: signed-out visitors and signed-in people who weren't invited can't read anything,
not even whether a tree exists.

1. **Share** -> type your email -> type the 6-digit code from the email (or click its
   link on the same device) -> **Put this tree online**. The tree, photos and voice
   memories are copied up and you get a link `…/?tree=<id>`. Your private tree stays as it
   was.
2. In the shared tree the owner invites people by email as **Can view** or **Can edit**
   (changeable later, or removed). Inviting sends nothing: send them the link. They open
   it and sign in with that email address; no password or account setup.
3. Edits save automatically; the Share button shows *All changes saved*, *Saving…* or
   *Offline* (changes wait in an outbox and go up when back online). Other people's edits
   arrive within seconds (a broadcast nudge) or ~20 s at worst.
4. **Signing out**, or opening the tree after being removed, deletes this browser's copy
   of the shared tree, so a shared computer doesn't keep it.

Roles: owner (whoever shared it: everything, and the only one who sees the member list),
editor (read and write rows and files), viewer (read only). Deleting a person clears their
row's data on the server (no old copy is kept). A row can never be moved to another tree.
`supabase/schema.sql` is the whole server setup and is safe to run again; its rules were
checked on real Postgres (PGlite) for each role, signed-out and uninvited visitors.

How it syncs: each shared tree has its own IndexedDB cache (`herbarium-shared-<id>`). A
Dexie middleware (`src/data/db.ts`) reports every local write; `src/sync/engine.ts` upserts
changed rows (`records`: one JSON row per person, link, union, group or media caption,
with a sequence number) and pulls everything after the last sequence it saw. Photos and
recordings are in the private bucket `family-media` at `<tree>/<media>/blob|thumb`,
downloaded on first view and then cached. In a tree you can't edit, edit actions are
guarded, handles are hidden and profile fields are read-only; replacing a shared tree
(import, sample, start over) is never allowed.

The project URL and publishable key are in `src/sync/config.ts` (both are public by
design; `.env` `VITE_SUPABASE_URL` / `VITE_SUPABASE_KEY` override them for testing).
Sign-in emails go through the owner's Gmail (custom SMTP), because Supabase's built-in
mailer only sends to the project's own team.

## Reminders (`.github/workflows/family-tree-monitor.yml`)

The free Supabase plan pauses a project after a week without use (restorable with one
click for 90 days) and keeps no backups. A GitHub Actions job runs daily at 8 am Hawaii
time (`.github/monitor/check.py`, standard-library Python) and emails the owner:

- every Monday: the activity log (last sign-in, visit, edit and backup), which also shows
  the check is still running;
- after 4 and 6 days with no sign-in, visit or edit: open the tree before day 7;
- on Mondays while the last backup export is over 30 days old (or never);
- every day the database doesn't answer (probably paused): how to restore, and the
  90-day limit.

It reads dates and counts only, through `monitor_report(token)`; the database stores just
the token's SHA-256 (`monitor_settings`), the token is the `MONITOR_TOKEN` repo secret.
The app logs visits (at most every 6 h per device) and shared-tree backup exports with
`note_activity`; sign-ins come from Supabase Auth and edits from `records`. The owner sees
the same log under *Activity* in the Share panel (`tree_activity`, owner only).

Setup: run `supabase/schema.sql`, insert the token hash into `monitor_settings`, and add
repo secrets `MONITOR_TOKEN`, `GMAIL_USER`, `GMAIL_APP_PASSWORD` (a Google app password)
and optionally `NOTIFY_EMAIL` (defaults to `GMAIL_USER`). *Actions -> Family tree reminders
-> Run workflow* sends a test email. The daily request itself most likely counts as use
and keeps the project awake; the job re-enables its own schedule each run, since GitHub
switches off schedules in public repos after 60 days without commits.

## Line styles

| Relationship | On the sheet |
|---|---|
| Birth parent → child | solid moss root with leaves |
| Adoptive | bark-brown "graft" (dash-dot) |
| Step | lighter bark dashes |
| Foster | bark dots |
| Partners (married / together) | line with a rose heart (paler when widowed) |
| Former partners (divorced / separated) | faded line with a break and a broken heart |

## Data model (`src/core/types.ts`)

A graph, not a binary tree:

- **Person**: names (given, middle, surname, nickname, birth surname), sex (only for
  wording such as mother/father), fuzzy dates (`"1938"`, `"1938-11"`, `"1938-11-02"`),
  birthplace, `phone`, `email` (free text; commas separate several), bio, `photoId`, `galleryIds[]`, `audioIds[]`.
- **ParentLink** `{parentId, childId, kind: biological | adoptive | step | foster, since?}`:
  one edge per parent, so a child can have any number of parents of any kind.
- **Union** `{partners: [a, b], kind: married | partners, status: current | widowed |
  separated | divorced, start?, end?}`: any number per person, so remarriage and
  former partners are first-class.
- **Siblings are derived**, never stored: shared parents give full / half / adoptive
  siblings, and a parent's partner's children are step-siblings
  (`siblingsOf` in `src/core/relations.ts`). "Add sibling" for someone with no
  parents creates an *Unknown parent* placeholder to hang them from.
- **Group** `{name, memberIds[], color, core?}` (`src/core/groups.ts`): named sets of
  people; the `core` one titles the archive. Stored in `graph.groups` (optional, so older
  backups load), IndexedDB table `groups` (Dexie schema v2).
- **Media** lives in its own IndexedDB table (`blob`, `thumb`, plus metadata such as
  caption, title, recorded date, duration and waveform peaks). The graph is loaded into
  memory; blobs are loaded on demand as object URLs.

IndexedDB (Dexie) tables: `people`, `parentLinks`, `unions`, `media`, `meta`, `groups`.

## Layout (`src/core/layout.ts`)

Pure and deterministic; recomputed whenever the graph changes, and cards glide to
their new places.

1. **Generations.** A child sits one row below each parent, partners share a row, and
   people with no recorded parents are pulled down to sit just above their children
   (so in-laws don't float at the top). Done by monotone relaxation, capped so bad data
   can't loop.
2. **Partner clusters.** Partners in a row form one unbreakable unit. A person with
   several partners sits in the middle: former partners left, current right.
3. **Ordering, around a focus family.** The tree is built outward from the central
   couple of the *focus* group (the group last shown with the eye; else the main family;
   else the first group; with no groups, the couple with the most direct ancestors and
   descendants). One partner's whole family goes to the left, the other's to the right,
   and the same rule applies at every couple: a person's parents sit above them, the
   outer parent's family further out, their brothers and sisters beside them, and each
   in-law's family on that in-law's side. A couple's children are in birth order, the
   first half with their partner's family on the left, the rest on the right. Then
   neighbouring clusters are swapped (or couples turned round) only where that strictly
   lowers the number of crossing lines. The focus is kept while a group's members are
   being picked, so the tree doesn't rearrange under each click.
4. **Coordinates.** Each row is solved as "as close as possible to where my family
   wants me, never closer than the minimum gap" using isotonic regression
   (pool-adjacent-violators), alternating top-down and bottom-up passes. The spacing
   constraint is what guarantees **cards never overlap**, at any size; a test grows the
   sample tree by 60 random additions and checks it.
5. **Generation rows.** Every card in a generation sits on the same line: siblings,
   their partners and cousins alike, so generations read as rows (the canvas shades
   each one and labels it with its birth years). Age shows as left-to-right order.

## Backup format (`src/data/archive.ts`)

`.zip` containing `archive.json` (`format: "herbarium-family-archive"`, `version: 1`,
the graph, media metadata) and `media/<id>.<ext>` / `media/<id>.thumb.<ext>`. The
`.json` variant embeds the same files as base64.

## Layout of the code

```
src/core/     pure logic, tested: types, relations (queries + quick-add), layout, paths (Bezier roots), dates, waveform
src/data/     db (Dexie), store (zustand, write-through to IndexedDB), media (compression, audio analysis), archive, seed
src/canvas/   TreeCanvas, PersonCard, Edges, Overlays (zoom, mini-map, ferns), useViewport, useTweenedLayout
src/drawer/   ProfileDrawer, Audio (player + recorder), Gallery (+ lightbox), Relationships
src/ui/       TopBar (search + Archive menu), Portrait, shared bits (inline edit, confirm, toasts, drop zone)
design/       style-options.html, the four directions explored before the build (Herbarium was chosen)
```

Dev builds expose `window.__store` and `window.__archive` for automated checks.

## Known limits

- The private tree lives in one browser profile. Another browser, or clearing site data,
  starts empty: use Export / Import, or share the tree to keep it online.
- Shared trees: two people editing the *same person* at the same moment, the later save
  wins. Undo is per person and can undo someone else's later edit to the same row.
  Supabase's free plan: 500 MB database, 1 GB of photos and recordings (roughly 3,000
  photos at the app's compression), and the project pauses after a week with no visits
  (one click in the Supabase dashboard wakes it). No automatic backups on the free plan:
  keep an Export now and then.
- Recording needs a secure origin (`localhost` is fine) and microphone permission.
- Very large trees (hundreds of people) re-render every card during the 0.5 s glide
  after an edit; fine at family scale, not yet virtualised.
- No manual card dragging yet; positions are always automatic.
