import { initAuth, isCsOrAdminUser } from './modules/auth.js';
import { initManualViewer } from './modules/manual.js';
import { computeKpiMetrics, renderKpiBar } from './modules/kpi.js';
import { validateSpq } from './modules/packaging.js';
import { computeQuotation, computeAllocatedOverheadRate, computeFxVariance } from './calculator.js';
import { fetchInventoryItems, upsertInventoryItem, splitInventoryShipment, deleteInventoryItem, filterItems, getCachedItem, renderInventoryUI } from './inventory.js';

let rawFxRate = 1380.0;
let appliedFxRate = 1380.0;
let activeTab = 'sales';
let editingItemId = null;
let targetSplitId = null;

function safeAddListener(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

export async function bootstrap() {
  const entryDateEl = document.getElementById('inputEntryDate');
  if (entryDateEl) entryDateEl.value = new Date().toISOString().slice(0, 10);

  try {
    const fxRes = await fetch('/api/fx-rate');
    const fxData = await fxRes.json();
    rawFxRate = fxData.current_rate;
  } catch (err) {
    console.warn("FX 기본값 유지", err);
  }
  updateFxDisplay();

  bindTabSwitch();
  bindInputs();
  bindModals();
  initManualViewer();

  // 💡 모듈화된 인증 핸들러 시작
  initAuth(async (session, canEdit) => {
    updateFormVisibility(canEdit);
    if (session) {
      await refreshInventory();
    } else {
      renderInventoryUI([], activeTab, () => {}, () => {}, () => {}, false);
    }
  });

  runEngine();
}

function bindTabSwitch() {
  const tabSales = document.getElementById('tabSales');
  const tabFulfillment = document.getElementById('tabFulfillment');
  const salesPanel = document.getElementById('salesQuotationPanel');
  const csHeaderDesc = document.getElementById('csHeaderDesc');

  tabSales?.addEventListener('click', () => {
    activeTab = 'sales';
    tabSales.className = "py-2 px-2 sm:px-4 text-[11px] sm:text-xs font-bold rounded-lg bg-indigo-600 text-white shadow-sm text-center transition-colors";
    if (tabFulfillment) tabFulfillment.className = "py-2 px-2 sm:px-4 text-[11px] sm:text-xs font-semibold rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 text-center transition-colors";
    salesPanel?.classList.remove('hidden');
    if (csHeaderDesc) csHeaderDesc.innerText = "영업 협의 수주 현황 및 실판매가를 확인합니다.";
    updateFormVisibility(isCsOrAdminUser());
    applyFilters();
  });

  tabFulfillment?.addEventListener('click', () => {
    activeTab = 'fulfillment';
    tabFulfillment.className = "py-2 px-2 sm:px-4 text-[11px] sm:text-xs font-bold rounded-lg bg-indigo-600 text-white shadow-sm text-center transition-colors";
    if (tabSales) tabSales.className = "py-2 px-2 sm:px-4 text-[11px] sm:text-xs font-semibold rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 text-center transition-colors";
    salesPanel?.classList.add('hidden');
    if (csHeaderDesc) csHeaderDesc.innerText = "출하 스케줄, 운송장/인보이스 번호 및 미수금 만기 일정을 관리합니다.";
    updateFormVisibility(isCsOrAdminUser());
    applyFilters();
  });
}

function updateFormVisibility(canEdit) {
  const formTitle = document.getElementById('formTitle');
  const formSubtitle = document.getElementById('formSubtitle');
  const salesFields = document.querySelectorAll('.sales-only-field');
  const fulfillmentFields = document.querySelectorAll('.fulfillment-only-field');
  const saveBtn = document.getElementById('saveItemBtn');

  if (activeTab === 'sales') {
    if (formTitle) formTitle.innerText = "수주 및 재고 배정 등록 (Sales Order Entry)";
    if (formSubtitle) formSubtitle.innerText = "공식 배정 물량, 협의 단가 및 Date Code를 설정합니다.";
    if (saveBtn) saveBtn.innerText = "수주/배정 저장";
    salesFields.forEach(el => el.classList.remove('hidden'));
    fulfillmentFields.forEach(el => el.classList.add('hidden'));
  } else {
    if (formTitle) formTitle.innerText = "출하 처리 및 세금계산서/정산 등록 (Fulfillment & Billing)";
    if (formSubtitle) formSubtitle.innerText = "실물 출고(송장), 세금계산서(인보이스) 발행 및 채권 결제 만기를 관리합니다.";
    if (saveBtn) saveBtn.innerText = "출하/정산 업데이트";
    salesFields.forEach(el => el.classList.add('hidden'));
    fulfillmentFields.forEach(el => el.classList.remove('hidden'));
  }

  if (!canEdit) {
    if (saveBtn) saveBtn.classList.add('hidden');
    document.querySelectorAll('#formSection input, #formSection select').forEach(inp => {
      inp.disabled = true;
      inp.classList.add('bg-slate-50', 'cursor-default');
    });
  } else {
    if (saveBtn) saveBtn.classList.remove('hidden');
    document.querySelectorAll('#formSection input, #formSection select').forEach(inp => {
      inp.disabled = false;
      inp.classList.remove('bg-slate-50', 'cursor-default');
    });
  }
}

function updateFxDisplay() {
  const bufferEl = document.getElementById('fxBufferSelect');
  const buffer = bufferEl ? (parseFloat(bufferEl.value) || 0) : 0;
  appliedFxRate = rawFxRate + buffer;
  const bufferText = buffer > 0 ? ` (+${buffer}원)` : "";
  const liveFxEl = document.getElementById('liveFx');
  if (liveFxEl) {
    liveFxEl.innerText = `$1.00 (₩${Math.round(appliedFxRate).toLocaleString()})${bufferText}`;
  }
  runEngine();
}

function bindInputs() {
  ['inputUsd', 'inputStock', 'inputShipFx', 'inputOverhead', 'inputTargetOffer', 'inputApprovedDebit'].forEach(id => {
    safeAddListener(id, 'input', runEngine);
  });

  safeAddListener('fxBufferSelect', 'change', updateFxDisplay);
  safeAddListener('copyQuoteBtn', 'click', copyQuotation);

  // SPQ 포장단위 실시간 피드백
  safeAddListener('inputStock', 'change', () => {
    const maker = document.getElementById('selectMaker')?.value;
    const qty = parseInt(document.getElementById('inputStock')?.value) || 0;
    const spqResult = validateSpq(maker, qty);
    if (!spqResult.isValid) {
      alert(`[포장단위 안내] ${maker} 라인의 표준 Reel 단위는 ${spqResult.spq.toLocaleString()} EA 입니다.\n입력 수량(${qty.toLocaleString()} EA) 진행 시 자투리 잉여재고가 발생할 수 있습니다.\n권장 수량: ${spqResult.recommendedQty.toLocaleString()} EA`);
    }
  });

  const spaCheck = document.getElementById('checkIsSpa');
  const spaDebitWrapper = document.getElementById('spaDebitWrapper');
  spaCheck?.addEventListener('change', () => {
    spaDebitWrapper?.classList.toggle('hidden', !spaCheck.checked);
    runEngine();
  });

  safeAddListener('inputSettledFx', 'input', updateFxVarianceFeedback);

  bindCustomSelect('selectMaker', 'inputCustomMaker', '__CUSTOM_MAKER__');
  bindCustomSelect('selectOwner', 'inputCustomOwner', '__CUSTOM_OWNER__');

  ['searchInput', 'filterMaker', 'filterOwner', 'filterPayment'].forEach(id => {
    safeAddListener(id, 'input', applyFilters);
    safeAddListener(id, 'change', applyFilters);
  });

  safeAddListener('saveItemBtn', 'click', saveCurrentForm);
  safeAddListener('openLandedCostBtn', 'click', () => {
    document.getElementById('landedCostModal')?.classList.remove('hidden');
  });
}

function updateFxVarianceFeedback() {
  const orderFx = parseFloat(document.getElementById('inputShipFx')?.value) || 1350;
  const settledFx = parseFloat(document.getElementById('inputSettledFx')?.value) || 0;
  const soldPrice = parseFloat(document.getElementById('inputSoldPrice')?.value) || 0;
  const stock = parseInt(document.getElementById('inputStock')?.value) || 0;
  const display = document.getElementById('fxVarianceDisplay');

  if (!display) return;

  if (settledFx > 0 && soldPrice > 0 && stock > 0) {
    const diffKrw = computeFxVariance(soldPrice, stock, orderFx, settledFx);
    if (diffKrw > 0) {
      display.className = "text-[11px] font-bold text-green-600 block mt-1";
      display.innerText = `📈 환차익: +₩${Math.round(diffKrw).toLocaleString()} 발생 (수금 환율 +${(settledFx - orderFx).toFixed(1)}원)`;
    } else if (diffKrw < 0) {
      display.className = "text-[11px] font-bold text-red-600 block mt-1";
      display.innerText = `📉 환차손: -₩${Math.round(Math.abs(diffKrw)).toLocaleString()} 발생 (수금 환율 ${(settledFx - orderFx).toFixed(1)}원)`;
    } else {
      display.className = "text-[11px] font-semibold text-slate-500 block mt-1";
      display.innerText = `환율 변동 없음 (₩0)`;
    }
  } else {
    display.innerText = "";
  }
}

function bindCustomSelect(selectId, inputId, customVal) {
  const sel = document.getElementById(selectId);
  const inp = document.getElementById(inputId);
  if (!sel || !inp) return;
  sel.addEventListener('change', () => {
    inp.classList.toggle('hidden', sel.value !== customVal);
    if (sel.value === customVal) inp.focus();
  });
}

function bindModals() {
  const landedCostForm = document.getElementById('landedCostForm');
  if (landedCostForm) {
    landedCostForm.onsubmit = (e) => {
      e.preventDefault();
      const totalGoods = parseFloat(document.getElementById('lcTotalGoodsUsd')?.value) || 0;
      const totalFreight = parseFloat(document.getElementById('lcFreightUsd')?.value) || 0;
      const totalCustomsKrw = parseFloat(document.getElementById('lcCustomsKrw')?.value) || 0;
      const shipFxEl = document.getElementById('inputShipFx');
      const fxRate = shipFxEl ? (parseFloat(shipFxEl.value) || 1350) : 1350;

      const totalCustomsUsd = totalCustomsKrw / fxRate;
      const totalOverheadUsd = totalFreight + totalCustomsUsd;

      const calculatedOverheadRate = computeAllocatedOverheadRate(totalGoods, totalOverheadUsd);
      const overheadInput = document.getElementById('inputOverhead');
      if (overheadInput) overheadInput.value = calculatedOverheadRate.toFixed(2);
      
      const overheadDisplay = document.getElementById('overheadDisplay');
      if (overheadDisplay) overheadDisplay.innerText = `+${calculatedOverheadRate.toFixed(2)}% 배부됨`;

      document.getElementById('landedCostModal')?.classList.add('hidden');
      runEngine();
      alert(`[배부 완료] 선적 총액($${totalGoods.toLocaleString()}) 대비 부대비용 가산율 +${calculatedOverheadRate.toFixed(2)}%가 원가에 자동 적용되었습니다.`);
    };
  }

  const splitShipmentForm = document.getElementById('splitShipmentForm');
  if (splitShipmentForm) {
    splitShipmentForm.onsubmit = async (e) => {
      e.preventDefault();
      if (!isCsOrAdminUser()) return;
      const qty = parseInt(document.getElementById('splitQtyInput')?.value) || 0;
      const price = parseFloat(document.getElementById('splitPriceInput')?.value) || 0;
      const cust = document.getElementById('splitCustomerInput')?.value.trim();
      const rep = document.getElementById('splitRepInput')?.value;
      const deadStockAction = document.getElementById('splitDeadStockSelect')?.value || 'maintain';

      try {
        await splitInventoryShipment(targetSplitId, qty, price, cust, rep, deadStockAction);
        alert(`${qty.toLocaleString()}개가 [${cust}] 건으로 분할 출하 등록되었습니다.`);
        document.getElementById('splitShipmentModal')?.classList.add('hidden');
        await refreshInventory();
      } catch (err) {
        alert("분할 실패: " + err.message);
      }
    };
  }
}

function runEngine() {
  const unitUsd = parseFloat(document.getElementById('inputUsd')?.value) || 0;
  const stock = parseFloat(document.getElementById('inputStock')?.value) || 0;
  const shipFx = parseFloat(document.getElementById('inputShipFx')?.value) || 0;
  const overhead = (parseFloat(document.getElementById('inputOverhead')?.value) || 0) / 100;
  const targetOffer = parseFloat(document.getElementById('inputTargetOffer')?.value) || 0;

  const isSpa = document.getElementById('checkIsSpa')?.checked || false;
  const approvedDebit = parseFloat(document.getElementById('inputApprovedDebit')?.value) || 0;

  const result = computeQuotation({
    unitUsd,
    qty: stock,
    shipFx,
    overheadRate: overhead,
    targetMarginRate: 0.20,
    appliedFxRate,
    targetOfferUsd: targetOffer,
    isSpa,
    approvedDebitUsd: approvedDebit
  });

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerText = val;
  };

  setText('minSaleUnitActualUsd', `$${result.unitMinPriceActualUsd.toFixed(4)}`);
  setText('minSaleUnitActualKrw', `(₩${Math.round(result.unitMinPriceActualKrw).toLocaleString()} / @${Math.round(shipFx).toLocaleString()})`);
  setText('minSaleTotalActual', `$${result.totalMinPriceActualUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} (₩${Math.round(result.totalActualCostKrw / (1 - 0.2)).toLocaleString()})`);

  setText('minSaleUnitReplaceUsd', `$${result.unitMinPriceReplaceUsd.toFixed(4)}`);
  setText('minSaleUnitReplaceKrw', `(₩${Math.round(result.unitMinPriceReplaceKrw).toLocaleString()} / @${Math.round(appliedFxRate).toLocaleString()})`);
  setText('minSaleTotalReplace', `$${result.totalMinPriceReplaceUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} (₩${Math.round(result.totalReplaceCostKrw / (1 - 0.2)).toLocaleString()})`);

  const revMarginEl = document.getElementById('reverseMarginReplace');
  const revBadgeEl = document.getElementById('reverseMarginBadge');
  if (result.expectedMargin !== null) {
    if (revMarginEl) revMarginEl.innerText = `${result.expectedMargin.toFixed(2)}%`;
    if (revBadgeEl) {
      if (isSpa && approvedDebit > 0) {
        revBadgeEl.className = "text-[11px] font-bold text-cyan-800 bg-cyan-100 border border-cyan-300 px-2 py-0.5 rounded-full inline-block mt-0.5";
        revBadgeEl.innerText = `🔵 SPA 승인가 적용`;
      } else if (result.expectedMargin >= 20) {
        revBadgeEl.className = "text-[11px] font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full inline-block mt-0.5";
        revBadgeEl.innerText = "✅ 수주 가능";
      } else if (result.expectedMargin > 0) {
        revBadgeEl.className = "text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full inline-block mt-0.5";
        revBadgeEl.innerText = "⚠️ 마진 미달";
      } else {
        revBadgeEl.className = "text-[11px] font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full inline-block mt-0.5";
        revBadgeEl.innerText = "🚨 역마진 불가";
      }
    }
  } else {
    if (revMarginEl) revMarginEl.innerText = "- %";
    if (revBadgeEl) {
      revBadgeEl.className = "text-[11px] font-bold text-slate-400 mt-0.5";
      revBadgeEl.innerText = "단가를 입력하세요";
    }
  }

  renderTierTable(result.unitMinPriceReplaceUsd, result.unitMinPriceReplaceKrw, stock);
}

