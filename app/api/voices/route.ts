import { NextResponse } from "next/server";
import { TRAIN_MODEL } from "@/lib/config";
import { errorResponse, webhookUrl } from "@/lib/http";
import { createPrediction } from "@/lib/replicate";
import { newId, writeJson, type VoiceMeta } from "@/lib/store";

/** Start training a voice model from a dataset zip already uploaded to Blob. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: string;
      datasetUrl?: string;
      epoch?: number;
      seconds?: number;
    };
    if (!body.datasetUrl) return NextResponse.json({ error: "缺少声音样本" }, { status: 400 });
    const epoch = Math.min(Math.max(Math.round(body.epoch || 50), 5), 200);
    const id = newId();
    const prediction = await createPrediction(
      TRAIN_MODEL,
      {
        dataset_zip: body.datasetUrl,
        sample_rate: "48k",
        version: "v2",
        f0method: "rmvpe_gpu",
        epoch,
        batch_size: "7",
      },
      await webhookUrl(request, "voices", id),
    );
    const meta: VoiceMeta = {
      id,
      name: body.name?.trim() || "我的声音",
      createdAt: new Date().toISOString(),
      predictionId: prediction.id,
      epoch,
      seconds: body.seconds || 0,
      datasetUrl: body.datasetUrl,
    };
    await writeJson(`voices/${id}/meta.json`, meta);
    return NextResponse.json({ voice: { ...meta, status: "working" } });
  } catch (e) {
    return errorResponse(e);
  }
}
