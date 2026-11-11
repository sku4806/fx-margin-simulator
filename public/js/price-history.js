/**
 * 📈 price-history.js
 * 품목별 과거 매입·판매·견적·발주 단가 이력 및 마진 추적 모듈
 */

export async function openPriceHistoryModal(partNo) {
  if (!partNo || typeof partNo !== 'string') return;
  const cleanPartNo = partNo.trim();

  const modalId = 'priceHistoryModal';
  let modal = document.getElementById(modalId);
  if (!modal) {
    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'fixed inset-0 bg-slate-900/70 backdrop-blur-xs z-[99995] flex items-center justify-center p-2 sm:p-4 overflow-hidden';
    modal.onclick = (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    };
    document.body.appendChild(modal);
  }

  modal.classList.remove('hidden');
  modal.innerHTML = `
    <div class="bg-white w-full max-w-6xl h-[90vh] rounded-2xl shadow-2xl border border-slate-300 flex flex-col overflow-hidden" onclick="event.stopPropagation()">
      
      <!-- 상단 헤더 -->
      <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white px-6 py-4 flex items-center justify-between shadow-md">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-xl shadow-inner">
            📈
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-base font-black tracking-wide">품목별 과거 단가 & 마진 이력 추적</h2>
              <span class="text-xs bg-indigo-600 text-white px-2.5 py-0.5 rounded-full font-mono font-black shadow-xs">${cleanPartNo}</span>
            </div>
            <p class="text-xs text-slate-300 mt-0.5">MS-SQL DincomeFile, DReportFile, QuotationFile, DPOFile 4대 원장의 매입·판매·견적·발주 단가를 일괄 대조합니다.</p>
          </div>
        </div>
        <button type="button" onclick="document.getElementById('${modalId}').classList.add('hidden')" class="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold flex items-center justify-center cursor-pointer transition-colors">
          ✕
        </button>
      </div>

      <!-- 로딩 인디케이터 / 본문 영역 -->
      <div id="priceHistoryContent" class="flex-1 flex flex-col overflow-hidden">
        <div class="flex-1 flex items-center justify-center text-slate-500 font-bold">
          <div class="text-center">
            <div class="text-3xl mb-3 animate-spin">⏳</div>
            <div class="text-sm text-slate-700">${cleanPartNo}의 과거 단가 및 마진 데이터를 조회하고 있습니다...</div>
          </div>
        </div>
      </div>

    </div>
  `;

  try {
    const res = await fetch(`/api/price-history?part_no=${encodeURIComponent(cleanPartNo)}`);
    const data = await res.json();

    if (data.status === 'success' && data.data) {
      renderPriceHistoryContent(data.data);
    } else {
      showPriceHistoryError('단가 이력 데이터를 불러오지 못했습니다.');
    }
  } catch (err) {
    console.error('[PriceHistory] 조회 에러:', err);
    showPriceHistoryError(err.message || '단가 이력 조회 중 네트워크 오류가 발생했습니다.');
  }
}

function showPriceHistoryError(msg) {
  const container = document.getElementById('priceHistoryContent');
  if (container) {
    container.innerHTML = `
      <div class="flex-1 flex items-center justify-center text-slate-500">
        <div class="text-center">
          <div class="text-4xl mb-2 text-rose-500">⚠️</div>
          <div class="font-bold text-sm text-slate-700">${msg}</div>
        </div>
      </div>
    `;
  }
}

