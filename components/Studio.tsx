"use client";

import { upload } from "@vercel/blob/client";
import { useCallback, useEffect, useState } from "react";
import { buildDataset } from "@/lib/dataset";
import type { ConfigStatus } from "@/lib/config";
import type { Cover, Voice } from "@/lib/store";

type State = { config: ConfigStatus; voices: Voice[]; covers: Cover[] };
type Tab = "voice" | "song" | "works";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) location.href = "/login";
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
  return data as T;
}

function uploadFile(file: Blob, name: string, onProgress: (pct: number) => void) {
  return upload(`uploads/${name}`, file, {
    access: "public",
    handleUploadUrl: "/api/upload",
    multipart: file.size > 20 * 1024 * 1024,
    onUploadProgress: (e) => onProgress(Math.round(e.percentage)),
  });
}

function safeName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_").slice(-60) || "file";
}

function fmtMinutes(seconds: number) {
  return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
}

export default function Studio({ initialConfig }: { initialConfig: ConfigStatus }) {
  const [state, setState] = useState<State>({ config: initialConfig, voices: [], covers: [] });
  const [tab, setTab] = useState<Tab>("voice");
  const [loadError, setLoadError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setState(await api<State>("/api/state"));
      setLoadError("");
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const busy = state.voices.some((v) => v.status === "working") ||
    state.covers.some((c) => c.status === "working");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [busy, refresh]);

  const { config } = state;
  return (
    <main className="wrap">
      <header className="top">
        <h1>AI 翻唱工坊</h1>
        {config.password && (
          <button
            className="link"
            onClick={async () => {
              await fetch("/api/logout", { method: "POST" });
              location.href = "/login";
            }}
          >
            退出
          </button>
        )}
      </header>

      <ConfigNotice config={config} />
      {loadError && <p className="error">{loadError}</p>}

      <nav className="tabs">
        <button className={tab === "voice" ? "on" : ""} onClick={() => setTab("voice")}>
          ① 我的声音
        </button>
        <button className={tab === "song" ? "on" : ""} onClick={() => setTab("song")}>
          ② 生成翻唱
        </button>
        <button className={tab === "works" ? "on" : ""} onClick={() => setTab("works")}>
          ③ 作品{state.covers.length ? `（${state.covers.length}）` : ""}
        </button>
      </nav>

      {tab === "voice" && <VoiceTab state={state} refresh={refresh} />}
      {tab === "song" && (
        <SongTab state={state} refresh={refresh} onDone={() => setTab("works")} />
      )}
      {tab === "works" && <WorksTab covers={state.covers} refresh={refresh} />}

      <p className="foot">仅供本人声音使用 · 生成内容为 AI 合成</p>
    </main>
  );
}

