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

/* BSK_SPLIT_SAFE_PATCH */
// 전역 분할 모달 오픈 핸들러
window.openSplitModal = function(idOrItem) {
  const targetId = (typeof idOrItem === 'object' && idOrItem !== null) ? idOrItem.id : String(idOrItem);
  
  // 캐시 탐색
  let target = null;
  if (typeof cachedItems !== 'undefined' && Array.isArray(cachedItems)) {
    target = cachedItems.find(x => String(x.id) === String(targetId));
  } else if (typeof inventoryItems !== 'undefined' && Array.isArray(inventoryItems)) {
    target = inventoryItems.find(x => String(x.id) === String(targetId));
  }

  const modal = document.getElementById('splitShipmentModal');
  if (!modal) return;

  if (!target && typeof idOrItem === 'object') {
    target = idOrItem;
  }

  if (!target) {
    alert("분할할 원본 품목을 찾지 못했습니다. (ID: " + targetId + ")");
    return;
  }

  window._currentSplitTarget = target;
  modal.dataset.itemId = String(target.id);

  const title = document.getElementById('splitModalTitle');
  const maxText = document.getElementById('splitMaxStockText');
  const qtyIn = document.getElementById('splitQtyInput');
  const custIn = document.getElementById('splitCustomerInput');
  const priceIn = document.getElementById('splitPriceInput');
  const repIn = document.getElementById('splitRepInput');

  const stock = parseInt(target.stock) || 0;
  const part = target.partName || target.part_name || '-';

  if (title) title.innerText = `부분 출하 분할 (${part})`;
  if (maxText) maxText.innerText = `현재 보유 재고: ${stock.toLocaleString()} EA (최대 ${Math.max(0, stock - 1).toLocaleString()} EA 가능)`;
  if (qtyIn) { qtyIn.max = Math.max(0, stock - 1); qtyIn.value = ''; }
  if (custIn) custIn.value = (target.customer && target.customer !== '-') ? target.customer : '';
  if (priceIn) priceIn.value = target.soldPriceUsd || target.sold_price_usd || target.unitUsd || target.unit_usd || '';
  if (repIn) repIn.value = target.owner || '본사 일반재고';

  modal.classList.remove('hidden');
};

// 폼 제출 리스너 재바인딩
(function initSplitSubmit() {
  const form = document.getElementById('splitShipmentForm');
  if (!form) return;

  // 기존 이벤트 중복 방지를 위한 노드 복제
  const newForm = form.cloneNode(true);
  form.parentNode.replaceChild(newForm, form);

  newForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = newForm.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.innerText = '처리 중...'; }

    try {
      const modal = document.getElementById('splitShipmentModal');
      const targetId = modal?.dataset?.itemId || window._currentSplitTarget?.id;
      
      let target = window._currentSplitTarget;
      if (!target && targetId) {
        const pool = (typeof cachedItems !== 'undefined') ? cachedItems : (typeof inventoryItems !== 'undefined' ? inventoryItems : []);
        target = pool.find(x => String(x.id) === String(targetId));
      }

      if (!target) throw new Error("원본 데이터를 불러올 수 없습니다. 다시 창을 열어주세요.");

      const splitQty = parseInt(document.getElementById('splitQtyInput')?.value) || 0;
      const splitCust = document.getElementById('splitCustomerInput')?.value?.trim() || '-';
      const splitPrice = parseFloat(document.getElementById('splitPriceInput')?.value) || 0;
      const splitRep = document.getElementById('splitRepInput')?.value || '본사 일반재고';
      const deadStockChoice = document.getElementById('splitDeadStockSelect')?.value || 'maintain';

      const originalStock = parseInt(target.stock) || 0;
      if (splitQty <= 0 || splitQty >= originalStock) {
        alert(`분할 수량은 1 이상 ${originalStock - 1} 이하만 가능합니다.`);
        if (btn) { btn.disabled = false; btn.innerText = '출하 분할 실행'; }
        return;
      }

      const client = (typeof supabase !== 'undefined' && supabase?.from) ? supabase : window.supabase;
      const remainStock = originalStock - splitQty;
      const todayStr = new Date().toISOString().slice(0, 10);

      // 1. 기존 재고 수량 감소
      const updateData = { stock: remainStock };
      if (deadStockChoice === 'hq') {
        updateData.owner = '본사 일반재고';
        updateData.customer = '-';
        updateData.order_status = '배정요청';
      }
      const { error: upErr } = await client.from('inventory_items').update(updateData).eq('id', target.id);
      if (upErr) throw new Error("기존 재고 수정 실패: " + upErr.message);

      // 2. 신규 분할 레코드 생성 (id 제외)
      const newRecord = {
        maker: target.maker || '기타',
        part_name: target.partName || target.part_name || '-',
        date_code: target.dateCode || target.date_code || '-',
        owner: splitRep,
        customer: splitCust,
        real_customer: splitCust,
        po_no: target.poNo || target.po_no || '',
        application: target.application || '',
        biz_type: 'SPLIT',
        entry_date: target.entryDate || target.entry_date || todayStr,
        shipped_date: todayStr,
        stock: splitQty,
        unit_usd: target.unitUsd ?? target.unit_usd ?? 0,
        sold_price_usd: splitPrice,
        ship_fx: target.shipFx ?? target.ship_fx ?? 1350,
        margin: 20,
        order_status: '출하완료',
        payment_terms: 'Net 30',
        payment_status: '미수',
        currency: 'USD',
        memo: `[분할출하] 원본에서 ${splitQty}EA 분할됨`
      };

      const { error: inErr } = await client.from('inventory_items').insert([newRecord]);
      if (inErr) throw new Error("분할 신규 생성 실패: " + inErr.message);

      alert(`✅ 분할 출하 성공!\n- 잔여 수량: ${remainStock.toLocaleString()} EA\n- 신규 분할 출하: ${splitQty.toLocaleString()} EA`);
      modal?.classList.add('hidden');

      if (typeof loadAndRenderInventory === 'function') {
        await loadAndRenderInventory();
      } else {
        location.reload();
      }
    } catch (err) {
      alert("❌ 분할 실패: " + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.innerText = '출하 분할 실행'; }
    }
  });
})();
