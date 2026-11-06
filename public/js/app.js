
// ========================================================
// 📄 BSK 표준 견적서 모달 열기 및 데이터 매핑
// ========================================================
function openQuotationModal() {
  // 현재 선택된 행 아이템 추출
  let item = null;
  const activeId = window._currentActiveItemId || document.getElementById("drawerItemId")?.value;
  if (activeId && window.cachedItems) {
    item = window.cachedItems.find(it => String(it.id) === String(activeId));
  }

  // 1. 부품명 / 제조사
  const partName = (item && (item.partName || item.part_name)) || document.getElementById("inputPartName")?.value.trim() || document.getElementById("drawerPartDisplay")?.innerText || "XK-VOICE-SQ66";
  const maker = (item && item.maker) || document.getElementById("selectMaker")?.value || document.getElementById("drawerMfgDisplay")?.innerText || "XMOS";
  
  // 2. 고객사 / 담당자
  const rawCustomer = (item && item.customer && item.customer !== "-") ? item.customer : (document.getElementById("inputCustomer")?.value.trim() || "프라젠");
  const customer = rawCustomer !== "-" ? rawCustomer : "프라젠";
  const sales = (item && item.owner && item.owner !== "-" && item.owner !== "본사 일반재고") ? item.owner : (document.getElementById("selectOwner")?.value || "김경래");

  // 3. 수량
  let stock = 1;
  if (item && item.stock) {
    stock = Number(item.stock) || 1;
  } else {
    stock = parseMaskedNumber(document.getElementById("inputStock")?.value) || parseMaskedNumber(document.getElementById("drawerStock")?.value) || 1;
  }

  // 4. 단가 및 금액 계산
  const shipFx = (item && (item.shipFx || item.ship_fx)) ? Number(item.shipFx || item.ship_fx) : (parseMaskedNumber(document.getElementById("inputShipFx")?.value) || 1350);
  
  let unitKrw = 0;
  if (item && item.soldPriceUsd && Number(item.soldPriceUsd) > 0) {
    unitKrw = Math.round(Number(item.soldPriceUsd) * shipFx);
  } else if (item && item.unitUsd && Number(item.unitUsd) > 0) {
    unitKrw = Math.round(Number(item.unitUsd) * shipFx);
  } else {
    const rawKrwText = document.getElementById("minSaleUnitReplaceKrw")?.innerText || "";
    const match = rawKrwText.match(/₩([0-9,]+)/);
    unitKrw = match ? parseInt(match[1].replace(/,/g, ""), 10) : 350000;
  }

  // 오늘 날짜 및 REF 번호
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const todayStr = `${yyyy}-${mm}-${dd}`;
  const refNo = `QBK${String(yyyy).slice(2)}${mm}-${dd}${Math.floor(10 + Math.random() * 90)}`;

  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === "INPUT") el.value = val;
    else el.innerText = val;
  };

  setEl("qpCustomer", customer);
  setEl("qpDate", todayStr);
  setEl("qpRefNo", refNo);
  setEl("qpSales", (sales && sales !== "본사 일반재고") ? sales : "김경래");
  setEl("qpPartName", partName);
  setEl("qpMaker", (maker && maker !== "__CUSTOM_MAKER__") ? maker : "XMOS");
  setEl("qpQty", `${stock.toLocaleString()} EA`);

  const amountKrw = unitKrw * stock;
  const vatKrw = Math.round(amountKrw * 0.1);
  const grandTotalKrw = amountKrw + vatKrw;

  setEl("qpUnitPrice", `₩${unitKrw.toLocaleString()}`);
  setEl("qpAmount", `₩${amountKrw.toLocaleString()}`);
  setEl("qpSubTotal", `₩${amountKrw.toLocaleString()}`);
  setEl("qpVat", `₩${vatKrw.toLocaleString()}`);
  setEl("qpGrandTotal", `₩${grandTotalKrw.toLocaleString()}`);

  document.getElementById("quotationModal")?.classList.remove("hidden");
}
window.openQuotationModal = openQuotationModal;




// --- ⚡ 성능 최적화: 디바운스 (Debounce) 함수 ---
function debounce(func, delay = 250) {
  let timer = null;
  return function(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      func.apply(this, args);
    }, delay);
  };
}

// --- 행 선택 강조 및 저장 후 즉시 스크롤/점멸 추적 (인라인 스타일 보장) ---
window._lastSavedItemId = null;

window.highlightActiveRow = function(itemId) {
  // 이전 선택 행들 인라인 스타일 초기화
  document.querySelectorAll('tr[id^="row-item-"]').forEach(tr => {
    tr.style.backgroundColor = '';
    tr.style.borderLeft = '';
  });
  if (!itemId) return;

  const tr = document.getElementById(`row-item-${itemId}`) || document.querySelector(`tr[data-item-id="${itemId}"]`);
  if (tr) {
    tr.style.backgroundColor = '#dbeafe'; // 부드러운 블루
    tr.style.borderLeft = '6px solid #4f46e5'; // 진한 인디고 바
  }
};

window.flashSavedRow = function(itemId) {
  if (!itemId) return;
  window._lastSavedItemId = itemId;

  // DOM 렌더링 완료 감지 루프
  let count = 0;
  const timer = setInterval(() => {
    count++;
    const tr = document.getElementById(`row-item-${itemId}`) || document.querySelector(`tr[data-item-id="${itemId}"]`);
    if (tr) {
      clearInterval(timer);

      // 1. 해당 행으로 스크롤 부드럽게 이동
      tr.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // 2. 브라우저 네이티브 애니메이션으로 노란색 번쩍임 실행
      tr.animate([
        { backgroundColor: '#fef08a', borderLeft: '6px solid #eab308' },
        { backgroundColor: '#fef9c3', borderLeft: '6px solid #ca8a04' },
        { backgroundColor: '#dbeafe', borderLeft: '6px solid #4f46e5' }
      ], {
        duration: 2500,
        fill: 'forwards'
      });
    }
    if (count > 30) clearInterval(timer);
  }, 100);
};
// 분할 모달 열기 함수 (전역 바인딩 및 원본 객체 보장)
window.openSplitModal = function(itemOrId) {
  const canEdit = (typeof window.isCsOrAdminUser === 'function') 
    ? window.isCsOrAdminUser() 
    : ((typeof isCsOrAdminUser === 'function') ? isCsOrAdminUser() : false);

  if (!canEdit) {
    alert("부분 출하 분할 기능은 CS 및 관리자 권한만 가능합니다.");
    return;
  }
  let item = null;
  if (typeof itemOrId === 'object' && itemOrId !== null) {
    item = itemOrId;
  } else if (typeof cachedItems !== 'undefined' && Array.isArray(cachedItems)) {
    item = cachedItems.find(it => String(it.id) === String(itemOrId));
  } else if (typeof inventoryItems !== 'undefined' && Array.isArray(inventoryItems)) {
    item = inventoryItems.find(it => String(it.id) === String(itemOrId));
  }

  if (!item) {
    alert("분할할 원본 부품 정보를 찾을 수 없습니다. 다시 시도해 주세요.");
    return;
  }

  window._currentSplitItem = item;

  const modal = document.getElementById('splitShipmentModal');
  const title = document.getElementById('splitModalTitle');
  const maxStockText = document.getElementById('splitMaxStockText');
  const qtyInput = document.getElementById('splitQtyInput');
  const customerInput = document.getElementById('splitCustomerInput');
  const priceInput = document.getElementById('splitPriceInput');
  const repInput = document.getElementById('splitRepInput');

  const stockVal = Number(item.stock) || 0;
  const partName = item.partName || item.part_name || '-';

  if (title) title.innerText = `부분 출하 분할 (${partName})`;
  if (maxStockText) maxStockText.innerText = `현재 보유 재고: ${stockVal.toLocaleString()} EA (최대 ${Math.max(0, stockVal - 1).toLocaleString()} EA 분할 가능)`;
  if (qtyInput) {
    qtyInput.max = Math.max(0, stockVal - 1);
    qtyInput.value = '';
  }
  if (customerInput) customerInput.value = (item.customer && item.customer !== '-') ? item.customer : '';
  if (priceInput) priceInput.value = item.soldPriceUsd || item.sold_price_usd || item.unitUsd || item.unit_usd || '';
  if (repInput) repInput.value = item.owner || '본사 일반재고';

  modal?.classList.remove('hidden');
};

import { supabase } from './supabase.js';
import * as InventoryModule from './inventory.js';
import { initAuth, isCsOrAdminUser } from './modules/auth.js';
window.isCsOrAdminUser = isCsOrAdminUser;
import { initManualViewer } from './modules/manual.js';
import { computeKpiMetrics, renderKpiBar } from './modules/kpi.js';
import {
  evaluatePackaging,
  fetchPackagingStandards,
  getStandardSpq,
  getAllStandards,
  savePackagingStandard
} from './modules/packaging.js';
import { openTrackingModal } from './modules/courier.js';
import { exportToExcel, handleExcelFileSelect, executeBatchUpload } from './modules/excel.js';
import { recordAuditLog, renderAuditHistory, fetchAuditLogs } from './modules/audit.js';
window.recordAuditLog = recordAuditLog;
window.fetchAuditLogs = fetchAuditLogs;
import { computeQuotation, computeAllocatedOverheadRate, computeFxVariance } from './calculator.js';

let cachedItems = [];
let rawFxRate = 1380.0;
let appliedFxRate = 1380.0;
let activeTab = 'sales';
let editingItemId = null;
let targetSplitId = null;

function callRenderInventoryHeaders(tab) {
  const fn = InventoryModule.renderInventoryHeaders || InventoryModule.default?.renderInventoryHeaders;
  if (typeof fn === 'function') fn(tab);
}

function callRenderInventoryList(items) {
  const fn = InventoryModule.renderInventoryList || InventoryModule.renderInventoryTable || InventoryModule.default;
  if (typeof fn === 'function') {
    fn(items, activeTab, loadFormFromItem, handleDeleteItem, handleOpenSplitModal, (typeof isCsOrAdminUser === 'function' ? isCsOrAdminUser() : false));
  }
}

function getCachedItem(id) {
  return cachedItems.find(item => String(item.id) === String(id)) || null;
}

