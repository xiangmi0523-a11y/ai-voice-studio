// 创作页：文本输入、音色、模型与参数、生成按钮与状态

import { defaultSettings, MAX_TEXT_LENGTH, MODELS, STORAGE_KEYS, VOICE_SETTINGS } from '../config.js';
import { clear, h, icon, ICONS, qs } from '../core/dom.js';
import { countChars, formatSettingValue } from '../core/format.js';
import { buildGeneratePayload, createIdempotencyKeeper } from '../services/generation.js';
import { getPlayer } from './player.js';

const STATUS_TITLES = {
  NOT_IMPLEMENTED: '语音生成尚未接入',
  VALIDATION_ERROR: '请检查输入内容',
  NETWORK_ERROR: '网络连接失败',
  TIMEOUT: '请求超时',
  BACKEND_UNAVAILABLE: '后端接口不可用',
  RATE_LIMITED: '操作太频繁',
  UNAUTHORIZED: '需要登录',
};

export function initCreateView({ store, api, localStore, voicePicker }) {
  const textInput = qs('#text-input');
  const charCount = qs('#char-count');
  const clearBtn = qs('#clear-text');
  const voiceBtn = qs('#open-voice-picker');
  const voiceName = qs('[data-voice-name]', voiceBtn);
  const voiceDesc = qs('[data-voice-desc]', voiceBtn);
  const modelSelect = qs('#model-select');
  const modelDesc = qs('#model-desc');
  const slidersRoot = qs('#settings-sliders');
  const speakerBoost = qs('#speaker-boost');
  const resetBtn = qs('#reset-settings');
  const generateBtn = qs('#generate-btn');
  const statusEl = qs('#generate-status');
  const keeper = createIdempotencyKeeper();

  for (const el of document.querySelectorAll('[data-max-chars]')) el.textContent = String(MAX_TEXT_LENGTH);

  // ---- 文本 ----
  textInput.value = store.get().text;
  textInput.addEventListener('input', () => {
    store.set({ text: textInput.value });
    localStore.write(STORAGE_KEYS.draft, textInput.value);
  });
  clearBtn.addEventListener('click', () => {
    textInput.value = '';
    store.set({ text: '' });
    localStore.remove(STORAGE_KEYS.draft);
    textInput.focus();
  });

  // ---- 音色 ----
  voiceBtn.addEventListener('click', () => voicePicker.open());

  // ---- 模型 ----
  for (const model of MODELS) modelSelect.append(h('option', { value: model.id }, model.name));
  modelSelect.addEventListener('change', () => store.set({ modelId: modelSelect.value }));

  // ---- 参数滑块 ----
  const sliderInputs = new Map();
  for (const def of VOICE_SETTINGS) {
    const id = `setting-${def.key}`;
    const valueEl = h('span', { class: 'slider-field__value', id: `${id}-value` });
    const input = h('input', {
      type: 'range',
      class: 'range',
      id,
      min: def.min,
      max: def.max,
      step: def.step,
      'aria-describedby': `${id}-value`,
    });
    input.addEventListener('input', () => {
      store.set((s) => ({ settings: { ...s.settings, [def.key]: Number(input.value) } }));
    });
    sliderInputs.set(def.key, { input, valueEl, def });
    slidersRoot.append(
      h('div', { class: 'slider-field' },
        h('div', { class: 'slider-field__head' }, h('label', { class: 'field-label', for: id }, def.label), valueEl),
        input,
        h('div', { class: 'slider-field__scale', 'aria-hidden': 'true' }, h('span', {}, def.minLabel), h('span', {}, def.maxLabel)),
      ),
    );
  }
  speakerBoost.addEventListener('change', () => {
    store.set((s) => ({ settings: { ...s.settings, use_speaker_boost: speakerBoost.checked } }));
  });
  resetBtn.addEventListener('click', () => store.set({ settings: defaultSettings() }));

  // ---- 生成 ----
  async function generate() {
    const state = store.get();
    if (state.generation.status === 'loading') return; // 防止重复提交

    const built = buildGeneratePayload({
      text: state.text,
      voiceId: state.selectedVoiceId,
      voice: state.voices.find((v) => v.id === state.selectedVoiceId),
      modelId: state.modelId,
      settings: state.settings,
    });
    if (!built.ok) {
      store.set({
        generation: {
          status: 'error',
          error: { code: 'VALIDATION_ERROR', message: built.errors.map((e) => e.reason).join('；'), local: true },
        },
      });
      if (built.errors.some((e) => e.field === 'text')) textInput.focus();
      return;
    }

    store.set({ generation: { status: 'loading' } });
    const result = await api.generate(built.payload, keeper.keyFor(built.payload));

    if (!result.ok) {
      store.set({ generation: { status: 'error', error: result.error, requestId: result.requestId } });
      return;
    }

    // 第二阶段：生成成功后通过 /api/audio/:id 拿签名链接再播放
    keeper.reset();
    const audio = await api.getAudio(result.data.id);
    if (!audio.ok || !audio.data?.url) {
      store.set({ generation: { status: 'error', error: audio.error || { code: 'STORAGE_ERROR', message: '音频获取失败，请稍后重试。' } } });
      return;
    }
    getPlayer()?.load({ src: audio.data.url, title: state.voices.find((v) => v.id === state.selectedVoiceId)?.name || '', downloadName: `voice-${result.data.id}.mp3` });
    store.set({ generation: { status: 'success' } });
  }

  generateBtn.addEventListener('click', generate);

  function renderStatus(generation) {
    clear(statusEl);
    statusEl.className = 'status';
    if (generation.status === 'loading') {
      statusEl.classList.add('status--loading');
      statusEl.append(
        h('span', { class: 'spinner', 'aria-hidden': 'true' }),
        h('div', { class: 'status__body' }, h('p', { class: 'status__title' }, '正在提交生成请求…')),
      );
      statusEl.hidden = false;
      return;
    }
    if (generation.status === 'error') {
      const { error } = generation;
      statusEl.classList.add('status--error');
      const desc = [error.message];
      if (error.code === 'NOT_IMPLEMENTED') desc.push('当前为第一阶段框架，不会生成或伪造音频。');
      statusEl.append(
        icon(ICONS.alert, 'icon status__icon'),
        h('div', { class: 'status__body' },
          h('p', { class: 'status__title' }, STATUS_TITLES[error.code] || '生成失败'),
          h('p', { class: 'status__desc' }, desc.join(' ')),
          error.local ? null : h('p', { class: 'status__code' }, `错误代码：${error.code}`),
          error.local
            ? null
            : h('div', { class: 'status__actions' },
                h('button', { type: 'button', class: 'btn btn--secondary btn--small', 'data-retry': true, onclick: generate }, '重试'),
              ),
        ),
      );
      statusEl.hidden = false;
      return;
    }
    statusEl.hidden = true;
  }

  function render(state) {
    const count = countChars(state.text);
    const over = count > MAX_TEXT_LENGTH;
    charCount.textContent = `${count} / ${MAX_TEXT_LENGTH}`;
    charCount.classList.toggle('is-over', over);
    textInput.setAttribute('aria-invalid', String(over));
    clearBtn.disabled = !state.text;

    const voice = state.voices.find((v) => v.id === state.selectedVoiceId);
    voiceName.textContent = voice ? voice.name : '未选择';
    voiceDesc.textContent = voice ? `${voice.isDemo ? 'DEMO · ' : ''}${voice.description}` : '点击选择音色';

    modelSelect.value = state.modelId;
    modelDesc.textContent = MODELS.find((m) => m.id === state.modelId)?.description || '';

    for (const { input, valueEl, def } of sliderInputs.values()) {
      const value = state.settings[def.key];
      if (Number(input.value) !== value) input.value = String(value);
      valueEl.textContent = formatSettingValue(def.key, value);
      input.style.setProperty('--fill', `${((value - def.min) / (def.max - def.min)) * 100}%`);
    }
    speakerBoost.checked = Boolean(state.settings.use_speaker_boost);

    const loading = state.generation.status === 'loading';
    generateBtn.disabled = loading || over;
    generateBtn.setAttribute('aria-busy', String(loading));
    clear(generateBtn);
    if (loading) generateBtn.append(h('span', { class: 'spinner', 'aria-hidden': 'true' }));
    generateBtn.append(h('span', { class: 'btn__label' }, loading ? '生成中…' : '生成语音'));

    renderStatus(state.generation);
  }

  store.subscribe(render);
  render(store.get());

  return {
    // 从历史“重新生成”时回填内容
    prefill({ text, voiceId, modelId }) {
      textInput.value = text;
      const patch = { text, generation: { status: 'idle' } };
      if (store.get().voices.some((v) => v.id === voiceId)) patch.selectedVoiceId = voiceId;
      if (MODELS.some((m) => m.id === modelId)) patch.modelId = modelId;
      store.set(patch);
      localStore.write(STORAGE_KEYS.draft, text);
    },
  };
}
