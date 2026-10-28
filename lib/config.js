// 服务端统一配置。前端 public/js/config.js 中有一份展示用副本，
// 两者由 tests/shared-config.test.mjs 校验保持一致；以服务端为准。

export const APP_STAGE = 'framework';
export const APP_VERSION = '0.1.0';

// 单次生成允许的最大字符数（控制成本，后续可按套餐调整）
export const MAX_TEXT_LENGTH = 1000;

// 模型白名单：服务端只接受这里列出的 model_id
export const ALLOWED_MODELS = Object.freeze([
  'eleven_multilingual_v2',
  'eleven_turbo_v2_5',
  'eleven_flash_v2_5',
]);

// 语音参数范围（与 ElevenLabs voice_settings 对应）
export const VOICE_SETTING_RANGES = Object.freeze({
  stability: { min: 0, max: 1 },
  similarity_boost: { min: 0, max: 1 },
  style: { min: 0, max: 1 },
  speed: { min: 0.7, max: 1.2 },
});

// 请求体上限：文本最多 1000 字加上少量参数，远小于此值；超过直接拒绝
export const MAX_BODY_BYTES = 16 * 1024;

// ---- 时间预算（须小于 vercel.json 中 api/generate.js 的 maxDuration，由测试校验）----
// 平台到点会强杀函数，客户端拿到的就不是统一格式的错误，且上游可能已开始计费。
// 因此整个请求有一个总预算（REQUEST_BUDGET_MS），目录拉取和 TTS 都从中扣除，
// 并留出 FUNCTION_MAX_DURATION_MS - REQUEST_BUDGET_MS 给返回响应和平台开销。
export const FUNCTION_MAX_DURATION_MS = 30_000; // 与 vercel.json 保持一致
export const REQUEST_BUDGET_MS = 26_000;
export const CATALOG_TIMEOUT_MS = 5_000;
export const TTS_TIMEOUT_MS = 21_000; // TTS 超时上限；实际取“上限”与“剩余预算”的较小值
export const MIN_TTS_BUDGET_MS = 5_000; // 剩余预算不足时不再向上游发请求（避免发出注定超时、却可能计费的请求）

// 音频大小上限留出余量，避免超过 Vercel 函数 4.5MB 的响应体限制。
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

// 输出格式 mp3_44100_128 约 16KB/秒；4MB 约合 260 秒音频。
// 语速越慢，同样的字数就越长。按“字数 ÷ 语速”限制，并以每字约 0.25 秒（偏保守的中文语速）估算，
// 1000 个“等效字数”约 250 秒、约 4.0MB，仍在 MAX_AUDIO_BYTES 以内。
// 这是估算而不是保证：语速极慢或停顿很多的文本仍可能超限，此时上游已计费但本应用会拒收（返回 502）。
export const MAX_SPEED_ADJUSTED_CHARS = 1000;
export function maxCharsForSpeed(speed = 1) {
  const s = typeof speed === 'number' && Number.isFinite(speed) && speed > 0 ? speed : 1;
  return Math.min(MAX_TEXT_LENGTH, Math.floor(MAX_SPEED_ADJUSTED_CHARS * s));
}

// 私有音频桶名称，可通过环境变量覆盖
export const DEFAULT_AUDIO_BUCKET = 'generated-audio';

// 读取服务端环境变量。只返回是否已配置，绝不把值写进日志或响应。
export function getServerEnvStatus(env = process.env) {
  return {
    elevenLabsConfigured: Boolean(env.ELEVENLABS_API_KEY),
    supabaseConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
    rateLimitStoreConfigured: Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN),
  };
}