function renderTierTable(unitUsd, unitKrw, currentQty) {
  const tiers = [
    { label: "1,000", qty: 1000 },
    { label: "5,000", qty: 5000 },
    { label: "10,000", qty: 10000 }
  ];

  if (![1000, 5000, 10000].includes(currentQty) && currentQty > 0) {
    tiers.push({ label: `${currentQty.toLocaleString()}(현재)`, qty: currentQty, isCurrent: true });
    tiers.sort((a, b) => a.qty - b.qty);
  }

  const tbody = document.getElementById('tierTableBody');
  if (!tbody) return;
  tbody.innerHTML = tiers.map(t => `
    <tr class="${t.isCurrent ? "bg-indigo-50/70 font-bold text-indigo-900" : ""}">
      <td class="py-1 px-1">${t.label}</td>
      <td class="py-1 px-1 text-indigo-950 font-black text-xs">$${unitUsd.toFixed(4)}</td>
      <td class="py-1 px-1 text-slate-600 font-semibold text-[11px]">₩${Math.round(unitKrw).toLocaleString()}</td>
      <td class="py-1 px-1 text-slate-800 font-bold">$${(unitUsd * t.qty).toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})}</td>
    </tr>
  `).join('');
}

async function refreshInventory() {
  try {
    const items = await fetchInventoryItems();
    
    // 💡 KPI 서머리 바 동기화
    const kpiMetrics = computeKpiMetrics(items, rawFxRate);
    renderKpiBar(kpiMetrics);

    applyFilters();
  } catch (err) {
    console.error("데이터 로드 실패", err);
  }
}

