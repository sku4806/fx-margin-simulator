/**
 * 🧪 samples.js
 * 세일즈 마스터 SAMPLE_* 5종 테이블(SAMPLE_TRACKING, SAMPLE_STOCKFILE, SAMPLE_REQFILE, SAMPLE_INCOMEFILE, SAMPLE_OUTFILE)
 * 통합 조회 및 Design-In 프로젝트 클라우드 CRUD 모듈
 */

import { toEnglishSalesName } from './modules/utils.js';

let activeSampleSubTab = 'tracking'; // 'tracking' | 'stock' | 'req_in' | 'outflows'
let activeReqInMode = 'requests';    // 'requests' | 'incomes'
let activeTrackingResult = 'ALL';    // 'ALL' | '1' (Win) | '4' (Working) | '3' (Pending) | '2' (Fail)
let onlyAvailSampleStock = true;
let sampleSearchQuery = '';

let cachedTracking = [];
let cachedStock = [];
let cachedRequests = [];
let cachedIncomes = [];
let cachedOutflows = [];
let editingTrackingId = null;

function escSm(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function canEditSample() {
  return (typeof window.isCsOrAdminUser === 'function') ? window.isCsOrAdminUser() : true;
}

export async function initSamplesTab(containerId = 'samplesSection') {
  await Promise.all([
    fetchSampleTracking(),
    fetchSampleStock()
  ]);
  renderSamplesView(containerId);
}

export async function fetchSampleTracking() {
  try {
    const params = new URLSearchParams({ limit: '400' });
    if (activeTrackingResult !== 'ALL') params.set('sample_result', activeTrackingResult);
    if (sampleSearchQuery) params.set('query', sampleSearchQuery);
    const res = await fetch(`/api/samples/tracking?${params.toString()}`);
    const data = await res.json();
    cachedTracking = (data.items || []).map(it => ({ ...it, sales: toEnglishSalesName(it.sales, '-') }));
  } catch (e) {
    console.warn('[Samples] 트래킹 조회 실패:', e);
  }
  return cachedTracking;
}

export async function fetchSampleStock() {
  try {
    const params = new URLSearchParams({ limit: '400', only_avail: String(onlyAvailSampleStock) });
    if (sampleSearchQuery) params.set('query', sampleSearchQuery);
    const res = await fetch(`/api/samples/stock?${params.toString()}`);
    const data = await res.json();
    cachedStock = data.items || [];
  } catch (e) {
    console.warn('[Samples] 재고 조회 실패:', e);
  }
  return cachedStock;
}

export async function fetchSampleRequests() {
  try {
    const params = new URLSearchParams({ limit: '300' });
    if (sampleSearchQuery) params.set('query', sampleSearchQuery);
    const res = await fetch(`/api/samples/requests?${params.toString()}`);
    const data = await res.json();
    cachedRequests = (data.items || []).map(it => ({ ...it, sales: toEnglishSalesName(it.sales) }));
  } catch (e) {
    console.warn('[Samples] 요청 조회 실패:', e);
  }
  return cachedRequests;
}

export async function fetchSampleIncomes() {
  try {
    const params = new URLSearchParams({ limit: '300' });
    if (sampleSearchQuery) params.set('query', sampleSearchQuery);
    const res = await fetch(`/api/samples/incomes?${params.toString()}`);
    const data = await res.json();
    cachedIncomes = (data.items || []).map(it => ({ ...it, sales: toEnglishSalesName(it.sales) }));
  } catch (e) {
    console.warn('[Samples] 입고 조회 실패:', e);
  }
  return cachedIncomes;
}

export async function fetchSampleOutflows() {
  try {
    const params = new URLSearchParams({ limit: '300' });
    if (sampleSearchQuery) params.set('query', sampleSearchQuery);
    const res = await fetch(`/api/samples/outflows?${params.toString()}`);
    const data = await res.json();
    cachedOutflows = (data.items || []).map(it => ({ ...it, sales: toEnglishSalesName(it.sales) }));
  } catch (e) {
    console.warn('[Samples] 출고 조회 실패:', e);
  }
  return cachedOutflows;
}

export function renderSamplesView(containerId = 'samplesSection') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const winList = cachedTracking.filter(t => Number(t.sample_result) === 1);
  const workingList = cachedTracking.filter(t => Number(t.sample_result) === 4);
  const winVol = winList.reduce((s, t) => s + (Number(t.volume) || 0), 0);
  const stockTotalQty = cachedStock.reduce((s, st) => s + (Number(st.qty) || 0), 0);

  container.innerHTML = `
    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col space-y-3.5 p-3.5 sm:p-5">
      
      <!-- 1. 상단 헤더 바 -->
      <div class="rounded-xl overflow-hidden shadow-xs border border-indigo-900/20">
        <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-teal-950 text-white px-4 py-3.5 flex flex-wrap items-center justify-between gap-2.5">
          <div class="flex items-center gap-2.5">
            <span class="text-2xl shrink-0">🧪</span>
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <h2 class="text-sm sm:text-base font-black tracking-wide text-white">샘플 관리 &amp; Design-In 프로젝트 트래킹</h2>
                <span class="text-[10px] bg-teal-400 text-slate-950 font-black px-2 py-0.5 rounded-full shadow-2xs">SAMPLE_* 5대 원장 통합</span>
              </div>
              <p class="text-[10px] sm:text-[11px] text-teal-200/90 mt-0.5">샘플 요청·입고·재고·출고 이력 및 고객사 양산(PP/MP) Design-Win 파이프라인 통합 관리</p>
            </div>
          </div>
          <div class="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button type="button" id="btnOpenNewSampleTracking" class="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs rounded-lg shadow-xs cursor-pointer transition-colors flex items-center gap-1 whitespace-nowrap">
              <span>➕</span> 신규 프로젝트/샘플 등록
            </button>
          </div>
        </div>
      </div>

      <!-- 2. 신규/수정 프로젝트 트래킹 에디터 (기본 접힘) -->
      <div id="sampleTrackingEditorPanel" class="hidden bg-teal-50/70 border border-teal-200 rounded-xl p-3.5 space-y-2.5 text-xs">
        <div class="flex items-center justify-between">
          <h4 id="sampleTrackingEditorTitle" class="font-black text-teal-950 text-xs">➕ 신규 Design-In 프로젝트 / 샘플 트래킹 등록</h4>
          <button type="button" id="btnCancelSampleTracking" class="text-slate-500 hover:text-slate-800 font-bold cursor-pointer">닫기 ✕</button>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
          <div>
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">고객사명 (Customer) *</label>
            <input type="text" id="smEditCustomer" placeholder="예: LG이노텍, LINSOL" class="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none focus:border-teal-600">
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">품번 (Part#) *</label>
            <input type="text" id="smEditPartNo" placeholder="예: GD32VW553HMQ6" class="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono outline-none focus:border-teal-600">
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">제조사 (MFG)</label>
            <input type="text" id="smEditMfg" placeholder="예: GigaDevice, ISSI, SMI" class="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none focus:border-teal-600">
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">영업담당 (Sales)</label>
            <input type="text" id="smEditSales" placeholder="예: DUSTIN, ERIC, STEVE" class="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none focus:border-teal-600">
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">적용 어플리케이션 (APP)</label>
            <input type="text" id="smEditApp" placeholder="예: Camera of AI, Display" class="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none focus:border-teal-600">
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">프로젝트 모델명 (PRJ_MODEL)</label>
            <input type="text" id="smEditModel" placeholder="예: GEMS, Karang S/F" class="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none focus:border-teal-600">
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">예상 연간 물량 (Volume, EA)</label>
            <input type="number" id="smEditVolume" placeholder="100000" class="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono outline-none focus:border-teal-600">
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">샘플 제공 수량 (EA)</label>
            <input type="number" id="smEditSampleQty" placeholder="10" class="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono outline-none focus:border-teal-600">
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">메인 칩셋 (Vendor / Part#)</label>
            <input type="text" id="smEditChipset" placeholder="예: Silicon Labs EFR32BG22" class="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none focus:border-teal-600">
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">경쟁사 (Competitor)</label>
            <input type="text" id="smEditCompetitor" placeholder="예: STM, Macronix, TI" class="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none focus:border-teal-600">
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">PP 일정 / MP 양산 일정</label>
            <div class="grid grid-cols-2 gap-1">
              <input type="date" id="smEditPpDate" class="px-1.5 py-1.5 bg-white border border-slate-300 rounded-lg text-[11px] font-mono outline-none">
              <input type="date" id="smEditMpDate" class="px-1.5 py-1.5 bg-white border border-slate-300 rounded-lg text-[11px] font-mono outline-none">
            </div>
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">기술 판정 / 영업 수주 상태</label>
            <div class="grid grid-cols-2 gap-1">
              <select id="smEditSampleResult" class="px-1.5 py-1.5 bg-white border border-slate-300 rounded-lg text-[11px] font-bold outline-none">
                <option value="4">🔄 Working</option>
                <option value="1">🏆 Design Win</option>
                <option value="3">⏸️ Pending</option>
                <option value="2">❌ Design Fail</option>
              </select>
              <select id="smEditBizResult" class="px-1.5 py-1.5 bg-white border border-slate-300 rounded-lg text-[11px] font-bold outline-none">
                <option value="3">⏳ Waiting</option>
                <option value="1">📦 Taking P.O</option>
                <option value="2">❌ Fail</option>
              </select>
            </div>
          </div>
          <div class="sm:col-span-2 md:col-span-4">
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">진행 비고 / 테스트 피드백 (REMARK)</label>
            <input type="text" id="smEditRemark" placeholder="예: 보드 실장 테스트 진행 중, 내년 1Q 양산 예정" class="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none focus:border-teal-600">
          </div>
        </div>
        <div class="flex justify-end gap-2 pt-1">
          <button type="button" id="btnSaveSampleTracking" class="px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white font-black text-xs rounded-lg shadow-xs cursor-pointer">💾 프로젝트 저장</button>
        </div>
      </div>

      <!-- 3. 핵심 4대 KPI 요약 카드 -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <div class="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3 shadow-2xs flex flex-col justify-between">
          <div class="text-[11px] font-bold text-emerald-900 flex items-center justify-between">
            <span>🏆 Design Win 프로젝트</span>
            <span class="text-xs">🎯</span>
          </div>
          <div class="mt-1">
            <div class="text-base sm:text-lg font-black text-emerald-700 font-mono">${winList.length.toLocaleString()}건</div>
            <div class="text-[10px] text-emerald-700 font-medium mt-0.5">예상 물량: <strong>${winVol.toLocaleString()} EA</strong></div>
          </div>
        </div>

        <div class="bg-blue-50/70 border border-blue-200 rounded-xl p-3 shadow-2xs flex flex-col justify-between">
          <div class="text-[11px] font-bold text-blue-900 flex items-center justify-between">
            <span>🔄 Working (테스트 진행)</span>
            <span class="text-xs">🔬</span>
          </div>
          <div class="mt-1">
            <div class="text-base sm:text-lg font-black text-blue-700 font-mono">${workingList.length.toLocaleString()}건</div>
            <div class="text-[10px] text-blue-600 font-medium mt-0.5">기술 검증 및 양산 대기</div>
          </div>
        </div>

        <div class="bg-indigo-50/70 border border-indigo-200 rounded-xl p-3 shadow-2xs flex flex-col justify-between">
          <div class="text-[11px] font-bold text-indigo-900 flex items-center justify-between">
            <span>📦 샘플 보유 재고</span>
            <span class="text-xs">🏷️</span>
          </div>
          <div class="mt-1">
            <div class="text-base sm:text-lg font-black text-indigo-800 font-mono">${cachedStock.length.toLocaleString()}종</div>
            <div class="text-[10px] text-indigo-600 font-medium mt-0.5">총 잔량: <strong>${stockTotalQty.toLocaleString()} EA</strong></div>
          </div>
        </div>

        <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 shadow-2xs flex flex-col justify-between">
          <div class="text-[11px] font-bold text-slate-700 flex items-center justify-between">
            <span>📊 조회된 전체 트래킹</span>
            <span class="text-xs">📋</span>
          </div>
          <div class="mt-1">
            <div class="text-base sm:text-lg font-black text-slate-900 font-mono">${cachedTracking.length.toLocaleString()}건</div>
            <div class="text-[10px] text-slate-500 font-medium mt-0.5">SAMPLE_TRACKING 실시간 연동</div>
          </div>
        </div>
      </div>

      <!-- 4. 4대 서브탭 & 검색 바 -->
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 border-b border-slate-200 pb-2.5">
        <div class="flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-nowrap">
          <button type="button" data-sm-tab="tracking" class="sm-subtab-btn px-3 py-1.5 rounded-lg text-xs font-black cursor-pointer whitespace-nowrap shrink-0 transition-colors ${activeSampleSubTab === 'tracking' ? 'bg-indigo-600 text-white shadow-2xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">
            🎯 Design-In 프로젝트 트래킹
          </button>
          <button type="button" data-sm-tab="stock" class="sm-subtab-btn px-3 py-1.5 rounded-lg text-xs font-black cursor-pointer whitespace-nowrap shrink-0 transition-colors ${activeSampleSubTab === 'stock' ? 'bg-indigo-600 text-white shadow-2xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">
            📦 샘플 보유 재고 (Stock)
          </button>
          <button type="button" data-sm-tab="req_in" class="sm-subtab-btn px-3 py-1.5 rounded-lg text-xs font-black cursor-pointer whitespace-nowrap shrink-0 transition-colors ${activeSampleSubTab === 'req_in' ? 'bg-indigo-600 text-white shadow-2xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">
            📥 샘플 요청 &amp; 입고 (Req/In)
          </button>
          <button type="button" data-sm-tab="outflows" class="sm-subtab-btn px-3 py-1.5 rounded-lg text-xs font-black cursor-pointer whitespace-nowrap shrink-0 transition-colors ${activeSampleSubTab === 'outflows' ? 'bg-indigo-600 text-white shadow-2xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">
            📤 샘플 출고 &amp; 반납 (Out)
          </button>
        </div>

        <div class="flex items-center gap-1.5 w-full lg:w-auto">
          <input type="text" id="sampleSearchInput" value="${escSm(sampleSearchQuery)}" placeholder="고객사, 품번(Part#), 제조사, 어플리케이션, 칩셋 검색..." class="flex-1 lg:w-72 px-3 py-1.5 text-xs bg-slate-50 focus:bg-white border border-slate-300 rounded-lg outline-none focus:border-indigo-500">
          <button type="button" id="btnSampleSearch" class="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-lg cursor-pointer whitespace-nowrap">🔍 검색</button>
        </div>
      </div>

      <!-- 5. 서브탭별 본문 영역 -->
      <div id="sampleSubTabBody" class="space-y-3">
        ${renderActiveSampleSubTab()}
      </div>

    </div>
  `;

  bindSampleEvents(containerId);
}

