// 入口：创建状态与服务，挂载各个页面模块

import { defaultSettings, DEFAULT_MODEL_ID, STORAGE_KEYS } from './config.js';
import { createLocalStore } from './core/local-store.js';
import { createStore } from './core/state.js';
import { api } from './services/api-client.js';
import { createFavoritesStore, createLocalFavoritesAdapter } from './services/favorites-store.js';
import { createDemoHistoryStore } from './services/history-store.js';
import { loadVoices } from './services/voices.js';
import { DEMO_VOICES } from './services/demo-data.js';
import { initCreateView } from './ui/create-view.js';
import { initFavoritesView } from './ui/favorites-view.js';
import { initHistoryView } from './ui/history-view.js';
import { initPlayer } from './ui/player.js';
import { initRouter } from './ui/router.js';
import { initSettingsView } from './ui/settings-view.js';
import { showToast } from './ui/toast.js';
import { initVoicePicker } from './ui/voice-picker.js';

const localStore = createLocalStore();

const store = createStore({
  text: localStore.read(STORAGE_KEYS.draft, '') || '',
  // 先用 DEMO 音色渲染，/api/voices 返回后再替换
  voices: DEMO_VOICES,
  voicesSource: 'demo',
  selectedVoiceId: DEMO_VOICES[0].id,
  modelId: DEFAULT_MODEL_ID,
  settings: defaultSettings(),
  generation: { status: 'idle' },
});

const favorites = createFavoritesStore(createLocalFavoritesAdapter(localStore));
const demoHistory = createDemoHistoryStore(localStore);

initPlayer(document.querySelector('#player'));
const voicePicker = initVoicePicker({ store, favorites });
const createView = initCreateView({ store, api, localStore, voicePicker });

let router;
const historyView = initHistoryView({
  api,
  demoHistory,
  onRegenerate: (item) => {
    createView.prefill(item);
    router.go('create');
  },
});
initFavoritesView({
  store,
  favorites,
  voicePicker,
  onUseVoice: (voice) => {
    store.set({ selectedVoiceId: voice.id });
    showToast(`已选用「${voice.name}」`);
    router.go('create');
  },
});
const settingsView = initSettingsView({ api, favorites, demoHistory });

router = initRouter({
  onChange: (view) => {
    if (view === 'history') historyView.onShow();
    if (view === 'settings') settingsView.onShow();
  },
});

loadVoices(api).then(({ source, voices }) => {
  if (source === 'remote' && voices.length) {
    const keep = voices.some((v) => v.id === store.get().selectedVoiceId);
    store.set({ voices, voicesSource: source, selectedVoiceId: keep ? store.get().selectedVoiceId : voices[0].id });
  }
});
