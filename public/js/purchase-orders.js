/**
 * 🚢 purchase-orders.js
 * 발주(PO) 및 입고 예정(ETA) 조회 모듈 (MS-SQL DPOFile 2,828건 실시간 연동)
 */

let cachedPoSummary = null;
let currentPoList = [];
let activePoStatus = 'PO'; // 기본값: 입고대기(PO)
let activePoSearch = '';
let activePoSales = 'ALL';
let currentPoPage = 1;
const PO_PAGE_SIZE = 50;

export async function fetchPurchaseOrdersSummary() {
  try {
    const res = await fetch('/api/purchase-orders/summary');
    const data = await res.json();
    if (data.status === 'success' && data.summary) {
      cachedPoSummary = data.summary;
      // 상단 헤더 배지 업데이트
      const badge = document.getElementById('poPendingBadge');
      if (badge) {
        const pendingCnt = cachedPoSummary.pending_count || 0;
        badge.textContent = `${pendingCnt}건`;
        badge.classList.toggle('hidden', pendingCnt === 0);
      }
      return cachedPoSummary;
    }
  } catch (err) {
    console.warn('[PO] 요약 정보 로드 실패:', err);
  }
  return null;
}

export async function fetchPurchaseOrders(params = {}) {
  try {
    const query = new URLSearchParams();
    if (params.status && params.status !== 'ALL') query.set('status', params.status);
    if (params.query) query.set('q', params.query);
    if (params.sales_rep && params.sales_rep !== 'ALL') query.set('sales_rep', params.sales_rep);
    if (params.part_no) query.set('part_no', params.part_no);
    if (params.limit) query.set('limit', params.limit);

    const res = await fetch(`/api/purchase-orders?${query.toString()}`);
    const data = await res.json();
    if (data.status === 'success') {
      currentPoList = data.orders || [];
      return currentPoList;
    }
  } catch (err) {
    console.error('[PO] 발주 목록 로드 에러:', err);
  }
  return [];
}

