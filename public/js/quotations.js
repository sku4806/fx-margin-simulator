// public/js/quotations.js
// 레거시 세일즈 마스터 [Sales Daily Report - frmQuotationSQL] 견적 이력 뷰어 & Supabase 연동 모듈
import { sbClient } from './supabase.js';

let cachedQuotations = [];
let cachedMfgs = [];
let selectedQuoteIndexes = new Set();

/**
 * 기본 조회 날짜 계산 (종료일: 오늘, 시작일: 2달 전)
 */
function getDefaultDateRange() {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const startDateObj = new Date();
  startDateObj.setMonth(startDateObj.getMonth() - 2);
  const start = startDateObj.toISOString().slice(0, 10);
  return { start, end };
}

/**
 * Supabase 레코드 필드명을 프론트엔드 표준 포맷으로 매핑
 */
function mapSupabaseToQuotation(q) {
  return {
    idx: q.legacy_idx || q.id,
    quote_dt: q.quote_date,
    quote_no: q.quote_no,
    line_no: q.line_no,
    cname: q.customer_name,
    contact: q.contact,
    mfg: q.maker,
    part_no: q.part_name,
    qty_str: q.qty_str,
    qty_int: q.qty_int,
    qunit: q.currency_unit,
    qp: q.quote_price,
    amount: q.amount,
    payment: q.payment_terms,
    sales: q.sales_rep,
    delivery: q.delivery,
    application: q.application,
    remark: q.remark,
    quot_type: q.quote_type,
    address: q.customer_address,
    tel: q.customer_tel,
    fax: q.customer_fax,
    email: q.customer_email
  };
}

/**
 * 서버/클라우드로부터 견적 목록 로드 (Supabase 우선 조회 ➔ 로컬 MS-SQL Fallback)
 */
export async function fetchQuotations(params = {}) {
  const defaultDates = getDefaultDateRange();
  const start = params.startDate !== undefined ? params.startDate : defaultDates.start;
  const end = params.endDate !== undefined ? params.endDate : defaultDates.end;
  const mfg = params.mfg || '';
  const query = params.query || '';

  // 1. Supabase Cloud 우선 조회 (Cloud-First)
  if (sbClient) {
    try {
      let qb = sbClient.from('legacy_quotations').select('*');
      if (start) qb = qb.gte('quote_date', start);
      if (end) qb = qb.lte('quote_date', end);
      if (mfg) qb = qb.eq('maker', mfg);
      if (query) {
        qb = qb.or(`part_name.ilike.%${query}%,customer_name.ilike.%${query}%,sales_rep.ilike.%${query}%,quote_no.ilike.%${query}%`);
      }
      qb = qb.order('quote_date', { ascending: false }).order('quote_no', { ascending: true }).order('line_no', { ascending: true });

      const { data, error } = await qb.limit(500);
      if (!error && data && data.length > 0) {
        cachedQuotations = data.map(mapSupabaseToQuotation);
        return cachedQuotations;
      }
    } catch (e) {
      console.warn("Supabase 견적 조회 우회, 로컬 브릿지 시도:", e);
    }
  }

  // 2. 로컬 MS-SQL 브릿지 Fallback (사내망 및 로컬 서버 환경)
  const urlParams = new URLSearchParams();
  if (start) urlParams.append('start_date', start);
  if (end) urlParams.append('end_date', end);
  if (mfg) urlParams.append('mfg', mfg);
  if (query) urlParams.append('query', query);

  try {
    const res = await fetch(`/api/quotations?${urlParams.toString()}`);
    const data = await res.json();
    if (data.status === 'success') {
      cachedQuotations = data.quotations || [];
      return cachedQuotations;
    } else {
      console.warn("견적 목록 조회 경고:", data.message);
    }
  } catch (err) {
    console.error("견적 API 호출 실패:", err);
  }

  return cachedQuotations;
}

/**
 * 제조사(MFG) 목록 로드 (Supabase 우선 ➔ 로컬 MS-SQL Fallback)
 */
