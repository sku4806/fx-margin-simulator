// public/js/quotations.js
// 레거시 세일즈 마스터 [Sales Daily Report - frmQuotationSQL] 견적 이력 뷰어 & Supabase 연동 모듈
import { sbClient } from './supabase.js';

let cachedQuotations = [];
let cachedMfgs = [];
let selectedQuoteIndexes = new Set();

let quotePage = 1;
let quotePageSize = 50;
let lastFilteredQuotes = [];

// 상태 보존용 전역 변수
const initDates = getDefaultDateRange();
let currentStartDate = initDates.start;
let currentEndDate = initDates.end;
let currentMfg = '';
let currentPreset = '2M';

const SALES_ALIAS_MAP = {
  'william': ['고기봉', 'william'],
  'willam': ['고기봉', 'willam'],
  'joey': ['조지윤', '조재윤', 'joey'],
  'joye': ['조지윤', '조재윤', 'joye'],
  'allen': ['박재범', 'allen'],
  'kelly': ['김경래', 'kelly'],
  'steve': ['황환', 'steve'],
  'dustin': ['김명호', 'dustin'],
  'eric': ['이재상', 'eric'],
  'timothy': ['박대원', 'timothy'],
  'paul': ['김현진', 'paul'],
  'logan': ['이민수', 'logan']
};

