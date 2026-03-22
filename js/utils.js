/**
 * ユーティリティ関数クラス
 */
const Utils = (() => {
  /**
   * HTMLエスケープ
   */
  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * HTML属性向けエスケープ
   */
  function escapeAttr(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return {
    escapeHtml,
    escapeAttr
  };
})();