async function fetchInventoryItems() {
  const client = (typeof supabase !== 'undefined' && supabase?.from)
    ? supabase
    : (window.supabase?.from ? window.supabase : null);

  if (!client) {
    throw new Error("Supabase client is not ready");
  }

  // Supabase의 단일 쿼리 1,000건 제한을 우회하여 전건(1,500건 이상) 청크 로드
  let allData = [];
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const to = from + pageSize - 1;
    const { data, error } = await client
      .from('inventory_items')
      .select('*')
      .range(from, to)
      .order('entry_date', { ascending: false, nullsFirst: false });

    if (error) throw error;

    if (data && data.length > 0) {
      allData = allData.concat(data);
      if (data.length < pageSize) {
        hasMore = false;
      } else {
        from += pageSize;
      }
    } else {
      hasMore = false;
    }
  }

  const data = allData;

  const mappedItems = (data || []).map(r => ({
    id: r.id,
    maker: r.maker || '-',
    partName: r.part_name || r.partName || '-',
    part_name: r.part_name || r.partName || '-',
    dateCode: r.date_code || r.dateCode || '-',
    date_code: r.date_code || r.dateCode || '-',
    owner: r.owner || '-',
    customer: r.customer || '-',
    realCustomer: r.real_customer || r.realCustomer || '-',
    real_customer: r.real_customer || r.realCustomer || '-',
    poNo: r.po_no || r.poNo || '',
    po_no: r.po_no || r.poNo || '',
    application: r.application || '',
    bizType: r.biz_type || r.bizType || 'DOMESTIC',
    biz_type: r.biz_type || r.bizType || 'DOMESTIC',
    taxDate: r.tax_date || r.taxDate || null,
    tax_date: r.tax_date || r.taxDate || null,
    soldPriceUsd: (r.sold_price_usd !== null && r.sold_price_usd !== undefined) ? Number(r.sold_price_usd) : 0,
    sold_price_usd: (r.sold_price_usd !== null && r.sold_price_usd !== undefined) ? Number(r.sold_price_usd) : 0,
    orderStatus: r.order_status || r.orderStatus || '배정요청',
    order_status: r.order_status || r.orderStatus || '배정요청',
    paymentTerms: r.payment_terms || r.paymentTerms || 'Net 30',
    payment_terms: r.payment_terms || r.paymentTerms || 'Net 30',
    paymentStatus: r.payment_status || r.paymentStatus || '미수',
    payment_status: r.payment_status || r.paymentStatus || '미수',
    currency: r.currency || 'USD',
    invoiceNo: r.invoice_no || r.invoiceNo || '',
    invoice_no: r.invoice_no || r.invoiceNo || '',
    trackingNo: r.tracking_no || r.trackingNo || '',
    tracking_no: r.tracking_no || r.trackingNo || '',
    dueDate: r.due_date || r.dueDate || null,
    due_date: r.due_date || r.dueDate || null,
    shippedDate: r.shipped_date || r.shippedDate || null,
    shipped_date: r.shipped_date || r.shippedDate || null,
    settledDate: r.settled_date || r.settledDate || null,
    settled_date: r.settled_date || r.settledDate || null,
    settledFx: Number(r.settled_fx || r.settledFx) || 0,
    settled_fx: Number(r.settled_fx || r.settledFx) || 0,
    entryDate: r.entry_date || r.entryDate || '',
    entry_date: r.entry_date || r.entryDate || '',
    memo: r.memo || '',
    unitUsd: Number(r.unit_usd !== undefined ? r.unit_usd : r.unitUsd) || 0,
    unit_usd: Number(r.unit_usd !== undefined ? r.unit_usd : r.unitUsd) || 0,
    shipFx: Number(r.ship_fx !== undefined ? r.ship_fx : r.shipFx) || 1350,
    ship_fx: Number(r.ship_fx !== undefined ? r.ship_fx : r.shipFx) || 1350,
    stock: parseInt(r.stock) || 0,
    arrangedQty: parseInt(r.arranged_qty !== undefined ? r.arranged_qty : r.arrangedQty) || 0,
    arranged_qty: parseInt(r.arranged_qty !== undefined ? r.arranged_qty : r.arrangedQty) || 0,
    spq: r.spq ? parseInt(r.spq) : null,
    isSpa: Boolean(r.is_spa || r.isSpa),
    is_spa: Boolean(r.is_spa || r.isSpa),
    approvedDebitUsd: Number(r.approved_debit_usd || r.approvedDebitUsd) || 0,
    approved_debit_usd: Number(r.approved_debit_usd || r.approvedDebitUsd) || 0,
    created_at: r.created_at
  }));

  return mappedItems.sort((a, b) => {
    const dateA = a.entryDate && a.entryDate !== '-' ? new Date(a.entryDate).getTime() : 0;
    const dateB = b.entryDate && b.entryDate !== '-' ? new Date(b.entryDate).getTime() : 0;
    return dateB - dateA;
  });
}

