import { Mic, Pause, Play, Square, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { MediaMeta, Person } from '../core/types';
import { formatTime } from '../core/waveform';
import { ACCEPT_AUDIO } from '../data/media';
import { useStore } from '../data/store';
import { DropZone, EditableText } from '../ui/bits';
import { confirmDeleteMedia } from '../data/deletes';
import { DateInput } from '../ui/DateInput';
import { Hint } from '../ui/Hint';
import { useMediaUrl } from '../ui/useMediaUrl';

/** Only one memory plays at a time. */
let current: HTMLAudioElement | null = null;

export function AudioCard({ m }: { m: MediaMeta }) {
  const url = useMediaUrl(m.id);
  const updateMedia = useStore((s) => s.updateMedia);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const dur = m.duration ?? 0;
  const peaks = m.peaks ?? new Array(64).fill(0.3);

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    let raf = 0;
    const loop = () => {
      setT(a.currentTime);
      raf = requestAnimationFrame(loop);
    };
    const onPlay = () => {
      if (current && current !== a) current.pause();
      current = a;
      setPlaying(true);
      raf = requestAnimationFrame(loop);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(raf);
      setT(a.currentTime);
    };
    const onEnd = () => {
      onPause();
      a.currentTime = 0;
      setT(0);
    };
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('ended', onEnd);
    return () => {
      cancelAnimationFrame(raf);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('ended', onEnd);
      a.pause();
    };
  }, [url]);

  const progress = dur ? t / dur : 0;
  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    const a = audio.current;
    if (!a || !dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = Math.max(0, Math.min(dur, ((e.clientX - r.left) / r.width) * dur));
    setT(a.currentTime);
  };

  return (
    <div className="rounded-[24px_8px_24px_8px] border border-rule bg-card p-3.5" data-media-id={m.id}>
      <audio ref={audio} src={url} preload="metadata" />
      <EditableText
        id={`au-title-${m.id}`}
        label="Memory title"
        value={m.title ?? ''}
        placeholder="Name this memory"
        hint="A short title, e.g. Grandad on the night shift. Saves when you press Enter."
        className="-mx-2 font-display text-[16px] text-ink"
        onCommit={(v) => updateMedia(m.id, { title: v })}
      />
      <div className="mt-0.5 flex items-center gap-1 font-label text-[11px] text-ink-muted">
        <span>Recorded</span>
        <DateInput
          id={`au-date-${m.id}`}
          label="Date recorded"
          value={m.recordedAt}
          placeholder="add a date"
          hint="When this was recorded. Type it or use the calendar."
          className="!w-28 !px-1 !py-0 font-label text-[11px]"
          onCommit={(v) => updateMedia(m.id, { recordedAt: v })}
        />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => (playing ? audio.current?.pause() : void audio.current?.play())}
          disabled={!url}
          aria-label={`${playing ? 'Pause' : 'Play'} “${m.title || 'memory'}”`}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-moss text-card transition-transform hover:bg-moss-deep active:scale-95"
        >
          {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" className="ml-0.5" />}
        </button>
        <div
          className="flex h-10 min-w-0 flex-1 cursor-pointer items-center gap-[2px]"
          onPointerDown={seek}
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(dur)}
          aria-valuenow={Math.round(t)}
          aria-valuetext={`${formatTime(t)} of ${formatTime(dur)}`}
          onKeyDown={(e) => {
            const a = audio.current;
            if (!a) return;
            if (e.key === 'ArrowRight') a.currentTime = Math.min(dur, a.currentTime + 5);
            if (e.key === 'ArrowLeft') a.currentTime = Math.max(0, a.currentTime - 5);
            setT(a.currentTime);
          }}
        >
          {peaks.map((p, i) => (
            <i
              key={i}
              className="block min-w-px flex-1 rounded-[3px] transition-colors duration-100"
              style={{ height: `${Math.max(8, p * 100)}%`, background: i / peaks.length < progress ? '#3E6B48' : '#C6D0B9' }}
            />
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="font-label text-[11px] tabular-nums text-ink-muted">
          {formatTime(t)} / {formatTime(dur)}
        </span>
        <button
          type="button"
          className="flex items-center gap-1 rounded-leaf-sm border border-transparent px-2 py-1 text-[11px] font-semibold text-ink-muted hover:border-rule"
          aria-label="Delete this memory"
          aria-keyshortcuts="Delete"
          onClick={() => void confirmDeleteMedia(m.id)}
        >
          <Trash2 size={12} /> Delete
        </button>
      </div>
    </div>
  );
}

function pickMime(): string | undefined {
  const opts = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return opts.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
}

type RecState = { kind: 'idle' } | { kind: 'recording'; start: number } | { kind: 'review'; blob: Blob; url: string; secs: number };

/** Record in the browser (MediaRecorder) or upload MP3 / WAV / M4A. */
export function AudioMemories({ person, memories }: { person: Person; memories: MediaMeta[] }) {
  const addAudio = useStore((s) => s.addAudio);
  const toast = useStore((s) => s.toast);
  const [st, setSt] = useState<RecState>({ kind: 'idle' });
  const [title, setTitle] = useState('');
  const [levels, setLevels] = useState<number[]>(() => new Array(40).fill(0.05));
  const [now, setNow] = useState(0);
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; ctx: AudioContext; raf: number } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => () => stopAll(), []);
  useEffect(() => {
    setSt((s) => (s.kind === 'review' ? (URL.revokeObjectURL(s.url), { kind: 'idle' }) : s));
    stopAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person.id]);

  function stopAll() {
    const r = rec.current;
    if (!r) return;
    cancelAnimationFrame(r.raf);
    if (r.mr.state !== 'inactive') r.mr.stop();
    r.stream.getTracks().forEach((t) => t.stop());
    void r.ctx.close();
    rec.current = null;
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast('This browser can’t record audio. Upload a file instead.', 'error');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      toast('Microphone access was blocked. Allow it in the browser’s address bar, then try again.', 'error');
      return;
    }
    const mime = pickMime();
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const startedAt = performance.now();
    mr.onstop = () => {
      const blob = new Blob(chunks, { type: mr.mimeType || mime || 'audio/webm' });
      setSt({ kind: 'review', blob, url: URL.createObjectURL(blob), secs: (performance.now() - startedAt) / 1000 });
    };
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const hist: number[] = new Array(40).fill(0.05);
    let last = 0;
    const loop = (t: number) => {
      an.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
      if (t - last > 70) {
        hist.push(Math.max(0.05, Math.min(1, peak * 1.6)));
        hist.shift();
        setLevels([...hist]);
        setNow((performance.now() - startedAt) / 1000);
        last = t;
      }
      if (rec.current) rec.current.raf = requestAnimationFrame(loop);
    };
    rec.current = { mr, stream, ctx, raf: 0 };
    mr.start(250);
    setSt({ kind: 'recording', start: startedAt });
    setTitle('');
    rec.current.raf = requestAnimationFrame(loop);
  }

  function stop() {
    const r = rec.current;
    if (!r) return;
    cancelAnimationFrame(r.raf);
    r.mr.stop();
    r.stream.getTracks().forEach((t) => t.stop());
    void r.ctx.close();
    rec.current = null;
  }

  async function save() {
    if (st.kind !== 'review') return;
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await addAudio(person.id, st.blob, title.trim() || `Memory of ${person.givenName || 'them'}`, date);
    URL.revokeObjectURL(st.url);
    setSt({ kind: 'idle' });
  }

  async function onFiles(files: File[]) {
    for (const f of files) {
      await addAudio(person.id, f, f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '), undefined);
    }
  }

  const isAudio = (f: File) => f.type.startsWith('audio/') || /\.(m4a|mp3|wav|aac|ogg|webm)$/i.test(f.name);

  return (
    <DropZone onFiles={onFiles} accept={isAudio} className="flex flex-col gap-3 rounded-leaf-md">
      {st.kind === 'idle' && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-solid" onClick={start}>
            <Mic size={15} /> Record a memory
          </button>
          <button type="button" className="btn" onClick={() => file.current?.click()}>
            <Upload size={15} /> Upload audio
          </button>
          <input
            ref={file}
            type="file"
            accept={ACCEPT_AUDIO}
            multiple
            hidden
            onChange={(e) => {
              const fs = [...(e.target.files ?? [])];
              e.target.value = '';
              if (fs.length) void onFiles(fs);
            }}
          />
        </div>
      )}

      {st.kind === 'recording' && (
        <div className="rounded-[24px_8px_24px_8px] border border-petal/50 bg-card p-3.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 font-label text-[12px] font-bold uppercase tracking-widest text-petal">
              <i className="block h-2.5 w-2.5 animate-pulse rounded-full bg-petal" /> Recording
            </span>
            <span className="font-label text-[12px] tabular-nums text-ink-muted">{formatTime(now)}</span>
          </div>
          <div className="mt-3 flex h-12 items-center gap-[3px]" aria-hidden="true">
            {levels.map((l, i) => (
              <i key={i} className="block flex-1 rounded-[3px] bg-petal/70" style={{ height: `${l * 100}%` }} />
            ))}
          </div>
          <button type="button" className="btn mt-3 !border-petal !text-petal" onClick={stop}>
            <Square size={13} fill="currentColor" /> Stop
          </button>
        </div>
      )}

      {st.kind === 'review' && (
        <div className="rounded-[24px_8px_24px_8px] border border-rule bg-card p-3.5">
          <p className="label-caps">New recording · {formatTime(st.secs)}</p>
          <audio src={st.url} controls className="mt-2 w-full" />
          <label htmlFor="new-mem-title" className="mt-3 block text-[12px] font-semibold text-ink-soft">
            Title
          </label>
          <Hint text="Name it so it's easy to find later. You can change it afterwards.">
          <input
            id="new-mem-title"
            className="mt-1 w-full rounded-leaf-sm border border-rule bg-paper px-2 py-1.5 font-display text-[15px] focus:border-moss focus:outline-none"
            placeholder="e.g. Grandma on her first job"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
          />
          </Hint>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn-solid" onClick={save}>
              Save memory
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                URL.revokeObjectURL(st.url);
                setSt({ kind: 'idle' });
              }}
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {memories.map((m) => (
        <AudioCard key={m.id} m={m} />
      ))}
      {memories.length === 0 && st.kind === 'idle' && (
        <p className="text-[13px] leading-relaxed text-ink-muted">
          No voice memories yet. Ask {person.givenName || 'them'} about a favourite place, or record someone telling a story about them. You can also drop
          MP3, WAV or M4A files here.
        </p>
      )}
    </DropZone>
  );
}