function renderPriceHistoryContent(payload) {
  const container = document.getElementById('priceHistoryContent');
  if (!container) return;

  const { summary = {}, purchases = [], sales = [], quotations = [], purchase_orders = [] } = payload;

  const avgMargin = summary.avg_margin_rate || 0;
  let marginColor = 'text-emerald-700 bg-emerald-50 border-emerald-300';
  if (avgMargin < 10) marginColor = 'text-rose-700 bg-rose-50 border-rose-300';
  else if (avgMargin < 20) marginColor = 'text-amber-700 bg-amber-50 border-amber-300';

  container.innerHTML = `
    <!-- 핵심 단가 KPI 지표 카드 4종 -->
    <div class="p-4 bg-slate-50 border-b border-slate-200 grid grid-cols-2 md:grid-cols-4 gap-3">
      <!-- 1. 최근 매입 단가 -->
      <div class="bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
        <div class="text-[11px] font-bold text-slate-500 flex items-center justify-between">
          <span>🛒 최근 매입 단가</span>
          <span class="text-[10px] text-slate-400 font-mono">${summary.latest_purchase_date || '-'}</span>
        </div>
        <div class="text-lg font-black text-slate-900 mt-1">
          $${(summary.latest_purchase_usd || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
        </div>
        <div class="text-xs text-indigo-700 font-bold mt-0.5">
          ₩${Math.round(summary.latest_purchase_krw || 0).toLocaleString()} (원화 환산)
        </div>
      </div>

      <!-- 2. 최근 판매 단가 -->
      <div class="bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
        <div class="text-[11px] font-bold text-slate-500 flex items-center justify-between">
          <span>💰 최근 판매 단가</span>
          <span class="text-[10px] text-slate-400 font-mono">${summary.latest_sale_date || '-'}</span>
        </div>
        <div class="text-lg font-black text-blue-700 mt-1">
          ₩${Math.round(summary.latest_sale_price || 0).toLocaleString()}
        </div>
        <div class="text-xs text-slate-500 mt-0.5">
          최근 마진: <strong class="text-emerald-600">${summary.latest_margin_rate || 0}%</strong>
        </div>
      </div>

      <!-- 3. 평균 마진율 -->
      <div class="bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
        <div class="text-[11px] font-bold text-slate-500">📈 평균 수익 마진율</div>
        <div class="text-lg font-black mt-1">
          <span class="px-2 py-0.5 rounded-lg border text-sm font-black ${marginColor}">
            ${avgMargin}%
          </span>
        </div>
        <div class="text-xs text-slate-500 mt-1">누적 판매 ${summary.sale_count || 0}건 기준</div>
      </div>

      <!-- 4. 누적 거래량 & 입고예정 -->
      <div class="bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
        <div class="text-[11px] font-bold text-slate-500">📦 누적 거래량 / 발주예정</div>
        <div class="text-xs font-semibold text-slate-700 mt-1">
          총 매입: <strong class="text-slate-900">${(summary.total_purchased_qty || 0).toLocaleString()}</strong> EA
        </div>
        <div class="text-xs font-semibold text-slate-700 mt-0.5">
          총 출하: <strong class="text-indigo-700">${(summary.total_sold_qty || 0).toLocaleString()}</strong> EA
        </div>
        ${summary.pending_po_qty > 0 ? `
          <div class="text-[11px] text-blue-700 font-black mt-1 flex items-center gap-1">
            <span>🚢 입고예정 발주:</span> <span>${summary.pending_po_qty.toLocaleString()} EA</span>
          </div>
        ` : ''}
      </div>
    </div>

    <!-- 탭 네비게이션 버튼 -->
    <div class="px-4 pt-2 bg-white border-b border-slate-200 flex items-center gap-2">
      <button type="button" data-tab="purchases" class="ph-tab-btn px-3 py-2 text-xs font-bold border-b-2 border-indigo-600 text-indigo-700 cursor-pointer flex items-center gap-1.5">
        <span>🛒</span> 과거 매입 이력 (${purchases.length}건)
      </button>
      <button type="button" data-tab="sales" class="ph-tab-btn px-3 py-2 text-xs font-bold border-b-2 border-transparent text-slate-500 hover:text-slate-800 cursor-pointer flex items-center gap-1.5">
        <span>💰</span> 과거 판매·출하 & 마진 (${sales.length}건)
      </button>
      <button type="button" data-tab="quotations" class="ph-tab-btn px-3 py-2 text-xs font-bold border-b-2 border-transparent text-slate-500 hover:text-slate-800 cursor-pointer flex items-center gap-1.5">
        <span>📋</span> 과거 견적 이력 (${quotations.length}건)
      </button>
      <button type="button" data-tab="pos" class="ph-tab-btn px-3 py-2 text-xs font-bold border-b-2 border-transparent text-slate-500 hover:text-slate-800 cursor-pointer flex items-center gap-1.5">
        <span>🚢</span> 발주·입고예정 이력 (${purchase_orders.length}건)
      </button>
    </div>

    <!-- 탭 콘텐츠 본문 (스크롤) -->
    <div class="flex-1 overflow-x-auto overflow-y-auto p-4 bg-slate-50/50">
      
      <!-- 1. 매입 이력 탭 -->
      <div id="phTabPurchases" class="ph-tab-content">
        ${renderPurchasesTable(purchases)}
      </div>

      <!-- 2. 판매 이력 탭 -->
      <div id="phTabSales" class="ph-tab-content hidden">
        ${renderSalesTable(sales)}
      </div>

      <!-- 3. 견적 이력 탭 -->
      <div id="phTabQuotations" class="ph-tab-content hidden">
        ${renderQuotationsTable(quotations)}
      </div>

      <!-- 4. 발주 이력 탭 -->
      <div id="phTabPos" class="ph-tab-content hidden">
        ${renderPosTable(purchase_orders)}
      </div>

    </div>
  `;

  // 탭 클릭 이벤트 바인딩
  const tabBtns = container.querySelectorAll('.ph-tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => {
        b.classList.remove('border-indigo-600', 'text-indigo-700');
        b.classList.add('border-transparent', 'text-slate-500');
      });
      btn.classList.add('border-indigo-600', 'text-indigo-700');
      btn.classList.remove('border-transparent', 'text-slate-500');

      const targetTab = btn.dataset.tab;
      document.getElementById('phTabPurchases').classList.toggle('hidden', targetTab !== 'purchases');
      document.getElementById('phTabSales').classList.toggle('hidden', targetTab !== 'sales');
      document.getElementById('phTabQuotations').classList.toggle('hidden', targetTab !== 'quotations');
      document.getElementById('phTabPos').classList.toggle('hidden', targetTab !== 'pos');
    });
  });
}

