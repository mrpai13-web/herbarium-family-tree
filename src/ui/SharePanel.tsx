import { motion } from 'framer-motion';
import { Check, Cloud, CloudOff, Copy, ExternalLink, Loader2, LogOut, Mail, Trash2, UserPlus, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { familyTitle } from '../core/groups';
import { useStore } from '../data/store';
import { sharedTree, syncConfigured, treeLink } from '../sync/config';
import {
  addMember, listMembers, removeMember, sendSignInCode, setMemberRole, shareLocalTree, signOut, treeActivity, useSync, verifySignInCode,
  type ActivityRow, type Member,
} from '../sync/engine';

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
      return 'Not invited';
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
      className="absolute right-0 top-[calc(100%+8px)] z-30 max-h-[calc(100vh-90px)] w-[min(92vw,370px)] origin-top-right overflow-y-auto rounded-leaf-md border border-rule bg-card p-4 shadow-lift"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[17px]">{sharedTree ? 'Shared tree' : 'Share this tree'}</h2>
        <button type="button" className="grid h-8 w-8 place-items-center rounded-full text-moss-deep hover:bg-mist" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      {!syncConfigured ? <NotSetUp /> : sharedTree ? <SharedPanel /> : <ShareLocal />}
    </motion.div>
  );
}

const errText = 'text-[12px] text-[#9A3B2F]';

function NotSetUp() {
  return (
    <p className="text-[13px] leading-relaxed text-ink-soft">
      Sharing isn’t switched on for this copy of the app yet. Once the family’s Supabase project is connected, this is where you put the tree
      online and invite relatives.
    </p>
  );
}

/* ------------------------------------------------------------ sign in */

function SignIn({ why }: { why: string }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = (f: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await f();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!sent)
    return (
      <form
        onSubmit={run(async () => {
          await sendSignInCode(email);
          setSent(true);
        })}
        className="flex flex-col gap-2.5 text-[13px] leading-relaxed"
      >
        <p className="text-ink-soft">{why}</p>
        <label className="flex flex-col gap-1">
          <span className="label-caps !text-[10px]">Your email</span>
          <input type="email" required className="field" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="email" />
        </label>
        {err && <p role="alert" className={errText}>{err}</p>}
        <button type="submit" className="btn-solid justify-center" disabled={busy}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />} Email me a sign-in code
        </button>
        <p className="text-[11px] leading-snug text-ink-muted">No password or account to set up. You stay signed in on this device until you sign out.</p>
      </form>
    );
  return (
    <form onSubmit={run(() => verifySignInCode(email, code))} className="flex flex-col gap-2.5 text-[13px] leading-relaxed">
      <p className="text-ink-soft">
        We emailed a code to <b>{email}</b>. Type it here, or click the link in the email on this device. Not there? Check spam.
      </p>
      <label className="flex flex-col gap-1">
        <span className="label-caps !text-[10px]">Code</span>
        <input
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="Sign-in code"
          className="field font-label !text-[18px] tracking-[0.3em]"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, '').slice(0, 10))}
          placeholder="123456"
        />
      </label>
      {err && <p role="alert" className={errText}>{err}</p>}
      <button type="submit" className="btn-solid justify-center" disabled={busy || code.length < 6}>
        {busy && <Loader2 size={15} className="animate-spin" />} Sign in
      </button>
      <button
        type="button"
        className="text-[12px] text-moss hover:underline"
        onClick={() => {
          setSent(false);
          setCode('');
          setErr(null);
        }}
      >
        Use a different email or send a new code
      </button>
    </form>
  );
}

