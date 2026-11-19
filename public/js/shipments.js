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
import { toEnglishSalesName } from './modules/utils.js';

// 상태 관리
let activeShipmentMode = 'ledger'; // 'ledger' | 'web' | 'borrow' | 'rma' | 'loss'
let cachedLedgerShipments = [];     // MS-SQL Shipped Info 데이터
let cachedWebShipments = [];        // Supabase 출하완료건 데이터
let lastFilteredShipments = [];     // 현재 화면에 표시되는 필터링 결과
let cachedBorrows = null;           // DBRWFile 대여/반납
let cachedRmas = null;              // DRMAFile 반품 RMA
let cachedLosses = null;            // LossFile 손실/폐기
let subLedgerQuery = '';            // 서브탭 검색어

// 필터 옵션
let availableMakers = [];
let availableSupplies = [];

// 기본 조회 기간: 최근 4개월 (세일즈 마스터 기본 뷰 규격)
const initDates = getDefaultDateRange();
let currentStartDate = initDates.start;
let currentEndDate = initDates.end;
let currentMfg = '';
let currentSupply = '';
let currentBizType = '';     // '' | 'COMMISSION' | 'DOMESTIC'
let currentCommStatus = '';  // '' | 'UNPAID' | 'PAID'
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
  const bizType = params.bizType !== undefined ? params.bizType : currentBizType;
  const commStatus = params.commStatus !== undefined ? params.commStatus : currentCommStatus;
  const query = params.query !== undefined ? params.query : currentSearchQuery;

  currentStartDate = start;
  currentEndDate = end;
  currentMfg = mfg;
  currentSupply = supply;
  currentBizType = bizType;
  currentCommStatus = commStatus;
  currentSearchQuery = query;

  const urlParams = new URLSearchParams();
  if (start) urlParams.append('start_date', start);
  if (end) urlParams.append('end_date', end);
  if (mfg) urlParams.append('mfg', mfg);
  if (supply) urlParams.append('supply', supply);
  if (bizType) urlParams.append('biz_type', bizType);
  if (commStatus) urlParams.append('comm_status', commStatus);
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
      cachedWebShipments = data.map(item => {
        const rawStatus = String(item.status || 'SHIPPED');
        const stParts = rawStatus.split('||');
        const baseStatus = stParts[0] || 'SHIPPED';
        const parsedCust = stParts[1] || item.customer_name || '웹 수주 거래처';
        const parsedRealCust = stParts[2] || item.real_cust || '-';
        const parsedApp = stParts[3] || item.application || '-';
        return {
          id: item.id,
          idx: item.id || item.legacy_out_id,
          customer: parsedCust,
          real_cust: parsedRealCust,
          po_no: item.po_no || 'WEB-MANUAL',
          part_no: item.part_name || '-',
          ship_date: item.order_date || '-',
          ship_qty: item.qty || 0,
          net_up: (item.unit_price && currentFxRate > 0) ? (item.unit_price / currentFxRate) : ((item.cost_price && currentFxRate > 0) ? (item.cost_price / currentFxRate) : 0.0),
          ship_amt: (item.total_sales_amount && currentFxRate > 0) ? (item.total_sales_amount / currentFxRate) : 0.0,
          unit_krw: item.unit_price || 0,
          cost_krw: item.cost_price || 0,
          total_krw: item.total_sales_amount || 0,
          app: parsedApp,
          maker: item.maker || 'OTHERS',
          supply: 'WEB',
          is_web: true,
          status: baseStatus
        };
      });
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
function getMergedLedgerShipments() {
  const q = (currentSearchQuery || '').trim().toLowerCase();
  const filteredWeb = (cachedWebShipments || []).filter(item => {
    const sd = (item.ship_date || '').slice(0, 10);
    if (currentStartDate && sd && sd < currentStartDate) return false;
    if (currentEndDate && sd && sd > currentEndDate) return false;
    if (currentMfg && (item.maker || '').toLowerCase() !== currentMfg.toLowerCase()) return false;
    if (currentSupply && (item.supply || '').toLowerCase() !== currentSupply.toLowerCase()) return false;
    if (currentBizType === 'COMMISSION') return false;
    if (currentCommStatus) return false;
    if (q) {
      const hay = `${item.part_no || ''} ${item.customer || ''} ${item.real_cust || ''} ${item.po_no || ''} ${item.app || ''} ${item.maker || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  return [...filteredWeb, ...(cachedLedgerShipments || [])];
}

export async function fetchShipments() {
  // 1. 전역 실시간 환율 재사용 (중복 /api/fx-rate 호출 제거)
  const globalFx = (typeof window.getLiveFxRate === 'function') ? window.getLiveFxRate() : (window.rawFxRate || 0);
  if (globalFx > 0) {
    currentFxRate = globalFx;
  } else {
    try {
      const fxRes = await fetch('/api/fx-rate');
      const fxData = await fxRes.json();
      if (fxData && fxData.current_rate > 0) currentFxRate = fxData.current_rate;
    } catch (e) {
      currentFxRate = 1350;
    }
  }

  // 2. 필터 목록, 공식 출하 원장, 웹 출하 데이터를 병렬(Promise.all)로 동시 로드 후 통합
  await Promise.all([fetchShippedFilters(), fetchLedgerShipments(), fetchWebShipments()]);
  lastFilteredShipments = getMergedLedgerShipments();
  return lastFilteredShipments;
}

/**
 * 🚚 출하 종합 원장 뷰 렌더링
 */
export function renderShipmentsView(containerId = "shipmentsSection") {
  const container = document.getElementById(containerId);
  if (!container) return;

  const activeItems = getMergedLedgerShipments();
  lastFilteredShipments = activeItems;
  shipmentPage = 1;

  // 전체 통계 계산 (Commission 합계 및 미입금 커미션 포함)
  const totalCount = lastFilteredShipments.length;
  const totalQty = lastFilteredShipments.reduce((sum, item) => sum + (Number(item.ship_qty) || 0), 0);
  const totalUsd = lastFilteredShipments.reduce((sum, item) => sum + (Number(item.ship_amt) || 0), 0);
  const totalKrw = lastFilteredShipments.reduce((sum, item) => {
    if (item.total_krw) return sum + item.total_krw;
    return sum + Math.round((Number(item.ship_amt) || 0) * currentFxRate);
  }, 0);
  const totalCommUsd = lastFilteredShipments.reduce((sum, item) => sum + (Number(item.comm_amt) || 0), 0);
  const unpaidCommUsd = lastFilteredShipments.reduce((sum, item) => {
    const c = Number(item.comm_amt) || 0;
    const isPaid = Boolean((item.bank_dt || '').trim() || (item.comm_dt || '').trim());
    return sum + (c > 0 && !isPaid ? c : 0);
  }, 0);
  const commCount = lastFilteredShipments.filter(item => (Number(item.comm_amt) || 0) > 0).length;

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

        <!-- 모드 전환 탭 (출하 원장 / 웹 출하 / 대여·반납 / 반품 RMA / 손실·폐기) + 상황별 신규 등록 -->
        <div class="flex items-center gap-2 flex-wrap shrink-0 self-start lg:self-center max-w-full">
          ${activeShipmentMode === 'borrow' ? `
            <button type="button" onclick="window.openSubLedgerCrudModal && window.openSubLedgerCrudModal('borrow', null)" class="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white font-black text-xs rounded-lg shadow-xs cursor-pointer transition-colors whitespace-nowrap">
              + 대여/반납 등록
            </button>
          ` : activeShipmentMode === 'rma' ? `
            <button type="button" onclick="window.openSubLedgerCrudModal && window.openSubLedgerCrudModal('rma', null)" class="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-lg shadow-xs cursor-pointer transition-colors whitespace-nowrap">
              + 반품(RMA) 등록
            </button>
          ` : activeShipmentMode === 'loss' ? `
            <button type="button" onclick="window.openSubLedgerCrudModal && window.openSubLedgerCrudModal('loss', null)" class="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-black text-xs rounded-lg shadow-xs cursor-pointer transition-colors whitespace-nowrap">
              + 손실/폐기 등록
            </button>
          ` : ((typeof window.isCsOrAdminUser === 'function' && window.isCsOrAdminUser()) ? `
            <button type="button" onclick="window.openShipmentCrudModal && window.openShipmentCrudModal(null)" class="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-900 font-black text-xs rounded-lg shadow-xs cursor-pointer transition-colors whitespace-nowrap">
              + 신규 출하 등록
            </button>
          ` : '')}
          <div class="flex items-center gap-1 bg-slate-100 p-1 rounded-xl overflow-x-auto scrollbar-none max-w-full">
            <button type="button" id="btnModeLedger" class="px-2.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${activeShipmentMode === 'ledger' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}">
              🚚 출하 원장
            </button>
            <button type="button" id="btnModeBorrow" class="px-2.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${activeShipmentMode === 'borrow' ? 'bg-teal-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}">
              🔄 대여/반납
            </button>
            <button type="button" id="btnModeRma" class="px-2.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${activeShipmentMode === 'rma' ? 'bg-amber-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}">
              ↩️ 반품 RMA
            </button>
            <button type="button" id="btnModeLoss" class="px-2.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${activeShipmentMode === 'loss' ? 'bg-rose-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}">
              ⚠️ 손실/폐기
            </button>
          </div>
        </div>
      </div>

      ${(activeShipmentMode === 'borrow' || activeShipmentMode === 'rma' || activeShipmentMode === 'loss') ? renderSubLedgerSection() : `

      <!-- 세일즈 마스터 규격 툴바 (기간, MFG, SUPPLY, 검색, Excel — 모바일 완전 최적화) -->
      <div class="bg-slate-50 p-3 sm:p-4 rounded-xl border border-slate-200 space-y-2.5 sm:space-y-3">
        <div class="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-2.5 text-xs">
          
          <!-- DATE 기간 설정 (모바일 2열 그리드 / 데스크톱 인라인) -->
          <div class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-1.5 w-full sm:w-auto">
            <span class="font-bold text-slate-700 font-mono text-[11px] shrink-0">DATE</span>
            <div class="grid grid-cols-[1fr_auto_1fr] sm:flex items-center gap-1.5 w-full sm:w-auto">
              <input type="date" id="shipmentStartDate" value="${currentStartDate}" 
                     class="w-full min-w-0 px-2 py-1.5 sm:py-1 text-xs font-mono font-semibold bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500">
              <span class="text-slate-400 font-bold text-center">~</span>
              <input type="date" id="shipmentEndDate" value="${currentEndDate}" 
                     class="w-full min-w-0 px-2 py-1.5 sm:py-1 text-xs font-mono font-semibold bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500">
            </div>
          </div>

          <!-- 기간 빠른 선택 프리셋 버튼 (모바일 1열 가로 스와이프) -->
          <div class="flex items-center gap-1 overflow-x-auto scrollbar-none pb-0.5 sm:pb-0">
            <button type="button" onclick="window.setShipmentDatePreset('curMonth')" class="shrink-0 px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 text-[11px] sm:text-[10px] font-bold rounded-lg border border-slate-200 transition cursor-pointer whitespace-nowrap">당월</button>
            <button type="button" onclick="window.setShipmentDatePreset('3M')" class="shrink-0 px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 text-[11px] sm:text-[10px] font-bold rounded-lg border border-slate-200 transition cursor-pointer whitespace-nowrap">최근 3개월</button>
            <button type="button" onclick="window.setShipmentDatePreset('6M')" class="shrink-0 px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 text-[11px] sm:text-[10px] font-bold rounded-lg border border-slate-200 transition cursor-pointer whitespace-nowrap">최근 6개월</button>
            <button type="button" onclick="window.setShipmentDatePreset('YTD')" class="shrink-0 px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 text-[11px] sm:text-[10px] font-bold rounded-lg border border-slate-200 transition cursor-pointer whitespace-nowrap">2026 연간</button>
            <button type="button" onclick="window.setShipmentDatePreset('ALL')" class="shrink-0 px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 text-[11px] sm:text-[10px] font-bold rounded-lg border border-slate-200 transition cursor-pointer whitespace-nowrap">전체</button>
          </div>

          <!-- MFG / SUPPLY / 거래구분(Commission/Domestic) / 커미션 정산상태 필터 -->
          <div class="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center gap-2 w-full sm:w-auto">
            <div class="flex items-center gap-1 min-w-0">
              <span class="font-bold text-slate-700 text-[10px] sm:text-[11px] shrink-0">MFG</span>
              <select id="shipmentMfgSelect" class="w-full min-w-0 sm:max-w-[130px] bg-white border border-slate-300 rounded-lg px-2 py-1.5 sm:py-1 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer">
                ${makerOptionsHtml}
              </select>
            </div>
            <div class="flex items-center gap-1 min-w-0">
              <span class="font-bold text-slate-700 text-[10px] sm:text-[11px] shrink-0">SUP</span>
              <select id="shipmentSupplySelect" class="w-full min-w-0 sm:max-w-[130px] bg-white border border-slate-300 rounded-lg px-2 py-1.5 sm:py-1 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer">
                ${supplyOptionsHtml}
              </select>
            </div>
            <div class="flex items-center gap-1 min-w-0">
              <span class="font-bold text-violet-700 text-[10px] sm:text-[11px] shrink-0">구분</span>
              <select id="shipmentBizTypeSelect" class="w-full min-w-0 sm:max-w-[145px] bg-white border border-violet-300 rounded-lg px-2 py-1.5 sm:py-1 text-xs font-bold text-violet-900 outline-none focus:ring-2 focus:ring-violet-500 cursor-pointer">
                <option value="" ${currentBizType === '' ? 'selected' : ''}>전체 (Comm+Dom)</option>
                <option value="COMMISSION" ${currentBizType === 'COMMISSION' ? 'selected' : ''}>💎 Commission</option>
                <option value="DOMESTIC" ${currentBizType === 'DOMESTIC' ? 'selected' : ''}>🏢 Domestic</option>
              </select>
            </div>
            <div class="flex items-center gap-1 min-w-0">
              <span class="font-bold text-violet-700 text-[10px] sm:text-[11px] shrink-0">정산</span>
              <select id="shipmentCommStatusSelect" class="w-full min-w-0 sm:max-w-[130px] bg-white border border-violet-300 rounded-lg px-2 py-1.5 sm:py-1 text-xs font-bold text-violet-900 outline-none focus:ring-2 focus:ring-violet-500 cursor-pointer">
                <option value="" ${currentCommStatus === '' ? 'selected' : ''}>정산 전체</option>
                <option value="UNPAID" ${currentCommStatus === 'UNPAID' ? 'selected' : ''}>⏳ 커미션 미입금</option>
                <option value="PAID" ${currentCommStatus === 'PAID' ? 'selected' : ''}>✅ 커미션 정산완료</option>
              </select>
            </div>
          </div>

          <!-- 검색 & Excel 버튼 (모바일 2열 풀폭) -->
          <div class="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full sm:w-auto sm:ml-auto">
            <button type="button" id="btnShipmentSearch" class="px-3.5 py-2 sm:py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs shadow-xs transition flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap">
              <span>🔍</span> 검색
            </button>
            <button type="button" id="btnShipmentExcelExport" class="px-3.5 py-2 sm:py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs shadow-xs transition flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap">
              <span>📥</span> Excel
            </button>
          </div>
        </div>

        <!-- 실시간 라이브 필터 검색창 -->
        <div class="relative w-full">
          <input type="text" id="shipmentLiveFilterInput" placeholder="고객사, 실수요처, 품번(PARTNO), 발주번호, 용도 빠른 검색..." 
                 class="w-full pl-8 pr-3 py-2 sm:py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 outline-none font-medium text-slate-800 shadow-2xs">
          <span class="absolute left-2.5 top-2.5 sm:top-2 text-slate-400 text-xs">⚡</span>
        </div>
      </div>

      <!-- 요약 바 (Grand Summaries + Commission KPI) -->
      <div class="bg-amber-50/90 border border-amber-200 rounded-xl p-3 text-xs font-mono font-bold text-slate-800 flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-2.5 shadow-xs">
        <div class="flex items-center justify-between sm:justify-start gap-2">
          <span class="text-amber-900 font-sans font-black text-xs sm:text-sm">🚚 SHIPPED INFO GRAND SUMMARIES</span>
          <span id="shipmentSummaryCount" class="text-slate-600 font-sans font-bold text-xs bg-white/70 px-2 py-0.5 rounded-full border border-amber-200">${totalCount.toLocaleString()}건 (Comm ${commCount.toLocaleString()})</span>
        </div>
        <div class="grid grid-cols-1 sm:flex sm:flex-wrap sm:items-center gap-1.5 sm:gap-3.5 text-xs font-mono">
          <div class="flex justify-between sm:block"><span>총 출하수량:</span> <span id="shipmentSumQty" class="text-indigo-900 font-black text-sm">${totalQty.toLocaleString()} EA</span></div>
          <span class="text-slate-300 hidden sm:inline">|</span>
          <div class="flex justify-between sm:block"><span>총 외화금액:</span> <span id="shipmentSumUsd" class="text-blue-700 font-black text-sm">$${totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
          <span class="text-slate-300 hidden sm:inline">|</span>
          <div class="flex justify-between sm:block"><span class="text-violet-800">💎 커미션:</span> <span id="shipmentSumComm" class="text-violet-700 font-black text-sm">$${totalCommUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
          <span class="text-slate-300 hidden sm:inline">|</span>
          <div class="flex justify-between sm:block"><span class="text-rose-700">미입금 커미션:</span> <span id="shipmentSumUnpaidComm" class="text-rose-600 font-black text-sm">$${unpaidCommUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
          <span class="text-slate-300 hidden sm:inline">|</span>
          <div class="flex justify-between sm:block"><span>원화 환산(@${currentFxRate.toLocaleString()}):</span> <span id="shipmentSumKrw" class="text-slate-700 font-black text-sm">₩${Math.round(totalKrw).toLocaleString()}</span></div>
        </div>
      </div>

      <!-- 모바일 전용 카드 뷰 (md:hidden — 모바일 뷰포트에서만 DOM 생성하여 메모리 50% 절감) -->
      <div id="shipmentCardContainer" class="block md:hidden space-y-2.5 max-h-[65vh] overflow-y-auto pr-0.5">
        ${window.innerWidth < 768 ? generateShipmentMobileCards(getPagedShipments()) : ''}
      </div>

      <!-- 데스크톱 전용 테이블 (hidden md:block) - 세일즈 마스터 10개 컬럼 완벽 일치 -->
      <div class="hidden md:block overflow-x-auto max-h-[65vh] overflow-y-auto border border-slate-200 rounded-xl shadow-xs">
        <table class="w-full text-left text-xs border-collapse">
          <thead class="bg-slate-100/95 backdrop-blur-sm text-slate-700 border-b uppercase font-bold sticky top-0 z-10 shadow-xs text-[11px]">
            <tr>
              <th class="py-2.5 px-1.5 text-center whitespace-nowrap w-8">#</th>
              <th class="py-2.5 px-2 text-center whitespace-nowrap w-16">구분</th>
              <th class="py-2.5 px-2 text-left min-w-[115px]">CUSTOMER</th>
              <th class="py-2.5 px-2 text-left min-w-[100px]">REALCUST</th>
              <th class="py-2.5 px-2 text-left min-w-[115px]">PONO</th>
              <th class="py-2.5 px-2 text-left min-w-[150px]">PARTNO</th>
              <th class="py-2.5 px-2 text-center whitespace-nowrap w-22">SHIP_DATE</th>
              <th class="py-2.5 px-2 text-right whitespace-nowrap w-20">SHIP_QTY</th>
              <th class="py-2.5 px-2 text-right whitespace-nowrap w-20">NET_UP($)</th>
              <th class="py-2.5 px-2 text-right whitespace-nowrap w-24">SHIP_AMT($)</th>
              <th class="py-2.5 px-2 text-right whitespace-nowrap w-24 text-violet-800">💎 COMM($/%)</th>
              <th class="py-2.5 px-2 text-center whitespace-nowrap w-20 text-violet-800">정산상태</th>
              <th class="py-2.5 px-2 text-center whitespace-nowrap w-16">담당자</th>
              <th class="py-2.5 px-2 text-center whitespace-nowrap w-28 no-print">문서</th>
            </tr>
          </thead>
          <tbody id="shipmentTableBody" class="divide-y divide-slate-100 font-medium bg-white text-slate-700">
            ${window.innerWidth >= 768 ? generateTableRows(getPagedShipments()) : ''}
          </tbody>
        </table>
      </div>

      <!-- 📄 출하 페이지네이션 컨트롤러 -->
      <div id="shipmentPagination" class="flex flex-wrap items-center justify-between gap-2 pt-2 px-1 text-xs select-none"></div>
      `}
    </div>
  `;

  bindShipmentToolbarEvents();
  if (activeShipmentMode === 'ledger' || activeShipmentMode === 'web') {
    renderShipmentPaginationUI();
  }
}

async function fetchSubLedgerData(mode, query = '') {
  const endpointMap = {
    borrow: '/api/shipped-info/borrows',
    rma: '/api/shipped-info/rmas',
    loss: '/api/shipped-info/losses'
  };
  const url = endpointMap[mode];
  if (!url) return [];
  try {
    const params = new URLSearchParams({ limit: '300' });
    if (query) params.set('query', query);
    const res = await fetch(`${url}?${params.toString()}`);
    const data = await res.json();
    const items = (data.items || []).map(it => ({
      ...it,
      sales: toEnglishSalesName(it.sales)
    }));
    if (mode === 'borrow') cachedBorrows = items;
    else if (mode === 'rma') cachedRmas = items;
    else if (mode === 'loss') cachedLosses = items;
    return items;
  } catch (err) {
    console.error(`[SubLedger:${mode}] 조회 오류:`, err);
    return [];
  }
}

function escSub(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderSubLedgerSection() {
  const metaMap = {
    borrow: { title: '대여 / 반납 원장 (DBRWFile)', badge: 'bg-teal-100 text-teal-800 border-teal-200', items: cachedBorrows },
    rma: { title: '반품(RMA) 원장 (DRMAFile)', badge: 'bg-amber-100 text-amber-800 border-amber-200', items: cachedRmas },
    loss: { title: '재고 손실 / 불량·폐기 원장 (LossFile)', badge: 'bg-rose-100 text-rose-800 border-rose-200', items: cachedLosses }
  };
  const meta = metaMap[activeShipmentMode] || metaMap.borrow;
  const items = meta.items || [];
  const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
  const totalAmt = items.reduce((s, it) => s + (Number(it.out_amt || it.np_amt) || 0), 0);

  let bodyHtml = '';
  if (meta.items === null) {
    bodyHtml = `<div class="py-12 text-center text-slate-400 font-bold text-xs">⏳ 데이터를 불러오는 중입니다...</div>`;
  } else if (items.length === 0) {
    bodyHtml = `<div class="py-12 text-center text-slate-400 font-bold text-xs">조회 조건에 일치하는 내역이 없습니다.</div>`;
  } else if (activeShipmentMode === 'borrow') {
    bodyHtml = `
      <div class="block md:hidden space-y-2 max-h-[62vh] overflow-y-auto">
        ${items.map((b, i) => `
          <div class="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs space-y-1.5 text-xs">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="text-[10px] font-mono text-slate-400">#${i + 1}</span>
                <span class="text-[10px] font-mono font-bold bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">${escSub(b.date || '-')}</span>
                ${b.gubun ? `<span class="text-[10px] font-bold bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded border border-teal-200">${escSub(b.gubun)}</span>` : ''}
                ${b.result ? `<span class="text-[10px] font-bold bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded">${escSub(b.result)}</span>` : ''}
              </div>
              <span class="font-mono font-black text-slate-900 shrink-0">${(b.qty || 0).toLocaleString()} EA</span>
            </div>
            <div class="font-black text-indigo-950 font-mono truncate">${escSub(b.part_no || '-')}</div>
            <div class="flex items-center justify-between text-[11px] text-slate-600">
              <span class="font-bold text-slate-800 truncate">${escSub(b.customer_name)}</span>
              <span class="shrink-0 font-semibold">${escSub(b.maker)} · ${escSub(b.sales || '-')}</span>
            </div>
            ${(b.rtn_date || b.remark) ? (() => {
              const trk = (typeof window.extractTrackingNumber === 'function') ? window.extractTrackingNumber(b.remark) : '';
              return `<div class="text-[10px] text-slate-500 flex items-center justify-between gap-2 pt-1 border-t border-slate-100"><span class="truncate">${escSub(b.remark || '')}</span><div class="flex items-center gap-1.5 shrink-0">${trk ? `<button type="button" onclick="window.openTrackingModal && window.openTrackingModal('${escSub(trk)}', '${escSub(b.remark || '')}')" class="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 font-bold cursor-pointer">🚚 추적</button>` : ''}${b.rtn_date ? `<span class="font-mono text-teal-700 font-bold">반납: ${escSub(b.rtn_date)}</span>` : ''}</div></div>`;
            })() : ''}
          </div>
        `).join('')}
      </div>
      <div class="hidden md:block overflow-x-auto max-h-[62vh] overflow-y-auto border border-slate-200 rounded-xl">
        <table class="w-full text-left text-xs border-collapse">
          <thead class="bg-teal-50 text-teal-950 font-bold text-[11px] border-b border-teal-200 sticky top-0 z-10">
            <tr>
              <th class="py-2 px-2.5 text-center w-10">#</th>
              <th class="py-2 px-2.5 text-center w-24">출고/대여일</th>
              <th class="py-2 px-2.5 text-left min-w-[150px]">고객사명</th>
              <th class="py-2 px-2.5 text-left min-w-[160px]">품번 (Part#)</th>
              <th class="py-2 px-2 text-center w-20">제조사</th>
              <th class="py-2 px-2.5 text-right w-20">수량</th>
              <th class="py-2 px-2 text-center w-20">구분/상태</th>
              <th class="py-2 px-2.5 text-center w-24">반납일</th>
              <th class="py-2 px-2 text-center w-20">영업담당</th>
              <th class="py-2 px-2.5 text-left min-w-[140px]">비고 / 송장</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 bg-white text-[11px]">
            ${items.map((b, i) => `
              <tr class="hover:bg-teal-50/40 ${b.is_web ? 'bg-emerald-50/25' : ''}">
                <td class="py-1.5 px-2.5 text-center font-mono text-slate-400">${b.is_web ? `<span class="px-1 py-0.2 rounded text-[9px] font-black bg-emerald-100 text-emerald-700">WEB</span>` : (i + 1)}</td>
                <td class="py-1.5 px-2.5 text-center font-mono text-slate-700 whitespace-nowrap">${escSub(b.date || '-')}</td>
                <td class="py-1.5 px-2.5 font-bold text-slate-900 truncate max-w-[180px]" title="${escSub(b.customer_name)}">${escSub(b.customer_name)}</td>
                <td class="py-1.5 px-2.5 font-mono font-black text-indigo-950">${escSub(b.part_no || '-')}</td>
                <td class="py-1.5 px-2 text-center font-bold text-slate-600">${escSub(b.maker)}</td>
                <td class="py-1.5 px-2.5 text-right font-mono font-black text-slate-900 whitespace-nowrap">${(b.qty || 0).toLocaleString()}</td>
                <td class="py-1.5 px-2 text-center whitespace-nowrap"><span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-teal-50 text-teal-800 border border-teal-200">${escSub([b.gubun, b.result].filter(Boolean).join('/')) || '-'}</span></td>
                <td class="py-1.5 px-2.5 text-center font-mono text-teal-700 whitespace-nowrap">${escSub(b.rtn_date || b.rdt || '-')}</td>
                <td class="py-1.5 px-2 text-center font-bold text-indigo-900 whitespace-nowrap">${escSub(b.sales || '-')}</td>
                <td class="py-1.5 px-2.5 text-slate-500 max-w-[220px]" title="${escSub(b.remark)}">
                  <div class="flex items-center justify-between gap-1.5">
                    ${(() => {
                      const trk = (typeof window.extractTrackingNumber === 'function') ? window.extractTrackingNumber(b.remark) : '';
                      return trk
                        ? `<div class="flex items-center gap-1 min-w-0"><span class="truncate">${escSub(b.remark)}</span><button type="button" onclick="window.openTrackingModal && window.openTrackingModal('${escSub(trk)}', '${escSub(b.remark || '')}')" class="shrink-0 px-1.5 py-0.5 rounded bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 font-bold text-[10px] cursor-pointer" title="실시간 배송 추적">🚚</button></div>`
                        : `<span class="truncate block">${escSub(b.remark || '-')}</span>`;
                    })()}
                    ${b.is_web ? `<div class="flex items-center gap-1 shrink-0"><button type="button" onclick="window.openSubLedgerCrudModalByIdx('borrow', ${i})" class="px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded text-[10px] font-bold cursor-pointer" title="수정">✏️</button><button type="button" onclick="window.deleteSubLedgerRecord('borrow', '${escSub(b.id)}')" class="px-1.5 py-0.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded text-[10px] font-bold cursor-pointer" title="삭제">🗑️</button></div>` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } else if (activeShipmentMode === 'rma') {
    bodyHtml = `
      <div class="block md:hidden space-y-2 max-h-[62vh] overflow-y-auto">
        ${items.map((r, i) => `
          <div class="bg-white rounded-xl border border-amber-200 p-3 shadow-2xs space-y-1.5 text-xs">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] font-mono text-slate-400">#${i + 1}</span>
                <span class="text-[10px] font-mono font-bold bg-amber-50 text-amber-900 px-1.5 py-0.5 rounded">${escSub(r.date || '-')}</span>
                <span class="text-[10px] font-bold bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">${escSub(r.maker)}</span>
              </div>
              <span class="font-mono font-black text-amber-800">${(r.qty || 0).toLocaleString()} EA</span>
            </div>
            <div class="font-black text-indigo-950 font-mono truncate">${escSub(r.part_no || '-')}</div>
            <div class="flex items-center justify-between text-[11px]">
              <span class="font-bold text-slate-800 truncate">${escSub(r.customer_name)}</span>
              <span class="font-mono font-bold text-slate-900">₩${Math.round(r.out_amt || 0).toLocaleString()}</span>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="hidden md:block overflow-x-auto max-h-[62vh] overflow-y-auto border border-slate-200 rounded-xl">
        <table class="w-full text-left text-xs border-collapse">
          <thead class="bg-amber-50 text-amber-950 font-bold text-[11px] border-b border-amber-200 sticky top-0 z-10">
            <tr>
              <th class="py-2 px-2.5 text-center w-10">#</th>
              <th class="py-2 px-2.5 text-center w-24">반품일자</th>
              <th class="py-2 px-2.5 text-left min-w-[150px]">고객사명</th>
              <th class="py-2 px-2.5 text-left min-w-[160px]">품번 (Part#)</th>
              <th class="py-2 px-2 text-center w-20">제조사</th>
              <th class="py-2 px-2.5 text-left w-28">PO 번호</th>
              <th class="py-2 px-2.5 text-right w-20">수량</th>
              <th class="py-2 px-2.5 text-right w-24">판매단가</th>
              <th class="py-2 px-2.5 text-right w-28">반품금액</th>
              <th class="py-2 px-2 text-center w-20">영업담당</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 bg-white text-[11px]">
            ${items.map((r, i) => `
              <tr class="hover:bg-amber-50/40 ${r.is_web ? 'bg-emerald-50/25' : ''}">
                <td class="py-1.5 px-2.5 text-center font-mono text-slate-400">${r.is_web ? `<span class="px-1 py-0.2 rounded text-[9px] font-black bg-emerald-100 text-emerald-700">WEB</span>` : (i + 1)}</td>
                <td class="py-1.5 px-2.5 text-center font-mono text-slate-700 whitespace-nowrap">${escSub(r.date || '-')}</td>
                <td class="py-1.5 px-2.5 font-bold text-slate-900 truncate max-w-[180px]">${escSub(r.customer_name)}</td>
                <td class="py-1.5 px-2.5 font-mono font-black text-indigo-950">${escSub(r.part_no || '-')}</td>
                <td class="py-1.5 px-2 text-center font-bold text-slate-600">${escSub(r.maker)}</td>
                <td class="py-1.5 px-2.5 font-mono text-slate-600">${escSub(r.po_no || '-')}</td>
                <td class="py-1.5 px-2.5 text-right font-mono font-black text-amber-800 whitespace-nowrap">${(r.qty || 0).toLocaleString()}</td>
                <td class="py-1.5 px-2.5 text-right font-mono text-slate-700 whitespace-nowrap">₩${Math.round(r.out_up || 0).toLocaleString()}</td>
                <td class="py-1.5 px-2.5 text-right font-mono font-black text-slate-900 whitespace-nowrap">₩${Math.round(r.out_amt || 0).toLocaleString()}</td>
                <td class="py-1.5 px-2 text-center font-bold text-indigo-900 whitespace-nowrap">
                  <div class="inline-flex items-center gap-1">
                    <span>${escSub(r.sales || '-')}</span>
                    ${r.is_web ? `<button type="button" onclick="window.openSubLedgerCrudModalByIdx('rma', ${i})" class="px-1 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded text-[9px] cursor-pointer" title="수정">✏️</button><button type="button" onclick="window.deleteSubLedgerRecord('rma', '${escSub(r.id)}')" class="px-1 py-0.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded text-[9px] cursor-pointer" title="삭제">🗑️</button>` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } else {
    bodyHtml = `
      <div class="block md:hidden space-y-2 max-h-[62vh] overflow-y-auto">
        ${items.map((l, i) => `
          <div class="bg-white rounded-xl border border-rose-200 p-3 shadow-2xs space-y-1.5 text-xs">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] font-mono text-slate-400">#${i + 1}</span>
                <span class="text-[10px] font-mono font-bold bg-rose-50 text-rose-800 px-1.5 py-0.5 rounded">${escSub(l.date || '-')}</span>
                <span class="text-[10px] font-mono text-slate-500">${escSub(l.loss_no || '')}</span>
              </div>
              <span class="font-mono font-black text-rose-700">${(l.qty || 0).toLocaleString()} EA</span>
            </div>
            <div class="font-black text-indigo-950 font-mono truncate">${escSub(l.part_no || '-')}</div>
            <div class="flex items-center justify-between text-[11px]">
              <span class="font-semibold text-slate-600">${escSub(l.maker)} · ${escSub(l.result)}</span>
              <span class="font-mono font-black text-rose-700">₩${Math.round(l.np_amt || 0).toLocaleString()}</span>
            </div>
            ${l.remark ? `<div class="text-[10px] text-slate-500 pt-1 border-t border-slate-100">${escSub(l.remark)}</div>` : ''}
          </div>
        `).join('')}
      </div>
      <div class="hidden md:block overflow-x-auto max-h-[62vh] overflow-y-auto border border-slate-200 rounded-xl">
        <table class="w-full text-left text-xs border-collapse">
          <thead class="bg-rose-50 text-rose-950 font-bold text-[11px] border-b border-rose-200 sticky top-0 z-10">
            <tr>
              <th class="py-2 px-2.5 text-center w-10">#</th>
              <th class="py-2 px-2.5 text-center w-24">처리일자</th>
              <th class="py-2 px-2.5 text-left w-28">손실번호</th>
              <th class="py-2 px-2.5 text-left min-w-[160px]">품번 (Part#)</th>
              <th class="py-2 px-2 text-center w-20">제조사</th>
              <th class="py-2 px-2.5 text-right w-20">수량</th>
              <th class="py-2 px-2.5 text-right w-24">단가</th>
              <th class="py-2 px-2.5 text-right w-28">손실금액</th>
              <th class="py-2 px-2 text-center w-20">구분</th>
              <th class="py-2 px-2.5 text-left min-w-[150px]">비고 / 사유</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 bg-white text-[11px]">
            ${items.map((l, i) => `
              <tr class="hover:bg-rose-50/40 ${l.is_web ? 'bg-emerald-50/25' : ''}">
                <td class="py-1.5 px-2.5 text-center font-mono text-slate-400">${l.is_web ? `<span class="px-1 py-0.2 rounded text-[9px] font-black bg-emerald-100 text-emerald-700">WEB</span>` : (i + 1)}</td>
                <td class="py-1.5 px-2.5 text-center font-mono text-slate-700 whitespace-nowrap">${escSub(l.date || '-')}</td>
                <td class="py-1.5 px-2.5 font-mono font-bold text-slate-700 whitespace-nowrap">${escSub(l.loss_no || '-')}</td>
                <td class="py-1.5 px-2.5 font-mono font-black text-indigo-950">${escSub(l.part_no || '-')}</td>
                <td class="py-1.5 px-2 text-center font-bold text-slate-600">${escSub(l.maker)}</td>
                <td class="py-1.5 px-2.5 text-right font-mono font-black text-rose-700 whitespace-nowrap">${(l.qty || 0).toLocaleString()}</td>
                <td class="py-1.5 px-2.5 text-right font-mono text-slate-600 whitespace-nowrap">₩${Math.round(l.np || 0).toLocaleString()}</td>
                <td class="py-1.5 px-2.5 text-right font-mono font-black text-rose-700 whitespace-nowrap">₩${Math.round(l.np_amt || 0).toLocaleString()}</td>
                <td class="py-1.5 px-2 text-center whitespace-nowrap"><span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">${escSub(l.result)}</span></td>
                <td class="py-1.5 px-2.5 text-slate-500 max-w-[220px]" title="${escSub(l.remark)}">
                  <div class="flex items-center justify-between gap-1.5">
                    <span class="truncate">${escSub(l.remark || '-')}</span>
                    ${l.is_web ? `<div class="flex items-center gap-1 shrink-0"><button type="button" onclick="window.openSubLedgerCrudModalByIdx('loss', ${i})" class="px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded text-[10px] font-bold cursor-pointer" title="수정">✏️</button><button type="button" onclick="window.deleteSubLedgerRecord('loss', '${escSub(l.id)}')" class="px-1.5 py-0.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded text-[10px] font-bold cursor-pointer" title="삭제">🗑️</button></div>` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  return `
    <div class="space-y-3">
      <div class="bg-slate-50 p-3 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="px-2.5 py-1 rounded-lg border font-black text-[11px] ${meta.badge}">${meta.title}</span>
          <span class="text-slate-600 font-bold">총 <strong class="text-slate-900 font-mono">${items.length.toLocaleString()}</strong>건 · 합계 수량 <strong class="text-indigo-700 font-mono">${totalQty.toLocaleString()}</strong> EA${totalAmt > 0 ? ` · 합계 금액 <strong class="text-rose-700 font-mono">₩${Math.round(totalAmt).toLocaleString()}</strong>` : ''}</span>
        </div>
        <div class="flex items-center gap-1.5 w-full sm:w-auto">
          <input type="text" id="subLedgerSearchInput" value="${escSub(subLedgerQuery)}" placeholder="품번, 고객사, 제조사, 비고 검색..." class="flex-1 sm:w-64 px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs outline-none focus:border-indigo-500">
          <button type="button" id="btnSubLedgerSearch" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-lg cursor-pointer whitespace-nowrap">🔍 검색</button>
        </div>
      </div>
      ${bodyHtml}
    </div>
  `;
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
    await Promise.all([fetchLedgerShipments(), fetchWebShipments()]);
    renderShipmentsView('shipmentsSection');
  });

  const switchSubMode = async (mode) => {
    if (activeShipmentMode === mode) return;
    activeShipmentMode = mode;
    subLedgerQuery = '';
    renderShipmentsView('shipmentsSection');
    await fetchSubLedgerData(mode, '');
    renderShipmentsView('shipmentsSection');
  };
  document.getElementById("btnModeBorrow")?.addEventListener("click", () => switchSubMode('borrow'));
  document.getElementById("btnModeRma")?.addEventListener("click", () => switchSubMode('rma'));
  document.getElementById("btnModeLoss")?.addEventListener("click", () => switchSubMode('loss'));

  const subInput = document.getElementById("subLedgerSearchInput");
  const subBtn = document.getElementById("btnSubLedgerSearch");
  const runSubSearch = async () => {
    subLedgerQuery = subInput?.value.trim() || '';
    await fetchSubLedgerData(activeShipmentMode, subLedgerQuery);
    renderShipmentsView('shipmentsSection');
  };
  subBtn?.addEventListener("click", runSubSearch);
  subInput?.addEventListener("keydown", (e) => {
    if (e.key === 'Enter') runSubSearch();
  });

  const selectBizType = document.getElementById("shipmentBizTypeSelect");
  const selectCommStatus = document.getElementById("shipmentCommStatusSelect");

  // 검색 버튼 클릭
  btnSearch?.addEventListener("click", async () => {
    const startDate = inputStart?.value || '';
    const endDate = inputEnd?.value || '';
    const mfg = selectMfg?.value || '';
    const supply = selectSupply?.value || '';
    const bizType = selectBizType?.value || '';
    const commStatus = selectCommStatus?.value || '';
    const query = liveFilter?.value || '';

    btnSearch.disabled = true;
    btnSearch.innerHTML = `<span>⏳</span> 조회중...`;

    await Promise.all([
      fetchLedgerShipments({ startDate, endDate, mfg, supply, bizType, commStatus, query }),
      fetchWebShipments()
    ]);
    renderShipmentsView('shipmentsSection');
  });

  // 드롭다운 변경 시 즉시 검색
  selectMfg?.addEventListener("change", () => btnSearch?.click());
  selectSupply?.addEventListener("change", () => btnSearch?.click());
  selectBizType?.addEventListener("change", () => btnSearch?.click());
  selectCommStatus?.addEventListener("change", () => btnSearch?.click());

  // Enter 키 검색
  inputStart?.addEventListener("keydown", (e) => { if (e.key === "Enter") btnSearch?.click(); });
  inputEnd?.addEventListener("keydown", (e) => { if (e.key === "Enter") btnSearch?.click(); });

  // 실시간 라이브 필터링 (200ms 디바운스)
  const handleLiveFilter = debounce((term) => {
    const raw = getMergedLedgerShipments();
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
  const isMobile = window.innerWidth < 768;
  const tbody = document.getElementById("shipmentTableBody");
  const cardContainer = document.getElementById("shipmentCardContainer");

  if (isMobile) {
    if (cardContainer) cardContainer.innerHTML = generateShipmentMobileCards(paged);
    if (tbody) tbody.innerHTML = '';
  } else {
    if (tbody) tbody.innerHTML = generateTableRows(paged);
    if (cardContainer) cardContainer.innerHTML = '';
  }

  // 단일 순회(O(N))로 합계 지표 계산 (Commission 포함)
  const totalCount = lastFilteredShipments.length;
  let totalQty = 0, totalUsd = 0, totalKrw = 0, totalCommUsd = 0, unpaidCommUsd = 0, commCount = 0;
  for (let i = 0; i < totalCount; i++) {
    const item = lastFilteredShipments[i];
    const amt = Number(item.ship_amt) || 0;
    const cAmt = Number(item.comm_amt) || 0;
    totalQty += Number(item.ship_qty) || 0;
    totalUsd += amt;
    totalKrw += item.total_krw ? item.total_krw : Math.round(amt * currentFxRate);
    if (cAmt > 0) {
      commCount++;
      totalCommUsd += cAmt;
      const isPaid = Boolean((item.bank_dt || '').trim() || (item.comm_dt || '').trim());
      if (!isPaid) unpaidCommUsd += cAmt;
    }
  }

  const elCount = document.getElementById("shipmentSummaryCount");
  const elQty = document.getElementById("shipmentSumQty");
  const elUsd = document.getElementById("shipmentSumUsd");
  const elComm = document.getElementById("shipmentSumComm");
  const elUnpaidComm = document.getElementById("shipmentSumUnpaidComm");
  const elKrw = document.getElementById("shipmentSumKrw");

  if (elCount) elCount.innerText = `${totalCount.toLocaleString()}건 (Comm ${commCount.toLocaleString()})`;
  if (elQty) elQty.innerText = `${totalQty.toLocaleString()} EA`;
  if (elUsd) elUsd.innerText = `$${totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (elComm) elComm.innerText = `$${totalCommUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (elUnpaidComm) elUnpaidComm.innerText = `$${unpaidCommUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
        <td colspan="14" class="py-12 text-center text-slate-400 font-bold bg-white">
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
    const commAmt = Number(item.comm_amt) || 0;
    const commRate = Number(item.comm_rate) || 0;
    const isComm = commAmt > 0 || item.biz_type === 'COMMISSION';
    const isDom = !isComm && (item.biz_type === 'DOMESTIC' || item.ship_result === 'IN');
    const bizBadge = item.is_web
      ? `<span class="inline-block px-1.5 py-0.5 rounded text-[9px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">WEB</span>`
      : isComm
        ? `<span class="inline-block px-1.5 py-0.5 rounded text-[9px] font-black bg-violet-100 text-violet-800 border border-violet-200">💎 COMM</span>`
        : isDom
          ? `<span class="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-sky-50 text-sky-700 border border-sky-200">🏢 DOM</span>`
          : `<span class="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-600">DIRECT</span>`;

    const bankDt = (item.bank_dt || '').trim();
    const commDt = (item.comm_dt || '').trim();
    const commStatusHtml = isComm
      ? (bankDt
          ? `<span class="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200" title="은행입금: ${bankDt}">✅ 입금완료</span><div class="text-[9px] font-mono text-emerald-600 mt-0.5">${bankDt}</div>`
          : commDt
            ? `<span class="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-200" title="정산기준: ${commDt}">📋 정산완료</span><div class="text-[9px] font-mono text-blue-600 mt-0.5">${commDt}</div>`
            : `<span class="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-50 text-rose-700 border border-rose-200">⏳ 미입금</span>`)
      : `<span class="text-slate-300">-</span>`;

    return `
      <tr class="hover:bg-slate-50 transition-colors text-[11px] group ${isComm ? 'bg-violet-50/15' : ''}">
        <td class="py-2 px-1.5 text-center font-mono text-slate-400 whitespace-nowrap">${rowNum}</td>

        <!-- 거래구분 (COMM / DOM) -->
        <td class="py-2 px-2 text-center whitespace-nowrap">${bizBadge}</td>
        
        <!-- CUSTOMER -->
        <td class="py-2 px-2 font-bold text-slate-900 truncate max-w-[140px]" title="${item.customer || '-'}">
          ${item.customer || '-'}
        </td>

        <!-- REALCUST -->
        <td class="py-2 px-2 font-semibold text-indigo-900 truncate max-w-[120px]" title="${item.real_cust || '-'}">
          ${item.real_cust ? `<span class="inline-block bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[10px] font-bold">${item.real_cust}</span>` : '-'}
        </td>

        <!-- PONO -->
        <td class="py-2 px-2 font-mono text-slate-600 text-[10px] truncate max-w-[140px]" title="${item.po_no || '-'}">
          ${item.po_no || '-'}
        </td>

        <!-- PARTNO + [이력] 버튼 -->
        <td class="py-2 px-2">
          <div class="flex items-center gap-1.5">
            <span class="font-bold text-slate-900 font-mono truncate max-w-[165px]" title="${cleanPart}">${cleanPart}</span>
            <button type="button" onclick="window.openPriceHistoryModal && window.openPriceHistoryModal('${cleanPart}')" 
                    class="px-1.5 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded text-[9px] font-bold cursor-pointer transition shrink-0" title="과거 매입·판매 단가 이력 조회">
              📈 이력
            </button>
          </div>
        </td>

        <!-- SHIP_DATE -->
        <td class="py-2 px-2 text-center font-mono text-slate-600 whitespace-nowrap">${item.ship_date || '-'}</td>

        <!-- SHIP_QTY -->
        <td class="py-2 px-2 text-right font-black text-slate-900 whitespace-nowrap font-mono">
          ${(Number(item.ship_qty) || 0).toLocaleString()} EA
        </td>

        <!-- NET_UP ($) -->
        <td class="py-2 px-2 text-right font-mono font-bold text-blue-700 whitespace-nowrap">
          $${(Number(item.net_up) || 0).toFixed(4)}
        </td>

        <!-- SHIP_AMT ($) -->
        <td class="py-2 px-2 text-right font-mono font-black text-slate-900 whitespace-nowrap">
          $${(Number(item.ship_amt) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </td>

        <!-- 💎 COMM ($ / %) -->
        <td class="py-2 px-2 text-right font-mono whitespace-nowrap">
          ${isComm
            ? `<div class="font-black text-violet-700">$${commAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div class="text-[9px] text-violet-500 font-bold">${commRate.toFixed(2)}%</div>`
            : `<span class="text-slate-300">-</span>`}
        </td>

        <!-- 커미션 정산상태 -->
        <td class="py-2 px-2 text-center whitespace-nowrap">${commStatusHtml}</td>

        <!-- 영업담당 -->
        <td class="py-2 px-2 text-center font-bold text-indigo-900 text-[10px] whitespace-nowrap">
          ${toEnglishSalesName(item.sales_rep || '') || '-'}
        </td>

        <!-- 문서 / 관리 -->
        <td class="py-2 px-3 text-center whitespace-nowrap no-print" onclick="event.stopPropagation()">
          <div class="inline-flex items-center gap-1">
            ${(item.awb_no || item.tracking_no) ? `
              <button type="button" onclick="window.openTrackingModal && window.openTrackingModal('${escSub(item.awb_no || item.tracking_no)}')" 
                      class="px-1.5 py-0.5 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded border border-sky-200 text-[10px] font-bold transition-colors cursor-pointer" title="송장/AWB 실시간 배송 추적 (${escSub(item.awb_no || item.tracking_no)})">
                🚚 추적
              </button>
            ` : ''}
            <button type="button" onclick="window.openTradeInvoice && window.openTradeInvoice(window.getShipmentByIndex(${idx}))" 
                    class="px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded border border-indigo-200 text-[10px] font-bold transition-colors cursor-pointer" title="공식 거래명세서 출력">
              📄 명세서
            </button>
            <button type="button" onclick="window.openTradePacking && window.openTradePacking(window.getShipmentByIndex(${idx}))" 
                    class="px-2 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded border border-amber-300 text-[10px] font-bold transition-colors cursor-pointer" title="공식 패킹리스트 출력">
              📦 패킹
            </button>
            ${(item.is_web && item.id && typeof window.isCsOrAdminUser === 'function' && window.isCsOrAdminUser()) ? `
              <button type="button" onclick="window.openShipmentCrudModal && window.openShipmentCrudModal(window.getShipmentByIndex(${idx}))" 
                      class="px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded border border-blue-200 text-[10px] font-bold cursor-pointer" title="웹 출하 내역 수정">✏️</button>
              <button type="button" onclick="window.deleteWebShipmentByIndex && window.deleteWebShipmentByIndex(${idx})" 
                      class="px-1.5 py-0.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded border border-rose-200 text-[10px] font-bold cursor-pointer" title="웹 출하 내역 삭제">🗑️</button>
            ` : ''}
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
    const commAmt = Number(item.comm_amt) || 0;
    const commRate = Number(item.comm_rate) || 0;
    const isComm = commAmt > 0 || item.biz_type === 'COMMISSION';
    const bankDt = (item.bank_dt || '').trim();
    const commDt = (item.comm_dt || '').trim();
    const commBadge = item.is_web
      ? `<span class="text-[9px] font-black text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded border border-emerald-300">WEB</span>`
      : isComm
        ? `<span class="text-[9px] font-black text-violet-800 bg-violet-100 px-1.5 py-0.5 rounded border border-violet-200">💎 COMM ${commRate.toFixed(1)}%</span>`
        : `<span class="text-[9px] font-bold text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded border border-sky-200">🏢 DOM</span>`;
    return `
      <div class="p-3.5 bg-white rounded-xl border ${isComm ? 'border-violet-200' : 'border-slate-200'} shadow-xs space-y-2.5">
        <div class="flex items-start justify-between gap-1.5">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              ${commBadge}
              <span class="text-[9px] font-mono font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">${item.ship_date || '-'}</span>
              <span class="text-[9px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">${item.maker || '-'}</span>
              ${item.sales_rep ? `<span class="text-[9px] font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">${toEnglishSalesName(item.sales_rep)}</span>` : ''}
            </div>
            <h4 class="font-black text-xs text-slate-900 mt-1 truncate" title="${cleanPart}">
              ${cleanPart}
            </h4>
            <div class="text-[10px] text-slate-500 font-bold truncate mt-0.5">${item.customer || '-'}${item.real_cust ? ` · ${item.real_cust}` : ''}</div>
          </div>
          <div class="text-right shrink-0">
            <span class="text-[9px] text-slate-400 block font-semibold">출하금액(USD)</span>
            <span class="font-black text-slate-900 font-mono text-sm">$${(Number(item.ship_amt) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            ${isComm
              ? `<div class="text-[10px] text-violet-700 font-black font-mono">💎 $${commAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${bankDt ? '✅' : (commDt ? '📋' : '⏳')}</div>`
              : `<div class="text-[10px] text-rose-600 font-bold font-mono">₩${Math.round((Number(item.ship_amt) || 0) * currentFxRate).toLocaleString()}</div>`}
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
          <div class="flex items-center gap-1 flex-wrap justify-end">
            <button type="button" onclick="window.openTradeInvoice && window.openTradeInvoice(window.getShipmentByIndex(${idx}))" 
                    class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-bold transition cursor-pointer">
              📄 명세서
            </button>
            <button type="button" onclick="window.openTradePacking && window.openTradePacking(window.getShipmentByIndex(${idx}))" 
                    class="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded border border-amber-300 text-[10px] font-bold transition cursor-pointer">
              📦 패킹
            </button>
            ${(item.is_web && item.id && typeof window.isCsOrAdminUser === 'function' && window.isCsOrAdminUser()) ? `
              <button type="button" onclick="window.openShipmentCrudModal && window.openShipmentCrudModal(window.getShipmentByIndex(${idx}))" 
                      class="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded border border-blue-200 text-[10px] font-bold cursor-pointer">✏️</button>
              <button type="button" onclick="window.deleteWebShipmentByIndex && window.deleteWebShipmentByIndex(${idx})" 
                      class="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded border border-rose-200 text-[10px] font-bold cursor-pointer">🗑️</button>
            ` : ''}
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
    "구분(BIZ_TYPE)",
    "CUSTOMER(계약처)",
    "REALCUST(실수요처)",
    "PONO(발주번호)",
    "PARTNO(품번)",
    "SHIP_DATE(출하일자)",
    "SHIP_QTY(수량)",
    "NET_UP_USD(순단가)",
    "SHIP_AMT_USD(출하금액)",
    "COMM_RATE(%)",
    "COMM_AMT_USD(커미션)",
    "COMM_STATUS(정산상태)",
    "COMM_DT(정산일)",
    "BANK_DT(입금일)",
    "SALES(영업담당)",
    "SHIP_AMT_KRW(원화환산)",
    "APP(용도)",
    "MFG(제조사)",
    "SUPPLY(공급사)",
    "INVOICENO(인보이스번호)"
  ];

  const rows = items.map((item, idx) => [
    idx + 1,
    `"${(item.biz_type || ((Number(item.comm_amt) || 0) > 0 ? 'COMMISSION' : 'DOMESTIC'))}"`,
    `"${(item.customer || '').replace(/"/g, '""')}"`,
    `"${(item.real_cust || '').replace(/"/g, '""')}"`,
    `"${(item.po_no || '').replace(/"/g, '""')}"`,
    `"${(item.part_no || '').replace(/"/g, '""')}"`,
    `"${item.ship_date || ''}"`,
    Number(item.ship_qty) || 0,
    (Number(item.net_up) || 0).toFixed(4),
    (Number(item.ship_amt) || 0).toFixed(4),
    (Number(item.comm_rate) || 0).toFixed(2),
    (Number(item.comm_amt) || 0).toFixed(2),
    `"${(item.comm_status || '').replace(/"/g, '""')}"`,
    `"${(item.comm_dt || '').replace(/"/g, '""')}"`,
    `"${(item.bank_dt || '').replace(/"/g, '""')}"`,
    `"${(toEnglishSalesName(item.sales_rep || '') || '').replace(/"/g, '""')}"`,
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
      const custName = (payload.customer || origItem?.customer || '').replace(/\|\|/g, ' ').trim();
      const realCust = (payload.real_customer || payload.realCustomer || origItem?.real_customer || origItem?.realCustomer || '').replace(/\|\|/g, ' ').trim();
      const appStr = (payload.application || origItem?.application || '').replace(/\|\|/g, ' ').trim();
      const encodedStatus = (custName || realCust || appStr) ? `SHIPPED||${custName}||${realCust}||${appStr}` : 'SHIPPED';

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
        status: encodedStatus,
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

      // 💰 출하완료 시 미수(미결제) 상태인 경우 미수금(legacy_unpaid)에도 자동 연동 (중복 방지)
      const payStatus = String(payload.payment_status || payload.paymentStatus || origItem?.payment_status || '미수').trim();
      if (payStatus !== '완료' && payStatus !== '수금완료' && totalSales > 0) {
        try {
          const { data: exUnpaid } = await sbClient
            .from('legacy_unpaid')
            .select('id')
            .eq('po_no', poNo)
            .eq('part_name', partName)
            .eq('out_date', shipDate)
            .limit(1);

          if (!exUnpaid || exUnpaid.length === 0) {
            const dueDt = payload.due_date || payload.dueDate || origItem?.due_date || '';
            await fetch('/api/unpaid', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                customer_name: custName || '웹 수주 거래처',
                out_date: shipDate,
                po_no: poNo,
                part_name: partName,
                maker: maker,
                qty: shipQty,
                amount_vat: Math.round(totalSales * 1.1),
                due_date: dueDt || undefined,
                sales_rep: payload.owner || origItem?.owner || 'BSK',
                contact: `[수주 출하 자동연동]`,
                pay_status: '미결제'
              })
            });
            console.log(`✅ [legacy_unpaid] 출하완료 미수금 자동 등록 완료: ${partName} (${poNo})`);
          }
        } catch (unpaidErr) {
          console.warn('⚠️ [legacy_unpaid] 미수금 자동 연동 경고:', unpaidErr);
        }
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

// ========================================================
// ✏️ 웹 출하 원장 직접 등록 · 수정 · 삭제 (CRUD Modal)
// ========================================================
let editingShipmentId = null;

export function openShipmentCrudModal(item = null) {
  if (typeof window.isCsOrAdminUser === 'function' && !window.isCsOrAdminUser()) {
    alert('출하 내역 등록·수정은 CS 및 관리자 권한만 가능합니다.');
    return;
  }
  editingShipmentId = item ? (item.id || null) : null;

  const modalId = 'shipmentCrudModal';
  let modal = document.getElementById(modalId);
  if (!modal) {
    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[99995] flex items-center justify-center p-3 overflow-y-auto';
    modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
    document.body.appendChild(modal);
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const esc = (v) => String(v ?? '').replace(/"/g, '&quot;');

  modal.innerHTML = `
    <div class="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto" onclick="event.stopPropagation()">
      <div class="bg-gradient-to-r from-indigo-700 to-blue-700 text-white px-5 py-3.5 flex items-center justify-between">
        <h3 class="text-sm font-black">${editingShipmentId ? '✏️ 웹 출하 내역 수정' : '➕ 신규 출하 내역 직접 등록'}</h3>
        <button type="button" onclick="document.getElementById('${modalId}').classList.add('hidden')" class="text-white/80 hover:text-white font-bold cursor-pointer">✕</button>
      </div>
      <div class="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">계약처 (CUSTOMER) *</label>
          <input type="text" id="shipCrudCustomer" value="${esc(item?.customer === '웹 수주 거래처' ? '' : item?.customer)}" placeholder="예: LG이노텍" class="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-500">
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">실수요처 (REALCUST)</label>
          <input type="text" id="shipCrudRealCust" value="${esc(item?.real_cust === '-' ? '' : item?.real_cust)}" placeholder="실수요처명" class="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-500">
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">품번 (PARTNO) *</label>
          <input type="text" id="shipCrudPart" value="${esc(item?.part_no)}" placeholder="예: IS25LP128F-JBLE-TR" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold outline-none focus:border-indigo-500">
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">제조사 (MFG)</label>
          <input type="text" id="shipCrudMaker" value="${esc(item?.maker || 'ISSI')}" placeholder="ISSI, ESMT, SMI..." class="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-500">
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">발주번호 (PONO)</label>
          <input type="text" id="shipCrudPoNo" value="${esc(item?.po_no)}" placeholder="PO 번호" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono outline-none focus:border-indigo-500">
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">출하일자 (SHIP_DATE) *</label>
          <input type="date" id="shipCrudDate" value="${esc(item?.ship_date && item.ship_date !== '-' ? item.ship_date.slice(0,10) : todayStr)}" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono outline-none focus:border-indigo-500">
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">출하수량 (EA) *</label>
          <input type="number" id="shipCrudQty" value="${Number(item?.ship_qty || 1000)}" min="1" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold outline-none focus:border-indigo-500">
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">외화 판매단가 (NET_UP, USD)</label>
          <input type="number" step="0.0001" id="shipCrudNetUp" value="${Number(item?.net_up || 0).toFixed(4)}" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold text-blue-700 outline-none focus:border-indigo-500">
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">원화 판매단가 (KRW, 선택)</label>
          <input type="number" id="shipCrudUnitKrw" value="${Math.round(Number(item?.unit_krw || 0))}" placeholder="USD 입력 시 자동환산" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono outline-none focus:border-indigo-500">
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">용도 (APP)</label>
          <input type="text" id="shipCrudApp" value="${esc(item?.app === '-' ? '' : item?.app)}" placeholder="예: AU04 : REAR CAMERA" class="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-500">
        </div>
        ${!editingShipmentId ? `
          <div class="sm:col-span-2 bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-center gap-2">
            <input type="checkbox" id="shipCrudCreateUnpaid" checked class="rounded cursor-pointer">
            <label for="shipCrudCreateUnpaid" class="text-[11px] font-bold text-amber-900 cursor-pointer">미수금 관리 탭에도 자동으로 미결제 채권(VAT 포함, 30일 만기) 등록하기</label>
          </div>
        ` : ''}
      </div>
      <div class="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
        <button type="button" onclick="document.getElementById('${modalId}').classList.add('hidden')" class="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-lg cursor-pointer">취소</button>
        <button type="button" id="btnSaveShipmentCrud" class="px-5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-lg shadow-xs cursor-pointer">💾 저장</button>
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
  document.getElementById('btnSaveShipmentCrud')?.addEventListener('click', saveShipmentCrudForm);
}

async function saveShipmentCrudForm() {
  const part_name = document.getElementById('shipCrudPart')?.value.trim() || '';
  if (!part_name) return alert('품번(PARTNO)을 입력해 주세요.');

  const unitKrwVal = parseFloat(document.getElementById('shipCrudUnitKrw')?.value || '0') || 0;
  const netUpVal = parseFloat(document.getElementById('shipCrudNetUp')?.value || '0') || 0;

  const payload = {
    customer_name: document.getElementById('shipCrudCustomer')?.value.trim() || '웹 출하 거래처',
    real_cust: document.getElementById('shipCrudRealCust')?.value.trim() || '',
    part_name,
    maker: document.getElementById('shipCrudMaker')?.value.trim() || 'OTHERS',
    po_no: document.getElementById('shipCrudPoNo')?.value.trim() || 'WEB-SHIP',
    order_date: document.getElementById('shipCrudDate')?.value || new Date().toISOString().slice(0, 10),
    qty: parseInt(document.getElementById('shipCrudQty')?.value || '1', 10) || 1,
    unit_usd: netUpVal > 0 ? netUpVal : null,
    unit_price: unitKrwVal > 0 ? unitKrwVal : 0,
    fx_rate: currentFxRate || 1350,
    app: document.getElementById('shipCrudApp')?.value.trim() || '',
    create_unpaid: !!document.getElementById('shipCrudCreateUnpaid')?.checked
  };

  const btn = document.getElementById('btnSaveShipmentCrud');
  if (btn) { btn.disabled = true; btn.innerText = '⏳ 저장 중...'; }

  try {
    const url = editingShipmentId ? `/api/shipments/${encodeURIComponent(editingShipmentId)}` : '/api/shipments';
    const method = editingShipmentId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || data.status !== 'success') throw new Error(data.detail || data.message || '저장 실패');

    document.getElementById('shipmentCrudModal')?.classList.add('hidden');
    alert(editingShipmentId ? '✅ 출하 내역이 수정되었습니다.' : '✅ 신규 출하 내역이 등록되었습니다. (출하 원장 상단에 WEB 배지로 표시됩니다)');

    activeShipmentMode = 'ledger';
    await fetchWebShipments();
    lastFilteredShipments = getMergedLedgerShipments();
    shipmentPage = 1;
    renderShipmentsView('shipmentsSection');
  } catch (err) {
    alert('출하 저장 오류: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = '💾 저장'; }
  }
}

export async function deleteWebShipmentByIndex(idx) {
  if (typeof window.isCsOrAdminUser === 'function' && !window.isCsOrAdminUser()) {
    alert('출하 내역 삭제는 CS 및 관리자 권한만 가능합니다.');
    return;
  }
  const item = window.getShipmentByIndex(idx);
  if (!item || !item.id) return alert('삭제할 수 있는 웹 출하 항목이 아닙니다.');
  if (!confirm(`[${item.customer}] ${item.part_no} (${Number(item.ship_qty).toLocaleString()} EA)\n\n이 웹 출하 내역을 삭제하시겠습니까?`)) return;

  try {
    const res = await fetch(`/api/shipments/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || data.status !== 'success') throw new Error(data.detail || '삭제 실패');
    alert('🗑️ 웹 출하 내역이 삭제되었습니다.');
    await fetchWebShipments();
    lastFilteredShipments = getMergedLedgerShipments();
    renderShipmentsView('shipmentsSection');
  } catch (err) {
    alert('출하 삭제 오류: ' + err.message);
  }
}

window.openShipmentCrudModal = openShipmentCrudModal;
window.deleteWebShipmentByIndex = deleteWebShipmentByIndex;

// ========================================================
// 🔄 대여/반납 · ↩️ 반품 RMA · ⚠️ 손실/폐기 Cloud CRUD 모달
// ========================================================
const SUB_LEDGER_META = {
  borrow: {
    label: '대여 / 반납',
    icon: '🔄',
    endpoint: '/api/shipped-info/borrows',
    headerCls: 'from-teal-900 via-teal-800 to-slate-900',
    btnCls: 'bg-teal-600 hover:bg-teal-500 text-white'
  },
  rma: {
    label: '반품 (RMA)',
    icon: '↩️',
    endpoint: '/api/shipped-info/rmas',
    headerCls: 'from-amber-900 via-amber-800 to-slate-900',
    btnCls: 'bg-amber-500 hover:bg-amber-400 text-slate-950'
  },
  loss: {
    label: '손실 / 폐기',
    icon: '⚠️',
    endpoint: '/api/shipped-info/losses',
    headerCls: 'from-rose-900 via-rose-800 to-slate-900',
    btnCls: 'bg-rose-600 hover:bg-rose-500 text-white'
  }
};

export function openSubLedgerCrudModal(kind = 'borrow', item = null) {
  const cfg = SUB_LEDGER_META[kind] || SUB_LEDGER_META.borrow;
  const isEdit = Boolean(item && item.id);
  const today = new Date().toISOString().slice(0, 10);

  let modal = document.getElementById('subLedgerCrudModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'subLedgerCrudModal';
    modal.className = 'fixed inset-0 bg-slate-900/70 backdrop-blur-xs z-[99996] flex items-center justify-center p-3 overflow-y-auto';
    modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
    document.body.appendChild(modal);
  }

  const fieldsHtml = kind === 'borrow' ? `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
      <div>
        <label class="block font-bold text-slate-600 mb-1">출고 / 대여일 *</label>
        <input type="date" id="slDate" value="${escSub(item?.date || today)}" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono">
      </div>
      <div>
        <label class="block font-bold text-slate-600 mb-1">구분 / 상태</label>
        <div class="grid grid-cols-2 gap-1.5">
          <select id="slGubun" class="px-2.5 py-2 border border-slate-300 rounded-lg font-bold bg-white">
            <option value="대여" ${(item?.gubun || '대여') === '대여' ? 'selected' : ''}>대여</option>
            <option value="반납" ${item?.gubun === '반납' ? 'selected' : ''}>반납</option>
            <option value="샘플대여" ${item?.gubun === '샘플대여' ? 'selected' : ''}>샘플대여</option>
          </select>
          <select id="slResult" class="px-2.5 py-2 border border-slate-300 rounded-lg font-bold bg-white">
            <option value="대여중" ${(item?.result || '대여중') === '대여중' ? 'selected' : ''}>대여중</option>
            <option value="반납완료" ${item?.result === '반납완료' ? 'selected' : ''}>반납완료</option>
            <option value="판매전환" ${item?.result === '판매전환' ? 'selected' : ''}>판매전환</option>
          </select>
        </div>
      </div>
      <div>
        <label class="block font-bold text-slate-600 mb-1">고객사명 *</label>
        <input type="text" id="slCustomer" value="${escSub(item?.customer_name || '')}" placeholder="예: LG Display, 현대모비스" class="w-full px-3 py-2 border border-slate-300 rounded-lg">
      </div>
      <div>
        <label class="block font-bold text-slate-600 mb-1">품번 (Part#) *</label>
        <input type="text" id="slPartNo" value="${escSub(item?.part_no || '')}" placeholder="예: IS25LP064A-JBLE" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold">
      </div>
      <div>
        <label class="block font-bold text-slate-600 mb-1">제조사 (Maker)</label>
        <input type="text" id="slMaker" value="${escSub(item?.maker || '')}" placeholder="예: ISSI, ESMT, Giantec" class="w-full px-3 py-2 border border-slate-300 rounded-lg">
      </div>
      <div>
        <label class="block font-bold text-slate-600 mb-1">수량 (EA) *</label>
        <input type="number" id="slQty" value="${Number(item?.qty) || 0}" min="0" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold">
      </div>
      <div>
        <label class="block font-bold text-slate-600 mb-1">반납 예정/완료일</label>
        <input type="date" id="slRtnDate" value="${escSub(item?.rtn_date || '')}" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono">
      </div>
      <div>
        <label class="block font-bold text-slate-600 mb-1">영업 담당자 (영문)</label>
        <input type="text" id="slSales" value="${escSub(toEnglishSalesName(item?.sales || ''))}" placeholder="예: STEVE, KELLY, DUSTIN" class="w-full px-3 py-2 border border-slate-300 rounded-lg uppercase font-bold">
      </div>
      <div class="sm:col-span-2">
        <label class="block font-bold text-slate-600 mb-1">비고 / 운송장 번호</label>
        <input type="text" id="slRemark" value="${escSub(item?.remark || '')}" placeholder="예: 로젠 45370526250 / 테스트 샘플 대여" class="w-full px-3 py-2 border border-slate-300 rounded-lg">
      </div>
    </div>
  ` : kind === 'rma' ? `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
      <div>
        <label class="block font-bold text-slate-600 mb-1">반품 일자 *</label>
        <input type="date" id="slDate" value="${escSub(item?.date || today)}" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono">
      </div>
      <div>
        <label class="block font-bold text-slate-600 mb-1">고객사명 *</label>
        <input type="text" id="slCustomer" value="${escSub(item?.customer_name || '')}" placeholder="고객사명 입력" class="w-full px-3 py-2 border border-slate-300 rounded-lg">
      </div>
      <div>
        <label class="block font-bold text-slate-600 mb-1">품번 (Part#) *</label>
        <input type="text" id="slPartNo" value="${escSub(item?.part_no || '')}" placeholder="품번 입력" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold">
      </div>
      <div>
        <label class="block font-bold text-slate-600 mb-1">제조사 (Maker)</label>
        <input type="text" id="slMaker" value="${escSub(item?.maker || '')}" placeholder="예: ISSI, ESMT" class="w-full px-3 py-2 border border-slate-300 rounded-lg">
      </div>
      <div>
        <label class="block font-bold text-slate-600 mb-1">PO 번호</label>
        <input type="text" id="slPoNo" value="${escSub(item?.po_no || '')}" placeholder="원 발주번호 (선택)" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono">
      </div>
      <div>
        <label class="block font-bold text-slate-600 mb-1">반품 수량 (EA) *</label>
        <input type="number" id="slQty" value="${Number(item?.qty) || 0}" min="0" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold">
      </div>
      <div>
        <label class="block font-bold text-slate-600 mb-1">판매 단가 (₩)</label>
        <input type="number" id="slUnitPrice" value="${Number(item?.out_up) || 0}" step="any" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono">
      </div>
      <div>
        <label class="block font-bold text-slate-600 mb-1">반품 금액 (₩ · 자동계산)</label>
        <input type="number" id="slTotalAmt" value="${Number(item?.out_amt) || 0}" step="any" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold bg-amber-50/40">
      </div>
      <div>
        <label class="block font-bold text-slate-600 mb-1">영업 담당자 (영문)</label>
        <input type="text" id="slSales" value="${escSub(toEnglishSalesName(item?.sales || ''))}" placeholder="예: STEVE, ALLEN" class="w-full px-3 py-2 border border-slate-300 rounded-lg uppercase font-bold">
      </div>
      <div>
        <label class="block font-bold text-slate-600 mb-1">반품 사유 / 비고</label>
        <input type="text" id="slRemark" value="${escSub(item?.remark || '')}" placeholder="예: 불량 반품, 오발주 교환" class="w-full px-3 py-2 border border-slate-300 rounded-lg">
      </div>
    </div>
  ` : `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
      <div>
        <label class="block font-bold text-slate-600 mb-1">처리 일자 *</label>
        <input type="date" id="slDate" value="${escSub(item?.date || today)}" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono">
      </div>
      <div>
        <label class="block font-bold text-slate-600 mb-1">손실 번호</label>
        <input type="text" id="slLossNo" value="${escSub(item?.loss_no || '')}" placeholder="미입력 시 자동 생성" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono">
      </div>
      <div>
        <label class="block font-bold text-slate-600 mb-1">품번 (Part#) *</label>
        <input type="text" id="slPartNo" value="${escSub(item?.part_no || '')}" placeholder="품번 입력" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold">
      </div>
      <div>
        <label class="block font-bold text-slate-600 mb-1">제조사 (Maker)</label>
        <input type="text" id="slMaker" value="${escSub(item?.maker || '')}" placeholder="예: ISSI, ESMT" class="w-full px-3 py-2 border border-slate-300 rounded-lg">
      </div>
      <div>
        <label class="block font-bold text-slate-600 mb-1">손실 수량 (EA) *</label>
        <input type="number" id="slQty" value="${Number(item?.qty) || 0}" min="0" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold">
      </div>
      <div>
        <label class="block font-bold text-slate-600 mb-1">구분</label>
        <select id="slResult" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold bg-white">
          <option value="폐기" ${(item?.result || '폐기') === '폐기' ? 'selected' : ''}>폐기</option>
          <option value="불량" ${item?.result === '불량' ? 'selected' : ''}>불량</option>
          <option value="분실" ${item?.result === '분실' ? 'selected' : ''}>분실</option>
          <option value="재고조정" ${item?.result === '재고조정' ? 'selected' : ''}>재고조정</option>
        </select>
      </div>
      <div>
        <label class="block font-bold text-slate-600 mb-1">단가 (₩)</label>
        <input type="number" id="slUnitPrice" value="${Number(item?.np) || 0}" step="any" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono">
      </div>
      <div>
        <label class="block font-bold text-slate-600 mb-1">손실 금액 (₩ · 자동계산)</label>
        <input type="number" id="slTotalAmt" value="${Number(item?.np_amt) || 0}" step="any" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold bg-rose-50/40">
      </div>
      <div class="sm:col-span-2">
        <label class="block font-bold text-slate-600 mb-1">손실 / 폐기 사유</label>
        <input type="text" id="slRemark" value="${escSub(item?.remark || '')}" placeholder="예: 장기체화 폐기, 습기 손상, 실사 차이 조정" class="w-full px-3 py-2 border border-slate-300 rounded-lg">
      </div>
    </div>
  `;

  modal.innerHTML = `
    <div class="bg-white w-full max-w-xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden" onclick="event.stopPropagation()">
      <div class="bg-gradient-to-r ${cfg.headerCls} text-white px-5 py-3.5 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-lg">${cfg.icon}</span>
          <h3 class="font-black text-sm sm:text-base">${isEdit ? `${cfg.label} 내역 수정` : `신규 ${cfg.label} 등록`}</h3>
        </div>
        <button type="button" onclick="document.getElementById('subLedgerCrudModal').classList.add('hidden')" class="w-7 h-7 rounded-lg bg-white/15 hover:bg-white/25 text-white font-bold cursor-pointer">✕</button>
      </div>
      <form id="subLedgerCrudForm" class="p-5 space-y-4">
        ${fieldsHtml}
        <div class="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
          <button type="button" onclick="document.getElementById('subLedgerCrudModal').classList.add('hidden')" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg cursor-pointer">취소</button>
          <button type="submit" id="btnSubLedgerSubmit" class="px-4 py-2 ${cfg.btnCls} font-black text-xs rounded-lg shadow-xs cursor-pointer">${isEdit ? '💾 수정 저장' : `➕ ${cfg.label} 등록`}</button>
        </div>
      </form>
    </div>
  `;

  modal.classList.remove('hidden');

  // 수량 × 단가 자동 합계 계산 (RMA / Loss)
  const qtyEl = document.getElementById('slQty');
  const upEl = document.getElementById('slUnitPrice');
  const totEl = document.getElementById('slTotalAmt');
  if (qtyEl && upEl && totEl) {
    const recalc = () => {
      const q = Number(qtyEl.value) || 0;
      const u = Number(upEl.value) || 0;
      if (q > 0 && u > 0) totEl.value = Math.round(q * u);
    };
    qtyEl.addEventListener('input', recalc);
    upEl.addEventListener('input', recalc);
  }

  document.getElementById('subLedgerCrudForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const partNo = document.getElementById('slPartNo')?.value.trim() || '';
    if (!partNo) {
      alert('품번(Part#)을 입력해 주세요.');
      return;
    }
    const payload = {
      date: document.getElementById('slDate')?.value || today,
      customer_name: document.getElementById('slCustomer')?.value.trim() || '',
      part_no: partNo,
      maker: document.getElementById('slMaker')?.value.trim() || '',
      qty: parseInt(document.getElementById('slQty')?.value || '0', 10) || 0,
      gubun: document.getElementById('slGubun')?.value || '',
      result: document.getElementById('slResult')?.value || '',
      rtn_date: document.getElementById('slRtnDate')?.value || '',
      po_no: document.getElementById('slPoNo')?.value.trim() || '',
      out_up: kind === 'rma' ? (parseFloat(document.getElementById('slUnitPrice')?.value || '0') || 0) : 0,
      out_amt: kind === 'rma' ? (parseFloat(document.getElementById('slTotalAmt')?.value || '0') || 0) : 0,
      loss_no: document.getElementById('slLossNo')?.value.trim() || '',
      np: kind === 'loss' ? (parseFloat(document.getElementById('slUnitPrice')?.value || '0') || 0) : 0,
      np_amt: kind === 'loss' ? (parseFloat(document.getElementById('slTotalAmt')?.value || '0') || 0) : 0,
      sales: toEnglishSalesName(document.getElementById('slSales')?.value.trim() || ''),
      remark: document.getElementById('slRemark')?.value.trim() || ''
    };

    const btn = document.getElementById('btnSubLedgerSubmit');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 저장 중...'; }
    try {
      const url = isEdit ? `${cfg.endpoint}/${encodeURIComponent(item.id)}` : cfg.endpoint;
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') throw new Error(data.detail || '저장 실패');
      modal.classList.add('hidden');
      await fetchSubLedgerData(kind, subLedgerQuery);
      renderShipmentsView('shipmentsSection');
    } catch (err) {
      alert(`${cfg.label} 저장 오류: ` + err.message);
      if (btn) { btn.disabled = false; btn.textContent = isEdit ? '💾 수정 저장' : `➕ ${cfg.label} 등록`; }
    }
  });
}

window.openSubLedgerCrudModal = openSubLedgerCrudModal;
window.openSubLedgerCrudModalByIdx = function (kind, idx) {
  const arr = kind === 'borrow' ? cachedBorrows : (kind === 'rma' ? cachedRmas : cachedLosses);
  if (arr && arr[idx]) openSubLedgerCrudModal(kind, arr[idx]);
};
window.deleteSubLedgerRecord = async function (kind, recordId) {
  const cfg = SUB_LEDGER_META[kind];
  if (!cfg || !recordId) return;
  if (!confirm(`이 ${cfg.label} 웹 등록 내역을 삭제하시겠습니까?`)) return;
  try {
    const res = await fetch(`${cfg.endpoint}/${encodeURIComponent(recordId)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || data.status !== 'success') throw new Error(data.detail || '삭제 실패');
    await fetchSubLedgerData(kind, subLedgerQuery);
    renderShipmentsView('shipmentsSection');
  } catch (err) {
    alert(`${cfg.label} 삭제 오류: ` + err.message);
  }
};
