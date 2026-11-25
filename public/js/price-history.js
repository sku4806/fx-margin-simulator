/**
 * 📈 price-history.js
 * 품목별 과거 매입·판매·견적·발주 단가 이력 및 마진 추적 모듈
 */

import { toEnglishSalesName } from './modules/utils.js';

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
    <div class="bg-white w-[96vw] max-w-[1560px] h-[92vh] sm:h-[90vh] rounded-2xl shadow-2xl border border-slate-300 flex flex-col overflow-hidden" onclick="event.stopPropagation()">
      
      <!-- 상단 헤더 -->
      <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white px-4 sm:px-6 py-3.5 sm:py-4 flex items-start sm:items-center justify-between gap-2 shadow-md shrink-0">
        <div class="flex items-start sm:items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
          <div class="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-lg sm:text-xl shadow-inner shrink-0">
            📈
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <h2 class="text-sm sm:text-base font-black tracking-wide leading-tight">품목별 과거 단가 &amp; 마진 이력</h2>
              <span class="text-[11px] sm:text-xs bg-indigo-600 text-white px-2.5 py-0.5 rounded-full font-mono font-black shadow-xs break-all">${cleanPartNo}</span>
            </div>
            <p class="hidden sm:block text-xs text-slate-300 mt-0.5">MS-SQL DincomeFile, DReportFile, QuotationFile, DPOFile 4대 원장의 매입·판매·견적·발주 단가를 일괄 대조합니다.</p>
            <p class="sm:hidden text-[10px] text-slate-300 mt-0.5">매입·판매·견적·발주 4대 원장 단가 대조</p>
          </div>
        </div>
        <button type="button" onclick="document.getElementById('${modalId}').classList.add('hidden')" class="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold flex items-center justify-center cursor-pointer transition-colors shrink-0">
          ✕
        </button>
      </div>

      <!-- 로딩 인디케이터 / 본문 영역 -->
      <div id="priceHistoryContent" class="flex-1 flex flex-col overflow-hidden">
        <div class="flex-1 flex items-center justify-center text-slate-500 font-bold p-4">
          <div class="text-center">
            <div class="text-3xl mb-3 animate-spin">⏳</div>
            <div class="text-sm text-slate-700">${cleanPartNo}의 과거 단가 및 마진 데이터를 조회하고 있습니다...</div>
          </div>
        </div>
      </div>

    </div>
  `;

  try {
    const [res, commRes] = await Promise.all([
      fetch(`/api/price-history?part_no=${encodeURIComponent(cleanPartNo)}`),
      fetch(`/api/shipped-info?biz_type=COMMISSION&query=${encodeURIComponent(cleanPartNo)}&limit=100`).catch(() => null)
    ]);
    const data = await res.json();
    let commItems = [];
    if (commRes && commRes.ok) {
      try {
        const cd = await commRes.json();
        const needle = cleanPartNo.toLowerCase();
        commItems = (cd.items || []).filter(it => (it.part_no || '').toLowerCase().includes(needle));
      } catch (_) {}
    }

    if (data.status === 'success' && data.data) {
      renderPriceHistoryContent({ ...data.data, commissions: commItems });
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

  const { summary = {}, purchases = [], sales = [], quotations = [], purchase_orders = [], commissions = [] } = payload;
  sales.forEach(s => { s.sales_rep = toEnglishSalesName(s.sales_rep); });
  quotations.forEach(q => { q.sales_rep = toEnglishSalesName(q.sales_rep); });
  purchase_orders.forEach(p => { p.sales_rep = toEnglishSalesName(p.sales_rep); });
  commissions.forEach(c => { c.sales_rep = toEnglishSalesName(c.sales_rep); });

  const avgMargin = summary.avg_margin_rate || 0;
  let marginColor = 'text-emerald-700 bg-emerald-50 border-emerald-300';
  if (avgMargin < 10) marginColor = 'text-rose-700 bg-rose-50 border-rose-300';
  else if (avgMargin < 20) marginColor = 'text-amber-700 bg-amber-50 border-amber-300';

  container.innerHTML = `
    <!-- 핵심 단가 KPI 지표 카드 4종 -->
    <div class="p-3 sm:p-4 bg-slate-50 border-b border-slate-200 grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 shrink-0">
      <!-- 1. 최근 매입 단가 -->
      <div class="bg-white p-2.5 sm:p-3 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5">
          <span class="text-[11px] font-bold text-slate-500 whitespace-nowrap">🛒 최근 매입 단가</span>
          <span class="text-[10px] text-slate-400 font-mono whitespace-nowrap">${summary.latest_purchase_date || '-'}</span>
        </div>
        <div class="text-base sm:text-lg font-black text-slate-900 mt-1 font-mono truncate">
          $${(summary.latest_purchase_usd || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
        </div>
        <div class="text-[11px] sm:text-xs text-indigo-700 font-bold mt-0.5 truncate">
          ₩${Math.round(summary.latest_purchase_krw || 0).toLocaleString()} <span class="hidden sm:inline">(원화 환산)</span>
        </div>
      </div>

      <!-- 2. 최근 판매 단가 -->
      <div class="bg-white p-2.5 sm:p-3 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5">
          <span class="text-[11px] font-bold text-slate-500 whitespace-nowrap">💰 최근 판매 단가</span>
          <span class="text-[10px] text-slate-400 font-mono whitespace-nowrap">${summary.latest_sale_date || '-'}</span>
        </div>
        <div class="text-base sm:text-lg font-black text-blue-700 mt-1 font-mono truncate">
          ₩${Math.round(summary.latest_sale_price || 0).toLocaleString()}
        </div>
        <div class="text-[11px] sm:text-xs text-slate-500 mt-0.5 whitespace-nowrap">
          최근 마진: <strong class="text-emerald-600">${summary.latest_margin_rate || 0}%</strong>
        </div>
      </div>

      <!-- 3. 평균 마진율 -->
      <div class="bg-white p-2.5 sm:p-3 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
        <div class="text-[11px] font-bold text-slate-500 whitespace-nowrap">📈 평균 수익 마진율</div>
        <div class="text-base sm:text-lg font-black mt-1">
          <span class="px-2 py-0.5 rounded-lg border text-xs sm:text-sm font-black ${marginColor}">
            ${avgMargin}%
          </span>
        </div>
        <div class="text-[11px] sm:text-xs text-slate-500 mt-1 whitespace-nowrap">누적 판매 ${summary.sale_count || 0}건 기준</div>
      </div>

      <!-- 4. 누적 거래량 & 입고예정 -->
      <div class="bg-white p-2.5 sm:p-3 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
        <div class="text-[11px] font-bold text-slate-500 whitespace-nowrap">📦 누적 거래량 / 발주</div>
        <div class="text-[11px] sm:text-xs font-semibold text-slate-700 mt-1 whitespace-nowrap">
          매입: <strong class="text-slate-900 font-mono">${(summary.total_purchased_qty || 0).toLocaleString()}</strong> EA
        </div>
        <div class="text-[11px] sm:text-xs font-semibold text-slate-700 mt-0.5 whitespace-nowrap">
          출하: <strong class="text-indigo-700 font-mono">${(summary.total_sold_qty || 0).toLocaleString()}</strong> EA
        </div>
        ${summary.pending_po_qty > 0 ? `
          <div class="text-[10px] sm:text-[11px] text-blue-700 font-black mt-0.5 flex items-center gap-1 whitespace-nowrap">
            <span>🚢 입고대기:</span> <span class="font-mono">${summary.pending_po_qty.toLocaleString()} EA</span>
          </div>
        ` : ''}
      </div>
    </div>

    <!-- 탭 네비게이션 버튼 (단일 행 가로 스와이프 지원) -->
    <div class="px-3 sm:px-4 pt-1.5 bg-white border-b border-slate-200 flex items-center gap-1 sm:gap-2 overflow-x-auto scrollbar-none flex-nowrap shrink-0">
      <button type="button" data-tab="purchases" class="ph-tab-btn px-2.5 sm:px-3 py-2 text-xs font-bold border-b-2 border-indigo-600 text-indigo-700 cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0">
        <span>🛒</span> 매입 이력 <span class="text-[10px] opacity-80">(${purchases.length})</span>
      </button>
      <button type="button" data-tab="sales" class="ph-tab-btn px-2.5 sm:px-3 py-2 text-xs font-bold border-b-2 border-transparent text-slate-500 hover:text-slate-800 cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0">
        <span>💰</span> 판매·마진 <span class="text-[10px] opacity-80">(${sales.length})</span>
      </button>
      <button type="button" data-tab="quotations" class="ph-tab-btn px-2.5 sm:px-3 py-2 text-xs font-bold border-b-2 border-transparent text-slate-500 hover:text-slate-800 cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0">
        <span>📋</span> 견적 이력 <span class="text-[10px] opacity-80">(${quotations.length})</span>
      </button>
      <button type="button" data-tab="pos" class="ph-tab-btn px-2.5 sm:px-3 py-2 text-xs font-bold border-b-2 border-transparent text-slate-500 hover:text-slate-800 cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0">
        <span>🚢</span> 발주·입고예정 <span class="text-[10px] opacity-80">(${purchase_orders.length})</span>
      </button>
      <button type="button" data-tab="commissions" class="ph-tab-btn px-2.5 sm:px-3 py-2 text-xs font-bold border-b-2 border-transparent text-violet-700 hover:text-violet-900 cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0">
        <span>💎</span> Commission 단가 <span class="text-[10px] opacity-80">(${commissions.length})</span>
      </button>
    </div>

    <!-- 탭 콘텐츠 본문 (스크롤) -->
    <div class="flex-1 overflow-x-auto overflow-y-auto p-3 sm:p-4 bg-slate-50/50">
      
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

      <!-- 5. 💎 Commission 단가·요율 이력 탭 -->
      <div id="phTabCommissions" class="ph-tab-content hidden">
        ${renderCommissionsTable(commissions)}
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
      document.getElementById('phTabCommissions').classList.toggle('hidden', targetTab !== 'commissions');
    });
  });
}