function applyFilters() {
  const canEdit = isCsOrAdminUser();
  const filtered = filterItems({
    query: document.getElementById('searchInput')?.value || "",
    filterMaker: document.getElementById('filterMaker')?.value || "",
    filterOwner: document.getElementById('filterOwner')?.value || "",
    filterPayment: document.getElementById('filterPayment')?.value || ""
  });
  renderInventoryUI(filtered, activeTab, loadFormFromItem, handleDeleteItem, handleOpenSplitModal, canEdit);
}

function loadFormFromItem(id) {
  if (!isCsOrAdminUser()) return;
  const item = getCachedItem(id);
  if (!item) return;

  editingItemId = item.id;

  setSelectValue('selectMaker', 'inputCustomMaker', item.maker, '__CUSTOM_MAKER__');
  setSelectValue('selectOwner', 'inputCustomOwner', item.owner, '__CUSTOM_OWNER__');
  
  const setVal = (inputKey, val) => {
    const el = document.getElementById(inputKey);
    if (el) el.value = val;
  };

  setVal('inputPartName', item.partName);
  setVal('inputDateCode', item.dateCode !== '-' ? item.dateCode : '');
  setVal('inputCustomer', item.customer !== '-' ? item.customer : '');
  setVal('inputSoldPrice', item.soldPriceUsd || '');
  setVal('selectOrderStatus', item.orderStatus);
  setVal('selectPaymentTerms', item.paymentTerms);
  setVal('selectPaymentStatus', item.paymentStatus);
  setVal('selectCurrency', item.currency);
  setVal('inputInvoiceNo', item.invoiceNo || '');
  setVal('inputTrackingNo', item.trackingNo || '');
  setVal('inputDueDate', item.dueDate || '');
  setVal('inputShippedDate', item.shippedDate || '');
  setVal('inputSettledDate', item.settledDate || '');
  setVal('inputSettledFx', item.settledFx || '');
  setVal('inputEntryDate', item.entryDate);
  setVal('inputMemo', item.memo);
  setVal('inputUsd', item.unitUsd);
  setVal('inputShipFx', item.shipFx);
  setVal('inputStock', item.stock);

  const spaCheck = document.getElementById('checkIsSpa');
  const spaDebitWrapper = document.getElementById('spaDebitWrapper');
  if (spaCheck) {
    spaCheck.checked = item.isSpa;
    spaDebitWrapper?.classList.toggle('hidden', !item.isSpa);
    if (item.isSpa) setVal('inputApprovedDebit', item.approvedDebitUsd || '');
  }

  const editingBanner = document.getElementById('editingBanner');
  editingBanner?.classList.remove('hidden');
  const bannerText = document.getElementById('editingBannerText');
  if (bannerText) {
    bannerText.innerText = `선택된 항목: [${item.maker}] ${item.partName} (D/C: ${item.dateCode} / ${item.customer})`;
  }

  updateFxVarianceFeedback();
  runEngine();
  document.getElementById('formSection')?.scrollIntoView({ behavior: 'smooth' });
}