export async function openPurchaseOrdersModal(initialStatus = 'PO') {
  activePoStatus = initialStatus;
  activePoSearch = '';
  currentPoPage = 1;

  const modalId = 'purchaseOrdersModal';
  let modal = document.getElementById(modalId);
  if (!modal) {
    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'fixed inset-0 bg-slate-900/70 backdrop-blur-xs z-[99990] flex items-center justify-center p-2 sm:p-4 overflow-hidden';
    modal.onclick = (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    };
    document.body.appendChild(modal);
  }

  modal.classList.remove('hidden');
  modal.innerHTML = `
    <div class="bg-white w-full max-w-7xl h-[93dvh] rounded-2xl shadow-2xl border border-slate-300 flex flex-col overflow-hidden" onclick="event.stopPropagation()">
      
      <!-- 상단 헤더 (모바일·데스크톱 완벽 대응) -->
      <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-md shrink-0">
        <div class="flex items-start sm:items-center justify-between gap-2 w-full sm:w-auto">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-blue-500/20 border border-blue-400/40 flex items-center justify-center text-lg sm:text-xl shadow-inner shrink-0">
              🚢
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-1.5 flex-wrap">
                <h2 class="text-sm sm:text-base font-black tracking-wide truncate">발주(PO) 및 입고 예정(ETA)</h2>
                <span class="hidden sm:inline-block text-[10px] bg-blue-500/30 text-blue-300 px-2 py-0.5 rounded-full font-mono border border-blue-400/30">DPOFile + 전자결재 연동</span>
              </div>
              <p class="text-[10px] sm:text-xs text-slate-300 mt-0.5 truncate">공식 매입 발주 및 전자결재 승인 발주의 ETA·입고 현황</p>
            </div>
          </div>
          <button type="button" onclick="document.getElementById('${modalId}').classList.add('hidden')" class="sm:hidden w-8 h-8 rounded-lg bg-white/15 hover:bg-white/25 text-white font-bold flex items-center justify-center cursor-pointer shrink-0">✕</button>
        </div>
        <div class="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5 sm:pb-0 shrink-0">
          ${(typeof window.isCsOrAdminUser === 'function' && window.isCsOrAdminUser()) ? `
            <button type="button" onclick="window.openDirectPoCrudModal && window.openDirectPoCrudModal(null)" 
                    class="shrink-0 px-2.5 sm:px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-900 text-[11px] sm:text-xs font-black rounded-lg shadow-sm flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap">
              <span>➕</span> 직접 발주
            </button>
          ` : ''}
          <button type="button" id="poNewRequisitionBtn" onclick="window.goToNewPurchaseRequisition && window.goToNewPurchaseRequisition()" 
                  class="shrink-0 px-2.5 sm:px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] sm:text-xs font-bold rounded-lg shadow-sm flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap">
            <span>📑</span> 구매품의
          </button>
          <button type="button" id="poExportExcelBtn" class="shrink-0 px-2.5 sm:px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] sm:text-xs font-bold rounded-lg shadow-sm flex items-center gap-1 cursor-pointer whitespace-nowrap">
            <span>📥</span> Excel
          </button>
          <button type="button" onclick="document.getElementById('${modalId}').classList.add('hidden')" class="hidden sm:flex w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold items-center justify-center cursor-pointer transition-colors shrink-0">
            ✕
          </button>
        </div>
      </div>

      <!-- 업무 구분 안내 바 (데스크톱 전용) -->
      <div class="hidden sm:flex bg-indigo-50/90 border-b border-indigo-200/80 px-6 py-2 items-center justify-between text-xs text-indigo-950 font-medium shrink-0">
        <div class="flex items-center gap-2">
          <span class="text-sm">💡</span>
          <span><strong>[업무 구분 안내]</strong> 본 화면은 매입처(공급사)에 넣은 <strong>구매 발주(PO) 및 전자결재 승인 발주</strong>를 통합 관리합니다. 고객사로부터 받은 수주(주문) 건은 상단 <strong>[Tab 1/2 수주·출하 관리]</strong>에서 확인하실 수 있습니다.</span>
        </div>
      </div>

      <!-- 요약 KPI 지표 카드 4종 (모바일 콤팩트 2x2 / 데스크톱 4열) -->
      <div id="poKpiBar" class="p-2.5 sm:p-4 bg-slate-50 border-b border-slate-200 grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 shrink-0">
        <div class="bg-white p-2.5 sm:p-3 rounded-xl border border-blue-200 shadow-xs flex items-center justify-between">
          <div class="min-w-0">
            <div class="text-[10px] sm:text-[11px] font-bold text-slate-500 truncate">🚢 입고대기(PO)</div>
            <div id="kpiPendingCount" class="text-base sm:text-lg font-black text-blue-700 mt-0.5">로딩중...</div>
            <div id="kpiPendingQty" class="text-[9px] sm:text-[10px] text-slate-500 mt-0.5 truncate">-</div>
          </div>
          <span class="text-lg sm:text-2xl shrink-0">⏳</span>
        </div>
        <div class="bg-white p-2.5 sm:p-3 rounded-xl border border-emerald-200 shadow-xs flex items-center justify-between">
          <div class="min-w-0">
            <div class="text-[10px] sm:text-[11px] font-bold text-slate-500 truncate">✅ 입고완료(IN)</div>
            <div id="kpiArrivedCount" class="text-base sm:text-lg font-black text-emerald-700 mt-0.5">-</div>
            <div class="text-[9px] sm:text-[10px] text-slate-500 mt-0.5 truncate">정상 재고 반영</div>
          </div>
          <span class="text-lg sm:text-2xl shrink-0">📦</span>
        </div>
        <div class="bg-white p-2.5 sm:p-3 rounded-xl border border-purple-200 shadow-xs flex items-center justify-between">
          <div class="min-w-0">
            <div class="text-[10px] sm:text-[11px] font-bold text-slate-500 truncate">📊 누적 발주</div>
            <div id="kpiTotalCount" class="text-base sm:text-lg font-black text-purple-700 mt-0.5">-</div>
            <div class="text-[9px] sm:text-[10px] text-slate-500 mt-0.5 truncate">전체 발주 기록</div>
          </div>
          <span class="text-lg sm:text-2xl shrink-0">📋</span>
        </div>
        <div class="bg-white p-2.5 sm:p-3 rounded-xl border border-rose-200 shadow-xs flex items-center justify-between">
          <div class="min-w-0">
            <div class="text-[10px] sm:text-[11px] font-bold text-slate-500 truncate">🚫 취소(CNL)</div>
            <div id="kpiCnlCount" class="text-base sm:text-lg font-black text-rose-700 mt-0.5">-</div>
            <div class="text-[9px] sm:text-[10px] text-slate-500 mt-0.5 truncate">발주 취소 내역</div>
          </div>
          <span class="text-lg sm:text-2xl shrink-0">❌</span>
        </div>
      </div>

      <!-- 필터 및 검색 툴바 -->
      <div class="p-2.5 sm:p-3 bg-white border-b border-slate-200 flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-2 sm:gap-3 shrink-0">
        <!-- 상태 토글 버튼 (모바일 1열 가로 스와이프) -->
        <div class="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5 sm:pb-0" id="poStatusTabs">
          <button type="button" data-status="PO" class="po-status-tab shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${activePoStatus === 'PO' ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">
            🚢 입고대기(PO)
          </button>
          <button type="button" data-status="IN" class="po-status-tab shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${activePoStatus === 'IN' ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">
            ✅ 입고완료(IN)
          </button>
          <button type="button" data-status="ALL" class="po-status-tab shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${activePoStatus === 'ALL' ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">
            전체(ALL)
          </button>
          <button type="button" data-status="CNL" class="po-status-tab shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${activePoStatus === 'CNL' ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">
            취소(CNL)
          </button>
        </div>

        <!-- 실시간 검색 및 필터 -->
        <div class="flex items-center gap-2 flex-1 sm:max-w-lg">
          <div class="relative w-full">
            <input type="text" id="poSearchInput" value="${activePoSearch}" placeholder="품번, 발주번호, 공급사, 실수요처 검색..." 
                   class="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none">
            <span class="absolute left-2.5 top-2.5 sm:top-2 text-slate-400 text-xs">🔍</span>
          </div>
          <button type="button" id="poRefreshBtn" class="px-2.5 sm:px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg whitespace-nowrap cursor-pointer shrink-0">
            🔄
          </button>
        </div>
      </div>

      <!-- 데이터 영역 (모바일 전용 카드 뷰 + 데스크톱 테이블 뷰) -->
      <div id="poListScrollWrap" class="flex-1 overflow-x-auto overflow-y-auto bg-slate-50/70 md:bg-white">
        <!-- 모바일 전용 카드 뷰 -->
        <div id="poMobileCards" class="block md:hidden p-3 space-y-2.5">
          <div class="py-10 text-center text-slate-400 text-xs">⏳ 발주 데이터를 불러오는 중...</div>
        </div>
        <!-- 데스크톱 전용 테이블 뷰 -->
        <table class="hidden md:table w-full text-left text-xs border-collapse">
          <thead class="bg-slate-800 text-white sticky top-0 z-10 text-[11px] font-bold">
            <tr>
              <th class="py-2.5 px-2 text-center w-10">#</th>
              <th class="py-2.5 px-2.5 text-center whitespace-nowrap w-24">상태</th>
              <th class="py-2.5 px-2.5 text-center whitespace-nowrap w-24">발주일자</th>
              <th class="py-2.5 px-3 text-left min-w-[130px]">발주번호 (PO NO)</th>
              <th class="py-2.5 px-3 text-left min-w-[200px]">품번 (Part#)</th>
              <th class="py-2.5 px-2.5 text-left min-w-[80px]">제조사</th>
              <th class="py-2.5 px-2.5 text-right whitespace-nowrap w-20">수량</th>
              <th class="py-2.5 px-2.5 text-right whitespace-nowrap min-w-[85px]">발주단가</th>
              <th class="py-2.5 px-2.5 text-right whitespace-nowrap min-w-[95px]">발주금액</th>
              <th class="py-2.5 px-2.5 text-center whitespace-nowrap w-24">입고예정(CRD/ETA)</th>
              <th class="py-2.5 px-3 text-left min-w-[120px]">매입처(공급사)</th>
              <th class="py-2.5 px-3 text-left min-w-[110px]">실수요처(납품처)</th>
              <th class="py-2.5 px-2 text-center whitespace-nowrap w-16">영업담당</th>
              <th class="py-2.5 px-3 text-left min-w-[120px]">비고</th>
              <th class="py-2.5 px-2 text-center whitespace-nowrap w-16">관리</th>
            </tr>
          </thead>
          <tbody id="poTableBody" class="divide-y divide-slate-200">
            <tr>
              <td colspan="15" class="py-12 text-center text-slate-400">데이터를 불러오는 중입니다...</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 하단 상태 및 페이징 바 -->
      <div class="px-6 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
        <div id="poCountInfo" class="font-medium">
          조회 결과: 0건
        </div>
        <div id="poPagination" class="flex items-center gap-1">
          <!-- 페이징 버튼 생성 -->
        </div>
      </div>

    </div>
  `;

  bindPoModalEvents();
  await loadPoData();
}

