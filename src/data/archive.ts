/**
 * Backup format. A .zip holding:
 *   archive.json            graph + media metadata (format "herbarium-family-archive", version 1)
 *   media/<id>.<ext>        original/compressed binary
 *   media/<id>.thumb.<ext>  card thumbnail (images)
 * A single-file .json variant embeds the binaries as base64 instead.
 */
import { strFromU8, strToU8, unzip, zip, type Zippable } from 'fflate';
import type { FamilyGraph, MediaMeta, MediaRecord } from '../core/types';
import { db } from './db';

export const FORMAT = 'herbarium-family-archive';
export const VERSION = 1;

interface ArchiveMediaEntry extends MediaMeta {
  file: string;
  thumbFile?: string;
  /** Only in the .json variant. */
  data?: string;
  thumbData?: string;
}

interface ArchiveJson {
  format: typeof FORMAT;
  version: number;
  exportedAt: string;
  graph: FamilyGraph;
  media: ArchiveMediaEntry[];
}

const EXT: Record<string, string> = {
  'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/svg+xml': 'svg', 'image/gif': 'gif',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/aac': 'aac',
};
const ext = (mime: string) => EXT[mime.split(';')[0]] ?? 'bin';

export async function exportArchive(graph: FamilyGraph, kind: 'zip' | 'json'): Promise<Blob> {
  const records = await db.media.toArray();
  const entries: ArchiveMediaEntry[] = [];
  const files: Zippable = {};
  for (const r of records) {
    const { blob, thumb, ...meta } = r;
    const e: ArchiveMediaEntry = { ...meta, file: `media/${r.id}.${ext(blob.type || r.mime)}` };
    if (thumb && thumb !== blob) e.thumbFile = `media/${r.id}.thumb.${ext(thumb.type)}`;
    if (kind === 'zip') {
      files[e.file] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
      if (e.thumbFile && thumb) files[e.thumbFile] = [new Uint8Array(await thumb.arrayBuffer()), { level: 0 }];
    } else {
      e.data = await toBase64(blob);
      if (e.thumbFile && thumb) e.thumbData = await toBase64(thumb);
    }
    entries.push(e);
  }
  const json: ArchiveJson = { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), graph, media: entries };
  if (kind === 'json') return new Blob([JSON.stringify(json)], { type: 'application/json' });
  files['archive.json'] = [strToU8(JSON.stringify(json, null, 1)), { level: 6 }];
  const out = await new Promise<Uint8Array>((res, rej) => zip(files, (err, data) => (err ? rej(err) : res(data))));
  return new Blob([out], { type: 'application/zip' });
}

export interface ImportedArchive {
  graph: FamilyGraph;
  media: MediaRecord[];
  exportedAt?: string;
}

export async function importArchive(file: File): Promise<ImportedArchive> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  if (!isZip) {
    const json = parseJson(new TextDecoder().decode(buf));
    const media = json.media.map((e) => {
      if (!e.data) throw new Error(`The archive is missing the file for “${e.title ?? e.caption ?? e.id}”.`);
      const blob = fromBase64(e.data, e.mime);
      return toRecord(e, blob, e.thumbData ? fromBase64(e.thumbData, 'image/webp') : undefined);
    });
    return { graph: json.graph, media, exportedAt: json.exportedAt };
  }
  const files = await new Promise<Record<string, Uint8Array>>((res, rej) => unzip(buf, (err, d) => (err ? rej(err) : res(d))));
  if (!files['archive.json']) throw new Error('This zip has no archive.json, so it isn’t a family archive backup.');
  const json = parseJson(strFromU8(files['archive.json']));
  const media = json.media.map((e) => {
    const bin = files[e.file];
    if (!bin) throw new Error(`The archive is missing ${e.file}.`);
    const thumbBin = e.thumbFile ? files[e.thumbFile] : undefined;
    return toRecord(
      e,
      new Blob([bin], { type: e.mime }),
      thumbBin ? new Blob([thumbBin], { type: mimeFromName(e.thumbFile!) }) : undefined,
    );
  });
  return { graph: json.graph, media, exportedAt: json.exportedAt };
}

function parseJson(text: string): ArchiveJson {
  let j: ArchiveJson;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error('This file isn’t valid JSON.');
  }
  if (j.format !== FORMAT) throw new Error('This file isn’t a family archive backup made by this app.');
  if (j.version > VERSION) throw new Error(`This backup was made by a newer version (format ${j.version}). Update the app first.`);
  if (!j.graph?.people) throw new Error('This backup has no people in it.');
  return j;
}

function toRecord(e: ArchiveMediaEntry, blob: Blob, thumb?: Blob): MediaRecord {
  const { file: _f, thumbFile: _tf, data: _d, thumbData: _td, ...meta } = e;
  return { ...meta, blob, thumb: thumb ?? (e.kind === 'image' ? blob : undefined) };
}

function mimeFromName(name: string): string {
  const e = name.split('.').pop() ?? '';
  return Object.entries(EXT).find(([, v]) => v === e)?.[0] ?? 'application/octet-stream';
}

async function toBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(data: string, mime: string): Blob {
  const s = atob(data);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Save with the native "Save as" dialog where available, else a normal download. */
export async function saveFile(blob: Blob, suggestedName: string): Promise<'saved' | 'cancelled'> {
  const w = window as unknown as {
    showSaveFilePicker?: (o: unknown) => Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }>;
  };
  if (w.showSaveFilePicker) {
    try {
      const isZip = suggestedName.endsWith('.zip');
      const handle = await w.showSaveFilePicker({
        suggestedName,
        types: [{ description: isZip ? 'Family archive (zip)' : 'Family archive (json)', accept: isZip ? { 'application/zip': ['.zip'] } : { 'application/json': ['.json'] } }],
      });
      const out = await handle.createWritable();
      await out.write(blob);
      await out.close();
      return 'saved';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled';
      // Fall through to a download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'saved';
}
