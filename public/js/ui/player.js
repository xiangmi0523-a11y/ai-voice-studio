// 播放器：播放 / 暂停 / 进度 / 时长 / 下载
//
// 只在拿到真实音频地址（来自 /api/audio/:id 的签名链接）时才会进入可播放状态，
// 没有音频时始终显示空状态，不会伪造播放。

import { qs } from '../core/dom.js';
import { formatDuration } from '../core/format.js';

let instance = null;

export function initPlayer(root) {
  const audio = qs('[data-player-audio]', root);
  const empty = qs('[data-player-empty]', root);
  const body = qs('[data-player-body]', root);
  const meta = qs('[data-player-meta]', root);
  const toggle = qs('[data-player-toggle]', root);
  const iconPlay = qs('[data-icon-play]', root);
  const iconPause = qs('[data-icon-pause]', root);
  const seek = qs('[data-player-seek]', root);
  const current = qs('[data-player-current]', root);
  const durationEl = qs('[data-player-duration]', root);
  const download = qs('[data-player-download]', root);
  const errorEl = qs('[data-player-error]', root);

  let seeking = false;

  function setFill() {
    const max = Number(seek.max) || 0;
    const pct = max ? (Number(seek.value) / max) * 100 : 0;
    seek.style.setProperty('--fill', `${pct}%`);
  }

  function setPlaying(playing) {
    iconPlay.hidden = playing;
    iconPause.hidden = !playing;
    toggle.setAttribute('aria-label', playing ? '暂停' : '播放');
  }

  function setControlsEnabled(enabled) {
    toggle.disabled = !enabled;
    seek.disabled = !enabled;
    download.classList.toggle('is-disabled', !enabled);
    download.setAttribute('aria-disabled', String(!enabled));
    if (!enabled) download.removeAttribute('href');
  }

  function reset() {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    empty.hidden = false;
    body.hidden = true;
    errorEl.hidden = true;
    seek.max = '0';
    seek.value = '0';
    current.textContent = '0:00';
    durationEl.textContent = '0:00';
    setFill();
    setPlaying(false);
    setControlsEnabled(false);
  }

  // src：真实音频地址；title：显示的说明；downloadName：下载文件名
  function load({ src, title = '', downloadName = 'voice.mp3' }) {
    if (!src) {
      reset();
      return;
    }
    empty.hidden = true;
    body.hidden = false;
    errorEl.hidden = true;
    meta.textContent = title;
    audio.src = src;
    download.href = src;
    download.setAttribute('download', downloadName);
    setPlaying(false);
    setControlsEnabled(true);
  }

  toggle.addEventListener('click', async () => {
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        errorEl.textContent = '无法播放该音频，请稍后重试。';
        errorEl.hidden = false;
      }
    } else {
      audio.pause();
    }
  });

  seek.addEventListener('input', () => {
    seeking = true;
    current.textContent = formatDuration(Number(seek.value));
    setFill();
  });
  seek.addEventListener('change', () => {
    audio.currentTime = Number(seek.value);
    seeking = false;
  });

  audio.addEventListener('loadedmetadata', () => {
    seek.max = String(audio.duration || 0);
    durationEl.textContent = formatDuration(audio.duration);
    setFill();
  });
  audio.addEventListener('timeupdate', () => {
    if (seeking) return;
    seek.value = String(audio.currentTime);
    current.textContent = formatDuration(audio.currentTime);
    setFill();
  });
  audio.addEventListener('play', () => setPlaying(true));
  audio.addEventListener('pause', () => setPlaying(false));
  audio.addEventListener('ended', () => setPlaying(false));
  audio.addEventListener('error', () => {
    if (!audio.getAttribute('src')) return;
    errorEl.textContent = '音频加载失败，请稍后重试。';
    errorEl.hidden = false;
    setPlaying(false);
    toggle.disabled = true;
  });

  reset();
  instance = { load, reset, audio };
  return instance;
}

export function getPlayer() {
  return instance;
}
