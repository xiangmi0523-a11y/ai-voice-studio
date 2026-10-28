// 音色数据来源：优先请求 /api/voices，未接入时退回 DEMO 音色并明确标记来源

import { DEMO_VOICES } from './demo-data.js';

export const VOICE_FILTERS = Object.freeze([
  { value: 'all', label: '全部' },
  { value: 'female', label: '女声' },
  { value: 'male', label: '男声' },
]);

export async function loadVoices(apiClient) {
  const result = await apiClient.getVoices();
  if (result.ok && Array.isArray(result.data?.voices)) {
    return { source: 'remote', voices: result.data.voices.map((v) => ({ ...v, isDemo: false })) };
  }
  return { source: 'demo', voices: DEMO_VOICES, reason: result.error };
}

export function filterVoices(voices, { query = '', filter = 'all' } = {}) {
  const q = query.trim().toLowerCase();
  return voices.filter((voice) => {
    if (filter !== 'all' && voice.gender !== filter) return false;
    if (!q) return true;
    const haystack = [voice.name, voice.description, voice.language, ...(voice.tags || [])].join(' ').toLowerCase();
    return haystack.includes(q);
  });
}