export async function fetchQuotationMfgs() {
  if (cachedMfgs.length > 0) return cachedMfgs;

  // 1. Supabase에서 고유 maker 조회
  if (sbClient) {
    try {
      const { data, error } = await sbClient
        .from('legacy_quotations')
        .select('maker')
        .not('maker', 'is', null)
        .limit(1000);
      if (!error && data && data.length > 0) {
        const set = new Set(data.map(d => d.maker).filter(Boolean));
        cachedMfgs = Array.from(set).sort();
        if (cachedMfgs.length > 0) return cachedMfgs;
      }
    } catch(e) {}
  }

  // 2. 로컬 API 브릿지 Fallback
  try {
    const res = await fetch('/api/quotations/mfgs');
    const data = await res.json();
    if (data.status === 'success') {
      cachedMfgs = data.mfgs || [];
      return cachedMfgs;
    }
  } catch (err) {
    console.warn("MFG 목록 조회 실패:", err);
  }

  return [];
}

/**
 * 견적 번호(QuoteNo)로 전체 상세 라인 조회 후 BSK 표준 견적서 모달 열기
 */
export async function openLegacyQuotationModal(quoteNo, fallbackItem = null) {
  let items = [];

  // 1. Supabase에서 해당 quote_no의 모든 라인 조회
  if (sbClient && quoteNo) {
    try {
      const { data, error } = await sbClient
        .from('legacy_quotations')
        .select('*')
        .eq('quote_no', quoteNo)
        .order('line_no', { ascending: true });
      if (!error && data && data.length > 0) {
        items = data.map(mapSupabaseToQuotation);
      }
    } catch(e) {}
  }

  // 2. 로컬 API 브릿지 Fallback
  if (items.length === 0 && quoteNo) {
    try {
      const res = await fetch(`/api/quotations/${encodeURIComponent(quoteNo)}`);
      const data = await res.json();
      if (data.status === 'success' && data.items && data.items.length > 0) {
        items = data.items;
      }
    } catch (e) {
      console.warn("견적 상세 조회 예외:", e);
    }
  }

  if (items.length === 0 && fallbackItem) {
    items = [fallbackItem];
  }

  if (items.length === 0) {
    alert("선택된 견적 데이터가 없습니다.");
    return;
  }

  const prime = items[0];

  // 환율 조회 (기본 1,350원)
  let liveFx = 1350;
  try {
    const fxText = document.getElementById("liveFx")?.innerText || "";
    const m = fxText.match(/([0-9,]+(\.[0-9]+)?)/);
    if (m) liveFx = parseFloat(m[1].replace(/,/g, ""));
  } catch(e) {}

  // BSK 견적서 품목 배열 세팅
  window.quoteItemsData = items.map(it => {
    const qty = Number(it.qty_int || String(it.qty_str || '').replace(/[^0-9]/g, '')) || 1;
    const isUsd = (it.qunit && it.qunit.includes('$')) || (it.quot_type && it.quot_type.includes('$'));
    const unitPriceRaw = Number(it.qp) || 0;
    const unitKrw = isUsd ? Math.round(unitPriceRaw * liveFx) : Math.round(unitPriceRaw);

    return {
      partName: it.part_no || "-",
      maker: it.mfg || "-",
      qty: qty,
      unitKrw: unitKrw,
      delivery: it.delivery || "2-3WKS"
    };
  });

  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === "INPUT") el.value = val;
    else el.innerText = val;
  };

  setEl("qpCustomer", prime.cname || "고객사");
  setEl("qpAttnFull", prime.contact ? `${prime.contact} 담당자님` : "담당자님");
  setEl("qpTel", prime.tel || ".");
  setEl("qpFax", prime.fax || "");
  setEl("qpDate", prime.quote_dt || new Date().toISOString().slice(0, 10));
  setEl("qpRefNo", prime.quote_no || "QBK-MANUAL");
  setEl("qpSales", prime.sales || "황 환");

  // 테이블 행 렌더링 및 합계 계산
  if (typeof window.renderQuotationTableRows === 'function') {
    window.renderQuotationTableRows();
  }
  if (typeof window.recalculateQuoteTotals === 'function') {
    window.recalculateQuoteTotals();
  }

  // 모달 열기
  const modal = document.getElementById("quotationModal");
  if (modal) modal.classList.add("active-modal");
}

/**
 * 웹 ERP에서 작성된 견적서를 Supabase legacy_quotations에 자동 저장/아카이빙
 */