function handleOpenSplitModal(id) {
  if (!isCsOrAdminUser()) return;
  const item = getCachedItem(id);
  if (!item) return;
  targetSplitId = item.id;

  const titleEl = document.getElementById('splitModalTitle');
  if (titleEl) titleEl.innerText = `[${item.partName}] 출하 분할 (D/C: ${item.dateCode})`;
  const maxStockEl = document.getElementById('splitMaxStockText');
  if (maxStockEl) maxStockEl.innerText = `현재 보유 재고: ${item.stock.toLocaleString()} EA (소유: ${item.owner})`;
  
  const qtyInput = document.getElementById('splitQtyInput');
  if (qtyInput) {
    qtyInput.max = item.stock - 1;
    qtyInput.value = Math.min(1000, item.stock - 1);
  }
  const priceInput = document.getElementById('splitPriceInput');
  if (priceInput) priceInput.value = item.soldPriceUsd || item.unitUsd;
  const custInput = document.getElementById('splitCustomerInput');
  if (custInput) custInput.value = item.customer !== '-' ? item.customer : '';
  const repInput = document.getElementById('splitRepInput');
  if (repInput) repInput.value = item.owner;

  document.getElementById('splitShipmentModal')?.classList.remove('hidden');
}

function setSelectValue(selectId, inputId, val, customKey) {
  const sel = document.getElementById(selectId);
  const inp = document.getElementById(inputId);
  if (!sel) return;
  const exists = Array.from(sel.options).some(o => o.value === val);
  if (exists && val !== customKey) {
    sel.value = val;
    inp?.classList.add('hidden');
    if (inp) inp.value = '';
  } else {
    sel.value = customKey;
    inp?.classList.remove('hidden');
    if (inp) inp.value = val || '';
  }
}

