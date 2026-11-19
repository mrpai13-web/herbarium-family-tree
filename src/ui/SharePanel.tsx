import { motion } from 'framer-motion';
import { Check, Cloud, CloudOff, Copy, ExternalLink, Github, KeyRound, Loader2, LogOut, Trash2, UserPlus, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { familyTitle } from '../core/groups';
import { useStore } from '../data/store';
import { NEW_TOKEN_URL, sharedRepo, treeLink } from '../sync/config';
import { addMember, listMembers, removeMember, shareLocalTree, sharedTreeName, signIn, signOut, useSync, type Member } from '../sync/engine';

/** Status words for the share button and panel. */
export function syncWords(status: ReturnType<typeof useSync.getState>['status'], pending: number): string {
  switch (status) {
    case 'connecting':
      return 'Connecting…';
    case 'signin':
      return 'Sign in to open';
    case 'syncing':
      return pending ? `Saving ${pending} change${pending === 1 ? '' : 's'}…` : 'Saving…';
    case 'synced':
      return 'All changes saved';
    case 'offline':
      return pending ? `Offline · ${pending} change${pending === 1 ? '' : 's'} will send later` : 'Offline';
    case 'missing':
      return 'No access yet';
    case 'error':
      return 'Can’t reach GitHub';
    default:
      return 'Only in this browser';
  }
}

export function SharePanel({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest('[data-share-toggle]')) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  return (
    <motion.div
      ref={ref}
      role="dialog"
      aria-label="Share this tree"
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.15 }}
      className="absolute right-0 top-[calc(100%+8px)] z-30 max-h-[calc(100vh-90px)] w-[min(92vw,370px)] origin-top-right overflow-y-auto rounded-leaf-md border border-rule bg-card p-4 shadow-lift"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[17px]">{sharedRepo ? 'Shared tree' : 'Share this tree'}</h2>
        <button type="button" className="grid h-8 w-8 place-items-center rounded-full text-moss-deep hover:bg-mist" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      {sharedRepo ? <SharedPanel /> : <ShareLocal />}
    </motion.div>
  );
}

const errText = 'text-[12px] text-[#9A3B2F]';

/* ------------------------------------------------------------ sign in */

function SignIn({ why }: { why: string }) {
  const [token, setTokenText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await signIn(token);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5 text-[13px] leading-relaxed">
      <p className="text-ink-soft">{why}</p>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[12.5px] text-ink-soft marker:text-moss">
        <li>
          No GitHub account? <a className="text-moss underline" href="https://github.com/signup" target="_blank" rel="noreferrer">Make a free one</a>.
        </li>
        <li>
          <a className="text-moss underline" href={NEW_TOKEN_URL} target="_blank" rel="noreferrer">Open this page</a>, pick an expiry (<i>No expiration</i> is fine), scroll down and press <b>Generate token</b>.
        </li>
        <li>Copy the token (it starts with <code className="font-label text-[11.5px]">ghp_</code>) and paste it here.</li>
      </ol>
      <label className="flex flex-col gap-1">
        <span className="label-caps !text-[10px]">GitHub token</span>
        <input
          type="password"
          required
          className="field font-label !text-[12px]"
          value={token}
          onChange={(e) => setTokenText(e.target.value)}
          placeholder="ghp_…"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {err && <p role="alert" className={errText}>{err}</p>}
      <button type="submit" className="btn-solid justify-center" disabled={busy}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />} Sign in
      </button>
      <p className="text-[11px] leading-snug text-ink-muted">
        The token stays in this browser and is only sent to GitHub. You do this once per device. Sign out to remove it.
      </p>
    </form>
  );
}

