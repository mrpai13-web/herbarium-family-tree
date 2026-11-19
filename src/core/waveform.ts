/** Downsample PCM samples to `bars` peak values in 0..1 (normalised to the loudest bar). */
export function computePeaks(samples: Float32Array, bars = 64): number[] {
  if (samples.length === 0) return new Array(bars).fill(0.05);
  const size = samples.length / bars;
  const out: number[] = [];
  for (let b = 0; b < bars; b++) {
    const start = Math.floor(b * size);
    const end = Math.max(start + 1, Math.floor((b + 1) * size));
    let peak = 0;
    let sumSq = 0;
    for (let i = start; i < end && i < samples.length; i++) {
      const v = Math.abs(samples[i]);
      if (v > peak) peak = v;
      sumSq += v * v;
    }
    // Blend peak and RMS: pure peaks look spiky, pure RMS looks flat.
    out.push(peak * 0.5 + Math.sqrt(sumSq / (end - start)) * 0.5);
  }
  const max = Math.max(...out, 1e-6);
  return out.map((v) => Math.max(0.04, Math.round((v / max) * 1000) / 1000));
}

/** Encode mono float PCM as a 16-bit WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