async function loadPoData() {
  const tbody = document.getElementById('poTableBody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="15" class="py-12 text-center text-slate-400">⏳ 발주 데이터를 조회하고 있습니다...</td></tr>`;
  }

  // 1. 요약 정보 로드
  const summary = await fetchPurchaseOrdersSummary();
  if (summary) {
    const kpiPendingCount = document.getElementById('kpiPendingCount');
    const kpiPendingQty = document.getElementById('kpiPendingQty');
    const kpiArrivedCount = document.getElementById('kpiArrivedCount');
    const kpiTotalCount = document.getElementById('kpiTotalCount');
    const kpiCnlCount = document.getElementById('kpiCnlCount');

    if (kpiPendingCount) kpiPendingCount.textContent = `${summary.pending_count.toLocaleString()}건`;
    if (kpiPendingQty) kpiPendingQty.textContent = `총 ${summary.pending_qty.toLocaleString()}개 입고 대기`;
    if (kpiArrivedCount) kpiArrivedCount.textContent = `${summary.arrived_count.toLocaleString()}건`;
    if (kpiTotalCount) kpiTotalCount.textContent = `${summary.total_count.toLocaleString()}건`;
    if (kpiCnlCount) kpiCnlCount.textContent = `${summary.cnl_count.toLocaleString()}건`;
  }

  // 2. 발주 목록 로드
  const orders = await fetchPurchaseOrders({
    status: activePoStatus,
    query: activePoSearch,
    sales_rep: activePoSales,
    limit: 300
  });

  renderPoTable(orders);
}