async function saveCurrentForm() {
  if (!isCsOrAdminUser()) return;

  const partName = document.getElementById('inputPartName')?.value.trim();
  if (!partName) {
    alert("제품명을 입력해주세요.");
    return;
  }

  const makerSel = document.getElementById('selectMaker');
  const maker = (makerSel && makerSel.value === '__CUSTOM_MAKER__') ? document.getElementById('inputCustomMaker')?.value.trim() : makerSel?.value;
  const ownerSel = document.getElementById('selectOwner');
  const owner = (ownerSel && ownerSel.value === '__CUSTOM_OWNER__') ? document.getElementById('inputCustomOwner')?.value.trim() : ownerSel?.value;

  const isSpa = document.getElementById('checkIsSpa')?.checked || false;
  const approvedDebit = parseFloat(document.getElementById('inputApprovedDebit')?.value) || 0;

  const payload = {
    maker: maker || "기타",
    part_name: partName,
    date_code: document.getElementById('inputDateCode')?.value.trim() || "-",
    owner: owner || "본사 일반재고",
    customer: document.getElementById('inputCustomer')?.value.trim() || "-",
    sold_price_usd: parseFloat(document.getElementById('inputSoldPrice')?.value) || 0,
    order_status: document.getElementById('selectOrderStatus')?.value || "배정요청",
    payment_terms: document.getElementById('selectPaymentTerms')?.value || "Net 30",
    payment_status: document.getElementById('selectPaymentStatus')?.value || "미수",
    currency: document.getElementById('selectCurrency')?.value || "USD",
    invoice_no: document.getElementById('inputInvoiceNo')?.value.trim() || "",
    tracking_no: document.getElementById('inputTrackingNo')?.value.trim() || "",
    due_date: document.getElementById('inputDueDate')?.value || null,
    shipped_date: document.getElementById('inputShippedDate')?.value || null,
    settled_date: document.getElementById('inputSettledDate')?.value || null,
    settled_fx: parseFloat(document.getElementById('inputSettledFx')?.value) || 0,
    entry_date: document.getElementById('inputEntryDate')?.value || new Date().toISOString().slice(0, 10),
    memo: document.getElementById('inputMemo')?.value.trim() || "",
    unit_usd: parseFloat(document.getElementById('inputUsd')?.value) || 0,
    ship_fx: parseFloat(document.getElementById('inputShipFx')?.value) || 1350,
    stock: parseInt(document.getElementById('inputStock')?.value) || 0,
    margin: 20,
    is_spa: isSpa,
    approved_debit_usd: isSpa ? approvedDebit : 0
  };

  try {
    await upsertInventoryItem(payload, editingItemId);
    alert(`[${payload.part_name}] 데이터가 안전하게 저장되었습니다.`);
    editingItemId = null;
    document.getElementById('editingBanner')?.classList.add('hidden');
    await refreshInventory();
  } catch (err) {
    alert("저장 실패: " + err.message);
  }
}

