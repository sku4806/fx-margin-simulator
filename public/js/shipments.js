// public/js/shipments.js
/**
 * 🚚 세일즈 마스터 [Sales Daily Report - FrmShippedInfo] 공식 출하 종합 원장 & Supabase 연동 모듈
 * 
 * 1. MS-SQL ShippingFile + MainSubFile + MainFile + CustomerFile 4대 원장 실시간 통합 조회
 * 2. 세일즈 마스터 SHIPPED INFO LIST와 100% 동일한 컬럼 및 필터 (CUSTOMER, REALCUST, PONO, PARTNO, SHIP_DATE, SHIP_QTY, NET_UP, SHIP_AMT, APP)
 * 3. 기간(DATE), 제조사(MFG), 공급사(SUPPLY), 실시간 검색 및 Excel 내보내기 지원
 * 4. 웹 수주 출하완료건(Supabase) 서브모드 및 양방향 라이프사이클 동기화 보존
 */

import { sbClient } from './supabase.js';
import { openInvoiceModal, openPackingListModal } from './trade-documents.js';

// 상태 관리
let activeShipmentMode = 'ledger'; // 'ledger' (MS-SQL 공식 출하 원장) | 'web' (웹 수주 출하내역)
let cachedLedgerShipments = [];     // MS-SQL Shipped Info 데이터
let cachedWebShipments = [];        // Supabase 출하완료건 데이터
let lastFilteredShipments = [];     // 현재 화면에 표시되는 필터링 결과

// 필터 옵션
let availableMakers = [];
let availableSupplies = [];

// 기본 조회 기간: 최근 4개월 (세일즈 마스터 기본 뷰 규격)
const initDates = getDefaultDateRange();
let currentStartDate = initDates.start;
let currentEndDate = initDates.end;
let currentMfg = '';
let currentSupply = '';
let currentSearchQuery = '';
let currentFxRate = 1350;

// 페이지네이션
let shipmentPage = 1;
let shipmentPageSize = 50;

// 백그라운드 자동보정 쿨다운
let lastHealTime = 0;
const HEAL_INTERVAL_MS = 10 * 60 * 1000;

function debounce(func, wait = 200) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

/**
 * 기본 날짜 계산 (종료일: 오늘, 시작일: 4달 전)
 */
function getDefaultDateRange() {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const startDateObj = new Date();
  startDateObj.setMonth(startDateObj.getMonth() - 4);
  const start = startDateObj.toISOString().slice(0, 10);
  return { start, end };
}

/**
 * 백그라운드 자동 보정
 */
async function triggerAutoHealInBackground() {
  const now = Date.now();
  if (now - lastHealTime < HEAL_INTERVAL_MS) return;
  lastHealTime = now;

  if (!sbClient) return;
  try {
    const { data: shippedItems } = await sbClient
      .from('inventory_items')
      .select('*')
      .eq('order_status', '출하완료');

    if (shippedItems && shippedItems.length > 0) {
      const { data: existingShipments } = await sbClient
        .from('legacy_shipments')
        .select('inventory_item_id')
        .not('inventory_item_id', 'is', null);

      const existingIds = new Set((existingShipments || []).map(s => String(s.inventory_item_id)));

      for (const item of shippedItems) {
        if (!existingIds.has(String(item.id))) {
          await syncShipmentLifecycle(item.id, item, item);
        }
      }
    }
  } catch (healErr) {
    console.warn("출하완료 자동 보정 백그라운드 예외:", healErr);
  }
}

/**
 * 필터 옵션(제조사 및 공급사 목록) 로드
 */
export async function fetchShippedFilters() {
  if (availableMakers.length > 0 && availableSupplies.length > 0) return;
  try {
    const res = await fetch('/api/shipped-info/filters');
    const data = await res.json();
    if (data.status === 'success') {
      availableMakers = data.makers || [];
      availableSupplies = data.supplies || [];
    }
  } catch (err) {
    console.warn("출하 원장 필터 로드 실패:", err);
    availableMakers = ["ISSI", "ESMT", "SMI", "LUMISSIL", "Giantec", "GigaDevice", "OTHERS"];
    availableSupplies = ["ISSI", "ESMT", "SMI", "LUMISSIL", "BSHK", "BSTW", "OTHERS"];
  }
}

/**
 * MS-SQL 공식 출하 원장(SHIPPED INFO) 데이터 로드
 */
export async function fetchLedgerShipments(params = {}) {
  const start = params.startDate !== undefined ? params.startDate : currentStartDate;
  const end = params.endDate !== undefined ? params.endDate : currentEndDate;
  const mfg = params.mfg !== undefined ? params.mfg : currentMfg;
  const supply = params.supply !== undefined ? params.supply : currentSupply;
  const query = params.query !== undefined ? params.query : currentSearchQuery;

  currentStartDate = start;
  currentEndDate = end;
  currentMfg = mfg;
  currentSupply = supply;
  currentSearchQuery = query;

  const urlParams = new URLSearchParams();
  if (start) urlParams.append('start_date', start);
  if (end) urlParams.append('end_date', end);
  if (mfg) urlParams.append('mfg', mfg);
  if (supply) urlParams.append('supply', supply);
  if (query) urlParams.append('query', query);
  urlParams.append('limit', '2000');

  try {
    const res = await fetch(`/api/shipped-info?${urlParams.toString()}`);
    const data = await res.json();
    if (data.status === 'success') {
      cachedLedgerShipments = data.items || [];
      return cachedLedgerShipments;
    } else {
      console.warn("출하 원장 조회 경고:", data.message);
    }
  } catch (err) {
    console.error("출하 원장 API 호출 실패:", err);
  }
  return cachedLedgerShipments;
}