function renderPoTable(orders) {
  const tbody = document.getElementById('poTableBody');
  const mobileWrap = document.getElementById('poMobileCards');
  const countInfo = document.getElementById('poCountInfo');
  if (!tbody && !mobileWrap) return;

  if (!orders || orders.length === 0) {
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="15" class="py-16 text-center text-slate-400">
            <div class="text-3xl mb-2">🔍</div>
            <div class="font-bold text-sm text-slate-600">조건에 일치하는 발주 내역이 없습니다.</div>
            <div class="text-xs text-slate-400 mt-1">검색어나 상태 필터를 변경해 보세요.</div>
          </td>
        </tr>
      `;
    }
    if (mobileWrap) {
      mobileWrap.innerHTML = `<div class="py-12 text-center text-slate-400 text-xs bg-white rounded-xl border border-slate-200">🔍 조건에 일치하는 발주 내역이 없습니다.</div>`;
    }
    if (countInfo) countInfo.textContent = '조회 결과: 0건';
    renderPoPagination(0, 1);
    return;
  }

  const totalPages = Math.ceil(orders.length / PO_PAGE_SIZE);
  if (currentPoPage > totalPages) currentPoPage = 1;
  const startIdx = (currentPoPage - 1) * PO_PAGE_SIZE;
  const pageItems = orders.slice(startIdx, startIdx + PO_PAGE_SIZE);
  window._lastRenderedPoPageItems = pageItems;

  if (countInfo) {
    countInfo.innerHTML = `총 <strong class="text-blue-700">${orders.length.toLocaleString()}건</strong> 중 ${startIdx + 1} ~ ${Math.min(startIdx + PO_PAGE_SIZE, orders.length)}건 표시`;
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const canEdit = (typeof window.isCsOrAdminUser === 'function') ? window.isCsOrAdminUser() : false;
  const mobileCardsHtml = [];

  tbody.innerHTML = pageItems.map((o, idx) => {
    const rowNo = startIdx + idx + 1;
    const isWebApproval = o.source === 'WEB_APPROVAL';
    const isPending = o.status === 'PO';
    const isArrived = o.status === 'IN';
    const isCnl = o.status === 'CNL';

    // 상태 뱃지
    let statusBadge = '';
    if (isWebApproval && isArrived) {
      statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300 inline-flex items-center justify-center gap-1">✅ 입고완료(웹)</span>`;
    } else if (isWebApproval) {
      statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-indigo-100 text-indigo-900 border border-indigo-400 shadow-xs inline-flex items-center justify-center gap-1"><span>📑</span> 전자결재 승인</span>`;
    } else if (isPending) {
      statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-100 text-blue-800 border border-blue-300 inline-flex items-center justify-center gap-1">🚢 입고대기</span>`;
    } else if (isArrived) {
      statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300 inline-flex items-center justify-center gap-1">✅ 입고완료</span>`;
    } else {
      statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-300 inline-flex items-center justify-center gap-1">취소</span>`;
    }

    // 입고예정일 D-Day 계산
    let etaDisplay = o.eta_date || '-';
    if (isPending && o.eta_date && /^\d{4}-\d{2}-\d{2}$/.test(o.eta_date)) {
      const diffDays = Math.ceil((new Date(o.eta_date) - new Date(todayStr)) / (1000 * 60 * 60 * 24));
      if (diffDays === 0) {
        etaDisplay = `<span class="text-rose-600 font-bold">${o.eta_date} (오늘 입고)</span>`;
      } else if (diffDays > 0) {
        etaDisplay = `<span class="text-blue-700 font-bold">${o.eta_date} (D-${diffDays})</span>`;
      } else {
        etaDisplay = `<span class="text-red-700 font-bold">${o.eta_date} (+${Math.abs(diffDays)}일 지연)</span>`;
      }
    }

    const curr = o.currency || 'KRW';
    const isForeign = curr.includes('$') || curr.includes('US') || o.foreign_up > 0;
    const upStr = isForeign
      ? `$${(o.foreign_up || o.unit_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
      : `₩${Math.round(o.unit_price).toLocaleString()}`;
    const amtStr = isForeign
      ? `$${(o.foreign_amount || o.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `₩${Math.round(o.amount).toLocaleString()}`;

    // 모바일 카드 HTML 축적
    mobileCardsHtml.push(`
      <div class="bg-white rounded-xl border ${isWebApproval ? 'border-indigo-300 ring-1 ring-indigo-100' : 'border-slate-200'} p-3 shadow-2xs space-y-2 text-xs">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-[10px] font-mono text-slate-400">#${rowNo}</span>
              ${statusBadge}
              <span class="text-[10px] font-mono text-slate-500">${o.po_dt || '-'}</span>
            </div>
            <div class="font-black text-sm text-slate-900 font-mono mt-1 break-all">${o.part_no || '-'}</div>
            <div class="text-[11px] text-slate-500 font-semibold">${o.maker || '-'} · PO: <span class="font-mono text-slate-700">${o.po_no || '-'}</span></div>
          </div>
          <div class="text-right shrink-0">
            <div class="font-black text-sm text-blue-700 font-mono">${amtStr}</div>
            <div class="text-[10px] text-slate-500 font-mono">${Number(o.qty || 0).toLocaleString()} EA · ${upStr}</div>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-1.5 bg-slate-50 p-2 rounded-lg border border-slate-100 text-[11px]">
          <div><span class="text-[9px] text-slate-400 block font-semibold">입고예정 (ETA)</span><div class="font-mono">${etaDisplay}</div></div>
          <div><span class="text-[9px] text-slate-400 block font-semibold">담당 영업</span><div class="font-bold text-slate-800">${o.sales_rep || '-'}</div></div>
          <div><span class="text-[9px] text-slate-400 block font-semibold">매입처 (공급사)</span><div class="truncate text-slate-700">${o.supplier_name || '-'}</div></div>
          <div><span class="text-[9px] text-slate-400 block font-semibold">실수요처</span><div class="truncate font-bold text-indigo-900">${o.real_cust || o.end_cust || '-'}</div></div>
          ${o.remark ? `<div class="col-span-2 text-[10px] text-slate-500 truncate">💬 ${o.remark}</div>` : ''}
        </div>
        <div class="flex items-center justify-between gap-1.5 pt-1 border-t border-slate-100">
          <button type="button" onclick="window.openPriceHistoryModal && window.openPriceHistoryModal('${(o.part_no || '').replace(/'/g, "\\'")}')" 
                  class="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg border border-indigo-200 font-bold text-[11px] cursor-pointer">
            📈 단가이력
          </button>
          <div class="flex items-center gap-1">
            ${(isPending && canEdit) ? `
              <button type="button" onclick="window.receivePoByIdx && window.receivePoByIdx(${idx})"
                      class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[11px] cursor-pointer">
                📦 입고완료
              </button>
            ` : ''}
            ${(isWebApproval && canEdit) ? `
              <button type="button" onclick="window.editWebPoByIdx && window.editWebPoByIdx(${idx})"
                      class="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg font-bold text-[11px] cursor-pointer">✏️</button>
              <button type="button" onclick="window.deleteWebPurchaseOrder && window.deleteWebPurchaseOrder('${o.po_no}', '${(o.part_no || '').replace(/'/g, "\\'")}')"
                      class="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-300 rounded-lg font-bold text-[11px] cursor-pointer">✕</button>
            ` : ''}
          </div>
        </div>
      </div>
    `);

    return `
      <tr class="hover:bg-blue-50/60 transition-colors border-b border-slate-200 text-[11px] ${isWebApproval ? 'bg-indigo-50/40 border-l-4 border-l-indigo-600' : (isPending ? 'bg-blue-50/20' : '')}">
        <td class="py-2 px-2 text-center text-slate-400 font-mono">${rowNo}</td>
        <td class="py-2 px-2 text-center whitespace-nowrap">${statusBadge}</td>
        <td class="py-2 px-2 text-center font-mono text-slate-700 whitespace-nowrap">${o.po_dt || '-'}</td>
        <td class="py-2 px-3 font-mono font-bold text-slate-800 whitespace-nowrap">
          <div class="flex items-center gap-1.5">
            <span class="truncate max-w-[130px]" title="${o.po_no}">${o.po_no}</span>
            ${isWebApproval ? `
              <span class="px-1.5 py-0.2 rounded text-[9px] font-black bg-indigo-100 text-indigo-800 border border-indigo-300 shrink-0">웹승인</span>
              <button type="button" 
                      onclick="event.stopPropagation(); window.deleteWebPurchaseOrder && window.deleteWebPurchaseOrder('${o.po_no}', '${(o.part_no || '').replace(/'/g, "\\'")}')" 
                      class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-300 shrink-0 cursor-pointer transition-colors shadow-2xs flex items-center gap-0.5"
                      title="이 웹 발주 내역 삭제">
                <span>✕</span> 삭제
              </button>
            ` : ''}
          </div>
        </td>
        <td class="py-2 px-3">
          <div class="flex items-center gap-1.5">
            <span class="font-black text-slate-900 truncate max-w-[170px]" title="${o.part_no}">${o.part_no}</span>
            <button type="button" onclick="event.stopPropagation(); window.openPriceHistoryModal && window.openPriceHistoryModal('${o.part_no.replace(/'/g, "\\'")}')" 
                    class="px-1.5 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded border border-indigo-200 font-bold text-[10px] cursor-pointer shrink-0" title="과거 매입·판매·견적 단가 이력 추적">
              📈 이력
            </button>
          </div>
        </td>
        <td class="py-2 px-2.5 font-bold text-slate-700">${o.maker || '-'}</td>
        <td class="py-2 px-2.5 text-right font-black text-slate-900 whitespace-nowrap">${o.qty.toLocaleString()} EA</td>
        <td class="py-2 px-2.5 text-right font-mono font-semibold text-slate-800 whitespace-nowrap">${upStr}</td>
        <td class="py-2 px-2.5 text-right font-mono font-bold text-blue-700 whitespace-nowrap">${amtStr}</td>
        <td class="py-2 px-2.5 text-center font-mono whitespace-nowrap">${etaDisplay}</td>
        <td class="py-2 px-3 text-slate-800 font-medium truncate max-w-[130px]" title="${o.supplier_name}">${o.supplier_name || '-'}</td>
        <td class="py-2 px-3 text-indigo-900 font-bold truncate max-w-[120px]" title="${o.real_cust || o.end_cust}">${o.real_cust || o.end_cust || '-'}</td>
        <td class="py-2 px-2 text-center font-bold text-slate-700 whitespace-nowrap">${o.sales_rep || '-'}</td>
        <td class="py-2 px-3 text-slate-500 truncate max-w-[140px]" title="${o.remark}">${o.remark || '-'}</td>
        <td class="py-2 px-2 text-center whitespace-nowrap">
          <div class="inline-flex items-center gap-1">
            ${(o.status === 'PO' && typeof window.isCsOrAdminUser === 'function' && window.isCsOrAdminUser()) ? `
              <button type="button"
                      onclick="event.stopPropagation(); window.receivePoByIdx && window.receivePoByIdx(${idx})"
                      class="px-2 py-0.5 text-[10px] font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 rounded shadow-2xs cursor-pointer transition-colors"
                      title="실물 입고 처리 및 재고 마스터 자동 반영">
                📦 입고
              </button>
            ` : ''}
            ${(isWebApproval && typeof window.isCsOrAdminUser === 'function' && window.isCsOrAdminUser()) ? `
              <button type="button"
                      onclick="event.stopPropagation(); window.editWebPoByIdx && window.editWebPoByIdx(${idx})"
                      class="px-1.5 py-0.5 text-[10px] font-bold bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded shadow-2xs cursor-pointer transition-colors"
                      title="웹 발주 내역 수정">
                ✏️
              </button>
              <button type="button" 
                      onclick="event.stopPropagation(); window.deleteWebPurchaseOrder && window.deleteWebPurchaseOrder('${o.po_no}', '${(o.part_no || '').replace(/'/g, "\\'")}')" 
                      class="px-1.5 py-0.5 text-[10px] font-bold bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-300 rounded shadow-2xs cursor-pointer transition-colors"
                      title="웹 승인 발주 내역 삭제">
                ✕
              </button>
            ` : (!isWebApproval && o.status !== 'PO' ? `<span class="text-slate-300 font-mono text-[10px]" title="사내 ERP 전산 원장 직접 관리">-</span>` : '')}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (mobileWrap) {
    mobileWrap.innerHTML = mobileCardsHtml.join('');
  }
  const scrollWrap = document.getElementById('poListScrollWrap');
  if (scrollWrap) scrollWrap.scrollTop = 0;

  renderPoPagination(orders.length, totalPages);
}

function renderPoPagination(total, totalPages) {
  const container = document.getElementById('poPagination');
  if (!container) return;

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = `
    <button type="button" class="po-page-btn px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 text-xs font-bold text-slate-700 disabled:opacity-40 cursor-pointer" 
            data-page="${currentPoPage - 1}" ${currentPoPage === 1 ? 'disabled' : ''}>이전</button>
  `;

  const maxVisible = 5;
  let startP = Math.max(1, currentPoPage - Math.floor(maxVisible / 2));
  let endP = Math.min(totalPages, startP + maxVisible - 1);
  if (endP - startP < maxVisible - 1) {
    startP = Math.max(1, endP - maxVisible + 1);
  }

  for (let p = startP; p <= endP; p++) {
    html += `
      <button type="button" class="po-page-btn px-2.5 py-1 rounded text-xs font-bold cursor-pointer transition-colors ${p === currentPoPage ? 'bg-blue-600 text-white shadow-xs' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'}" 
              data-page="${p}">${p}</button>
    `;
  }

  html += `
    <button type="button" class="po-page-btn px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 text-xs font-bold text-slate-700 disabled:opacity-40 cursor-pointer" 
            data-page="${currentPoPage + 1}" ${currentPoPage === totalPages ? 'disabled' : ''}>다음</button>
  `;

  container.innerHTML = html;

  container.querySelectorAll('.po-page-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.page);
      if (p && p !== currentPoPage && p >= 1 && p <= totalPages) {
        currentPoPage = p;
        renderPoTable(currentPoList);
      }
    });
  });
}

function bindPoModalEvents() {
  // 상태 탭 클릭
  const statusTabs = document.querySelectorAll('.po-status-tab');
  statusTabs.forEach(tab => {
    tab.addEventListener('click', async () => {
      statusTabs.forEach(t => {
        t.classList.remove('bg-blue-600', 'text-white', 'shadow-xs');
        t.classList.add('bg-slate-100', 'text-slate-700');
      });
      tab.classList.add('bg-blue-600', 'text-white', 'shadow-xs');
      tab.classList.remove('bg-slate-100', 'text-slate-700');

      activePoStatus = tab.dataset.status;
      currentPoPage = 1;
      await loadPoData();
    });
  });

  // 검색 디바운스
  const searchInput = document.getElementById('poSearchInput');
  let debounceTimer;
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        activePoSearch = e.target.value.trim();
        currentPoPage = 1;
        await loadPoData();
      }, 250);
    });
  }

  // 새로고침 버튼
  const refreshBtn = document.getElementById('poRefreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      await loadPoData();
    });
  }

  // Excel 다운로드
  const excelBtn = document.getElementById('poExportExcelBtn');
  if (excelBtn) {
    excelBtn.addEventListener('click', () => {
      exportPoToCsv(currentPoList);
    });
  }
}

function exportPoToCsv(items) {
  if (!items || items.length === 0) {
    alert('내보낼 발주 내역이 없습니다.');
    return;
  }

  const headers = ['발주일자', '발주번호', '품번', '제조사', '수량', '발주단가', '발주금액', '통화', '입고예정일', '상태', '공급사', '실수요처', '영업담당', '비고'];
  const rows = items.map(o => [
    `"${o.po_dt || ''}"`,
    `"${o.po_no || ''}"`,
    `"${o.part_no || ''}"`,
    `"${o.maker || ''}"`,
    o.qty || 0,
    o.unit_price || 0,
    o.amount || 0,
    `"${o.currency || 'KRW'}"`,
    `"${o.eta_date || ''}"`,
    `"${o.status_label || o.status || ''}"`,
    `"${o.supplier_name || ''}"`,
    `"${o.real_cust || o.end_cust || ''}"`,
    `"${o.sales_rep || ''}"`,
    `"${(o.remark || '').replace(/"/g, '""')}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `BSK_Purchase_Orders_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 전역 바인딩
window.openPurchaseOrdersModal = openPurchaseOrdersModal;
window.fetchPurchaseOrdersSummary = fetchPurchaseOrdersSummary;
window.goToNewPurchaseRequisition = function() {
  const modal = document.getElementById('purchaseOrdersModal');
  if (modal) modal.classList.add('hidden');

  if (typeof window.switchToPaymentTab === 'function') {
    window.switchToPaymentTab();
    setTimeout(() => {
      if (typeof window.switchPaymentSubTab === 'function') {
        window.switchPaymentSubTab('approval');
      }
      const docTypeEl = document.getElementById('appDocType');
      if (docTypeEl) {
        docTypeEl.value = '구매품의서';
        if (typeof window.toggleApprovalAmountField === 'function') {
          window.toggleApprovalAmountField();
        }
      }
      const titleEl = document.getElementById('appTitle');
      if (titleEl) {
        titleEl.focus();
      }
    }, 250);
  }
};

window.deleteWebPurchaseOrder = async function(poNo, partNo) {
  if (!confirm(`웹 전자결재 승인 발주 건을 목록에서 삭제하시겠습니까?\n\n• 발주번호: ${poNo}\n• 품번: ${partNo || '-'}\n\n※ 삭제 시 발주·입고예정 목록 및 대기 수량 통계에서 즉시 제외됩니다.`)) {
    return;
  }
  try {
    const params = new URLSearchParams({ po_no: poNo });
    if (partNo) params.set('part_no', partNo);
    const res = await fetch(`/api/purchase-orders/web?${params.toString()}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.status === 'success') {
      alert(`발주(${poNo}) 건이 성공적으로 삭제되었습니다.`);
      await loadPoData();
      await fetchPurchaseOrdersSummary();
      if (typeof window.refreshInventory === 'function') {
        window.refreshInventory();
      }
    } else {
      alert('삭제 실패: ' + (data.message || '오류 발생'));
    }
  } catch (err) {
    alert('삭제 통신 오류: ' + err.message);
  }
};

