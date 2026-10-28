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

// 把 loadVoices 的结果转成要写入 store 的状态。
// 服务端返回空列表（未配置、配置无效或没有获准音色）时，不能继续显示 DEMO 音色，
// 否则用户会误以为服务可用；此时清空列表，由界面提示“当前没有可用音色”。
// 请求失败（source 为 demo）时不改动，保留带 DEMO 标记的示例音色。
export function voicesPatch({ source, voices }, currentSelectedId) {
  if (source !== 'remote') return null;
  if (!voices.length) return { voices: [], voicesSource: 'remote', selectedVoiceId: null };
  const keep = voices.some((v) => v.id === currentSelectedId);
  return { voices, voicesSource: 'remote', selectedVoiceId: keep ? currentSelectedId : voices[0].id };
}
