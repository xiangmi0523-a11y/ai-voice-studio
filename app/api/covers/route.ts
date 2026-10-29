import { NextResponse } from "next/server";
import { COVER_MODEL } from "@/lib/config";
import { errorResponse, webhookUrl } from "@/lib/http";
import { createPrediction } from "@/lib/replicate";
import { listVoices, newId, writeJson, type CoverMeta } from "@/lib/store";

const PITCH_CHANGES = ["no-change", "male-to-female", "female-to-male"];

/** Turn an uploaded song into a cover sung with one of the trained voices. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      title?: string;
      voiceId?: string;
      songUrl?: string;
      pitchChange?: string;
      semitones?: number;
      vocalsVolume?: number;
      instrumentalVolume?: number;
      indexRate?: number;
    };
    if (!body.songUrl) return NextResponse.json({ error: "缺少歌曲文件" }, { status: 400 });
    const voice = (await listVoices(false)).find((v) => v.id === body.voiceId);
    if (!voice?.modelUrl) {
      return NextResponse.json({ error: "这个声音模型还没训练好" }, { status: 400 });
    }

    const options = {
      pitch_change: PITCH_CHANGES.includes(body.pitchChange || "") ? body.pitchChange : "no-change",
      pitch_change_all: clamp(body.semitones ?? 0, -12, 12),
      main_vocals_volume_change: clamp(body.vocalsVolume ?? 0, -20, 20),
      instrumental_volume_change: clamp(body.instrumentalVolume ?? 0, -20, 20),
      index_rate: clamp(body.indexRate ?? 0.5, 0, 1),
    };
    const id = newId();
    const prediction = await createPrediction(
      COVER_MODEL,
      {
        song_input: body.songUrl,
        custom_rvc_model_download_url: voice.modelUrl,
        output_format: "mp3",
        ...options,
      },
      await webhookUrl(request, "covers", id),
    );
    const meta: CoverMeta = {
      id,
      title: body.title?.trim() || "未命名翻唱",
      voiceId: voice.id,
      voiceName: voice.name,
      createdAt: new Date().toISOString(),
      predictionId: prediction.id,
      songUrl: body.songUrl,
      options,
    };
    await writeJson(`covers/${id}/meta.json`, meta);
    return NextResponse.json({ cover: { ...meta, status: "working" } });
  } catch (e) {
    return errorResponse(e);
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(Number(n) || 0, min), max);
}
