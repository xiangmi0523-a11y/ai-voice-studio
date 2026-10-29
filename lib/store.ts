// Records live in Vercel Blob as write-once files, so no database is needed:
//   voices/<id>/meta.json   created when training starts
//   voices/<id>/model.zip   the trained RVC model (present = ready)
//   voices/<id>/error.json  present = training failed
//   covers/<id>/meta.json, covers/<id>/output.<ext>, covers/<id>/error.json  likewise
// Status comes from list(), which is never CDN-cached, so nothing has to be overwritten.

import { del, list, put, type ListBlobResultBlob } from "@vercel/blob";
import { getPrediction, outputUrl, type Prediction } from "./replicate";

export type Kind = "voices" | "covers";

export type VoiceMeta = {
  id: string;
  name: string;
  createdAt: string;
  predictionId: string;
  epoch: number;
  seconds: number;
  datasetUrl: string;
};

export type CoverMeta = {
  id: string;
  title: string;
  voiceId: string;
  voiceName: string;
  createdAt: string;
  predictionId: string;
  songUrl: string;
  options: Record<string, unknown>;
};

export type Status = "working" | "ready" | "failed";

export type Voice = VoiceMeta & { status: Status; modelUrl?: string; error?: string };
export type Cover = CoverMeta & {
  status: Status;
  audioUrl?: string;
  downloadUrl?: string;
  error?: string;
};

const OUTPUT_FILE: Record<Kind, string> = { voices: "model.zip", covers: "output" };

export function newId(): string {
  const t = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `${t}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function writeJson(pathname: string, data: unknown) {
  await put(pathname, JSON.stringify(data), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

async function readJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`读取 ${url} 失败：${res.status}`);
  return res.json() as Promise<T>;
}

async function listAll(prefix: string): Promise<ListBlobResultBlob[]> {
  const blobs: ListBlobResultBlob[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

type Group = { meta?: ListBlobResultBlob; output?: ListBlobResultBlob; error?: ListBlobResultBlob };

async function groups(kind: Kind): Promise<Map<string, Group>> {
  const map = new Map<string, Group>();
  for (const blob of await listAll(`${kind}/`)) {
    const [, id, file] = blob.pathname.split("/");
    if (!id || !file) continue;
    const g = map.get(id) ?? {};
    if (file === "meta.json") g.meta = blob;
    else if (file === "error.json") g.error = blob;
    else if (file.startsWith(OUTPUT_FILE[kind])) g.output = blob;
    map.set(id, g);
  }
  return map;
}

/** Copy a finished prediction's output into Blob (Replicate deletes outputs after about an hour). */
export async function finalize(kind: Kind, id: string, prediction: Prediction) {
  if (prediction.status === "succeeded") {
    const url = outputUrl(prediction);
    if (!url) return writeJson(`${kind}/${id}/error.json`, { error: "Replicate 没有返回文件" });
    const res = await fetch(url);
    if (!res.ok || !res.body) {
      return writeJson(`${kind}/${id}/error.json`, { error: `下载结果失败：${res.status}` });
    }
    const ext = kind === "voices" ? "zip" : (new URL(url).pathname.split(".").pop() || "mp3");
    const name = kind === "voices" ? "model.zip" : `output.${ext}`;
    await put(`${kind}/${id}/${name}`, res.body, {
      access: "public",
      contentType: res.headers.get("content-type") || undefined,
      addRandomSuffix: false,
      allowOverwrite: true,
      multipart: true,
    });
  } else if (prediction.status === "failed" || prediction.status === "canceled") {
    await writeJson(`${kind}/${id}/error.json`, {
      error: prediction.error || (prediction.status === "canceled" ? "任务已取消" : "任务失败"),
    });
  }
}

/** Fallback in case a webhook never arrived (e.g. local dev): ask Replicate directly. */
async function sync(kind: Kind, id: string, predictionId: string): Promise<boolean> {
  if (!process.env.REPLICATE_API_TOKEN) return false;
  try {
    const p = await getPrediction(predictionId);
    if (p.status === "starting" || p.status === "processing") return false;
    await finalize(kind, id, p);
    return true;
  } catch (e) {
    console.error(`sync ${kind}/${id} failed`, e);
    return false;
  }
}

async function load<M extends { id: string; createdAt: string; predictionId: string }>(
  kind: Kind,
  syncPending: boolean,
): Promise<Array<M & { status: Status; output?: ListBlobResultBlob; error?: string }>> {
  let map = await groups(kind);
  if (syncPending) {
    const pending = [...map.values()].filter((g) => g.meta && !g.output && !g.error);
    const metas = await Promise.all(pending.map((g) => readJson<M>(g.meta!.url)));
    const changed = await Promise.all(metas.map((m) => sync(kind, m.id, m.predictionId)));
    if (changed.some(Boolean)) map = await groups(kind);
  }
  const items = await Promise.all(
    [...map.values()]
      .filter((g) => g.meta)
      .map(async (g) => {
        const meta = await readJson<M>(g.meta!.url);
        const error = g.error ? (await readJson<{ error: string }>(g.error.url)).error : undefined;
        const status: Status = g.output ? "ready" : error ? "failed" : "working";
        return { ...meta, status, output: g.output, error };
      }),
  );
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listVoices(syncPending = true): Promise<Voice[]> {
  const items = await load<VoiceMeta>("voices", syncPending);
  return items.map(({ output, ...v }) => ({ ...v, modelUrl: output?.url }));
}

export async function listCovers(syncPending = true): Promise<Cover[]> {
  const items = await load<CoverMeta>("covers", syncPending);
  return items.map(({ output, ...c }) => ({
    ...c,
    audioUrl: output?.url,
    downloadUrl: output?.downloadUrl,
  }));
}

/** Deletes a record, plus the file the user uploaded for it. */
export async function remove(kind: Kind, id: string) {
  const blobs = await listAll(`${kind}/${id}/`);
  const urls = blobs.map((b) => b.url);
  const meta = blobs.find((b) => b.pathname.endsWith("/meta.json"));
  if (meta) {
    const m = await readJson<Partial<VoiceMeta & CoverMeta>>(meta.url).catch(() => null);
    const upload = m?.datasetUrl || m?.songUrl;
    if (upload && new URL(upload).pathname.startsWith("/uploads/")) urls.push(upload);
  }
  if (urls.length) await del(urls);
}