function SignedInAs({ email }: { email: string }) {
  return (
    <div className="mt-1 flex items-center justify-between gap-2 border-t border-rule pt-3 text-[12px] text-ink-muted">
      <span className="flex min-w-0 items-center gap-1.5 truncate">
        <Mail size={13} /> {email}
      </span>
      <button
        type="button"
        className="flex shrink-0 items-center gap-1 text-moss hover:underline"
        onClick={async () => {
          const pending = useSync.getState().pending;
          if (sharedTree) {
            const ok = await useStore.getState().ask({
              title: 'Sign out of this tree?',
              body: pending
                ? `${pending} change${pending === 1 ? ' hasn’t' : 's haven’t'} reached the server yet and will be lost. Signing out also removes this browser’s copy of the tree.`
                : 'This also removes this browser’s copy of the tree, so nobody else using this device can see it. Sign in again any time to get it back.',
              confirmLabel: 'Sign out',
              danger: pending > 0,
            });
            if (!ok) return;
          }
          await signOut();
        }}
      >
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

  if (!email) return <SignIn why="Sharing puts the tree online where only family you invite can open it. First, sign in with your email:" />;

  if (link)
    return (
      <div className="flex flex-col gap-3 text-[13px] leading-relaxed">
        <p>
          <b>{name}</b> is online. Open it, then invite family by email under <i>Who can open it</i>.
        </p>
        <CopyLink link={link} />
        <a className="btn-solid justify-center" href={link}>
          <ExternalLink size={15} /> Open the shared tree
        </a>
        <p className="text-[11.5px] text-ink-muted">
          Make changes in the shared tree from now on. It opens on the public site, so sign in there once more with the same email. This
          browser keeps its private copy too, unchanged.
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
        Copies this tree, with its photos and voice memories, to the family’s private online space and gives you a link. Only people you
        invite by email can open it.
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
  const { email, role, isOwner, status, pending, problem, treeName } = useSync();
  const link = treeLink(sharedTree!);
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <div className="flex items-center gap-2 rounded-leaf-sm bg-mist px-3 py-2">
        {status === 'offline' || status === 'error' ? <CloudOff size={15} className="text-ink-muted" /> : <Cloud size={15} className="text-moss" />}
        <span className="min-w-0 flex-1">
          <b className="block truncate">{treeName || 'Shared family tree'}</b>
          <span className="text-[12px] text-ink-muted">{syncWords(status, pending)}</span>
        </span>
      </div>
      {problem && status !== 'synced' && <p className={errText}>{problem}</p>}
      <div className="flex flex-col gap-1">
        <span className="label-caps !text-[10px]">Link to send to family</span>
        <CopyLink link={link} />
        <span className="text-[11.5px] text-ink-muted">Only people invited below can open it.</span>
      </div>
      {!email && <SignIn why="This family tree is private. Sign in with the email address you were invited with:" />}
      {role === 'editor' && <p className="text-[12px] text-ink-muted">You can view and edit this tree. Changes save automatically.</p>}
      {role === 'viewer' && <p className="text-[12px] text-ink-muted">You can view this tree. Ask its owner if you’d like to edit too.</p>}
      {isOwner && <Members />}
      {isOwner && <Activity />}
      {email && <SignedInAs email={email} />}
      <a href={location.pathname} className="text-[12px] text-moss hover:underline">
        Open my private tree in this browser
      </a>
    </div>
  );
}

/** "today", "yesterday", "5 days ago", or the date for anything older than two weeks. */
function ago(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The owner's activity log: who signed in, opened, edited and backed up the tree, and when. */
function Activity() {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => void treeActivity().then(setRows, (e: Error) => setErr(e.message)), []);
  const latest = (k: keyof ActivityRow) =>
    rows?.map((r) => r[k] as string | null).filter(Boolean).sort().at(-1) ?? null;
  const backup = latest('last_export');
  const backupOld = !backup || Date.now() - new Date(backup).getTime() > 30 * 86_400_000;
  return (
    <div className="flex flex-col gap-1.5 border-t border-rule pt-3">
      <span className="label-caps !text-[10px]">Activity</span>
      {err && <p className={errText}>{err}</p>}
      {rows && (
        <>
          <p className={`text-[12px] ${backupOld ? 'text-[#9A3B2F]' : 'text-ink-muted'}`}>
            Last backup: {ago(backup)}
            {backupOld && ' · use Archive → Export archive to save a copy'}
          </p>
          <ul className="flex flex-col gap-1">
            {rows.map((r) => (
              <li key={r.email} className="text-[12px] leading-snug">
                <span className="block truncate">{r.role === 'owner' ? 'You' : r.email}</span>
                <span className="block text-[11px] text-ink-muted">
                  signed in {ago(r.last_sign_in)} · opened {ago(r.last_seen)} · edited {ago(r.last_edit)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] leading-snug text-ink-muted">
            The free plan pauses the tree after a week with no use; a daily check emails you before that and when a backup is due.
          </p>
        </>
      )}
    </div>
  );
}

function RoleSelect({ value, onChange, label }: { value: Member['role']; onChange(r: Member['role']): void; label: string }) {
  return (
    <select className="select shrink-0 !text-[12px]" value={value} onChange={(e) => onChange(e.target.value as Member['role'])} aria-label={label}>
      <option value="editor">Can edit</option>
      <option value="viewer">Can view</option>
    </select>
  );
}

function Members() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Member['role']>('editor');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => listMembers().then(setMembers, (e: Error) => setErr(e.message));
  useEffect(() => void refresh(), []);
  const act = async (f: () => Promise<void>) => {
    setErr(null);
    try {
      await f();
      await refresh();
    } catch (x) {
      setErr((x as Error).message);
    }
  };
  return (
    <div className="flex flex-col gap-2 border-t border-rule pt-3">
      <span className="label-caps !text-[10px]">Who can open it</span>
      <form
        className="flex flex-col gap-1.5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await act(async () => {
            await addMember(email, role);
            setEmail('');
          });
          setBusy(false);
        }}
      >
        <input required type="email" className="field" placeholder="Their email address" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email address to invite" />
        <div className="flex gap-1.5">
          <RoleSelect value={role} onChange={setRole} label="What they can do" />
          <button type="submit" className="btn flex-1 justify-center" disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />} Invite
          </button>
        </div>
      </form>
      {err && <p role="alert" className={errText}>{err}</p>}
      <ul className="flex flex-col gap-1">
        <li className="text-[12px] text-ink-muted">You (owner)</li>
        {members?.map((m) => (
          <li key={m.email} className="flex items-center gap-1.5 text-[12.5px]">
            <span className="min-w-0 flex-1 truncate">{m.email}</span>
            <RoleSelect value={m.role} onChange={(r) => void act(() => setMemberRole(m.email, r))} label={`What ${m.email} can do`} />
            <button
              type="button"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-mist hover:text-[#9A3B2F]"
              aria-label={`Remove ${m.email}`}
              onClick={() => void act(() => removeMember(m.email))}
            >
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>
      <p className="text-[11.5px] leading-snug text-ink-muted">
        Inviting doesn’t send an email: send them the link above yourself. They open it and sign in with the email you entered here.
      </p>
    </div>
  );
}
