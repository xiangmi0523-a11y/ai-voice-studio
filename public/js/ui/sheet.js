// 基于 <dialog> 的底部弹层：点击遮罩或“完成/关闭”按钮关闭

export function initSheet(dialog, { onClose } = {}) {
  dialog.addEventListener('click', (event) => {
    // 点击 dialog 本身（遮罩区域）时关闭
    if (event.target === dialog) dialog.close();
  });
  for (const btn of dialog.querySelectorAll('[data-close-sheet]')) {
    btn.addEventListener('click', () => dialog.close());
  }
  dialog.addEventListener('close', () => onClose?.());

  return {
    open() {
      if (!dialog.open) dialog.showModal();
    },
    close() {
      if (dialog.open) dialog.close();
    },
    get isOpen() {
      return dialog.open;
    },
  };
}
