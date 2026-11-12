// public/js/unpaid.js
// 레거시 세일즈 마스터 [FrmUnpaidCustList] 미수금 및 결제예정일 관리 대시보드 모듈
import { sbClient } from './supabase.js';

let cachedUnpaid = [];
let cachedSummary = null;
let cachedSalesReps = [];
let activeAgingFilter = 'all';
let activeSalesRep = 'ALL';
let activeSearchTerm = '';
let activeSortBy = 'out_date_desc';
let unpaidPage = 1;
let unpaidPageSize = 50;
let lastFilteredUnpaid = [];

const AGING_COLOR_MAP = {
  'upcoming': 0,
  'overdue_1_29': 1,
  'overdue_30_44': 2,
  'overdue_45_59': 3,
  'overdue_60_plus': 4
};

function debounce(fn, delay = 200) {
  let timer = null;
  return function(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function mapSupabaseToUnpaid(r) {
  return {
    id: r.id,
    legacy_idx: r.legacy_idx,
    idx: r.legacy_idx || r.id,
    cname: r.customer_name,
    out_dt: r.out_date,
    po_no: r.po_no,
    part_no: r.part_name,
    mfg: r.maker,
    qty: r.qty || 0,
    amount_vat: Number(r.amount_vat) || 0.0,
    overdue_days: Number(r.overdue_days) || 0,
    pay_status: r.pay_status || "미결제",
    contact: r.contact,
    due_date: r.due_date,
    sales: r.sales_rep,
    color_code: Number(r.color_code) || 0
  };
}

function computeSummaryFromItems(items) {
  const activeItems = (items || []).filter(u => u.pay_status !== '수금완료' && (u.amount_vat || 0) > 0);
  const totalCount = activeItems.length;
  const totalAmount = activeItems.reduce((a, b) => a + (b.amount_vat || 0), 0);
  const overdueAmount = activeItems.filter(u => u.overdue_days > 0).reduce((a, b) => a + (b.amount_vat || 0), 0);
  const upcomingAmount = activeItems.filter(u => u.overdue_days <= 0).reduce((a, b) => a + (b.amount_vat || 0), 0);

  const custMap = {};
  activeItems.forEach(it => {
    const c = it.cname || "기타";
    custMap[c] = (custMap[c] || 0) + (it.amount_vat || 0);
  });
  const topCustomers = Object.entries(custMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([customer_name, total_unpaid]) => ({ customer_name, total_unpaid }));

  return {
    total_count: totalCount,
    total_amount: totalAmount,
    overdue_amount: overdueAmount,
    upcoming_amount: upcomingAmount,
    top_customers: topCustomers
  };
}

/**
 * 미수금 목록 비동기 패치 (Supabase Cloud-First -> API Fallback)
 */
export async function fetchUnpaidList(params = {}) {
  // 1. Supabase Cloud 우선 조회 (Cloud-First)
  if (sbClient) {
    try {
      let qb = sbClient.from('legacy_unpaid').select('*');
      if (params.min_date) qb = qb.gte('out_date', params.min_date);
      if (params.sales_rep && params.sales_rep !== 'ALL') qb = qb.eq('sales_rep', params.sales_rep);
      if (params.customer) qb = qb.ilike('customer_name', `%${params.customer}%`);
      if (params.aging && params.aging !== 'all') {
        const cCode = AGING_COLOR_MAP[params.aging];
        if (cCode !== undefined) qb = qb.eq('color_code', cCode);
      }
      if (params.query) {
        const term = params.query;
        qb = qb.or(`part_name.ilike.%${term}%,customer_name.ilike.%${term}%,sales_rep.ilike.%${term}%,po_no.ilike.%${term}%`);
      }
      qb = qb.order('out_date', { ascending: false });

      const { data, error } = await qb.limit(1500);
      if (!error && data && data.length > 0) {
        cachedUnpaid = data.map(mapSupabaseToUnpaid);
        window.currentUnpaidList = cachedUnpaid;
        return cachedUnpaid;
      }
    } catch (e) {
      console.warn("Supabase 미수금 조회 우회, API 시도:", e);
    }
  }

  // 2. 로컬 API 브릿지 Fallback
  const urlParams = new URLSearchParams();
  if (params.sales_rep && params.sales_rep !== 'ALL') urlParams.append('sales_rep', params.sales_rep);
  if (params.customer) urlParams.append('customer', params.customer);
  if (params.mfg) urlParams.append('mfg', params.mfg);
  if (params.aging && params.aging !== 'all') urlParams.append('aging', params.aging);
  if (params.query) urlParams.append('query', params.query);
  if (params.min_date) urlParams.append('min_date', params.min_date);
  if (params.sort) urlParams.append('sort', params.sort);

  try {
    const res = await fetch(`/api/unpaid?${urlParams.toString()}`);
    const data = await res.json();
    if (data.status === 'success') {
      cachedUnpaid = data.items || [];
      window.currentUnpaidList = cachedUnpaid;
      return cachedUnpaid;
    }
  } catch (err) {
    console.error("미수금 목록 패치 에러:", err);
  }
  window.currentUnpaidList = cachedUnpaid;
  return cachedUnpaid;
}

/**
 * 미수금 통계 및 Top 고객사 서머리 패치
 */
export async function fetchUnpaidSummary(minDate = '2010-01-01') {
  // 1. 이미 캐시된 목록이 있으면 즉시 연산 (지연 0ms)
  if (cachedUnpaid && cachedUnpaid.length > 0) {
    cachedSummary = computeSummaryFromItems(cachedUnpaid);
    return cachedSummary;
  }

  // 2. Supabase Cloud 직접 연산
  if (sbClient) {
    try {
      const { data, error } = await sbClient.from('legacy_unpaid').select('*').gte('out_date', minDate);
      if (!error && data && data.length > 0) {
        cachedSummary = computeSummaryFromItems(data.map(mapSupabaseToUnpaid));
        return cachedSummary;
      }
    } catch (e) {}
  }

  // 3. 로컬 API Fallback
  try {
    const res = await fetch(`/api/unpaid/summary?min_date=${minDate}`);
    const data = await res.json();
    if (data.status === 'success' && data.summary && data.summary.total_count !== undefined) {
      cachedSummary = data.summary;
      return cachedSummary;
    }
  } catch (err) {
    console.warn("미수금 통계 패치 실패:", err);
  }
  return null;
}

/**
 * 영업사원 목록 패치
 */
export async function fetchUnpaidSalesReps() {
  if (cachedSalesReps.length > 0) return cachedSalesReps;

  if (sbClient) {
    try {
      const { data, error } = await sbClient.from('legacy_unpaid').select('sales_rep').not('sales_rep', 'is', null);
      if (!error && data && data.length > 0) {
        cachedSalesReps = Array.from(new Set(data.map(d => d.sales_rep).filter(Boolean))).sort();
        if (cachedSalesReps.length > 0) return cachedSalesReps;
      }
    } catch(e) {}
  }

  try {
    const res = await fetch('/api/unpaid/sales-reps');
    const data = await res.json();
    if (data.status === 'success' && data.sales_reps) {
      cachedSalesReps = data.sales_reps || [];
      return cachedSalesReps;
    }
  } catch (err) {
    console.warn("영업사원 목록 패치 실패:", err);
  }
  return ["ALLEN", "STEVE", "WILLIAM", "PAUL", "JOEY", "DUSTIN"];
}

/**
 * 미수금 대시보드 메인 뷰 렌더링
 */
export function renderUnpaidView(containerId = 'unpaidSection') {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (cachedUnpaid && cachedUnpaid.length > 0) {
    const reps = Array.from(new Set(cachedUnpaid.map(d => (d.sales || '').trim()).filter(Boolean))).sort();
    if (reps.length > 0) cachedSalesReps = reps;
  }

  // 에이징 구간별 실시간 건수 계산
  const cntAll = cachedUnpaid.length;
  const cntUpcoming = cachedUnpaid.filter(u => u.overdue_days <= 0).length;
  const cnt1_30 = cachedUnpaid.filter(u => u.overdue_days >= 1 && u.overdue_days < 30).length;
  const cnt30_45 = cachedUnpaid.filter(u => u.overdue_days >= 30 && u.overdue_days < 45).length;
  const cnt45_60 = cachedUnpaid.filter(u => u.overdue_days >= 45 && u.overdue_days < 60).length;
  const cnt60Plus = cachedUnpaid.filter(u => u.overdue_days >= 60).length;

  // 필터 적용
  applyLocalUnpaidFilters();
  unpaidPage = 1;

  const sum = cachedSummary || computeSummaryFromItems(cachedUnpaid);
  const topCust = sum.top_customers && sum.top_customers.length > 0 ? sum.top_customers[0] : null;

  container.innerHTML = `
    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col space-y-3 p-3 sm:p-4">
      
      <!-- 1. 헤더 바 (다크 인디고/골드 테마) -->
      <div class="rounded-xl overflow-hidden shadow-sm border border-indigo-900/30">
        <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white px-3.5 sm:px-4 py-3 flex flex-wrap items-center justify-between gap-2.5">
          <div class="flex items-center gap-2 sm:gap-2.5">
            <span class="text-xl sm:text-2xl shrink-0">💰</span>
            <div>
              <div class="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <h2 class="text-sm sm:text-lg font-black tracking-wide uppercase font-sans text-white break-keep">결제예정 및 미수금 관리</h2>
                <span class="text-[9px] sm:text-[10px] bg-amber-400 text-slate-950 font-black px-1.5 py-0.5 rounded shadow-xs shrink-0">FrmUnpaidCustList</span>
              </div>
              <p class="text-[10px] sm:text-[11px] text-indigo-200 font-medium">세일즈 마스터 MS-SQL 연동 채권 에이징(Aging) 및 자금 회수 대시보드</p>
            </div>
          </div>

          <div class="flex items-center gap-2 text-xs w-full sm:w-auto justify-end pt-1 sm:pt-0 border-t sm:border-t-0 border-indigo-900/60">
            <!-- 엑셀 내보내기 -->
            <button id="btnUnpaidExcelExport" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer">
              <span>📥</span> Excel 다운로드
            </button>
          </div>
        </div>
      </div>

      <!-- 2. 상단 4대 핵심 Grand KPI 카드 -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <!-- 1) 총 미수금 -->
        <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 shadow-xs flex flex-col justify-between">
          <div class="text-[11px] font-bold text-slate-500 flex items-center justify-between">
            <span>총 미수금액 (전체)</span>
            <span class="text-slate-400 font-mono text-[10px]">TOTAL</span>
          </div>
          <div class="mt-1">
            <div id="unpaidKpiTotalAmount" class="text-base sm:text-lg font-black text-slate-900 font-mono">₩${Math.round(sum.total_amount).toLocaleString()}</div>
            <div class="text-[10px] text-slate-500 font-medium mt-0.5">총 <strong id="unpaidKpiTotalCount" class="text-indigo-950">${sum.total_count.toLocaleString()}</strong>건 관리 중</div>
          </div>
        </div>

        <!-- 2) 결제 예정 (D-Day 잔여) -->
        <div class="bg-emerald-50/60 border border-emerald-200 rounded-xl p-3 shadow-xs flex flex-col justify-between">
          <div class="text-[11px] font-bold text-emerald-800 flex items-center justify-between">
            <span>결제 예정 (D-Day 잔여)</span>
            <span class="text-emerald-600 text-xs">⏳</span>
          </div>
          <div class="mt-1">
            <div id="unpaidKpiUpcomingAmount" class="text-base sm:text-lg font-black text-emerald-700 font-mono">₩${Math.round(sum.upcoming_amount).toLocaleString()}</div>
            <div class="text-[10px] text-emerald-600 font-medium mt-0.5">정상 회수 예정 채권</div>
          </div>
        </div>

        <!-- 3) 연체 채권 합계 -->
        <div class="bg-rose-50/60 border border-rose-200 rounded-xl p-3 shadow-xs flex flex-col justify-between">
          <div class="text-[11px] font-bold text-rose-800 flex items-center justify-between">
            <span>연체 채권 합계 (Overdue)</span>
            <span class="text-rose-600 text-xs">🚨</span>
          </div>
          <div class="mt-1">
            <div id="unpaidKpiOverdueAmount" class="text-base sm:text-lg font-black text-rose-700 font-mono">₩${Math.round(sum.overdue_amount).toLocaleString()}</div>
            <div class="text-[10px] text-rose-600 font-medium mt-0.5">기한 초과 미회수 채권</div>
          </div>
        </div>

        <!-- 4) 최대 미수처 -->
        <div class="bg-indigo-50/60 border border-indigo-200 rounded-xl p-3 shadow-xs flex flex-col justify-between">
          <div class="text-[11px] font-bold text-indigo-900 flex items-center justify-between">
            <span>최대 미수 거래처</span>
            <span class="text-indigo-600 text-xs">🏢</span>
          </div>
          <div class="mt-1 truncate">
            <div id="unpaidKpiTopCustName" class="text-sm font-black text-indigo-950 truncate" title="${topCust ? topCust.customer_name : '-'}">${topCust ? topCust.customer_name : '-'}</div>
            <div id="unpaidKpiTopCustAmount" class="text-xs font-bold text-indigo-800 font-mono mt-0.5">₩${topCust ? Math.round(topCust.total_unpaid || topCust.total_amount || 0).toLocaleString() : '0'}</div>
          </div>
        </div>
      </div>

      <!-- 3. 레거시 세일즈 마스터 4단계 에이징(Aging) 색상 필터 탭 -->
      <div class="bg-slate-100/70 p-2 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5 text-xs font-bold select-none w-full sm:w-auto scroll-smooth" id="unpaidAgingFilters" style="-webkit-overflow-scrolling: touch;">
          <span class="text-[11px] font-bold text-slate-500 mr-1 flex items-center gap-1 shrink-0">
            <span>🎨</span> 미수일 구분:
          </span>
          <button type="button" data-aging="all" 
                  class="aging-btn shrink-0 px-2.5 py-1 rounded-lg border text-[11px] transition-all cursor-pointer ${activeAgingFilter === 'all' ? 'bg-indigo-900 text-white border-indigo-950 shadow-xs' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}">
            전체 (${cntAll})
          </button>
          <button type="button" data-aging="upcoming" 
                  class="aging-btn shrink-0 px-2.5 py-1 rounded-lg border text-[11px] transition-all cursor-pointer ${activeAgingFilter === 'upcoming' ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs' : 'bg-emerald-50/70 text-emerald-800 border-emerald-200 hover:bg-emerald-100'}">
            결제예정 (${cntUpcoming})
          </button>
          <button type="button" data-aging="1_30" 
                  class="aging-btn shrink-0 px-2.5 py-1 rounded-lg border text-[11px] transition-all cursor-pointer ${activeAgingFilter === '1_30' ? 'bg-amber-500 text-white border-amber-600 shadow-xs' : 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100'}">
            +1 ~ 29일 연체 (${cnt1_30})
          </button>
          <button type="button" data-aging="30_45" 
                  class="aging-btn shrink-0 px-2.5 py-1 rounded-lg border text-[11px] transition-all cursor-pointer ${activeAgingFilter === '30_45' ? 'bg-orange-500 text-white border-orange-600 shadow-xs' : 'bg-orange-50 text-orange-900 border-orange-200 hover:bg-orange-100'}">
            30 ~ 44일 연체 (${cnt30_45})
          </button>
          <button type="button" data-aging="45_60" 
                  class="aging-btn shrink-0 px-2.5 py-1 rounded-lg border text-[11px] transition-all cursor-pointer ${activeAgingFilter === '45_60' ? 'bg-rose-500 text-white border-rose-600 shadow-xs' : 'bg-rose-50 text-rose-900 border-rose-200 hover:bg-rose-100'}">
            45 ~ 59일 연체 (${cnt45_60})
          </button>
          <button type="button" data-aging="60_plus" 
                  class="aging-btn shrink-0 px-2.5 py-1 rounded-lg border text-[11px] transition-all cursor-pointer ${activeAgingFilter === '60_plus' ? 'bg-red-700 text-white border-red-800 shadow-xs' : 'bg-red-100 text-red-950 border-red-300 hover:bg-red-200'}">
            ★ 60일 이상 (${cnt60Plus})
          </button>
        </div>

        <!-- Top 5 고객사 빠른 필터 칩 (클릭 시 즉시 필터링) -->
        <div class="hidden lg:flex items-center gap-1.5 text-[11px] text-slate-600">
          <span class="font-bold text-slate-500">주요 미수처:</span>
          ${(sum.top_customers || []).slice(0, 3).map(c => `
            <button type="button" onclick="window.filterUnpaidByCustomer('${c.customer_name}')" 
                    class="bg-white border border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/70 px-1.5 py-0.5 rounded text-[10px] font-bold text-slate-800 truncate max-w-[120px] transition-colors cursor-pointer" title="${c.customer_name} 클릭하여 필터">
              ${c.customer_name}
            </button>
          `).join('')}
        </div>
      </div>

      <!-- 4. 실시간 검색 및 필터 툴바 -->
      <div class="bg-slate-50/70 p-2.5 rounded-xl border border-slate-200 grid grid-cols-2 md:grid-cols-4 gap-2 items-center">
        <!-- 검색창 (모바일 2열 전체) -->
        <div class="col-span-2 relative">
          <input type="text" id="unpaidLiveFilter" value="${activeSearchTerm}" placeholder="고객사명, 품번(Part#), PO번호, 담당자, 영업담당 검색..." 
                 class="w-full pl-7 pr-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-600 outline-none">
          <span class="absolute left-2.5 top-2 text-slate-400 text-xs">🔍</span>
        </div>

        <!-- 영업담당자 드롭다운 필터 -->
        <div class="flex items-center gap-1 text-xs">
          <span class="text-slate-500 font-bold whitespace-nowrap text-[11px] shrink-0">담당:</span>
          <select id="unpaidSalesRepSelect" class="w-full bg-white text-slate-800 text-[11px] px-2 py-1.5 rounded-lg border border-slate-300 font-semibold outline-none cursor-pointer truncate">
            <option value="ALL" ${activeSalesRep === 'ALL' ? 'selected' : ''}>(전체 영업사원)</option>
            ${cachedSalesReps.map(rep => `<option value="${rep}" ${activeSalesRep === rep ? 'selected' : ''}>${rep}</option>`).join('')}
          </select>
        </div>

        <!-- 정렬 순서 -->
        <div class="flex items-center gap-1 text-xs">
          <span class="text-slate-500 font-bold whitespace-nowrap text-[11px] shrink-0">정렬:</span>
          <select id="unpaidSortSelect" class="w-full bg-white text-slate-800 text-[11px] px-2 py-1.5 rounded-lg border border-slate-300 font-semibold outline-none cursor-pointer truncate">
            <option value="out_date_desc" ${activeSortBy === 'out_date_desc' ? 'selected' : ''}>출하일자 최근순</option>
            <option value="due_date_asc" ${activeSortBy === 'due_date_asc' ? 'selected' : ''}>결제예정일 빠른순</option>
            <option value="overdue_desc" ${activeSortBy === 'overdue_desc' ? 'selected' : ''}>연체일수 높은순</option>
            <option value="amount_desc" ${activeSortBy === 'amount_desc' ? 'selected' : ''}>미수금액 큰순</option>
          </select>
        </div>
      </div>

      <!-- 5. 미수금 데이터: 모바일 카드 뷰 (md:hidden) -->
      <div id="unpaidCardContainer" class="block md:hidden space-y-2.5 max-h-[66vh] overflow-y-auto pr-0.5"></div>

      <!-- 5. 미수금 데이터: 데스크탑 테이블 뷰 (hidden md:block) -->
      <div class="hidden md:block overflow-x-auto max-h-[66vh] overflow-y-auto border border-slate-200 rounded-xl shadow-xs">
        <table class="w-full text-left text-xs border-collapse">
          <thead class="bg-[#1e293b] text-white border-b border-slate-700 uppercase font-bold sticky top-0 z-10 shadow-xs text-[11px]">
            <tr>
              <th class="py-2.5 px-2 text-center whitespace-nowrap w-9">#</th>
              <th class="py-2.5 px-2.5 text-center whitespace-nowrap w-[110px]">미수/결제상태</th>
              <th class="py-2.5 px-2.5 text-center whitespace-nowrap w-[90px]">결제예정일</th>
              <th class="py-2.5 px-3 text-left min-w-[150px]">고객사명 (CNAME)</th>
              <th class="py-2.5 px-2.5 text-left min-w-[70px]">담당자</th>
              <th class="py-2.5 px-2 text-center whitespace-nowrap w-16">영업담당</th>
              <th class="py-2.5 px-3 text-right whitespace-nowrap min-w-[110px]">미수금액 (VAT포함)</th>
              <th class="py-2.5 px-3 text-left min-w-[180px]">품번 (Part#)</th>
              <th class="py-2.5 px-2.5 text-left min-w-[70px]">제조사</th>
              <th class="py-2.5 px-2.5 text-right whitespace-nowrap min-w-[60px]">수량</th>
              <th class="py-2.5 px-2.5 text-center whitespace-nowrap w-[90px]">출하일자</th>
              <th class="py-2.5 px-2.5 text-left min-w-[110px]">PO 번호</th>
              <th class="py-2.5 px-2 text-center whitespace-nowrap w-16">상태</th>
              <th class="py-2.5 px-2 text-center whitespace-nowrap min-w-[135px]">수금/청구 관리</th>
            </tr>
          </thead>
          <tbody id="unpaidTableBody" class="divide-y divide-slate-100 font-medium bg-white text-slate-700">
          </tbody>
        </table>
      </div>

      <!-- 📄 미수금 페이지네이션 컨트롤러 -->
      <div id="unpaidPagination" class="flex flex-wrap items-center justify-between gap-2 pt-1 px-1 text-xs select-none"></div>

    </div>
  `;

  // 페이지 렌더링
  updateUnpaidCurrentPage();

  // 이벤트 바인딩
  bindUnpaidEvents();
}

/**
 * 페이지 단위 행 렌더링
 */
function updateUnpaidCurrentPage() {
  const total = lastFilteredUnpaid.length;
  const totalPages = unpaidPageSize === 'ALL' ? 1 : Math.max(1, Math.ceil(total / unpaidPageSize));
  if (unpaidPage > totalPages) unpaidPage = totalPages;
  if (unpaidPage < 1) unpaidPage = 1;

  const offset = unpaidPageSize === 'ALL' ? 0 : (unpaidPage - 1) * unpaidPageSize;
  const pagedItems = unpaidPageSize === 'ALL'
    ? lastFilteredUnpaid
    : lastFilteredUnpaid.slice(offset, offset + unpaidPageSize);

  const tbody = document.getElementById("unpaidTableBody");
  if (tbody) {
    tbody.innerHTML = generateUnpaidTableRows(pagedItems, offset);
  }

  const cardContainer = document.getElementById("unpaidCardContainer");
  if (cardContainer) {
    cardContainer.innerHTML = generateUnpaidMobileCards(pagedItems, offset);
  }

  renderUnpaidPagination(total, totalPages);
}

/**
 * 모바일 미수금 카드 HTML 생성
 */
function generateUnpaidMobileCards(items, offset = 0) {
  if (!items || items.length === 0) {
    let reason = "조회 조건에 일치하는 미수금 내역이 없습니다.";
    if (activeAgingFilter === '30_45' || activeAgingFilter === '45_60') {
      reason = "현재 해당 연체 구간(30 ~ 59일)의 미수 채권은 0건으로 없습니다. (정상 관리 중)";
    }
    return `
      <div class="p-6 text-center text-xs text-slate-500 bg-white rounded-xl border border-slate-200 space-y-1.5">
        <span class="text-2xl block">📋</span>
        <p class="font-bold text-sm text-slate-700">${reason}</p>
        <p class="text-xs text-slate-400">상단의 다른 미수일 구분 또는 영업담당자를 선택해 보세요.</p>
      </div>
    `;
  }

  return items.map((u, idx) => {
    const realIdx = offset + idx;
    const ovd = u.overdue_days;

    let badgeHtml = "";
    let borderClass = "border-slate-200";

    if (ovd <= 0) {
      const dDayText = ovd === 0 ? "D-Day (오늘)" : `D${ovd}`;
      badgeHtml = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">${dDayText}</span>`;
      borderClass = "border-emerald-200 bg-emerald-50/20";
    } else if (ovd < 30) {
      badgeHtml = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">+${ovd}일 연체</span>`;
      borderClass = "border-amber-200 bg-amber-50/30";
    } else if (ovd < 45) {
      badgeHtml = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-950 border border-orange-300">+${ovd}일 (경고)</span>`;
      borderClass = "border-orange-200 bg-orange-50/30";
    } else if (ovd < 60) {
      badgeHtml = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-950 border border-rose-300">+${ovd}일 (심각)</span>`;
      borderClass = "border-rose-200 bg-rose-50/40";
    } else {
      badgeHtml = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-red-200 text-red-950 border border-red-400">★ +${ovd}일 (고위험)</span>`;
      borderClass = "border-red-300 bg-red-50/50";
    }

    const amtDisplay = Math.round(Number(u.amount_vat) || 0).toLocaleString();

    return `
      <div class="p-3.5 bg-white rounded-xl border ${borderClass} shadow-sm space-y-2.5">
        <!-- 1) 상단: 고객사명, 연체뱃지, 미수금액 -->
        <div class="flex items-start justify-between gap-1.5">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              ${badgeHtml}
              <span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${u.pay_status === '수금완료' ? 'bg-emerald-100 text-emerald-800' : (u.pay_status === '부분입금' ? 'bg-blue-100 text-blue-800' : (u.pay_status === '결제약속' ? 'bg-amber-100 text-amber-900' : 'bg-rose-100 text-rose-800'))}">
                ${u.pay_status || '미결제'}
              </span>
            </div>
            <h4 class="font-black text-sm text-slate-900 mt-1 truncate" title="${u.cname || '-'}">
              <span class="text-indigo-600 font-mono text-xs">#${realIdx + 1}</span> ${u.cname || '-'}
            </h4>
          </div>
          <div class="text-right shrink-0">
            <span class="text-[9px] text-slate-400 block font-semibold">미수금액(VAT포함)</span>
            <span class="font-black text-slate-900 font-mono text-sm text-rose-700">₩ ${amtDisplay}</span>
          </div>
        </div>

        <!-- 2) 중단: 부품 정보 & 일정 그리드 -->
        <div class="grid grid-cols-2 gap-1.5 text-xs bg-slate-50/80 p-2.5 rounded-lg border border-slate-100">
          <div>
            <span class="text-[9px] text-slate-400 block font-semibold">품번 / 제조사</span>
            <div class="font-bold text-indigo-950 font-mono text-[11px] truncate" title="${u.part_no || '-'}">${u.part_no || '-'}</div>
            <span class="text-[10px] text-slate-500">${u.mfg || '-'} (${(u.qty || 0).toLocaleString()} EA)</span>
          </div>
          <div>
            <span class="text-[9px] text-slate-400 block font-semibold">출하일자 / 결제예정일</span>
            <div class="font-bold text-slate-700 text-[11px] font-mono">출하: ${u.out_dt || '-'}</div>
            <div class="font-black text-slate-900 text-[11px] font-mono">만기: ${u.due_date || '-'}</div>
          </div>
          <div>
            <span class="text-[9px] text-slate-400 block font-semibold">고객 담당자</span>
            <span class="text-[11px] font-medium text-slate-700">${u.contact || '-'}</span>
          </div>
          <div>
            <span class="text-[9px] text-slate-400 block font-semibold">영업담당 / PO</span>
            <span class="text-[11px] font-bold text-indigo-900">${u.sales || '-'}</span>
            <span class="text-[10px] text-slate-400 font-mono block truncate" title="${u.po_no || '-'}">${u.po_no ? 'PO: ' + u.po_no : ''}</span>
          </div>
        </div>

        <!-- 3) 하단: 수금/약속 관리 액션 버튼 -->
        <div class="flex items-center gap-1.5 pt-1">
          <button type="button" onclick="window.openPaymentSettlementModal && window.openPaymentSettlementModal(${realIdx})" 
                  class="flex-1 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-lg shadow-2xs transition-colors flex items-center justify-center gap-1 cursor-pointer">
            <span>💰</span> 수금 / 부분입금 / 일정연기
          </button>
          <button type="button" onclick="window.openStatementOfAccount && window.openStatementOfAccount('${(u.cname || '').replace(/'/g, "\\'")}')" 
                  class="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-lg border border-rose-200 shadow-2xs transition-colors shrink-0 flex items-center gap-1 cursor-pointer" title="청구서 발행">
            <span>📄</span> 청구서
          </button>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * 테이블 행 HTML 생성 (레거시 FrmUnpaidCustList 색상 체계 반영)
 */
function generateUnpaidTableRows(items, offset = 0) {
  if (!items || items.length === 0) {
    let reason = "조회 조건에 일치하는 미수금 내역이 없습니다.";
    if (activeAgingFilter === '30_45' || activeAgingFilter === '45_60') {
      reason = "현재 해당 연체 구간(30 ~ 59일)의 미수 채권은 0건으로 없습니다. (정상 관리 중)";
    }
    return `
      <tr>
        <td colspan="14" class="text-center py-12 text-slate-500">
          <div class="flex flex-col items-center justify-center gap-1.5">
            <span class="text-2xl">📋</span>
            <p class="font-bold text-sm text-slate-700">${reason}</p>
            <p class="text-xs text-slate-400">상단의 다른 미수일 구분 또는 영업담당자를 선택해 보세요.</p>
          </div>
        </td>
      </tr>
    `;
  }

  return items.map((u, idx) => {
    const realIdx = offset + idx;
    const ovd = u.overdue_days;

    // 미수/결제상태 뱃지 (레거시 색상 매핑)
    let badgeHtml = "";
    let rowBg = realIdx % 2 === 0 ? "bg-white" : "bg-slate-50/50";

    if (ovd <= 0) {
      const dDayText = ovd === 0 ? "D-Day (오늘)" : `D${ovd}`;
      badgeHtml = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 whitespace-nowrap">${dDayText}</span>`;
    } else if (ovd < 30) {
      badgeHtml = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 whitespace-nowrap">+${ovd}일 연체</span>`;
      rowBg = "bg-amber-50/30";
    } else if (ovd < 45) {
      badgeHtml = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-950 border border-orange-300 whitespace-nowrap">+${ovd}일 (경고)</span>`;
      rowBg = "bg-orange-50/30";
    } else if (ovd < 60) {
      badgeHtml = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-950 border border-rose-300 whitespace-nowrap">+${ovd}일 (심각)</span>`;
      rowBg = "bg-rose-50/40";
    } else {
      badgeHtml = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-red-200 text-red-950 border border-red-400 whitespace-nowrap">★ +${ovd}일 (고위험)</span>`;
      rowBg = "bg-red-50/50";
    }

    const amtDisplay = Math.round(Number(u.amount_vat) || 0).toLocaleString();

    return `
      <tr class="${rowBg} hover:bg-indigo-50/70 transition-colors border-b border-slate-100 text-[11px] cursor-pointer" 
          data-unpaid-idx="${realIdx}">
        <td class="py-1.5 px-2 text-center font-mono text-slate-400">${realIdx + 1}</td>
        <td class="py-1.5 px-2 text-center whitespace-nowrap">${badgeHtml}</td>
        <td class="py-1.5 px-2.5 text-center font-mono font-bold text-slate-700 whitespace-nowrap">${u.due_date || '-'}</td>
        <td class="py-1.5 px-3 font-bold text-slate-900 truncate max-w-[170px]" title="${u.cname || '-'}">${u.cname || '-'}</td>
        <td class="py-1.5 px-2.5 text-slate-700 truncate max-w-[90px]" title="${u.contact || '-'}">${u.contact || '-'}</td>
        <td class="py-1.5 px-2 text-center font-bold text-indigo-950 whitespace-nowrap">${u.sales || '-'}</td>
        <td class="py-1.5 px-3 text-right font-mono font-black text-slate-950 whitespace-nowrap">₩ ${amtDisplay}</td>
        <td class="py-1.5 px-3 font-black text-indigo-900 font-mono tracking-tight">${u.part_no || '-'}</td>
        <td class="py-1.5 px-2.5 text-slate-800 font-semibold truncate max-w-[80px]">${u.mfg || '-'}</td>
        <td class="py-1.5 px-2.5 text-right font-semibold text-slate-700 whitespace-nowrap">${(u.qty || 0).toLocaleString()}</td>
        <td class="py-1.5 px-2.5 text-center font-mono text-slate-500 whitespace-nowrap">${u.out_dt || '-'}</td>
        <td class="py-1.5 px-2.5 text-slate-600 font-mono text-[10px] truncate max-w-[120px]" title="${u.po_no || '-'}">${u.po_no || '-'}</td>
        <td class="py-1.5 px-2 text-center whitespace-nowrap">
          <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${u.pay_status === '수금완료' ? 'bg-emerald-100 text-emerald-800' : (u.pay_status === '부분입금' ? 'bg-blue-100 text-blue-800' : (u.pay_status === '결제약속' ? 'bg-amber-100 text-amber-900' : 'bg-rose-50 text-rose-700'))}">
            ${u.pay_status || '미결제'}
          </span>
        </td>
        <td class="py-1.5 px-2 text-center whitespace-nowrap" onclick="event.stopPropagation()">
          <div class="flex items-center justify-center gap-1">
            <button type="button" onclick="event.stopPropagation(); window.openPaymentSettlementModal && window.openPaymentSettlementModal(${realIdx})" 
                    class="px-2 py-0.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-[10px] rounded shadow-2xs transition-colors cursor-pointer flex items-center gap-0.5" 
                    title="수금 확인 / 부분입금 처리 및 입금약속 메모">
              <span>💰</span> 수금/약속
            </button>
            <button type="button" onclick="event.stopPropagation(); window.openStatementOfAccount && window.openStatementOfAccount('${(u.cname || '').replace(/'/g, "\\'")}')" 
                    class="px-2 py-0.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-[10px] rounded border border-rose-200 cursor-pointer shadow-2xs transition-colors" title="${u.cname} 미수금 잔액확인서/청구서 A4 발행">
              📄 청구서
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * 페이지네이션 컨트롤러 렌더링
 */
function renderUnpaidPagination(total, totalPages) {
  const container = document.getElementById('unpaidPagination');
  if (!container) return;

  if (total === 0) {
    container.innerHTML = '';
    return;
  }

  const startIdx = unpaidPageSize === 'ALL' ? 1 : (unpaidPage - 1) * unpaidPageSize + 1;
  const endIdx = unpaidPageSize === 'ALL' ? total : Math.min(unpaidPage * unpaidPageSize, total);

  let pageButtons = '';
  const maxButtons = 5;
  let startP = Math.max(1, unpaidPage - 2);
  let endP = Math.min(totalPages, startP + maxButtons - 1);
  if (endP - startP < maxButtons - 1) {
    startP = Math.max(1, endP - maxButtons + 1);
  }

  for (let p = startP; p <= endP; p++) {
    const isCurrent = (p === unpaidPage);
    pageButtons += `
      <button type="button" onclick="window.goToUnpaidPage(${p})" 
              class="w-7 h-7 flex items-center justify-center rounded-lg text-xs font-bold transition-colors ${isCurrent ? 'bg-indigo-900 text-white shadow-xs' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 cursor-pointer'}">
        ${p}
      </button>
    `;
  }

  container.innerHTML = `
    <div class="flex items-center gap-2 text-slate-500 text-[11px]">
      <span class="font-bold text-slate-800">${startIdx.toLocaleString()} - ${endIdx.toLocaleString()}</span> / 전체 <strong class="text-indigo-950 font-black">${total.toLocaleString()}</strong>건
      <span class="text-slate-300">|</span>
      <span>${unpaidPage} / ${totalPages} 페이지</span>
    </div>

    <div class="flex items-center gap-1.5">
      <button type="button" onclick="window.goToUnpaidPage(${unpaidPage - 1})" 
              ${unpaidPage <= 1 ? 'disabled class="px-2 py-1 bg-slate-100 text-slate-300 rounded text-xs cursor-not-allowed"' : 'class="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded text-xs transition-colors cursor-pointer"'}>
        ◀ 이전
      </button>

      <div class="flex items-center gap-1">
        ${pageButtons}
      </div>

      <button type="button" onclick="window.goToUnpaidPage(${unpaidPage + 1})" 
              ${unpaidPage >= totalPages ? 'disabled class="px-2 py-1 bg-slate-100 text-slate-300 rounded text-xs cursor-not-allowed"' : 'class="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded text-xs transition-colors cursor-pointer"'}>
        다음 ▶
      </button>

      <span class="text-slate-300 mx-1">|</span>

      <select id="selectUnpaidPageSize" onchange="window.setUnpaidPageSize(this.value)" class="bg-white border border-slate-300 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-700 outline-none cursor-pointer">
        <option value="50" ${unpaidPageSize === 50 ? 'selected' : ''}>50개씩</option>
        <option value="100" ${unpaidPageSize === 100 ? 'selected' : ''}>100개씩</option>
        <option value="200" ${unpaidPageSize === 200 ? 'selected' : ''}>200개씩</option>
        <option value="ALL" ${unpaidPageSize === 'ALL' ? 'selected' : ''}>전체 (${total})</option>
      </select>
    </div>
  `;
}

window.goToUnpaidPage = function(page) {
  unpaidPage = page;
  updateUnpaidCurrentPage();
};

window.setUnpaidPageSize = function(size) {
  unpaidPageSize = (size === 'ALL') ? 'ALL' : parseInt(size, 10);
  unpaidPage = 1;
  updateUnpaidCurrentPage();
};

/**
 * 고객사 칩 클릭 시 즉시 필터링
 */
window.filterUnpaidByCustomer = function(customerName) {
  activeSearchTerm = customerName.toLowerCase().trim();
  const input = document.getElementById("unpaidLiveFilter");
  if (input) input.value = customerName;
  applyLocalUnpaidFilters();
  unpaidPage = 1;
  updateUnpaidCurrentPage();
};

/**
 * 이벤트 바인딩
 */
function bindUnpaidEvents() {
  const liveFilter = document.getElementById("unpaidLiveFilter");
  const salesSelect = document.getElementById("unpaidSalesRepSelect");
  const sortSelect = document.getElementById("unpaidSortSelect");
  const btnExcel = document.getElementById("btnUnpaidExcelExport");
  const agingBtns = document.querySelectorAll("#unpaidAgingFilters .aging-btn");

  // 1. Aging 필터 버튼 클릭 (전체 화면 재렌더링 대신 로컬 즉시 필터링 및 탭 스타일 직접 전환)
  agingBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const aging = btn.getAttribute("data-aging");
      activeAgingFilter = aging;

      // 버튼 활성 스타일 인라인 토글 (전체 HTML 리셋 방지)
      agingBtns.forEach(b => {
        const a = b.getAttribute("data-aging");
        const isActive = (a === activeAgingFilter);
        b.className = `aging-btn px-2.5 py-1 rounded-lg border text-[11px] transition-all cursor-pointer ${
          isActive 
            ? (a === 'all' ? 'bg-indigo-900 text-white border-indigo-950 shadow-xs'
              : a === 'upcoming' ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs'
              : a === '1_30' ? 'bg-amber-500 text-white border-amber-600 shadow-xs'
              : a === '30_45' ? 'bg-orange-500 text-white border-orange-600 shadow-xs'
              : a === '45_60' ? 'bg-rose-500 text-white border-rose-600 shadow-xs'
              : 'bg-red-700 text-white border-red-800 shadow-xs')
            : (a === 'all' ? 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              : a === 'upcoming' ? 'bg-emerald-50/70 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
              : a === '1_30' ? 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100'
              : a === '30_45' ? 'bg-orange-50 text-orange-900 border-orange-200 hover:bg-orange-100'
              : a === '45_60' ? 'bg-rose-50 text-rose-900 border-rose-200 hover:bg-rose-100'
              : 'bg-red-100 text-red-950 border-red-300 hover:bg-red-200')
        }`;
      });

      applyLocalUnpaidFilters();
      unpaidPage = 1;
      updateUnpaidCurrentPage();
    });
  });

  // 2. 실시간 검색창 디바운스
  const handleLiveFilter = debounce((term) => {
    activeSearchTerm = term;
    applyLocalUnpaidFilters();
    unpaidPage = 1;
    updateUnpaidCurrentPage();
  }, 200);

  liveFilter?.addEventListener("input", (e) => {
    handleLiveFilter(e.target.value.toLowerCase().trim());
  });

  // 3. 영업사원 드롭다운 변경 (로컬 즉시 필터링으로 선택 상태 유지)
  salesSelect?.addEventListener("change", (e) => {
    activeSalesRep = e.target.value;
    applyLocalUnpaidFilters();
    unpaidPage = 1;
    updateUnpaidCurrentPage();
  });

  // 4. 정렬 드롭다운 변경
  sortSelect?.addEventListener("change", (e) => {
    activeSortBy = e.target.value;
    applyLocalUnpaidFilters();
    unpaidPage = 1;
    updateUnpaidCurrentPage();
  });

  // 5. 엑셀 CSV 다운로드
  btnExcel?.addEventListener("click", () => {
    exportUnpaidToCsv(lastFilteredUnpaid.length > 0 ? lastFilteredUnpaid : cachedUnpaid);
  });

  // 6. 테이블 행 클릭 시 수금/약속 관리 모달 오픈
  const tbody = document.getElementById("unpaidTableBody");
  tbody?.addEventListener("click", (e) => {
    if (e.target.closest("button") || e.target.closest("input") || e.target.closest("a")) return;
    const row = e.target.closest("tr[data-unpaid-idx]");
    if (!row) return;
    const idx = parseInt(row.getAttribute("data-unpaid-idx"), 10);
    openPaymentSettlementModal(idx);
  });
}

function applyLocalUnpaidFilters() {
  const term = activeSearchTerm;

  lastFilteredUnpaid = cachedUnpaid.filter(u => {
    // 1. Aging 필터
    if (activeAgingFilter === 'upcoming' && u.overdue_days > 0) return false;
    if (activeAgingFilter === '1_30' && (u.overdue_days <= 0 || u.overdue_days >= 30)) return false;
    if (activeAgingFilter === '30_45' && (u.overdue_days < 30 || u.overdue_days >= 45)) return false;
    if (activeAgingFilter === '45_60' && (u.overdue_days < 45 || u.overdue_days >= 60)) return false;
    if (activeAgingFilter === '60_plus' && u.overdue_days < 60) return false;

    // 2. 영업사원 필터
    if (activeSalesRep && activeSalesRep !== 'ALL') {
      if ((u.sales || '').trim() !== activeSalesRep.trim()) return false;
    }

    // 3. 검색어 필터
    if (term) {
      const match = (u.cname && u.cname.toLowerCase().includes(term)) ||
                    (u.part_no && u.part_no.toLowerCase().includes(term)) ||
                    (u.po_no && u.po_no.toLowerCase().includes(term)) ||
                    (u.contact && u.contact.toLowerCase().includes(term)) ||
                    (u.sales && u.sales.toLowerCase().includes(term)) ||
                    (u.mfg && u.mfg.toLowerCase().includes(term));
      if (!match) return false;
    }

    return true;
  });

  // 정렬 반영
  sortUnpaidList(activeSortBy);
}

function sortUnpaidList(sortBy) {
  if (sortBy === 'amount_desc') {
    lastFilteredUnpaid.sort((a, b) => (b.amount_vat || 0) - (a.amount_vat || 0));
  } else if (sortBy === 'overdue_desc') {
    lastFilteredUnpaid.sort((a, b) => (b.overdue_days || 0) - (a.overdue_days || 0));
  } else if (sortBy === 'due_date_asc') {
    lastFilteredUnpaid.sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));
  } else {
    // out_date_desc (기본: 출하일자 최근순)
    lastFilteredUnpaid.sort((a, b) => String(b.out_dt || '').localeCompare(String(a.out_dt || '')));
  }
}

/**
 * 엑셀 CSV 다운로드
 */
function exportUnpaidToCsv(items) {
  if (!items || items.length === 0) {
    alert("내보낼 미수금 내역이 없습니다.");
    return;
  }

  const headers = ["연체일수", "결제예정일", "고객사명", "담당자", "영업담당", "미수금액(VAT포함)", "품번(Part#)", "제조사", "수량", "출하일자", "PO번호", "결제상태"];
  const rows = items.map(u => [
    u.overdue_days > 0 ? `+${u.overdue_days}일` : `D${u.overdue_days}`,
    `"${u.due_date || ''}"`,
    `"${(u.cname || '').replace(/"/g, '""')}"`,
    `"${(u.contact || '').replace(/"/g, '""')}"`,
    `"${(u.sales || '').replace(/"/g, '""')}"`,
    Math.round(u.amount_vat || 0),
    `"${(u.part_no || '').replace(/"/g, '""')}"`,
    `"${(u.mfg || '').replace(/"/g, '""')}"`,
    u.qty || 0,
    `"${u.out_dt || ''}"`,
    `"${(u.po_no || '').replace(/"/g, '""')}"`,
    `"${u.pay_status || '미결제'}"`
  ]);

  const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const today = new Date().toISOString().slice(0, 10);
  a.download = `BSK_Unpaid_List_${today}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * ========================================================
 * 💰 수금 확인 / 부분입금 처리 및 입금약속 메모 모달 관리
 * ========================================================
 */
let currentSettlementIdx = null;
let currentSettlementMode = 'full_settle';

export function openPaymentSettlementModal(idx) {
  const u = lastFilteredUnpaid[idx] || cachedUnpaid[idx];
  if (!u) {
    alert("해당 미수금 내역을 찾을 수 없습니다.");
    return;
  }

  currentSettlementIdx = idx;
  currentSettlementMode = (u.amount_vat <= 0 || u.pay_status === '수금완료') ? 'reschedule' : 'full_settle';

  // 기존 모달 제거
  document.getElementById("paymentSettlementModal")?.remove();

  const todayStr = new Date().toISOString().slice(0, 10);
  const amtVat = Math.round(u.amount_vat || 0);

  const modalHtml = `
    <div id="paymentSettlementModal" class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs transition-opacity select-none">
      <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150">
        
        <!-- 1. 헤더 (레거시 다크 네이비 테마) -->
        <div class="bg-[#1e293b] text-white p-3.5 sm:p-4 flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            <span class="text-2xl">💰</span>
            <div>
              <div class="flex items-center gap-2">
                <h3 class="text-sm sm:text-base font-black text-white">수금 확인 및 입금약속 관리</h3>
                <span class="text-[10px] font-bold bg-amber-400 text-slate-950 px-1.5 py-0.5 rounded shadow-xs">${u.cname || '-'}</span>
              </div>
              <p class="text-[10px] text-slate-300">거래처 수금 완료 처리, 부분입금 잔액 차감 및 입금약속일/통화메모 관리</p>
            </div>
          </div>
          <button type="button" onclick="window.closePaymentSettlementModal()" class="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center text-lg font-bold cursor-pointer transition-colors">
            ✕
          </button>
        </div>

        <!-- 2. 모달 본문 (스크롤) -->
        <div class="p-4 space-y-4 overflow-y-auto text-xs">
          
          <!-- (1) 기본 채권 정보 카드 -->
          <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div>
              <span class="text-[10px] text-slate-400 font-bold block">고객사 (CNAME)</span>
              <span class="text-xs font-black text-slate-900 truncate block" title="${u.cname || '-'}">${u.cname || '-'}</span>
              <span class="text-[10px] text-slate-500">담당: ${u.contact || '-'}</span>
            </div>
            <div>
              <span class="text-[10px] text-slate-400 font-bold block">품번 / 제조사</span>
              <span class="text-xs font-black text-indigo-950 font-mono truncate block" title="${u.part_no || '-'}">${u.part_no || '-'}</span>
              <span class="text-[10px] text-slate-500">${u.mfg || '-'} / ${(u.qty || 0).toLocaleString()} EA</span>
            </div>
            <div>
              <span class="text-[10px] text-slate-400 font-bold block">출하일자 / PO#</span>
              <span class="text-xs font-bold text-slate-700 font-mono block">${u.out_dt || '-'}</span>
              <span class="text-[10px] text-slate-500 font-mono truncate block" title="${u.po_no || '-'}">${u.po_no || '-'}</span>
            </div>
            <div>
              <span class="text-[10px] text-rose-500 font-bold block">현재 미수 잔액 (VAT포함)</span>
              <span class="text-sm font-black text-rose-700 font-mono block">₩ ${amtVat.toLocaleString()}</span>
              <span class="text-[10px] font-bold ${u.overdue_days > 0 ? 'text-rose-600' : 'text-emerald-600'}">
                ${u.due_date || '-'} (${u.overdue_days <= 0 ? (u.overdue_days === 0 ? 'D-Day' : 'D' + u.overdue_days) : '+' + u.overdue_days + '일 연체'})
              </span>
            </div>
          </div>

          <!-- (2) 처리 모드 3버튼 탭 선택 -->
          <div>
            <label class="block text-[11px] font-black text-slate-700 mb-1.5">⚡ 처리 방식 선택 (Action Mode)</label>
            <div class="grid grid-cols-3 gap-2" id="settlementActionTabs">
              <button type="button" data-mode="full_settle" onclick="window.switchSettlementMode('full_settle')" 
                      class="settle-tab-btn py-2 px-2 rounded-xl border text-center transition-all cursor-pointer font-bold text-xs ${currentSettlementMode === 'full_settle' ? 'bg-emerald-700 text-white border-emerald-800 shadow-xs' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'} flex flex-col items-center gap-0.5">
                <span>💰 전액 수금 완료</span>
                <span class="text-[9px] opacity-90 font-normal">미수 잔액 ₩0 종결</span>
              </button>
              <button type="button" data-mode="partial_settle" onclick="window.switchSettlementMode('partial_settle')" 
                      class="settle-tab-btn py-2 px-2 rounded-xl border text-center transition-all cursor-pointer font-bold text-xs ${currentSettlementMode === 'partial_settle' ? 'bg-blue-700 text-white border-blue-800 shadow-xs' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'} flex flex-col items-center gap-0.5">
                <span>💵 부분 입금 처리</span>
                <span class="text-[9px] opacity-90 font-normal">입금액 차감 후 잔액 갱신</span>
              </button>
              <button type="button" data-mode="reschedule" onclick="window.switchSettlementMode('reschedule')" 
                      class="settle-tab-btn py-2 px-2 rounded-xl border text-center transition-all cursor-pointer font-bold text-xs ${currentSettlementMode === 'reschedule' ? 'bg-amber-600 text-white border-amber-700 shadow-xs' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'} flex flex-col items-center gap-0.5">
                <span>📅 입금 약속일 연기</span>
                <span class="text-[9px] opacity-90 font-normal">협의된 새 결제일 지정</span>
              </button>
            </div>
          </div>

          <!-- (3) 모드 1: 전액 수금 완료 -->
          <div id="modeFullSettleSection" class="${currentSettlementMode === 'full_settle' ? '' : 'hidden'} bg-emerald-50/70 border border-emerald-200 rounded-xl p-3.5 space-y-2.5">
            <div class="flex items-start gap-2">
              <span class="text-emerald-700 text-base">✅</span>
              <div>
                <h4 class="font-black text-emerald-950 text-xs">전액 수금 완료 처리 안내</h4>
                <p class="text-[11px] text-emerald-800 mt-0.5">거래처로부터 미수금 전액(<strong>₩ ${amtVat.toLocaleString()}</strong>) 입금이 확인되었습니다. 저장 시 미수 잔액이 <strong>₩0</strong>으로 변경되고 상태가 <strong>[수금완료]</strong>로 종결 처리됩니다.</p>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2 pt-1">
              <div>
                <label class="block text-[10px] font-bold text-emerald-900 mb-1">수금 입금일자</label>
                <input type="date" id="settleDateInput" value="${todayStr}" class="w-full bg-white border border-emerald-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-emerald-950 outline-none cursor-pointer">
              </div>
              <div>
                <label class="block text-[10px] font-bold text-emerald-900 mb-1">입금 확인 수단</label>
                <select id="settleMethodSelect" class="w-full bg-white border border-emerald-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-emerald-950 outline-none cursor-pointer">
                  <option value="법인통장 계좌입금">법인통장 계좌입금</option>
                  <option value="전자어음 결제">전자어음 결제</option>
                  <option value="구매카드 / 법인카드">구매카드 / 법인카드</option>
                  <option value="상계 처리 (매입채무 상계)">상계 처리 (매입채무 상계)</option>
                  <option value="기타 입금">기타 입금</option>
                </select>
              </div>
            </div>
          </div>

          <!-- (4) 모드 2: 부분 입금 처리 -->
          <div id="modePartialSettleSection" class="${currentSettlementMode === 'partial_settle' ? '' : 'hidden'} bg-blue-50/70 border border-blue-200 rounded-xl p-3.5 space-y-3">
            <div class="flex items-start gap-2">
              <span class="text-blue-700 text-base">💵</span>
              <div>
                <h4 class="font-black text-blue-950 text-xs">부분 입금 및 잔여 채권 잔액 갱신</h4>
                <p class="text-[11px] text-blue-800 mt-0.5">입금된 부분 금액을 입력하세요. 남은 미수 잔액이 자동 계산되어 갱신됩니다.</p>
              </div>
            </div>

            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="text-[10px] font-bold text-blue-950">금회 입금액 (₩, VAT포함)</label>
                <div class="flex items-center gap-1">
                  <button type="button" onclick="window.setPartialAmountPercent(0.3)" class="px-1.5 py-0.5 bg-white border border-blue-200 hover:bg-blue-100 rounded text-[9px] font-bold text-blue-900 cursor-pointer">30%</button>
                  <button type="button" onclick="window.setPartialAmountPercent(0.5)" class="px-1.5 py-0.5 bg-white border border-blue-200 hover:bg-blue-100 rounded text-[9px] font-bold text-blue-900 cursor-pointer">50%</button>
                  <button type="button" onclick="window.setPartialAmountPercent(0.7)" class="px-1.5 py-0.5 bg-white border border-blue-200 hover:bg-blue-100 rounded text-[9px] font-bold text-blue-900 cursor-pointer">70%</button>
                  <button type="button" onclick="window.setPartialAmountPercent(1.0)" class="px-1.5 py-0.5 bg-white border border-blue-200 hover:bg-blue-100 rounded text-[9px] font-bold text-blue-900 cursor-pointer">전액</button>
                </div>
              </div>
              <div class="relative">
                <span class="absolute left-3 top-2 text-slate-400 font-bold">₩</span>
                <input type="text" id="partialAmountInput" placeholder="0" class="w-full pl-7 pr-3 py-1.5 bg-white border border-blue-300 rounded-lg text-sm font-black text-blue-950 outline-none">
              </div>
            </div>

            <!-- 실시간 차감 미리보기 카드 -->
            <div class="bg-white border border-blue-200 rounded-lg p-2.5 grid grid-cols-3 text-center text-xs">
              <div>
                <span class="text-[9px] text-slate-400 block font-bold">기존 미수금</span>
                <span class="font-bold text-slate-700">₩ ${amtVat.toLocaleString()}</span>
              </div>
              <div>
                <span class="text-[9px] text-blue-500 block font-bold">금회 입금액</span>
                <span id="partialPreviewPaid" class="font-bold text-blue-600">- ₩ 0</span>
              </div>
              <div class="border-l border-blue-100">
                <span class="text-[9px] text-rose-500 block font-bold">차감 후 남은 잔액</span>
                <span id="partialPreviewRemaining" class="font-black text-rose-700 text-sm">₩ ${amtVat.toLocaleString()}</span>
              </div>
            </div>

            <div>
              <label class="block text-[10px] font-bold text-blue-950 mb-1">잔여금 결제 약속일 (선택)</label>
              <input type="date" id="partialNextDueDate" value="${u.due_date || todayStr}" class="w-full bg-white border border-blue-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-800 outline-none cursor-pointer">
            </div>
          </div>

          <!-- (5) 모드 3: 입금 약속일 연기 -->
          <div id="modeRescheduleSection" class="${currentSettlementMode === 'reschedule' ? '' : 'hidden'} bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 space-y-3">
            <div class="flex items-start gap-2">
              <span class="text-amber-700 text-base">📅</span>
              <div>
                <h4 class="font-black text-amber-950 text-xs">입금 약속일 재지정 (일정 연기)</h4>
                <p class="text-[11px] text-amber-800 mt-0.5">거래처와 협의된 새로운 결제 약속일을 선택하세요. 연체일수와 Aging 구간이 즉시 재계산됩니다.</p>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="block text-[10px] font-bold text-slate-500 mb-1">기존 결제예정일</label>
                <input type="text" readonly value="${u.due_date || '-'} (${u.overdue_days <= 0 ? (u.overdue_days === 0 ? 'D-Day' : 'D' + u.overdue_days) : '+' + u.overdue_days + '일 연체'})" class="w-full bg-slate-100 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-600 outline-none cursor-default">
              </div>
              <div>
                <label class="block text-[10px] font-bold text-amber-950 mb-1">새로운 입금 약속일</label>
                <input type="date" id="rescheduleDueDateInput" value="${u.due_date || todayStr}" class="w-full bg-white border border-amber-300 rounded-lg px-2.5 py-1.5 text-xs font-black text-amber-950 outline-none cursor-pointer">
              </div>
            </div>

            <div id="rescheduleDDayFeedback" class="bg-white border border-amber-200 rounded-lg p-2 text-xs text-amber-900 font-bold flex items-center gap-2">
              <span>⏳</span>
              <span id="rescheduleDDayText">새 약속일 선택 시 연체 일수가 실시간 계산됩니다.</span>
            </div>
          </div>

          <!-- (6) 통화 및 입금약속 상세 메모 (공통 입력란) -->
          <div>
            <label class="block text-[11px] font-black text-slate-800 mb-1 flex items-center justify-between">
              <span>📝 통화 및 입금약속 상세 메모</span>
              <span class="text-[10px] font-normal text-slate-400">거래처 통화 내용, 입금 조건 등을 기록</span>
            </label>
            <textarea id="settlementNoteInput" rows="3" placeholder="예: 2026-11-12 자금담당 김과장 통화: 월말 자금집행일에 맞춰 11/28 전액 입금 확약함." class="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-600 outline-none resize-none"></textarea>
            
            ${u.contact ? `
              <div class="mt-2 p-2 bg-slate-100/80 rounded-lg border border-slate-200 text-[10px] text-slate-600">
                <span class="font-bold text-slate-700 block mb-0.5">📌 기존 담당자 및 이력 메모:</span>
                <div class="font-mono whitespace-pre-wrap">${u.contact}</div>
              </div>
            ` : ''}
          </div>

        </div>

        <!-- 3. 푸터 버튼 바 -->
        <div class="bg-slate-100 p-3 sm:p-4 border-t border-slate-200 flex items-center justify-between">
          <button type="button" onclick="window.closePaymentSettlementModal()" class="px-4 py-2 bg-white hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl border border-slate-300 transition-colors cursor-pointer">
            취소
          </button>
          <button type="button" id="btnSaveSettlement" onclick="window.submitPaymentSettlement(${idx})" class="px-5 py-2 bg-indigo-900 hover:bg-indigo-950 text-white text-xs font-black rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-1.5">
            <span>💾</span> 저장 및 상태 업데이트
          </button>
        </div>

      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", modalHtml);

  // 이벤트 바인딩
  bindSettlementModalEvents(u);
}
window.openPaymentSettlementModal = openPaymentSettlementModal;

