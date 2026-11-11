// public/js/unpaid.js
// 레거시 세일즈 마스터 [FrmUnpaidCustList] 미수금 및 결제예정일 관리 대시보드 모듈
import { sbClient } from './supabase.js';

let cachedUnpaid = [];
let cachedSummary = null;
let cachedSalesReps = [];
let activeAgingFilter = 'all';
let activeSalesRep = 'ALL';
let activeSearchTerm = '';
let activeSortBy = 'due_date_asc';
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
  const totalCount = items.length;
  const totalAmount = items.reduce((a, b) => a + (b.amount_vat || 0), 0);
  const overdueAmount = items.filter(u => u.overdue_days > 0).reduce((a, b) => a + (b.amount_vat || 0), 0);
  const upcomingAmount = items.filter(u => u.overdue_days <= 0).reduce((a, b) => a + (b.amount_vat || 0), 0);

  const custMap = {};
  items.forEach(it => {
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
      qb = qb.order('due_date', { ascending: true });

      const { data, error } = await qb.limit(1500);
      if (!error && data && data.length > 0) {
        cachedUnpaid = data.map(mapSupabaseToUnpaid);
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
      return cachedUnpaid;
    }
  } catch (err) {
    console.error("미수금 목록 패치 에러:", err);
  }
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
        <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2.5">
            <span class="text-2xl">💰</span>
            <div>
              <div class="flex items-center gap-2">
                <h2 class="text-base sm:text-lg font-black tracking-wide uppercase font-sans text-white">결제예정 및 미수금 관리</h2>
                <span class="text-[10px] bg-amber-400 text-slate-950 font-black px-1.5 py-0.5 rounded shadow-xs">FrmUnpaidCustList</span>
              </div>
              <p class="text-[11px] text-indigo-200 font-medium">세일즈 마스터 MS-SQL 연동 채권 에이징(Aging) 및 자금 회수 대시보드</p>
            </div>
          </div>

          <div class="flex items-center gap-2 text-xs">
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
            <div class="text-base sm:text-lg font-black text-slate-900 font-mono">₩${Math.round(sum.total_amount).toLocaleString()}</div>
            <div class="text-[10px] text-slate-500 font-medium mt-0.5">총 <strong class="text-indigo-950">${sum.total_count.toLocaleString()}</strong>건 관리 중</div>
          </div>
        </div>

        <!-- 2) 결제 예정 (D-Day 잔여) -->
        <div class="bg-emerald-50/60 border border-emerald-200 rounded-xl p-3 shadow-xs flex flex-col justify-between">
          <div class="text-[11px] font-bold text-emerald-800 flex items-center justify-between">
            <span>결제 예정 (D-Day 잔여)</span>
            <span class="text-emerald-600 text-xs">⏳</span>
          </div>
          <div class="mt-1">
            <div class="text-base sm:text-lg font-black text-emerald-700 font-mono">₩${Math.round(sum.upcoming_amount).toLocaleString()}</div>
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
            <div class="text-base sm:text-lg font-black text-rose-700 font-mono">₩${Math.round(sum.overdue_amount).toLocaleString()}</div>
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
            <div class="text-sm font-black text-indigo-950 truncate" title="${topCust ? topCust.customer_name : '-'}">${topCust ? topCust.customer_name : '-'}</div>
            <div class="text-xs font-bold text-indigo-800 font-mono mt-0.5">₩${topCust ? Math.round(topCust.total_unpaid || topCust.total_amount || 0).toLocaleString() : '0'}</div>
          </div>
        </div>
      </div>

      <!-- 3. 레거시 세일즈 마스터 4단계 에이징(Aging) 색상 필터 탭 -->
      <div class="bg-slate-100/70 p-2 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-1.5 flex-wrap text-xs font-bold select-none" id="unpaidAgingFilters">
          <span class="text-[11px] font-bold text-slate-500 mr-1 flex items-center gap-1">
            <span>🎨</span> 미수일 구분:
          </span>
          <button type="button" data-aging="all" 
                  class="aging-btn px-2.5 py-1 rounded-lg border text-[11px] transition-all cursor-pointer ${activeAgingFilter === 'all' ? 'bg-indigo-900 text-white border-indigo-950 shadow-xs' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}">
            전체 (${cntAll})
          </button>
          <button type="button" data-aging="upcoming" 
                  class="aging-btn px-2.5 py-1 rounded-lg border text-[11px] transition-all cursor-pointer ${activeAgingFilter === 'upcoming' ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs' : 'bg-emerald-50/70 text-emerald-800 border-emerald-200 hover:bg-emerald-100'}">
            결제예정 (${cntUpcoming})
          </button>
          <button type="button" data-aging="1_30" 
                  class="aging-btn px-2.5 py-1 rounded-lg border text-[11px] transition-all cursor-pointer ${activeAgingFilter === '1_30' ? 'bg-amber-500 text-white border-amber-600 shadow-xs' : 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100'}">
            +1 ~ 29일 연체 (${cnt1_30})
          </button>
          <button type="button" data-aging="30_45" 
                  class="aging-btn px-2.5 py-1 rounded-lg border text-[11px] transition-all cursor-pointer ${activeAgingFilter === '30_45' ? 'bg-orange-500 text-white border-orange-600 shadow-xs' : 'bg-orange-50 text-orange-900 border-orange-200 hover:bg-orange-100'}">
            30 ~ 44일 연체 (${cnt30_45})
          </button>
          <button type="button" data-aging="45_60" 
                  class="aging-btn px-2.5 py-1 rounded-lg border text-[11px] transition-all cursor-pointer ${activeAgingFilter === '45_60' ? 'bg-rose-500 text-white border-rose-600 shadow-xs' : 'bg-rose-50 text-rose-900 border-rose-200 hover:bg-rose-100'}">
            45 ~ 59일 연체 (${cnt45_60})
          </button>
          <button type="button" data-aging="60_plus" 
                  class="aging-btn px-2.5 py-1 rounded-lg border text-[11px] transition-all cursor-pointer ${activeAgingFilter === '60_plus' ? 'bg-red-700 text-white border-red-800 shadow-xs' : 'bg-red-100 text-red-950 border-red-300 hover:bg-red-200'}">
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
      <div class="grid grid-cols-1 md:grid-cols-4 gap-2 items-center">
        <!-- 검색창 -->
        <div class="md:col-span-2 relative">
          <input type="text" id="unpaidLiveFilter" value="${activeSearchTerm}" placeholder="고객사명, 품번(Part#), PO번호, 담당자, 영업담당 검색..." 
                 class="w-full pl-7 pr-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-600 outline-none">
          <span class="absolute left-2.5 top-2 text-slate-400 text-xs">🔍</span>
        </div>

        <!-- 영업담당자 드롭다운 필터 -->
        <div class="flex items-center gap-1 text-xs">
          <span class="text-slate-500 font-bold whitespace-nowrap text-[11px]">담당:</span>
          <select id="unpaidSalesRepSelect" class="w-full bg-white text-slate-800 text-[11px] px-2 py-1.5 rounded-lg border border-slate-300 font-semibold outline-none cursor-pointer">
            <option value="ALL" ${activeSalesRep === 'ALL' ? 'selected' : ''}>(전체 영업사원)</option>
            ${cachedSalesReps.map(rep => `<option value="${rep}" ${activeSalesRep === rep ? 'selected' : ''}>${rep}</option>`).join('')}
          </select>
        </div>

        <!-- 정렬 순서 -->
        <div class="flex items-center gap-1 text-xs">
          <span class="text-slate-500 font-bold whitespace-nowrap text-[11px]">정렬:</span>
          <select id="unpaidSortSelect" class="w-full bg-white text-slate-800 text-[11px] px-2 py-1.5 rounded-lg border border-slate-300 font-semibold outline-none cursor-pointer">
            <option value="due_date_asc" ${activeSortBy === 'due_date_asc' ? 'selected' : ''}>결제예정일 빠른순</option>
            <option value="overdue_desc" ${activeSortBy === 'overdue_desc' ? 'selected' : ''}>연체일수 높은순</option>
            <option value="amount_desc" ${activeSortBy === 'amount_desc' ? 'selected' : ''}>미수금액 큰순</option>
            <option value="out_date_desc" ${activeSortBy === 'out_date_desc' ? 'selected' : ''}>출하일자 최근순</option>
          </select>
        </div>
      </div>

      <!-- 5. 미수금 데이터 테이블 -->
      <div class="overflow-x-auto max-h-[66vh] overflow-y-auto border border-slate-200 rounded-xl shadow-xs">
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
              <th class="py-2.5 px-2 text-center whitespace-nowrap w-14">상태</th>
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

  renderUnpaidPagination(total, totalPages);
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
        <td colspan="13" class="text-center py-12 text-slate-500">
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
        <td class="py-1.5 px-2 text-center font-semibold text-rose-600 whitespace-nowrap">${u.pay_status || '미결제'}</td>
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
  } else if (sortBy === 'out_date_desc') {
    lastFilteredUnpaid.sort((a, b) => String(b.out_dt || '').localeCompare(String(a.out_dt || '')));
  } else {
    // due_date_asc (기본)
    lastFilteredUnpaid.sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));
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
