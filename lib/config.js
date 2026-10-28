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
