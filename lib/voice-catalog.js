// ElevenLabs 真实音色目录：拉取 + 短期内存缓存，作为 /api/voices 展示列表和 /api/generate 的音色白名单。
//
// 隐私策略：账号里的音色默认全部不公开。只有 PUBLIC_VOICE_IDS（lib/public-voices.js）中显式列出、
// 在 ElevenLabs 中真实存在、且 category 不是 cloned 的音色，才会被返回或允许生成。
// 过滤发生在每一次 load() 返回之前，缓存里的原始列表永远不会直接对外，
// 所以缓存命中、过期或配置变化都不会重新暴露未授权音色。
// 安全失败关闭：没有配置密钥、拉取失败、超时、响应异常或列表为空时，一律返回失败，
// 调用方必须拒绝请求；失败结果不会被缓存，缓存过期后也不会继续使用旧数据。
// 内存缓存只在单个 Serverless 实例内有效，只用于减少对上游的请求，不是限流手段。

import { CATALOG_TIMEOUT_MS } from './config.js';
import { logger as defaultLogger } from './logger.js';
import { ErrorCodes, sendError } from './http.js';
import { parsePublicVoiceIds } from './public-voices.js';
import { isVoiceId } from './validation.js';

export const ELEVENLABS_VOICES_URL = 'https://api.elevenlabs.io/v1/voices';
export const DEFAULT_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_TIMEOUT_MS = CATALOG_TIMEOUT_MS;

// 试听链接只允许 vercel.json 的 CSP（media-src）已放行的域名；当前只有 supabase.co，
// 因此 ElevenLabs 的试听链接会被丢弃（返回 null）。如需开放试听，应先评审并修改 CSP，再扩充这里。
export const ALLOWED_PREVIEW_HOST_SUFFIXES = Object.freeze(['.supabase.co']);

export function allowedPreviewUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    return ALLOWED_PREVIEW_HOST_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix)) ? url.href : null;
  } catch {
    return null;
  }
}

export const CatalogFailure = Object.freeze({
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  NO_PUBLIC_VOICES: 'NO_PUBLIC_VOICES',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  UPSTREAM_TIMEOUT: 'UPSTREAM_TIMEOUT',
});

const text = (value, max) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);

// 内部归一化：保留 category 仅用于过滤，对外输出前必须经过 toPublicVoice 去掉。
// 格式不合法的条目直接丢弃，不进入白名单
export function normalizeVoice(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!isVoiceId(raw.voice_id)) return null;
  const name = text(raw.name, 100);
  if (!name) return null;
  const labels = raw.labels && typeof raw.labels === 'object' && !Array.isArray(raw.labels) ? raw.labels : {};
  const gender = text(labels.gender, 20)?.toLowerCase() ?? null;
  return {
    id: raw.voice_id,
    category: text(raw.category, 40),
    name,
    description: text(raw.description, 200) ?? text(labels.description, 200) ?? '',
    gender: gender === 'male' || gender === 'female' ? gender : null,
    language: text(labels.language, 40),
    tags: [labels.accent, labels.use_case, labels.descriptive, labels.age].map((t) => text(t, 40)).filter(Boolean),
    previewUrl: allowedPreviewUrl(raw.preview_url),
  };
}

// 对外只返回前端确实需要的字段（显式挑选，不透传任何上游字段）
export function toPublicVoice(voice) {
  return {
    id: voice.id,
    name: voice.name,
    description: voice.description,
    gender: voice.gender,
    language: voice.language,
    tags: [...voice.tags],
    previewUrl: voice.previewUrl,
  };
}

export function createVoiceCatalog({
  getEnv = () => process.env,
  // 延迟读取全局 fetch，便于测试时整体替换
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  ttlMs = DEFAULT_TTL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger = defaultLogger,
} = {}) {
  let cache = null;
  let inflight = null;

  const fail = (code) => ({ ok: false, code });

  async function fetchFresh() {
    const apiKey = getEnv().ELEVENLABS_API_KEY;
    if (!apiKey) return fail(CatalogFailure.NOT_CONFIGURED);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(ELEVENLABS_VOICES_URL, {
        method: 'GET',
        headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        logger.warn('voice_catalog_upstream_status', { status: response.status });
        return fail(CatalogFailure.UPSTREAM_ERROR);
      }
      const payload = await response.json();
      const voices = Array.isArray(payload?.voices) ? payload.voices.map(normalizeVoice).filter(Boolean) : [];
      if (!voices.length) {
        logger.warn('voice_catalog_empty');
        return fail(CatalogFailure.UPSTREAM_ERROR);
      }
      cache = { voices, expiresAt: now() + ttlMs };
      return { ok: true, voices, cached: false };
    } catch (err) {
      if (err?.name === 'AbortError') {
        logger.warn('voice_catalog_timeout');
        return fail(CatalogFailure.UPSTREAM_TIMEOUT);
      }
      logger.warn('voice_catalog_failed', { error: err });
      return fail(CatalogFailure.UPSTREAM_ERROR);
    } finally {
      clearTimeout(timer);
    }
  }

  // 把（内部的）完整列表按公开策略过滤成对外可用的结果
  function applyPublicPolicy(all, policy, cached) {
    const visible = all.filter((v) => policy.ids.has(v.id) && v.category !== 'cloned');
    return { ok: true, voices: visible.map(toPublicVoice), ids: new Set(visible.map((v) => v.id)), cached };
  }

  return {
    async load() {
      // 未配置 / 为空 / 无效：不公开任何音色，也不去请求上游
      const policy = parsePublicVoiceIds(getEnv().PUBLIC_VOICE_IDS);
      if (!policy.ok) {
        logger.warn('voice_catalog_no_public_voices', { reason: policy.reason });
        return fail(CatalogFailure.NO_PUBLIC_VOICES);
      }
      if (cache && cache.expiresAt > now()) return applyPublicPolicy(cache.voices, policy, true);
      // 过期后丢弃旧数据：拉取失败时不能继续用旧白名单放行
      cache = null;
      if (!inflight) {
        inflight = fetchFresh().finally(() => {
          inflight = null;
        });
      }
      const fresh = await inflight;
      return fresh.ok ? applyPublicPolicy(fresh.voices, policy, false) : fresh;
    },
    clear() {
      cache = null;
    },
  };
}

let current = createVoiceCatalog();

export function getVoiceCatalog() {
  return current;
}

// 仅供测试注入模拟目录，避免对真实 ElevenLabs 发请求
export function setVoiceCatalog(catalog) {
  current = catalog;
}

const FAILURE_TO_ERROR = {
  [CatalogFailure.NOT_CONFIGURED]: ErrorCodes.SERVICE_UNAVAILABLE,
  [CatalogFailure.NO_PUBLIC_VOICES]: ErrorCodes.SERVICE_UNAVAILABLE,
  [CatalogFailure.UPSTREAM_ERROR]: ErrorCodes.UPSTREAM_ERROR,
  [CatalogFailure.UPSTREAM_TIMEOUT]: ErrorCodes.UPSTREAM_TIMEOUT,
};

// 白名单不可用时统一返回的错误响应（不暴露任何上游细节）
export function sendCatalogFailure(res, failure, { requestId, feature }) {
  sendError(res, FAILURE_TO_ERROR[failure.code] || ErrorCodes.UPSTREAM_ERROR, {
    requestId,
    details: { feature },
  });
}