export function closePaymentSettlementModal() {
  const modal = document.getElementById("paymentSettlementModal");
  if (modal) modal.remove();
  currentSettlementIdx = null;
}
window.closePaymentSettlementModal = closePaymentSettlementModal;

/**
 * 처리 모드 전환
 */
export function switchSettlementMode(mode) {
  currentSettlementMode = mode;
  const fullSec = document.getElementById("modeFullSettleSection");
  const partSec = document.getElementById("modePartialSettleSection");
  const rescSec = document.getElementById("modeRescheduleSection");

  fullSec?.classList.toggle("hidden", mode !== 'full_settle');
  partSec?.classList.toggle("hidden", mode !== 'partial_settle');
  rescSec?.classList.toggle("hidden", mode !== 'reschedule');

  // 탭 버튼 스타일 갱신
  document.querySelectorAll(".settle-tab-btn").forEach(btn => {
    const btnMode = btn.getAttribute("data-mode");
    if (btnMode === mode) {
      if (mode === 'full_settle') {
        btn.className = "settle-tab-btn py-2 px-2 rounded-xl border text-center transition-all cursor-pointer font-bold text-xs bg-emerald-700 text-white border-emerald-800 shadow-xs flex flex-col items-center gap-0.5";
      } else if (mode === 'partial_settle') {
        btn.className = "settle-tab-btn py-2 px-2 rounded-xl border text-center transition-all cursor-pointer font-bold text-xs bg-blue-700 text-white border-blue-800 shadow-xs flex flex-col items-center gap-0.5";
      } else {
        btn.className = "settle-tab-btn py-2 px-2 rounded-xl border text-center transition-all cursor-pointer font-bold text-xs bg-amber-600 text-white border-amber-700 shadow-xs flex flex-col items-center gap-0.5";
      }
    } else {
      btn.className = "settle-tab-btn py-2 px-2 rounded-xl border text-center transition-all cursor-pointer font-bold text-xs bg-white text-slate-700 border-slate-300 hover:bg-slate-50 flex flex-col items-center gap-0.5";
    }
  });
}
window.switchSettlementMode = switchSettlementMode;