export async function saveCurrentQuotationToSupabase() {
  if (!sbClient) return;

  try {
    const cust = document.getElementById("qpCustomer")?.value.trim() || "";
    const contact = document.getElementById("qpAttnFull")?.value.trim() || "";
    const tel = document.getElementById("qpTel")?.value.trim() || "";
    const fax = document.getElementById("qpFax")?.value.trim() || "";
    const dateStr = document.getElementById("qpDate")?.value.trim() || new Date().toISOString().slice(0, 10);
    const refNo = document.getElementById("qpRefNo")?.value.trim() || "";
    const sales = document.getElementById("qpSales")?.value.trim() || "";

    const items = window.quoteItemsData || [];
    if (!refNo || items.length === 0) return;

    const records = items.map((it, idx) => {
      const qty = Number(it.qty) || 1;
      const unitKrw = Number(it.unitKrw) || 0;
      const amount = qty * unitKrw;
      return {
        quote_no: refNo,
        quote_date: dateStr,
        line_no: idx + 1,
        customer_name: cust,
        contact: contact,
        maker: it.maker || "OTHERS",
        part_name: it.partName || "-",
        qty_str: `${qty.toLocaleString()}EA`,
        qty_int: qty,
        currency_unit: "₩",
        quote_price: unitKrw,
        amount: amount,
        sales_rep: sales,
        delivery: it.delivery || "2-3WKS",
        customer_tel: tel,
        customer_fax: fax,
        last_synced_at: new Date().toISOString()
      };
    });

    const { error } = await sbClient.from('legacy_quotations').insert(records);
    if (!error) {
      console.log(`✅ [legacy_quotations] 웹 발행 견적서 클라우드 자동 저장 완료: ${refNo} (${records.length}건)`);
    }
  } catch (err) {
    console.warn("견적서 Supabase 자동 아카이빙 예외:", err);
  }
}
window.saveCurrentQuotationToSupabase = saveCurrentQuotationToSupabase;

/**
 * 견적 목록 전체 뷰 렌더링
 */