function renderActiveSampleSubTab() {
  if (activeSampleSubTab === 'tracking') return renderTrackingSubTab();
  if (activeSampleSubTab === 'stock') return renderStockSubTab();
  if (activeSampleSubTab === 'req_in') return renderReqInSubTab();
  if (activeSampleSubTab === 'outflows') return renderOutflowsSubTab();
  return '';
}

function getResultBadges(item) {
  const sr = Number(item.sample_result);
  let srClass = 'bg-blue-100 text-blue-800 border-blue-300';
  if (sr === 1) srClass = 'bg-emerald-100 text-emerald-800 border-emerald-300';
  else if (sr === 2) srClass = 'bg-rose-100 text-rose-800 border-rose-300';
  else if (sr === 3) srClass = 'bg-amber-100 text-amber-900 border-amber-300';

  const br = Number(item.business_result);
  let brClass = 'bg-slate-100 text-slate-700 border-slate-300';
  if (br === 1) brClass = 'bg-indigo-100 text-indigo-800 border-indigo-300';
  else if (br === 2) brClass = 'bg-rose-50 text-rose-700 border-rose-200';

  return {
    srHtml: `<span class="px-2 py-0.5 rounded-full text-[10px] font-black border whitespace-nowrap ${srClass}">${escSm(item.sample_result_label || 'Working')}</span>`,
    brHtml: `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap ${brClass}">${escSm(item.business_result_label || 'Waiting')}</span>`
  };
}