/**
 * Supabase 웹 수주 출하완료건 로드
 */
export async function fetchWebShipments() {
  triggerAutoHealInBackground();
  if (!sbClient) return [];

  try {
    const { data, error } = await sbClient
      .from('legacy_shipments')
      .select('*')
      .order('order_date', { ascending: false })
      .order('last_synced_at', { ascending: false, nullsFirst: false });

    if (!error && data) {
      cachedWebShipments = data.map(item => ({
        idx: item.id || item.legacy_out_id,
        customer: item.customer_name || '웹 수주 거래처',
        real_cust: item.real_cust || '-',
        po_no: item.po_no || 'WEB-MANUAL',
        part_no: item.part_name || '-',
        ship_date: item.order_date || '-',
        ship_qty: item.qty || 0,
        net_up: (item.cost_price && currentFxRate > 0) ? (item.cost_price / currentFxRate) : 0.0,
        ship_amt: (item.total_sales_amount && currentFxRate > 0) ? (item.total_sales_amount / currentFxRate) : 0.0,
        unit_krw: item.unit_price || 0,
        total_krw: item.total_sales_amount || 0,
        app: item.application || '-',
        maker: item.maker || 'OTHERS',
        supply: 'WEB',
        is_web: true,
        status: item.status || 'SHIPPED'
      }));
      return cachedWebShipments;
    }
  } catch (err) {
    console.warn("웹 수주 출하내역 조회 실패:", err);
  }
  return cachedWebShipments;
}

/**
 * 메인 fetchShipments (기본 원장 및 필터 초기화)
 */
export async function fetchShipments() {
  // 실시간 환율 조회 캐싱
  try {
    const fxRes = await fetch('/api/fx-rate');
    const fxData = await fxRes.json();
    if (fxData && fxData.current_rate > 0) {
      currentFxRate = fxData.current_rate;
    }
  } catch (e) {
    currentFxRate = 1350;
  }

  await fetchShippedFilters();

  if (activeShipmentMode === 'ledger') {
    await fetchLedgerShipments();
    lastFilteredShipments = cachedLedgerShipments;
  } else {
    await fetchWebShipments();
    lastFilteredShipments = cachedWebShipments;
  }
  return lastFilteredShipments;
}

/**
 * 🚚 출하 종합 원장 뷰 렌더링
 */
