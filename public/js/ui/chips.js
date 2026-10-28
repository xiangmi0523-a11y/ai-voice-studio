import { clear, h } from '../core/dom.js';

// 单选筛选标签
export function renderChips(container, options, value, onChange) {
  clear(container);
  for (const option of options) {
    container.append(
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          role: 'radio',
          'aria-checked': String(option.value === value),
          onclick: () => onChange(option.value),
        },
        option.label,
      ),
    );
  }
}