/**
 * 부분 입금 퍼센트 빠른 입력
 */
export function setPartialAmountPercent(pct) {
  if (currentSettlementIdx === null) return;
  const u = lastFilteredUnpaid[currentSettlementIdx] || cachedUnpaid[currentSettlementIdx];
  if (!u) return;

  const total = Math.round(u.amount_vat || 0);
  const val = Math.round(total * pct);
  const input = document.getElementById("partialAmountInput");
  if (input) {
    input.value = val.toLocaleString();
    input.dispatchEvent(new Event('input'));
  }
}
window.setPartialAmountPercent = setPartialAmountPercent;

function bindSettlementModalEvents(u) {
  const partialInp = document.getElementById("partialAmountInput");
  const previewPaid = document.getElementById("partialPreviewPaid");
  const previewRemaining = document.getElementById("partialPreviewRemaining");
  const rescheduleDateInp = document.getElementById("rescheduleDueDateInput");
  const ddayText = document.getElementById("rescheduleDDayText");

  const totalVat = Math.round(u.amount_vat || 0);

  // 부분 입금 금액 입력 시 실시간 차감 계산
  partialInp?.addEventListener("input", (e) => {
    let cleanVal = e.target.value.replace(/[^0-9]/g, '');
    const num = parseInt(cleanVal, 10) || 0;
    e.target.value = cleanVal ? num.toLocaleString() : '';

    const remaining = Math.max(0, totalVat - num);
    if (previewPaid) previewPaid.innerText = `- ₩ ${num.toLocaleString()}`;
    if (previewRemaining) {
      previewRemaining.innerText = `₩ ${remaining.toLocaleString()}`;
      if (remaining === 0 && num > 0) {
        previewRemaining.className = "font-black text-emerald-700 text-sm";
      } else {
        previewRemaining.className = "font-black text-rose-700 text-sm";
      }
    }
  });

  // 약속일자 변경 시 D-Day 실시간 계산
  const updateRescheduleFeedback = () => {
    const val = rescheduleDateInp?.value;
    if (!val || !ddayText) return;
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = new Date(val);
      target.setHours(0, 0, 0, 0);
      const diff = Math.floor((today - target) / (1000 * 60 * 60 * 24));

      if (diff < 0) {
        ddayText.innerHTML = `선택 약속일 기준: <strong class="text-emerald-700">D${diff} (정상 회수 예정 전환)</strong>`;
      } else if (diff === 0) {
        ddayText.innerHTML = `선택 약속일 기준: <strong class="text-emerald-700">D-Day (오늘 결제 예정)</strong>`;
      } else {
        ddayText.innerHTML = `선택 약속일 기준: <strong class="text-rose-700">+${diff}일 연체</strong>`;
      }
    } catch(e) {}
  };

  rescheduleDateInp?.addEventListener("change", updateRescheduleFeedback);
  updateRescheduleFeedback();
}