function debounce(fn, delay = 200) {
  let timer = null;
  return function(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

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
    id: q.id,
    legacy_idx: q.legacy_idx,
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
  const start = params.startDate !== undefined ? params.startDate : currentStartDate;
  const end = params.endDate !== undefined ? params.endDate : currentEndDate;
  const mfg = params.mfg !== undefined ? params.mfg : currentMfg;
  const query = params.query || '';

  currentStartDate = start;
  currentEndDate = end;
  currentMfg = mfg;

  // 1. Supabase Cloud 우선 조회 (Cloud-First)
  if (sbClient) {
    try {
      let qb = sbClient.from('legacy_quotations').select('*');
      if (start) qb = qb.gte('quote_date', start);
      if (end) qb = qb.lte('quote_date', end);
      if (mfg) qb = qb.eq('maker', mfg);
      if (query) {
        const qTrim = query.trim();
        const orClauses = [
          `part_name.ilike.%${qTrim}%`,
          `customer_name.ilike.%${qTrim}%`,
          `sales_rep.ilike.%${qTrim}%`,
          `quote_no.ilike.%${qTrim}%`
        ];
        const qLower = qTrim.toLowerCase();
        for (const [k, vals] of Object.entries(SALES_ALIAS_MAP)) {
          if (qLower.includes(k)) {
            for (const v of vals) {
              orClauses.push(`sales_rep.ilike.%${v}%`);
            }
          }
        }
        qb = qb.or(orClauses.join(','));
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

    const paymentTerms = document.getElementById("qpPayment")?.value?.trim() || "T/T in advance";
    const remark = document.getElementById("qpRemark")?.value?.trim() || "";
    const currToggle = document.getElementById("qpCurrency")?.value?.trim() || "";
    const isUsdQuote = currToggle === "USD" || currToggle === "$";

    const items = window.quoteItemsData || [];
    if (!refNo || items.length === 0) return;

    const liveFx = (typeof window.getLiveFxRate === 'function' && window.getLiveFxRate() > 0) ? window.getLiveFxRate() : 1350;

    // 동일 견적번호(refNo)의 기존 웹 발행 레코드 제거 후 재저장 (재인쇄 시 중복 적재 방지)
    try {
      await sbClient.from('legacy_quotations').delete().eq('quote_no', refNo).is('legacy_idx', null);
    } catch (de) {}

    const records = items.map((it, idx) => {
      const qty = Number(it.qty) || 1;
      const unitKrw = Number(it.unitKrw) || 0;
      const unitPrice = isUsdQuote ? Number((unitKrw / liveFx).toFixed(4)) : unitKrw;
      const amount = isUsdQuote ? Number((qty * unitPrice).toFixed(2)) : (qty * unitKrw);
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
        currency_unit: isUsdQuote ? "$" : "₩",
        quote_price: unitPrice,
        amount: amount,
        payment_terms: paymentTerms,
        sales_rep: sales,
        delivery: it.delivery || "2-3WKS",
        remark: remark,
        quote_type: isUsdQuote ? "$" : "Won",
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

// 퀵 날짜 프리셋 핸들러
export function setQuoteDatePreset(preset) {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  let start = '';

  if (preset === '1M') {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    start = d.toISOString().slice(0, 10);
  } else if (preset === '3M') {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    start = d.toISOString().slice(0, 10);
  } else if (preset === '6M') {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    start = d.toISOString().slice(0, 10);
  } else if (preset === '1Y') {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    start = d.toISOString().slice(0, 10);
  } else if (preset === 'ALL') {
    start = '2000-01-01';
  } else {
    const d = new Date();
    d.setMonth(d.getMonth() - 2);
    start = d.toISOString().slice(0, 10);
  }

  currentPreset = preset;
  currentStartDate = start;
  currentEndDate = end;

  const inputStart = document.getElementById('quoteStartDate');
  const inputEnd = document.getElementById('quoteEndDate');
  if (inputStart) inputStart.value = start;
  if (inputEnd) inputEnd.value = end;

  const btnSearch = document.getElementById('btnSearchQuotes');
  if (btnSearch) btnSearch.click();
}
window.setQuoteDatePreset = setQuoteDatePreset;

/**
 * 견적 목록 전체 뷰 렌더링
 */
export function renderQuotationsView(containerId = 'quotationsSection') {
  const container = document.getElementById(containerId);
  if (!container) return;

  selectedQuoteIndexes.clear();
  lastFilteredQuotes = cachedQuotations || [];
  quotePage = 1;

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
        <div class="bg-[#5b6f3c] text-white p-3 sm:p-4 space-y-2.5">
          <!-- 상단 1행: 타이틀 및 주요 액션 버튼 -->
          <div class="flex flex-wrap items-center justify-between gap-2.5">
            <div class="flex items-center gap-2.5">
              <span class="text-xl">📋</span>
              <div>
                <div class="flex items-center gap-2">
                  <h2 class="text-base sm:text-lg font-black tracking-wide uppercase font-sans text-white">QUOTATION LIST</h2>
                  <span class="text-[9px] bg-lime-400/20 text-lime-200 border border-lime-400/30 px-1.5 py-0.2 rounded font-bold">MS-SQL 연동</span>
                </div>
                <p class="text-[10px] text-lime-100 font-medium">세일즈 마스터 연동 견적 이력 및 BSK 견적서 재발행</p>
              </div>
            </div>

            <!-- 우측 액션 버튼군 (모바일 2열 그리드 / 데스크톱 인라인) -->
            <div class="grid grid-cols-2 sm:flex sm:items-center gap-1.5 w-full sm:w-auto">
              ${(typeof window.isCsOrAdminUser === 'function' && window.isCsOrAdminUser()) ? `
                <button type="button" onclick="window.openQuotationCrudModal && window.openQuotationCrudModal(null)" class="h-9 sm:h-8 px-2.5 sm:px-3 bg-lime-300 hover:bg-lime-200 text-slate-900 font-black text-xs rounded-lg shadow-xs transition-colors flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap" title="신규 견적 내역 직접 등록">
                  <span>➕</span> 신규 견적
                </button>
              ` : ''}
              <button id="btnSearchQuotes" class="h-9 sm:h-8 px-2.5 sm:px-3 bg-white text-[#3f4f26] font-black text-xs rounded-lg hover:bg-lime-50 shadow-xs transition-colors flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap">
                <span>🔍</span> 검색
              </button>
              <button id="btnQuoteReport" class="h-9 sm:h-8 px-2.5 sm:px-3 bg-amber-400 hover:bg-amber-300 text-slate-900 font-black text-xs rounded-lg shadow-xs transition-colors flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap" title="선택된 견적서 상세 확인 및 BSK 공식 견적서(A4/PDF) 재발행">
                <span>📄</span> 견적서 조회
              </button>
              <button id="btnQuoteExcelExport" class="h-9 sm:h-8 px-2.5 bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs rounded-lg shadow-xs transition-colors flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap">
                <span>📥</span> Excel
              </button>
            </div>
          </div>

          <!-- 하단 2행: 통합 필터 툴바 (모바일 넘침 완전 방지) -->
          <div class="bg-black/20 p-2 rounded-lg flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-2 text-xs">
            <div class="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
              <!-- 퀵 날짜 프리셋 버튼군 -->
              <div class="flex items-center justify-between sm:justify-start gap-0.5 bg-[#44542c] p-0.5 rounded-lg border border-lime-500/30 overflow-x-auto scrollbar-none">
                <button type="button" onclick="window.setQuoteDatePreset('1M')" 
                        class="flex-1 sm:flex-none px-2.5 py-1 sm:py-0.5 rounded text-[11px] sm:text-[10px] font-bold transition-colors whitespace-nowrap ${currentPreset === '1M' ? 'bg-amber-400 text-slate-900 shadow-xs' : 'text-lime-200 hover:bg-[#384623]'}">1개월</button>
                <button type="button" onclick="window.setQuoteDatePreset('3M')" 
                        class="flex-1 sm:flex-none px-2.5 py-1 sm:py-0.5 rounded text-[11px] sm:text-[10px] font-bold transition-colors whitespace-nowrap ${currentPreset === '3M' ? 'bg-amber-400 text-slate-900 shadow-xs' : 'text-lime-200 hover:bg-[#384623]'}">3개월</button>
                <button type="button" onclick="window.setQuoteDatePreset('6M')" 
                        class="flex-1 sm:flex-none px-2.5 py-1 sm:py-0.5 rounded text-[11px] sm:text-[10px] font-bold transition-colors whitespace-nowrap ${currentPreset === '6M' ? 'bg-amber-400 text-slate-900 shadow-xs' : 'text-lime-200 hover:bg-[#384623]'}">6개월</button>
                <button type="button" onclick="window.setQuoteDatePreset('1Y')" 
                        class="flex-1 sm:flex-none px-2.5 py-1 sm:py-0.5 rounded text-[11px] sm:text-[10px] font-bold transition-colors whitespace-nowrap ${currentPreset === '1Y' ? 'bg-amber-400 text-slate-900 shadow-xs' : 'text-lime-200 hover:bg-[#384623]'}">1년</button>
                <button type="button" onclick="window.setQuoteDatePreset('ALL')" 
                        class="flex-1 sm:flex-none px-2.5 py-1 sm:py-0.5 rounded text-[11px] sm:text-[10px] font-bold transition-colors whitespace-nowrap ${currentPreset === 'ALL' ? 'bg-amber-400 text-slate-900 shadow-xs' : 'text-lime-200 hover:bg-[#384623]'}">전체</button>
              </div>

              <!-- DATE 필터 (모바일 2열 깔끔 배치) -->
              <div class="flex flex-col sm:flex-row sm:items-center gap-1 bg-[#4d5e33] px-2 py-1.5 sm:py-1 rounded-lg border border-lime-500/30 w-full sm:w-auto">
                <span class="text-[10px] font-bold text-lime-200 tracking-wider whitespace-nowrap shrink-0">기간:</span>
                <div class="grid grid-cols-[1fr_auto_1fr] sm:flex items-center gap-1 w-full sm:w-auto">
                  <input type="date" id="quoteStartDate" value="${currentStartDate}" 
                         class="w-full min-w-0 bg-white text-slate-800 text-[11px] px-1.5 py-1 sm:py-0.5 rounded border border-slate-300 font-mono outline-none">
                  <span class="text-lime-200 text-[10px] text-center">~</span>
                  <input type="date" id="quoteEndDate" value="${currentEndDate}" 
                         class="w-full min-w-0 bg-white text-slate-800 text-[11px] px-1.5 py-1 sm:py-0.5 rounded border border-slate-300 font-mono outline-none">
                </div>
              </div>

              <!-- MFG 드롭다운 필터 -->
              <div class="flex items-center gap-1.5 bg-[#4d5e33] px-2 py-1.5 sm:py-1 rounded-lg border border-lime-500/30 w-full sm:w-auto">
                <span class="text-[10px] font-bold text-lime-200 tracking-wider whitespace-nowrap shrink-0">제조사:</span>
                <select id="quoteMfgSelect" class="flex-1 sm:flex-none bg-white text-slate-800 text-[11px] px-2 py-1 sm:py-0.5 rounded border border-slate-300 outline-none sm:max-w-[140px]">
                  <option value="" ${currentMfg === '' ? 'selected' : ''}>(전체 MFG)</option>
                  ${cachedMfgs.map(m => `<option value="${m}" ${currentMfg === m ? 'selected' : ''}>${m}</option>`).join('')}
                </select>
              </div>
            </div>
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

      <!-- 3-A. 모바일 전용 카드 뷰 (md:hidden) -->
      <div id="quoteCardContainer" class="block md:hidden space-y-2.5 max-h-[66vh] overflow-y-auto pr-0.5">
      </div>

      <!-- 3-B. 데스크톱 견적 데이터 테이블 (hidden md:block) -->
      <div class="hidden md:block overflow-x-auto max-h-[68vh] overflow-y-auto border border-slate-200 rounded-xl shadow-xs">
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
              <th class="py-2 px-2 text-center whitespace-nowrap min-w-[105px]">수주 / 출력</th>
            </tr>
          </thead>
          <tbody id="quotationTableBody" class="divide-y divide-slate-100 font-medium bg-white text-slate-700">
          </tbody>
        </table>
      </div>

      <!-- 📄 견적 페이지네이션 컨트롤러 -->
      <div id="quotationPagination" class="flex flex-wrap items-center justify-between gap-2 pt-1 px-1 text-xs select-none"></div>

    </div>
  `;

  // 페이지 렌더링
  updateQuoteCurrentPage();

  // 이벤트 리스너 바인딩
  bindQuotationEvents();
}

/**
 * 견적 페이지 전환 및 렌더링
 */
function updateQuoteCurrentPage() {
  const total = lastFilteredQuotes.length;
  const totalPages = quotePageSize === 'ALL' ? 1 : Math.max(1, Math.ceil(total / quotePageSize));
  if (quotePage > totalPages) quotePage = totalPages;
  if (quotePage < 1) quotePage = 1;

  const offset = quotePageSize === 'ALL' ? 0 : (quotePage - 1) * quotePageSize;
  const pagedItems = quotePageSize === 'ALL'
    ? lastFilteredQuotes
    : lastFilteredQuotes.slice(offset, offset + quotePageSize);

  const isMobile = window.innerWidth < 768;
  const tbody = document.getElementById("quotationTableBody");
  const cardContainer = document.getElementById("quoteCardContainer");
  if (isMobile) {
    if (cardContainer) cardContainer.innerHTML = generateQuoteMobileCards(pagedItems, offset);
    if (tbody) tbody.innerHTML = '';
  } else {
    if (tbody) tbody.innerHTML = generateTableRows(pagedItems, offset);
    if (cardContainer) cardContainer.innerHTML = '';
  }

  renderQuotePagination(total, totalPages);
}

/**
 * 견적 페이지네이션 컨트롤 바 렌더링
 */
function renderQuotePagination(total, totalPages) {
  const container = document.getElementById('quotationPagination');
  if (!container) return;

  if (total === 0) {
    container.innerHTML = '';
    return;
  }

  const startIdx = quotePageSize === 'ALL' ? 1 : (quotePage - 1) * quotePageSize + 1;
  const endIdx = quotePageSize === 'ALL' ? total : Math.min(quotePage * quotePageSize, total);

  let pageButtons = '';
  const maxButtons = 5;
  let startP = Math.max(1, quotePage - 2);
  let endP = Math.min(totalPages, startP + maxButtons - 1);
  if (endP - startP < maxButtons - 1) {
    startP = Math.max(1, endP - maxButtons + 1);
  }

  for (let p = startP; p <= endP; p++) {
    const isCurrent = (p === quotePage);
    pageButtons += `
      <button type="button" onclick="window.goToQuotePage(${p})" 
              class="w-7 h-7 flex items-center justify-center rounded-lg text-xs font-bold transition-colors ${isCurrent ? 'bg-[#5b6f3c] text-white shadow-xs' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'}">
        ${p}
      </button>
    `;
  }

  container.innerHTML = `
    <div class="flex items-center gap-2 text-slate-500 text-[11px]">
      <span class="font-bold text-slate-800">${startIdx.toLocaleString()} - ${endIdx.toLocaleString()}</span> / 전체 <strong class="text-[#3f4f26] font-black">${total.toLocaleString()}</strong>건
      <span class="text-slate-300">|</span>
      <span>${quotePage} / ${totalPages} 페이지</span>
    </div>

    <div class="flex items-center gap-1.5">
      <button type="button" onclick="window.goToQuotePage(${quotePage - 1})" 
              ${quotePage <= 1 ? 'disabled class="px-2 py-1 bg-slate-100 text-slate-300 rounded text-xs cursor-not-allowed"' : 'class="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded text-xs transition-colors cursor-pointer"'}>
        ◀ 이전
      </button>

      <div class="flex items-center gap-1">
        ${pageButtons}
      </div>

      <button type="button" onclick="window.goToQuotePage(${quotePage + 1})" 
              ${quotePage >= totalPages ? 'disabled class="px-2 py-1 bg-slate-100 text-slate-300 rounded text-xs cursor-not-allowed"' : 'class="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded text-xs transition-colors cursor-pointer"'}>
        다음 ▶
      </button>

      <span class="text-slate-300 mx-1">|</span>

      <select id="selectQuotePageSize" onchange="window.setQuotePageSize(this.value)" class="bg-white border border-slate-300 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-700 outline-none cursor-pointer">
        <option value="50" ${quotePageSize === 50 ? 'selected' : ''}>50개씩</option>
        <option value="100" ${quotePageSize === 100 ? 'selected' : ''}>100개씩</option>
        <option value="200" ${quotePageSize === 200 ? 'selected' : ''}>200개씩</option>
        <option value="ALL" ${quotePageSize === 'ALL' ? 'selected' : ''}>전체 (${total})</option>
      </select>
    </div>
  `;
}

window.goToQuotePage = function(page) {
  quotePage = page;
  updateQuoteCurrentPage();

  // 🚀 테이블 내부 목록 스크롤만 최상단으로 리셋 (전체 페이지 윈도우 스크롤은 유지)
  const tableContainer = document.getElementById("quotationTableBody")?.closest(".overflow-y-auto");
  if (tableContainer) tableContainer.scrollTop = 0;
  const mobileContainer = document.getElementById("quoteCardContainer");
  if (mobileContainer) mobileContainer.scrollTop = 0;
};

window.setQuotePageSize = function(size) {
  quotePageSize = (size === 'ALL') ? 'ALL' : parseInt(size, 10);
  quotePage = 1;
  updateQuoteCurrentPage();

  const tableContainer = document.getElementById("quotationTableBody")?.closest(".overflow-y-auto");
  if (tableContainer) tableContainer.scrollTop = 0;
  const mobileContainer = document.getElementById("quoteCardContainer");
  if (mobileContainer) mobileContainer.scrollTop = 0;
};

/**
 * 테이블 행 렌더링
 */
function generateTableRows(items, offset = 0) {
  if (!items || items.length === 0) {
    const rangeText = (currentStartDate && currentEndDate) ? `${currentStartDate} ~ ${currentEndDate}` : '전체 기간';
    return `
      <tr>
        <td colspan="16" class="text-center py-12 text-slate-500">
          <div class="flex flex-col items-center justify-center gap-2">
            <span class="text-3xl">🔍</span>
            <p class="font-bold text-sm text-slate-700">해당 조건에 일치하는 견적 이력이 없습니다.</p>
            <p class="text-xs text-slate-400">조회 기간(<span class="font-mono text-slate-600 font-semibold">${rangeText}</span>) 내 등록된 견적이 없습니다.</p>
            <div class="flex items-center gap-2 mt-2">
              <button type="button" onclick="window.setQuoteDatePreset('1Y')" 
                      class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-colors cursor-pointer">
                📅 최근 1년 조회
              </button>
              <button type="button" onclick="window.setQuoteDatePreset('ALL')" 
                      class="px-3 py-1.5 bg-[#5b6f3c] hover:bg-[#4d5e33] text-white rounded-lg text-xs font-bold transition-colors shadow-xs cursor-pointer">
                🌐 과거 전체(1999년~현재) 조회하기
              </button>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  const isCsAdmin = (typeof window.isCsOrAdminUser === 'function') ? window.isCsOrAdminUser() : false;
  return items.map((q, idx) => {
    const realIdx = offset + idx;
    const isSelected = selectedQuoteIndexes.has(realIdx);
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

    const bgClass = realIdx % 2 === 0 ? "bg-white" : "bg-amber-50/30";

    return `
      <tr class="${bgClass} hover:bg-lime-50/80 transition-colors border-b border-slate-100 text-[11px] cursor-pointer" 
          data-quote-idx="${realIdx}" data-quote-no="${q.quote_no || ''}">
        <td class="py-1.5 px-2 text-center" onclick="event.stopPropagation()">
          <input type="checkbox" class="quote-row-chk rounded text-[#5b6f3c] focus:ring-0" data-idx="${realIdx}" ${isSelected ? 'checked' : ''}>
        </td>
        <td class="py-1.5 px-2 text-center font-mono text-slate-400">${realIdx + 1}</td>
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
          <div class="flex items-center justify-center gap-1">
            ${isCsAdmin ? `
              <button type="button" class="btn-quote-to-order px-2 py-0.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded text-[10px] font-bold transition-colors shadow-2xs flex items-center gap-0.5 cursor-pointer"
                      data-idx="${realIdx}" title="해당 견적건을 수주 및 출하 등록으로 전환 (CS 및 관리자 전용)">
                <span>📦</span> 수주
              </button>
              <button type="button" onclick="event.stopPropagation(); window.editQuotationByIndex && window.editQuotationByIndex(${realIdx})"
                      class="px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded text-[10px] font-bold cursor-pointer" title="견적 수정">✏️</button>
              <button type="button" onclick="event.stopPropagation(); window.deleteQuotationByIndex && window.deleteQuotationByIndex(${realIdx})"
                      class="px-1.5 py-0.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded text-[10px] font-bold cursor-pointer" title="견적 삭제">🗑️</button>
            ` : ''}
            <button type="button" class="btn-single-quote-print px-1.5 py-0.5 bg-slate-100 hover:bg-lime-600 hover:text-white text-slate-700 rounded text-[10px] font-bold transition-colors cursor-pointer"
                    data-idx="${realIdx}" title="BSK 표준 견적서 출력">
              인쇄
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * 모바일 전용 견적 카드 뷰 HTML 생성
 */
function generateQuoteMobileCards(items, offset = 0) {
  if (!items || items.length === 0) {
    const rangeText = (currentStartDate && currentEndDate) ? `${currentStartDate} ~ ${currentEndDate}` : '전체 기간';
    return `
      <div class="p-6 text-center text-slate-500 bg-white rounded-xl border border-slate-200 text-xs">
        <span class="text-2xl block mb-1">🔍</span>
        <p class="font-bold text-slate-800">해당 조건에 일치하는 견적이 없습니다.</p>
        <p class="text-[11px] text-slate-400 mt-0.5">조회 기간: ${rangeText}</p>
      </div>
    `;
  }

  const isCsAdmin = (typeof window.isCsOrAdminUser === 'function') ? window.isCsOrAdminUser() : false;
  return items.map((q, idx) => {
    const realIdx = offset + idx;
    const isSelected = selectedQuoteIndexes.has(realIdx);
    const isUsd = (q.qunit && q.qunit.includes('$')) || (q.quot_type && q.quot_type.includes('$'));
    const isWon = (q.qunit && q.qunit.includes('\\')) || (q.quot_type && q.quot_type.includes('Won'));

    let qpDisplay = "";
    if (isUsd) {
      qpDisplay = `$ ${Number(q.qp).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
    } else if (isWon) {
      qpDisplay = `₩ ${Math.round(Number(q.qp)).toLocaleString()}`;
    } else {
      qpDisplay = `${q.qp}`;
    }

    const amountVal = Number(q.amount) || 0;
    const amountDisplay = isUsd
      ? `$ ${amountVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `₩ ${Math.round(amountVal).toLocaleString()}`;
    const qtyStr = q.qty_str || (q.qty_int ? q.qty_int.toLocaleString() : '-');

    return `
      <div class="p-3.5 bg-white rounded-xl border ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-slate-200'} shadow-sm space-y-2.5" data-quote-idx="${realIdx}">
        <div class="flex items-start justify-between gap-1.5">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-[9px] font-mono font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">#${realIdx + 1}</span>
              <span class="text-[9px] font-mono font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">${q.quote_dt || '-'}</span>
              <span class="text-[9px] font-bold text-lime-900 bg-lime-100 px-1.5 py-0.5 rounded border border-lime-200">${q.mfg || '-'}</span>
            </div>
            <h4 class="font-black text-sm text-slate-900 mt-1 truncate" title="${q.cname || '-'}">
              ${q.cname || '-'}
            </h4>
          </div>
          <div class="text-right shrink-0">
            <span class="text-[9px] text-slate-400 block font-semibold">견적 총액</span>
            <span class="font-black text-indigo-950 font-mono text-sm">${amountDisplay}</span>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-1.5 text-xs bg-slate-50/80 p-2.5 rounded-lg border border-slate-100">
          <div>
            <span class="text-[9px] text-slate-400 block font-semibold">품번 (Part No)</span>
            <div class="font-black text-slate-900 font-mono text-[11px] truncate tracking-tight" title="${q.part_no || '-'}">${q.part_no || '-'}</div>
            <span class="text-[10px] text-slate-500 font-medium">수량: ${qtyStr} EA</span>
          </div>
          <div>
            <span class="text-[9px] text-slate-400 block font-semibold">견적단가 / 납기</span>
            <div class="font-bold text-emerald-700 text-[11px] font-mono">${qpDisplay}</div>
            <span class="text-[10px] text-slate-500 font-mono">납기: ${q.delivery || '-'}</span>
          </div>
          <div>
            <span class="text-[9px] text-slate-400 block font-semibold">고객 담당자</span>
            <span class="text-[11px] font-medium text-slate-700 truncate block">${q.contact || '-'}</span>
          </div>
          <div>
            <span class="text-[9px] text-slate-400 block font-semibold">영업담당 / 결제조건</span>
            <span class="text-[11px] font-bold text-indigo-900">${q.sales || '-'}</span>
            <span class="text-[10px] text-slate-500 truncate block">${q.payment || '-'}</span>
          </div>
        </div>

        <div class="flex items-center justify-between gap-1.5 pt-1 border-t border-slate-100">
          <label class="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 cursor-pointer" onclick="event.stopPropagation()">
            <input type="checkbox" class="quote-row-chk rounded text-[#5b6f3c] focus:ring-0" data-idx="${realIdx}" ${isSelected ? 'checked' : ''}>
            <span>선택</span>
          </label>
          <div class="flex items-center gap-1.5 flex-wrap justify-end">
            ${isCsAdmin ? `
              <button type="button" class="btn-quote-to-order px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-[10px] font-bold transition-colors shadow-2xs flex items-center gap-1 cursor-pointer"
                      data-idx="${realIdx}">
                <span>📦</span> 수주
              </button>
              <button type="button" onclick="event.stopPropagation(); window.editQuotationByIndex && window.editQuotationByIndex(${realIdx})"
                      class="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-[10px] font-bold cursor-pointer">✏️</button>
              <button type="button" onclick="event.stopPropagation(); window.deleteQuotationByIndex && window.deleteQuotationByIndex(${realIdx})"
                      class="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-lg text-[10px] font-bold cursor-pointer">🗑️</button>
            ` : ''}
            <button type="button" class="btn-single-quote-print px-2 py-1 bg-slate-100 hover:bg-lime-600 hover:text-white text-slate-700 rounded-lg text-[10px] font-bold transition-colors shadow-2xs cursor-pointer"
                    data-idx="${realIdx}">
              인쇄
            </button>
          </div>
        </div>
      </div>
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
  const btnExcel = document.getElementById("btnQuoteExcelExport");
  const chkAll = document.getElementById("chkQuoteSelectAll");
  const tbody = document.getElementById("quotationTableBody");

  // 1. 검색 버튼 클릭
  btnSearch?.addEventListener("click", async () => {
    const startDate = inputStart?.value || '';
    const endDate = inputEnd?.value || '';
    const mfg = selectMfg?.value || '';
    const query = liveFilter?.value || '';

    currentStartDate = startDate;
    currentEndDate = endDate;
    currentMfg = mfg;

    btnSearch.disabled = true;
    btnSearch.innerHTML = `<span>⏳</span> 조회중...`;

    await fetchQuotations({ startDate, endDate, mfg, query });
    renderQuotationsView('quotationsSection');
  });

  // 1-1. MFG 변경 시 즉시 재조회
  selectMfg?.addEventListener("change", () => {
    btnSearch?.click();
  });

  // 1-2. 날짜 입력창에서 Enter 키 누를 시 즉시 재조회
  inputStart?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btnSearch?.click();
  });
  inputEnd?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btnSearch?.click();
  });

  // 2. 실시간 키워드 필터링 (200ms 디바운스 적용으로 버벅임 방지)
  const handleLiveFilter = debounce((term) => {
    if (!term) {
      lastFilteredQuotes = cachedQuotations;
    } else {
      const qLower = term.toLowerCase().trim();
      const extraMatches = [];
      for (const [k, vals] of Object.entries(SALES_ALIAS_MAP)) {
        if (qLower.includes(k)) {
          extraMatches.push(...vals);
        }
      }

      lastFilteredQuotes = cachedQuotations.filter(q => {
        const partMatch = q.part_no && q.part_no.toLowerCase().includes(qLower);
        const cnameMatch = q.cname && q.cname.toLowerCase().includes(qLower);
        const contactMatch = q.contact && q.contact.toLowerCase().includes(qLower);
        const salesMatch = q.sales && (
          q.sales.toLowerCase().includes(qLower) || 
          extraMatches.some(m => q.sales.toLowerCase().includes(m.toLowerCase()))
        );
        const mfgMatch = q.mfg && q.mfg.toLowerCase().includes(qLower);
        const quoteNoMatch = q.quote_no && q.quote_no.toLowerCase().includes(qLower);
        return partMatch || cnameMatch || contactMatch || salesMatch || mfgMatch || quoteNoMatch;
      });
    }
    quotePage = 1;
    updateQuoteCurrentPage();
    updateSummaries(lastFilteredQuotes);
  }, 200);

  liveFilter?.addEventListener("input", (e) => {
    handleLiveFilter(e.target.value.toLowerCase().trim());
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

  // 4. 개별 행/카드 체크박스
  tbody?.addEventListener("change", (e) => {
    if (e.target.classList.contains("quote-row-chk")) {
      const idx = parseInt(e.target.getAttribute("data-idx"), 10);
      if (e.target.checked) selectedQuoteIndexes.add(idx);
      else selectedQuoteIndexes.delete(idx);
    }
  });

  const cardContainer = document.getElementById("quoteCardContainer");
  cardContainer?.addEventListener("change", (e) => {
    if (e.target.classList.contains("quote-row-chk")) {
      const idx = parseInt(e.target.getAttribute("data-idx"), 10);
      if (e.target.checked) selectedQuoteIndexes.add(idx);
      else selectedQuoteIndexes.delete(idx);
    }
  });

  // 5. 모바일 카드 클릭 이벤트
  cardContainer?.addEventListener("click", (e) => {
    const orderBtn = e.target.closest(".btn-quote-to-order");
    if (orderBtn) {
      e.stopPropagation();
      const idx = parseInt(orderBtn.getAttribute("data-idx"), 10);
      handleConvertQuoteToOrder(idx);
      return;
    }

    const printBtn = e.target.closest(".btn-single-quote-print");
    if (printBtn) {
      e.stopPropagation();
      const idx = parseInt(printBtn.getAttribute("data-idx"), 10);
      const item = lastFilteredQuotes[idx] || cachedQuotations[idx];
      if (item) {
        openLegacyQuotationModal(item.quote_no, item);
      }
      return;
    }

    if (e.target.closest("input[type='checkbox']")) return;

    const card = e.target.closest("[data-quote-idx]");
    if (!card) return;
    const idx = parseInt(card.getAttribute("data-quote-idx"), 10);
    const item = lastFilteredQuotes[idx] || cachedQuotations[idx];
    if (item) {
      openLegacyQuotationModal(item.quote_no, item);
    }
  });

  // 5. 테이블 내 클릭 이벤트 (수주 전환, 인쇄, 행 클릭 미리보기)
  tbody?.addEventListener("click", (e) => {
    // 1) 수주 전환 버튼 클릭
    const orderBtn = e.target.closest(".btn-quote-to-order");
    if (orderBtn) {
      e.stopPropagation();
      const idx = parseInt(orderBtn.getAttribute("data-idx"), 10);
      handleConvertQuoteToOrder(idx);
      return;
    }

    // 2) 단일 인쇄 버튼 클릭
    const printBtn = e.target.closest(".btn-single-quote-print");
    if (printBtn) {
      e.stopPropagation();
      const idx = parseInt(printBtn.getAttribute("data-idx"), 10);
      const item = lastFilteredQuotes[idx] || cachedQuotations[idx];
      if (item) {
        openLegacyQuotationModal(item.quote_no, item);
      }
      return;
    }

    // 3) 체크박스 클릭 시 행 모달 열림 방지
    if (e.target.closest("input[type='checkbox']")) return;

    // 4) 행 클릭 시 견적서 미리보기 모달 연동
    const row = e.target.closest("tr[data-quote-idx]");
    if (!row) return;
    const idx = parseInt(row.getAttribute("data-quote-idx"), 10);
    const item = lastFilteredQuotes[idx] || cachedQuotations[idx];
    if (item) {
      openLegacyQuotationModal(item.quote_no, item);
    }
  });

  // 7. 상단 [REPORT] 버튼 클릭
  btnReport?.addEventListener("click", () => {
    if (selectedQuoteIndexes.size === 0) {
      if (lastFilteredQuotes.length > 0) {
        openLegacyQuotationModal(lastFilteredQuotes[0].quote_no, lastFilteredQuotes[0]);
      } else if (cachedQuotations.length > 0) {
        openLegacyQuotationModal(cachedQuotations[0].quote_no, cachedQuotations[0]);
      } else {
        alert("출력할 견적 내역이 없습니다.");
      }
      return;
    }
    const firstSelectedIdx = Array.from(selectedQuoteIndexes)[0];
    const item = lastFilteredQuotes[firstSelectedIdx] || cachedQuotations[firstSelectedIdx];
    if (item) {
      openLegacyQuotationModal(item.quote_no, item);
    }
  });

  // 8. [Excel 다운로드] 버튼 클릭
  btnExcel?.addEventListener("click", () => {
    exportQuotationsToCsv(lastFilteredQuotes.length > 0 ? lastFilteredQuotes : cachedQuotations);
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

/**
 * 📦 견적 항목을 수주 및 출하 등록으로 전환 (CS / 관리자 전용)
 */
export function handleConvertQuoteToOrder(idx) {
  // 1. 권한 판별: CS 및 관리자 권한 계정만 가능
  const canEdit = (typeof window.isCsOrAdminUser === 'function') ? window.isCsOrAdminUser() : false;
  if (!canEdit) {
    alert("⚠️ [수주 및 출하 등록 권한 제한]\n\n세일즈(영업) 계정은 견적 조회 및 발행만 가능하며, 수주 전환 및 출하 등록은 CS 및 관리자 권한 계정(CS Master / Admin)만 가능합니다.\n\n수주 및 출하 등록이 필요하신 경우 CS 담당자에게 문의해 주세요.");
    return;
  }

  // 2. 견적 데이터 가져오기
  const q = lastFilteredQuotes[idx] || cachedQuotations[idx];
  if (!q) {
    alert("견적 정보를 찾을 수 없습니다.");
    return;
  }

  const rawQty = q.qty_int || parseInt(String(q.qty_str || '').replace(/[^0-9]/g, ''), 10) || 0;
  const isUsd = (q.qunit && q.qunit.includes('$')) || (q.quot_type && q.quot_type.includes('$'));
  const currLabel = isUsd ? 'USD' : 'KRW';

  const confirmMsg = 
    `[📦 견적 ➔ 수주/출하 등록 전환]\n\n` +
    `• 견적번호: ${q.quote_no || '-'} (Line# ${q.line_no || '1'})\n` +
    `• 고객사명: ${q.cname || '-'}\n` +
    `• 품번(Part#): ${q.part_no || '-'}\n` +
    `• 견적수량: ${rawQty.toLocaleString()} EA\n` +
    `• 견적단가: ${isUsd ? '$' : '₩'}${q.qp || '0'}\n` +
    `• 제조사: ${q.mfg || '-'}\n` +
    `• 영업담당: ${q.sales || '-'}\n\n` +
    `해당 견적 데이터를 수주 및 출하 등록 폼으로 불러와 등록 작업을 진행하시겠습니까?`;

  if (!confirm(confirmMsg)) return;

  // 3. 수주/출하(Tab 2) 탭으로 즉시 전환
  const tabFulfillment = document.getElementById('tabFulfillment');
  if (tabFulfillment) {
    tabFulfillment.click();
  }

  // 4. 수주 등록 폼에 데이터 자동 주입
  setTimeout(() => {
    if (typeof window.resetCurrentForm === 'function') {
      window.resetCurrentForm();
    }

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = (val !== null && val !== undefined) ? val : '';
    };

    setVal('inputPartName', q.part_no || '');
    setVal('inputCustomer', q.cname || '');
    setVal('inputRealCustomer', q.cname || '');
    setVal('inputApplication', q.application || '');

    if (rawQty > 0) {
      setVal('inputStock', (typeof window.formatNumberWithMask === 'function') ? window.formatNumberWithMask(rawQty, 0) : rawQty);
    }

    setVal('selectCurrency', isUsd ? 'USD' : 'KRW');
    if (q.qp) {
      const qpNum = Number(q.qp);
      setVal('inputSoldPrice', !isNaN(qpNum) ? ((typeof window.formatNumberWithMask === 'function') ? window.formatNumberWithMask(qpNum, 4) : qpNum) : q.qp);
    }

    if (q.payment) {
      const paySel = document.getElementById('selectPaymentTerms');
      if (paySel) {
        const match = Array.from(paySel.options).find(o => o.value.toLowerCase() === q.payment.toLowerCase() || o.text.toLowerCase().includes(q.payment.toLowerCase()));
        if (match) paySel.value = match.value;
      }
    }

    if (typeof window.setSelectValue === 'function') {
      window.setSelectValue('selectMaker', 'inputCustomMaker', q.mfg || '', '__CUSTOM_MAKER__');
      window.setSelectValue('selectOwner', 'inputCustomOwner', q.sales || '', '__CUSTOM_OWNER__');
    }

    const quoteRef = `[견적연동: ${q.quote_no || '-'}${q.line_no ? ' / L#' + q.line_no : ''}]`;
    const memoParts = [quoteRef, q.remark].filter(Boolean);
    setVal('inputMemo', memoParts.join(' '));

    // 타이틀 및 배너 표시
    const titleEl = document.getElementById('selectedPartTitle');
    if (titleEl) {
      titleEl.innerText = `📦 수주 등록 [견적 ${q.quote_no || '-'}] : ${q.part_no || ''} (${rawQty.toLocaleString()} EA)`;
    }

    // 폼 아코디언 펼치기
    if (typeof window.toggleFormSection === 'function') {
      window.toggleFormSection(true);
    }

    // 수주 폼으로 부드럽게 스크롤
    const formSection = document.getElementById('formSection');
    if (formSection) {
      formSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // 견적 연동 알림 배너 표출
    const banner = document.getElementById('editingBanner');
    const bannerText = document.getElementById('editingBannerText');
    if (banner && bannerText) {
      banner.className = "p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-950 text-xs flex items-center justify-between shadow-xs mb-3";
      bannerText.innerHTML = `
        <div class="flex items-center gap-2">
          <span class="text-base">📦</span>
          <div>
            <strong>견적 연동 신규 수주 등록:</strong> [${q.cname}] ${q.part_no} (${rawQty.toLocaleString()} EA, 견적단가: ${currLabel} ${q.qp || 0})
            <div class="text-[11px] text-emerald-700">매입단가(USD), 환율, 납기 및 출하정보를 확인한 뒤 저장하세요.</div>
          </div>
        </div>
      `;
      banner.classList.remove('hidden');
    }
  }, 120);
}
window.handleConvertQuoteToOrder = handleConvertQuoteToOrder;

// ========================================================
// ✏️ 견적 이력 직접 등록 · 수정 · 삭제 (CRUD Modal)
// ========================================================
let editingQuoteRecordId = null;

export function openQuotationCrudModal(item = null) {
  if (typeof window.isCsOrAdminUser === 'function' && !window.isCsOrAdminUser()) {
    alert('견적 직접 등록·수정은 CS 및 관리자 권한만 가능합니다.');
    return;
  }
  editingQuoteRecordId = item ? (item.id || item.legacy_idx || item.idx || null) : null;

  const modalId = 'quotationCrudModal';
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
  const isWon = item && ((item.qunit && (item.qunit.includes('₩') || item.qunit.includes('\\'))) || (item.quot_type && item.quot_type.includes('Won')));
  const defaultCurr = isWon ? '₩' : '$';

  modal.innerHTML = `
    <div class="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto" onclick="event.stopPropagation()">
      <div class="bg-gradient-to-r from-[#5b6f3c] to-[#44542c] text-white px-5 py-3.5 flex items-center justify-between">
        <h3 class="text-sm font-black">${editingQuoteRecordId ? '✏️ 견적 내역 수정' : '➕ 신규 견적 직접 등록'}</h3>
        <button type="button" onclick="document.getElementById('${modalId}').classList.add('hidden')" class="text-white/80 hover:text-white font-bold cursor-pointer">✕</button>
      </div>
      <div class="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">견적번호 (QUOTE NO)</label>
          <input type="text" id="qCrudNo" value="${esc(item?.quote_no)}" placeholder="미입력 시 자동 채번 (QBK-WEB-...)" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono outline-none focus:border-lime-600">
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">견적일자 *</label>
          <input type="date" id="qCrudDate" value="${esc(item?.quote_dt ? String(item.quote_dt).slice(0, 10) : todayStr)}" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono outline-none focus:border-lime-600">
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">고객사명 (CNAME) *</label>
          <input type="text" id="qCrudCustomer" value="${esc(item?.cname)}" placeholder="예: LG이노텍" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold outline-none focus:border-lime-600">
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">고객 담당자 (ATTN)</label>
          <input type="text" id="qCrudContact" value="${esc(item?.contact)}" placeholder="담당자명" class="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-lime-600">
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">품번 (PART NO) *</label>
          <input type="text" id="qCrudPart" value="${esc(item?.part_no)}" placeholder="예: IS25LP128F-JBLE-TR" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold outline-none focus:border-lime-600">
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">제조사 (MFG)</label>
          <input type="text" id="qCrudMaker" value="${esc(item?.mfg || 'ISSI')}" placeholder="ISSI, ESMT, SMI..." class="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-lime-600">
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">견적 수량 (EA) *</label>
          <input type="number" id="qCrudQty" value="${Number(item?.qty_int || 1000)}" min="1" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold outline-none focus:border-lime-600">
        </div>
        <div class="grid grid-cols-3 gap-1.5">
          <div>
            <label class="block text-[11px] font-bold text-slate-600 mb-1">통화</label>
            <select id="qCrudCurrency" class="w-full px-2 py-2 border border-slate-300 rounded-lg font-bold bg-white outline-none">
              <option value="$" ${defaultCurr === '$' ? 'selected' : ''}>$ (USD)</option>
              <option value="₩" ${defaultCurr === '₩' ? 'selected' : ''}>₩ (KRW)</option>
            </select>
          </div>
          <div class="col-span-2">
            <label class="block text-[11px] font-bold text-slate-600 mb-1">견적 단가 (QP) *</label>
            <input type="number" step="0.0001" id="qCrudPrice" value="${Number(item?.qp || 0)}" class="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold text-emerald-700 outline-none focus:border-lime-600">
          </div>
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">영업담당 (SALES)</label>
          <input type="text" id="qCrudSales" value="${esc(item?.sales)}" placeholder="예: 고기봉 / WILLIAM" class="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-lime-600">
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">납기 (DELIVERY)</label>
          <input type="text" id="qCrudDelivery" value="${esc(item?.delivery || '2-3WKS')}" placeholder="예: 2-3WKS / Stock" class="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-lime-600">
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">결제조건 (PAYMENT)</label>
          <input type="text" id="qCrudPayment" value="${esc(item?.payment || 'T/T in advance')}" placeholder="예: Net 30 / 현금" class="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-lime-600">
        </div>
        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">용도 (APP)</label>
          <input type="text" id="qCrudApp" value="${esc(item?.application)}" placeholder="예: Rear Camera" class="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-lime-600">
        </div>
        <div class="sm:col-span-2">
          <label class="block text-[11px] font-bold text-slate-600 mb-1">비고 (REMARK)</label>
          <input type="text" id="qCrudRemark" value="${esc(item?.remark)}" placeholder="특이사항 / MOQ / 유효기간 등" class="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-lime-600">
        </div>
      </div>
      <div class="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
        <button type="button" onclick="document.getElementById('${modalId}').classList.add('hidden')" class="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-lg cursor-pointer">취소</button>
        <button type="button" id="btnSaveQuotationCrud" class="px-5 py-1.5 bg-[#5b6f3c] hover:bg-[#44542c] text-white font-black text-xs rounded-lg shadow-xs cursor-pointer">💾 견적 저장</button>
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
  document.getElementById('btnSaveQuotationCrud')?.addEventListener('click', saveQuotationCrudForm);
}

async function saveQuotationCrudForm() {
  const customer_name = document.getElementById('qCrudCustomer')?.value.trim() || '';
  const part_name = document.getElementById('qCrudPart')?.value.trim() || '';
  if (!customer_name || !part_name) return alert('고객사명과 품번은 필수 입력 항목입니다.');

  const qty_int = parseInt(document.getElementById('qCrudQty')?.value || '1', 10) || 1;
  const quote_price = parseFloat(document.getElementById('qCrudPrice')?.value || '0') || 0;
  const currency_unit = document.getElementById('qCrudCurrency')?.value || '$';

  const payload = {
    quote_no: document.getElementById('qCrudNo')?.value.trim() || '',
    quote_date: document.getElementById('qCrudDate')?.value || new Date().toISOString().slice(0, 10),
    customer_name,
    contact: document.getElementById('qCrudContact')?.value.trim() || '',
    maker: document.getElementById('qCrudMaker')?.value.trim() || 'OTHERS',
    part_name,
    qty_int,
    qty_str: `${qty_int.toLocaleString()}EA`,
    currency_unit,
    quote_price,
    amount: Number((qty_int * quote_price).toFixed(4)),
    sales_rep: document.getElementById('qCrudSales')?.value.trim() || '',
    delivery: document.getElementById('qCrudDelivery')?.value.trim() || '',
    payment_terms: document.getElementById('qCrudPayment')?.value.trim() || '',
    application: document.getElementById('qCrudApp')?.value.trim() || '',
    remark: document.getElementById('qCrudRemark')?.value.trim() || ''
  };

  const btn = document.getElementById('btnSaveQuotationCrud');
  if (btn) { btn.disabled = true; btn.innerText = '⏳ 저장 중...'; }

  try {
    const url = editingQuoteRecordId ? `/api/quotations/${encodeURIComponent(editingQuoteRecordId)}` : '/api/quotations';
    const method = editingQuoteRecordId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || data.status !== 'success') throw new Error(data.detail || data.message || '저장 실패');

    document.getElementById('quotationCrudModal')?.classList.add('hidden');
    alert(editingQuoteRecordId ? '✅ 견적 내역이 수정되었습니다.' : '✅ 신규 견적이 등록되었습니다.');
    await fetchQuotations();
    renderQuotationsView('quotationsSection');
  } catch (err) {
    alert('견적 저장 오류: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = '💾 견적 저장'; }
  }
}

export function editQuotationByIndex(realIdx) {
  const item = lastFilteredQuotes[realIdx] || cachedQuotations[realIdx];
  if (!item) return alert('수정할 견적 항목을 찾을 수 없습니다.');
  openQuotationCrudModal(item);
}

export async function deleteQuotationByIndex(realIdx) {
  if (typeof window.isCsOrAdminUser === 'function' && !window.isCsOrAdminUser()) {
    alert('견적 삭제는 CS 및 관리자 권한만 가능합니다.');
    return;
  }
  const item = lastFilteredQuotes[realIdx] || cachedQuotations[realIdx];
  if (!item) return;
  const recId = item.id || item.legacy_idx || item.idx;
  if (!recId) return alert('삭제 가능한 식별자가 없습니다.');

  if (!confirm(`[${item.cname}] ${item.part_no} (견적번호: ${item.quote_no || '-'})\n\n이 견적 내역을 웹 ERP 클라우드에서 삭제하시겠습니까?\n(사내 MS-SQL 원본 DB는 안전하게 보존됩니다.)`)) return;

  try {
    const res = await fetch(`/api/quotations/${encodeURIComponent(recId)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || data.status !== 'success') throw new Error(data.detail || '삭제 실패');
    alert('🗑️ 견적 내역이 삭제되었습니다.');
    await fetchQuotations();
    renderQuotationsView('quotationsSection');
  } catch (err) {
    alert('견적 삭제 오류: ' + err.message);
  }
}

window.openQuotationCrudModal = openQuotationCrudModal;
window.editQuotationByIndex = editQuotationByIndex;
window.deleteQuotationByIndex = deleteQuotationByIndex;