async function upsertInventoryItem(payload, id) {
  if (id) {
    const { data, error } = await supabase
      .from('inventory_items')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } else {
    const { data, error } = await supabase
      .from('inventory_items')
      .insert([payload])
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}

async function deleteInventoryItem(id) {
  const { error } = await supabase
    .from('inventory_items')
    .delete()
    .eq('id', id);
  if (error) throw error;
  return true;
}

function safeAddListener(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}


// ========================================================
// 🛡️ [1단계] 스마트 입력 마스크 & 콤마 자동 서식 유틸리티
// ========================================================
function formatNumberWithMask(rawValue, maxDecimals = 2) {
  if (rawValue === undefined || rawValue === null || rawValue === "") return "";
  let str = String(rawValue).replace(/[^0-9.]/g, "");
  if (!str) return "";
  const parts = str.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (parts.length > 1) {
    return parts[0] + "." + parts[1].slice(0, maxDecimals);
  }
  return parts[0];
}

function parseMaskedNumber(val) {
  if (val === undefined || val === null || val === '') return 0;
  const num = parseFloat(String(val).replace(/,/g, ''));
  return isNaN(num) ? 0 : Math.max(0, num);
}

function setupInputMasks() {
  const maskConfigs = [
    { id: 'inputUsd', decimals: 4, handler: debounce(() => { if (typeof runEngine === 'function') runEngine(); }, 150) },
    { id: 'inputTargetOffer', decimals: 4, handler: debounce(() => { if (typeof runEngine === 'function') runEngine(); }, 150) },
    { id: 'inputSoldPrice', decimals: 4, handler: null },
    { id: 'inputShipFx', decimals: 0, handler: () => { if (typeof updateFxVarianceFeedback === 'function') updateFxVarianceFeedback(); if (typeof runEngine === 'function') runEngine(); } },
    { id: 'inputSettledFx', decimals: 0, handler: () => { if (typeof updateFxVarianceFeedback === 'function') updateFxVarianceFeedback(); } },
    { id: 'inputStock', decimals: 0, handler: () => { if (typeof updateSpqNotice === 'function') updateSpqNotice(); if (typeof runEngine === 'function') runEngine(); } },
    { id: 'inputSpq', decimals: 0, handler: () => { if (typeof updateSpqNotice === 'function') updateSpqNotice(); } },
    { id: 'drawerStock', decimals: 0, handler: null },
    { id: 'drawerArranged', decimals: 0, handler: null },
    { id: 'drawerUnitUsd', decimals: 4, handler: null },
    { id: 'drawerShipFx', decimals: 0, handler: null },
    { id: 'drawerSoldPrice', decimals: 4, handler: null },
    { id: 'drawerSettledFx', decimals: 0, handler: null }
  ];

  maskConfigs.forEach(({ id, decimals, handler }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('inputmode', decimals > 0 ? 'decimal' : 'numeric');
    el.addEventListener('input', () => {
      const start = el.selectionStart;
      const prevLen = el.value.length;
      el.value = formatNumberWithMask(el.value, decimals);
      const diff = el.value.length - prevLen;
      el.setSelectionRange(start + diff, start + diff);
      if (typeof handler === 'function') handler();
    });
  });
}

export async function bootstrap() {
  const entryDateEl = document.getElementById('inputEntryDate');
  if (entryDateEl) entryDateEl.value = new Date().toISOString().slice(0, 10);

  try {
    const fxRes = await fetch('/api/fx-rate');
    const fxData = await fxRes.json();
    rawFxRate = fxData.current_rate || 1380.0;
  } catch (err) {
    console.warn("FX 기본값 유지", err);
  }
  updateFxDisplay();

  try {
    await fetchPackagingStandards();
    renderPackagingTable();
  } catch (e) {
    console.warn("포장기준 로드 예외 무시", e);
  }

  bindTabSwitch();
  bindInputs();
  setupInputMasks();
  bindModals();
  initManualViewer();

  initAuth(async (session, canEdit) => {
    updateFormVisibility(canEdit);
    if (session) {
      await refreshInventory();
    } else {
      cachedItems = [];
      callRenderInventoryList([]);
    }
  });

  runEngine();
  initDynamicFormTabs();
  if (activeTab === 'sales') {
    document.getElementById('formSection')?.classList.add('hidden');
  }
}

function initDynamicFormTabs() {
  const formSection = document.getElementById('formSection');
  if (!formSection) return;

  const oldNav = document.getElementById('dynamicSubTabNav');
  if (oldNav) oldNav.remove();

  const allTitles = ['부품 및 영업 정보', '수주 거래처 및 수량', '매입/판매 단가 및 환율', '출하 및 물류 관리', '세금계산서 및 수금 정산'];

  const getIsolatedCard = (targetTitle) => {
    const otherTitles = allTitles.filter(t => t !== targetTitle);
    const elements = formSection.querySelectorAll('div, section');
    for (const el of elements) {
      if (el.textContent.includes(targetTitle)) {
        const hasOthers = otherTitles.some(ot => el.textContent.includes(ot));
        if (!hasOthers) {
          if (!el.parentElement || otherTitles.some(ot => el.parentElement.textContent.includes(ot)) || el.parentElement.id === 'formSection') {
            return el;
          }
        }
      }
    }
    return null;
  };

  const cardPart = getIsolatedCard('부품 및 영업 정보');
  const cardOrder = getIsolatedCard('수주 거래처 및 수량');
  const cardPrice = getIsolatedCard('매입/판매 단가 및 환율');
  const cardShip = getIsolatedCard('출하 및 물류 관리');
  const cardBill = getIsolatedCard('세금계산서 및 수금 정산');

  if (!cardPart) return;

  if (cardShip && cardShip.parentElement && cardShip.parentElement !== formSection) {
    cardShip.parentElement.style.display = 'contents';
  }

  const nav = document.createElement('div');
  nav.id = 'dynamicSubTabNav';
  nav.className = 'w-full flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-xl text-xs font-bold mb-3 select-none shadow-inner';
  nav.innerHTML = `
    <button type="button" id="tabBtnOrder" class="flex-1 py-2 px-2 rounded-lg bg-white text-indigo-900 shadow-sm transition-all text-center">
      1. 수주 및 배정 등록
    </button>
    <button type="button" id="tabBtnShip" class="flex-1 py-2 px-2 rounded-lg text-slate-600 hover:text-slate-900 transition-all text-center">
      2. 출하 및 물류 관리 (송장/INV)
    </button>
    <button type="button" id="tabBtnBill" class="flex-1 py-2 px-2 rounded-lg text-slate-600 hover:text-slate-900 transition-all text-center">
      3. 세금계산서 및 수금 정산
    </button>
  `;

  cardPart.parentNode.insertBefore(nav, cardPart);

  const btnOrder = document.getElementById('tabBtnOrder');
  const btnShip = document.getElementById('tabBtnShip');
  const btnBill = document.getElementById('tabBtnBill');

  const activeStyle = "flex-1 py-2 px-2 rounded-lg bg-white text-indigo-900 shadow-sm transition-all text-center font-bold";
  const inactiveStyle = "flex-1 py-2 px-2 rounded-lg text-slate-600 hover:text-slate-900 transition-all text-center font-semibold";

  function switchTab(active) {
    if (btnOrder) btnOrder.className = (active === 'order') ? activeStyle : inactiveStyle;
    if (btnShip) btnShip.className = (active === 'shipping') ? activeStyle : inactiveStyle;
    if (btnBill) btnBill.className = (active === 'billing') ? activeStyle : inactiveStyle;

    const isOrder = (active === 'order');
    const isShip = (active === 'shipping');
    const isBill = (active === 'billing');

    if (cardPart) cardPart.style.display = isOrder ? '' : 'none';
    if (cardOrder) cardOrder.style.display = isOrder ? '' : 'none';
    if (cardPrice) cardPrice.style.display = isOrder ? '' : 'none';

    if (cardShip) cardShip.style.display = isShip ? '' : 'none';
    if (cardBill) cardBill.style.display = isBill ? '' : 'none';
  }

  btnOrder.onclick = () => switchTab('order');
  btnShip.onclick = () => switchTab('shipping');
  btnBill.onclick = () => switchTab('billing');

  switchTab('order');
}

function bindTabSwitch() {
  const tabSales = document.getElementById('tabSales');
  const tabFulfillment = document.getElementById('tabFulfillment');
  const salesPanel = document.getElementById('salesQuotationPanel');
  const formSection = document.getElementById('formSection');
  const csHeaderDesc = document.getElementById('csHeaderDesc');

  tabSales?.addEventListener('click', () => {
    activeTab = 'sales';
    tabSales.className = "py-2 px-2 sm:px-4 text-[11px] sm:text-xs font-bold rounded-lg bg-indigo-600 text-white shadow-sm text-center transition-colors";
    if (tabFulfillment) tabFulfillment.className = "py-2 px-2 sm:px-4 text-[11px] sm:text-xs font-semibold rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 text-center transition-colors";

    salesPanel?.classList.remove('hidden');
    formSection?.classList.add('hidden');

    if (csHeaderDesc) csHeaderDesc.innerText = "부품별 실시간 마진 계산 및 보유 재고 현황을 확인합니다.";
    applyFilters();
  });

  tabFulfillment?.addEventListener('click', () => {
    activeTab = 'fulfillment';
    tabFulfillment.className = "py-2 px-2 sm:px-4 text-[11px] sm:text-xs font-bold rounded-lg bg-indigo-600 text-white shadow-sm text-center transition-colors";
    if (tabSales) tabSales.className = "py-2 px-2 sm:px-4 text-[11px] sm:text-xs font-semibold rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 text-center transition-colors";

    salesPanel?.classList.add('hidden');
    formSection?.classList.remove('hidden');

    if (csHeaderDesc) csHeaderDesc.innerText = "수주 등록, 재고 배정, 출하 스케줄, 세금계산서 및 채권 결제 만기를 통합 관리합니다.";
    updateFormVisibility(isCsOrAdminUser());
    applyFilters();
  });
}

function updateFormVisibility(canEdit) {
  const formSection = document.getElementById('formSection');
  const formTitle = document.getElementById('formTitle');
  const formSubtitle = document.getElementById('formSubtitle');
  const salesFields = document.querySelectorAll('.sales-only-field');
  const fulfillmentFields = document.querySelectorAll('.fulfillment-only-field');
  const saveBtn = document.getElementById('saveItemBtn');

  if (activeTab === 'sales') {
    formSection?.classList.add('hidden');
    return;
  }

  formSection?.classList.remove('hidden');
  if (formTitle) formTitle.innerText = "수주 등록 / 재고 배정 및 출하·정산 관리";
  if (formSubtitle) formSubtitle.innerText = "고객사 수주 배정 물량, 단가, 출고(송장) 및 세금계산서/채권 만기를 통합 설정합니다.";
  if (saveBtn) saveBtn.innerText = "정보 저장 및 업데이트";

  salesFields.forEach(el => el.classList.remove('hidden'));
  fulfillmentFields.forEach(el => el.classList.remove('hidden'));

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

function updateLineFilterCounts(items) {
  const lineFilter = document.getElementById('filterMaker') || document.getElementById('filterLine');
  if (!lineFilter) return;

  const definedMajorLines = [
    { key: 'SST', match: ['sst'], label: 'SST' },
    { key: 'S.BELLING', match: ['s.belling', 'sbelling', 'belling'], label: 'S.BELLING' },
    { key: 'ESMT', match: ['esmt'], label: 'ESMT' },
    { key: 'ISSI', match: ['issi'], label: 'ISSI' },
    { key: 'ICSI', match: ['icsi'], label: 'ICSI' },
    { key: 'AMS', match: ['ams'], label: 'AMS' },
    { key: 'Eon', match: ['eon'], label: 'Eon' },
    { key: 'Giantec', match: ['giantec'], label: 'Giantec' },
    { key: 'SMI', match: ['smi', 'silicon motion', 'silicon'], label: 'SMI (Silicon Motion)' },
    { key: 'WIZnet', match: ['wiznet'], label: 'WIZnet' },
    { key: 'AiT', match: ['ait'], label: 'AiT' },
    { key: 'GigaDevice', match: ['gigadevice'], label: 'GigaDevice' },
    { key: 'PLX', match: ['plx'], label: 'PLX' },
    { key: 'BelFuse', match: ['belfuse', 'bel fuse'], label: 'BelFuse' },
    { key: 'LUMISSIL', match: ['lumissil'], label: 'LUMISSIL' },
    { key: 'IM', match: ['im', 'intelligent memory'], label: 'IM' },
    { key: 'ETA', match: ['eta', 'eta-semi'], label: 'ETA' },
    { key: 'XMOS', match: ['xmos'], label: 'XMOS' },
    { key: 'LINKPP', match: ['linkpp', 'link-pp'], label: 'LINKPP' },
    { key: 'Vineyard', match: ['vineyard'], label: 'Vineyard' },
    { key: 'FMSH', match: ['fmsh'], label: 'FMSH' }
  ];

  const counts = {};
  definedMajorLines.forEach(l => { counts[l.key] = 0; });
  let othersCount = 0;

  (items || []).forEach(it => {
    const maker = String(it.maker || '').trim().toLowerCase();
    let matched = false;
    for (const l of definedMajorLines) {
      if (l.match.some(m => maker === m || (m.length > 2 && maker.includes(m)))) {
        counts[l.key] += 1;
        matched = true;
        break;
      }
    }
    if (!matched) othersCount += 1;
  });

  const currentVal = lineFilter.value || 'ALL';
  lineFilter.innerHTML = `
    <option value="ALL">라인 전체 (${(items || []).length.toLocaleString()}건)</option>
    ${definedMajorLines.map(l => `<option value="${l.key}">${l.label} (${(counts[l.key] || 0).toLocaleString()}건)</option>`).join('')}
    <option value="OTHERS">기타 (OTHERS / 프로젝트, ${othersCount.toLocaleString()}건)</option>
  `;
  lineFilter.value = Array.from(lineFilter.options).some(o => o.value === currentVal) ? currentVal : 'ALL';
}

async function refreshInventory() {
  try {
    const items = await fetchInventoryItems();
    cachedItems = items || [];
    window.cachedItems = cachedItems;

    updateLineFilterCounts(cachedItems);
    callRenderInventoryHeaders(activeTab);

    try {
      const kpiMetrics = computeKpiMetrics(cachedItems, rawFxRate);
      renderKpiBar(kpiMetrics);
    } catch (e) {
      console.warn("KPI 계산 예외", e);
    }

    applyFilters();
  } catch (err) {
    console.error("데이터 로드 실패", err);
  }
}

function applyFilters() {
  const searchInput = document.getElementById('searchQuery') || document.getElementById('searchInput');
  const lineFilter = document.getElementById('filterLine') || document.getElementById('filterMaker') || document.getElementById('selectLine');
  const salesFilter = document.getElementById('filterSales') || document.getElementById('filterOwner') || document.getElementById('selectSales');
  const statusFilter = document.getElementById('filterPayment') || document.getElementById('filterStatus') || document.getElementById('selectStatus');

  const q = (searchInput?.value || '').trim().toLowerCase();
  const selectedLine = (lineFilter?.value || 'ALL').trim();
  const selectedSales = (salesFilter?.value || 'ALL').trim();
  const selectedStatus = (statusFilter?.value || 'ALL').trim();

  let filtered = (cachedItems || []).slice();

  if (q) {
    filtered = filtered.filter(item => {
      const part = String(item.partName || item.part_name || '').toLowerCase();
      const maker = String(item.maker || '').toLowerCase();
      const owner = String(item.owner || '').toLowerCase();
      const cust = String(item.customer || '').toLowerCase();
      const realCust = String(item.realCustomer || item.real_customer || '').toLowerCase();
      const dc = String(item.dateCode || item.date_code || '').toLowerCase();
      const track = String(item.trackingNo || item.tracking_no || '').toLowerCase();
      const po = String(item.poNo || item.po_no || '').toLowerCase();
      const memo = String(item.memo || '').toLowerCase();

      return part.includes(q) ||
             maker.includes(q) ||
             owner.includes(q) ||
             cust.includes(q) ||
             realCust.includes(q) ||
             dc.includes(q) ||
             track.includes(q) ||
             po.includes(q) ||
             memo.includes(q);
    });
  }

  if (selectedLine && !['ALL', '전체', '라인 전체', ''].includes(selectedLine)) {
    const target = selectedLine.trim().toLowerCase();
    
    const definedMajorLines = [
      'sst', 's.belling', 'esmt', 'issi', 'icsi', 'ams', 'eon', 'giantec',
      'smi', 'wiznet', 'ait', 'gigadevice', 'plx', 'belfuse', 'lumissil',
      'im', 'eta', 'xmos', 'linkpp', 'vineyard', 'fmsh'
    ];

    if (target === 'others' || target.includes('기타')) {
      filtered = filtered.filter(item => {
        const maker = String(item.maker || '').trim().toLowerCase();
        return !definedMajorLines.includes(maker) && maker !== 'smi';
      });
    } else if (target === 'smi' || target.includes('silicon')) {
      filtered = filtered.filter(item => {
        const maker = String(item.maker || '').trim().toLowerCase();
        return maker === 'smi' || maker.includes('silicon');
      });
    } else if (target === 'issi') {
      filtered = filtered.filter(item => {
        const maker = String(item.maker || '').trim().toLowerCase();
        return maker === 'issi';
      });
    } else if (target === 'icsi') {
      filtered = filtered.filter(item => {
        const maker = String(item.maker || '').trim().toLowerCase();
        return maker === 'icsi';
      });
    } else {
      filtered = filtered.filter(item => {
        const maker = String(item.maker || '').trim().toLowerCase();
        return maker === target;
      });
    }
  }

  if (selectedSales && !['ALL', '전체', 'Sales 전체', '세일즈 전체', ''].includes(selectedSales)) {
    const targetSales = selectedSales.toLowerCase();
    filtered = filtered.filter(item => {
      const owner = String(item.owner || '').trim().toLowerCase();
      if (targetSales === 'dustin') return owner === 'dustin' || owner.includes('dustin');
      if (targetSales === 'william') return owner === 'william' || owner.includes('william');
      if (targetSales === 'bsk' || targetSales.includes('본사')) return owner === 'bsk' || owner.includes('본사');
      return owner === targetSales || owner.includes(targetSales);
    });
  }

  if (selectedStatus && !['ALL', '전체', '수금 전체', '상태 전체', ''].includes(selectedStatus)) {
    const targetStatus = selectedStatus.toLowerCase();
    filtered = filtered.filter(item => {
      const payStatus = String(item.paymentStatus || item.payment_status || '').trim().toLowerCase();
      const ordStatus = String(item.orderStatus || item.order_status || '').trim().toLowerCase();

      if (targetStatus.includes('미수')) {
        return payStatus.includes('미수') || payStatus === 'unpaid';
      }
      if (targetStatus.includes('완료') || targetStatus.includes('수금')) {
        return payStatus.includes('완료') || payStatus.includes('paid') || payStatus === '수금완료';
      }
      return payStatus.includes(targetStatus) || ordStatus.includes(targetStatus);
    });
  }

  
  // 출하일자 기간 검색 필터링 (shippedDate 기준)
  const shipStart = document.getElementById('filterShipDateStart')?.value;
  const shipEnd = document.getElementById('filterShipDateEnd')?.value;

  if (shipStart || shipEnd) {
    filtered = filtered.filter(item => {
      const rawShip = String(item.shippedDate || item.shipped_date || '').trim();
      if (!rawShip || rawShip === '-' || rawShip === 'null') return false;
      const shipDate = rawShip.slice(0, 10);
      if (shipStart && shipDate < shipStart) return false;
      if (shipEnd && shipDate > shipEnd) return false;
      return true;
    });
  }

  const countBadge = document.getElementById('filterCountBadge');
  if (countBadge) {
    countBadge.innerText = `총 ${filtered.length.toLocaleString()}건`;
  }

  callRenderInventoryList(filtered);
}

function setSelectValue(selectId, customInputId, val, customVal) {
  const sel = document.getElementById(selectId);
  const inp = document.getElementById(customInputId);
  if (!sel) return;

  const targetVal = (val || '').trim();
  const targetLower = targetVal.toLowerCase();

  const matchedOpt = Array.from(sel.options).find(opt => {
    const optVal = opt.value.trim().toLowerCase();
    return optVal === targetLower || (targetLower && optVal.includes(targetLower)) || (targetLower && targetLower.includes(optVal));
  });

  if (matchedOpt && matchedOpt.value !== customVal) {
    sel.value = matchedOpt.value;
    if (inp) {
      inp.value = '';
      inp.classList.add('hidden');
    }
  } else {
    sel.value = customVal;
    if (inp) {
      inp.value = targetVal;
      inp.classList.remove('hidden');
    }
  }
}

function loadFormFromItem(id) {
  const item = getCachedItem(id);
  if (!item) return;
  if (typeof window.highlightActiveRow === "function") window.highlightActiveRow(id);

  // 1) 영업 견적 탭: 상단 계산기 데이터 채우고 최상단으로 부드럽게 스크롤
  if (activeTab === 'sales') {
    const unitUsdInp = document.getElementById('inputUsd');
    const stockInp = document.getElementById('inputStock');
    const shipFxInp = document.getElementById('inputShipFx');
    if (unitUsdInp) unitUsdInp.value = formatNumberWithMask(item.unitUsd || item.unit_usd || 0, 4);
    if (stockInp) stockInp.value = formatNumberWithMask(item.stock || 0, 0);
    if (shipFxInp) shipFxInp.value = formatNumberWithMask(item.shipFx || item.ship_fx || 1350, 0);

    runEngine();
    const panel = document.getElementById('salesQuotationPanel');
    if (panel) {
      panel.scrollIntoView({ behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    return;
  }

  // 2) 수주 및 출하 관리 탭: 화면 스크롤 점프 없이 우측 플로팅 드로어 오픈
  if (typeof window.openItemDrawer === 'function') {
    window.openItemDrawer(item);
    return;
  }

  if (!isCsOrAdminUser()) return;
  editingItemId = item.id;

  const banner = document.getElementById('editingBanner');
  const bannerText = document.getElementById('editingBannerText');
  if (banner && bannerText) {
    banner.classList.remove('hidden');
    bannerText.innerText = `✏️ 수정 중: [${item.maker}] ${item.partName || item.part_name || '-'} (D/C: ${item.dateCode || item.date_code || '-'}, 재고: ${(item.stock || 0).toLocaleString()} EA)`;
  }

  setSelectValue('selectMaker', 'inputCustomMaker', item.maker, '__CUSTOM_MAKER__');
  setSelectValue('selectOwner', 'inputCustomOwner', item.owner, '__CUSTOM_OWNER__');

  const setVal = (inputKey, val) => {
    const el = document.getElementById(inputKey);
    if (el) el.value = (val !== null && val !== undefined) ? val : '';
  };

  setVal('inputPartName', item.partName || item.part_name || '');
  setVal('inputDateCode', item.dateCode || item.date_code || '');
  setVal('inputCustomer', item.customer || '');
  setVal('inputRealCustomer', item.realCustomer || item.real_customer || '');
  setVal('inputPoNo', item.poNo || item.po_no || '');
  setVal('inputApplication', item.application || '');
  setVal('inputTaxDate', item.taxDate || item.tax_date || '');
  setVal('selectBizType', item.bizType || item.biz_type || 'DOMESTIC');
  setVal('inputSoldPrice', item.soldPriceUsd ? formatNumberWithMask(item.soldPriceUsd, 4) : '');
  setVal('selectOrderStatus', item.orderStatus || item.order_status || '배정요청');
  setVal('selectPaymentTerms', item.paymentTerms || item.payment_terms || 'Net 30');
  setVal('selectPaymentStatus', item.paymentStatus || item.payment_status || '미수');
  setVal('selectCurrency', item.currency || 'USD');
  setVal('inputInvoiceNo', item.invoiceNo || item.invoice_no || '');
  setVal('inputTrackingNo', item.trackingNo || item.tracking_no || '');
  setVal('inputDueDate', item.dueDate || item.due_date || '');
  setVal('inputShippedDate', item.shippedDate || item.shipped_date || '');
  setVal('inputSettledDate', item.settledDate || item.settled_date || '');
  setVal('inputSettledFx', item.settledFx || item.settled_fx || '');
  setVal('inputEntryDate', item.entryDate || item.entry_date || '');
  setVal('inputMemo', item.memo || '');
  setVal('inputUsd', formatNumberWithMask(item.unitUsd || item.unit_usd || 0, 4));
  setVal('inputShipFx', formatNumberWithMask(item.shipFx || item.ship_fx || 1350, 0));
  setVal('inputStock', formatNumberWithMask(item.stock || '', 0));
  setVal('inputSpq', item.spq || getStandardSpq(item.maker) || '');

  const spaCheck = document.getElementById('checkIsSpa');
  const spaDebitWrapper = document.getElementById('spaDebitWrapper');
  const isSpa = item.isSpa || item.is_spa || false;
  if (spaCheck) {
    spaCheck.checked = isSpa;
    spaDebitWrapper?.classList.toggle('hidden', !isSpa);
    if (isSpa) setVal('inputApprovedDebit', item.approvedDebitUsd || item.approved_debit_usd || '');
  }

  const titleEl = document.getElementById('selectedPartTitle');
  const badgeEl = document.getElementById('selectedPartBadge');
  if (titleEl) titleEl.innerText = `선택된 부품: [${item.maker}] ${item.partName || item.part_name} (D/C: ${item.dateCode || item.date_code || '-'})`;
  if (badgeEl) {
    badgeEl.innerText = `총보유: ${(item.stock || 0).toLocaleString()} EA`;
    badgeEl.classList.remove('hidden');
  }

  updateFxVarianceFeedback();
  updateSpqNotice();
  runEngine();

  if (item && item.id) {
    renderAuditHistory('auditHistoryContainer', item.id, item.partName || item.part_name);
  }
  /* scroll blocked */
}

export function resetCurrentForm() {
  const titleEl = document.getElementById('selectedPartTitle');
  const badgeEl = document.getElementById('selectedPartBadge');
  if (titleEl) titleEl.innerText = "선택된 부품: 목록에서 행을 클릭하세요";
  if (badgeEl) badgeEl.classList.add('hidden');
  editingItemId = null;

  const banner = document.getElementById('editingBanner');
  if (banner) banner.classList.add('hidden');
  const bannerText = document.getElementById('editingBannerText');
  if (bannerText) bannerText.innerText = '';

  const makerInp = document.getElementById('inputCustomMaker');
  if (makerInp) { makerInp.value = ''; makerInp.classList.add('hidden'); }
  const ownerInp = document.getElementById('inputCustomOwner');
  if (ownerInp) { ownerInp.value = ''; ownerInp.classList.add('hidden'); }

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };

  setVal('inputPartName', '');
  setVal('inputDateCode', '');
  setVal('inputCustomer', '');
  setVal('inputRealCustomer', '');
  setVal('inputPoNo', '');
  setVal('inputApplication', '');
  setVal('inputTaxDate', '');
  setVal('selectBizType', 'DOMESTIC');
  setVal('inputSoldPrice', '');
  setVal('inputInvoiceNo', '');
  setVal('inputTrackingNo', '');
  setVal('inputDueDate', '');
  setVal('inputShippedDate', '');
  setVal('inputSettledDate', '');
  setVal('inputSettledFx', '');
  setVal('inputMemo', '');
  setVal('inputStock', '');
  setVal('inputSpq', '');
  setVal('inputUsd', '');

  const spqContainer = document.getElementById('spqFeedbackContainer');
  if (spqContainer) {
    spqContainer.classList.add('hidden');
    spqContainer.innerHTML = '';
  }

  runEngine();
  if (activeTab === 'sales') {
    document.getElementById('formSection')?.classList.add('hidden');
  }
}

function bindInputs() {
  ['inputUsd', 'inputStock', 'inputShipFx', 'inputOverhead', 'inputTargetOffer', 'inputApprovedDebit'].forEach(id => {
    safeAddListener(id, 'input', runEngine);
  });

  safeAddListener('inputStock', 'input', updateSpqNotice);
  safeAddListener('inputSpq', 'input', updateSpqNotice);

  safeAddListener('selectMaker', 'change', () => {
    const maker = document.getElementById('selectMaker')?.value;
    const spqEl = document.getElementById('inputSpq');
    if (spqEl) {
      const csSpq = getStandardSpq(maker);
      spqEl.value = csSpq !== null ? csSpq : '';
    }
    updateSpqNotice();
  });

  safeAddListener('openPackagingConfigBtn', 'click', () => {
    if (!isCsOrAdminUser()) {
      alert("포장단위 기준 관리는 CS 및 관리자 권한만 가능합니다.");
      return;
    }
    renderPackagingTable();
    document.getElementById('packagingConfigModal')?.classList.remove('hidden');
  });

  const pkgConfigForm = document.getElementById('packagingConfigForm');
  if (pkgConfigForm) {
    pkgConfigForm.onsubmit = async (e) => {
      e.preventDefault();
      const maker = document.getElementById('pkgConfigMaker')?.value;
      const cs = document.getElementById('pkgConfigCs')?.value.trim();
      const spq = document.getElementById('pkgConfigSpq')?.value;
      const moq = document.getElementById('pkgConfigMoq')?.value;
      const memo = document.getElementById('pkgConfigMemo')?.value.trim();

      try {
        await savePackagingStandard(maker, cs, spq, moq, memo);
        alert(`[${maker}] 라인의 CS 포장 단위 기준이 성공적으로 저장되었습니다.`);
        renderPackagingTable();
      } catch (err) {
        alert("저장 실패: " + err.message);
      }
    };
  }

  safeAddListener('fxBufferSelect', 'change', updateFxDisplay);
  safeAddListener('copyQuoteBtn', 'click', copyQuotation);
  safeAddListener('openQuotationModalBtn', 'click', openQuotationModal);

  safeAddListener('toggleKpiBtn', 'click', () => {
    const bar = document.getElementById('kpiSummaryBar');
    const arrow = document.getElementById('kpiToggleArrow');
    if (!bar) return;
    const isHidden = bar.classList.toggle('hidden');
    if (arrow) arrow.innerText = isHidden ? '▼' : '▲';
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

  const filterElementIds = [
    'searchQuery', 'searchInput', 
    'filterLine', 'filterMaker', 'selectLine', 
    'filterSales', 'filterOwner', 'selectSales', 
    'filterStatus', 'filterPayment', 'selectStatus'
  ];
  const debouncedApplyFilters = debounce(applyFilters, 200);
  filterElementIds.forEach(id => {
    safeAddListener(id, 'input', debouncedApplyFilters);
    safeAddListener(id, 'change', applyFilters);
  });

  ['filterShipDateStart', 'filterShipDateEnd'].forEach(id => {
    safeAddListener(id, 'change', applyFilters);
  });
  safeAddListener('resetShipDateBtn', 'click', () => {
    const s = document.getElementById('filterShipDateStart');
    const e = document.getElementById('filterShipDateEnd');
    if (s) s.value = '';
    if (e) e.value = '';
    applyFilters();
  });
  safeAddListener('saveItemBtn', 'click', saveCurrentForm);
  safeAddListener('resetFormSelectionBtn', 'click', resetCurrentForm);

  safeAddListener('openLandedCostBtn', 'click', () => {
    document.getElementById('landedCostModal')?.classList.remove('hidden');
  });

  safeAddListener('excelExportBtn', 'click', () => {
    try {
      exportToExcel(cachedItems);
    } catch (err) {
      alert("엑셀 다운로드 오류: " + err.message);
    }
  });

  const fileInp = document.getElementById('excelFileInput');
  fileInp?.addEventListener('change', (e) => {
    if (!isCsOrAdminUser()) {
      alert("패킹리스트 일괄 업로드는 CS 및 관리자 권한만 가능합니다.");
      fileInp.value = "";
      return;
    }
    const file = e.target.files?.[0];
    if (file) {
      handleExcelFileSelect(file);
      fileInp.value = "";
    }
  });

  safeAddListener('excelConfirmUploadBtn', 'click', async () => {
    const btn = document.getElementById('excelConfirmUploadBtn');
    if (btn) btn.disabled = true;
    try {
      const count = await executeBatchUpload();
      alert(`[업로드 완료] ${count.toLocaleString()}건의 부품 데이터가 등록되었습니다.`);
      document.getElementById('excelPreviewModal')?.classList.add('hidden');
      await refreshInventory();
    } catch (err) {
      alert("일괄 업로드 실패: " + err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  });
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
  if (activeTab === 'sales') {
    document.getElementById('formSection')?.classList.add('hidden');
  }
}

function updateSpqNotice() {
  const stockEl = document.getElementById('inputStock');
  const spqEl = document.getElementById('inputSpq');
  const container = document.getElementById('spqFeedbackContainer');
  if (!stockEl || !container) return;

  const qty = Math.round(parseMaskedNumber(stockEl.value));
  const spq = Math.round(parseMaskedNumber(spqEl?.value));
  const res = evaluatePackaging(qty, spq);

  if (res.isValid || qty === 0 || spq === 0) {
    container.classList.add('hidden');
    container.innerHTML = '';
  } else {
    container.classList.remove('hidden');
    container.innerHTML = `
      <div class="p-1.5 bg-amber-50 border border-amber-200 rounded-lg text-[10px] space-y-1">
        <div class="text-amber-800 font-bold flex items-center justify-between">
          <span>⚠️ Reel 포장단위(${res.spq.toLocaleString()} EA) 불일치</span>
          <span class="text-rose-600 font-black">-${res.missingForFullReel.toLocaleString()} EA 자투리</span>
        </div>
      </div>
    `;
  }
}

function renderPackagingTable() {
  const tbody = document.getElementById('packagingConfigTbody');
  if (!tbody) return;
  const standards = getAllStandards();
  const keys = Object.keys(standards);
  if (keys.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-slate-400">등록된 라인별 CS 포장 기준이 없습니다.</td></tr>';
    return;
  }
  tbody.innerHTML = keys.map(k => {
    const item = standards[k];
    return `
      <tr class="hover:bg-indigo-50/50">
        <td class="py-2 px-2 font-bold text-slate-900">${k}</td>
        <td class="py-2 px-2 font-semibold text-indigo-700">${item.csManager || '-'}</td>
        <td class="py-2 px-2 font-bold text-slate-800">${item.spq ? item.spq.toLocaleString() + ' EA' : '-'}</td>
        <td class="py-2 px-2 text-slate-600">${item.moq ? item.moq.toLocaleString() + ' EA' : '-'}</td>
        <td class="py-2 px-2 text-slate-500 text-[11px]">${item.memo || '-'}</td>
      </tr>
    `;
  }).join('');
}

function updateFxVarianceFeedback() {
  const orderFx = parseMaskedNumber(document.getElementById('inputShipFx')?.value) || 1350;
  const settledFx = parseMaskedNumber(document.getElementById('inputSettledFx')?.value);
  const soldPrice = parseMaskedNumber(document.getElementById('inputSoldPrice')?.value);
  const stock = Math.round(parseMaskedNumber(document.getElementById('inputStock')?.value));
  const display = document.getElementById('fxVarianceDisplay');

  if (!display) return;

  if (settledFx > 0 && soldPrice > 0 && stock > 0) {
    const diffKrw = computeFxVariance(soldPrice, stock, orderFx, settledFx);
    if (diffKrw > 0) {
      display.className = "text-[11px] font-bold text-green-600 block mt-1";
      display.innerText = `📈 환차익: +₩${Math.round(diffKrw).toLocaleString()} 발생`;
    } else if (diffKrw < 0) {
      display.className = "text-[11px] font-bold text-red-600 block mt-1";
      display.innerText = `📉 환차손: -₩${Math.round(Math.abs(diffKrw)).toLocaleString()} 발생`;
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
      const baseFreight = parseFloat(document.getElementById('lcFreightUsd')?.value) || 0;
      const totalCustomsKrw = parseFloat(document.getElementById('lcCustomsKrw')?.value) || 0;
      
      const courierType = document.getElementById('lcCourierType')?.value || 'dhl';
      const fuelSurchargeRate = courierType === 'dhl' ? (parseFloat(document.getElementById('lcFuelSurcharge')?.value) || 0) / 100 : 0;
      const effectiveFreight = baseFreight * (1 + fuelSurchargeRate);

      const shipFxEl = document.getElementById('inputShipFx');
      const fxRate = shipFxEl ? (parseFloat(shipFxEl.value) || 1350) : 1350;

      const totalCustomsUsd = totalCustomsKrw / fxRate;
      const totalOverheadUsd = effectiveFreight + totalCustomsUsd;
      const calculatedOverheadRate = computeAllocatedOverheadRate(totalGoods, totalOverheadUsd);

      const overheadInput = document.getElementById('inputOverhead');
      if (overheadInput) overheadInput.value = calculatedOverheadRate.toFixed(2);

      document.getElementById('landedCostModal')?.classList.add('hidden');
      runEngine();
      
      const surchargeInfo = courierType === 'dhl' ? ` (DHL 유류할증료 ${(fuelSurchargeRate*100).toFixed(1)}% 포함)` : '';
      alert(`[배부 완료${surchargeInfo}] 부대비용 가산율 +${calculatedOverheadRate.toFixed(2)}%가 적용되었습니다.`);
    };
  }
}

function runEngine() {
  const unitUsd = parseMaskedNumber(document.getElementById('inputUsd')?.value);
  const stock = parseMaskedNumber(document.getElementById('inputStock')?.value);
  const shipFx = parseMaskedNumber(document.getElementById('inputShipFx')?.value);
  const overhead = (parseFloat(document.getElementById('inputOverhead')?.value) || 0) / 100;
  const targetOffer = parseMaskedNumber(document.getElementById('inputTargetOffer')?.value);

  const isSpa = document.getElementById('checkIsSpa')?.checked || false;
  const approvedDebit = parseMaskedNumber(document.getElementById('inputApprovedDebit')?.value);

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
  setText('minSaleTotalActual', `$${result.totalMinPriceActualUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);

  setText('minSaleUnitReplaceUsd', `$${result.unitMinPriceReplaceUsd.toFixed(4)}`);
  setText('minSaleUnitReplaceKrw', `(₩${Math.round(result.unitMinPriceReplaceKrw).toLocaleString()} / @${Math.round(appliedFxRate).toLocaleString()})`);
  setText('minSaleTotalReplace', `$${result.totalMinPriceReplaceUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);

  const revMarginEl = document.getElementById('reverseMarginReplace') || document.getElementById('expectedMarginDisplay');
  const revBadgeEl = document.getElementById('reverseMarginBadge') || document.getElementById('marginResultBadge');

  if (result.expectedMargin !== null && !isNaN(result.expectedMargin)) {
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
      revBadgeEl.innerText = "단가 입력";
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
  const approvedDebit = parseMaskedNumber(document.getElementById('inputApprovedDebit')?.value);

  const payload = {
    maker: maker || "기타",
    part_name: partName,
    date_code: document.getElementById('inputDateCode')?.value.trim() || "-",
    owner: owner || "본사 일반재고",
    customer: document.getElementById('inputCustomer')?.value.trim() || "-",
    real_customer: document.getElementById('inputRealCustomer')?.value.trim() || "-",
    po_no: document.getElementById('inputPoNo')?.value.trim() || "",
    application: document.getElementById('inputApplication')?.value.trim() || "",
    biz_type: document.getElementById('selectBizType')?.value || "DOMESTIC",
    tax_date: document.getElementById('inputTaxDate')?.value || null,
    sold_price_usd: parseMaskedNumber(document.getElementById('inputSoldPrice')?.value),
    order_status: document.getElementById('selectOrderStatus')?.value || "배정요청",
    payment_terms: document.getElementById('selectPaymentTerms')?.value || "Net 30",
    payment_status: document.getElementById('selectPaymentStatus')?.value || "미수",
    currency: document.getElementById('selectCurrency')?.value || "USD",
    invoice_no: document.getElementById('inputInvoiceNo')?.value.trim() || "",
    tracking_no: document.getElementById('inputTrackingNo')?.value.trim() || "",
    due_date: document.getElementById('inputDueDate')?.value || null,
    shipped_date: document.getElementById('inputShippedDate')?.value || null,
    settled_date: document.getElementById('inputSettledDate')?.value || null,
    settled_fx: parseMaskedNumber(document.getElementById('inputSettledFx')?.value),
    entry_date: document.getElementById('inputEntryDate')?.value || new Date().toISOString().slice(0, 10),
    memo: document.getElementById('inputMemo')?.value.trim() || "",
    unit_usd: parseMaskedNumber(document.getElementById('inputUsd')?.value),
    ship_fx: parseMaskedNumber(document.getElementById('inputShipFx')?.value) || 1350,
    stock: Math.round(parseMaskedNumber(document.getElementById('inputStock')?.value)),
    spq: Math.round(parseMaskedNumber(document.getElementById('inputSpq')?.value)) || null,
    margin: 20,
    is_spa: isSpa,
    approved_debit_usd: isSpa ? parseMaskedNumber(document.getElementById('inputApprovedDebit')?.value) : 0
  };

  try {
    const actionType = editingItemId ? 'UPDATE' : 'CREATE';
    let changeDetails = '정보 수정';
    
    if (editingItemId) {
      const orig = getCachedItem(editingItemId);
      if (orig) {
        const labels = {
          maker: '제조사',
          part_name: '부품명',
          date_code: 'D/C',
          owner: '담당Sales',
          customer: '계약고객사',
          real_customer: '실납품처',
          po_no: 'PO번호',
          application: '적용처',
          biz_type: '거래구분',
          tax_date: '계산서일',
          sold_price_usd: '판매단가($)',
          order_status: '진행상태',
          payment_terms: '결제조건',
          payment_status: '수금상태',
          currency: '통화',
          invoice_no: '인보이스',
          tracking_no: '송장번호',
          due_date: '수금만기일',
          shipped_date: '출하일',
          settled_date: '수금완료일',
          settled_fx: '수금환율',
          entry_date: '입고일',
          memo: '비고',
          unit_usd: '매입단가($)',
          ship_fx: '선적환율',
          stock: '수량(EA)',
          spq: 'SPQ',
          is_spa: 'SPA적용',
          approved_debit_usd: 'SPA승인가($)'
        };

        const diffs = [];
        for (const k of Object.keys(payload)) { if (k === 'margin') continue;
          const camelKey = k.replace(/_([a-z])/g, (_, g) => g.toUpperCase());
          const oVal = orig[k] !== undefined ? orig[k] : (orig[camelKey] !== undefined ? orig[camelKey] : '');
          const nVal = payload[k];

          const strO = (oVal === null || oVal === undefined) ? '' : String(oVal).trim();
          const strN = (nVal === null || nVal === undefined) ? '' : String(nVal).trim();

          if (strO !== strN) {
            diffs.push(`${labels[k] || k}: [${strO || '-'}] ➔ [${strN || '-'}]`);
          }
        }

        if (diffs.length > 0) {
          changeDetails = diffs.join(', ');
        } else {
          changeDetails = '변경된 필드 없음 (정보 갱신)';
        }
      }
    } else {
      changeDetails = `신규 등록 (수량: ${payload.stock}EA, 단가: $${payload.unit_usd})`;
    }

    const saved = await upsertInventoryItem(payload, editingItemId);
    const tId = saved?.id || editingItemId;
    if (tId) {
      await recordAuditLog(tId, payload.part_name, actionType, changeDetails);
    }

    alert(`[${payload.part_name}] 데이터가 저장되었습니다.`);
    await refreshInventory();
  } catch (err) {
    alert(" 저장 실패: " + err.message);
  }
}

async function handleDeleteItem(id) {
  if (!isCsOrAdminUser()) return;
  if (!confirm("해당 건을 영구 삭제하시겠습니까?")) return;
  try {
    await deleteInventoryItem(id);
    resetCurrentForm();
    await refreshInventory();
  } catch (err) {
    alert("삭제 실패: " + err.message);
  }
}

function copyQuotation() {
  const partName = document.getElementById('inputPartName')?.value.trim() || "-";
  const qty = parseFloat(document.getElementById('inputStock')?.value) || 0;
  const unitUsd = document.getElementById('minSaleUnitReplaceUsd')?.innerText || "-";
  const quote = `[견적 안내] ${partName}\n- 수량: ${qty.toLocaleString()} EA\n- 공급단가: ${unitUsd}`;
  navigator.clipboard.writeText(quote).then(() => alert("견적서가 복사되었습니다!"));
}

window.resetCurrentForm = resetCurrentForm;
window.loadFormFromItem = loadFormFromItem;
window.handleDeleteItem = handleDeleteItem;
window.openTrackingModal = openTrackingModal;

bootstrap();

window.handleOpenSplitModal = handleOpenSplitModal;

function handleOpenSplitModal(id) {
  if (!isCsOrAdminUser()) {
    alert("출하 분할 기능은 CS 및 관리자 권한만 가능합니다.");
    return;
  }
  const item = getCachedItem(id);
  if (!item) {
    alert("선택된 부품 정보를 찾을 수 없습니다.");
    return;
  }
  targetSplitId = item.id;

  const part = item.partName || item.part_name || '-';
  const dc = item.dateCode || item.date_code || '-';
  const stock = Number(item.stock) || 0;
  const owner = item.owner || '-';
  const cust = item.customer !== '-' ? item.customer : '';
  const price = item.soldPriceUsd || item.unitUsd || 0;

  const titleEl = document.getElementById('splitModalTitle');
  if (titleEl) titleEl.innerText = `[${part}] 출하 분할 (D/C: ${dc})`;

  const maxStockEl = document.getElementById('splitMaxStockText');
  if (maxStockEl) maxStockEl.innerText = `현재 보유 재고: ${stock.toLocaleString()} EA (소유: ${owner})`;

  const qtyInput = document.getElementById('splitQtyInput');
  if (qtyInput) {
    qtyInput.max = Math.max(1, stock - 1);
    qtyInput.value = Math.min(1000, Math.max(1, stock - 1));
  }

  const priceInput = document.getElementById('splitPriceInput');
  if (priceInput) priceInput.value = price;

  const custInput = document.getElementById('splitCustomerInput');
  if (custInput) custInput.value = cust;

  const repInput = document.getElementById('splitRepInput');
  if (repInput) repInput.value = owner;

  const modal = document.getElementById('splitShipmentModal');
  if (modal) {
    modal.classList.remove('hidden');
  } else {
    alert(`[분할 모달 알림] 현재 ${part} (재고 ${stock} EA)의 분할 대상이 설정되었습니다.`);
  }
}


// 부분 출하 분할 실행 핸들러 (신규 분할건 DB 생성 보장)
document.getElementById('splitShipmentForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerText = '출하 분할 처리 중...';
  }

  try {
    const originalId = window._currentSplitItem?.id;
    if (!originalId) {
      throw new Error("분할할 원본 부품 정보를 찾을 수 없습니다.");
    }

    const splitQty = parseInt(document.getElementById('splitQtyInput')?.value) || 0;
    const splitCustomer = document.getElementById('splitCustomerInput')?.value?.trim() || '-';
    const splitPrice = parseFloat(document.getElementById('splitPriceInput')?.value) || 0;
    const splitRep = document.getElementById('splitRepInput')?.value || '본사 일반재고';
    const deadStockChoice = document.getElementById('splitDeadStockSelect')?.value || 'maintain';

    const originalStock = parseInt(window._currentSplitItem.stock) || 0;
    if (splitQty <= 0 || splitQty >= originalStock) {
      alert(`분할 수량은 1 이상 ${originalStock - 1} 이하만 가능합니다.`);
      if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = '출하 분할 실행'; }
      return;
    }

    const remainingStock = originalStock - splitQty;
    const client = (typeof supabase !== 'undefined' && supabase?.from) ? supabase : window.supabase;

    // 1. 원본 재고 수량 차감 업데이트 (잔여 재고 소유권 정책 반영)
    const originalUpdatePayload = {
      stock: remainingStock
    };
    if (deadStockChoice === 'hq') {
      originalUpdatePayload.owner = '본사 일반재고';
      originalUpdatePayload.customer = '-';
      originalUpdatePayload.real_customer = '-';
      originalUpdatePayload.order_status = '배정요청';
    }

    const { error: updateError } = await client
      .from('inventory_items')
      .update(originalUpdatePayload)
      .eq('id', originalId);

    if (updateError) throw new Error("원본 재고 수량 차감 실패: " + updateError.message);

    // 2. 분할된 신규 출하 품목 생성 (id 및 created_at을 절대 포함하지 않음)
    const orig = window._currentSplitItem;
    const todayStr = new Date().toISOString().slice(0, 10);

    const newSplitRecord = {
      maker: orig.maker || '기타',
      part_name: orig.partName || orig.part_name || '-',
      date_code: orig.dateCode || orig.date_code || '-',
      owner: splitRep,
      customer: splitCustomer,
      real_customer: splitCustomer,
      po_no: orig.poNo || orig.po_no || '',
      application: orig.application || '',
      biz_type: 'SPLIT',
      entry_date: orig.entryDate || orig.entry_date || todayStr,
      shipped_date: todayStr,
      stock: splitQty,
      unit_usd: orig.unitUsd ?? orig.unit_usd ?? 0,
      sold_price_usd: splitPrice,
      ship_fx: orig.shipFx ?? orig.ship_fx ?? 1350,
      margin: 20,
      order_status: '출하완료',
      payment_terms: 'Net 30',
      payment_status: '미수',
      currency: 'USD',
      memo: `[출하분할] 원본(${orig.partName || orig.part_name})에서 ${splitQty}EA 분할 출하`
    };

    const { data: insertData, error: insertError } = await client
      .from('inventory_items')
      .insert([newSplitRecord])
      .select();

    if (insertError) {
      throw new Error("분할 신규 재고 생성 실패: " + insertError.message);
    }

    alert(`✅ 부분 출하 분할이 성공적으로 완료되었습니다!\n- 기존 잔여 수량: ${remainingStock.toLocaleString()} EA\n- 신규 분할 출하: ${splitQty.toLocaleString()} EA (출하완료)`);
    
    document.getElementById('splitShipmentModal')?.classList.add('hidden');
    
    // 목록 새로고침
    if (typeof loadAndRenderInventory === 'function') {
      await loadAndRenderInventory();
    } else {
      location.reload();
    }
  } catch (err) {
    console.error("출하 분할 에러:", err);
    alert("❌ 분할 작업 실패: " + err.message);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerText = '출하 분할 실행';
    }
  }
});


// 기존 분할 버튼 클릭 이벤트 호환 래퍼
window.handleSplitModalOpen = window.openSplitModal;

// ========================================================
// 🌟 행 하이라이트 & 저장 후 자동 스크롤 추적 엔진 (완전판)
// ========================================================
window._currentActiveItemId = null;

// [1] 행 클릭 시 즉시 짙은 강조 (파란색 배경 + 왼쪽 굵은 인디고 인라인 바)
window.highlightActiveRow = function(itemId) {
  window._currentActiveItemId = itemId;

  // 이전 선택된 모든 행의 배경 및 테두리 초기화
  document.querySelectorAll('tr[id^="row-item-"]').forEach(tr => {
    tr.style.backgroundColor = '';
    tr.querySelectorAll('td').forEach(td => {
      td.style.backgroundColor = '';
      td.style.borderTop = '';
      td.style.borderBottom = '';
      td.style.borderLeft = '';
    });
  });
  if (!itemId) return;

  const targetTr = document.getElementById(`row-item-${itemId}`) || document.querySelector(`tr[data-item-id="${itemId}"]`);
  if (targetTr) {
    const tds = targetTr.querySelectorAll('td');
    tds.forEach((td, idx) => {
      td.style.backgroundColor = '#dbeafe'; // 눈에 확 띄는 밝은 인디고 블루
      td.style.borderTop = '2px solid #6366f1';
      td.style.borderBottom = '2px solid #6366f1';
      if (idx === 0) td.style.borderLeft = '6px solid #4338ca'; // 좌측 굵은 인디고 바
    });
  }
};

// [2] 저장 후 방금 수정한 품목 위치로 부모 스크롤 이동 및 노란색 번쩍임
window.flashSavedRow = function(itemId) {
  if (!itemId) return;

  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    const targetTr = document.getElementById(`row-item-${itemId}`) || document.querySelector(`tr[data-item-id="${itemId}"]`);
    
    if (targetTr) {
      clearInterval(timer);

      // 1. 내부 스크롤 컨테이너 또는 브라우저 창 스크롤 중앙 정렬
      const scrollParent = targetTr.closest('.overflow-y-auto') || targetTr.closest('div[class*="overflow"]');
      if (scrollParent) {
        const pTop = scrollParent.getBoundingClientRect().top;
        const eTop = targetTr.getBoundingClientRect().top;
        scrollParent.scrollBy({
          top: eTop - pTop - (scrollParent.clientHeight / 2) + 20,
          behavior: 'smooth'
        });
      }
      targetTr.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // 2. 3초간 노란색 형광펜 하이라이트 번쩍임
      const tds = targetTr.querySelectorAll('td');
      tds.forEach((td, idx) => {
        td.style.backgroundColor = '#fef08a'; // 선명한 옐로우
        td.style.borderTop = '2px solid #eab308';
        td.style.borderBottom = '2px solid #eab308';
        if (idx === 0) td.style.borderLeft = '6px solid #ca8a04';
      });

      // 3. 2.5초 후 차분한 인디고 블루 강조 상태로 유지
      setTimeout(() => {
        tds.forEach((td, idx) => {
          td.style.backgroundColor = '#e0e7ff';
          td.style.borderTop = '1px solid #c7d2fe';
          td.style.borderBottom = '1px solid #c7d2fe';
          if (idx === 0) td.style.borderLeft = '6px solid #4f46e5';
        });
      }, 2500);
    }

    if (attempts > 30) clearInterval(timer);
  }, 100);
};

// ========================================================
// 📦 플로팅 드로어 4단 서브탭 및 감사로그 단일 통합본
// ========================================================
window.switchDrawerTab = function(tabIndex) {
  for (let i = 1; i <= 4; i++) {
    const btn = document.getElementById(`dTabBtn${i}`);
    const content = document.getElementById(`drawerTabContent${i}`);
    if (i === tabIndex) {
      if (btn) btn.className = "flex-1 py-1.5 rounded-md bg-white text-indigo-900 shadow-sm text-center font-bold";
      if (content) content?.classList.remove('hidden');
    } else {
      if (btn) btn.className = "flex-1 py-1.5 rounded-md text-slate-600 hover:text-slate-900 text-center font-semibold";
      if (content) content?.classList.add('hidden');
    }
  }
  if (tabIndex === 4 && typeof window.loadDrawerAuditHistory === 'function') {
    window.loadDrawerAuditHistory();
  }
};

window.loadDrawerAuditHistory = async function() {
  const container = document.getElementById('drawerAuditListContainer');
  const id = document.getElementById('drawerItemId')?.value;
  if (!container || !id) return;

  container.innerHTML = `<div class="text-[11px] text-slate-400 py-6 text-center">히스토리 조회 중...</div>`;

  try {
    const fetchFn = window.fetchAuditLogs || (await import('./modules/audit.js')).fetchAuditLogs;
    const logs = await fetchFn(id);

    if (!logs || logs.length === 0) {
      container.innerHTML = `<div class="p-4 text-center text-slate-400 text-[11px] bg-slate-50 rounded-lg border border-slate-200">기록된 변경 이력이 없습니다.</div>`;
      return;
    }

    container.innerHTML = logs.map(log => {
      const d = new Date(log.created_at);
      const timeStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      const userShort = log.user_email ? log.user_email.split('@')[0] : '익명';

      let actionBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-800">정보수정</span>`;
      if (log.action_type === 'CREATE') actionBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-green-100 text-green-800">신규등록</span>`;
      if (log.action_type === 'SPLIT') actionBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-800">출하분할</span>`;
      if (log.action_type === 'DELETE') actionBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 text-rose-800">삭제</span>`;

      return `
        <div class="p-2 bg-slate-50 hover:bg-slate-100/70 rounded-lg border border-slate-200 text-[11px] space-y-1">
          <div class="flex items-center justify-between text-slate-500 font-mono text-[10px]">
            <span class="flex items-center gap-1 font-bold text-slate-700">
              ${actionBadge} <span>${userShort}</span>
            </span>
            <span>${timeStr}</span>
          </div>
          <div class="text-slate-800 font-medium break-all leading-relaxed pl-0.5">${log.details || '-'}</div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="p-3 text-center text-rose-500 text-[11px]">이력 로드 실패: ${err.message}</div>`;
  }
};

window.openItemDrawer = function(item) {
  const drawer = document.getElementById('itemDetailDrawer');
  if (!drawer || !item) return;

  // 클릭한 행 즉시 강조 실행
  window.highlightActiveRow(item.id);

  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = (val !== undefined && val !== null) ? val : '';
  };
  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerText = (val !== undefined && val !== null && String(val).trim() !== '') ? val : '-';
  };

  const part = item.part_name || item.partName || item.part || '-';
  const mfg = item.maker || item.mfg || '-';
  const po = item.po_no || item.poNo || item.pono || '-';
  const owner = item.owner || item.salesRep || item.sales_rep || '본사 일반재고';

  setEl('drawerItemId', item.id);
  setText('drawerPartDisplay', part);
  setText('drawerMfgDisplay', mfg);
  setText('drawerSubTitle', `${part} | PO: ${po}`);

  setEl('drawerMaker', mfg);
  setEl('drawerDateCode', item.date_code || item.dateCode || '-');
  setEl('drawerStock', formatNumberWithMask(item.stock || 0, 0));
  setEl('drawerArranged', formatNumberWithMask(item.arranged_qty ?? item.arrangedQty ?? 0, 0));
  setEl('drawerUnitUsd', formatNumberWithMask(item.unit_usd ?? item.unitUsd ?? 0, 4));
  setEl('drawerShipFx', formatNumberWithMask(item.ship_fx ?? item.shipFx ?? 1350, 0));
  setEl('drawerSoldPrice', item.sold_price_usd ? formatNumberWithMask(item.sold_price_usd, 4) : '');
  setEl('drawerSales', owner);
  setEl('drawerCustomer', item.customer || '');
  setEl('drawerRealCustomer', item.real_customer || item.realCustomer || '');
  setEl('drawerPono', item.po_no || item.poNo || '');
  setEl('drawerApplication', item.application || '');

  setEl('drawerOrderStatus', item.order_status || item.orderStatus || '배정요청');
  setEl('drawerBizType', item.biz_type || item.bizType || 'DOMESTIC');
  setEl('drawerShippedDate', item.shipped_date || item.shippedDate || '');
  setEl('drawerInvoiceNo', item.invoice_no || item.invoiceNo || '');
  setEl('drawerTrackingNo', item.tracking_no || item.trackingNo || '');
  setEl('drawerEntryDate', item.entry_date || item.entryDate || '');

  setEl('drawerPaymentStatus', item.payment_status || item.paymentStatus || '미수');
  setEl('drawerPaymentTerms', item.payment_terms || item.paymentTerms || 'Net 30');
  setEl('drawerTaxDate', item.tax_date || item.taxDate || '');
  setEl('drawerDueDate', item.due_date || item.dueDate || '');
  setEl('drawerSettledDate', item.settled_date || item.settledDate || '');
  setEl('drawerSettledFx', item.settled_fx || item.settledFx || '');
  setEl('drawerCurrency', item.currency || 'USD');

  setEl('drawerMemo', item.memo || '');

  window.switchDrawerTab(1);

  const canEdit = (typeof window.isCsOrAdminUser === 'function') 
    ? window.isCsOrAdminUser() 
    : ((typeof isCsOrAdminUser === 'function') ? isCsOrAdminUser() : false);

  const saveBtn = document.getElementById('drawerSaveBtn');
  const badge = document.getElementById('drawerBadge');

  if (badge) {
    badge.innerText = canEdit ? 'EDIT' : 'READ ONLY';
    badge.className = canEdit 
      ? 'text-[10px] bg-indigo-600 px-2 py-0.5 rounded-full font-mono font-bold' 
      : 'text-[10px] bg-amber-600 px-2 py-0.5 rounded-full font-mono font-bold';
  }

  if (saveBtn) {
    saveBtn.classList.toggle('hidden', !canEdit);
  }

  drawer.querySelectorAll('input:not(#drawerTrackingNo), select, textarea').forEach(el => {
    if (el.id === 'drawerItemId') return;
    el.disabled = !canEdit;
    if (!canEdit) {
      el.setAttribute('readonly', 'true');
      el.classList.add('bg-slate-100', 'cursor-not-allowed', 'text-slate-500');
      el.classList.remove('bg-slate-50', 'bg-white');
    } else {
      el.removeAttribute('readonly');
      el.classList.remove('bg-slate-100', 'cursor-not-allowed', 'text-slate-500');
      el.classList.add('bg-slate-50');
    }
  });

  drawer.classList.remove('translate-x-full');
  drawer.style.transform = 'translateX(0)';
};

window.closeItemDrawer = function() {
  const drawer = document.getElementById('itemDetailDrawer');
  if (drawer) {
    drawer.classList.add('translate-x-full');
    drawer.style.transform = 'translateX(100%)';
  }
};

window.saveDrawerItem = async function() {
  const canEdit = (typeof window.isCsOrAdminUser === 'function') 
    ? window.isCsOrAdminUser() 
    : ((typeof isCsOrAdminUser === 'function') ? isCsOrAdminUser() : false);

  if (!canEdit) {
    alert("수주 및 출하 관리 데이터 수정 권한이 없습니다. (CS/관리자 전용 기능)");
    return;
  }

  const id = document.getElementById('drawerItemId')?.value;
  if (!id) return;
  const btn = document.getElementById('drawerSaveBtn');
  if (btn) { btn.disabled = true; btn.innerText = "저장 중..."; }

  try {
    const payload = {
      maker: document.getElementById('drawerMaker')?.value.trim() || '기타',
      date_code: document.getElementById('drawerDateCode')?.value.trim() || '-',
      stock: Math.round(parseMaskedNumber(document.getElementById('drawerStock')?.value)),
      arranged_qty: Math.round(parseMaskedNumber(document.getElementById('drawerArranged')?.value)),
      unit_usd: parseMaskedNumber(document.getElementById('drawerUnitUsd')?.value),
      ship_fx: parseMaskedNumber(document.getElementById('drawerShipFx')?.value) || 1350,
      sold_price_usd: parseMaskedNumber(document.getElementById('drawerSoldPrice')?.value),
      owner: document.getElementById('drawerSales')?.value.trim() || '본사 일반재고',
      customer: document.getElementById('drawerCustomer')?.value.trim() || '-',
      real_customer: document.getElementById('drawerRealCustomer')?.value.trim() || '-',
      po_no: document.getElementById('drawerPono')?.value.trim() || '',
      application: document.getElementById('drawerApplication')?.value.trim() || '',

      order_status: document.getElementById('drawerOrderStatus')?.value || '배정요청',
      biz_type: document.getElementById('drawerBizType')?.value || 'DOMESTIC',
      shipped_date: document.getElementById('drawerShippedDate')?.value || null,
      invoice_no: document.getElementById('drawerInvoiceNo')?.value.trim() || '',
      tracking_no: document.getElementById('drawerTrackingNo')?.value.trim() || '',
      entry_date: document.getElementById('drawerEntryDate')?.value || null,

      payment_status: document.getElementById('drawerPaymentStatus')?.value || '미수',
      payment_terms: document.getElementById('drawerPaymentTerms')?.value.trim() || 'Net 30',
      tax_date: document.getElementById('drawerTaxDate')?.value || null,
      due_date: document.getElementById('drawerDueDate')?.value || null,
      settled_date: document.getElementById('drawerSettledDate')?.value || null,
      settled_fx: parseMaskedNumber(document.getElementById('drawerSettledFx')?.value) || null,
      currency: document.getElementById('drawerCurrency')?.value || 'USD',

      memo: document.getElementById('drawerMemo')?.value.trim() || ''
    };

    const client = (typeof supabase !== 'undefined' && supabase?.from) ? supabase : window.supabase;
    
    // 원본 데이터와 비교하여 상세 변경 내역(Diff) 추출
    const orig = (typeof getCachedItem === 'function') ? getCachedItem(id) : (window.cachedItems?.find(it => String(it.id) === String(id)));
    const labels = {
      maker: '제조사', date_code: 'D/C', stock: '총재고', arranged_qty: '배정수량',
      unit_usd: '매입단가($)', ship_fx: '선적환율', sold_price_usd: '판매단가($)',
      owner: '담당Sales', customer: '계약처', real_customer: '실납품처', po_no: 'PONO',
      application: '적용처', order_status: '진행상태', biz_type: '거래구분',
      shipped_date: '출하일', invoice_no: '인보이스', tracking_no: '송장번호',
      entry_date: '입고일', payment_status: '수금상태', payment_terms: '결제조건',
      tax_date: '계산서일', due_date: '만기일', settled_date: '수금일', settled_fx: '수금환율',
      currency: '통화', memo: '비고'
    };

    const diffs = [];
    if (orig) {
      for (const k of Object.keys(payload)) {
        const camelKey = k.replace(/_([a-z])/g, (_, g) => g.toUpperCase());
        const oVal = orig[k] !== undefined ? orig[k] : (orig[camelKey] !== undefined ? orig[camelKey] : '');
        const nVal = payload[k];
        const strO = (oVal === null || oVal === undefined) ? '' : String(oVal).trim();
        const strN = (nVal === null || nVal === undefined) ? '' : String(nVal).trim();
        if (strO !== strN) {
          diffs.push(`${labels[k] || k}: [${strO || '-'}] ➔ [${strN || '-'}]`);
        }
      }
    }
    const changeDetails = diffs.length > 0 ? diffs.join(', ') : '필드 값 갱신 (내용 동일)';

    const { error } = await client.from('inventory_items').update(payload).eq('id', id);
    if (error) throw error;

    // 감사 로그 기록
    try {
      const partDisplay = document.getElementById('drawerPartDisplay')?.innerText || orig?.part_name || orig?.partName || '-';
      const logFn = window.recordAuditLog || (await import('./modules/audit.js')).recordAuditLog;
      await logFn(id, partDisplay, 'UPDATE', changeDetails);
    } catch(e) {
      console.warn("감사 로그 저장 예외:", e);
    }

    alert("성공적으로 저장되었습니다.");
    window.closeItemDrawer();

    // 인벤토리 목록 갱신 후 반드시 flashSavedRow 실행
    if (typeof refreshInventory === 'function') {
      await refreshInventory();
      window.flashSavedRow(id);
    }
  } catch (err) {
    alert("저장 실패: " + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = "전체 변경사항 저장"; }
  }
};
