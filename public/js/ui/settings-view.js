// 设置页：服务状态、数据管理、版本信息
// 登录、额度区域为静态占位（见 index.html），不模拟任何已接入的功能。

import { APP_VERSION } from '../config.js';
import { clear, h, qs } from '../core/dom.js';
import { showToast } from './toast.js';

function statusRow(label, value, tone) {
  return h('div', { class: 'list-row' },
    h('span', { class: 'list-row__label' }, label),
    h('span', { class: `badge ${tone ? `badge--${tone}` : ''}` }, value),
  );
}

export function initSettingsView({ api, favorites, demoHistory }) {
  const statusRoot = qs('#service-status');
  for (const el of document.querySelectorAll('[data-app-version]')) el.textContent = APP_VERSION;

  async function loadStatus() {
    clear(statusRoot);
    statusRoot.append(statusRow('后端接口', '检测中…'));
    const health = await api.getHealth();
    clear(statusRoot);
    statusRoot.append(
      health.ok ? statusRow('后端接口', '可连接', 'success') : statusRow('后端接口', '不可连接', 'danger'),
      statusRow('语音生成', '未接入'),
      statusRow('登录与云同步', '未接入'),
      statusRow('音色与历史数据', 'DEMO 本地示例', 'pending'),
    );
    if (!health.ok) {
      statusRoot.append(h('p', { class: 'list-footnote' }, health.error?.message || ''));
    }
  }

  qs('#clear-favorites').addEventListener('click', () => {
    if (!favorites.list().length) {
      showToast('本地没有收藏');
      return;
    }
    if (window.confirm('确定清除本机浏览器中的全部收藏吗？')) {
      favorites.clear();
      showToast('已清除本地收藏');
    }
  });

  qs('#reset-demo').addEventListener('click', () => {
    demoHistory.reset();
    showToast('已重置 DEMO 示例数据');
  });

  let loaded = false;
  return {
    onShow() {
      if (!loaded) {
        loaded = true;
        loadStatus();
      }
    },
  };
}
