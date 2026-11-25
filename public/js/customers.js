/**
 * customers.js
 * 거래처·담당자(복수)·매입처(CustomerBFile)·지정 포워더(CustForwarder) 통합 마스터 모달
 */

import { toEnglishSalesName, escapeHtml as escHtml, isSelfCompanyName, resolveCustomerName } from './modules/utils.js';

let activeMasterTab = 'customers'; // 'customers' | 'suppliers' | 'forwarders'
let custPage = 1;
const custLimit = 30;
let custQuery = '';
let custTotal = 0;
let custCache = [];
let editingCustId = null;

let contactCountMap = null;
const contactsCacheByCid = {};
let supplierCache = [];
let forwarderCache = [];

function canModifyMaster() {
  return (typeof window.isCsOrAdminUser === 'function') ? window.isCsOrAdminUser() : false;
}

export async function openCustomerMasterModal(initialTab = 'customers') {
  activeMasterTab = initialTab || 'customers';
  const modalId = 'customerMasterModal';
  let modal = document.getElementById(modalId);

  if (!modal) {
    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[99990] flex items-center justify-center p-2 sm:p-4 overflow-y-auto';
    modal.onclick = (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    };
    document.body.appendChild(modal);
  }

  const canEdit = canModifyMaster();

  modal.innerHTML = `
    <div class="bg-white w-full max-w-6xl max-h-[93dvh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden my-auto" onclick="event.stopPropagation()">
      <!-- 헤더 -->
      <div class="bg-gradient-to-r from-teal-700 to-emerald-700 text-white px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
        <div class="flex items-start sm:items-center justify-between gap-2 w-full sm:w-auto">
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-xl shrink-0">🏢</span>
            <div class="min-w-0">
              <h3 class="text-sm sm:text-base font-black tracking-tight truncate">거래처 · 담당자 · 매입처 · 포워더 통합 마스터</h3>
              <p class="text-[10px] sm:text-[11px] text-teal-100 leading-snug">매출 고객사(복수 담당자 포함) · 해외/국내 매입처 · 지정 포워더 통합 조회</p>
            </div>
          </div>
          <button type="button" onclick="document.getElementById('${modalId}').classList.add('hidden')" class="sm:hidden w-8 h-8 rounded-lg bg-white/15 hover:bg-white/25 text-white font-bold flex items-center justify-center cursor-pointer shrink-0">✕</button>
        </div>
        <div class="flex items-center gap-2 justify-end shrink-0">
          ${canEdit ? `
            <button type="button" id="btnOpenNewCustomerForm" class="w-full sm:w-auto px-3.5 py-2 sm:py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-900 font-black text-xs rounded-lg shadow-xs cursor-pointer transition-colors whitespace-nowrap text-center">
              ➕ 신규 거래처 등록
            </button>
          ` : ''}
          <button type="button" onclick="document.getElementById('${modalId}').classList.add('hidden')" class="hidden sm:flex w-8 h-8 rounded-lg bg-white/15 hover:bg-white/25 text-white font-bold items-center justify-center cursor-pointer shrink-0">✕</button>
        </div>
      </div>

      <!-- 3단 하위 탭 네비게이션 -->
      <div class="px-3 sm:px-4 pt-1.5 bg-white border-b border-slate-200 flex items-center gap-1 sm:gap-2 overflow-x-auto scrollbar-none flex-nowrap shrink-0">
        <button type="button" data-master-tab="customers" class="cm-tab-btn px-3 py-2 text-xs font-bold border-b-2 cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5">
          <span>🏢</span> 매출 고객사 &amp; 복수 담당자
        </button>
        <button type="button" data-master-tab="suppliers" class="cm-tab-btn px-3 py-2 text-xs font-bold border-b-2 cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5">
          <span>🌐</span> 매입처 / 해외공급사
        </button>
        <button type="button" data-master-tab="forwarders" class="cm-tab-btn px-3 py-2 text-xs font-bold border-b-2 cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5">
          <span>🚚</span> 고객사 지정 포워더
        </button>
        <button type="button" data-master-tab="commissions" class="cm-tab-btn px-3 py-2 text-xs font-bold border-b-2 cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5">
          <span>💎</span> 커미션 거래처
        </button>
      </div>

      <!-- 신규/수정 입력 패널 (매출 고객사 전용, 기본 접힘) -->
      <div id="customerEditorPanel" class="hidden bg-teal-50/70 border-b border-teal-200 p-4 shrink-0">
        <div class="flex items-center justify-between mb-2.5">
          <h4 id="customerEditorTitle" class="text-xs font-black text-teal-900">➕ 신규 거래처 등록</h4>
          <button type="button" id="btnCancelCustomerEdit" class="text-xs text-slate-500 hover:text-slate-800 font-bold cursor-pointer">닫기 ✕</button>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5 text-xs">
          <div>
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">거래처명 (국문/공식명) *</label>
            <input type="text" id="custEditKname" placeholder="예: (주)빅샤인코리아" class="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none focus:border-teal-500">
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">영문 거래처명 (CNAME)</label>
            <input type="text" id="custEditCname" placeholder="예: BIGSHINE KOREA CO., LTD" class="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none focus:border-teal-500">
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">담당 영업사원 (SALES)</label>
            <input type="text" id="custEditSales" placeholder="예: ERIC, KELLY, WILLIAM" class="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none focus:border-teal-500">
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">대표 전화 (TEL)</label>
            <input type="text" id="custEditTel" placeholder="02-0000-0000" class="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none focus:border-teal-500">
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">담당자명</label>
            <input type="text" id="custEditContactName" placeholder="홍길동" class="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none focus:border-teal-500">
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">담당자 직급</label>
            <input type="text" id="custEditContactTitle" placeholder="과장 / 대리" class="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none focus:border-teal-500">
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">담당자 휴대폰</label>
            <input type="text" id="custEditContactMobile" placeholder="010-0000-0000" class="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none focus:border-teal-500">
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">담당자 이메일 / 대표메일</label>
            <input type="email" id="custEditEmail" placeholder="name@company.co.kr" class="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none focus:border-teal-500">
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">팩스 (FAX)</label>
            <input type="text" id="custEditFax" placeholder="02-0000-0001" class="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none focus:border-teal-500">
          </div>
          <div class="sm:col-span-2 md:col-span-3">
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">사업장 주소</label>
            <input type="text" id="custEditAddress" placeholder="경기도 성남시 분당구 ..." class="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg outline-none focus:border-teal-500">
          </div>
        </div>
        <div class="flex justify-end gap-2 mt-3">
          <button type="button" id="btnCancelCustomerEdit2" class="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-lg cursor-pointer">취소</button>
          <button type="button" id="btnSaveCustomerMaster" class="px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white font-black text-xs rounded-lg shadow-xs cursor-pointer">💾 거래처 저장</button>
        </div>
      </div>

      <!-- 검색 툴바 -->
      <div class="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div class="flex items-center gap-2 flex-1 min-w-[240px]">
          <input type="text" id="custMasterSearchInput" value="${escHtml(custQuery)}" placeholder="거래처명(국문/영문), 담당자, 영업사원, 연락처 검색..." class="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:border-teal-500">
          <button type="button" id="btnSearchCustMaster" class="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-lg cursor-pointer whitespace-nowrap">🔍 검색</button>
        </div>
        <div id="custMasterCountBadge" class="text-xs font-bold text-slate-600">로딩 중...</div>
      </div>

      <!-- 목록 영역 (탭별 동적 렌더링) -->
      <div id="custMasterTableWrap" class="flex-1 overflow-y-auto bg-slate-50/60 md:bg-white"></div>

      <!-- 페이지네이션 -->
      <div id="custMasterPagination" class="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs shrink-0"></div>
    </div>
  `;

  modal.classList.remove('hidden');
  bindCustomerModalEvents();
  await switchMasterTab(activeMasterTab);
}

function bindCustomerModalEvents() {
  const inp = document.getElementById('custMasterSearchInput');
  const btnSearch = document.getElementById('btnSearchCustMaster');
  const btnNew = document.getElementById('btnOpenNewCustomerForm');
  const btnCancel1 = document.getElementById('btnCancelCustomerEdit');
  const btnCancel2 = document.getElementById('btnCancelCustomerEdit2');
  const btnSave = document.getElementById('btnSaveCustomerMaster');

  const triggerSearch = () => {
    custQuery = inp?.value.trim() || '';
    if (activeMasterTab === 'customers') loadCustomersPage(1);
    else if (activeMasterTab === 'suppliers') loadSuppliersTab(custQuery);
    else if (activeMasterTab === 'forwarders') loadForwardersTab(custQuery);
    else if (activeMasterTab === 'commissions') loadCommissionCustomersTab(custQuery);
  };

  btnSearch?.addEventListener('click', triggerSearch);
  inp?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') triggerSearch();
  });

  document.querySelectorAll('.cm-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchMasterTab(btn.dataset.masterTab);
    });
  });

  btnNew?.addEventListener('click', () => {
    if (activeMasterTab !== 'customers') switchMasterTab('customers');
    openCustomerEditor(null);
  });
  const closeEditor = () => {
    editingCustId = null;
    document.getElementById('customerEditorPanel')?.classList.add('hidden');
  };
  btnCancel1?.addEventListener('click', closeEditor);
  btnCancel2?.addEventListener('click', closeEditor);
  btnSave?.addEventListener('click', saveCustomerForm);
}

