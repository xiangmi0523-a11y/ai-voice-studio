// 前端展示用配置。服务端 lib/config.js 为准，两者由测试保持一致。

export const APP_VERSION = '0.1.0';
export const MAX_TEXT_LENGTH = 1000;

// 语速越慢音频越长：按“字数 ÷ 语速”限制，与服务端 lib/config.js 一致（由测试保证）
export const MAX_SPEED_ADJUSTED_CHARS = 1000;
export function maxCharsForSpeed(speed = 1) {
  const s = typeof speed === 'number' && Number.isFinite(speed) && speed > 0 ? speed : 1;
  return Math.min(MAX_TEXT_LENGTH, Math.floor(MAX_SPEED_ADJUSTED_CHARS * s));
}

export const MODELS = Object.freeze([
  {
    id: 'eleven_multilingual_v2',
    name: 'Multilingual v2',
    description: '多语言，表现力和稳定性最好，适合旁白与有声内容。',
  },
  {
    id: 'eleven_turbo_v2_5',
    name: 'Turbo v2.5',
    description: '速度与质量平衡，适合日常使用。',
  },
  {
    id: 'eleven_flash_v2_5',
    name: 'Flash v2.5',
    description: '延迟最低，适合需要快速出声的场景。',
  },
]);

export const DEFAULT_MODEL_ID = MODELS[0].id;

export const VOICE_SETTINGS = Object.freeze([
  { key: 'stability', label: '稳定性', min: 0, max: 1, step: 0.05, default: 0.5, minLabel: '更多变化', maxLabel: '更稳定' },
  { key: 'similarity_boost', label: '相似度', min: 0, max: 1, step: 0.05, default: 0.75, minLabel: '低', maxLabel: '高' },
  { key: 'style', label: '风格强度', min: 0, max: 1, step: 0.05, default: 0, minLabel: '自然', maxLabel: '夸张' },
  { key: 'speed', label: '语速', min: 0.7, max: 1.2, step: 0.05, default: 1, minLabel: '慢', maxLabel: '快' },
]);

export const DEFAULT_SPEAKER_BOOST = true;

export function defaultSettings() {
  const settings = { use_speaker_boost: DEFAULT_SPEAKER_BOOST };
  for (const s of VOICE_SETTINGS) settings[s.key] = s.default;
  return settings;
}

// 本地存储键。demo 前缀的数据只用于演示，与未来的云端数据完全分开。
export const STORAGE_KEYS = Object.freeze({
  favorites: 'avs.local.favorites.v1',
  demoHistory: 'avs.demo.history.v1',
  draft: 'avs.local.draft.v1',
});
