// ========================================================
// 🛡️ 스마트 입력 마스크 및 콤마 자동 서식 (Auto-Mask Engine)
// ========================================================
(function () {
  function formatWithMask(val, maxDec) {
    if (val === undefined || val === null || val === '') return '';
    let clean = String(val).replace(/[^0-9.]/g, '');
    const parts = clean.split('.');
    let intPart = parts[0];
    let decPart = parts.length > 1 ? parts[1].slice(0, maxDec) : null;
    if (intPart) {
      intPart = parseInt(intPart, 10).toLocaleString();
    } else if (clean.startsWith('.')) {
      intPart = '0';
    }
    return decPart !== null ? `${intPart}.${decPart}` : intPart;
  }

  function parseMask(val) {
    if (!val) return 0;
    const num = parseFloat(String(val).replace(/,/g, ''));
    return isNaN(num) ? 0 : Math.max(0, num);
  }

  window.formatNumberWithMask = formatWithMask;
  window.parseMaskedNumber = parseMask;

  window.addEventListener('DOMContentLoaded', () => {
    const targets = [
      { id: 'inputUsd', dec: 4 },
      { id: 'inputTargetOffer', dec: 4 },
      { id: 'inputSoldPrice', dec: 4 },
      { id: 'inputShipFx', dec: 0 },
      { id: 'inputSettledFx', dec: 0 },
      { id: 'inputStock', dec: 0 },
      { id: 'inputSpq', dec: 0 },
      { id: 'drawerStock', dec: 0 },
      { id: 'drawerArranged', dec: 0 },
      { id: 'drawerUnitUsd', dec: 4 },
      { id: 'drawerShipFx', dec: 0 },
      { id: 'drawerSoldPrice', dec: 4 },
      { id: 'drawerSettledFx', dec: 0 }
    ];

    targets.forEach(({ id, dec }) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.setAttribute('inputmode', dec > 0 ? 'decimal' : 'numeric');
      el.addEventListener('input', () => {
        const start = el.selectionStart;
        const prev = el.value.length;
        el.value = formatWithMask(el.value, dec);
        const diff = el.value.length - prev;
        el.setSelectionRange(start + diff, start + diff);
      });
    });
  });
})();