function renderPurchasesTable(purchases) {
  if (!purchases || purchases.length === 0) {
    return `<div class="py-12 text-center text-slate-400 font-bold">기록된 매입(입고) 이력이 없습니다.</div>`;
  }

  return `
    <div class="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
      <table class="w-full text-left text-xs border-collapse">
        <thead class="bg-slate-100 text-slate-700 font-bold text-[11px] border-b border-slate-200">
          <tr>
            <th class="py-2.5 px-3 text-center w-12">#</th>
            <th class="py-2.5 px-3 text-center w-24">입고일자</th>
            <th class="py-2.5 px-3 text-left min-w-[150px]">인보이스 번호</th>
            <th class="py-2.5 px-2.5 text-left w-20">제조사</th>
            <th class="py-2.5 px-3 text-right w-24">입고수량</th>
            <th class="py-2.5 px-3 text-right w-24">외화단가(USD)</th>
            <th class="py-2.5 px-2.5 text-right w-20">환율</th>
            <th class="py-2.5 px-3 text-right w-28">원화단가(₩)</th>
            <th class="py-2.5 px-3 text-right w-32">원화총액(₩)</th>
            <th class="py-2.5 px-3 text-left min-w-[140px]">비고 (계약처 등)</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${purchases.map((p, idx) => `
            <tr class="hover:bg-slate-50 text-[11px]">
              <td class="py-2 px-3 text-center text-slate-400 font-mono">${idx + 1}</td>
              <td class="py-2 px-3 text-center font-mono text-slate-700 whitespace-nowrap">${p.in_date || '-'}</td>
              <td class="py-2 px-3 font-mono font-bold text-slate-800 truncate max-w-[170px]" title="${p.invoice_no}">${p.invoice_no || '-'}</td>
              <td class="py-2 px-2.5 font-bold text-slate-600">${p.maker || '-'}</td>
              <td class="py-2 px-3 text-right font-black text-slate-900 whitespace-nowrap">${p.qty.toLocaleString()} EA</td>
              <td class="py-2 px-3 text-right font-mono font-bold text-blue-700 whitespace-nowrap">$${p.sl_up.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
              <td class="py-2 px-2.5 text-right font-mono text-slate-500 whitespace-nowrap">${p.in_rate > 0 ? `₩${p.in_rate.toLocaleString()}` : '-'}</td>
              <td class="py-2 px-3 text-right font-mono font-bold text-indigo-900 whitespace-nowrap">${p.w_up > 0 ? `₩${Math.round(p.w_up).toLocaleString()}` : '-'}</td>
              <td class="py-2 px-3 text-right font-mono font-semibold text-slate-700 whitespace-nowrap">${p.w_amt > 0 ? `₩${Math.round(p.w_amt).toLocaleString()}` : '-'}</td>
              <td class="py-2 px-3 text-slate-600 font-bold truncate max-w-[160px]" title="${p.remark}">${p.remark || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderSalesTable(sales) {
  if (!sales || sales.length === 0) {
    return `<div class="py-12 text-center text-slate-400 font-bold">기록된 판매(출하) 이력이 없습니다.</div>`;
  }

  return `
    <div class="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
      <table class="w-full text-left text-xs border-collapse">
        <thead class="bg-slate-100 text-slate-700 font-bold text-[11px] border-b border-slate-200">
          <tr>
            <th class="py-2.5 px-3 text-center w-12">#</th>
            <th class="py-2.5 px-3 text-center w-24">출하일자</th>
            <th class="py-2.5 px-3 text-left min-w-[160px]">고객사명 (CNAME)</th>
            <th class="py-2.5 px-3 text-right w-24">출하수량</th>
            <th class="py-2.5 px-3 text-right w-24">매입단가(₩)</th>
            <th class="py-2.5 px-3 text-right w-28">판매단가(₩)</th>
            <th class="py-2.5 px-3 text-right w-32">판매금액(₩)</th>
            <th class="py-2.5 px-3 text-right w-28">마진금액(₩)</th>
            <th class="py-2.5 px-2.5 text-center w-20">마진율</th>
            <th class="py-2.5 px-2.5 text-center w-16">영업담당</th>
            <th class="py-2.5 px-3 text-left min-w-[130px]">비고</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${sales.map((s, idx) => {
            const mRate = s.mgn_rate || 0;
            let mBadge = 'text-emerald-700 bg-emerald-50 border-emerald-300';
            if (mRate < 10) mBadge = 'text-rose-700 bg-rose-50 border-rose-300';
            else if (mRate < 20) mBadge = 'text-amber-700 bg-amber-50 border-amber-300';

            return `
              <tr class="hover:bg-slate-50 text-[11px]">
                <td class="py-2 px-3 text-center text-slate-400 font-mono">${idx + 1}</td>
                <td class="py-2 px-3 text-center font-mono text-slate-700 whitespace-nowrap">${s.out_date || '-'}</td>
                <td class="py-2 px-3 font-bold text-slate-900 truncate max-w-[180px]" title="${s.customer_name}">${s.customer_name || '-'}</td>
                <td class="py-2 px-3 text-right font-black text-slate-900 whitespace-nowrap">${s.qty.toLocaleString()} EA</td>
                <td class="py-2 px-3 text-right font-mono text-slate-500 whitespace-nowrap">₩${Math.round(s.in_up).toLocaleString()}</td>
                <td class="py-2 px-3 text-right font-mono font-bold text-blue-700 whitespace-nowrap">₩${Math.round(s.out_up).toLocaleString()}</td>
                <td class="py-2 px-3 text-right font-mono font-black text-slate-900 whitespace-nowrap">₩${Math.round(s.out_amt).toLocaleString()}</td>
                <td class="py-2 px-3 text-right font-mono font-bold text-emerald-700 whitespace-nowrap">₩${Math.round(s.mgn).toLocaleString()}</td>
                <td class="py-2 px-2.5 text-center whitespace-nowrap">
                  <span class="px-1.5 py-0.5 rounded border text-[10px] font-black ${mBadge}">${mRate}%</span>
                </td>
                <td class="py-2 px-2.5 text-center font-bold text-indigo-900 whitespace-nowrap">${s.sales_rep || '-'}</td>
                <td class="py-2 px-3 text-slate-500 truncate max-w-[140px]" title="${s.remark}">${s.remark || '-'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderQuotationsTable(quotations) {
  if (!quotations || quotations.length === 0) {
    return `<div class="py-12 text-center text-slate-400 font-bold">기록된 견적 이력이 없습니다.</div>`;
  }

  return `
    <div class="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
      <table class="w-full text-left text-xs border-collapse">
        <thead class="bg-slate-100 text-slate-700 font-bold text-[11px] border-b border-slate-200">
          <tr>
            <th class="py-2.5 px-3 text-center w-12">#</th>
            <th class="py-2.5 px-3 text-center w-24">견적일자</th>
            <th class="py-2.5 px-3 text-left w-32">견적번호</th>
            <th class="py-2.5 px-3 text-left min-w-[160px]">고객사명 (CNAME)</th>
            <th class="py-2.5 px-3 text-right w-24">견적수량</th>
            <th class="py-2.5 px-2.5 text-center w-14">통화</th>
            <th class="py-2.5 px-3 text-right w-28">견적단가</th>
            <th class="py-2.5 px-3 text-right w-32">견적총액</th>
            <th class="py-2.5 px-2.5 text-center w-16">영업담당</th>
            <th class="py-2.5 px-3 text-left min-w-[140px]">비고</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${quotations.map((q, idx) => {
            const isUsd = (q.qunit || '').includes('$') || (q.qunit || '').toUpperCase().includes('US');
            const qpStr = isUsd
              ? `$${q.qp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
              : `₩${Math.round(q.qp).toLocaleString()}`;
            const amtStr = isUsd
              ? `$${q.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : `₩${Math.round(q.amount).toLocaleString()}`;

            return `
              <tr class="hover:bg-slate-50 text-[11px]">
                <td class="py-2 px-3 text-center text-slate-400 font-mono">${idx + 1}</td>
                <td class="py-2 px-3 text-center font-mono text-slate-700 whitespace-nowrap">${q.quote_date || '-'}</td>
                <td class="py-2 px-3 font-mono font-bold text-slate-800 whitespace-nowrap">${q.quote_no || '-'}</td>
                <td class="py-2 px-3 font-bold text-slate-900 truncate max-w-[180px]" title="${q.customer_name}">${q.customer_name || '-'}</td>
                <td class="py-2 px-3 text-right font-black text-slate-900 whitespace-nowrap">${q.qty.toLocaleString()} EA</td>
                <td class="py-2 px-2.5 text-center font-bold text-slate-600 whitespace-nowrap">${q.qunit || 'KRW'}</td>
                <td class="py-2 px-3 text-right font-mono font-bold text-blue-700 whitespace-nowrap">${qpStr}</td>
                <td class="py-2 px-3 text-right font-mono font-bold text-slate-900 whitespace-nowrap">${amtStr}</td>
                <td class="py-2 px-2.5 text-center font-bold text-indigo-900 whitespace-nowrap">${q.sales_rep || '-'}</td>
                <td class="py-2 px-3 text-slate-500 truncate max-w-[160px]" title="${q.remark}">${q.remark || '-'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderPosTable(pos) {
  if (!pos || pos.length === 0) {
    return `<div class="py-12 text-center text-slate-400 font-bold">기록된 발주(PO) 이력이 없습니다.</div>`;
  }

  return `
    <div class="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
      <table class="w-full text-left text-xs border-collapse">
        <thead class="bg-slate-100 text-slate-700 font-bold text-[11px] border-b border-slate-200">
          <tr>
            <th class="py-2.5 px-3 text-center w-12">#</th>
            <th class="py-2.5 px-2.5 text-center w-24">상태</th>
            <th class="py-2.5 px-3 text-center w-24">발주일자</th>
            <th class="py-2.5 px-3 text-left w-32">발주번호</th>
            <th class="py-2.5 px-3 text-right w-24">수량</th>
            <th class="py-2.5 px-3 text-right w-28">발주단가</th>
            <th class="py-2.5 px-3 text-right w-32">발주금액</th>
            <th class="py-2.5 px-3 text-center w-28">입고예정(CRD)</th>
            <th class="py-2.5 px-3 text-left min-w-[130px]">공급사</th>
            <th class="py-2.5 px-3 text-left min-w-[120px]">실수요처</th>
            <th class="py-2.5 px-2.5 text-center w-16">영업담당</th>
            <th class="py-2.5 px-3 text-left min-w-[130px]">비고</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${pos.map((p, idx) => {
            const isPending = p.status === 'PO';
            const statusBadge = isPending
              ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-100 text-blue-800 border border-blue-300">🚢 입고대기</span>`
              : `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-100 text-slate-700 border border-slate-300">${p.status_label || p.status}</span>`;

            return `
              <tr class="hover:bg-slate-50 text-[11px] ${isPending ? 'bg-blue-50/20' : ''}">
                <td class="py-2 px-3 text-center text-slate-400 font-mono">${idx + 1}</td>
                <td class="py-2 px-2.5 text-center whitespace-nowrap">${statusBadge}</td>
                <td class="py-2 px-3 text-center font-mono text-slate-700 whitespace-nowrap">${p.po_date || '-'}</td>
                <td class="py-2 px-3 font-mono font-bold text-slate-800 whitespace-nowrap">${p.po_no || '-'}</td>
                <td class="py-2 px-3 text-right font-black text-slate-900 whitespace-nowrap">${p.qty.toLocaleString()} EA</td>
                <td class="py-2 px-3 text-right font-mono font-bold text-blue-700 whitespace-nowrap">₩${Math.round(p.unit_price).toLocaleString()}</td>
                <td class="py-2 px-3 text-right font-mono font-black text-slate-900 whitespace-nowrap">₩${Math.round(p.amount).toLocaleString()}</td>
                <td class="py-2 px-3 text-center font-mono font-bold text-indigo-900 whitespace-nowrap">${p.eta_date || '-'}</td>
                <td class="py-2 px-3 text-slate-800 font-medium truncate max-w-[140px]" title="${p.supplier_name}">${p.supplier_name || '-'}</td>
                <td class="py-2 px-3 text-indigo-900 font-bold truncate max-w-[130px]" title="${p.real_cust}">${p.real_cust || '-'}</td>
                <td class="py-2 px-2.5 text-center font-bold text-slate-700 whitespace-nowrap">${p.sales_rep || '-'}</td>
                <td class="py-2 px-3 text-slate-500 truncate max-w-[140px]" title="${p.remark}">${p.remark || '-'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// 전역 바인딩
window.openPriceHistoryModal = openPriceHistoryModal;