function renderTrackingSubTab() {
  const filterChips = [
    { code: 'ALL', label: '전체 프로젝트' },
    { code: '1', label: '🏆 Design Win' },
    { code: '4', label: '🔄 Working (평가중)' },
    { code: '3', label: '⏸️ Pending' },
    { code: '2', label: '❌ Design Fail' }
  ];

  const chipsHtml = `
    <div class="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
      ${filterChips.map(c => `
        <button type="button" data-tr-res="${c.code}" class="sm-res-chip px-2.5 py-1 rounded-full text-[11px] font-bold border cursor-pointer whitespace-nowrap transition-colors ${activeTrackingResult === c.code ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'}">
          ${c.label}
        </button>
      `).join('')}
    </div>
  `;

  if (!cachedTracking.length) {
    return `${chipsHtml}<div class="py-12 text-center text-slate-400 text-xs font-bold">조건에 일치하는 Design-In 프로젝트 트래킹 내역이 없습니다.</div>`;
  }

  const mobileCards = `
    <div class="block md:hidden space-y-2.5 max-h-[65vh] overflow-y-auto">
      ${cachedTracking.map((t, idx) => {
        const { srHtml, brHtml } = getResultBadges(t);
        const isCloud = t.source === 'CLOUD';
        return `
          <div class="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs space-y-2 text-xs">
            <div class="flex items-start justify-between gap-2">
              <div class="flex items-center gap-1.5 flex-wrap">
                ${srHtml}
                ${brHtml}
                ${isCloud ? '<span class="px-1.5 py-0.5 rounded text-[9px] font-black bg-teal-100 text-teal-800">WEB</span>' : ''}
              </div>
              <span class="text-[11px] font-bold text-indigo-900 shrink-0">${escSm(t.sales)}</span>
            </div>
            <div>
              <div class="font-black text-sm text-slate-900">${escSm(t.customer_name)}</div>
              <div class="font-mono font-black text-indigo-950 text-xs mt-0.5">${escSm(t.part_no)} <span class="text-[10px] font-sans font-bold text-slate-500">(${escSm(t.mfg)})</span></div>
            </div>
            <div class="grid grid-cols-2 gap-1.5 bg-slate-50 p-2 rounded-lg border border-slate-100 text-[11px]">
              <div><span class="text-[9px] text-slate-400 block">어플리케이션 / 모델</span><span class="font-bold text-slate-800">${escSm([t.app, t.prj_model].filter(Boolean).join(' · ') || '-')}</span></div>
              <div>
                <span class="text-[9px] text-slate-400 block">예상물량 / 견적·샘플</span>
                <span class="font-mono font-black text-emerald-700">${(t.volume || 0).toLocaleString()} EA</span>
                <span class="text-[10px] text-slate-500">(${Number(t.quote_qty) > 0 ? `견적 ${Number(t.quote_qty).toLocaleString()} · ` : ''}샘플 ${t.sample_qty || 0})</span>
              </div>
              <div>
                <span class="text-[9px] text-slate-400 block">메인 칩셋 / 경쟁사(단가)</span>
                <span class="text-slate-700">${escSm([t.chipset_vendor, t.chipset_partno].filter(Boolean).join(' ') || '-')} / ${escSm(t.competitor || '-')}${Number(t.comp_price) > 0 ? ` <strong class="font-mono text-rose-700">($${Number(t.comp_price).toFixed(4)})</strong>` : ''}</span>
              </div>
              <div>
                <span class="text-[9px] text-slate-400 block">진행일 / PP~MP 양산일정</span>
                <span class="font-mono text-slate-700">${t.sample_date ? `<span class="text-slate-500">${escSm(t.sample_date.slice(0, 10))}</span> · ` : ''}${escSm(t.pp_date || '-')} ~ ${escSm(t.mp_date || '-')}</span>
              </div>
            </div>
            ${t.remark ? `<div class="text-[11px] text-slate-600 bg-amber-50/60 px-2.5 py-1.5 rounded border border-amber-200/70">💬 ${escSm(t.remark)}</div>` : ''}
            ${isCloud ? `
              <div class="flex justify-end gap-1.5 pt-1">
                <button type="button" onclick="window.editSampleTrackingByIdx(${idx})" class="px-2.5 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded font-bold text-[11px] cursor-pointer">✏️ 수정</button>
                <button type="button" onclick="window.deleteSampleTrackingByIdx(${idx})" class="px-2.5 py-1 bg-rose-50 text-rose-600 border border-rose-200 rounded font-bold text-[11px] cursor-pointer">🗑️ 삭제</button>
              </div>
            ` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;

  const desktopTable = `
    <div class="hidden md:block overflow-x-auto max-h-[65vh] overflow-y-auto border border-slate-200 rounded-xl">
      <table class="w-full text-left text-xs border-collapse">
        <thead class="bg-slate-800 text-white sticky top-0 z-10 text-[11px] font-bold">
          <tr>
            <th class="py-2.5 px-2 text-center w-10">#</th>
            <th class="py-2.5 px-2.5 text-center w-28">기술 판정</th>
            <th class="py-2.5 px-2 text-center w-24">수주 상태</th>
            <th class="py-2.5 px-2.5 text-left min-w-[140px]">고객사명</th>
            <th class="py-2.5 px-2.5 text-left min-w-[165px]">품번 (Part#) / 제조사</th>
            <th class="py-2.5 px-2.5 text-left min-w-[150px]">어플리케이션 / 모델</th>
            <th class="py-2.5 px-2.5 text-right w-28">예상 / 견적물량</th>
            <th class="py-2.5 px-2.5 text-left min-w-[140px]">칩셋 / 경쟁사(단가)</th>
            <th class="py-2.5 px-2 text-center w-28">진행 / PP·MP</th>
            <th class="py-2.5 px-2 text-center w-16">담당</th>
            <th class="py-2.5 px-2.5 text-left min-w-[160px]">진행 비고 (Remark)</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 bg-white text-[11px]">
          ${cachedTracking.map((t, idx) => {
            const { srHtml, brHtml } = getResultBadges(t);
            const isCloud = t.source === 'CLOUD';
            return `
              <tr class="hover:bg-indigo-50/40">
                <td class="py-2 px-2 text-center font-mono text-slate-400">${idx + 1}</td>
                <td class="py-2 px-2.5 text-center">${srHtml}</td>
                <td class="py-2 px-2 text-center">${brHtml}</td>
                <td class="py-2 px-2.5 font-black text-slate-900 truncate max-w-[160px]" title="${escSm(t.customer_name)}">
                  ${escSm(t.customer_name)}
                  ${isCloud ? '<span class="ml-1 px-1 py-0.2 rounded text-[9px] font-black bg-teal-100 text-teal-800">WEB</span>' : ''}
                </td>
                <td class="py-2 px-2.5">
                  <div class="font-mono font-black text-indigo-950">${escSm(t.part_no)}</div>
                  <div class="text-[10px] font-bold text-slate-500">${escSm(t.mfg)} · 샘플 ${(t.sample_qty || 0).toLocaleString()}EA</div>
                </td>
                <td class="py-2 px-2.5">
                  <div class="font-bold text-slate-800 truncate max-w-[160px]" title="${escSm(t.app)}">${escSm(t.app || '-')}</div>
                  ${t.prj_model && t.prj_model !== 'NA' ? `<div class="text-[10px] text-teal-700 font-semibold truncate max-w-[160px]">모델: ${escSm(t.prj_model)}</div>` : ''}
                </td>
                <td class="py-2 px-2.5 text-right font-mono whitespace-nowrap">
                  <div class="font-black text-emerald-700">${(t.volume || 0).toLocaleString()}</div>
                  ${Number(t.quote_qty) > 0 ? `<div class="text-[9px] text-slate-500">견적: ${Number(t.quote_qty).toLocaleString()}</div>` : ''}
                </td>
                <td class="py-2 px-2.5 text-[10px]">
                  <div class="font-semibold text-slate-700 truncate max-w-[145px]">칩셋: ${escSm([t.chipset_vendor, t.chipset_partno].filter(x => x && x !== 'NA').join(' ') || '-')}</div>
                  <div class="text-slate-500 truncate max-w-[145px]">
                    경쟁: ${escSm(t.competitor || '-')}${Number(t.comp_price) > 0 ? ` <span class="font-mono font-bold text-rose-700">($${Number(t.comp_price).toFixed(4)})</span>` : ''}
                  </div>
                </td>
                <td class="py-2 px-2 text-center font-mono text-[10px] text-slate-600 whitespace-nowrap">
                  ${t.sample_date ? `<div class="text-[9px] text-slate-400">진행: ${escSm(t.sample_date.slice(0, 10))}</div>` : ''}
                  <div>PP: ${escSm((t.pp_date || '-').slice(0, 7))}</div>
                  <div class="font-bold text-indigo-900">MP: ${escSm((t.mp_date || '-').slice(0, 7))}</div>
                </td>
                <td class="py-2 px-2 text-center font-bold text-indigo-900 whitespace-nowrap">${escSm(t.sales)}</td>
                <td class="py-2 px-2.5 text-slate-600 max-w-[200px]">
                  <div class="truncate" title="${escSm(t.remark)}">${escSm(t.remark || '-')}</div>
                  ${isCloud ? `
                    <div class="flex items-center gap-1 mt-1">
                      <button type="button" onclick="window.editSampleTrackingByIdx(${idx})" class="px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded text-[10px] font-bold cursor-pointer">✏️</button>
                      <button type="button" onclick="window.deleteSampleTrackingByIdx(${idx})" class="px-1.5 py-0.5 bg-rose-50 text-rose-600 border border-rose-200 rounded text-[10px] font-bold cursor-pointer">🗑️</button>
                    </div>
                  ` : ''}
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  return `${chipsHtml}${mobileCards}${desktopTable}`;
}

function renderStockSubTab() {
  const bar = `
    <div class="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-xl border border-slate-200 text-xs">
      <span class="font-bold text-slate-700">📦 샘플 창고 보유 재고 (${cachedStock.length.toLocaleString()}건)</span>
      <label class="inline-flex items-center gap-1.5 cursor-pointer font-bold text-indigo-900">
        <input type="checkbox" id="chkOnlyAvailSampleStock" ${onlyAvailSampleStock ? 'checked' : ''} class="rounded text-indigo-600">
        <span>가용 재고(QTY &gt; 0)만 보기</span>
      </label>
    </div>
  `;
  if (!cachedStock.length) {
    return `${bar}<div class="py-12 text-center text-slate-400 text-xs font-bold">조건에 일치하는 샘플 보유 재고가 없습니다.</div>`;
  }
  const mobile = `
    <div class="block md:hidden grid grid-cols-1 gap-2 max-h-[62vh] overflow-y-auto">
      ${cachedStock.map((s, i) => `
        <div class="bg-white rounded-xl border border-slate-200 p-3 flex items-center justify-between gap-2 text-xs">
          <div class="min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="text-[10px] font-mono text-slate-400">#${i + 1}</span>
              <span class="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-800 font-bold text-[10px]">${escSm(s.mfg)}</span>
              <span class="text-[10px] font-mono text-slate-400">${escSm(s.updated_at || '')}</span>
            </div>
            <div class="font-mono font-black text-slate-900 mt-1 truncate">${escSm(s.part_no)}</div>
          </div>
          <span class="font-mono font-black text-sm ${s.qty > 0 ? 'text-emerald-700' : 'text-slate-400'} shrink-0">${(s.qty || 0).toLocaleString()} EA</span>
        </div>
      `).join('')}
    </div>
  `;
  const desktop = `
    <div class="hidden md:block overflow-x-auto max-h-[62vh] overflow-y-auto border border-slate-200 rounded-xl">
      <table class="w-full text-left text-xs border-collapse">
        <thead class="bg-slate-800 text-white sticky top-0 z-10 text-[11px] font-bold">
          <tr>
            <th class="py-2.5 px-3 text-center w-14">#</th>
            <th class="py-2.5 px-3 text-left w-36">제조사 (MFG)</th>
            <th class="py-2.5 px-3 text-left min-w-[220px]">샘플 품번 (Part#)</th>
            <th class="py-2.5 px-3 text-right w-32">현재 샘플 재고량</th>
            <th class="py-2.5 px-3 text-center w-32">최종 갱신일</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 bg-white text-[11px]">
          ${cachedStock.map((s, i) => `
            <tr class="hover:bg-indigo-50/40">
              <td class="py-2 px-3 text-center font-mono text-slate-400">${i + 1}</td>
              <td class="py-2 px-3 font-bold text-indigo-900">${escSm(s.mfg)}</td>
              <td class="py-2 px-3 font-mono font-black text-slate-900">${escSm(s.part_no)}</td>
              <td class="py-2 px-3 text-right font-mono font-black ${s.qty > 0 ? 'text-emerald-700' : 'text-slate-400'}">${(s.qty || 0).toLocaleString()} EA</td>
              <td class="py-2 px-3 text-center font-mono text-slate-500">${escSm(s.updated_at || '-')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  return `${bar}${mobile}${desktop}`;
}

function renderReqInSubTab() {
  const toggleBar = `
    <div class="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-xl border border-slate-200 text-xs">
      <div class="flex items-center gap-1.5">
        <button type="button" data-reqin-mode="requests" class="sm-reqin-btn px-3 py-1 rounded-lg font-bold cursor-pointer ${activeReqInMode === 'requests' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-300'}">📨 샘플 요청 (SAMPLE_REQFILE)</button>
        <button type="button" data-reqin-mode="incomes" class="sm-reqin-btn px-3 py-1 rounded-lg font-bold cursor-pointer ${activeReqInMode === 'incomes' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-300'}">📥 샘플 입고 (SAMPLE_INCOMEFILE)</button>
      </div>
      <span class="font-bold text-slate-600">총 ${(activeReqInMode === 'requests' ? cachedRequests.length : cachedIncomes.length).toLocaleString()}건</span>
    </div>
  `;

  if (activeReqInMode === 'requests') {
    if (!cachedRequests.length) return `${toggleBar}<div class="py-12 text-center text-slate-400 text-xs font-bold">조회된 샘플 요청 내역이 없습니다.</div>`;
    return `${toggleBar}
      <div class="block md:hidden space-y-2 max-h-[62vh] overflow-y-auto">
        ${cachedRequests.map((r, i) => `
          <div class="bg-white rounded-xl border border-slate-200 p-3 space-y-1 text-xs">
            <div class="flex items-center justify-between">
              <span class="font-mono font-bold text-slate-700">${escSm(r.req_date || '-')} · ${escSm(r.sr_no || '-')}</span>
              <span class="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 font-black text-[10px]">${escSm(r.status)}</span>
            </div>
            <div class="font-mono font-black text-indigo-950">${escSm(r.part_no)} <span class="text-slate-500 font-sans">(${escSm(r.mfg)})</span></div>
            <div class="flex items-center justify-between text-[11px] text-slate-600">
              <span class="font-bold text-slate-800">${escSm(r.real_cust || r.customer_name)}</span>
              <span class="font-mono font-black text-slate-900">${(r.qty || 0).toLocaleString()} EA · ${escSm(r.sales || '-')}</span>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="hidden md:block overflow-x-auto max-h-[62vh] overflow-y-auto border border-slate-200 rounded-xl">
        <table class="w-full text-left text-xs border-collapse">
          <thead class="bg-slate-800 text-white sticky top-0 z-10 text-[11px] font-bold">
            <tr>
              <th class="py-2.5 px-2.5 text-center w-12">#</th>
              <th class="py-2.5 px-2.5 text-center w-24">요청일자</th>
              <th class="py-2.5 px-2.5 text-left w-28">요청번호(SRNO)</th>
              <th class="py-2.5 px-2.5 text-left min-w-[140px]">실수요처 / 고객사</th>
              <th class="py-2.5 px-2.5 text-left w-24">제조사</th>
              <th class="py-2.5 px-2.5 text-left min-w-[170px]">품번 (Part#)</th>
              <th class="py-2.5 px-2.5 text-right w-20">수량</th>
              <th class="py-2.5 px-2.5 text-center w-24">희망납기(CRD)</th>
              <th class="py-2.5 px-2.5 text-center w-24">선적일</th>
              <th class="py-2.5 px-2 text-center w-16">상태</th>
              <th class="py-2.5 px-2 text-center w-20">영업담당</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 bg-white text-[11px]">
            ${cachedRequests.map((r, i) => `
              <tr class="hover:bg-indigo-50/40">
                <td class="py-2 px-2.5 text-center font-mono text-slate-400">${i + 1}</td>
                <td class="py-2 px-2.5 text-center font-mono text-slate-700">${escSm(r.req_date || '-')}</td>
                <td class="py-2 px-2.5 font-mono font-bold text-slate-800">${escSm(r.sr_no || '-')}</td>
                <td class="py-2 px-2.5 font-bold text-slate-900 truncate max-w-[160px]">${escSm(r.real_cust || r.customer_name)}</td>
                <td class="py-2 px-2.5 font-bold text-slate-600">${escSm(r.mfg)}</td>
                <td class="py-2 px-2.5 font-mono font-black text-indigo-950">${escSm(r.part_no)}</td>
                <td class="py-2 px-2.5 text-right font-mono font-black text-slate-900">${(r.qty || 0).toLocaleString()}</td>
                <td class="py-2 px-2.5 text-center font-mono text-slate-600">${escSm(r.crd_date || '-')}</td>
                <td class="py-2 px-2.5 text-center font-mono text-teal-700">${escSm(r.ship_date || '-')}</td>
                <td class="py-2 px-2 text-center"><span class="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 font-bold text-[10px]">${escSm(r.status)}</span></td>
                <td class="py-2 px-2 text-center font-bold text-indigo-900">${escSm(r.sales || '-')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  if (!cachedIncomes.length) return `${toggleBar}<div class="py-12 text-center text-slate-400 text-xs font-bold">조회된 샘플 입고 내역이 없습니다.</div>`;
  return `${toggleBar}
    <div class="block md:hidden space-y-2 max-h-[62vh] overflow-y-auto">
      ${cachedIncomes.map((inc, i) => `
        <div class="bg-white rounded-xl border border-slate-200 p-3 space-y-1 text-xs">
          <div class="flex items-center justify-between">
            <span class="font-mono font-bold text-slate-700">${escSm(inc.in_date || '-')} · ${escSm(inc.sr_no || '-')}</span>
            <span class="font-mono font-black text-indigo-700">입고 ${(inc.in_qty || 0).toLocaleString()} / 잔여 ${(inc.remain_qty || 0).toLocaleString()}</span>
          </div>
          <div class="font-mono font-black text-slate-900">${escSm(inc.part_no)} (${escSm(inc.mfg)})</div>
          <div class="text-[10px] font-mono text-slate-500 flex flex-wrap items-center gap-1.5">
            <span>D/C: ${escSm(inc.date_code || '-')}</span>
            ${inc.awb_no ? `<button type="button" onclick="window.openTrackingModal && window.openTrackingModal('${escSm(inc.awb_no)}')" class="text-blue-700 font-bold hover:underline cursor-pointer">🚚 AWB: ${escSm(inc.awb_no)}</button>` : ''}
            <span>· 수요처: ${escSm(inc.real_cust || '-')}</span>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="hidden md:block overflow-x-auto max-h-[62vh] overflow-y-auto border border-slate-200 rounded-xl">
      <table class="w-full text-left text-xs border-collapse">
        <thead class="bg-slate-800 text-white sticky top-0 z-10 text-[11px] font-bold">
          <tr>
            <th class="py-2.5 px-2.5 text-center w-12">#</th>
            <th class="py-2.5 px-2.5 text-center w-24">입고일자</th>
            <th class="py-2.5 px-2.5 text-left w-28">요청번호(SRNO)</th>
            <th class="py-2.5 px-2.5 text-left w-24">제조사</th>
            <th class="py-2.5 px-2.5 text-left min-w-[170px]">품번 (Part#)</th>
            <th class="py-2.5 px-2.5 text-right w-20">입고수량</th>
            <th class="py-2.5 px-2.5 text-right w-20">잔여수량</th>
            <th class="py-2.5 px-2.5 text-left w-32">D/C · Lot</th>
            <th class="py-2.5 px-2.5 text-left w-32">AWB 송장번호</th>
            <th class="py-2.5 px-2.5 text-left min-w-[120px]">실수요처</th>
            <th class="py-2.5 px-2 text-center w-20">영업담당</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 bg-white text-[11px]">
          ${cachedIncomes.map((inc, i) => `
            <tr class="hover:bg-indigo-50/40">
              <td class="py-2 px-2.5 text-center font-mono text-slate-400">${i + 1}</td>
              <td class="py-2 px-2.5 text-center font-mono text-slate-700">${escSm(inc.in_date || '-')}</td>
              <td class="py-2 px-2.5 font-mono font-bold text-slate-800">${escSm(inc.sr_no || '-')}</td>
              <td class="py-2 px-2.5 font-bold text-slate-600">${escSm(inc.mfg)}</td>
              <td class="py-2 px-2.5 font-mono font-black text-indigo-950">${escSm(inc.part_no)}</td>
              <td class="py-2 px-2.5 text-right font-mono font-black text-slate-900">${(inc.in_qty || 0).toLocaleString()}</td>
              <td class="py-2 px-2.5 text-right font-mono font-bold text-emerald-700">${(inc.remain_qty || 0).toLocaleString()}</td>
              <td class="py-2 px-2.5 font-mono text-[10px] text-slate-600 truncate max-w-[130px]">${escSm(inc.date_code || inc.lot_no || '-')}</td>
              <td class="py-2 px-2.5 font-mono text-[10px] whitespace-nowrap">
                ${inc.awb_no ? `<button type="button" onclick="window.openTrackingModal && window.openTrackingModal('${escSm(inc.awb_no)}')" class="text-blue-700 hover:underline font-bold cursor-pointer inline-flex items-center gap-1" title="클릭하여 실시간 배송 조회"><span>🚚</span>${escSm(inc.awb_no)}</button>` : '<span class="text-slate-400">-</span>'}
              </td>
              <td class="py-2 px-2.5 font-bold text-slate-800 truncate max-w-[130px]">${escSm(inc.real_cust || '-')}</td>
              <td class="py-2 px-2 text-center font-bold text-indigo-900">${escSm(inc.sales || '-')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderOutflowsSubTab() {
  if (!cachedOutflows.length) {
    return `<div class="py-12 text-center text-slate-400 text-xs font-bold">조회된 샘플 출고 내역이 없습니다.</div>`;
  }
  return `
    <div class="block md:hidden space-y-2 max-h-[62vh] overflow-y-auto">
      ${cachedOutflows.map((o, i) => `
        <div class="bg-white rounded-xl border border-slate-200 p-3 space-y-1 text-xs">
          <div class="flex items-center justify-between">
            <span class="font-mono font-bold text-slate-700">${escSm(o.out_date || '-')} · ${escSm(o.so_no || '-')}</span>
            <span class="font-mono font-black text-slate-900">${(o.qty || 0).toLocaleString()} EA</span>
          </div>
          <div class="font-mono font-black text-indigo-950">${escSm(o.part_no)} (${escSm(o.mfg)})</div>
          <div class="flex items-center justify-between text-[11px] text-slate-600">
            <span class="font-bold text-slate-800">${escSm(o.customer_name)} ${o.contact ? `(${escSm(o.contact)})` : ''}</span>
            <span class="font-bold text-indigo-900">${escSm(o.sales || '-')}</span>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="hidden md:block overflow-x-auto max-h-[62vh] overflow-y-auto border border-slate-200 rounded-xl">
      <table class="w-full text-left text-xs border-collapse">
        <thead class="bg-slate-800 text-white sticky top-0 z-10 text-[11px] font-bold">
          <tr>
            <th class="py-2.5 px-2.5 text-center w-12">#</th>
            <th class="py-2.5 px-2.5 text-center w-24">출고일자</th>
            <th class="py-2.5 px-2.5 text-left w-28">출고번호(SONO)</th>
            <th class="py-2.5 px-2.5 text-left min-w-[160px]">고객사명</th>
            <th class="py-2.5 px-2.5 text-left w-24">고객 담당자</th>
            <th class="py-2.5 px-2.5 text-left w-24">제조사</th>
            <th class="py-2.5 px-2.5 text-left min-w-[170px]">품번 (Part#)</th>
            <th class="py-2.5 px-2.5 text-right w-20">출고수량</th>
            <th class="py-2.5 px-2 text-center w-20">품목구분</th>
            <th class="py-2.5 px-2 text-center w-20">배송방식</th>
            <th class="py-2.5 px-2 text-center w-20">영업담당</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 bg-white text-[11px]">
          ${cachedOutflows.map((o, i) => `
            <tr class="hover:bg-indigo-50/40">
              <td class="py-2 px-2.5 text-center font-mono text-slate-400">${i + 1}</td>
              <td class="py-2 px-2.5 text-center font-mono text-slate-700">${escSm(o.out_date || '-')}</td>
              <td class="py-2 px-2.5 font-mono font-bold text-slate-800">${escSm(o.so_no || '-')}</td>
              <td class="py-2 px-2.5 font-bold text-slate-900 truncate max-w-[180px]">${escSm(o.customer_name)}</td>
              <td class="py-2 px-2.5 text-slate-700">${escSm(o.contact || '-')}</td>
              <td class="py-2 px-2.5 font-bold text-slate-600">${escSm(o.mfg)}</td>
              <td class="py-2 px-2.5 font-mono font-black text-indigo-950">${escSm(o.part_no)}</td>
              <td class="py-2 px-2.5 text-right font-mono font-black text-slate-900">${(o.qty || 0).toLocaleString()}</td>
              <td class="py-2 px-2 text-center text-slate-600">${escSm(o.item_type || '-')}</td>
              <td class="py-2 px-2 text-center text-slate-600">${escSm(o.delivery || '-')}</td>
              <td class="py-2 px-2 text-center font-bold text-indigo-900">${escSm(o.sales || '-')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function reloadCurrentSampleSubTab(containerId = 'samplesSection') {
  if (activeSampleSubTab === 'tracking') await fetchSampleTracking();
  else if (activeSampleSubTab === 'stock') await fetchSampleStock();
  else if (activeSampleSubTab === 'req_in') {
    if (activeReqInMode === 'requests') await fetchSampleRequests();
    else await fetchSampleIncomes();
  } else if (activeSampleSubTab === 'outflows') await fetchSampleOutflows();
  renderSamplesView(containerId);
}

function bindSampleEvents(containerId) {
  document.querySelectorAll('.sm-subtab-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      activeSampleSubTab = btn.dataset.smTab;
      await reloadCurrentSampleSubTab(containerId);
    });
  });

  document.querySelectorAll('.sm-res-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      activeTrackingResult = chip.dataset.trRes;
      await fetchSampleTracking();
      renderSamplesView(containerId);
    });
  });

  document.querySelectorAll('.sm-reqin-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      activeReqInMode = btn.dataset.reqinMode;
      await reloadCurrentSampleSubTab(containerId);
    });
  });

  const chkAvail = document.getElementById('chkOnlyAvailSampleStock');
  chkAvail?.addEventListener('change', async (e) => {
    onlyAvailSampleStock = e.target.checked;
    await fetchSampleStock();
    renderSamplesView(containerId);
  });

  const inp = document.getElementById('sampleSearchInput');
  const btnSearch = document.getElementById('btnSampleSearch');
  const runSearch = async () => {
    sampleSearchQuery = inp?.value.trim() || '';
    await reloadCurrentSampleSubTab(containerId);
  };
  btnSearch?.addEventListener('click', runSearch);
  inp?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runSearch();
  });

  document.getElementById('btnOpenNewSampleTracking')?.addEventListener('click', () => openSampleTrackingEditor(null));
  document.getElementById('btnCancelSampleTracking')?.addEventListener('click', () => {
    editingTrackingId = null;
    document.getElementById('sampleTrackingEditorPanel')?.classList.add('hidden');
  });
  document.getElementById('btnSaveSampleTracking')?.addEventListener('click', () => saveSampleTrackingForm(containerId));
}

function openSampleTrackingEditor(item = null) {
  editingTrackingId = item ? item.idx : null;
  const panel = document.getElementById('sampleTrackingEditorPanel');
  const title = document.getElementById('sampleTrackingEditorTitle');
  if (title) {
    title.innerText = item ? `✏️ Design-In 프로젝트 트래킹 수정 (${item.part_no})` : '➕ 신규 Design-In 프로젝트 / 샘플 트래킹 등록';
  }
  const setV = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v ?? '';
  };
  setV('smEditCustomer', item?.customer_name);
  setV('smEditPartNo', item?.part_no);
  setV('smEditMfg', item?.mfg);
  setV('smEditSales', item?.sales);
  setV('smEditApp', item?.app);
  setV('smEditModel', item?.prj_model);
  setV('smEditVolume', item?.volume || '');
  setV('smEditSampleQty', item?.sample_qty || '');
  setV('smEditChipset', [item?.chipset_vendor, item?.chipset_partno].filter(Boolean).join(' '));
  setV('smEditCompetitor', item?.competitor);
  setV('smEditPpDate', item?.pp_date);
  setV('smEditMpDate', item?.mp_date);
  setV('smEditSampleResult', String(item?.sample_result || 4));
  setV('smEditBizResult', String(item?.business_result || 3));
  setV('smEditRemark', item?.remark);

  panel?.classList.remove('hidden');
  document.getElementById('smEditCustomer')?.focus();
}

async function saveSampleTrackingForm(containerId = 'samplesSection') {
  const customer_name = document.getElementById('smEditCustomer')?.value.trim() || '';
  const part_no = document.getElementById('smEditPartNo')?.value.trim() || '';
  if (!customer_name || !part_no) {
    alert('고객사명과 품번(Part#)은 필수 입력 항목입니다.');
    return;
  }

  const chipsetRaw = document.getElementById('smEditChipset')?.value.trim() || '';
  const payload = {
    customer_name,
    part_no,
    mfg: document.getElementById('smEditMfg')?.value.trim() || 'OTHERS',
    sales: document.getElementById('smEditSales')?.value.trim() || 'BSK',
    app: document.getElementById('smEditApp')?.value.trim() || '',
    prj_model: document.getElementById('smEditModel')?.value.trim() || '',
    volume: parseInt(document.getElementById('smEditVolume')?.value || '0', 10) || 0,
    sample_qty: parseInt(document.getElementById('smEditSampleQty')?.value || '0', 10) || 0,
    chipset_vendor: chipsetRaw,
    chipset_partno: '',
    competitor: document.getElementById('smEditCompetitor')?.value.trim() || '',
    pp_date: document.getElementById('smEditPpDate')?.value || '',
    mp_date: document.getElementById('smEditMpDate')?.value || '',
    sample_result: parseInt(document.getElementById('smEditSampleResult')?.value || '4', 10),
    business_result: parseInt(document.getElementById('smEditBizResult')?.value || '3', 10),
    remark: document.getElementById('smEditRemark')?.value.trim() || ''
  };

  try {
    const url = editingTrackingId ? `/api/samples/tracking/${encodeURIComponent(editingTrackingId)}` : '/api/samples/tracking';
    const method = editingTrackingId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || data.status !== 'success') throw new Error(data.detail || '저장 실패');
    editingTrackingId = null;
    document.getElementById('sampleTrackingEditorPanel')?.classList.add('hidden');
    activeSampleSubTab = 'tracking';
    await fetchSampleTracking();
    renderSamplesView(containerId);
  } catch (err) {
    alert('프로젝트 저장 오류: ' + err.message);
  }
}

window.editSampleTrackingByIdx = function(idx) {
  if (cachedTracking[idx]) openSampleTrackingEditor(cachedTracking[idx]);
};

window.deleteSampleTrackingByIdx = async function(idx) {
  const item = cachedTracking[idx];
  if (!item) return;
  if (!confirm(`[${item.customer_name} / ${item.part_no}] 프로젝트를 삭제하시겠습니까?`)) return;
  try {
    const res = await fetch(`/api/samples/tracking/${encodeURIComponent(item.idx)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || data.status !== 'success') throw new Error(data.detail || '삭제 실패');
    await fetchSampleTracking();
    renderSamplesView('samplesSection');
  } catch (err) {
    alert('삭제 오류: ' + err.message);
  }
};
