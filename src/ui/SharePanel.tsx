import { motion } from 'framer-motion';
import { Check, Cloud, CloudOff, Copy, ExternalLink, Loader2, LogOut, Mail, Trash2, UserPlus, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { familyTitle } from '../core/groups';
import { useStore } from '../data/store';
import { sharedTreeId, syncConfigured, treeLink } from '../sync/config';
import { addMember, listMembers, removeMember, sendSignInLink, shareLocalTree, signOut, useSync, type Member } from '../sync/engine';

/** Status words for the sync pill and panel. */
export function syncWords(status: ReturnType<typeof useSync.getState>['status'], pending: number): string {
  switch (status) {
    case 'connecting':
      return 'Connecting…';
    case 'syncing':
      return pending ? `Saving ${pending} change${pending === 1 ? '' : 's'}…` : 'Saving…';
    case 'synced':
      return 'All changes saved';
    case 'offline':
      return pending ? `Offline · ${pending} change${pending === 1 ? '' : 's'} will send later` : 'Offline';
    case 'missing':
      return 'Tree not found';
    case 'error':
      return 'Can’t reach the server';
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
      className="absolute right-0 top-[calc(100%+8px)] z-30 w-[min(92vw,360px)] origin-top-right rounded-leaf-md border border-rule bg-card p-4 shadow-lift"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[17px]">{sharedTreeId ? 'Shared tree' : 'Share this tree'}</h2>
        <button type="button" className="grid h-8 w-8 place-items-center rounded-full text-moss-deep hover:bg-mist" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      {!syncConfigured ? <NotSetUp /> : sharedTreeId ? <SharedPanel /> : <ShareLocal />}
    </motion.div>
  );
}

function NotSetUp() {
  return (
    <p className="text-[13px] leading-relaxed text-ink-soft">
      Sharing isn’t switched on for this copy of the app. It needs a Supabase project: see “Sharing” in the README. Until then your tree stays in this browser.
    </p>
  );
}

/* ------------------------------------------------------------ sign in */

function SignIn({ why }: { why: string }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setState('sending');
    try {
      await sendSignInLink(email);
      setState('sent');
    } catch (x) {
      setErr((x as Error).message);
      setState('idle');
    }
  }
  if (state === 'sent')
    return (
      <div className="rounded-leaf-sm bg-mist p-3 text-[13px] leading-relaxed">
        <Mail size={16} className="mb-1 text-moss" />
        Check <b>{email}</b> for a sign-in link and open it on this device. It brings you back here, signed in.
        <button type="button" className="mt-2 block text-[12px] text-moss underline" onClick={() => setState('idle')}>
          Use a different email
        </button>
      </div>
    );
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <p className="text-[13px] leading-relaxed text-ink-soft">{why}</p>
      <label className="flex flex-col gap-1">
        <span className="label-caps !text-[10px]">Your email</span>
        <input type="email" required className="field" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
      </label>
      {err && <p role="alert" className="text-[12px] text-[#9A3B2F]">{err}</p>}
      <button type="submit" className="btn-solid justify-center" disabled={state === 'sending'}>
        {state === 'sending' ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />} Email me a sign-in link
      </button>
      <p className="text-[11px] text-ink-muted">No password: you click the link in the email each time you sign in on a new device.</p>
    </form>
  );
}