export function renderShipmentsView(containerId = "shipmentsSection") {
  const container = document.getElementById(containerId);
  if (!container) return;

  const activeItems = (activeShipmentMode === 'ledger') ? cachedLedgerShipments : cachedWebShipments;
  lastFilteredShipments = activeItems;
  shipmentPage = 1;

  // 전체 통계 계산
  const totalCount = lastFilteredShipments.length;
  const totalQty = lastFilteredShipments.reduce((sum, item) => sum + (Number(item.ship_qty) || 0), 0);
  const totalUsd = lastFilteredShipments.reduce((sum, item) => sum + (Number(item.ship_amt) || 0), 0);
  const totalKrw = lastFilteredShipments.reduce((sum, item) => {
    if (item.total_krw) return sum + item.total_krw;
    return sum + Math.round((Number(item.ship_amt) || 0) * currentFxRate);
  }, 0);

  // Maker 드롭다운 옵션 HTML
  const makerOptionsHtml = `
    <option value="" ${currentMfg === '' ? 'selected' : ''}>제조사(MFG) 전체</option>
    ${availableMakers.map(m => `<option value="${m}" ${currentMfg === m ? 'selected' : ''}>${m}</option>`).join('')}
  `;

  // Supply 드롭다운 옵션 HTML
  const supplyOptionsHtml = `
    <option value="" ${currentSupply === '' ? 'selected' : ''}>공급사(SUPPLY) 전체</option>
    ${availableSupplies.map(s => `<option value="${s}" ${currentSupply === s ? 'selected' : ''}>${s}</option>`).join('')}
  `;

  container.innerHTML = `
    <div class="bg-white p-3.5 sm:p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
      
      <!-- 상단 헤더 & 모드 전환 탭 -->
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-200 pb-3.5">
        <div>
          <div class="flex items-center gap-2 flex-wrap">
            <h2 class="font-black text-sm sm:text-base tracking-wide text-slate-900 flex items-center gap-1.5">
              <span>🚚</span> 출하 종합 원장 (SHIPPED INFO LIST)
            </h2>
            <span class="text-[10px] bg-indigo-100 text-indigo-800 font-bold px-2 py-0.5 rounded-full border border-indigo-200 shadow-2xs">
              MS-SQL ShippingFile 실시간 연동
            </span>
          </div>
          <p class="text-[11px] text-slate-400 mt-1">세일즈 마스터 FrmShippedInfo 규격과 100% 동일한 출하 원장, 실수요처, 외화단가 및 용도(APP) 통합 장부입니다.</p>
        </div>

        <!-- 모드 전환 탭 (MS-SQL 공식 원장 vs 웹 수주 출하내역) -->
        <div class="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl shrink-0 self-start lg:self-center">
          <button type="button" id="btnModeLedger" class="px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${activeShipmentMode === 'ledger' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}">
            🚚 MS-SQL 출하 원장
          </button>
          <button type="button" id="btnModeWeb" class="px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${activeShipmentMode === 'web' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}">
            📦 웹 수주 출하완료건
          </button>
        </div>
      </div>

      <!-- 세일즈 마스터 규격 툴바 (기간, MFG, SUPPLY, 검색, Excel) -->
      <div class="bg-slate-50 p-3 sm:p-4 rounded-xl border border-slate-200 space-y-3">
        <div class="flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
          
          <!-- DATE 기간 설정 -->
          <div class="flex items-center gap-1.5">
            <span class="font-bold text-slate-700 font-mono text-[11px]">DATE:</span>
            <input type="date" id="shipmentStartDate" value="${currentStartDate}" 
                   class="px-2 py-1 text-xs font-mono font-semibold bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500">
            <span class="text-slate-400 font-bold">~</span>
            <input type="date" id="shipmentEndDate" value="${currentEndDate}" 
                   class="px-2 py-1 text-xs font-mono font-semibold bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500">
          </div>

          <!-- 기간 빠른 선택 프리셋 버튼 -->
          <div class="flex items-center gap-1 flex-wrap">
            <button type="button" onclick="window.setShipmentDatePreset('curMonth')" class="px-2 py-1 bg-white hover:bg-slate-100 text-slate-700 text-[10px] font-bold rounded border border-slate-200 transition cursor-pointer">당월(11월)</button>
            <button type="button" onclick="window.setShipmentDatePreset('3M')" class="px-2 py-1 bg-white hover:bg-slate-100 text-slate-700 text-[10px] font-bold rounded border border-slate-200 transition cursor-pointer">최근 3개월</button>
            <button type="button" onclick="window.setShipmentDatePreset('6M')" class="px-2 py-1 bg-white hover:bg-slate-100 text-slate-700 text-[10px] font-bold rounded border border-slate-200 transition cursor-pointer">최근 6개월</button>
            <button type="button" onclick="window.setShipmentDatePreset('YTD')" class="px-2 py-1 bg-white hover:bg-slate-100 text-slate-700 text-[10px] font-bold rounded border border-slate-200 transition cursor-pointer">2026 연간</button>
            <button type="button" onclick="window.setShipmentDatePreset('ALL')" class="px-2 py-1 bg-white hover:bg-slate-100 text-slate-700 text-[10px] font-bold rounded border border-slate-200 transition cursor-pointer">전체</button>
          </div>

          <!-- MFG 제조사 필터 -->
          <div class="flex items-center gap-1.5">
            <span class="font-bold text-slate-700 text-[11px]">MFG:</span>
            <select id="shipmentMfgSelect" class="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer max-w-[140px]">
              ${makerOptionsHtml}
            </select>
          </div>

          <!-- SUPPLY 공급사 필터 -->
          <div class="flex items-center gap-1.5">
            <span class="font-bold text-slate-700 text-[11px]">SUPPLY:</span>
            <select id="shipmentSupplySelect" class="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer max-w-[140px]">
              ${supplyOptionsHtml}
            </select>
          </div>

          <!-- 검색 버튼 -->
          <button type="button" id="btnShipmentSearch" class="px-3.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs shadow-xs transition flex items-center gap-1 cursor-pointer">
            <span>🔍</span> 검색
          </button>

          <!-- Excel 내보내기 버튼 -->
          <button type="button" id="btnShipmentExcelExport" class="px-3.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs shadow-xs transition flex items-center gap-1 cursor-pointer ml-auto">
            <span>📥</span> Excel 내보내기
          </button>
        </div>

        <!-- 실시간 라이브 필터 검색창 -->
        <div class="relative w-full">
          <input type="text" id="shipmentLiveFilterInput" placeholder="고객사(CUSTOMER), 실수요처(REALCUST), 품번(PARTNO), 발주번호(PONO), 용도(APP) 실시간 빠른 검색..." 
                 class="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 outline-none font-medium text-slate-800 shadow-2xs">
          <span class="absolute left-2.5 top-2 text-slate-400 text-xs">⚡</span>
        </div>
      </div>

      <!-- 요약 바 (Grand Summaries 규격 일치) -->
      <div class="bg-amber-50/90 border border-amber-200 rounded-xl p-3 text-xs font-mono font-bold text-slate-800 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div class="flex items-center gap-2">
          <span class="text-amber-900 font-sans font-black text-sm">🚚 SHIPPED INFO GRAND SUMMARIES</span>
          <span id="shipmentSummaryCount" class="text-slate-600 font-sans font-bold text-xs">(${totalCount.toLocaleString()}건)</span>
        </div>
        <div class="flex flex-wrap items-center gap-4 text-xs font-mono">
          <div>총 출하수량: <span id="shipmentSumQty" class="text-indigo-900 font-black text-sm">${totalQty.toLocaleString()}</span> EA</div>
          <span class="text-slate-300">|</span>
          <div>총 외화금액: <span id="shipmentSumUsd" class="text-blue-700 font-black text-sm">$${totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
          <span class="text-slate-300">|</span>
          <div>원화 환산액(@${currentFxRate.toLocaleString()}): <span id="shipmentSumKrw" class="text-rose-700 font-black text-sm">₩${Math.round(totalKrw).toLocaleString()}</span></div>
        </div>
      </div>

      <!-- 모바일 전용 카드 뷰 (md:hidden) -->
      <div id="shipmentCardContainer" class="block md:hidden space-y-2.5 max-h-[65vh] overflow-y-auto pr-0.5">
        ${generateShipmentMobileCards(getPagedShipments())}
      </div>

      <!-- 데스크톱 전용 테이블 (hidden md:block) - 세일즈 마스터 10개 컬럼 완벽 일치 -->
      <div class="hidden md:block overflow-x-auto max-h-[65vh] overflow-y-auto border border-slate-200 rounded-xl shadow-xs">
        <table class="w-full text-left text-xs border-collapse">
          <thead class="bg-slate-100/95 backdrop-blur-sm text-slate-700 border-b uppercase font-bold sticky top-0 z-10 shadow-xs text-[11px]">
            <tr>
              <th class="py-2.5 px-2 text-center whitespace-nowrap w-10">#</th>
              <th class="py-2.5 px-3 text-left min-w-[130px]">CUSTOMER (계약처)</th>
              <th class="py-2.5 px-3 text-left min-w-[120px]">REALCUST (실수요처)</th>
              <th class="py-2.5 px-3 text-left min-w-[140px]">PONO (발주번호)</th>
              <th class="py-2.5 px-3 text-left min-w-[170px]">PARTNO (품번)</th>
              <th class="py-2.5 px-3 text-center whitespace-nowrap w-24">SHIP_DATE</th>
              <th class="py-2.5 px-3 text-right whitespace-nowrap w-24">SHIP_QTY</th>
              <th class="py-2.5 px-3 text-right whitespace-nowrap w-24">NET_UP ($)</th>
              <th class="py-2.5 px-3 text-right whitespace-nowrap w-28">SHIP_AMT ($)</th>
              <th class="py-2.5 px-3 text-left min-w-[150px]">APP (용도)</th>
              <th class="py-2.5 px-3 text-center whitespace-nowrap w-24 no-print">문서</th>
            </tr>
          </thead>
          <tbody id="shipmentTableBody" class="divide-y divide-slate-100 font-medium bg-white text-slate-700">
            ${generateTableRows(getPagedShipments())}
          </tbody>
        </table>
      </div>

      <!-- 📄 출하 페이지네이션 컨트롤러 -->
      <div id="shipmentPagination" class="flex flex-wrap items-center justify-between gap-2 pt-2 px-1 text-xs select-none"></div>
    </div>
  `;

  bindShipmentToolbarEvents();
  renderShipmentPaginationUI();
}

