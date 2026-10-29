// Minimal Replicate REST client. Everything that talks to Replicate goes through here,
// so filling in REPLICATE_API_TOKEN later is the only change needed to turn it on.

const API = "https://api.replicate.com/v1";

export type Prediction = {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output: unknown;
  error: string | null;
  logs?: string;
};

export class ReplicateNotConfiguredError extends Error {
  constructor() {
    super("还没有配置 REPLICATE_API_TOKEN，暂时不能训练或生成翻唱。");
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new ReplicateNotConfiguredError();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401) throw new Error("Replicate 拒绝了 API Token，请检查是否填对。");
    if (res.status === 402) throw new Error("Replicate 账户余额不足或没有绑定付款方式。");
    throw new Error(`Replicate 返回错误 ${res.status}：${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

/** Accepts "owner/name" (uses the latest version) or "owner/name:version". */
async function resolveVersion(model: string): Promise<string> {
  const [name, version] = model.split(":");
  if (version) return version;
  const info = await call<{ latest_version: { id: string } | null }>(`/models/${name}`);
  if (!info.latest_version) throw new Error(`Replicate 模型 ${name} 没有可用版本`);
  return info.latest_version.id;
}

export async function createPrediction(
  model: string,
  input: Record<string, unknown>,
  webhook?: string,
): Promise<Prediction> {
  const version = await resolveVersion(model);
  return call<Prediction>("/predictions", {
    method: "POST",
    body: JSON.stringify({
      version,
      input,
      ...(webhook ? { webhook, webhook_events_filter: ["completed"] } : {}),
    }),
  });
}

export async function getPrediction(id: string): Promise<Prediction> {
  return call<Prediction>(`/predictions/${id}`);
}

/** Both models return a single file URI, but tolerate list outputs too. */
export function outputUrl(p: Prediction): string | null {
  const out = Array.isArray(p.output) ? p.output[p.output.length - 1] : p.output;
  return typeof out === "string" ? out : null;
}
