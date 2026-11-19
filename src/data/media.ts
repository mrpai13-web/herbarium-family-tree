/** Client-side media processing: image compression, audio analysis, blob URL cache. */
import { computePeaks, encodeWav } from '../core/waveform';
import { db } from './db';
import { fetchRemoteMedia, sharedRepo } from '../sync/config';
import type { MediaRecord } from '../core/types';

export const IMAGE_MAX = 1600;
export const THUMB_MAX = 360;
export const ACCEPT_IMAGE = 'image/jpeg,image/png,image/webp,image/gif,image/heic,image/avif';
export const ACCEPT_AUDIO = 'audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/webm,.m4a,.mp3,.wav';

export interface CompressedImage {
  blob: Blob;
  thumb: Blob;
  width: number;
  height: number;
  mime: string;
}

/**
 * Resize to at most IMAGE_MAX on the long edge and re-encode (WebP where the
 * browser supports it, otherwise JPEG), plus a THUMB_MAX thumbnail for cards.
 * A 12 MP phone photo (~4 MB) typically ends up around 200-350 KB.
 */
export async function compressImage(file: Blob): Promise<CompressedImage> {
  const bmp = await loadBitmap(file);
  const main = await drawScaled(bmp, IMAGE_MAX, 0.84);
  const thumb = await drawScaled(bmp, THUMB_MAX, 0.8);
  if ('close' in bmp) (bmp as ImageBitmap).close();
  return { blob: main.blob, thumb: thumb.blob, width: main.w, height: main.h, mime: main.blob.type };
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  } catch {
    // Fallback (e.g. SVG placeholders): decode through an <img>.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

async function drawScaled(src: ImageBitmap | HTMLImageElement, max: number, quality: number) {
  const sw = 'naturalWidth' in src ? src.naturalWidth || 800 : src.width;
  const sh = 'naturalHeight' in src ? src.naturalHeight || 600 : src.height;
  const scale = Math.min(1, max / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  let blob = await toBlob(canvas, 'image/webp', quality);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', quality);
  if (!blob) throw new Error('This image could not be converted. Try a JPEG or PNG.');
  return { blob, w, h };
}

const toBlob = (c: HTMLCanvasElement, type: string, q: number) =>
  new Promise<Blob | null>((res) => c.toBlob(res, type, q));

export interface AnalysedAudio {
  duration: number;
  peaks: number[];
}

export async function analyseAudio(blob: Blob): Promise<AnalysedAudio> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    return { duration: buf.duration, peaks: computePeaks(buf.getChannelData(0), 72) };
  } finally {
    void ctx.close();
  }
}

/* ------------------------------------------------------------ URL cache */

const urls = new Map<string, string>();

/** Object URL for a media record's main blob (or thumbnail). Cached per session. */
export async function mediaUrl(id: string, which: 'blob' | 'thumb' = 'blob'): Promise<string | undefined> {
  const key = id + ':' + which;
  const hit = urls.get(key);
  if (hit) return hit;
  const rec = await db.media.get(id);
  if (!rec) return undefined;
  let b: Blob | undefined = which === 'thumb' ? rec.thumb ?? rec.blob : rec.blob;
  // A shared tree's file not downloaded yet: fetch it once, then it's cached locally.
  if (!b && sharedRepo) b = await fetchRemoteMedia(id, which).catch(() => undefined);
  if (!b) return undefined;
  if (urls.has(key)) return urls.get(key);
  const url = URL.createObjectURL(b);
  urls.set(key, url);
  return url;
}

const hasThumb = (r: MediaRecord) => Boolean((r as MediaRecord & { hasThumb?: boolean }).hasThumb);

/** A media file's bytes, downloading it first if it lives only on the server (shared tree). */
export async function mediaBlob(rec: MediaRecord, which: 'blob' | 'thumb'): Promise<Blob | undefined> {
  const local = which === 'thumb' ? rec.thumb : rec.blob;
  if (local) return local;
  if (rec.blob || !sharedRepo || (which === 'thumb' && !hasThumb(rec))) return undefined;
  const b = await fetchRemoteMedia(rec.id, which);
  if (!b) throw new Error(`Couldn’t download “${rec.title ?? rec.caption ?? 'a file'}”.`);
  return b;
}

export function forgetMediaUrl(id: string) {
  for (const which of ['blob', 'thumb']) {
    const key = id + ':' + which;
    const u = urls.get(key);
    if (u) URL.revokeObjectURL(u);
    urls.delete(key);
  }
}

export function forgetAllMediaUrls() {
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
}

/* ------------------------------------------------------ placeholder media */

/** A soft illustrated "photo" (SVG) for seed data: sky, hills, a few figures. */
export function placeholderPhoto(seed: number, people = 2): Blob {
  const skies = [
    ['#9BB7C9', '#DCE6EA', '#6F8A5B'],
    ['#C9B9A6', '#E9DFD2', '#8D7B69'],
    ['#7FB2D6', '#CFE4EE', '#B9A577'],
    ['#B8C4A8', '#E8ECDD', '#5E7A50'],
  ];
  const [s1, s2, gr] = skies[seed % skies.length];
  const figs = Array.from({ length: people }, (_, i) => {
    const x = 400 - (people - 1) * 55 + i * 110;
    const h = 150 + ((seed * 7 + i * 13) % 40);
    return `<circle cx="${x}" cy="${560 - h - 34}" r="30"/><rect x="${x - 38}" y="${560 - h}" width="76" height="${h + 40}" rx="34"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 640" width="800" height="640">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s1}"/><stop offset="1" stop-color="${s2}"/></linearGradient></defs>
<rect width="800" height="640" fill="url(#s)"/><circle cx="${560 + (seed % 3) * 50}" cy="150" r="54" fill="#F3E2B5" opacity=".8"/>
<path d="M0 470Q200 ${380 + (seed % 4) * 20} 420 450T800 430V640H0Z" fill="${gr}"/>
<g fill="rgba(35,28,20,.55)">${figs}</g></svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}

/** A gentle synthesized music-box phrase standing in for a recorded memory. */
export function placeholderAudio(seed: number, seconds = 9): { blob: Blob; samples: Float32Array; rate: number } {
  const rate = 22050;
  const n = Math.floor(rate * seconds);
  const out = new Float32Array(n);
  const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33];
  const step = 0.42;
  let s = seed * 9301 + 49297;
  for (let t0 = 0; t0 < seconds - 0.6; t0 += step) {
    s = (s * 9301 + 49297) % 233280;
    const f = scale[s % scale.length];
    const start = Math.floor(t0 * rate);
    const len = Math.floor(1.4 * rate);
    for (let i = 0; i < len && start + i < n; i++) {
      const t = i / rate;
      const env = Math.exp(-t * 3.2) * Math.min(1, t * 200);
      out[start + i] += 0.22 * env * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t));
    }
  }
  for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i]);
  return { blob: new Blob([encodeWav(out, rate)], { type: 'audio/wav' }), samples: out, rate };
}