/**
 * 툴바 이벤트 리스너 바인딩
 */
function bindShipmentToolbarEvents() {
  const btnLedger = document.getElementById("btnModeLedger");
  const btnWeb = document.getElementById("btnModeWeb");
  const btnSearch = document.getElementById("btnShipmentSearch");
  const btnExcel = document.getElementById("btnShipmentExcelExport");
  const inputStart = document.getElementById("shipmentStartDate");
  const inputEnd = document.getElementById("shipmentEndDate");
  const selectMfg = document.getElementById("shipmentMfgSelect");
  const selectSupply = document.getElementById("shipmentSupplySelect");
  const liveFilter = document.getElementById("shipmentLiveFilterInput");

  // 모드 전환
  btnLedger?.addEventListener("click", async () => {
    if (activeShipmentMode === 'ledger') return;
    activeShipmentMode = 'ledger';
    await fetchLedgerShipments();
    renderShipmentsView('shipmentsSection');
  });

  btnWeb?.addEventListener("click", async () => {
    if (activeShipmentMode === 'web') return;
    activeShipmentMode = 'web';
    await fetchWebShipments();
    renderShipmentsView('shipmentsSection');
  });

  // 검색 버튼 클릭
  btnSearch?.addEventListener("click", async () => {
    const startDate = inputStart?.value || '';
    const endDate = inputEnd?.value || '';
    const mfg = selectMfg?.value || '';
    const supply = selectSupply?.value || '';
    const query = liveFilter?.value || '';

    btnSearch.disabled = true;
    btnSearch.innerHTML = `<span>⏳</span> 조회중...`;

    if (activeShipmentMode === 'ledger') {
      await fetchLedgerShipments({ startDate, endDate, mfg, supply, query });
    } else {
      await fetchWebShipments();
    }
    renderShipmentsView('shipmentsSection');
  });

  // 드롭다운 변경 시 즉시 검색
  selectMfg?.addEventListener("change", () => btnSearch?.click());
  selectSupply?.addEventListener("change", () => btnSearch?.click());

  // Enter 키 검색
  inputStart?.addEventListener("keydown", (e) => { if (e.key === "Enter") btnSearch?.click(); });
  inputEnd?.addEventListener("keydown", (e) => { if (e.key === "Enter") btnSearch?.click(); });

  // 실시간 라이브 필터링 (200ms 디바운스)
  const handleLiveFilter = debounce((term) => {
    const raw = (activeShipmentMode === 'ledger') ? cachedLedgerShipments : cachedWebShipments;
    if (!term) {
      lastFilteredShipments = raw;
    } else {
      const q = term.toLowerCase().trim();
      lastFilteredShipments = raw.filter(item =>
        (item.part_no && item.part_no.toLowerCase().includes(q)) ||
        (item.customer && item.customer.toLowerCase().includes(q)) ||
        (item.real_cust && item.real_cust.toLowerCase().includes(q)) ||
        (item.po_no && item.po_no.toLowerCase().includes(q)) ||
        (item.app && item.app.toLowerCase().includes(q)) ||
        (item.maker && item.maker.toLowerCase().includes(q))
      );
    }
    shipmentPage = 1;
    updateShipmentCurrentPage();
  }, 200);

  liveFilter?.addEventListener("input", (e) => handleLiveFilter(e.target.value));

  // Excel 내보내기
  btnExcel?.addEventListener("click", () => {
    window.exportShipmentLedgerExcel();
  });
}

