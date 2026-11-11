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
    <div class="bg-white w-full max-w-7xl h-[92vh] rounded-2xl shadow-2xl border border-slate-300 flex flex-col overflow-hidden" onclick="event.stopPropagation()">
      
      <!-- 상단 헤더 -->
      <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white px-6 py-4 flex items-center justify-between shadow-md">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-400/40 flex items-center justify-center text-xl shadow-inner">
            🚢
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-base font-black tracking-wide">발주(PO) 및 입고 예정(ETA) 종합 관리</h2>
              <span class="text-[10px] bg-blue-500/30 text-blue-300 px-2 py-0.5 rounded-full font-mono border border-blue-400/30">MS-SQL DPOFile 실시간 연동</span>
            </div>
            <p class="text-xs text-slate-300 mt-0.5">국내외 매입처 발주 내역 및 입고 예정일(CRD/ETA), 실수요처 납품 일정을 실시간 추적합니다.</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" id="poExportExcelBtn" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1 cursor-pointer">
            <span>📥</span> Excel 저장
          </button>
          <button type="button" onclick="document.getElementById('${modalId}').classList.add('hidden')" class="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold flex items-center justify-center cursor-pointer transition-colors">
            ✕
          </button>
        </div>
      </div>

      <!-- 요약 KPI 지표 카드 4종 -->
      <div id="poKpiBar" class="p-4 bg-slate-50 border-b border-slate-200 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div class="bg-white p-3 rounded-xl border border-blue-200 shadow-xs flex items-center justify-between">
          <div>
            <div class="text-[11px] font-bold text-slate-500">🚢 입고대기 발주(PO)</div>
            <div id="kpiPendingCount" class="text-lg font-black text-blue-700 mt-0.5">로딩중...</div>
            <div id="kpiPendingQty" class="text-[10px] text-slate-500 mt-0.5">-</div>
          </div>
          <span class="text-2xl">⏳</span>
        </div>
        <div class="bg-white p-3 rounded-xl border border-emerald-200 shadow-xs flex items-center justify-between">
          <div>
            <div class="text-[11px] font-bold text-slate-500">✅ 입고 완료(IN)</div>
            <div id="kpiArrivedCount" class="text-lg font-black text-emerald-700 mt-0.5">-</div>
            <div class="text-[10px] text-slate-500 mt-0.5">정상 입고 및 재고 반영</div>
          </div>
          <span class="text-2xl">📦</span>
        </div>
        <div class="bg-white p-3 rounded-xl border border-purple-200 shadow-xs flex items-center justify-between">
          <div>
            <div class="text-[11px] font-bold text-slate-500">📊 총 발주 누적 건수</div>
            <div id="kpiTotalCount" class="text-lg font-black text-purple-700 mt-0.5">-</div>
            <div class="text-[10px] text-slate-500 mt-0.5">전체 발주 기록 관리</div>
          </div>
          <span class="text-2xl">📋</span>
        </div>
        <div class="bg-white p-3 rounded-xl border border-rose-200 shadow-xs flex items-center justify-between">
          <div>
            <div class="text-[11px] font-bold text-slate-500">🚫 취소 건수(CNL)</div>
            <div id="kpiCnlCount" class="text-lg font-black text-rose-700 mt-0.5">-</div>
            <div class="text-[10px] text-slate-500 mt-0.5">발주 취소 내역</div>
          </div>
          <span class="text-2xl">❌</span>
        </div>
      </div>

      <!-- 필터 및 검색 툴바 -->
      <div class="p-3 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <!-- 상태 토글 버튼 -->
        <div class="flex items-center gap-1.5" id="poStatusTabs">
          <button type="button" data-status="PO" class="po-status-tab px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${activePoStatus === 'PO' ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">
            🚢 입고 대기 (PO)
          </button>
          <button type="button" data-status="IN" class="po-status-tab px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${activePoStatus === 'IN' ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">
            ✅ 입고 완료 (IN)
          </button>
          <button type="button" data-status="ALL" class="po-status-tab px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${activePoStatus === 'ALL' ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">
            전체 발주 (ALL)
          </button>
          <button type="button" data-status="CNL" class="po-status-tab px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${activePoStatus === 'CNL' ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">
            취소 (CNL)
          </button>
        </div>

        <!-- 실시간 검색 및 필터 -->
        <div class="flex items-center gap-2 flex-1 max-w-lg">
          <div class="relative w-full">
            <input type="text" id="poSearchInput" value="${activePoSearch}" placeholder="품번(Part#), 발주번호(PONO), 공급사, 실수요처, 담당자 검색..." 
                   class="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none">
            <span class="absolute left-2.5 top-2 text-slate-400 text-xs">🔍</span>
          </div>
          <button type="button" id="poRefreshBtn" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg whitespace-nowrap cursor-pointer">
            🔄 새로고침
          </button>
        </div>
      </div>

      <!-- 데이터 테이블 영역 -->
      <div class="flex-1 overflow-x-auto overflow-y-auto">
        <table class="w-full text-left text-xs border-collapse">
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
            </tr>
          </thead>
          <tbody id="poTableBody" class="divide-y divide-slate-200">
            <tr>
              <td colspan="14" class="py-12 text-center text-slate-400">데이터를 불러오는 중입니다...</td>
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
  const countInfo = document.getElementById('poCountInfo');
  if (!tbody) return;

  if (!orders || orders.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="15" class="py-16 text-center text-slate-400">
          <div class="text-3xl mb-2">🔍</div>
          <div class="font-bold text-sm text-slate-600">조건에 일치하는 발주 내역이 없습니다.</div>
          <div class="text-xs text-slate-400 mt-1">검색어나 상태 필터를 변경해 보세요.</div>
        </td>
      </tr>
    `;
    if (countInfo) countInfo.textContent = '조회 결과: 0건';
    renderPoPagination(0, 1);
    return;
  }

  const totalPages = Math.ceil(orders.length / PO_PAGE_SIZE);
  if (currentPoPage > totalPages) currentPoPage = 1;
  const startIdx = (currentPoPage - 1) * PO_PAGE_SIZE;
  const pageItems = orders.slice(startIdx, startIdx + PO_PAGE_SIZE);

  if (countInfo) {
    countInfo.innerHTML = `총 <strong class="text-blue-700">${orders.length.toLocaleString()}건</strong> 중 ${startIdx + 1} ~ ${Math.min(startIdx + PO_PAGE_SIZE, orders.length)}건 표시`;
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  tbody.innerHTML = pageItems.map((o, idx) => {
    const rowNo = startIdx + idx + 1;
    const isPending = o.status === 'PO';
    const isArrived = o.status === 'IN';
    const isCnl = o.status === 'CNL';

    // 상태 뱃지
    let statusBadge = '';
    if (isPending) {
      statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-100 text-blue-800 border border-blue-300 flex items-center justify-center gap-1">🚢 입고대기</span>`;
    } else if (isArrived) {
      statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center justify-center gap-1">✅ 입고완료</span>`;
    } else {
      statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-300 flex items-center justify-center gap-1">취소</span>`;
    }

    // 입고예정일 D-Day 계산
    let etaDisplay = o.eta_date || '-';
    let etaClass = 'text-slate-600';
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

    return `
      <tr class="hover:bg-blue-50/60 transition-colors border-b border-slate-200 text-[11px] ${isPending ? 'bg-blue-50/20' : ''}">
        <td class="py-2 px-2 text-center text-slate-400 font-mono">${rowNo}</td>
        <td class="py-2 px-2 text-center whitespace-nowrap">${statusBadge}</td>
        <td class="py-2 px-2 text-center font-mono text-slate-700 whitespace-nowrap">${o.po_dt || '-'}</td>
        <td class="py-2 px-3 font-mono font-bold text-slate-800 truncate max-w-[140px]" title="${o.po_no}">${o.po_no}</td>
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
      </tr>
    `;
  }).join('');

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
