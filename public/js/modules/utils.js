/**
 * public/js/modules/utils.js
 * BSK ERP 공통 프론트엔드 유틸리티 (중복 코드 제거 및 일관성 확보)
 */

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function debounce(fn, wait = 200) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

export function formatKrw(amount) {
  return `₩${Math.round(Number(amount) || 0).toLocaleString()}`;
}

export function formatUsd(amount, decimals = 2) {
  return `$${(Number(amount) || 0).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })}`;
}
