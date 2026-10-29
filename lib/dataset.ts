// Runs in the browser: turns the user's dry-vocal files into the zip layout
// replicate/train-rvc-model expects (dataset/<name>/split_<i>.wav).

import { zipSync } from "fflate";

const SAMPLE_RATE = 44100;
const CLIP_SECONDS = 10;
const SILENCE_RMS = 0.005;

export async function buildDataset(
  files: File[],
  onProgress?: (text: string) => void,
): Promise<{ zip: Blob; seconds: number; clips: number }> {
  // decodeAudioData resamples to the context's rate, so no separate resampling step.
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const entries: Record<string, Uint8Array> = {};
  let clips = 0;
  let seconds = 0;
  try {
    for (const [i, file] of files.entries()) {
      onProgress?.(`正在处理第 ${i + 1}/${files.length} 个文件…`);
      const audio = await ctx.decodeAudioData(await file.arrayBuffer());
      const mono = toMono(audio);
      const size = CLIP_SECONDS * SAMPLE_RATE;
      for (let start = 0; start < mono.length; start += size) {
        const clip = mono.subarray(start, Math.min(start + size, mono.length));
        if (clip.length < 2 * SAMPLE_RATE || rms(clip) < SILENCE_RMS) continue;
        entries[`dataset/myvoice/split_${clips}.wav`] = encodeWav(clip);
        clips++;
        seconds += clip.length / SAMPLE_RATE;
      }
    }
  } finally {
    ctx.close();
  }
  if (!clips) throw new Error("没有找到有效的声音，文件可能是静音或格式不支持");
  onProgress?.("正在打包…");
  const zipped = zipSync(entries, { level: 0 });
  return { zip: new Blob([zipped as BlobPart], { type: "application/zip" }), seconds, clips };
}

function toMono(audio: AudioBuffer): Float32Array {
  if (audio.numberOfChannels === 1) return audio.getChannelData(0);
  const out = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += data[i] / audio.numberOfChannels;
  }
  return out;
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
