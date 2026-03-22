/**
 * utils.js - 共通ユーティリティ
 */

const Utils = (() => {
  /**
   * HTMLエスケープ
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * HTML属性値エスケープ
   */
  function escapeAttr(text) {
    return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  return { escapeHtml, escapeAttr };
})();
