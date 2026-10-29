// Runs in the browser: turns the user's dry-vocal files into the zip layout
// replicate/train-rvc-model expects (dataset/<name>/<clip>.wav), falling back to
// the original files when the browser can't decode them.

import { zipSync } from "fflate";

const SAMPLE_RATE = 44100;
const CLIP_SECONDS = 10;
const SILENCE_RMS = 0.005;

export async function buildDataset(
  files: File[],
  onProgress?: (text: string) => void,
): Promise<{ zip: Blob; seconds: number; clips: number }> {
  const entries: Record<string, Uint8Array> = {};
  let clips = 0;
  let seconds = 0;
  for (const [i, file] of files.entries()) {
    onProgress?.(`正在处理第 ${i + 1}/${files.length} 个文件…`);
    const mono = await decodeMono(file);
    if (!mono) {
      // The phone browser can't decode this format (common on iOS). The trainer
      // decodes with ffmpeg, so pass the original file through untouched.
      const ext = file.name.split(".").pop()?.toLowerCase() || "m4a";
      entries[`dataset/myvoice/raw_${i}.${ext}`] = new Uint8Array(await file.arrayBuffer());
      clips++;
      seconds += await probeDuration(file);
      continue;
    }
    const size = CLIP_SECONDS * SAMPLE_RATE;
    for (let start = 0; start < mono.length; start += size) {
      const clip = mono.subarray(start, Math.min(start + size, mono.length));
      if (clip.length < 2 * SAMPLE_RATE || rms(clip) < SILENCE_RMS) continue;
      entries[`dataset/myvoice/split_${clips}.wav`] = encodeWav(clip);
      clips++;
      seconds += clip.length / SAMPLE_RATE;
    }
  }
  if (!clips) throw new Error("没有找到有效的声音，文件可能是静音");
  onProgress?.("正在打包…");
  const zipped = zipSync(entries, { level: 0 });
  return { zip: new Blob([zipped as BlobPart], { type: "application/zip" }), seconds, clips };
}

/** Decode at the device's native rate, then downmix and resample; null if the browser can't decode it. */
async function decodeMono(file: File): Promise<Float32Array | null> {
  let decoded: AudioBuffer;
  const ctx = new AudioContext();
  try {
    decoded = await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    return null;
  } finally {
    ctx.close();
  }
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  return (await offline.startRendering()).getChannelData(0);
}

/** Length of a file the Web Audio API couldn't decode; 0 if the media element can't tell either. */
function probeDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    const done = (n: number) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(n) ? n : 0);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => done(audio.duration);
    audio.onerror = () => done(0);
    setTimeout(() => done(0), 8000);
    audio.src = url;
  });
}

function rms(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
}

function encodeWav(samples: Float32Array): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, SAMPLE_RATE, true);
  v.setUint32(28, SAMPLE_RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}
