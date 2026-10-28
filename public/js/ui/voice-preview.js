// 音色试听。DEMO 音色没有试听音频，只给出明确提示，不伪造播放。

import { showToast } from './toast.js';

let previewAudio = null;

export function previewVoice(voice) {
  if (!voice.previewUrl) {
    showToast(voice.isDemo ? 'DEMO 音色没有试听音频，接入音色服务后可试听' : '该音色暂无试听');
    return;
  }
  previewAudio?.pause();
  previewAudio = new Audio(voice.previewUrl);
  previewAudio.play().catch(() => showToast('试听播放失败，请稍后重试'));
}