async function switchMasterTab(tab) {
  activeMasterTab = tab;
  document.querySelectorAll('.cm-tab-btn').forEach((btn) => {
    const active = btn.dataset.masterTab === tab;
    btn.classList.toggle('border-teal-600', active);
    btn.classList.toggle('text-teal-800', active);
    btn.classList.toggle('border-transparent', !active);
    btn.classList.toggle('text-slate-500', !active);
  });

  const inp = document.getElementById('custMasterSearchInput');
  const btnNew = document.getElementById('btnOpenNewCustomerForm');
  const editor = document.getElementById('customerEditorPanel');
  const pag = document.getElementById('custMasterPagination');

  if (tab === 'customers') {
    if (inp) inp.placeholder = '거래처명(국문/영문), 담당자, 영업사원, 연락처 검색...';
    btnNew?.classList.remove('hidden');
    pag?.classList.remove('hidden');
    if (!contactCountMap) {
      fetch('/api/customers/contact-counts')
        .then((r) => r.json())
        .then((d) => {
          if (d.status === 'success') {
            contactCountMap = d.counts || {};
            if (activeMasterTab === 'customers' && custCache.length) renderCustomersTable();
          }
        })
        .catch(() => {});
    }
    await loadCustomersPage(1);
  } else if (tab === 'suppliers') {
    if (inp) inp.placeholder = '매입처명, 국가(Korea/China/Taiwan/USA), 취급품목, 이메일 검색...';
    btnNew?.classList.add('hidden');
    editor?.classList.add('hidden');
    pag?.classList.add('hidden');
    await loadSuppliersTab(inp?.value.trim() || '');
  } else if (tab === 'forwarders') {
    if (inp) inp.placeholder = '고객사명, 포워더명(DHL/FedEx/UPS), 계정번호(Account), 지역 검색...';
    btnNew?.classList.add('hidden');
    editor?.classList.add('hidden');
    pag?.classList.add('hidden');
    await loadForwardersTab(inp?.value.trim() || '');
  } else if (tab === 'commissions') {
    if (inp) inp.placeholder = '커미션 거래처명, 제조사(SMI/Giantec/ISSI), 영업담당자 검색...';
    btnNew?.classList.add('hidden');
    editor?.classList.add('hidden');
    pag?.classList.add('hidden');
    await loadCommissionCustomersTab(inp?.value.trim() || '');
  }
}

let commCustomerCache = null;