function renderCommissionsTable(commissions) {
  if (!commissions || commissions.length === 0) {
    return `<div class="py-12 text-center text-slate-400 font-bold">기록된 Commission(해외 직송 커미션) 출하 이력이 없습니다.</div>`;
  }
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const mobileCards = `
    <div class="md:hidden space-y-2">
      ${commissions.map(c => `
        <div class="bg-white border border-violet-200 rounded-xl p-3 space-y-1.5 text-xs shadow-2xs">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="font-mono text-[10px] font-bold bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">${esc(c.ship_date || '-')}</span>
              <span class="text-[10px] font-bold bg-violet-100 text-violet-800 px-1.5 py-0.5 rounded">💎 ${(Number(c.comm_rate) || 0).toFixed(2)}%</span>
              <span class="text-[10px] font-bold ${c.comm_status === '미입금' ? 'text-rose-600' : 'text-emerald-700'}">${esc(c.comm_status || '-')}</span>
            </div>
            <span class="font-mono font-black text-violet-800">$${(Number(c.comm_amt) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div class="font-bold text-slate-900 truncate">${esc(c.customer || '-')}</div>
          <div class="flex items-center justify-between text-[11px] text-slate-600 font-mono">
            <span>${(Number(c.ship_qty) || 0).toLocaleString()} EA @ $${(Number(c.net_up) || 0).toFixed(4)}</span>
            <span>선적 $${(Number(c.ship_amt) || 0).toLocaleString()} · ${esc(c.sales_rep || '-')}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  const desktopTable = `
    <div class="hidden md:block bg-white rounded-xl border border-violet-200 overflow-hidden shadow-xs">
      <table class="w-full text-left text-xs border-collapse">
        <thead class="bg-violet-50 text-violet-950 font-bold border-b border-violet-200">
          <tr>
            <th class="py-2.5 px-3 text-center">선적일</th>
            <th class="py-2.5 px-3">고객사</th>
            <th class="py-2.5 px-3 text-center">제조사</th>
            <th class="py-2.5 px-3">PO / 인보이스</th>
            <th class="py-2.5 px-3 text-right">수량</th>
            <th class="py-2.5 px-3 text-right">단가($)</th>
            <th class="py-2.5 px-3 text-right">선적액($)</th>
            <th class="py-2.5 px-3 text-right">요율(%)</th>
            <th class="py-2.5 px-3 text-right">💎 커미션($)</th>
            <th class="py-2.5 px-3 text-center">정산상태</th>
            <th class="py-2.5 px-3 text-center">담당자</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 text-[11px]">
          ${commissions.map(c => `
            <tr class="hover:bg-violet-50/30">
              <td class="py-2 px-3 text-center font-mono text-slate-600 whitespace-nowrap">${esc(c.ship_date || '-')}</td>
              <td class="py-2 px-3 font-bold text-slate-900 truncate max-w-[160px]" title="${esc(c.customer)}">${esc(c.customer || '-')}</td>
              <td class="py-2 px-3 text-center font-bold text-indigo-800 whitespace-nowrap">${esc(c.maker || '-')}</td>
              <td class="py-2 px-3 font-mono text-[10px] text-slate-600 truncate max-w-[140px]">${esc(c.po_no || '-')}${c.invoice_no ? `<div class="text-[9px] text-slate-400">${esc(c.invoice_no)}</div>` : ''}</td>
              <td class="py-2 px-3 text-right font-mono font-bold text-slate-800 whitespace-nowrap">${(Number(c.ship_qty) || 0).toLocaleString()}</td>
              <td class="py-2 px-3 text-right font-mono font-bold text-blue-700 whitespace-nowrap">$${(Number(c.net_up) || 0).toFixed(4)}</td>
              <td class="py-2 px-3 text-right font-mono text-slate-800 whitespace-nowrap">$${(Number(c.ship_amt) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td class="py-2 px-3 text-right font-mono font-bold text-violet-700 whitespace-nowrap">${(Number(c.comm_rate) || 0).toFixed(2)}%</td>
              <td class="py-2 px-3 text-right font-mono font-black text-violet-900 whitespace-nowrap">$${(Number(c.comm_amt) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td class="py-2 px-3 text-center whitespace-nowrap">
                <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${c.comm_status === '미입금' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}">${esc(c.comm_status || '-')}</span>
              </td>
              <td class="py-2 px-3 text-center font-bold text-indigo-900 whitespace-nowrap">${esc(c.sales_rep || '-')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  return mobileCards + desktopTable;
}

function renderPurchasesTable(purchases) {
  if (!purchases || purchases.length === 0) {
    return `<div class="py-12 text-center text-slate-400 font-bold">기록된 매입(입고) 이력이 없습니다.</div>`;
  }

  const mobileCards = `
    <div class="block md:hidden space-y-2">
      ${purchases.map((p, idx) => `
        <div class="bg-white rounded-xl border border-slate-200 p-3 shadow-xs space-y-1.5">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="text-[10px] font-mono text-slate-400">#${idx + 1}</span>
              <span class="text-[11px] font-mono font-bold text-slate-700">${p.in_date || '-'}</span>
              ${p.maker ? `<span class="text-[10px] font-bold bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">${p.maker}</span>` : ''}
            </div>
            <span class="text-xs font-black text-slate-900 font-mono whitespace-nowrap">${p.qty.toLocaleString()} EA</span>
          </div>
          <div class="text-[11px] font-mono font-bold text-slate-800 truncate" title="${p.invoice_no || ''}">INV: ${p.invoice_no || '-'}</div>
          <div class="grid grid-cols-3 gap-1.5 bg-slate-50 rounded-lg p-2 text-[11px] border border-slate-100">
            <div>
              <span class="text-[9px] text-slate-400 block">외화단가</span>
              <span class="font-mono font-bold text-blue-700">$${p.sl_up.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>
            </div>
            <div>
              <span class="text-[9px] text-slate-400 block">원화단가</span>
              <span class="font-mono font-bold text-indigo-900">${p.w_up > 0 ? `₩${Math.round(p.w_up).toLocaleString()}` : '-'}</span>
            </div>
            <div class="text-right">
              <span class="text-[9px] text-slate-400 block">원화총액</span>
              <span class="font-mono font-bold text-slate-800">${p.w_amt > 0 ? `₩${Math.round(p.w_amt).toLocaleString()}` : '-'}</span>
            </div>
          </div>
          ${(p.in_rate > 0 || p.remark) ? `
            <div class="flex items-center justify-between text-[10px] text-slate-500 pt-0.5 gap-2">
              <span class="truncate">${p.remark || ''}</span>
              ${p.in_rate > 0 ? `<span class="font-mono shrink-0">환율 ₩${p.in_rate.toLocaleString()}</span>` : ''}
            </div>
          ` : ''}
        </div>
      `).join('')}
    </div>
  `;

  return `
    ${mobileCards}
    <div class="hidden md:block bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-xs">
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

  const mobileCards = `
    <div class="block md:hidden space-y-2">
      ${sales.map((s, idx) => {
        const mRate = s.mgn_rate || 0;
        let mBadge = 'text-emerald-700 bg-emerald-50 border-emerald-300';
        if (mRate < 10) mBadge = 'text-rose-700 bg-rose-50 border-rose-300';
        else if (mRate < 20) mBadge = 'text-amber-700 bg-amber-50 border-amber-300';
        return `
          <div class="bg-white rounded-xl border border-slate-200 p-3 shadow-xs space-y-1.5">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-[10px] font-mono text-slate-400">#${idx + 1}</span>
                <span class="text-[11px] font-mono font-bold text-slate-700">${s.out_date || '-'}</span>
                <span class="px-1.5 py-0.5 rounded border text-[10px] font-black ${mBadge}">${mRate}%</span>
              </div>
              <span class="text-[11px] font-bold text-indigo-900 shrink-0">${s.sales_rep || '-'}</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <div class="text-xs font-black text-slate-900 truncate">${s.customer_name || '-'}</div>
              <span class="text-xs font-black text-slate-900 font-mono shrink-0">${s.qty.toLocaleString()} EA</span>
            </div>
            <div class="grid grid-cols-3 gap-1.5 bg-slate-50 rounded-lg p-2 text-[11px] border border-slate-100">
              <div>
                <span class="text-[9px] text-slate-400 block">매입/판매단가</span>
                <span class="font-mono font-bold text-blue-700">₩${Math.round(s.out_up).toLocaleString()}</span>
                <span class="block text-[9px] font-mono text-slate-400">원가 ₩${Math.round(s.in_up).toLocaleString()}</span>
              </div>
              <div>
                <span class="text-[9px] text-slate-400 block">판매금액</span>
                <span class="font-mono font-black text-slate-900">₩${Math.round(s.out_amt).toLocaleString()}</span>
              </div>
              <div class="text-right">
                <span class="text-[9px] text-slate-400 block">마진금액</span>
                <span class="font-mono font-bold text-emerald-700">₩${Math.round(s.mgn).toLocaleString()}</span>
              </div>
            </div>
            ${s.remark ? (() => {
              const trk = (typeof window.extractTrackingNumber === 'function') ? window.extractTrackingNumber(s.remark) : '';
              return `<div class="text-[10px] text-slate-500 flex items-center justify-between gap-1.5"><span class="truncate">${s.remark}</span>${trk ? `<button type="button" onclick="window.openTrackingModal && window.openTrackingModal('${trk}', '${String(s.remark).replace(/'/g, '')}')" class="shrink-0 px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 font-bold cursor-pointer">🚚 추적</button>` : ''}</div>`;
            })() : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;

  return `
    ${mobileCards}
    <div class="hidden md:block bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-xs">
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
                <td class="py-2 px-3 text-slate-500 max-w-[190px]" title="${s.remark || ''}">
                  ${(() => {
                    const trk = (typeof window.extractTrackingNumber === 'function') ? window.extractTrackingNumber(s.remark) : '';
                    return trk
                      ? `<div class="flex items-center gap-1"><span class="truncate">${s.remark}</span><button type="button" onclick="window.openTrackingModal && window.openTrackingModal('${trk}', '${String(s.remark).replace(/'/g, '')}')" class="shrink-0 px-1.5 py-0.5 rounded bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 font-bold text-[10px] cursor-pointer" title="실시간 배송 추적 (${trk})">🚚</button></div>`
                      : `<span class="truncate block">${s.remark || '-'}</span>`;
                  })()}
                </td>
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

  const mobileCards = `
    <div class="block md:hidden space-y-2">
      ${quotations.map((q, idx) => {
        const isUsd = (q.qunit || '').includes('$') || (q.qunit || '').toUpperCase().includes('US');
        const qpStr = isUsd
          ? `$${q.qp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
          : `₩${Math.round(q.qp).toLocaleString()}`;
        const amtStr = isUsd
          ? `$${q.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : `₩${Math.round(q.amount).toLocaleString()}`;
        return `
          <div class="bg-white rounded-xl border border-slate-200 p-3 shadow-xs space-y-1.5">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-[10px] font-mono text-slate-400">#${idx + 1}</span>
                <span class="text-[11px] font-mono font-bold text-slate-700">${q.quote_date || '-'}</span>
                <span class="text-[10px] font-mono text-slate-500 truncate">${q.quote_no || ''}</span>
              </div>
              <span class="text-[11px] font-bold text-indigo-900 shrink-0">${q.sales_rep || '-'}</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <div class="text-xs font-black text-slate-900 truncate">${q.customer_name || '-'}</div>
              <span class="text-xs font-black text-slate-900 font-mono shrink-0">${q.qty.toLocaleString()} EA</span>
            </div>
            <div class="grid grid-cols-2 gap-1.5 bg-slate-50 rounded-lg p-2 text-[11px] border border-slate-100">
              <div>
                <span class="text-[9px] text-slate-400 block">견적단가 (${q.qunit || 'KRW'})</span>
                <span class="font-mono font-bold text-blue-700">${qpStr}</span>
              </div>
              <div class="text-right">
                <span class="text-[9px] text-slate-400 block">견적총액</span>
                <span class="font-mono font-black text-slate-900">${amtStr}</span>
              </div>
            </div>
            ${q.remark ? `<div class="text-[10px] text-slate-500 truncate">${q.remark}</div>` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;

  return `
    ${mobileCards}
    <div class="hidden md:block bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-xs">
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

  const mobileCards = `
    <div class="block md:hidden space-y-2">
      ${pos.map((p, idx) => {
        const isPending = p.status === 'PO';
        const statusBadge = isPending
          ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-100 text-blue-800 border border-blue-300">🚢 입고대기</span>`
          : `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-100 text-slate-700 border border-slate-300">${p.status_label || p.status}</span>`;
        return `
          <div class="bg-white rounded-xl border ${isPending ? 'border-blue-200 bg-blue-50/20' : 'border-slate-200'} p-3 shadow-xs space-y-1.5">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-[10px] font-mono text-slate-400">#${idx + 1}</span>
                ${statusBadge}
                <span class="text-[11px] font-mono text-slate-600">${p.po_date || '-'}</span>
              </div>
              <span class="text-[11px] font-bold text-slate-700 shrink-0">${p.sales_rep || '-'}</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <div class="text-xs font-mono font-bold text-slate-900 truncate">${p.po_no || '-'}</div>
              <span class="text-xs font-black text-slate-900 font-mono shrink-0">${p.qty.toLocaleString()} EA</span>
            </div>
            <div class="grid grid-cols-3 gap-1.5 bg-slate-50 rounded-lg p-2 text-[11px] border border-slate-100">
              <div>
                <span class="text-[9px] text-slate-400 block">발주단가</span>
                <span class="font-mono font-bold text-blue-700">₩${Math.round(p.unit_price).toLocaleString()}</span>
              </div>
              <div>
                <span class="text-[9px] text-slate-400 block">발주금액</span>
                <span class="font-mono font-black text-slate-900">₩${Math.round(p.amount).toLocaleString()}</span>
              </div>
              <div class="text-right">
                <span class="text-[9px] text-slate-400 block">입고예정</span>
                <span class="font-mono font-bold text-indigo-900">${p.eta_date || '-'}</span>
              </div>
            </div>
            <div class="flex items-center justify-between text-[10px] text-slate-600 gap-2">
              <span class="truncate">공급: <strong>${p.supplier_name || '-'}</strong></span>
              <span class="truncate text-indigo-900 font-bold">수요: ${p.real_cust || '-'}</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  return `
    ${mobileCards}
    <div class="hidden md:block bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-xs">
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