// ========================================================
// ➕ 웹 발주(PO) 직접 등록 · 수정 · 📦 입고완료(IN) 전환 모달
// ========================================================
let isEditingDirectPo = false;

window.openDirectPoCrudModal = function(poItem = null) {
  if (typeof window.isCsOrAdminUser === 'function' && !window.isCsOrAdminUser()) {
    alert('발주 직접 등록·수정은 CS 및 관리자 권한만 가능합니다.');
    return;
  }
  isEditingDirectPo = !!(poItem && poItem.po_no);

  const modalId = 'directPoCrudModal';
  let modal = document.getElementById(modalId);
  if (!modal) {
    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'fixed inset-0 bg-slate-900/70 backdrop-blur-xs z-[100000] flex items-center justify-center p-3 overflow-y-auto';
    modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
    document.body.appendChild(modal);
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const esc = (v) => String(v ?? '').replace(/"/g, '&quot;');
  const curr = (poItem?.currency || 'USD').toUpperCase().includes('US') || poItem?.currency === '$' ? 'USD' : 'KRW';
  const displayPrice = curr === 'USD' ? (poItem?.foreign_up || 0) : (poItem?.unit_price || 0);

  modal.innerHTML = `
    <div class="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto" onclick="event.stopPropagation()">
      <div class="bg-gradient-to-r from-blue-700 to-indigo-700 text-white px-5 py-3.5 flex items-center justify-between">
        <h3 class="text-sm font-black">${isEditingDirectPo ? `✏️ 웹 발주 수정 (${esc(poItem.po_no)})` : '➕ 신규 발주(PO) 직접 등록'}</h3>
        <button type="button" onclick="document.getElementById('${modalId}').classList.add('hidden')" class="text-white/80 hover:text-white font-bold cursor-pointer">✕</button>
      </div>
      <div class="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">발주번호 (PO NO)</label>
          <input type="text" id="poCrudNo" value="${esc(poItem?.po_no)}" ${isEditingDirectPo ? 'readonly class="w-full px-3 py-2 border border-slate-200 bg-slate-100 rounded-lg font-mono text-slate-500"' : 'placeholder="미입력 시 자동 채번 (PO-WEB-...)" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono outline-none focus:border-blue-500"'}>
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">입고예정일 (CRD/ETA) *</label>
          <input type="date" id="poCrudEta" value="${esc(poItem?.eta_date && poItem.eta_date !== '-' ? poItem.eta_date.slice(0,10) : todayStr)}" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono outline-none focus:border-blue-500">
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">품번 (PART NO) *</label>
          <input type="text" id="poCrudPart" value="${esc(poItem?.part_no)}" placeholder="예: IS25LP128F-JBLE-TR" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold outline-none focus:border-blue-500">
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">제조사 (MFG)</label>
          <input type="text" id="poCrudMaker" value="${esc(poItem?.maker || 'ISSI')}" placeholder="ISSI, ESMT, SMI..." class="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-blue-500">
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">발주 수량 (EA) *</label>
          <input type="number" id="poCrudQty" value="${Number(poItem?.qty || 1000)}" min="1" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold outline-none focus:border-blue-500">
        </div>
        <div class="grid grid-cols-3 gap-1.5">
          <div>
            <label class="block text-[11px] font-bold text-slate-600 mb-1">통화</label>
            <select id="poCrudCurr" class="w-full px-2 py-2 border border-slate-300 rounded-lg font-bold bg-white outline-none">
              <option value="USD" ${curr === 'USD' ? 'selected' : ''}>USD ($)</option>
              <option value="KRW" ${curr === 'KRW' ? 'selected' : ''}>KRW (₩)</option>
            </select>
          </div>
          <div class="col-span-2">
            <label class="block text-[11px] font-bold text-slate-600 mb-1">발주 단가 *</label>
            <input type="number" step="0.0001" id="poCrudPrice" value="${Number(displayPrice || 0)}" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold text-blue-700 outline-none focus:border-blue-500">
          </div>
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">매입처 (공급사)</label>
          <input type="text" id="poCrudSupplier" value="${esc(poItem?.supplier_name)}" placeholder="예: ISSI 공식대리점" class="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-blue-500">
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">실수요처 (고객사)</label>
          <input type="text" id="poCrudCust" value="${esc(poItem?.real_cust || poItem?.end_cust)}" placeholder="예: 유라(주)" class="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-blue-500">
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">담당 영업 (SALES)</label>
          <input type="text" id="poCrudSales" value="${esc(poItem?.sales_rep)}" placeholder="예: WILLIAM, ERIC" class="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-blue-500">
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">비고 (REMARK)</label>
          <input type="text" id="poCrudRemark" value="${esc(poItem?.remark)}" placeholder="특이사항 / 납기 메모" class="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-blue-500">
        </div>
      </div>
      <div class="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
        <button type="button" onclick="document.getElementById('${modalId}').classList.add('hidden')" class="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-lg cursor-pointer">취소</button>
        <button type="button" id="btnSaveDirectPoCrud" class="px-5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs rounded-lg shadow-xs cursor-pointer">💾 발주 저장</button>
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
  document.getElementById('btnSaveDirectPoCrud')?.addEventListener('click', saveDirectPoCrudForm);
};

async function saveDirectPoCrudForm() {
  const part_no = document.getElementById('poCrudPart')?.value.trim() || '';
  if (!part_no) return alert('품번(PART NO)을 입력해 주세요.');

  const liveFx = (typeof window.getLiveFxRate === 'function' && window.getLiveFxRate() > 0) ? window.getLiveFxRate() : 1350;
  const payload = {
    po_no: document.getElementById('poCrudNo')?.value.trim() || '',
    part_no,
    maker: document.getElementById('poCrudMaker')?.value.trim() || 'OTHERS',
    qty: parseInt(document.getElementById('poCrudQty')?.value || '1', 10) || 1,
    unit_price: parseFloat(document.getElementById('poCrudPrice')?.value || '0') || 0,
    currency: document.getElementById('poCrudCurr')?.value || 'USD',
    fx_rate: liveFx,
    eta_date: document.getElementById('poCrudEta')?.value || new Date().toISOString().slice(0, 10),
    supplier_name: document.getElementById('poCrudSupplier')?.value.trim() || '',
    real_cust: document.getElementById('poCrudCust')?.value.trim() || '',
    sales_rep: document.getElementById('poCrudSales')?.value.trim() || '',
    remark: document.getElementById('poCrudRemark')?.value.trim() || ''
  };

  const btn = document.getElementById('btnSaveDirectPoCrud');
  if (btn) { btn.disabled = true; btn.innerText = '⏳ 저장 중...'; }

  try {
    const method = isEditingDirectPo ? 'PUT' : 'POST';
    const res = await fetch('/api/purchase-orders/web', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || data.status !== 'success') throw new Error(data.detail || data.message || '저장 실패');

    document.getElementById('directPoCrudModal')?.classList.add('hidden');
    alert(isEditingDirectPo ? '✅ 웹 발주 내역이 수정되었습니다.' : '✅ 신규 발주(PO)가 등록되었습니다.');
    await loadPoData();
    await fetchPurchaseOrdersSummary();
  } catch (err) {
    alert('발주 저장 오류: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = '💾 발주 저장'; }
  }
}

window.editWebPoByIdx = function(idx) {
  const list = window._lastRenderedPoPageItems || [];
  if (list[idx]) window.openDirectPoCrudModal(list[idx]);
};

window.receivePoByIdx = async function(idx) {
  if (typeof window.isCsOrAdminUser === 'function' && !window.isCsOrAdminUser()) {
    alert('입고 완료 전환은 CS 및 관리자 권한만 가능합니다.');
    return;
  }
  const list = window._lastRenderedPoPageItems || [];
  const o = list[idx];
  if (!o) return;

  const dc = prompt(
    `[📦 발주 실물 입고완료 전환 ➔ 재고 마스터 자동 입고]\n\n` +
    `• 발주번호: ${o.po_no}\n` +
    `• 품번: [${o.maker}] ${o.part_no}\n` +
    `• 수량: ${Number(o.qty).toLocaleString()} EA\n\n` +
    `입고 부품의 Date Code(D/C)를 입력하세요 (미입력 시 '-'):`,
    '-'
  );
  if (dc === null) return;

  const liveFx = (typeof window.getLiveFxRate === 'function' && window.getLiveFxRate() > 0) ? window.getLiveFxRate() : 1350;
  const isWeb = o.source === 'WEB_APPROVAL' || String(o.idx || '').startsWith('WEB-');

  try {
    const res = await fetch('/api/purchase-orders/receive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        po_no: o.po_no,
        part_no: o.part_no,
        maker: o.maker || 'OTHERS',
        qty: Number(o.qty) || 1,
        unit_usd: Number(o.foreign_up) || 0,
        unit_krw: Number(o.unit_price) || 0,
        currency: o.currency || 'USD',
        fx_rate: liveFx,
        entry_date: new Date().toISOString().slice(0, 10),
        supplier_name: o.supplier_name || '',
        real_cust: o.real_cust || o.end_cust || '',
        sales_rep: o.sales_rep || 'BSK',
        date_code: dc.trim() || '-',
        remark: o.remark || '',
        is_web: isWeb
      })
    });
    const data = await res.json();
    if (!res.ok || data.status !== 'success') throw new Error(data.detail || data.message || '입고 처리 실패');

    alert(`✅ [${o.part_no}] ${Number(o.qty).toLocaleString()} EA 입고완료 처리 및 재고 마스터 반영이 완료되었습니다!`);
    await loadPoData();
    await fetchPurchaseOrdersSummary();
    if (typeof window.refreshInventory === 'function') {
      window.refreshInventory();
    }
  } catch (err) {
    alert('입고 완료 처리 오류: ' + err.message);
  }
};