/**
 * 날짜 프리셋 변경
 */
window.setShipmentDatePreset = async function (preset) {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  let start = end;

  if (preset === 'curMonth') {
    start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  } else if (preset === '3M') {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    start = d.toISOString().slice(0, 10);
  } else if (preset === '6M') {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    start = d.toISOString().slice(0, 10);
  } else if (preset === 'YTD') {
    start = `${now.getFullYear()}-01-01`;
  } else if (preset === 'ALL') {
    start = '2015-01-01';
  }

  currentStartDate = start;
  currentEndDate = end;

  const inputStart = document.getElementById("shipmentStartDate");
  const inputEnd = document.getElementById("shipmentEndDate");
  if (inputStart) inputStart.value = start;
  if (inputEnd) inputEnd.value = end;

  const btnSearch = document.getElementById("btnShipmentSearch");
  if (btnSearch) btnSearch.click();
};

function getPagedShipments() {
  if (shipmentPageSize === 'ALL') return lastFilteredShipments;
  const start = (shipmentPage - 1) * shipmentPageSize;
  return lastFilteredShipments.slice(start, start + shipmentPageSize);
}

function updateShipmentCurrentPage() {
  const paged = getPagedShipments();
  const tbody = document.getElementById("shipmentTableBody");
  if (tbody) tbody.innerHTML = generateTableRows(paged);

  const cardContainer = document.getElementById("shipmentCardContainer");
  if (cardContainer) cardContainer.innerHTML = generateShipmentMobileCards(paged);

  // 합계 업데이트
  const totalCount = lastFilteredShipments.length;
  const totalQty = lastFilteredShipments.reduce((sum, item) => sum + (Number(item.ship_qty) || 0), 0);
  const totalUsd = lastFilteredShipments.reduce((sum, item) => sum + (Number(item.ship_amt) || 0), 0);
  const totalKrw = lastFilteredShipments.reduce((sum, item) => {
    if (item.total_krw) return sum + item.total_krw;
    return sum + Math.round((Number(item.ship_amt) || 0) * currentFxRate);
  }, 0);

  const elCount = document.getElementById("shipmentSummaryCount");
  const elQty = document.getElementById("shipmentSumQty");
  const elUsd = document.getElementById("shipmentSumUsd");
  const elKrw = document.getElementById("shipmentSumKrw");

  if (elCount) elCount.innerText = `(${totalCount.toLocaleString()}건)`;
  if (elQty) elQty.innerText = totalQty.toLocaleString();
  if (elUsd) elUsd.innerText = `$${totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (elKrw) elKrw.innerText = `₩${Math.round(totalKrw).toLocaleString()}`;

  renderShipmentPaginationUI();
}

/**
 * 데스크톱 테이블 행 HTML 생성 (세일즈 마스터 10개 컬럼 완벽 지원)
 */
function generateTableRows(items) {
  if (!items || items.length === 0) {
    return `
      <tr>
        <td colspan="11" class="py-12 text-center text-slate-400 font-bold bg-white">
          <div class="text-3xl mb-2">🚚</div>
          <div>지정된 기간 및 조건에 해당하는 출하 원장 내역이 없습니다.</div>
        </td>
      </tr>
    `;
  }

  const startIdx = (shipmentPageSize === 'ALL') ? 0 : (shipmentPage - 1) * shipmentPageSize;

  return items.map((item, idx) => {
    const rowNum = startIdx + idx + 1;
    const cleanPart = (item.part_no || '').trim();
    const hasApp = Boolean(item.app && item.app.trim() && item.app !== '-');

    return `
      <tr class="hover:bg-slate-50 transition-colors text-[11px] group">
        <td class="py-2 px-2 text-center font-mono text-slate-400 whitespace-nowrap">${rowNum}</td>
        
        <!-- CUSTOMER -->
        <td class="py-2 px-3 font-bold text-slate-900 truncate max-w-[150px]" title="${item.customer || '-'}">
          ${item.customer || '-'}
        </td>

        <!-- REALCUST -->
        <td class="py-2 px-3 font-semibold text-indigo-900 truncate max-w-[130px]" title="${item.real_cust || '-'}">
          ${item.real_cust ? `<span class="inline-block bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[10px] font-bold">${item.real_cust}</span>` : '-'}
        </td>

        <!-- PONO -->
        <td class="py-2 px-3 font-mono text-slate-600 text-[10px] truncate max-w-[150px]" title="${item.po_no || '-'}">
          ${item.po_no || '-'}
        </td>

        <!-- PARTNO + [이력] 버튼 -->
        <td class="py-2 px-3">
          <div class="flex items-center gap-1.5">
            <span class="font-bold text-slate-900 font-mono truncate max-w-[180px]" title="${cleanPart}">${cleanPart}</span>
            <button type="button" onclick="window.openPriceHistoryModal && window.openPriceHistoryModal('${cleanPart}')" 
                    class="px-1.5 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded text-[9px] font-bold cursor-pointer transition shrink-0" title="과거 매입·판매 단가 이력 조회">
              📈 이력
            </button>
          </div>
        </td>

        <!-- SHIP_DATE -->
        <td class="py-2 px-3 text-center font-mono text-slate-600 whitespace-nowrap">${item.ship_date || '-'}</td>

        <!-- SHIP_QTY -->
        <td class="py-2 px-3 text-right font-black text-slate-900 whitespace-nowrap font-mono">
          ${(Number(item.ship_qty) || 0).toLocaleString()} EA
        </td>

        <!-- NET_UP ($) -->
        <td class="py-2 px-3 text-right font-mono font-bold text-blue-700 whitespace-nowrap">
          $${(Number(item.net_up) || 0).toFixed(4)}
        </td>

        <!-- SHIP_AMT ($) -->
        <td class="py-2 px-3 text-right font-mono font-black text-slate-900 whitespace-nowrap">
          $${(Number(item.ship_amt) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
        </td>

        <!-- APP (용도) -->
        <td class="py-2 px-3 truncate max-w-[170px]" title="${item.app || '-'}">
          ${hasApp ? `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-900 border border-amber-200">${item.app}</span>` : '<span class="text-slate-300">-</span>'}
        </td>

        <!-- 문서 (명세서 / 패킹) -->
        <td class="py-2 px-3 text-center whitespace-nowrap no-print" onclick="event.stopPropagation()">
          <div class="inline-flex items-center gap-1">
            <button type="button" onclick="window.openTradeInvoice && window.openTradeInvoice(window.getShipmentByIndex(${idx}))" 
                    class="px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded border border-indigo-200 text-[10px] font-bold transition-colors cursor-pointer" title="공식 거래명세서 출력">
              📄 명세서
            </button>
            <button type="button" onclick="window.openTradePacking && window.openTradePacking(window.getShipmentByIndex(${idx}))" 
                    class="px-2 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded border border-amber-300 text-[10px] font-bold transition-colors cursor-pointer" title="공식 패킹리스트 출력">
              📦 패킹
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * 모바일 전용 출하/수주 카드 뷰 HTML 생성
 */
function generateShipmentMobileCards(items) {
  if (!items || items.length === 0) {
    return `<div class="p-6 text-center text-slate-400 bg-white rounded-xl border border-slate-200 text-xs font-bold">조회된 출하 원장 내역이 없습니다.</div>`;
  }
  return items.map((item, idx) => {
    const cleanPart = (item.part_no || '').trim();
    return `
      <div class="p-3.5 bg-white rounded-xl border border-slate-200 shadow-xs space-y-2.5">
        <div class="flex items-start justify-between gap-1.5">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-[9px] font-mono font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">${item.ship_date || '-'}</span>
              <span class="text-[9px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">${item.maker || '-'}</span>
              ${item.real_cust ? `<span class="text-[9px] font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">${item.real_cust}</span>` : ''}
            </div>
            <h4 class="font-black text-xs text-slate-900 mt-1 truncate" title="${cleanPart}">
              ${cleanPart}
            </h4>
            <div class="text-[10px] text-slate-500 font-bold truncate mt-0.5">${item.customer || '-'}</div>
          </div>
          <div class="text-right shrink-0">
            <span class="text-[9px] text-slate-400 block font-semibold">출하금액(USD)</span>
            <span class="font-black text-slate-900 font-mono text-sm">$${(Number(item.ship_amt) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <div class="text-[10px] text-rose-600 font-bold font-mono">₩${Math.round((Number(item.ship_amt) || 0) * currentFxRate).toLocaleString()}</div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-1.5 text-xs bg-slate-50 p-2 rounded-lg border border-slate-100">
          <div>
            <span class="text-[9px] text-slate-400 block font-semibold">수량 / 순단가</span>
            <div class="font-black text-slate-900 text-[11px]">${(Number(item.ship_qty) || 0).toLocaleString()} EA</div>
            <span class="text-[10px] text-blue-700 font-mono font-bold">$${(Number(item.net_up) || 0).toFixed(4)}</span>
          </div>
          <div>
            <span class="text-[9px] text-slate-400 block font-semibold">발주번호 / 용도</span>
            <div class="font-bold text-slate-800 text-[10px] font-mono truncate" title="${item.po_no || '-'}">${item.po_no || '-'}</div>
            <div class="text-[9px] text-amber-800 font-bold truncate">${item.app || '-'}</div>
          </div>
        </div>

        <div class="flex items-center justify-between gap-1.5 pt-1 border-t border-slate-100">
          <button type="button" onclick="window.openPriceHistoryModal && window.openPriceHistoryModal('${cleanPart}')" 
                  class="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded border border-indigo-200 text-[10px] font-bold transition cursor-pointer">
            📈 단가이력
          </button>
          <div class="flex items-center gap-1">
            <button type="button" onclick="window.openTradeInvoice && window.openTradeInvoice(window.getShipmentByIndex(${idx}))" 
                    class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-bold transition cursor-pointer">
              📄 명세서
            </button>
            <button type="button" onclick="window.openTradePacking && window.openTradePacking(window.getShipmentByIndex(${idx}))" 
                    class="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded border border-amber-300 text-[10px] font-bold transition cursor-pointer">
              📦 패킹
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * 페이지네이션 렌더링
 */
function renderShipmentPaginationUI() {
  const container = document.getElementById("shipmentPagination");
  if (!container) return;

  const total = lastFilteredShipments.length;
  if (total === 0) {
    container.innerHTML = '';
    return;
  }

  const totalPages = (shipmentPageSize === 'ALL') ? 1 : Math.max(1, Math.ceil(total / shipmentPageSize));
  if (shipmentPage > totalPages) shipmentPage = totalPages;
  if (shipmentPage < 1) shipmentPage = 1;

  const startIdx = (shipmentPageSize === 'ALL') ? 1 : (shipmentPage - 1) * shipmentPageSize + 1;
  const endIdx = (shipmentPageSize === 'ALL') ? total : Math.min(shipmentPage * shipmentPageSize, total);

  let pageButtons = '';
  const maxButtons = 5;
  let startP = Math.max(1, shipmentPage - 2);
  let endP = Math.min(totalPages, startP + maxButtons - 1);
  if (endP - startP < maxButtons - 1) startP = Math.max(1, endP - maxButtons + 1);

  for (let p = startP; p <= endP; p++) {
    const isCurrent = (p === shipmentPage);
    pageButtons += `
      <button type="button" onclick="window.goToShipmentPage(${p})" 
              class="w-7 h-7 flex items-center justify-center rounded-lg text-xs font-bold transition-colors ${isCurrent ? 'bg-indigo-600 text-white shadow-xs' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 cursor-pointer'}">
        ${p}
      </button>
    `;
  }

  container.innerHTML = `
    <div class="flex items-center gap-2 text-slate-500 text-[11px]">
      <span class="font-bold text-slate-800">${startIdx.toLocaleString()} - ${endIdx.toLocaleString()}</span> / 전체 <strong class="text-indigo-900 font-black">${total.toLocaleString()}</strong>건
      <span class="text-slate-300">|</span>
      <span>${shipmentPage} / ${totalPages} 페이지</span>
    </div>

    <div class="flex items-center gap-1.5">
      <button type="button" onclick="window.goToShipmentPage(${shipmentPage - 1})" 
              ${shipmentPage <= 1 ? 'disabled class="px-2 py-1 bg-slate-100 text-slate-400 rounded-lg text-xs cursor-not-allowed"' : 'class="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold rounded-lg text-xs transition-colors cursor-pointer"'}>
        ◀ 이전
      </button>
      
      <div class="flex items-center gap-1">
        ${pageButtons}
      </div>

      <button type="button" onclick="window.goToShipmentPage(${shipmentPage + 1})" 
              ${shipmentPage >= totalPages ? 'disabled class="px-2 py-1 bg-slate-100 text-slate-400 rounded-lg text-xs cursor-not-allowed"' : 'class="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold rounded-lg text-xs transition-colors cursor-pointer"'}>
        다음 ▶
      </button>

      <span class="text-slate-300 mx-1">|</span>

      <select id="selectShipmentPageSize" onchange="window.setShipmentPageSize(this.value)" class="bg-white border border-slate-300 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-700 outline-none cursor-pointer">
        <option value="50" ${shipmentPageSize === 50 ? 'selected' : ''}>50개씩</option>
        <option value="100" ${shipmentPageSize === 100 ? 'selected' : ''}>100개씩</option>
        <option value="200" ${shipmentPageSize === 200 ? 'selected' : ''}>200개씩</option>
        <option value="ALL" ${shipmentPageSize === 'ALL' ? 'selected' : ''}>전체 (${total})</option>
      </select>
    </div>
  `;
}

window.goToShipmentPage = function (page) {
  shipmentPage = page;
  updateShipmentCurrentPage();

  // 🚀 테이블 내부 목록 스크롤만 최상단으로 리셋 (전체 페이지 윈도우 스크롤은 유지)
  const tableContainer = document.getElementById("shipmentTableBody")?.closest(".overflow-y-auto");
  if (tableContainer) tableContainer.scrollTop = 0;
  const mobileContainer = document.getElementById("shipmentCardContainer");
  if (mobileContainer) mobileContainer.scrollTop = 0;
};

window.getShipmentByIndex = function (idx) {
  const paged = getPagedShipments();
  return paged[idx] || null;
};

window.setShipmentPageSize = function (size) {
  shipmentPageSize = (size === 'ALL') ? 'ALL' : parseInt(size, 10);
  shipmentPage = 1;
  updateShipmentCurrentPage();

  const tableContainer = document.getElementById("shipmentTableBody")?.closest(".overflow-y-auto");
  if (tableContainer) tableContainer.scrollTop = 0;
  const mobileContainer = document.getElementById("shipmentCardContainer");
  if (mobileContainer) mobileContainer.scrollTop = 0;
};

/**
 * 📥 세일즈 마스터 규격 Excel 내보내기 (UTF-8 BOM CSV 생성)
 */
window.exportShipmentLedgerExcel = function () {
  const items = lastFilteredShipments;
  if (!items || items.length === 0) {
    alert("내보낼 출하 원장 데이터가 없습니다.");
    return;
  }

  const headers = [
    "연번",
    "CUSTOMER(계약처)",
    "REALCUST(실수요처)",
    "PONO(발주번호)",
    "PARTNO(품번)",
    "SHIP_DATE(출하일자)",
    "SHIP_QTY(수량)",
    "NET_UP_USD(순단가)",
    "SHIP_AMT_USD(출하금액)",
    "SHIP_AMT_KRW(원화환산)",
    "APP(용도)",
    "MFG(제조사)",
    "SUPPLY(공급사)",
    "INVOICENO(인보이스번호)"
  ];

  const rows = items.map((item, idx) => [
    idx + 1,
    `"${(item.customer || '').replace(/"/g, '""')}"`,
    `"${(item.real_cust || '').replace(/"/g, '""')}"`,
    `"${(item.po_no || '').replace(/"/g, '""')}"`,
    `"${(item.part_no || '').replace(/"/g, '""')}"`,
    `"${item.ship_date || ''}"`,
    Number(item.ship_qty) || 0,
    (Number(item.net_up) || 0).toFixed(4),
    (Number(item.ship_amt) || 0).toFixed(4),
    Math.round((Number(item.ship_amt) || 0) * currentFxRate),
    `"${(item.app || '').replace(/"/g, '""')}"`,
    `"${(item.maker || '').replace(/"/g, '""')}"`,
    `"${(item.supply || '').replace(/"/g, '""')}"`,
    `"${(item.invoice_no || '').replace(/"/g, '""')}"`
  ]);

  const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const filename = `BSK_출하원장_${currentStartDate}_${currentEndDate}${currentMfg ? `_${currentMfg}` : ''}.csv`;
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// ========================================================
// 🔄 출하완료(SHIPPED) 양방향 동기화 및 롤백 엔진
// ========================================================
export async function syncShipmentLifecycle(itemId, payload, origItem = null) {
  if (!itemId || !sbClient) return;

  const currentStatus = String(payload.order_status || payload.orderStatus || origItem?.order_status || '').trim();

  if (currentStatus === '출하완료') {
    try {
      const todayStr = new Date().toISOString().slice(0, 10);
      const shipDate = payload.shipped_date || payload.shippedDate || origItem?.shipped_date || origItem?.shippedDate || todayStr;
      const shipQty = Number(payload.arranged_qty ?? payload.arrangedQty ?? payload.stock ?? origItem?.stock ?? 1);
      const fx = Number(payload.ship_fx ?? payload.shipFx ?? origItem?.ship_fx ?? currentFxRate) || currentFxRate;

      const soldUsd = Number(payload.sold_price_usd ?? payload.soldPriceUsd ?? origItem?.sold_price_usd ?? 0);
      const unitUsd = Number(payload.unit_usd ?? payload.unitUsd ?? origItem?.unit_usd ?? 0);
      const effectiveUnitUsd = soldUsd > 0 ? soldUsd : unitUsd;

      const unitKrw = Math.round(effectiveUnitUsd * fx);
      const costKrw = Math.round(unitUsd * fx);
      const totalSales = unitKrw * shipQty;

      const partName = payload.part_name || payload.partName || origItem?.part_name || origItem?.partName || 'UNKNOWN';
      const maker = payload.maker || origItem?.maker || 'OTHERS';
      const poNo = payload.po_no || payload.poNo || payload.tracking_no || payload.trackingNo || origItem?.po_no || origItem?.tracking_no || 'WEB-MANUAL';

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(itemId));

      const shipmentRecord = {
        inventory_item_id: isUuid ? String(itemId) : null,
        part_name: partName,
        maker: maker,
        qty: shipQty,
        unit_price: unitKrw,
        cost_price: costKrw,
        total_sales_amount: totalSales,
        po_no: poNo,
        order_date: shipDate,
        status: 'SHIPPED',
        last_synced_at: new Date().toISOString()
      };

      let existing = null;
      if (isUuid) {
        const { data } = await sbClient
          .from('legacy_shipments')
          .select('id')
          .eq('inventory_item_id', String(itemId))
          .limit(1);
        existing = data;
      }

      if (existing && existing.length > 0) {
        await sbClient.from('legacy_shipments').update(shipmentRecord).eq('id', existing[0].id);
        console.log(`✅ [legacy_shipments] 출하 이력 업데이트 성공: ${partName} (${itemId})`);
      } else {
        await sbClient.from('legacy_shipments').insert([shipmentRecord]);
        console.log(`✅ [legacy_shipments] 출하 이력 신규 등록 성공: ${partName} (${itemId})`);
      }
    } catch (shipErr) {
      console.error("❌ [legacy_shipments] 출하 이력 동기화 에러:", shipErr);
    }
  } else {
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(itemId));
      if (isUuid) {
        const { error: delErr } = await sbClient
          .from('legacy_shipments')
          .delete()
          .eq('inventory_item_id', String(itemId));

        if (!delErr) {
          console.log(`ℹ️ [legacy_shipments] 상태 롤백(${currentStatus}) -> 출하 이력 자동 삭제 완료 (${itemId})`);
        }
      }
    } catch (delCatch) {
      console.error("❌ [legacy_shipments] 출하 이력 회수 실패:", delCatch);
    }
  }
}