async function handleDeleteItem(id) {
  if (!isCsOrAdminUser()) return;
  if (!confirm("해당 건을 영구 삭제하시겠습니까?")) return;
  try {
    await deleteInventoryItem(id);
    editingItemId = null;
    document.getElementById('editingBanner')?.classList.add('hidden');
    await refreshInventory();
  } catch (err) {
    alert("삭제 실패: " + err.message);
  }
}

function copyQuotation() {
  const partName = document.getElementById('inputPartName')?.value.trim() || "-";
  const dateCode = document.getElementById('inputDateCode')?.value.trim() || "-";
  const qty = parseFloat(document.getElementById('inputStock')?.value) || 0;
  const unitUsd = document.getElementById('minSaleUnitReplaceUsd')?.innerText || "-";
  const unitKrw = document.getElementById('minSaleUnitReplaceKrw')?.innerText || "-";
  const totalReplace = document.getElementById('minSaleTotalReplace')?.innerText || "-";
  const fxRateText = document.getElementById('liveFx')?.innerText || "-";

  const quote = `[견적 안내] ${partName} (D/C: ${dateCode})\n- 수량: ${qty.toLocaleString()} EA\n- 공급단가: ${unitUsd} ${unitKrw}\n- 총견적액: ${totalReplace}\n* 기준환율: ${fxRateText}`;
  navigator.clipboard.writeText(quote).then(() => alert("견적서 텍스트가 복사되었습니다!"));
}

bootstrap();