async function loadCommissionCustomersTab(query = '') {
  const body = document.getElementById('custMasterTableWrap');
  const countEl = document.getElementById('custMasterCountBadge');
  if (!body) return;

  if (!commCustomerCache) {
    body.innerHTML = `<div class="py-12 text-center text-slate-400 font-bold text-xs">⏳ 커미션 거래처별 실적을 집계하는 중입니다...</div>`;
    try {
      const res = await fetch('/api/shipped-info?biz_type=COMMISSION&limit=2500');
      const data = await res.json();
      const rows = (data.status === 'success' && Array.isArray(data.items)) ? data.items : [];
      const map = {};
      rows.forEach(r => {
        const name = resolveCustomerName(r.customer, r.real_cust, '');
        if (!name || isSelfCompanyName(name) || name === '기타') return;
        if (!map[name]) {
          map[name] = { customer: name, count: 0, ship_amt: 0, comm_amt: 0, unpaid_amt: 0, makers: new Set(), sales: new Set(), last_date: '' };
        }
        const slot = map[name];
        slot.count += 1;
        slot.ship_amt += Number(r.ship_amt) || 0;
        const ca = Number(r.comm_amt) || 0;
        slot.comm_amt += ca;
        const isPaid = Boolean((r.bank_dt || '').trim() || (r.comm_dt || '').trim());
        if (!isPaid) slot.unpaid_amt += ca;
        if (r.maker) slot.makers.add(r.maker);
        const sr = toEnglishSalesName(r.sales_rep || '');
        if (sr) slot.sales.add(sr);
        if (r.ship_date && r.ship_date > slot.last_date) slot.last_date = r.ship_date;
      });
      commCustomerCache = Object.values(map)
        .map(v => ({ ...v, makers: Array.from(v.makers).join(', '), sales: Array.from(v.sales).join(', ') }))
        .sort((a, b) => b.comm_amt - a.comm_amt);
    } catch (e) {
      console.error('커미션 거래처 집계 오류:', e);
      commCustomerCache = [];
    }
  }

  const q = query.trim().toLowerCase();
  const list = q
    ? commCustomerCache.filter(c => `${c.customer} ${c.makers} ${c.sales}`.toLowerCase().includes(q))
    : commCustomerCache;

  if (countEl) countEl.textContent = `커미션 거래처 ${list.length.toLocaleString()}개사`;

  if (!list.length) {
    body.innerHTML = `<div class="py-12 text-center text-slate-400 font-bold text-xs">조건에 일치하는 커미션 거래처가 없습니다.</div>`;
    return;
  }

  body.innerHTML = `
    <div class="overflow-x-auto">
      <table class="w-full text-left text-xs border-collapse">
        <thead class="bg-violet-50 text-violet-950 font-bold text-[11px] border-b border-violet-200 sticky top-0 z-10">
          <tr>
            <th class="py-2 px-3 text-center w-10">#</th>
            <th class="py-2 px-3 min-w-[180px]">고객사명</th>
            <th class="py-2 px-3 min-w-[120px]">주요 제조사</th>
            <th class="py-2 px-3 text-center w-20">거래건수</th>
            <th class="py-2 px-3 text-right w-28">누적 선적액($)</th>
            <th class="py-2 px-3 text-right w-28">💎 누적 커미션($)</th>
            <th class="py-2 px-3 text-right w-28">미입금 잔액($)</th>
            <th class="py-2 px-3 text-center w-24">최근 선적일</th>
            <th class="py-2 px-3 text-center w-24">담당자</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 bg-white text-[11px]">
          ${list.map((c, i) => `
            <tr class="hover:bg-violet-50/30">
              <td class="py-2 px-3 text-center font-mono text-slate-400">${i + 1}</td>
              <td class="py-2 px-3 font-black text-slate-900">
                <button type="button" onclick="window.openCustomer360Modal && window.openCustomer360Modal('${escHtml(c.customer).replace(/'/g, "\\'")}')" class="text-left hover:text-indigo-700 hover:underline cursor-pointer flex items-center gap-1" title="클릭하여 [${escHtml(c.customer)}] 360° 통합 브리핑 팝업 열기">
                  <span>🏢</span><span>${escHtml(c.customer)}</span>
                </button>
              </td>
              <td class="py-2 px-3 text-indigo-800 font-bold">${escHtml(c.makers || '-')}</td>
              <td class="py-2 px-3 text-center font-mono font-bold text-slate-700">${c.count.toLocaleString()}건</td>
              <td class="py-2 px-3 text-right font-mono text-slate-700">$${Math.round(c.ship_amt).toLocaleString()}</td>
              <td class="py-2 px-3 text-right font-mono font-black text-violet-800">$${c.comm_amt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td class="py-2 px-3 text-right font-mono font-bold ${c.unpaid_amt > 0 ? 'text-rose-600' : 'text-emerald-600'}">$${c.unpaid_amt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td class="py-2 px-3 text-center font-mono text-slate-500">${escHtml(c.last_date || '-')}</td>
              <td class="py-2 px-3 text-center font-bold text-indigo-900">${escHtml(c.sales || '-')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ========================================================
// 1. 매출 고객사 + 복수 담당자 (ContactFile)
// ========================================================
function openCustomerEditor(cust) {
  if (!canModifyMaster()) {
    alert('거래처 등록·수정은 CS 및 관리자 권한만 가능합니다.');
    return;
  }
  editingCustId = cust ? (cust.id || cust.cid) : null;
  const panel = document.getElementById('customerEditorPanel');
  const title = document.getElementById('customerEditorTitle');
  if (title) {
    title.innerText = cust ? `✏️ 거래처 정보 수정 (CID: ${cust.cid || '-'})` : '➕ 신규 거래처 등록';
  }
  const setV = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v || '';
  };
  setV('custEditKname', cust?.kname);
  setV('custEditCname', cust?.cname);
  setV('custEditSales', cust?.sales_rep);
  setV('custEditTel', cust?.tel || cust?.contact_tel);
  setV('custEditFax', cust?.fax);
  setV('custEditAddress', cust?.address);
  setV('custEditEmail', cust?.email || cust?.contact_email);
  setV('custEditContactName', cust?.contact_name);
  setV('custEditContactTitle', cust?.contact_title);
  setV('custEditContactMobile', cust?.contact_mobile);

  panel?.classList.remove('hidden');
  document.getElementById('custEditKname')?.focus();
}

async function saveCustomerForm() {
  const kname = document.getElementById('custEditKname')?.value.trim() || '';
  if (!kname) {
    alert('거래처명(국문/공식명)을 입력해 주세요.');
    document.getElementById('custEditKname')?.focus();
    return;
  }

  const payload = {
    kname,
    cname: document.getElementById('custEditCname')?.value.trim() || kname,
    sales_rep: document.getElementById('custEditSales')?.value.trim() || '',
    tel: document.getElementById('custEditTel')?.value.trim() || '',
    fax: document.getElementById('custEditFax')?.value.trim() || '',
    address: document.getElementById('custEditAddress')?.value.trim() || '',
    email: document.getElementById('custEditEmail')?.value.trim() || '',
    contact_name: document.getElementById('custEditContactName')?.value.trim() || '',
    contact_title: document.getElementById('custEditContactTitle')?.value.trim() || '',
    contact_tel: document.getElementById('custEditTel')?.value.trim() || '',
    contact_mobile: document.getElementById('custEditContactMobile')?.value.trim() || '',
    contact_email: document.getElementById('custEditEmail')?.value.trim() || ''
  };

  const btn = document.getElementById('btnSaveCustomerMaster');
  if (btn) { btn.disabled = true; btn.innerText = '⏳ 저장 중...'; }

  try {
    const url = editingCustId ? `/api/customers/${encodeURIComponent(editingCustId)}` : '/api/customers';
    const method = editingCustId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || data.status !== 'success') {
      throw new Error(data.detail || data.message || '저장 실패');
    }
    if (typeof window.clearCustomerAutocompleteCache === 'function') window.clearCustomerAutocompleteCache();
    alert(editingCustId ? `✅ [${kname}] 거래처 정보가 수정되었습니다.` : `✅ [${kname}] 신규 거래처가 등록되었습니다.\n이제 견적서·수주·드로어 자동완성에서 즉시 검색됩니다.`);
    editingCustId = null;
    document.getElementById('customerEditorPanel')?.classList.add('hidden');
    await loadCustomersPage(custPage);
  } catch (err) {
    alert('거래처 저장 오류: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = '💾 거래처 저장'; }
  }
}

async function deleteCustomerMaster(recordId, kname) {
  if (!canModifyMaster()) {
    alert('거래처 삭제는 CS 및 관리자 권한만 가능합니다.');
    return;
  }
  if (!confirm(`[${kname}] 거래처를 웹 ERP 클라우드 마스터에서 삭제하시겠습니까?\n(사내 MS-SQL 원본 DB에는 영향을 주지 않습니다.)`)) return;

  try {
    const res = await fetch(`/api/customers/${encodeURIComponent(recordId)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || data.status !== 'success') {
      throw new Error(data.detail || data.message || '삭제 실패');
    }
    alert(`🗑️ [${kname}] 거래처가 삭제되었습니다.`);
    await loadCustomersPage(custPage);
  } catch (err) {
    alert('거래처 삭제 오류: ' + err.message);
  }
}

async function loadCustomersPage(page = 1) {
  custPage = page;
  const wrap = document.getElementById('custMasterTableWrap');
  if (wrap) {
    wrap.innerHTML = `
      <div id="custMasterMobileCards" class="block md:hidden p-3 space-y-2.5">
        <div class="py-10 text-center text-slate-400 text-xs">⏳ 거래처 마스터를 불러오는 중...</div>
      </div>
      <table class="hidden md:table w-full text-left text-xs border-collapse">
        <thead class="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 sticky top-0 z-10 text-[11px]">
          <tr>
            <th class="py-2.5 px-3 w-16 text-center">CID</th>
            <th class="py-2.5 px-3 min-w-[180px]">거래처명 (국문 / 영문)</th>
            <th class="py-2.5 px-3 w-24 text-center">영업담당</th>
            <th class="py-2.5 px-3 min-w-[140px]">대표 / 전체 담당자</th>
            <th class="py-2.5 px-3 min-w-[140px]">연락처 / 이메일</th>
            <th class="py-2.5 px-3 min-w-[170px]">주소</th>
            <th class="py-2.5 px-3 w-28 text-center">관리</th>
          </tr>
        </thead>
        <tbody id="custMasterTbody" class="divide-y divide-slate-100 bg-white">
          <tr><td colspan="7" class="py-10 text-center text-slate-400">⏳ 조회 중...</td></tr>
        </tbody>
      </table>
    `;
  }

  try {
    const params = new URLSearchParams({ page: String(custPage), limit: String(custLimit) });
    if (custQuery) params.set('q', custQuery);
    const res = await fetch(`/api/customers?${params.toString()}`);
    const data = await res.json();
    if (data.status !== 'success') throw new Error(data.detail || '조회 실패');

    custTotal = data.total || 0;
    custCache = (data.customers || []).map(c => ({
      ...c,
      sales_rep: toEnglishSalesName(c.sales_rep)
    }));

    const badge = document.getElementById('custMasterCountBadge');
    if (badge) badge.innerText = `총 ${custTotal.toLocaleString()}개 매출 고객사`;

    renderCustomersTable();
    renderCustomersPagination();
    if (wrap) wrap.scrollTop = 0;
  } catch (err) {
    const tbody = document.getElementById('custMasterTbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="py-10 text-center text-rose-500 font-bold">조회 오류: ${escHtml(err.message)}</td></tr>`;
  }
}

async function toggleCustomerContacts(cid, targetId) {
  const box = document.getElementById(targetId);
  if (!box) return;
  const isHidden = box.classList.contains('hidden');
  if (!isHidden) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');

  if (!contactsCacheByCid[cid]) {
    const inner = box.querySelector('.contacts-slot') || box;
    inner.innerHTML = `<div class="py-3 text-center text-[11px] text-slate-400">⏳ 전체 담당자 목록을 불러오는 중...</div>`;
    try {
      const res = await fetch(`/api/customers/contacts?cid=${encodeURIComponent(cid)}`);
      const data = await res.json();
      contactsCacheByCid[cid] = data.items || [];
    } catch (e) {
      contactsCacheByCid[cid] = [];
    }
  }

  const list = contactsCacheByCid[cid];
  const inner = box.querySelector('.contacts-slot') || box;
  if (!list.length) {
    inner.innerHTML = `<div class="py-2 text-center text-[11px] text-slate-400">추가 등록된 담당자 정보가 없습니다.</div>`;
    return;
  }

  inner.innerHTML = `
    <div class="text-[10px] font-black text-teal-800 mb-1.5 flex items-center justify-between">
      <span>👥 전체 등록 담당자 (${list.length}명 — ContactFile 연동)</span>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
      ${list.map((ct) => `
        <div class="bg-white rounded-lg border border-teal-200/80 p-2 text-[11px] space-y-0.5 shadow-2xs">
          <div class="flex items-center justify-between gap-1">
            <span class="font-black text-slate-900">${escHtml(ct.name)}${ct.title ? ` <span class="font-medium text-slate-500">${escHtml(ct.title)}</span>` : ''}</span>
            ${ct.remark ? `<span class="text-[9px] bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded font-bold">${escHtml(ct.remark)}</span>` : ''}
          </div>
          ${ct.tel ? `<div class="font-mono text-[10px] text-slate-600">📞 ${escHtml(ct.tel)}</div>` : ''}
          ${ct.mobile ? `<div class="font-mono text-[10px] text-indigo-700 font-semibold">📱 ${escHtml(ct.mobile)}</div>` : ''}
          ${ct.email ? `<div class="font-mono text-[10px] text-slate-500 truncate" title="${escHtml(ct.email)}">✉️ ${escHtml(ct.email)}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function renderCustomersTable() {
  const tbody = document.getElementById('custMasterTbody');
  const mobileWrap = document.getElementById('custMasterMobileCards');
  if (!tbody && !mobileWrap) return;
  const canEdit = canModifyMaster();

  if (!custCache.length) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="py-10 text-center text-slate-400">검색 조건에 맞는 거래처가 없습니다.</td></tr>`;
    if (mobileWrap) mobileWrap.innerHTML = `<div class="py-10 text-center text-slate-400 text-xs">검색 조건에 맞는 거래처가 없습니다.</div>`;
    return;
  }

  if (mobileWrap) {
    mobileWrap.innerHTML = custCache.map((c, idx) => {
      const isWeb = Number(c.cid) >= 900000;
      const contactStr = [c.contact_name, c.contact_title].filter(Boolean).join(' ');
      const cnt = (contactCountMap && c.cid) ? (contactCountMap[String(c.cid)] || 0) : 0;
      const panelId = `mobContacts_${c.cid}_${idx}`;
      return `
        <div class="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs space-y-2 text-xs">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">#${c.cid || '-'}</span>
                ${isWeb ? '<span class="text-[9px] font-black text-teal-700 bg-teal-100 rounded px-1.5 py-0.5">WEB</span>' : ''}
                ${c.sales_rep ? `<span class="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">${escHtml(c.sales_rep)}</span>` : ''}
                <button type="button" onclick="window.openCustomer360Modal && window.openCustomer360Modal('${escHtml(c.kname || c.cname || '').replace(/'/g, "\\'")}', ${Number(c.cid) || 'null'})" class="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-indigo-600 text-white cursor-pointer">🔍 360° 브리핑</button>
                ${cnt > 0 ? `<button type="button" onclick="window.toggleCustomerContacts(${c.cid}, '${panelId}')" class="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-teal-50 text-teal-700 border border-teal-200 cursor-pointer">👥 담당자 ${cnt}명 ▾</button>` : ''}
              </div>
              <div class="font-black text-sm text-slate-900 mt-1 break-words cursor-pointer hover:text-indigo-700" onclick="window.openCustomer360Modal && window.openCustomer360Modal('${escHtml(c.kname || c.cname || '').replace(/'/g, "\\'")}', ${Number(c.cid) || 'null'})">${escHtml(c.kname || c.cname || '-')}</div>
              ${c.cname && c.cname !== c.kname ? `<div class="text-[11px] text-slate-400 break-words">${escHtml(c.cname)}</div>` : ''}
            </div>
            ${canEdit ? `
              <div class="flex items-center gap-1 shrink-0">
                <button type="button" onclick="window.editCustomerMasterByIdx(${idx})" class="px-2 py-1 text-[11px] font-bold bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg cursor-pointer">✏️ 수정</button>
                <button type="button" onclick="window.deleteCustomerMasterByIdx(${idx})" class="px-2 py-1 text-[11px] font-bold bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-lg cursor-pointer">🗑️</button>
              </div>
            ` : ''}
          </div>
          <div class="grid grid-cols-2 gap-1.5 bg-slate-50 p-2 rounded-lg border border-slate-100 text-[11px]">
            <div><span class="text-[9px] text-slate-400 block font-semibold">대표 담당자</span><span class="font-bold text-slate-800">${escHtml(contactStr || '-')}</span></div>
            <div><span class="text-[9px] text-slate-400 block font-semibold">연락처</span><span class="font-mono text-slate-700">${escHtml(c.tel || c.contact_mobile || '-')}</span></div>
            ${c.email || c.contact_email ? `<div class="col-span-2 truncate"><span class="text-[9px] text-slate-400 mr-1 font-semibold">이메일:</span><span class="font-mono text-slate-600">${escHtml(c.email || c.contact_email)}</span></div>` : ''}
            ${c.address ? `<div class="col-span-2 text-[10px] text-slate-500 leading-snug">📍 ${escHtml(c.address)}</div>` : ''}
          </div>
          <div id="${panelId}" class="hidden bg-teal-50/60 border border-teal-200 rounded-lg p-2.5"><div class="contacts-slot"></div></div>
        </div>
      `;
    }).join('');
  }

  if (!tbody) return;
  tbody.innerHTML = custCache.map((c, idx) => {
    const isWeb = Number(c.cid) >= 900000;
    const contactStr = [c.contact_name, c.contact_title].filter(Boolean).join(' ');
    const cnt = (contactCountMap && c.cid) ? (contactCountMap[String(c.cid)] || 0) : 0;
    const rowPanelId = `deskContacts_${c.cid}_${idx}`;
    return `
      <tr class="hover:bg-teal-50/50 transition-colors">
        <td class="py-2 px-3 text-center font-mono text-[11px] text-slate-500">
          ${c.cid || '-'}
          ${isWeb ? '<span class="block text-[9px] font-black text-teal-700 bg-teal-100 rounded px-1 mt-0.5">WEB</span>' : ''}
        </td>
        <td class="py-2 px-3">
          <button type="button" onclick="window.openCustomer360Modal && window.openCustomer360Modal('${escHtml(c.kname || c.cname || '').replace(/'/g, "\\'")}', ${Number(c.cid) || 'null'})" class="text-left font-black text-slate-900 hover:text-indigo-700 hover:underline cursor-pointer flex items-center gap-1" title="클릭하여 360° 고객사 통합 브리핑 열기">
            <span>${escHtml(c.kname || c.cname || '-')}</span>
            <span class="text-[9px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-1 py-0.2 rounded font-bold shrink-0">360°</span>
          </button>
          ${c.cname && c.cname !== c.kname ? `<div class="text-[10px] text-slate-400">${escHtml(c.cname)}</div>` : ''}
        </td>
        <td class="py-2 px-3 text-center">
          ${c.sales_rep ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">${escHtml(c.sales_rep)}</span>` : '<span class="text-slate-300">-</span>'}
        </td>
        <td class="py-2 px-3 text-slate-800 font-medium">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span>${escHtml(contactStr || '-')}</span>
            ${cnt > 0 ? `<button type="button" onclick="window.toggleCustomerContacts(${c.cid}, '${rowPanelId}')" class="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 cursor-pointer whitespace-nowrap" title="ContactFile 전체 담당자 보기">👥 ${cnt}명 ▾</button>` : ''}
          </div>
        </td>
        <td class="py-2 px-3 text-[11px] font-mono text-slate-600">
          ${c.tel ? `<div>📞 ${escHtml(c.tel)}</div>` : ''}
          ${c.contact_mobile ? `<div>📱 ${escHtml(c.contact_mobile)}</div>` : ''}
          ${c.email || c.contact_email ? `<div class="text-[10px] text-slate-400 truncate max-w-[160px]">✉️ ${escHtml(c.email || c.contact_email)}</div>` : ''}
        </td>
        <td class="py-2 px-3 text-[11px] text-slate-500 max-w-[200px] truncate" title="${escHtml(c.address)}">${escHtml(c.address || '-')}</td>
        <td class="py-2 px-3 text-center whitespace-nowrap">
          ${canEdit ? `
            <button type="button" onclick="window.editCustomerMasterByIdx(${idx})" class="px-2 py-1 text-[10px] font-bold bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded cursor-pointer mr-1">✏️ 수정</button>
            <button type="button" onclick="window.deleteCustomerMasterByIdx(${idx})" class="px-2 py-1 text-[10px] font-bold bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded cursor-pointer">🗑️ 삭제</button>
          ` : '<span class="text-[10px] text-slate-300">조회전용</span>'}
        </td>
      </tr>
      <tr id="${rowPanelId}" class="hidden bg-teal-50/40">
        <td colspan="7" class="p-3 border-b border-teal-200/70"><div class="contacts-slot"></div></td>
      </tr>
    `;
  }).join('');
}

function renderCustomersPagination() {
  const el = document.getElementById('custMasterPagination');
  if (!el) return;
  const totalPages = Math.max(1, Math.ceil(custTotal / custLimit));
  el.innerHTML = `
    <span class="text-slate-500 font-medium">${custPage} / ${totalPages} 페이지 (총 ${custTotal.toLocaleString()}건)</span>
    <div class="flex items-center gap-1.5">
      <button type="button" ${custPage <= 1 ? 'disabled' : ''} onclick="window.goToCustomerPage(${custPage - 1})" class="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 font-bold cursor-pointer">◀ 이전</button>
      <button type="button" ${custPage >= totalPages ? 'disabled' : ''} onclick="window.goToCustomerPage(${custPage + 1})" class="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 font-bold cursor-pointer">다음 ▶</button>
    </div>
  `;
}

// ========================================================
// 2. 매입처 / 해외공급사 마스터 (CustomerBFile)
// ========================================================
async function loadSuppliersTab(query = '') {
  const wrap = document.getElementById('custMasterTableWrap');
  const badge = document.getElementById('custMasterCountBadge');
  if (wrap) wrap.innerHTML = `<div class="py-12 text-center text-slate-400 text-xs font-bold">⏳ 매입처 / 해외공급사 마스터를 불러오는 중...</div>`;

  try {
    const params = new URLSearchParams({ limit: '500' });
    if (query) params.set('query', query);
    const res = await fetch(`/api/customers/suppliers?${params.toString()}`);
    const data = await res.json();
    supplierCache = data.items || [];
    if (badge) badge.innerText = `총 ${supplierCache.length.toLocaleString()}개 매입처 (CustomerBFile)`;
    renderSuppliersView();
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="py-12 text-center text-rose-500 text-xs font-bold">조회 오류: ${escHtml(err.message)}</div>`;
  }
}

function renderSuppliersView() {
  const wrap = document.getElementById('custMasterTableWrap');
  if (!wrap) return;
  if (!supplierCache.length) {
    wrap.innerHTML = `<div class="py-12 text-center text-slate-400 text-xs font-bold">검색 조건에 맞는 매입처가 없습니다.</div>`;
    return;
  }

  const mobileHtml = `
    <div class="block md:hidden p-3 space-y-2.5">
      ${supplierCache.map((s) => `
        <div class="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs space-y-1.5 text-xs">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">#${s.cid}</span>
              ${s.nation ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200">🌐 ${escHtml(s.nation)}</span>` : ''}
              ${s.sales ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700">${escHtml(s.sales)}</span>` : ''}
            </div>
            <span class="text-[10px] font-mono text-slate-400">${escHtml(s.update_dt || '')}</span>
          </div>
          <div class="font-black text-sm text-slate-900 break-words">${escHtml(s.cname)}</div>
          ${s.product ? `<div class="text-[11px] font-semibold text-teal-800 bg-teal-50/70 px-2 py-1 rounded border border-teal-100">취급품목: ${escHtml(s.product)}</div>` : ''}
          <div class="text-[11px] font-mono text-slate-600 space-y-0.5">
            ${s.tel ? `<div>📞 ${escHtml(s.tel)} ${s.fax ? `/ FAX ${escHtml(s.fax)}` : ''}</div>` : ''}
            ${s.email ? `<div class="truncate">✉️ ${escHtml(s.email)}</div>` : ''}
            ${s.address ? `<div class="font-sans text-[10px] text-slate-500">📍 ${escHtml(s.address)}</div>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;

  const desktopHtml = `
    <table class="hidden md:table w-full text-left text-xs border-collapse">
      <thead class="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 sticky top-0 z-10 text-[11px]">
        <tr>
          <th class="py-2.5 px-3 w-16 text-center">CID</th>
          <th class="py-2.5 px-3 min-w-[200px]">매입처 / 공급사명</th>
          <th class="py-2.5 px-2.5 w-24 text-center">국가</th>
          <th class="py-2.5 px-3 min-w-[140px]">취급 품목 (Product)</th>
          <th class="py-2.5 px-3 min-w-[150px]">연락처 / 이메일</th>
          <th class="py-2.5 px-3 min-w-[180px]">주소 / 비고</th>
          <th class="py-2.5 px-2.5 w-24 text-center">갱신일</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100 bg-white text-[11px]">
        ${supplierCache.map((s) => `
          <tr class="hover:bg-sky-50/40">
            <td class="py-2 px-3 text-center font-mono text-slate-400">${s.cid}</td>
            <td class="py-2 px-3 font-black text-slate-900">${escHtml(s.cname)}</td>
            <td class="py-2 px-2.5 text-center">${s.nation ? `<span class="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 font-bold text-[10px]">${escHtml(s.nation)}</span>` : '-'}</td>
            <td class="py-2 px-3 text-teal-800 font-semibold truncate max-w-[160px]" title="${escHtml(s.product)}">${escHtml(s.product || '-')}</td>
            <td class="py-2 px-3 font-mono text-slate-600">
              ${s.tel ? `<div>📞 ${escHtml(s.tel)}</div>` : ''}
              ${s.email ? `<div class="text-[10px] text-slate-400 truncate max-w-[160px]">✉️ ${escHtml(s.email)}</div>` : ''}
            </td>
            <td class="py-2 px-3 text-slate-500 truncate max-w-[200px]" title="${escHtml(s.address || s.remark)}">${escHtml(s.address || s.remark || '-')}</td>
            <td class="py-2 px-2.5 text-center font-mono text-slate-400 whitespace-nowrap">${escHtml(s.update_dt || '-')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  wrap.innerHTML = mobileHtml + desktopHtml;
  wrap.scrollTop = 0;
}

// ========================================================
// 3. 고객사 지정 포워더 (CustForwarder)
// ========================================================
async function loadForwardersTab(query = '') {
  const wrap = document.getElementById('custMasterTableWrap');
  const badge = document.getElementById('custMasterCountBadge');
  if (wrap) wrap.innerHTML = `<div class="py-12 text-center text-slate-400 text-xs font-bold">⏳ 고객사 지정 포워더 정보를 불러오는 중...</div>`;

  try {
    const params = new URLSearchParams({ limit: '500' });
    if (query) params.set('query', query);
    const res = await fetch(`/api/customers/forwarders?${params.toString()}`);
    const data = await res.json();
    forwarderCache = data.items || [];
    if (badge) badge.innerText = `총 ${forwarderCache.length.toLocaleString()}건 지정 포워더 (CustForwarder)`;
    renderForwardersView();
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="py-12 text-center text-rose-500 text-xs font-bold">조회 오류: ${escHtml(err.message)}</div>`;
  }
}

function renderForwardersView() {
  const wrap = document.getElementById('custMasterTableWrap');
  if (!wrap) return;
  if (!forwarderCache.length) {
    wrap.innerHTML = `<div class="py-12 text-center text-slate-400 text-xs font-bold">검색 조건에 맞는 지정 포워더가 없습니다.</div>`;
    return;
  }

  const mobileHtml = `
    <div class="block md:hidden p-3 space-y-2.5">
      ${forwarderCache.map((f) => `
        <div class="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs space-y-1.5 text-xs">
          <div class="flex items-center justify-between gap-2">
            <span class="font-black text-slate-900 truncate">${escHtml(f.customer_name || `CID #${f.cid}`)}</span>
            ${f.chk === 'Y' ? '<span class="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-emerald-100 text-emerald-800 shrink-0">기본지정</span>' : ''}
          </div>
          <div class="text-xs font-bold text-indigo-900">🚚 ${escHtml(f.fname)}</div>
          <div class="grid grid-cols-2 gap-1.5 bg-slate-50 p-2 rounded-lg border border-slate-100 text-[11px]">
            <div><span class="text-[9px] text-slate-400 block">Account 번호</span><span class="font-mono font-bold text-slate-800">${escHtml(f.account || '-')}</span></div>
            <div><span class="text-[9px] text-slate-400 block">지역 / 구분</span><span class="font-semibold text-slate-700">${escHtml([f.region, f.kinds].filter(Boolean).join(' / ') || '-')}</span></div>
          </div>
          ${f.comment ? `<div class="text-[10px] text-slate-500 leading-snug">💬 ${escHtml(f.comment)}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `;

  const desktopHtml = `
    <table class="hidden md:table w-full text-left text-xs border-collapse">
      <thead class="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 sticky top-0 z-10 text-[11px]">
        <tr>
          <th class="py-2.5 px-3 w-16 text-center">CID</th>
          <th class="py-2.5 px-3 min-w-[180px]">고객사명</th>
          <th class="py-2.5 px-3 min-w-[200px]">지정 포워더 (FName)</th>
          <th class="py-2.5 px-3 min-w-[130px]">Account 번호</th>
          <th class="py-2.5 px-2.5 w-24 text-center">지역</th>
          <th class="py-2.5 px-2.5 w-28 text-center">적용 라인</th>
          <th class="py-2.5 px-3 min-w-[160px]">코멘트</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100 bg-white text-[11px]">
        ${forwarderCache.map((f) => `
          <tr class="hover:bg-indigo-50/40">
            <td class="py-2 px-3 text-center font-mono text-slate-400">${f.cid || '-'}</td>
            <td class="py-2 px-3 font-black text-slate-900">
              ${escHtml(f.customer_name || '-')}
              ${f.chk === 'Y' ? '<span class="ml-1 px-1.5 py-0.5 rounded text-[9px] font-black bg-emerald-100 text-emerald-800">기본</span>' : ''}
            </td>
            <td class="py-2 px-3 font-bold text-indigo-900">${escHtml(f.fname)}</td>
            <td class="py-2 px-3 font-mono font-bold text-slate-800">${escHtml(f.account || '-')}</td>
            <td class="py-2 px-2.5 text-center text-slate-600">${escHtml(f.region || '-')}</td>
            <td class="py-2 px-2.5 text-center font-mono text-[10px] text-teal-700">${escHtml(f.kinds || '-')}</td>
            <td class="py-2 px-3 text-slate-500 truncate max-w-[180px]" title="${escHtml(f.comment)}">${escHtml(f.comment || '-')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  wrap.innerHTML = mobileHtml + desktopHtml;
  wrap.scrollTop = 0;
}

window.openCustomerMasterModal = openCustomerMasterModal;
window.goToCustomerPage = loadCustomersPage;
window.toggleCustomerContacts = toggleCustomerContacts;
window.editCustomerMasterByIdx = (idx) => {
  if (custCache[idx]) openCustomerEditor(custCache[idx]);
};
window.deleteCustomerMasterByIdx = (idx) => {
  const c = custCache[idx];
  if (c) deleteCustomerMaster(c.id || c.cid, c.kname || c.cname || '거래처');
};

// ========================================================
// 🏢 고객사 360° 통합 브리핑 모달 (Customer 360° Briefing Popup)
// ========================================================
const cust360State = {
  customerName: '',
  cid: null,
  tab: 'biz', // 'biz' | 'pipeline' | 'contacts'
  bizFilter: 'ALL', // 'ALL' | 'DOMESTIC' | 'COMMISSION'
  search: '',
  loading: false,
  data: null,
};

export async function openCustomer360Modal(customerName, cid = null) {
  const cleanName = (customerName || '').trim();
  if (!cleanName || cleanName === '-' || cleanName === '기타' || isSelfCompanyName(cleanName)) return;

  cust360State.customerName = cleanName;
  cust360State.cid = cid;
  cust360State.tab = 'biz';
  cust360State.bizFilter = 'ALL';
  cust360State.search = '';
  cust360State.loading = true;
  cust360State.data = null;

  let modal = document.getElementById('customer360Modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'customer360Modal';
    modal.className = 'fixed inset-0 bg-slate-900/70 backdrop-blur-xs z-[99993] flex items-center justify-center p-2 sm:p-4 overflow-y-auto';
    modal.onclick = (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    };
    document.body.appendChild(modal);
  }
  modal.classList.remove('hidden');
  renderCustomer360Modal();

  try {
    const params = new URLSearchParams({
      customer_name: cleanName,
      start_date: '2024-01-01',
      end_date: '2026-12-31',
      limit: '400'
    });
    if (cid) params.set('cid', String(cid));
    const res = await fetch(`/api/customers/360?${params.toString()}`);
    const json = await res.json();
    if (json && json.status === 'success') {
      cust360State.data = json;
    }
  } catch (e) {
    console.warn('Customer 360 조회 예외:', e);
  } finally {
    cust360State.loading = false;
    renderCustomer360Modal();
  }
}

window.openCustomer360Modal = openCustomer360Modal;

window.switchCustomer360Tab = function(tab) {
  cust360State.tab = tab;
  renderCustomer360Modal();
};

window.setCustomer360BizFilter = function(f) {
  cust360State.bizFilter = f;
  renderCustomer360Modal();
};

window.setCustomer360Search = function(val) {
  cust360State.search = val || '';
  renderCustomer360Modal();
  const inp = document.getElementById('cust360SearchInput');
  if (inp) {
    inp.focus();
    const len = inp.value.length;
    try { inp.setSelectionRange(len, len); } catch (_) {}
  }
};

window.jumpFromCust360ToInventory = function(customerName, itemId = null) {
  document.getElementById('customer360Modal')?.classList.add('hidden');
  document.getElementById('customerMasterModal')?.classList.add('hidden');
  document.getElementById('tabSales')?.click();
  const searchInp = document.getElementById('searchInput');
  if (searchInp) {
    searchInp.value = customerName || '';
    searchInp.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (itemId && typeof window.loadFormFromItem === 'function') {
    setTimeout(() => window.loadFormFromItem(itemId), 120);
  }
};

function renderCustomer360Modal() {
  const modal = document.getElementById('customer360Modal');
  if (!modal) return;

  const { customerName, tab, bizFilter, search, loading, data } = cust360State;
  const fx = (typeof window.getLiveFxRate === 'function' ? window.getLiveFxRate() : window.rawFxRate) || 1380;
  const d = data || {};
  const profile = d.profile || {};
  const contacts = Array.isArray(d.contacts) ? d.contacts : [];
  const forwarders = Array.isArray(d.forwarders) ? d.forwarders : [];
  const domSales = Array.isArray(d.domestic_sales) ? d.domestic_sales : [];
  const commShips = Array.isArray(d.commission_shipments) ? d.commission_shipments : [];
  const unpaidDom = Array.isArray(d.unpaid_domestic) ? d.unpaid_domestic : [];
  const quotations = Array.isArray(d.quotations) ? d.quotations : [];
  const sampleProjects = Array.isArray(d.sample_projects) ? d.sample_projects : [];
  const sampleOutflows = Array.isArray(d.sample_outflows) ? d.sample_outflows : [];

  // 해당 고객사 앞으로 배정/계약된 실시간 재고 (window.cachedItems 연동)
  const cLow = customerName.toLowerCase();
  const allInv = Array.isArray(window.cachedItems) ? window.cachedItems : [];
  const custStocks = allInv.filter(it => {
    if ((Number(it.stock) || 0) <= 0) return false;
    const hay = `${it.customer || ''} ${it.realCustomer || it.real_customer || ''} ${it.memo || ''}`.toLowerCase();
    return hay.includes(cLow);
  });

  // 핵심 KPI 집계
  const totalDomBillingKrw = domSales.reduce((s, r) => s + (Number(r.out_amt_krw) || 0), 0);
  const totalDomMarginKrw = domSales.reduce((s, r) => s + (Number(r.margin_krw) || 0), 0);
  const avgDomMarginRate = totalDomBillingKrw > 0 ? ((totalDomMarginKrw / totalDomBillingKrw) * 100).toFixed(1) : '0.0';
  const totalCommUsd = commShips.reduce((s, r) => s + (Number(r.comm_amt) || 0), 0);
  const totalCommKrw = Math.round(totalCommUsd * fx);
  const totalProfitKrw = totalDomMarginKrw + totalCommKrw;

  const totalStockQty = custStocks.reduce((s, it) => s + (Number(it.stock) || 0), 0);
  const totalStockUsd = custStocks.reduce((s, it) => s + ((Number(it.stock) || 0) * (Number(it.unitUsd ?? it.unit_usd) || 0)), 0);

  const unpaidDomKrw = unpaidDom.reduce((s, u) => s + (Number(u.amount_vat ?? u.out_amt) || 0), 0);
  const unpaidCommUsd = commShips.filter(c => !(c.bank_dt || c.comm_dt || c.comm_status === '정산완료')).reduce((s, r) => s + (Number(r.comm_amt) || 0), 0);

  // 통합 거래 내역 (Domestic + Commission)
  const unifiedBiz = [
    ...domSales.map(r => ({
      biz_type: 'DOMESTIC',
      date: r.ship_date || '',
      maker: r.maker || 'OTHERS',
      part_no: r.part_no || '-',
      po_no: r.po_no || '',
      qty: Number(r.ship_qty) || 0,
      unit_str: `₩${Math.round(Number(r.out_up_krw) || 0).toLocaleString()}`,
      amt_str: `₩${Math.round(Number(r.out_amt_krw) || 0).toLocaleString()}`,
      profit_krw: Math.round(Number(r.margin_krw) || 0),
      profit_str: `₩${Math.round(Number(r.margin_krw) || 0).toLocaleString()}`,
      rate_str: `${Number(r.margin_rate || 0).toFixed(1)}%`,
      sales_rep: toEnglishSalesName(r.sales_rep || ''),
      status_str: '국내출고',
      awb_no: ''
    })),
    ...commShips.map(c => ({
      biz_type: 'COMMISSION',
      date: c.ship_date || '',
      maker: c.maker || 'OTHERS',
      part_no: c.part_no || '-',
      po_no: c.po_no || c.invoice_no || '',
      qty: Number(c.ship_qty) || 0,
      unit_str: `$${(Number(c.net_up) || 0).toFixed(4)}`,
      amt_str: `$${(Number(c.ship_amt) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      profit_krw: Math.round((Number(c.comm_amt) || 0) * fx),
      profit_str: `$${(Number(c.comm_amt) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (≈₩${Math.round((Number(c.comm_amt) || 0) * fx).toLocaleString()})`,
      rate_str: `${(Number(c.comm_rate) || 0).toFixed(2)}%`,
      sales_rep: toEnglishSalesName(c.sales_rep || ''),
      status_str: (c.bank_dt || c.comm_dt) ? '정산완료' : '미입금',
      awb_no: c.awb_no || ''
    }))
  ].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const q = search.trim().toLowerCase();
  let tabBodyHtml = '';

  if (tab === 'biz') {
    const filtered = unifiedBiz.filter(it => {
      if (bizFilter === 'DOMESTIC' && it.biz_type !== 'DOMESTIC') return false;
      if (bizFilter === 'COMMISSION' && it.biz_type !== 'COMMISSION') return false;
      if (q && !`${it.part_no} ${it.maker} ${it.po_no} ${it.sales_rep}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const sumProfit = filtered.reduce((s, r) => s + (r.profit_krw || 0), 0);

    tabBodyHtml = `
      <div class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2 bg-white p-2.5 rounded-xl border border-slate-200 text-xs">
          <div class="flex items-center gap-1 flex-wrap">
            <button type="button" onclick="window.setCustomer360BizFilter('ALL')" class="px-2.5 py-1 rounded-lg font-bold cursor-pointer ${bizFilter === 'ALL' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">전체 (${unifiedBiz.length})</button>
            <button type="button" onclick="window.setCustomer360BizFilter('DOMESTIC')" class="px-2.5 py-1 rounded-lg font-bold cursor-pointer ${bizFilter === 'DOMESTIC' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">🏢 Domestic 매출·마진 (${domSales.length})</button>
            <button type="button" onclick="window.setCustomer360BizFilter('COMMISSION')" class="px-2.5 py-1 rounded-lg font-bold cursor-pointer ${bizFilter === 'COMMISSION' ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">💎 Commission 직송 (${commShips.length})</button>
          </div>
          <div class="flex items-center gap-3 text-[11px] font-mono font-bold text-slate-700">
            <span>조회: <strong>${filtered.length.toLocaleString()}건</strong></span>
            <span>🏆 수익합계(마진+커미션): <strong class="text-violet-800">₩${sumProfit.toLocaleString()}</strong></span>
          </div>
        </div>

        ${loading ? `<div class="py-12 text-center text-slate-400 font-bold text-xs">⏳ [${escHtml(customerName)}] 360° 통합 비즈니스 원장을 불러오는 중입니다...</div>` : filtered.length === 0 ? `<div class="py-12 text-center text-slate-400 font-bold text-xs bg-white rounded-xl border border-slate-200">조회된 출하·매출 내역이 없습니다.</div>` : `
          <div class="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-2xs">
            <table class="w-full text-left text-xs border-collapse">
              <thead class="bg-slate-100 text-slate-700 font-bold text-[11px] border-b border-slate-200 sticky top-0 z-10">
                <tr>
                  <th class="py-2 px-2 text-center w-16">구분</th>
                  <th class="py-2 px-2 text-center w-24">출하일</th>
                  <th class="py-2 px-2 text-center w-20">제조사</th>
                  <th class="py-2 px-2">품번 (PartNo)</th>
                  <th class="py-2 px-2">PO / 번호</th>
                  <th class="py-2 px-2 text-right">수량</th>
                  <th class="py-2 px-2 text-right">판매단가</th>
                  <th class="py-2 px-2 text-right">매출/선적액</th>
                  <th class="py-2 px-2 text-right">🏆 마진 / 💎 커미션</th>
                  <th class="py-2 px-2 text-center">담당</th>
                  <th class="py-2 px-2 text-center">상태/추적</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 text-[11px]">
                ${filtered.slice(0, 250).map(r => {
                  const isComm = r.biz_type === 'COMMISSION';
                  return `
                    <tr class="hover:bg-slate-50 ${isComm ? 'bg-violet-50/15' : ''}">
                      <td class="py-1.5 px-2 text-center whitespace-nowrap">
                        ${isComm
                          ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-black bg-violet-100 text-violet-800 border border-violet-200">💎 COMM</span>`
                          : `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">🏢 DOM</span>`}
                      </td>
                      <td class="py-1.5 px-2 text-center font-mono text-slate-600 whitespace-nowrap">${escHtml(r.date)}</td>
                      <td class="py-1.5 px-2 text-center font-bold text-indigo-900 whitespace-nowrap">${escHtml(r.maker)}</td>
                      <td class="py-1.5 px-2 font-mono font-bold text-slate-900 whitespace-nowrap">
                        <button type="button" onclick="window.openPriceHistoryModal && window.openPriceHistoryModal('${escHtml(r.part_no).replace(/'/g, "\\'")}')" class="hover:text-indigo-700 hover:underline cursor-pointer">📈 ${escHtml(r.part_no)}</button>
                      </td>
                      <td class="py-1.5 px-2 font-mono text-[10px] text-slate-600 truncate max-w-[130px]">${escHtml(r.po_no || '-')}</td>
                      <td class="py-1.5 px-2 text-right font-mono font-bold text-slate-900 whitespace-nowrap">${r.qty.toLocaleString()}</td>
                      <td class="py-1.5 px-2 text-right font-mono text-blue-700 whitespace-nowrap">${escHtml(r.unit_str)}</td>
                      <td class="py-1.5 px-2 text-right font-mono font-black text-slate-900 whitespace-nowrap">${escHtml(r.amt_str)}</td>
                      <td class="py-1.5 px-2 text-right font-mono whitespace-nowrap">
                        <div class="font-black ${isComm ? 'text-violet-700' : 'text-emerald-700'}">${escHtml(r.profit_str)}</div>
                        <div class="text-[9px] ${isComm ? 'text-violet-500' : 'text-emerald-600'} font-bold">${escHtml(r.rate_str)}</div>
                      </td>
                      <td class="py-1.5 px-2 text-center font-bold text-indigo-900 whitespace-nowrap">${escHtml(r.sales_rep || '-')}</td>
                      <td class="py-1.5 px-2 text-center whitespace-nowrap">
                        <div class="inline-flex items-center gap-1">
                          <span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${r.status_str === '미입금' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-slate-100 text-slate-700'}">${escHtml(r.status_str)}</span>
                          ${r.awb_no ? `<button type="button" onclick="window.openTrackingModal && window.openTrackingModal('${escHtml(r.awb_no).replace(/'/g, "\\'")}')" class="px-1.5 py-0.5 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 rounded text-[9px] font-bold cursor-pointer">🚚</button>` : ''}
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
  } else if (tab === 'pipeline') {
    const filteredStocks = custStocks.filter(it => !q || `${it.partName || it.part_name || ''} ${it.maker || ''} ${it.poNo || it.po_no || ''}`.toLowerCase().includes(q));
    const filteredQuotes = quotations.filter(qt => !q || `${qt.part_no || ''} ${qt.mfg || ''} ${qt.quote_no || ''}`.toLowerCase().includes(q));
    const filteredProjects = sampleProjects.filter(sp => !q || `${sp.part_no || ''} ${sp.mfg || ''} ${sp.app || ''} ${sp.prj_model || ''}`.toLowerCase().includes(q));

    tabBodyHtml = `
      <div class="space-y-4">
        <!-- 1. 고객사 배정/연관 보유 재고 -->
        <div class="bg-white rounded-xl border border-slate-200 p-3.5 space-y-2.5">
          <div class="flex items-center justify-between border-b border-slate-100 pb-2">
            <h4 class="font-black text-xs text-emerald-950 flex items-center gap-1.5">
              <span>📦</span> 고객사 배정 / 계약 보유 재고 (${filteredStocks.length}건 · 총 ${totalStockQty.toLocaleString()} EA)
            </h4>
            <button type="button" onclick="window.jumpFromCust360ToInventory('${escHtml(customerName).replace(/'/g, "\\'")}')" class="text-[11px] font-bold text-indigo-700 hover:underline cursor-pointer">재고 탭에서 전체 보기 ↗</button>
          </div>
          ${filteredStocks.length === 0 ? `<div class="py-4 text-center text-slate-400 text-xs">현재 이 고객사 앞으로 배정된 보유 재고가 없습니다.</div>` : `
            <div class="overflow-x-auto">
              <table class="w-full text-left text-xs border-collapse">
                <thead class="bg-emerald-50 text-emerald-950 font-bold text-[11px] border-b border-emerald-200">
                  <tr>
                    <th class="py-1.5 px-2 text-center">상태</th>
                    <th class="py-1.5 px-2 text-center">제조사</th>
                    <th class="py-1.5 px-2">품번 (PartNo)</th>
                    <th class="py-1.5 px-2 text-right">보유수량</th>
                    <th class="py-1.5 px-2 text-right">배정 / 가용</th>
                    <th class="py-1.5 px-2 text-right">매입단가($)</th>
                    <th class="py-1.5 px-2 text-center">담당 / 입고일</th>
                    <th class="py-1.5 px-2 text-center">바로가기</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 text-[11px]">
                  ${filteredStocks.map(it => {
                    const stk = Number(it.stock) || 0;
                    const rawArr = Number(it.arrangedQty ?? it.arranged_qty) || 0;
                    const isExp = it.orderStatus === '배정완료' || it.orderStatus === '배정요청';
                    const arr = rawArr > 0 ? Math.min(stk, rawArr) : (isExp ? stk : 0);
                    const avail = Math.max(0, stk - arr);
                    const part = it.partName || it.part_name || '-';
                    return `
                      <tr class="hover:bg-emerald-50/30">
                        <td class="py-1.5 px-2 text-center"><span class="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-800">${escHtml(it.orderStatus || '보유')}</span></td>
                        <td class="py-1.5 px-2 text-center font-bold text-indigo-900">${escHtml(it.maker)}</td>
                        <td class="py-1.5 px-2 font-mono font-black text-slate-900">
                          <button type="button" onclick="window.openPriceHistoryModal && window.openPriceHistoryModal('${escHtml(part).replace(/'/g, "\\'")}')" class="hover:text-indigo-700 hover:underline cursor-pointer">📈 ${escHtml(part)}</button>
                        </td>
                        <td class="py-1.5 px-2 text-right font-mono font-black">${stk.toLocaleString()} EA</td>
                        <td class="py-1.5 px-2 text-right font-mono"><span class="text-amber-700 font-bold">배정:${arr.toLocaleString()}</span> · <span class="text-emerald-700 font-bold">가용:${avail.toLocaleString()}</span></td>
                        <td class="py-1.5 px-2 text-right font-mono">$${(Number(it.unitUsd ?? it.unit_usd) || 0).toFixed(4)}</td>
                        <td class="py-1.5 px-2 text-center font-mono text-[10px]">${escHtml(toEnglishSalesName(it.owner || ''))} · ${escHtml((it.entryDate || it.entry_date || '').slice(0, 10))}</td>
                        <td class="py-1.5 px-2 text-center">
                          <button type="button" onclick="window.jumpFromCust360ToInventory('${escHtml(customerName).replace(/'/g, "\\'")}', '${escHtml(it.id)}')" class="px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded text-[10px] font-bold cursor-pointer">상세/견적 ↗</button>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <!-- 2. Design-In 프로젝트 & 샘플 출고 -->
          <div class="bg-white rounded-xl border border-slate-200 p-3.5 space-y-2">
            <h4 class="font-black text-xs text-indigo-950 border-b border-slate-100 pb-2">🧪 Design-In 프로젝트 (${filteredProjects.length}건) &amp; 샘플 출고 (${sampleOutflows.length}건)</h4>
            ${(filteredProjects.length === 0 && sampleOutflows.length === 0) ? `<div class="py-6 text-center text-slate-400 text-xs">등록된 샘플·프로젝트 이력이 없습니다.</div>` : `
              <div class="space-y-1.5 max-h-64 overflow-y-auto pr-1 text-[11px]">
                ${filteredProjects.map(p => `
                  <div class="p-2 rounded-lg bg-indigo-50/50 border border-indigo-100 space-y-0.5">
                    <div class="flex items-center justify-between gap-2">
                      <span class="font-mono font-black text-indigo-950">[${escHtml(p.mfg)}] ${escHtml(p.part_no)}</span>
                      <span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-indigo-100 text-indigo-800">${escHtml(p.sample_result_label || 'Working')} · ${escHtml(p.business_result_label || '')}</span>
                    </div>
                    <div class="text-[10px] text-slate-600">모델/APP: <strong>${escHtml(p.prj_model || p.app || '-')}</strong> · 예상물량: <strong>${(Number(p.volume) || 0).toLocaleString()} EA</strong> · 담당: <strong>${escHtml(p.sales || '-')}</strong></div>
                  </div>
                `).join('')}
                ${sampleOutflows.slice(0, 15).map(so => `
                  <div class="p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between gap-2">
                    <div class="min-w-0">
                      <div class="font-mono font-bold text-slate-900 truncate">[샘플출고] ${escHtml(so.part_no)} (${(Number(so.qty) || 0).toLocaleString()} EA)</div>
                      <div class="text-[10px] text-slate-500">${escHtml(so.out_date || '-')} · 수신: ${escHtml(so.contact || '-')} · 담당: ${escHtml(so.sales || '-')}</div>
                    </div>
                    <span class="text-[10px] font-mono text-teal-700 font-bold shrink-0">${escHtml(so.so_no || '')}</span>
                  </div>
                `).join('')}
              </div>
            `}
          </div>

          <!-- 3. 최근 견적 이력 -->
          <div class="bg-white rounded-xl border border-slate-200 p-3.5 space-y-2">
            <h4 class="font-black text-xs text-slate-900 border-b border-slate-100 pb-2">📄 최근 발행 견적 이력 (${filteredQuotes.length}건)</h4>
            ${filteredQuotes.length === 0 ? `<div class="py-6 text-center text-slate-400 text-xs">발행된 견적 이력이 없습니다.</div>` : `
              <div class="space-y-1.5 max-h-64 overflow-y-auto pr-1 text-[11px]">
                ${filteredQuotes.slice(0, 30).map(qt => `
                  <div class="p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between gap-2">
                    <div class="min-w-0">
                      <div class="font-mono font-black text-slate-900 truncate">[${escHtml(qt.mfg)}] ${escHtml(qt.part_no)}</div>
                      <div class="text-[10px] text-slate-500 font-mono">${escHtml((qt.quote_dt || '').slice(0, 10))} · ${escHtml(qt.quote_no)} · 담당: ${escHtml(qt.sales || '-')}</div>
                    </div>
                    <div class="text-right font-mono shrink-0">
                      <div class="font-black text-indigo-700">${escHtml(qt.qunit || '$')} ${Number(qt.qp || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</div>
                      <div class="text-[10px] text-slate-500">수량: ${Number(qt.qty || 0).toLocaleString()}</div>
                    </div>
                  </div>
                `).join('')}
              </div>
            `}
          </div>
        </div>
      </div>
    `;
  } else {
    // 'contacts' 탭: 미수금 + 복수 담당자(ContactFile) + 지정 포워더(CustForwarder)
    tabBodyHtml = `
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <!-- 좌측: 복수 담당자 (ContactFile) & 지정 포워더 (CustForwarder) -->
        <div class="space-y-3">
          <div class="bg-white rounded-xl border border-slate-200 p-3.5 space-y-2">
            <div class="flex items-center justify-between border-b border-slate-100 pb-2">
              <h4 class="font-black text-xs text-teal-900">👥 등록된 고객사 담당자 (${contacts.length}명 — ContactFile)</h4>
              ${profile.tel ? `<span class="text-[11px] font-mono text-slate-600">대표 📞 ${escHtml(profile.tel)}</span>` : ''}
            </div>
            ${contacts.length === 0 ? `<div class="py-4 text-center text-slate-400 text-xs">등록된 세부 담당자 연락처가 없습니다. ${profile.contact_name ? `(대표: ${escHtml(profile.contact_name)})` : ''}</div>` : `
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
                ${contacts.map(ct => `
                  <div class="p-2.5 rounded-lg bg-teal-50/40 border border-teal-200/80 text-[11px] space-y-0.5">
                    <div class="flex items-center justify-between gap-1">
                      <span class="font-black text-slate-900">${escHtml(ct.name)} ${ct.title ? `<span class="text-slate-500 font-semibold">${escHtml(ct.title)}</span>` : ''}</span>
                      ${ct.remark ? `<span class="text-[9px] bg-white text-teal-800 px-1.5 py-0.2 rounded border border-teal-200 font-bold">${escHtml(ct.remark)}</span>` : ''}
                    </div>
                    ${ct.mobile ? `<div class="font-mono text-indigo-700 font-bold">📱 ${escHtml(ct.mobile)}</div>` : ''}
                    ${ct.tel ? `<div class="font-mono text-slate-600">📞 ${escHtml(ct.tel)}</div>` : ''}
                    ${ct.email ? `<div class="font-mono text-slate-500 truncate" title="${escHtml(ct.email)}">✉️ ${escHtml(ct.email)}</div>` : ''}
                  </div>
                `).join('')}
              </div>
            `}
          </div>

          <div class="bg-white rounded-xl border border-slate-200 p-3.5 space-y-2">
            <h4 class="font-black text-xs text-indigo-950 border-b border-slate-100 pb-2">🚚 지정 포워더 &amp; Account (${forwarders.length}건 — CustForwarder)</h4>
            ${forwarders.length === 0 ? `<div class="py-4 text-center text-slate-400 text-xs">등록된 지정 포워더 Account가 없습니다.</div>` : `
              <div class="space-y-1.5 max-h-44 overflow-y-auto pr-1 text-[11px]">
                ${forwarders.map(f => `
                  <div class="p-2 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-2">
                    <div>
                      <div class="font-black text-indigo-900">${escHtml(f.fname)} ${f.chk === 'Y' ? '<span class="px-1.5 py-0.2 rounded text-[9px] bg-emerald-100 text-emerald-800">기본</span>' : ''}</div>
                      <div class="text-[10px] text-slate-500">${escHtml([f.region, f.kinds, f.comment].filter(Boolean).join(' · ') || '-')}</div>
                    </div>
                    <span class="font-mono font-black text-slate-900 bg-white px-2 py-1 rounded border border-slate-200">${escHtml(f.account || '-')}</span>
                  </div>
                `).join('')}
              </div>
            `}
          </div>
        </div>

        <!-- 우측: 미수금 채권 현황 (Domestic + Commission) -->
        <div class="bg-white rounded-xl border border-slate-200 p-3.5 space-y-2.5">
          <div class="flex items-center justify-between border-b border-slate-100 pb-2">
            <h4 class="font-black text-xs text-rose-900">💰 미회수 채권 현황 (국내 ${unpaidDom.length}건 / 커미션 미입금 $${unpaidCommUsd.toLocaleString()})</h4>
            ${unpaidDom.length > 0 ? `<button type="button" onclick="window.openStatementOfAccount && window.openStatementOfAccount('${escHtml(customerName).replace(/'/g, "\\'")}')" class="px-2 py-0.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded text-[10px] font-bold cursor-pointer">📄 잔액확인서 발행</button>` : ''}
          </div>
          ${unpaidDom.length === 0 ? `<div class="py-8 text-center text-slate-400 text-xs font-bold">미결제 Domestic 외상 채권이 없습니다. ✅</div>` : `
            <div class="space-y-1.5 max-h-80 overflow-y-auto pr-1 text-[11px]">
              ${unpaidDom.map(u => `
                <div class="p-2 rounded-lg bg-rose-50/40 border border-rose-200/70 flex items-center justify-between gap-2">
                  <div class="min-w-0">
                    <div class="font-mono font-black text-slate-900 truncate">[${escHtml(u.mfg)}] ${escHtml(u.part_no)}</div>
                    <div class="text-[10px] text-slate-500 font-mono">출하: ${escHtml((u.out_dt || '').slice(0, 10))} · 만기: ${escHtml((u.due_date || '').slice(0, 10))} · ${Number(u.overdue_days) > 0 ? `<strong class="text-rose-700">+${u.overdue_days}일 연체</strong>` : '결제예정'}</div>
                  </div>
                  <div class="text-right font-mono shrink-0">
                    <div class="font-black text-rose-700">₩${Math.round(Number(u.amount_vat) || 0).toLocaleString()}</div>
                    <div class="text-[10px] text-slate-500">${escHtml(u.sales || '-')}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `;
  }

  modal.innerHTML = `
    <div class="bg-white w-full max-w-6xl h-[90vh] rounded-2xl shadow-2xl border border-slate-300 flex flex-col overflow-hidden" onclick="event.stopPropagation()">
      <!-- 헤더 -->
      <div class="bg-gradient-to-r from-slate-900 via-teal-950 to-indigo-950 text-white px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl bg-teal-500/25 border border-teal-400/40 flex items-center justify-center text-xl font-black shrink-0">🏢</div>
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h2 class="text-base sm:text-lg font-black tracking-wide truncate">${escHtml(customerName)} — 360° 통합 브리핑</h2>
              ${d.cid ? `<span class="text-[10px] bg-teal-500/30 border border-teal-300/40 text-teal-100 font-mono font-bold px-2 py-0.5 rounded-full">CID #${d.cid}</span>` : ''}
              ${profile.sales_rep ? `<span class="text-[10px] bg-indigo-500/40 border border-indigo-300/40 text-indigo-100 font-bold px-2 py-0.5 rounded-full">담당: ${escHtml(toEnglishSalesName(profile.sales_rep))}</span>` : ''}
            </div>
            <p class="text-[11px] text-slate-300 mt-0.5 truncate">${escHtml(profile.address || '매출·마진 · 💎 커미션 · 배정 재고 · Design-In 샘플 · 견적 · 미수금 · 담당자 연락처 원스톱 뷰')}</p>
          </div>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <button type="button" onclick="document.getElementById('customer360Modal').classList.add('hidden'); document.getElementById('customerMasterModal')?.classList.add('hidden'); window.jumpToShipmentsFiltered && window.jumpToShipmentsFiltered({ query: '${escHtml(customerName).replace(/'/g, "\\'")}', year: '2026' })" class="px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-bold cursor-pointer transition">🚚 출하원장 ↗</button>
          <button type="button" onclick="window.jumpFromCust360ToInventory('${escHtml(customerName).replace(/'/g, "\\'")}')" class="px-2.5 py-1.5 bg-emerald-500/25 hover:bg-emerald-500/40 border border-emerald-400/40 text-emerald-100 rounded-lg text-xs font-bold cursor-pointer transition">📦 재고탭 ↗</button>
          <button type="button" onclick="document.getElementById('customer360Modal').classList.add('hidden')" class="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold flex items-center justify-center cursor-pointer">✕</button>
        </div>
      </div>

      <!-- 4대 핵심 KPI 카드 -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-2.5 p-3 sm:p-4 bg-slate-50 border-b border-slate-200 shrink-0">
        <div class="bg-white border border-violet-200 rounded-xl p-3 shadow-2xs">
          <div class="text-[11px] font-bold text-violet-900 flex items-center justify-between">
            <span>🏆 누적 총수익 (마진+커미션)</span>
            <span class="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded font-black">${avgDomMarginRate}%</span>
          </div>
          <div class="text-base sm:text-lg font-black text-slate-900 font-mono mt-1">₩${Math.round(totalProfitKrw).toLocaleString()}</div>
          <div class="text-[10px] text-slate-600 mt-0.5">마진 <strong class="text-emerald-700">₩${Math.round(totalDomMarginKrw).toLocaleString()}</strong> + 💎 <strong class="text-violet-700">$${totalCommUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div>
        </div>

        <div class="bg-white border border-indigo-200 rounded-xl p-3 shadow-2xs">
          <div class="text-[11px] font-bold text-indigo-900 flex items-center justify-between">
            <span>📈 Domestic 누적 매출</span>
            <span class="text-[10px] text-indigo-600 font-mono">BILLING</span>
          </div>
          <div class="text-base sm:text-lg font-black text-indigo-950 font-mono mt-1">₩${Math.round(totalDomBillingKrw).toLocaleString()}</div>
          <div class="text-[10px] text-slate-500 mt-0.5">국내출하 <strong>${domSales.length}건</strong> · 커미션 <strong>${commShips.length}건</strong></div>
        </div>

        <div class="bg-white border border-emerald-200 rounded-xl p-3 shadow-2xs cursor-pointer hover:border-emerald-400" onclick="window.switchCustomer360Tab('pipeline')">
          <div class="text-[11px] font-bold text-emerald-900 flex items-center justify-between">
            <span>📦 배정재고 · 프로젝트 · 견적</span>
            <span class="text-[10px] text-emerald-700 font-bold">파이프라인 👉</span>
          </div>
          <div class="text-base sm:text-lg font-black text-emerald-950 font-mono mt-1">재고 ${custStocks.length}건 ($${Math.round(totalStockUsd).toLocaleString()})</div>
          <div class="text-[10px] text-emerald-700 mt-0.5">프로젝트 <strong>${sampleProjects.length}건</strong> · 견적 <strong>${quotations.length}건</strong></div>
        </div>

        <div class="bg-white border border-rose-200 rounded-xl p-3 shadow-2xs cursor-pointer hover:border-rose-400" onclick="window.switchCustomer360Tab('contacts')">
          <div class="text-[11px] font-bold text-rose-900 flex items-center justify-between">
            <span>💰 미수 채권 &amp; 담당자(${contacts.length}명)</span>
            <span class="text-[10px] text-rose-600 font-bold">연락처/채권 👉</span>
          </div>
          <div class="text-sm sm:text-base font-black text-rose-700 font-mono mt-1">₩${Math.round(unpaidDomKrw).toLocaleString()} <span class="text-xs text-violet-700">+ 💎$${Math.round(unpaidCommUsd).toLocaleString()}</span></div>
          <div class="text-[10px] text-slate-500 mt-0.5">담당자 <strong>${contacts.length}명</strong> · 포워더 <strong>${forwarders.length}건</strong></div>
        </div>
      </div>

      <!-- 서브탭 & 검색 바 -->
      <div class="px-4 py-2 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div class="flex items-center gap-1 flex-wrap">
          <button type="button" onclick="window.switchCustomer360Tab('biz')" class="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ${tab === 'biz' ? 'bg-indigo-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'}">🚚 매출·마진 &amp; 💎 커미션 (${unifiedBiz.length})</button>
          <button type="button" onclick="window.switchCustomer360Tab('pipeline')" class="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ${tab === 'pipeline' ? 'bg-emerald-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'}">📦 배정재고(${custStocks.length}) · 🧪 샘플(${sampleProjects.length}) · 📄 견적(${quotations.length})</button>
          <button type="button" onclick="window.switchCustomer360Tab('contacts')" class="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ${tab === 'contacts' ? 'bg-teal-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'}">👥 담당자(${contacts.length}) · 🚚 포워더(${forwarders.length}) · 💰 미수(${unpaidDom.length})</button>
        </div>
        <input type="text" id="cust360SearchInput" value="${escHtml(search)}" oninput="window.setCustomer360Search(this.value)" placeholder="품번(PartNo), 제조사, PO, 견적번호 검색..." class="w-full sm:w-64 px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg outline-none focus:bg-white focus:border-indigo-500">
      </div>

      <!-- 본문 영역 -->
      <div class="flex-1 overflow-y-auto p-3 sm:p-4 bg-slate-50/70">
        ${tabBodyHtml}
      </div>
    </div>
  `;
}