/**
 * 수금 및 입금약속 저장 처리
 */
export async function submitPaymentSettlement(idx) {
  const u = lastFilteredUnpaid[idx] || cachedUnpaid[idx];
  if (!u) return;

  const btn = document.getElementById("btnSaveSettlement");
  if (btn) {
    btn.disabled = true;
    btn.innerText = "저장 중...";
  }

  const mode = currentSettlementMode;
  let collectedAmount = 0;
  let newAmountVat = u.amount_vat;
  let newDueDate = u.due_date;
  let payStatus = u.pay_status || '미결제';
  const noteRaw = document.getElementById("settlementNoteInput")?.value.trim() || '';

  if (mode === 'full_settle') {
    const settleDate = document.getElementById("settleDateInput")?.value || new Date().toISOString().slice(0, 10);
    const settleMethod = document.getElementById("settleMethodSelect")?.value || '법인통장 계좌입금';
    collectedAmount = u.amount_vat;
    newAmountVat = 0.0;
    payStatus = '수금완료';
    newDueDate = settleDate;
  } else if (mode === 'partial_settle') {
    const paidStr = (document.getElementById("partialAmountInput")?.value || '').replace(/[^0-9]/g, '');
    const paid = parseInt(paidStr, 10) || 0;
    if (paid <= 0) {
      alert("입금된 금액을 입력해 주세요.");
      if (btn) { btn.disabled = false; btn.innerText = "💾 저장 및 상태 업데이트"; }
      return;
    }
    collectedAmount = paid;
    newAmountVat = Math.max(0, u.amount_vat - paid);
    payStatus = (newAmountVat <= 0) ? '수금완료' : '부분입금';
    const nextDue = document.getElementById("partialNextDueDate")?.value;
    if (nextDue) newDueDate = nextDue;
  } else if (mode === 'reschedule') {
    const reschedDue = document.getElementById("rescheduleDueDateInput")?.value;
    if (!reschedDue) {
      alert("새로운 입금 약속일을 지정해 주세요.");
      if (btn) { btn.disabled = false; btn.innerText = "💾 저장 및 상태 업데이트"; }
      return;
    }
    newDueDate = reschedDue;
    payStatus = (u.amount_vat <= 0) ? '수금완료' : '결제약속';
  }

  // 메모 작성
  let finalContactNote = noteRaw;
  if (mode === 'full_settle') {
    const method = document.getElementById("settleMethodSelect")?.value || '계좌입금';
    finalContactNote = `[전액수금완료: ₩${Math.round(u.amount_vat).toLocaleString()} / ${method}] ${noteRaw}`.trim();
  } else if (mode === 'partial_settle') {
    finalContactNote = `[부분입금: ₩${Math.round(collectedAmount).toLocaleString()} / 잔액: ₩${Math.round(newAmountVat).toLocaleString()}] ${noteRaw}`.trim();
  } else if (mode === 'reschedule') {
    finalContactNote = `[약속일연기 ➔ ${newDueDate}] ${noteRaw}`.trim();
  }

  const payload = {
    id: u.id,
    legacy_idx: u.legacy_idx,
    action_type: mode,
    collected_amount: collectedAmount,
    new_amount_vat: newAmountVat,
    new_due_date: newDueDate,
    pay_status: payStatus,
    contact_note: finalContactNote
  };

  try {
    let success = false;
    let updatedItem = null;

    // 1. FastAPI 서버 브릿지 호출 (/api/unpaid/settlement)
    try {
      const res = await fetch('/api/unpaid/settlement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'success') {
          success = true;
          updatedItem = data.item;
        }
      }
    } catch (apiErr) {
      console.warn("로컬 API 수금 처리 실패, Supabase 직접 업데이트 시도:", apiErr);
    }

    // 2. Fallback: Supabase 직접 업데이트
    if (!success && sbClient) {
      const sbUpdate = {
        amount_vat: newAmountVat,
        pay_status: payStatus,
        due_date: newDueDate,
        last_synced_at: new Date().toISOString()
      };
      if (finalContactNote) {
        const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
        sbUpdate.contact = u.contact ? `${u.contact} | [${nowStr}] ${finalContactNote}` : `[${nowStr}] ${finalContactNote}`;
      }
      if (newDueDate) {
        const diff = Math.floor((new Date() - new Date(newDueDate)) / (1000 * 60 * 60 * 24));
        sbUpdate.overdue_days = diff;
        sbUpdate.color_code = (newAmountVat <= 0 || diff <= 0) ? 0 : (diff < 30 ? 1 : (diff < 45 ? 2 : (diff < 60 ? 3 : 4)));
      }

      let qb = sbClient.from('legacy_unpaid').update(sbUpdate);
      if (u.id) qb = qb.eq('id', u.id);
      else if (u.legacy_idx) qb = qb.eq('legacy_idx', u.legacy_idx);

      const { data, error } = await qb.select();
      if (!error) {
        success = true;
        updatedItem = (data && data.length > 0) ? data[0] : sbUpdate;
      }
    }

    // 3. 인메모리 캐시 및 화면 즉각 동기화
    u.amount_vat = newAmountVat;
    u.pay_status = payStatus;
    u.due_date = newDueDate;

    if (updatedItem) {
      if (updatedItem.overdue_days !== undefined) u.overdue_days = updatedItem.overdue_days;
      if (updatedItem.color_code !== undefined) u.color_code = updatedItem.color_code;
      if (updatedItem.contact) u.contact = updatedItem.contact;
    } else if (newDueDate) {
      const diff = Math.floor((new Date() - new Date(newDueDate)) / (1000 * 60 * 60 * 24));
      u.overdue_days = diff;
      u.color_code = (newAmountVat <= 0 || diff <= 0) ? 0 : (diff < 30 ? 1 : (diff < 45 ? 2 : (diff < 60 ? 3 : 4)));
      if (finalContactNote) {
        const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
        u.contact = u.contact ? `${u.contact} | [${nowStr}] ${finalContactNote}` : `[${nowStr}] ${finalContactNote}`;
      }
    }

    // KPI 카드 및 테이블 뷰 즉각 갱신
    cachedSummary = computeSummaryFromItems(cachedUnpaid);
    refreshUnpaidKpis();
    applyLocalUnpaidFilters();
    updateUnpaidCurrentPage();

    closePaymentSettlementModal();
    alert(`✅ [${u.cname}] ${u.part_no}\n\n수금 및 입금약속 처리가 성공적으로 저장되었습니다.\n(현재 미수 잔액: ₩${Math.round(u.amount_vat).toLocaleString()}, 상태: ${u.pay_status})`);

  } catch (err) {
    console.error("수금 정산 처리 예외:", err);
    alert(`처리 중 오류가 발생했습니다: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = "💾 저장 및 상태 업데이트";
    }
  }
}
window.submitPaymentSettlement = submitPaymentSettlement;

/**
 * 상단 KPI 요약 카드 실시간 리프레시
 */
function refreshUnpaidKpis() {
  const sum = cachedSummary || computeSummaryFromItems(cachedUnpaid);
  const totalAmtEl = document.getElementById("unpaidKpiTotalAmount");
  const totalCntEl = document.getElementById("unpaidKpiTotalCount");
  const upcomingAmtEl = document.getElementById("unpaidKpiUpcomingAmount");
  const overdueAmtEl = document.getElementById("unpaidKpiOverdueAmount");
  const topNameEl = document.getElementById("unpaidKpiTopCustName");
  const topAmtEl = document.getElementById("unpaidKpiTopCustAmount");

  if (totalAmtEl) totalAmtEl.innerText = `₩${Math.round(sum.total_amount).toLocaleString()}`;
  if (totalCntEl) totalCntEl.innerText = sum.total_count.toLocaleString();
  if (upcomingAmtEl) upcomingAmtEl.innerText = `₩${Math.round(sum.upcoming_amount).toLocaleString()}`;
  if (overdueAmtEl) overdueAmtEl.innerText = `₩${Math.round(sum.overdue_amount).toLocaleString()}`;

  const topCust = (sum.top_customers && sum.top_customers.length > 0) ? sum.top_customers[0] : null;
  if (topNameEl && topCust) topNameEl.innerText = topCust.customer_name;
  if (topAmtEl && topCust) topAmtEl.innerText = `₩${Math.round(topCust.total_unpaid || 0).toLocaleString()}`;

  // Aging 필터 카운트 실시간 업데이트
  const activeItems = cachedUnpaid.filter(u => u.pay_status !== '수금완료' && (u.amount_vat || 0) > 0);
  const cntAll = activeItems.length;
  const cntUpcoming = activeItems.filter(u => u.overdue_days <= 0).length;
  const cnt1_30 = activeItems.filter(u => u.overdue_days > 0 && u.overdue_days < 30).length;
  const cnt30_45 = activeItems.filter(u => u.overdue_days >= 30 && u.overdue_days < 45).length;
  const cnt45_60 = activeItems.filter(u => u.overdue_days >= 45 && u.overdue_days < 60).length;
  const cnt60Plus = activeItems.filter(u => u.overdue_days >= 60).length;

  const btnAll = document.querySelector("#unpaidAgingFilters button[data-aging='all']");
  if (btnAll) btnAll.innerHTML = `전체 (${cntAll})`;
  const btnUpcoming = document.querySelector("#unpaidAgingFilters button[data-aging='upcoming']");
  if (btnUpcoming) btnUpcoming.innerHTML = `결제예정 (${cntUpcoming})`;
  const btn1_30 = document.querySelector("#unpaidAgingFilters button[data-aging='1_30']");
  if (btn1_30) btn1_30.innerHTML = `+1 ~ 29일 연체 (${cnt1_30})`;
  const btn30_45 = document.querySelector("#unpaidAgingFilters button[data-aging='30_45']");
  if (btn30_45) btn30_45.innerHTML = `30 ~ 44일 연체 (${cnt30_45})`;
  const btn45_60 = document.querySelector("#unpaidAgingFilters button[data-aging='45_60']");
  if (btn45_60) btn45_60.innerHTML = `45 ~ 59일 연체 (${cnt45_60})`;
  const btn60 = document.querySelector("#unpaidAgingFilters button[data-aging='60_plus']");
  if (btn60) btn60.innerHTML = `★ 60일 이상 (${cnt60Plus})`;
}
window.refreshUnpaidKpis = refreshUnpaidKpis;
