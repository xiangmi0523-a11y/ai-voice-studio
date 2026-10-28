// 历史页：云端记录（未接入时显示明确状态）+ DEMO 示例记录（本地、隔离）

import { MODELS } from '../config.js';
import { clear, h, icon, ICONS, qs } from '../core/dom.js';
import { formatDateTime, truncate } from '../core/format.js';
import { fetchRemoteHistory, getHistoryStatusDisplay } from '../services/history-store.js';
import { initSheet } from './sheet.js';
import { showToast } from './toast.js';

const BADGE_CLASS = {
  success: 'badge--success',
  danger: 'badge--danger',
  pending: 'badge--pending',
  demo: 'badge--demo',
  neutral: '',
};

function statusBadge(item) {
  const { label, tone } = getHistoryStatusDisplay(item);
  return h('span', { class: `badge ${BADGE_CLASS[tone] || ''}`, dataset: { statusTone: tone } }, label);
}

export function initHistoryView({ api, demoHistory, onRegenerate }) {
  const remoteRoot = qs('#remote-history');
  const demoList = qs('#demo-history');
  const restoreBtn = qs('#restore-demo-history');
  const detailRoot = qs('#history-detail');
  const detailSheet = initSheet(qs('#history-sheet'));
  let remoteLoaded = false;

  // ---- 云端记录 ----
  function renderRemote(result) {
    clear(remoteRoot);
    if (result.state === 'loading') {
      remoteRoot.setAttribute('aria-busy', 'true');
      remoteRoot.append(h('div', { class: 'skeleton' }), h('div', { class: 'skeleton skeleton--short' }), h('span', { class: 'visually-hidden' }, '正在加载云端记录'));
      return;
    }
    remoteRoot.removeAttribute('aria-busy');

    if (result.state === 'ready' && result.items.length === 0) {
      remoteRoot.append(
        h('div', { class: 'empty empty--compact' },
          icon(ICONS.clock, 'empty__icon'),
          h('p', { class: 'empty__title' }, '还没有生成记录'),
          h('p', { class: 'empty__desc' }, '生成的语音会自动保存在这里'),
        ),
      );
      return;
    }

    if (result.state === 'not_implemented' || result.state === 'error') {
      const notImpl = result.state === 'not_implemented';
      remoteRoot.append(
        h('div', { class: 'empty empty--compact' },
          icon(notImpl ? ICONS.cloud : ICONS.alert, 'empty__icon'),
          h('p', { class: 'empty__title' }, notImpl ? '云端历史尚未接入' : '加载失败'),
          h('p', { class: 'empty__desc' }, notImpl ? '接入登录和数据库后，你的生成记录会保存在这里，并在设备间同步。' : result.error?.message || '请稍后重试'),
          h('p', { class: 'empty__code' }, `错误代码：${result.error?.code || 'UNKNOWN'}`),
          h('button', { type: 'button', class: 'btn btn--secondary btn--small', onclick: loadRemote }, '重新加载'),
        ),
      );
      return;
    }

    // 第二阶段：真实记录列表（与 DEMO 列表使用同一渲染，但不带 DEMO 标记）
    const list = h('ul', { class: 'list' });
    for (const item of result.items) list.append(renderItem(item));
    remoteRoot.append(list);
  }

  async function loadRemote() {
    renderRemote({ state: 'loading' });
    renderRemote(await fetchRemoteHistory(api));
    remoteLoaded = true;
  }

  // ---- 条目 ----
  function playItem(item) {
    if (item.isDemo) {
      showToast('DEMO 记录没有音频文件，无法播放');
      return;
    }
    showToast('云端音频播放将在接入存储后开放');
  }

  function deleteItem(item) {
    if (item.isDemo) {
      demoHistory.remove(item.id);
      detailSheet.close();
      showToast('已删除示例记录（仅本地）');
      return;
    }
    showToast('云端删除将在接入数据库后开放');
  }

  function regenerate(item) {
    detailSheet.close();
    onRegenerate(item);
    showToast('已回填到创作页，可修改后重新生成');
  }

  function openDetail(item) {
    clear(detailRoot);
    const model = MODELS.find((m) => m.id === item.modelId);
    detailRoot.append(
      item.isDemo ? h('p', { class: 'notice notice--small' }, 'DEMO 示例记录：仅保存在本地浏览器，没有真实音频。') : null,
      h('div', { class: 'detail-text' }, item.text),
      h('dl', { class: 'detail-grid' },
        h('dt', {}, '音色'), h('dd', {}, item.voiceName || item.voiceId),
        h('dt', {}, '模型'), h('dd', {}, model?.name || item.modelId),
        h('dt', {}, '字数'), h('dd', {}, String(item.characterCount)),
        h('dt', {}, '时间'), h('dd', {}, formatDateTime(item.createdAt)),
        h('dt', {}, '状态'), h('dd', {}, statusBadge(item)),
        item.errorCode ? [h('dt', {}, '错误代码'), h('dd', {}, item.errorCode)] : null,
      ),
      h('div', { class: 'history-item__actions' },
        h('button', { type: 'button', class: 'btn btn--secondary btn--small', onclick: () => playItem(item) }, '播放'),
        h('button', { type: 'button', class: 'btn btn--secondary btn--small', onclick: () => regenerate(item) }, '重新生成'),
        h('button', { type: 'button', class: 'btn btn--danger btn--small', onclick: () => deleteItem(item) }, '删除'),
      ),
    );
    detailSheet.open();
  }

  function renderItem(item) {
    return h('li', { class: 'history-item', dataset: { historyId: item.id } },
      h('p', { class: 'history-item__text' }, truncate(item.text, 80)),
      h('div', { class: 'history-item__meta' },
        item.isDemo ? h('span', { class: 'pill pill--demo' }, 'DEMO') : null,
        h('span', {}, item.voiceName || item.voiceId),
        h('span', { 'aria-hidden': 'true' }, '·'),
        h('span', {}, formatDateTime(item.createdAt)),
        statusBadge(item),
      ),
      h('div', { class: 'history-item__actions' },
        h('button', { type: 'button', class: 'btn btn--text btn--small', 'data-action': 'view', onclick: () => openDetail(item) }, '查看'),
        h('button', { type: 'button', class: 'btn btn--text btn--small', 'data-action': 'play', onclick: () => playItem(item) }, '播放'),
        h('button', { type: 'button', class: 'btn btn--text btn--small', 'data-action': 'regenerate', onclick: () => regenerate(item) }, '重新生成'),
        h('button', { type: 'button', class: 'btn btn--text btn--small list-row__label--danger', 'data-action': 'delete', onclick: () => deleteItem(item) }, '删除'),
      ),
    );
  }

  // ---- DEMO 记录 ----
  function renderDemo(items) {
    clear(demoList);
    restoreBtn.hidden = items.length > 0;
    if (!items.length) {
      demoList.append(
        h('li', { class: 'empty empty--compact' },
          h('p', { class: 'empty__title' }, '示例记录已全部删除'),
          h('p', { class: 'empty__desc' }, '点击右上方“恢复示例”可重新载入'),
        ),
      );
      return;
    }
    for (const item of items) demoList.append(renderItem(item));
  }

  restoreBtn.addEventListener('click', () => demoHistory.reset());
  demoHistory.subscribe(renderDemo);
  renderDemo(demoHistory.list());

  return {
    // 首次进入历史页时才请求云端记录
    onShow() {
      if (!remoteLoaded) loadRemote();
    },
  };
}