export function renderQuotationsView(containerId = 'quotationsSection') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const defaultDates = getDefaultDateRange();
  selectedQuoteIndexes.clear();

  // 금액 합계 계산
  let count = cachedQuotations.length;
  let totalUsd = 0;
  let totalKrw = 0;

  cachedQuotations.forEach(q => {
    const amt = Number(q.amount) || 0;
    const isUsd = (q.qunit && q.qunit.includes('$')) || (q.quot_type && q.quot_type.includes('$'));
    if (isUsd) {
      totalUsd += amt;
    } else {
      totalKrw += amt;
    }
  });

  container.innerHTML = `
    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col space-y-3 p-3 sm:p-4">
      
      <!-- 1. 레거시 세일즈 마스터 스타일 헤더 바 (올리브/그린 테마) -->
      <div class="rounded-xl overflow-hidden shadow-sm border border-[#4d5e33]">
        <div class="bg-[#5b6f3c] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2.5">
            <span class="text-lg">📋</span>
            <div>
              <h2 class="text-base sm:text-lg font-black tracking-wide uppercase font-sans text-white">QUOTATION LIST</h2>
              <p class="text-[10px] text-lime-100 font-medium">세일즈 마스터 MS-SQL 및 Supabase 클라우드 실시간 동기화</p>
            </div>
          </div>

          <!-- 상단 필터 및 버튼군 -->
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <!-- DATE 필터 -->
            <div class="flex items-center gap-1 bg-[#4d5e33] px-2 py-1 rounded-lg border border-lime-500/30">
              <span class="text-[10px] font-bold text-lime-200 tracking-wider">DATE:</span>
              <input type="date" id="quoteStartDate" value="${defaultDates.start}" 
                     class="bg-white text-slate-800 text-[11px] px-1.5 py-0.5 rounded border border-slate-300 font-mono outline-none">
              <span class="text-lime-200 text-[10px]">~</span>
              <input type="date" id="quoteEndDate" value="${defaultDates.end}" 
                     class="bg-white text-slate-800 text-[11px] px-1.5 py-0.5 rounded border border-slate-300 font-mono outline-none">
            </div>

            <!-- MFG 드롭다운 필터 -->
            <div class="flex items-center gap-1 bg-[#4d5e33] px-2 py-1 rounded-lg border border-lime-500/30">
              <span class="text-[10px] font-bold text-lime-200 tracking-wider">MFG:</span>
              <select id="quoteMfgSelect" class="bg-white text-slate-800 text-[11px] px-2 py-0.5 rounded border border-slate-300 outline-none max-w-[120px]">
                <option value="">(전체 MFG)</option>
                ${cachedMfgs.map(m => `<option value="${m}">${m}</option>`).join('')}
              </select>
            </div>

            <!-- 검색 버튼 -->
            <button id="btnSearchQuotes" class="px-3 py-1.5 bg-white text-[#3f4f26] font-black text-xs rounded-lg hover:bg-lime-50 shadow-sm transition-colors flex items-center gap-1">
              <span>🔍</span> 검색
            </button>

            <!-- REPORT (선택 건 견적서 출력) -->
            <button id="btnQuoteReport" class="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-900 font-black text-xs rounded-lg shadow-sm transition-colors flex items-center gap-1">
              <span>📄</span> REPORT
            </button>

            <!-- REPORT_Resend -->
            <button id="btnQuoteResend" class="px-2.5 py-1.5 bg-[#44542c] hover:bg-[#384623] text-lime-100 font-bold text-xs rounded-lg border border-lime-500/40 shadow-sm transition-colors">
              REPORT_Resend
            </button>

            <!-- 엑셀 다운로드 -->
            <button id="btnQuoteExcelExport" class="px-2.5 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs rounded-lg shadow-sm transition-colors flex items-center gap-1">
              <span>📥</span> Excel
            </button>
          </div>
        </div>
      </div>

      <!-- 2. 실시간 검색 및 Grand Summaries 요약 바 -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-2.5 items-center">
        <!-- 검색창 -->
        <div class="md:col-span-1 relative">
          <input type="text" id="quoteLiveFilter" placeholder="품번(Part#), 고객사명, 담당자, 견적번호 검색..." 
                 class="w-full pl-7 pr-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:ring-2 focus:ring-[#5b6f3c] outline-none">
          <span class="absolute left-2.5 top-2 text-slate-400 text-xs">🔍</span>
        </div>

        <!-- Grand Summaries 통계 -->
        <div class="md:col-span-2 bg-lime-50/70 border border-lime-200 rounded-xl p-2 text-xs font-mono font-bold text-slate-800 flex flex-wrap items-center justify-between gap-3 shadow-xs">
          <div class="flex items-center gap-2">
            <span class="text-[#3f4f26] font-sans font-black">Grand Summaries</span>
            <span class="text-slate-500 font-sans font-normal text-[11px]">(총 <strong id="quoteCountBadge" class="text-slate-800">${count}</strong>건)</span>
          </div>
          <div class="flex items-center gap-4 text-xs">
            <div>USD 합계: <span id="quoteTotalUsd" class="text-emerald-700 font-black">$${totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
            <div>KRW 합계: <span id="quoteTotalKrw" class="text-indigo-900 font-black">₩${Math.round(totalKrw).toLocaleString()}</span></div>
          </div>
        </div>
      </div>

      <!-- 3. 견적 데이터 테이블 -->
      <div class="overflow-x-auto max-h-[68vh] overflow-y-auto border border-slate-200 rounded-xl shadow-xs">
        <table class="w-full text-left text-xs border-collapse">
          <thead class="bg-[#f2f4ec] text-[#33401e] border-b border-slate-200 uppercase font-bold sticky top-0 z-10 shadow-xs text-[11px]">
            <tr>
              <th class="py-2 px-2 text-center w-8">
                <input type="checkbox" id="chkQuoteSelectAll" class="rounded text-[#5b6f3c] focus:ring-0">
              </th>
              <th class="py-2 px-2 text-center whitespace-nowrap w-9">#</th>
              <th class="py-2 px-2.5 text-center whitespace-nowrap w-[90px]">QUOTE DT</th>
              <th class="py-2 px-3 text-left min-w-[150px]">CNAME</th>
              <th class="py-2 px-2.5 text-left min-w-[80px]">CONTACT</th>
              <th class="py-2 px-2.5 text-left min-w-[70px]">MFG</th>
              <th class="py-2 px-1 text-center w-12">Line#</th>
              <th class="py-2 px-3 text-left min-w-[180px]">PartNo</th>
              <th class="py-2 px-2.5 text-right whitespace-nowrap min-w-[70px]">Qty</th>
              <th class="py-2 px-2.5 text-right whitespace-nowrap min-w-[80px]">QP</th>
              <th class="py-2 px-3 text-right whitespace-nowrap min-w-[100px]">AMOUNT</th>
              <th class="py-2 px-3 text-left min-w-[140px]">Payment</th>
              <th class="py-2 px-2 text-center whitespace-nowrap w-16">Sales</th>
              <th class="py-2 px-2 text-center whitespace-nowrap min-w-[80px]">Delivery</th>
              <th class="py-2 px-2 text-left min-w-[70px]">Application</th>
              <th class="py-2 px-2 text-center whitespace-nowrap w-16">작업</th>
            </tr>
          </thead>
          <tbody id="quotationTableBody" class="divide-y divide-slate-100 font-medium bg-white text-slate-700">
            ${generateTableRows(cachedQuotations)}
          </tbody>
        </table>
      </div>

    </div>
  `;

  // 이벤트 리스너 바인딩
  bindQuotationEvents();
}