function SignedInAs({ login }: { login: string }) {
  return (
    <div className="mt-1 flex items-center justify-between gap-2 border-t border-rule pt-3 text-[12px] text-ink-muted">
      <span className="flex min-w-0 items-center gap-1.5 truncate">
        <Github size={13} /> {login}
      </span>
      <button type="button" className="flex shrink-0 items-center gap-1 text-moss hover:underline" onClick={signOut}>
        <LogOut size={13} /> Sign out
      </button>
    </div>
  );
}

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-1.5">
      <input readOnly value={link} aria-label="Share link" className="field min-w-0 flex-1 !text-[12px]" onFocus={(e) => e.target.select()} />
      <button
        type="button"
        className="btn shrink-0 !px-2.5"
        onClick={async () => {
          await navigator.clipboard.writeText(link);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
        aria-label="Copy link"
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------ private tree -> shared */

function ShareLocal() {
  const login = useSync((s) => s.login);
  const graph = useStore((s) => s.graph);
  const [name, setName] = useState(() => familyTitle(graph));
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const empty = Object.keys(graph.people).length === 0;

  if (!login) return <SignIn why="Sharing keeps the tree in a private GitHub repository of yours. Family you add there can open it from a link and add to it. First, sign in to GitHub:" />;

  if (link)
    return (
      <div className="flex flex-col gap-3 text-[13px] leading-relaxed">
        <p>
          <b>{name}</b> is saved to a private repository on your GitHub. Open it, then add family under <i>Who can edit</i>.
        </p>
        <CopyLink link={link} />
        <a className="btn-solid justify-center" href={link}>
          <ExternalLink size={15} /> Open the shared tree
        </a>
        <p className="text-[11.5px] text-ink-muted">Make changes in the shared tree from now on. This browser keeps its private copy too, unchanged.</p>
        <SignedInAs login={login} />
      </div>
    );

  return (
    <form
      className="flex flex-col gap-2.5"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        setProgress([0, 1]);
        try {
          setLink(await shareLocalTree(name, (d, t) => setProgress([d, t])));
        } catch (x) {
          setErr((x as Error).message);
        } finally {
          setProgress(null);
        }
      }}
    >
      <p className="text-[13px] leading-relaxed text-ink-soft">
        Copies this tree, with its photos and voice memories, into a new <b>private</b> repository on your GitHub, and gives you a link. Only people you add can open it.
      </p>
      <label className="flex flex-col gap-1">
        <span className="label-caps !text-[10px]">Name</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      {err && <p role="alert" className={errText}>{err}</p>}
      <button type="submit" className="btn-solid justify-center" disabled={Boolean(progress) || empty}>
        {progress ? (
          <>
            <Loader2 size={15} className="animate-spin" /> Uploading {progress[0]} of {progress[1]}…
          </>
        ) : (
          <>
            <Cloud size={15} /> Put this tree on GitHub
          </>
        )}
      </button>
      {empty && <p className="text-[11.5px] text-ink-muted">Add someone first.</p>}
      <SignedInAs login={login} />
    </form>
  );
}

/* ------------------------------------------------------------ in a shared tree */

function SharedPanel() {
  const { login, canEdit, isOwner, status, pending, problem } = useSync();
  const link = treeLink(sharedRepo!);
  const name = sharedTreeName();
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <div className="flex items-center gap-2 rounded-leaf-sm bg-mist px-3 py-2">
        {status === 'offline' || status === 'error' ? <CloudOff size={15} className="text-ink-muted" /> : <Cloud size={15} className="text-moss" />}
        <span className="min-w-0 flex-1">
          <b className="block truncate">{name || sharedRepo}</b>
          <span className="text-[12px] text-ink-muted">{syncWords(status, pending)}</span>
        </span>
      </div>
      {problem && status !== 'synced' && <p className={errText}>{problem}</p>}
      <div className="flex flex-col gap-1">
        <span className="label-caps !text-[10px]">Link to send to family</span>
        <CopyLink link={link} />
        <span className="text-[11.5px] text-ink-muted">Only people added below can open it.</span>
      </div>
      {!login && <SignIn why="This tree is kept in a private GitHub repository. Sign in with the GitHub account the tree’s owner added:" />}
      {login && canEdit && !isOwner && <p className="text-[12px] text-ink-muted">You can edit this tree. Changes save automatically.</p>}
      {isOwner && <Members />}
      {login && (
        <a className="flex items-center gap-1.5 text-[12px] text-moss hover:underline" href={`https://github.com/${sharedRepo}/commits`} target="_blank" rel="noreferrer">
          <Github size={13} /> History of every change on GitHub
        </a>
      )}
      {login && <SignedInAs login={login} />}
      <a href={location.pathname} className="text-[12px] text-moss hover:underline">
        Open my private tree in this browser
      </a>
    </div>
  );
}

function Members() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => listMembers().then(setMembers, (e: Error) => setErr(e.message));
  useEffect(() => void refresh(), []);
  return (
    <div className="flex flex-col gap-2 border-t border-rule pt-3">
      <span className="label-caps !text-[10px]">Who can open and edit</span>
      <form
        className="flex gap-1.5"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          setBusy(true);
          try {
            await addMember(name);
            setName('');
            await refresh();
          } catch (x) {
            setErr((x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input required className="field min-w-0 flex-1" placeholder="Their GitHub username" value={name} onChange={(e) => setName(e.target.value)} aria-label="GitHub username to add" />
        <button type="submit" className="btn shrink-0" disabled={busy}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />} Add
        </button>
      </form>
      {err && <p role="alert" className={errText}>{err}</p>}
      <ul className="flex flex-col gap-1">
        <li className="text-[12px] text-ink-muted">You (owner)</li>
        {members?.map((m) => (
          <li key={m.login} className="flex items-center justify-between gap-2 text-[12.5px]">
            <span className="truncate">
              {m.login}
              {m.pending && <span className="ml-1.5 text-[11px] text-ink-muted">invited, not accepted yet</span>}
            </span>
            <button
              type="button"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-mist hover:text-[#9A3B2F]"
              aria-label={`Remove ${m.login}`}
              onClick={async () => {
                try {
                  await removeMember(m);
                  await refresh();
                } catch (x) {
                  setErr((x as Error).message);
                }
              }}
            >
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>
      <p className="text-[11.5px] leading-snug text-ink-muted">
        GitHub emails them an invitation to accept. Then they open the link above and sign in with their own GitHub token.
      </p>
    </div>
  );
}
