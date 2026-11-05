// 분할 모달 열기 함수 (전역 바인딩 및 원본 객체 보장)
// 분할 모달 열기 (ID 및 객체 바인딩 완벽 보장)
window.openSplitModal = function(itemOrId) {
  let targetItem = null;
  const targetId = (typeof itemOrId === 'object' && itemOrId !== null) ? itemOrId.id : itemOrId;

  // 1. 캐시 배열 탐색
  const candidates = [
    ...(typeof cachedItems !== 'undefined' && Array.isArray(cachedItems) ? cachedItems : []),
    ...(typeof inventoryItems !== 'undefined' && Array.isArray(inventoryItems) ? inventoryItems : []),
    ...(window._allInventoryItems && Array.isArray(window._allInventoryItems) ? window._allInventoryItems : [])
  ];

  if (targetId) {
    targetItem = candidates.find(it => String(it.id) === String(targetId));
  }
  if (!targetItem && typeof itemOrId === 'object') {
    targetItem = itemOrId;
  }

  const modal = document.getElementById('splitShipmentModal');
  if (!modal) return;

  if (!targetItem) {
    alert("선택한 부품 정보를 인벤토리에서 찾을 수 없습니다. (ID: " + targetId + ")");
    return;
  }

  // 모달 엘리먼트 자체와 윈도우 전역에 확실히 박아둠
  modal.dataset.itemId = String(targetItem.id);
  window._currentSplitItem = targetItem;

  const title = document.getElementById('splitModalTitle');
  const maxStockText = document.getElementById('splitMaxStockText');
  const qtyInput = document.getElementById('splitQtyInput');
  const customerInput = document.getElementById('splitCustomerInput');
  const priceInput = document.getElementById('splitPriceInput');
  const repInput = document.getElementById('splitRepInput');

  const stockVal = Number(targetItem.stock) || 0;
  const partName = targetItem.partName || targetItem.part_name || '-';

  if (title) title.innerText = `부분 출하 분할 (${partName})`;
  if (maxStockText) maxStockText.innerText = `현재 보유 재고: ${stockVal.toLocaleString()} EA (최대 ${Math.max(0, stockVal - 1).toLocaleString()} EA 분할 가능)`;
  if (qtyInput) {
    qtyInput.max = Math.max(0, stockVal - 1);
    qtyInput.value = '';
  }
  if (customerInput) customerInput.value = (targetItem.customer && targetItem.customer !== '-') ? targetItem.customer : '';
  if (priceInput) priceInput.value = targetItem.soldPriceUsd || targetItem.sold_price_usd || targetItem.unitUsd || targetItem.unit_usd || '';
  if (repInput) repInput.value = targetItem.owner || '본사 일반재고';

  modal.classList.remove('hidden');
};
window.handleSplitModalOpen = window.openSplitModal;