/**
 * 테이블 행 렌더링
 */
function generateTableRows(items) {
  if (!items || items.length === 0) {
    return `<tr><td colspan="16" class="text-center py-12 text-slate-400 font-medium">조회된 견적 이력이 없습니다.</td></tr>`;
  }

  return items.map((q, idx) => {
    const isSelected = selectedQuoteIndexes.has(idx);
    const lineStr = q.line_no !== null && q.line_no !== undefined && q.line_no !== "" ? q.line_no : "-";
    const isUsd = (q.qunit && q.qunit.includes('$')) || (q.quot_type && q.quot_type.includes('$'));
    const isWon = (q.qunit && q.qunit.includes('\\')) || (q.quot_type && q.quot_type.includes('Won'));
    
    // 단가 표기 포맷
    let qpDisplay = "";
    if (isUsd) {
      qpDisplay = `<span class="text-emerald-700 font-bold">$ ${Number(q.qp).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>`;
    } else if (isWon) {
      qpDisplay = `<span class="text-indigo-900 font-bold">₩ ${Math.round(Number(q.qp)).toLocaleString()}</span>`;
    } else {
      qpDisplay = `<span class="text-slate-800 font-bold">${q.qp}</span>`;
    }

    // 금액 표기
    const amountVal = Number(q.amount) || 0;
    const amountDisplay = amountVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const bgClass = idx % 2 === 0 ? "bg-white" : "bg-amber-50/30";

    return `
      <tr class="${bgClass} hover:bg-lime-50/80 transition-colors border-b border-slate-100 text-[11px] cursor-pointer" 
          data-quote-idx="${idx}" data-quote-no="${q.quote_no || ''}">
        <td class="py-1.5 px-2 text-center" onclick="event.stopPropagation()">
          <input type="checkbox" class="quote-row-chk rounded text-[#5b6f3c] focus:ring-0" data-idx="${idx}" ${isSelected ? 'checked' : ''}>
        </td>
        <td class="py-1.5 px-2 text-center font-mono text-slate-400">${idx + 1}</td>
        <td class="py-1.5 px-2.5 text-center font-mono text-slate-600 whitespace-nowrap">${q.quote_dt || '-'}</td>
        <td class="py-1.5 px-3 font-bold text-slate-900 truncate max-w-[180px]" title="${q.cname || '-'}">${q.cname || '-'}</td>
        <td class="py-1.5 px-2.5 text-slate-700 truncate max-w-[100px]" title="${q.contact || '-'}">${q.contact || '-'}</td>
        <td class="py-1.5 px-2.5 text-slate-800 font-semibold truncate max-w-[80px]">${q.mfg || '-'}</td>
        <td class="py-1.5 px-1 text-center font-mono text-slate-500">${lineStr}</td>
        <td class="py-1.5 px-3 font-black text-indigo-950 font-mono tracking-tight">${q.part_no || '-'}</td>
        <td class="py-1.5 px-2.5 text-right font-semibold text-slate-700 whitespace-nowrap">${q.qty_str || (q.qty_int ? q.qty_int.toLocaleString() : '-')}</td>
        <td class="py-1.5 px-2.5 text-right font-mono whitespace-nowrap">${qpDisplay}</td>
        <td class="py-1.5 px-3 text-right font-mono font-bold text-slate-900 whitespace-nowrap">${amountDisplay}</td>
        <td class="py-1.5 px-3 text-slate-600 text-[10px] truncate max-w-[160px]" title="${q.payment || '-'}">${q.payment || '-'}</td>
        <td class="py-1.5 px-2 text-center font-medium text-slate-700 whitespace-nowrap">${q.sales || '-'}</td>
        <td class="py-1.5 px-2 text-center font-mono text-slate-500 text-[10px] whitespace-nowrap">${q.delivery || '-'}</td>
        <td class="py-1.5 px-2 text-slate-500 text-[10px] truncate max-w-[80px]" title="${q.application || '-'}">${q.application || '-'}</td>
        <td class="py-1.5 px-2 text-center whitespace-nowrap" onclick="event.stopPropagation()">
          <button type="button" class="btn-single-quote-print px-1.5 py-0.5 bg-slate-100 hover:bg-lime-600 hover:text-white text-slate-700 rounded text-[10px] font-bold transition-colors"
                  data-idx="${idx}" title="BSK 표준 견적서 출력">
            인쇄
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * 이벤트 바인딩
 */
function bindQuotationEvents() {
  const btnSearch = document.getElementById("btnSearchQuotes");
  const inputStart = document.getElementById("quoteStartDate");
  const inputEnd = document.getElementById("quoteEndDate");
  const selectMfg = document.getElementById("quoteMfgSelect");
  const liveFilter = document.getElementById("quoteLiveFilter");
  const btnReport = document.getElementById("btnQuoteReport");
  const btnResend = document.getElementById("btnQuoteResend");
  const btnExcel = document.getElementById("btnQuoteExcelExport");
  const chkAll = document.getElementById("chkQuoteSelectAll");
  const tbody = document.getElementById("quotationTableBody");

  // 1. 검색 버튼 클릭
  btnSearch?.addEventListener("click", async () => {
    const startDate = inputStart?.value || '';
    const endDate = inputEnd?.value || '';
    const mfg = selectMfg?.value || '';
    const query = liveFilter?.value || '';

    btnSearch.disabled = true;
    btnSearch.innerText = "조회중...";

    await fetchQuotations({ startDate, endDate, mfg, query });
    renderQuotationsView('quotationsSection');
  });

  // 2. 실시간 키워드 필터링
  liveFilter?.addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase().trim();
    const filtered = cachedQuotations.filter(q => 
      (q.part_no && q.part_no.toLowerCase().includes(term)) ||
      (q.cname && q.cname.toLowerCase().includes(term)) ||
      (q.contact && q.contact.toLowerCase().includes(term)) ||
      (q.sales && q.sales.toLowerCase().includes(term)) ||
      (q.mfg && q.mfg.toLowerCase().includes(term)) ||
      (q.quote_no && q.quote_no.toLowerCase().includes(term))
    );
    if (tbody) tbody.innerHTML = generateTableRows(filtered);
    updateSummaries(filtered);
  });

  // 3. 전체 선택 체크박스
  chkAll?.addEventListener("change", (e) => {
    const checked = e.target.checked;
    document.querySelectorAll(".quote-row-chk").forEach(chk => {
      chk.checked = checked;
      const idx = parseInt(chk.getAttribute("data-idx"), 10);
      if (checked) selectedQuoteIndexes.add(idx);
      else selectedQuoteIndexes.delete(idx);
    });
  });

  // 4. 개별 행 체크박스
  tbody?.addEventListener("change", (e) => {
    if (e.target.classList.contains("quote-row-chk")) {
      const idx = parseInt(e.target.getAttribute("data-idx"), 10);
      if (e.target.checked) selectedQuoteIndexes.add(idx);
      else selectedQuoteIndexes.delete(idx);
    }
  });

  // 5. 행 클릭 시 견적서 미리보기 모달 연동
  tbody?.addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-quote-idx]");
    if (!row) return;
    const idx = parseInt(row.getAttribute("data-quote-idx"), 10);
    const item = cachedQuotations[idx];
    if (item) {
      openLegacyQuotationModal(item.quote_no, item);
    }
  });

  // 6. 단일 인쇄 버튼 클릭
  tbody?.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-single-quote-print");
    if (!btn) return;
    e.stopPropagation();
    const idx = parseInt(btn.getAttribute("data-idx"), 10);
    const item = cachedQuotations[idx];
    if (item) {
      openLegacyQuotationModal(item.quote_no, item);
    }
  });

  // 7. 상단 [REPORT] 버튼 클릭
  btnReport?.addEventListener("click", () => {
    if (selectedQuoteIndexes.size === 0) {
      if (cachedQuotations.length > 0) {
        openLegacyQuotationModal(cachedQuotations[0].quote_no, cachedQuotations[0]);
      } else {
        alert("출력할 견적 내역이 없습니다.");
      }
      return;
    }
    const firstSelectedIdx = Array.from(selectedQuoteIndexes)[0];
    const item = cachedQuotations[firstSelectedIdx];
    if (item) {
      openLegacyQuotationModal(item.quote_no, item);
    }
  });

  // 8. [REPORT_Resend] 버튼 클릭
  btnResend?.addEventListener("click", () => {
    btnReport?.click();
  });

  // 9. [Excel 다운로드] 버튼 클릭
  btnExcel?.addEventListener("click", () => {
    exportQuotationsToCsv(cachedQuotations);
  });
}

/**
 * 필터 변경 시 요약 바 수치 갱신
 */
function updateSummaries(items) {
  let count = items.length;
  let totalUsd = 0;
  let totalKrw = 0;

  items.forEach(q => {
    const amt = Number(q.amount) || 0;
    const isUsd = (q.qunit && q.qunit.includes('$')) || (q.quot_type && q.quot_type.includes('$'));
    if (isUsd) totalUsd += amt;
    else totalKrw += amt;
  });

  const countBadge = document.getElementById("quoteCountBadge");
  const usdBadge = document.getElementById("quoteTotalUsd");
  const krwBadge = document.getElementById("quoteTotalKrw");

  if (countBadge) countBadge.innerText = count;
  if (usdBadge) usdBadge.innerText = `$${totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (krwBadge) krwBadge.innerText = `₩${Math.round(totalKrw).toLocaleString()}`;
}

/**
 * 견적 목록 CSV 엑셀 내보내기
 */
function exportQuotationsToCsv(items) {
  if (!items || items.length === 0) {
    alert("내보낼 견적 데이터가 없습니다.");
    return;
  }

  const headers = ["견적일자", "고객사명", "담당자", "제조사", "Line#", "품번(Part#)", "수량", "단가", "금액", "결제조건", "영업담당", "납기", "용도", "견적번호", "비고"];
  const rows = items.map(q => [
    `"${q.quote_dt || ''}"`,
    `"${(q.cname || '').replace(/"/g, '""')}"`,
    `"${(q.contact || '').replace(/"/g, '""')}"`,
    `"${(q.mfg || '').replace(/"/g, '""')}"`,
    `"${q.line_no || ''}"`,
    `"${(q.part_no || '').replace(/"/g, '""')}"`,
    `"${(q.qty_str || q.qty_int || '').toString().replace(/"/g, '""')}"`,
    `"${q.qunit || ''} ${q.qp || 0}"`,
    `"${q.amount || 0}"`,
    `"${(q.payment || '').replace(/"/g, '""')}"`,
    `"${(q.sales || '').replace(/"/g, '""')}"`,
    `"${(q.delivery || '').replace(/"/g, '""')}"`,
    `"${(q.application || '').replace(/"/g, '""')}"`,
    `"${(q.quote_no || '').replace(/"/g, '""')}"`,
    `"${(q.remark || '').replace(/"/g, '""')}"`
  ]);

  const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const today = new Date().toISOString().slice(0, 10);
  a.download = `BSK_Quotation_List_${today}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
