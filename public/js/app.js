import { supabase } from './supabase.js';
import * as InventoryModule from './inventory.js';
import { initAuth, isCsOrAdminUser } from './modules/auth.js';
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
import { recordAuditLog, renderAuditHistory } from './modules/audit.js';
import { computeQuotation, computeAllocatedOverheadRate, computeFxVariance } from './calculator.js';

// ----------------------------------------------------
// 0. 상태 변수 및 안전 렌더러/DB 헬퍼
// ----------------------------------------------------
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
    fn(items, activeTab, loadFormFromItem, handleDeleteItem, handleOpenSplitModal, isCsOrAdminUser());
  }
}

function getCachedItem(id) {
  return cachedItems.find(item => String(item.id) === String(id)) || null;
}

// Supabase 조회 래퍼 (최대 10,000건 전건 로드)
async function fetchInventoryItems() {
  const client = (typeof supabase !== 'undefined' && supabase?.from)
    ? supabase
    : (window.supabase?.from ? window.supabase : null);

  if (!client) {
    throw new Error("Supabase client is not ready");
  }

  const { data, error } = await client
    .from('inventory_items')
    .select('*')
    .range(0, 9999)
    .order('created_at', { ascending: false });
  if (error) throw error;

  // DB 필드명(snake_case)을 화면 렌더러 규격(camelCase)으로 상호 안전 매핑
  return (data || []).map(r => ({
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
}

// Supabase 단일 저장/수정 래퍼
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

// Supabase 삭제 래퍼
async function deleteInventoryItem(id) {
  const { error } = await supabase
    .from('inventory_items')
    .delete()
    .eq('id', id);
  if (error) throw error;
  return true;
}

// Supabase 분할 래퍼
async function splitInventoryShipment(targetId, splitQty, splitPrice, customer, rep, deadStockAction) {
  const original = getCachedItem(targetId);
  if (!original) throw new Error("원본 데이터를 찾을 수 없습니다.");
  if (original.stock <= splitQty) throw new Error("분할 수량은 기존 재고보다 작아야 합니다.");

  const remainQty = original.stock - splitQty;
  const isTransferToHq = (deadStockAction === 'hq');
  const remainOwner = isTransferToHq ? '본사 일반재고' : (original.owner || '본사 일반재고');
  const remainMemo = isTransferToHq
    ? (original.memo ? `${original.memo} [본사 이관 잔여재고]` : '[본사 이관 잔여재고]')
    : (original.memo || '');
  const remainArranged = Math.max(0, (Number(original.arranged_qty || original.arrangedQty) || 0) - splitQty);

  const { error: updErr } = await supabase
    .from('inventory_items')
    .update({
      stock: remainQty,
      arranged_qty: remainArranged,
      owner: remainOwner,
      memo: remainMemo
    })
    .eq('id', targetId);
  if (updErr) throw updErr;

  const newPayload = {
    maker: original.maker || '기타',
    part_name: original.part_name || original.partName || '-',
    date_code: original.date_code || original.dateCode || '-',
    owner: rep || original.owner || '본사 일반재고',
    customer: customer || original.customer || '-',
    real_customer: customer || original.real_customer || original.realCustomer || '-',
    po_no: original.po_no || original.poNo || '',
    application: original.application || '',
    biz_type: original.biz_type || original.bizType || 'DOMESTIC',
    tax_date: null,
    sold_price_usd: splitPrice || 0,
    order_status: '출하준비',
    payment_terms: original.payment_terms || original.paymentTerms || 'Net 30',
    payment_status: '미수',
    currency: original.currency || 'USD',
    invoice_no: '',
    tracking_no: '',
    due_date: null,
    shipped_date: null,
    settled_date: null,
    settled_fx: 0,
    entry_date: original.entry_date || original.entryDate || new Date().toISOString().slice(0, 10),
    memo: `[부분 출하 분할] 원 건 #${original.id}에서 ${splitQty}EA 분할`,
    unit_usd: original.unit_usd !== undefined ? original.unit_usd : (original.unitUsd || 0),
    ship_fx: original.ship_fx !== undefined ? original.ship_fx : (original.shipFx || 1350),
    stock: splitQty,
    arranged_qty: splitQty,
    spq: original.spq || null,
    margin: 20,
    is_spa: Boolean(original.is_spa || original.isSpa),
    approved_debit_usd: original.approved_debit_usd || original.approvedDebitUsd || 0
  };

  const { error } = await supabase.from('inventory_items').insert([newPayload]);
  if (error) throw error;
}

function safeAddListener(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

// ----------------------------------------------------
// 1. 초기 부트스트랩
// ----------------------------------------------------
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

// ----------------------------------------------------
// 2. 폼 서브탭 동적 제어 (1.수주/배정, 2.출하/물류, 3.계산서/정산)
// ----------------------------------------------------
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

// ----------------------------------------------------
// 3. 탭 전환 및 가시성 제어
// ----------------------------------------------------
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

// ----------------------------------------------------
// 4. 인벤토리 새로고침 및 검색 필터링 (WIZnet 등 전건)
// ----------------------------------------------------
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
  const statusFilter = document.getElementById('filterStatus') || document.getElementById('filterPayment') || document.getElementById('selectStatus');

  const q = (searchInput?.value || '').trim().toLowerCase();
  const selectedLine = (lineFilter?.value || 'ALL').trim();
  const selectedSales = (salesFilter?.value || 'ALL').trim();
  const selectedStatus = (statusFilter?.value || 'ALL').trim();

  let filtered = (cachedItems || []).slice();

// 1. 키워드 통합 검색 (Part, Maker, Owner/Sales, Customer, D/C, Tracking, PO, Memo)
  if (q) {
    filtered = filtered.filter(item => {
      const part = String(item.partName || item.part_name || '').toLowerCase();
      const maker = String(item.maker || '').toLowerCase();
      const owner = String(item.owner || '').toLowerCase(); // 👈 이 코드를 추가하거나 복구합니다.
      const cust = String(item.customer || '').toLowerCase();
      const realCust = String(item.realCustomer || item.real_customer || '').toLowerCase();
      const dc = String(item.dateCode || item.date_code || '').toLowerCase();
      const track = String(item.trackingNo || item.tracking_no || '').toLowerCase();
      const po = String(item.poNo || item.po_no || '').toLowerCase();
      const memo = String(item.memo || '').toLowerCase();

      return part.includes(q) ||
             maker.includes(q) ||
             owner.includes(q) || // 이제 정상적으로 작동합니다.
             cust.includes(q) ||
             realCust.includes(q) ||
             dc.includes(q) ||
             track.includes(q) ||
             po.includes(q) ||
             memo.includes(q);
    });
  }

  // 2. 라인(제조사) 필터 (대소문자 무시, ISSI/ICSI 분리, SMI 별칭, 기타 묶음)
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
      // SMI 및 Silicon Motion 상호 호환 매칭
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



  // 3. 담당 Sales 필터 (대소문자 무시, 완전 일치 및 포함 비교)
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

  // 4. 수금/상태 필터
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

  const countBadge = document.getElementById('filterCountBadge');
  if (countBadge) {
    countBadge.innerText = `총 ${filtered.length.toLocaleString()}건`;
  }

  callRenderInventoryList(filtered);
}

// ----------------------------------------------------
// 5. 폼 선택 및 바인딩
// ----------------------------------------------------
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

  if (activeTab === 'sales') {
    const unitUsdInp = document.getElementById('inputUsd');
    const stockInp = document.getElementById('inputStock');
    const shipFxInp = document.getElementById('inputShipFx');
    if (unitUsdInp) unitUsdInp.value = item.unitUsd || item.unit_usd || 0;
    if (stockInp) stockInp.value = item.stock || 0;
    if (shipFxInp) shipFxInp.value = item.shipFx || item.ship_fx || 1350;

    runEngine();
    document.getElementById('salesQuotationPanel')?.scrollIntoView({ behavior: 'smooth' });
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
  setVal('inputSoldPrice', item.soldPriceUsd || item.sold_price_usd || '');
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
  setVal('inputUsd', item.unitUsd || item.unit_usd || 0);
  setVal('inputShipFx', item.shipFx || item.ship_fx || 1350);
  setVal('inputStock', item.stock || '');
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
  document.getElementById('formSection')?.scrollIntoView({ behavior: 'smooth' });
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

// ----------------------------------------------------
// 6. 이벤트 리스너 바인딩 및 저장/삭제
// ----------------------------------------------------
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
      // const owner removed (undefined item fix)

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
  // 검색 및 모든 필터 드롭다운 실시간 연동 리스너
  const filterElementIds = [
    'searchQuery', 'searchInput', 
    'filterLine', 'filterMaker', 'selectLine', 
    'filterSales', 'filterOwner', 'selectSales', 
    'filterStatus', 'filterPayment', 'selectStatus'
  ];
  filterElementIds.forEach(id => {
    safeAddListener(id, 'input', applyFilters);
    safeAddListener(id, 'change', applyFilters);
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

  const qty = parseInt(stockEl.value) || 0;
  const spq = parseInt(spqEl?.value) || 0;
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

  // 실적 원가 기준 렌더링
  setText('minSaleUnitActualUsd', `$${result.unitMinPriceActualUsd.toFixed(4)}`);
  setText('minSaleUnitActualKrw', `(₩${Math.round(result.unitMinPriceActualKrw).toLocaleString()} / @${Math.round(shipFx).toLocaleString()})`);
  setText('minSaleTotalActual', `$${result.totalMinPriceActualUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);

  // 대체 원가 기준 렌더링
  setText('minSaleUnitReplaceUsd', `$${result.unitMinPriceReplaceUsd.toFixed(4)}`);
  setText('minSaleUnitReplaceKrw', `(₩${Math.round(result.unitMinPriceReplaceKrw).toLocaleString()} / @${Math.round(appliedFxRate).toLocaleString()})`);
  setText('minSaleTotalReplace', `$${result.totalMinPriceReplaceUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);

  // 🎯 역마진 및 판정 뱃지 갱신 (이미지의 고객 희망단가 영역)
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

  // 🎯 우측 수량별 티어표 렌더링
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
  const approvedDebit = parseFloat(document.getElementById('inputApprovedDebit')?.value) || 0;

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
    spq: parseInt(document.getElementById('inputSpq')?.value) || null,
    margin: 20,
    is_spa: isSpa,
    approved_debit_usd: isSpa ? approvedDebit : 0
  };

  try {
    const actionType = editingItemId ? 'UPDATE' : 'CREATE';
    const savedItem = const actionType = editingItemId ? 'UPDATE' : 'CREATE';
    let changeDetails = '정보 수정';
    if (editingItemId) {
      const orig = getCachedItem(editingItemId);
      if (orig) {
        const labels = {maker:'제조사', part_name:'부품명', date_code:'D/C', owner:'담당Sales', customer:'고객사', real_customer:'실납품처', po_no:'PO번호', application:'적용처', biz_type:'거래구분', sold_price_usd:'판매단가($)', order_status:'상태', payment_terms:'결제조건', payment_status:'수금상태', invoice_no:'인보이스', tracking_no:'송장번호', shipped_date:'출하일', unit_usd:'매입단가($)', stock:'수량(EA)'};
        const diffs = [];
        for (const k of Object.keys(payload)) {
          const oVal = String(orig[k] !== undefined ? orig[k] : (orig[k.replace(/_([a-z])/g, (_, g) => g.toUpperCase())] || ''));
          const nVal = String(payload[k] || '');
          if (oVal.trim() !== nVal.trim()) {
            diffs.push(`${labels[k] || k}: [${oVal || '-'}] ➔ [${nVal || '-'}]`);
          }
        }
        if (diffs.length > 0) changeDetails = diffs.join(', ');
      }
    } else {
      changeDetails = `신규 등록 (수량: ${payload.stock}EA)`;
    }

    const saved = await upsertInventoryItem(payload, editingItemId);
    const tId = saved?.id || editingItemId;
    if (tId) await recordAuditLog(tId, payload.part_name, actionType, changeDetails);
    const targetId = savedItem?.id || editingItemId;
    
    if (targetId) {
      await recordAuditLog(targetId, payload.part_name, actionType, `${actionType === 'CREATE' ? '신규 등록' : '정보 수정'} (수량: ${payload.stock}EA, 단가: $${payload.unit_usd})`);
    }

    alert(`[${payload.part_name}] 데이터가 저장되었습니다.`);
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