function ConfigNotice({ config }: { config: ConfigStatus }) {
  const missing: string[] = [];
  if (!config.blob) missing.push("存储（在 Vercel 项目里连接一个 Blob 存储）");
  if (!config.replicate) missing.push("Replicate（环境变量 REPLICATE_API_TOKEN）");
  if (!config.password) missing.push("访问密码（环境变量 APP_PASSWORD）");
  if (!missing.length) return null;
  return (
    <div className="notice">
      <b>还有设置没完成，部分功能暂不可用：</b>
      <ul>
        {missing.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
      <small>在 Vercel 项目 Settings → Environment Variables 填好后，重新部署一次即可。</small>
    </div>
  );
}

function VoiceTab({ state, refresh }: { state: State; refresh: () => Promise<void> }) {
  const [name, setName] = useState("我的声音");
  const [files, setFiles] = useState<File[]>([]);
  const [epoch, setEpoch] = useState(50);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const canRun = state.config.blob && state.config.replicate;

  async function train() {
    setError("");
    try {
      const { zip, seconds, clips } = await buildDataset(files, setProgress);
      if (seconds > 0 && seconds < 60) throw new Error(`有效声音只有 ${Math.round(seconds)} 秒，至少需要 1 分钟，建议 10 分钟以上`);
      const blob = await uploadFile(zip, `dataset-${Date.now()}.zip`, (p) =>
        setProgress(`已切成 ${clips} 段（${fmtMinutes(seconds)}），上传中 ${p}%`),
      );
      setProgress("正在提交训练…");
      await api("/api/voices", {
        method: "POST",
        body: JSON.stringify({ name, datasetUrl: blob.url, epoch, seconds }),
      });
      setFiles([]);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress("");
    }
  }

  return (
    <section>
      <div className="card">
        <h2>上传干声，训练你的声音</h2>
        <p className="hint">
          上传你自己清唱或说话的录音（不要伴奏、不要混响）。总长建议 10 分钟以上，越干净效果越好。可一次选多个文件。
        </p>
        <label className="field">
          名字
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="file">
          <input
            type="file"
            accept="audio/*,video/mp4"
            multiple
            onChange={(e) => setFiles([...(e.target.files || [])])}
          />
          {files.length ? `已选 ${files.length} 个文件` : "点这里选择干声文件"}
        </label>
        <label className="field">
          训练强度
          <select value={epoch} onChange={(e) => setEpoch(Number(e.target.value))}>
            <option value={20}>快速（20 轮，便宜，效果一般）</option>
            <option value={50}>标准（50 轮）</option>
            <option value={100}>精细（100 轮，更慢更贵）</option>
          </select>
        </label>
        <button className="primary" disabled={!canRun || !files.length || !!progress} onClick={train}>
          {progress || "开始训练"}
        </button>
        {!canRun && <p className="hint">需要先完成上面的设置才能训练。</p>}
        {error && <p className="error">{error}</p>}
      </div>

      <h3>已有的声音模型</h3>
      {!state.voices.length && <p className="hint">还没有。训练一般需要 10–30 分钟。</p>}
      {state.voices.map((v) => (
        <div className="row" key={v.id}>
          <div>
            <b>{v.name}</b>
            <small>
              {new Date(v.createdAt).toLocaleString()} · {fmtMinutes(v.seconds)} · {v.epoch} 轮
            </small>
            {v.error && <small className="error">{v.error}</small>}
          </div>
          <StatusBadge status={v.status} working="训练中" />
          <DeleteButton url={`/api/voices/${v.id}`} refresh={refresh} />
        </div>
      ))}
    </section>
  );
}

function SongTab({ state, refresh, onDone }: { state: State; refresh: () => Promise<void>; onDone: () => void }) {
  const ready = state.voices.filter((v) => v.status === "ready");
  const [voiceId, setVoiceId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pitchChange, setPitchChange] = useState("no-change");
  const [semitones, setSemitones] = useState(0);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const selected = voiceId || ready[0]?.id || "";
  const canRun = state.config.blob && state.config.replicate && !!selected;

  async function generate() {
    if (!file) return;
    setError("");
    try {
      const blob = await uploadFile(file, safeName(file.name), (p) => setProgress(`上传中 ${p}%`));
      setProgress("正在提交…");
      await api("/api/covers", {
        method: "POST",
        body: JSON.stringify({
          title: file.name.replace(/\.[^.]+$/, ""),
          voiceId: selected,
          songUrl: blob.url,
          pitchChange,
          semitones,
        }),
      });
      setFile(null);
      await refresh();
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress("");
    }
  }

  return (
    <section>
      <div className="card">
        <h2>上传歌曲，换成你的声音</h2>
        <p className="hint">直接上传带伴奏的原曲（mp3/m4a/wav 等），会自动分离人声和伴奏，再用你的声音重新混好。</p>
        <label className="field">
          用哪个声音
          <select value={selected} onChange={(e) => setVoiceId(e.target.value)}>
            {!ready.length && <option value="">（还没有训练好的声音）</option>}
            {ready.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label className="file">
          <input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          {file ? file.name : "点这里选择歌曲"}
        </label>
        <label className="field">
          男女声转换
          <select value={pitchChange} onChange={(e) => setPitchChange(e.target.value)}>
            <option value="no-change">不转换</option>
            <option value="male-to-female">原唱是男声，我是女声</option>
            <option value="female-to-male">原唱是女声，我是男声</option>
          </select>
        </label>
        <label className="field">
          整体升降调：{semitones > 0 ? `+${semitones}` : semitones} 半音
          <input
            type="range"
            min={-12}
            max={12}
            value={semitones}
            onChange={(e) => setSemitones(Number(e.target.value))}
          />
        </label>
        <button className="primary" disabled={!canRun || !file || !!progress} onClick={generate}>
          {progress || "生成翻唱"}
        </button>
        {!ready.length && <p className="hint">先在「我的声音」里训练好一个声音。</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </section>
  );
}

function WorksTab({ covers, refresh }: { covers: Cover[]; refresh: () => Promise<void> }) {
  return (
    <section>
      {!covers.length && <p className="hint">还没有作品。生成一首大约需要 3–10 分钟。</p>}
      {covers.map((c) => (
        <div className="card" key={c.id}>
          <div className="row flat">
            <div>
              <b>{c.title}</b>
              <small>
                {c.voiceName} · {new Date(c.createdAt).toLocaleString()}
              </small>
            </div>
            <StatusBadge status={c.status} working="生成中" />
            <DeleteButton url={`/api/covers/${c.id}`} refresh={refresh} />
          </div>
          {c.audioUrl && (
            <>
              <audio controls preload="none" src={c.audioUrl} />
              <a className="link" href={c.downloadUrl}>
                下载
              </a>
            </>
          )}
          {c.error && <p className="error">{c.error}</p>}
        </div>
      ))}
    </section>
  );
}

function StatusBadge({ status, working }: { status: Voice["status"]; working: string }) {
  const text = status === "ready" ? "完成" : status === "failed" ? "失败" : working;
  return <span className={`badge ${status}`}>{text}</span>;
}

function DeleteButton({ url, refresh }: { url: string; refresh: () => Promise<void> }) {
  return (
    <button
      className="link danger"
      onClick={async () => {
        if (!confirm("确定删除？")) return;
        await api(url, { method: "DELETE" }).catch((e) => alert(e.message));
        refresh();
      }}
    >
      删除
    </button>
  );
}