function SignedInAs({ email }: { email: string }) {
  return (
    <div className="mt-3 flex items-center justify-between gap-2 border-t border-rule pt-3 text-[12px] text-ink-muted">
      <span className="truncate">Signed in as {email}</span>
      <button type="button" className="flex shrink-0 items-center gap-1 text-moss hover:underline" onClick={() => void signOut()}>
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
  const email = useSync((s) => s.email);
  const graph = useStore((s) => s.graph);
  const [name, setName] = useState(() => familyTitle(graph));
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const empty = Object.keys(graph.people).length === 0;

  if (!email) return <SignIn why="Put this tree online so family can see it from a link, and the people you invite can add to it. First, sign in." />;

  if (link)
    return (
      <div className="flex flex-col gap-3 text-[13px] leading-relaxed">
        <p>
          <b>{name}</b> is online. Send this link to family: anyone with it can look; people you invite can edit.
        </p>
        <CopyLink link={link} />
        <a className="btn-solid justify-center" href={link}>
          <ExternalLink size={15} /> Open the shared tree
        </a>
        <p className="text-[11.5px] text-ink-muted">
          Make your changes in the shared tree from now on. Invite editors from its Share button. This browser keeps its private copy too, unchanged.
        </p>
        <SignedInAs email={email} />
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
        Uploads a copy of this tree, with its photos and voice memories, and gives you a link. Anyone with the link can view it; only people you invite can edit.
      </p>
      <label className="flex flex-col gap-1">
        <span className="label-caps !text-[10px]">Name</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      {err && <p role="alert" className="text-[12px] text-[#9A3B2F]">{err}</p>}
      <button type="submit" className="btn-solid justify-center" disabled={Boolean(progress) || empty}>
        {progress ? (
          <>
            <Loader2 size={15} className="animate-spin" /> Uploading {progress[0]} of {progress[1]}…
          </>
        ) : (
          <>
            <Cloud size={15} /> Put this tree online
          </>
        )}
      </button>
      {empty && <p className="text-[11.5px] text-ink-muted">Add someone first.</p>}
      <SignedInAs email={email} />
    </form>
  );
}

/* ------------------------------------------------------------ in a shared tree */

function SharedPanel() {
  const { email, canEdit, isOwner, status, pending, problem, treeName } = useSync();
  const link = treeLink(sharedTreeId!);
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <div className="flex items-center gap-2 rounded-leaf-sm bg-mist px-3 py-2">
        {status === 'offline' || status === 'error' ? <CloudOff size={15} className="text-ink-muted" /> : <Cloud size={15} className="text-moss" />}
        <span className="min-w-0 flex-1">
          <b className="block truncate">{treeName || 'Shared tree'}</b>
          <span className="text-[12px] text-ink-muted">{syncWords(status, pending)}</span>
        </span>
      </div>
      {problem && status !== 'synced' && <p className="text-[12px] text-[#9A3B2F]">{problem}</p>}
      <div className="flex flex-col gap-1">
        <span className="label-caps !text-[10px]">Link to send to family</span>
        <CopyLink link={link} />
        <span className="text-[11.5px] text-ink-muted">Anyone with this link can view the tree.</span>
      </div>
      {!email && <SignIn why="To add people, photos or stories, sign in with the email the tree’s owner invited." />}
      {email && !canEdit && (
        <p className="rounded-leaf-sm border border-rule p-3 leading-relaxed">
          You can view this tree. To edit, ask whoever shared it to invite <b>{email}</b>.
        </p>
      )}
      {email && canEdit && !isOwner && <p className="text-[12px] text-ink-muted">You’re invited to edit. Your changes save automatically.</p>}
      {isOwner && <Members />}
      {email && <SignedInAs email={email} />}
      <a href={location.pathname} className="text-[12px] text-moss hover:underline">
        Open my private tree in this browser
      </a>
    </div>
  );
}

function Members() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => listMembers().then(setMembers, (e: Error) => setErr(e.message));
  useEffect(() => void refresh(), []);
  return (
    <div className="flex flex-col gap-2 border-t border-rule pt-3">
      <span className="label-caps !text-[10px]">Who can edit</span>
      <form
        className="flex gap-1.5"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          try {
            await addMember(email);
            setEmail('');
            await refresh();
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        <input type="email" required className="field min-w-0 flex-1" placeholder="Relative’s email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email to invite" />
        <button type="submit" className="btn shrink-0">
          <UserPlus size={15} /> Invite
        </button>
      </form>
      {err && <p role="alert" className="text-[12px] text-[#9A3B2F]">{err}</p>}
      <ul className="flex flex-col gap-1">
        <li className="text-[12px] text-ink-muted">You (owner)</li>
        {members?.map((m) => (
          <li key={m.email} className="flex items-center justify-between gap-2 text-[12.5px]">
            <span className="truncate">{m.email}</span>
            <button
              type="button"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-mist hover:text-[#9A3B2F]"
              aria-label={`Remove ${m.email}`}
              onClick={async () => {
                try {
                  await removeMember(m.email);
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
      <p className="text-[11.5px] leading-snug text-ink-muted">Send them the link above. They sign in with the email you invited, then they can add people, photos and memories.</p>
    </div>
  );
}
