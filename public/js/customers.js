/**
 * customers.js
 * 거래처 및 담당자 마스터 통합 관리 모달 (Supabase legacy_customers CRUD)
 */

let custPage = 1;
const custLimit = 30;
let custQuery = '';
let custTotal = 0;
let custCache = [];
let editingCustId = null;

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function canModifyMaster() {
  return (typeof window.isCsOrAdminUser === 'function') ? window.isCsOrAdminUser() : false;
}

export async function openCustomerMasterModal() {
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
      <!-- 헤더 (모바일 2단 깔끔 정렬 / 데스크톱 1단) -->
      <div class="bg-gradient-to-r from-teal-700 to-emerald-700 text-white px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
        <div class="flex items-start sm:items-center justify-between gap-2 w-full sm:w-auto">
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-xl shrink-0">🏢</span>
            <div class="min-w-0">
              <h3 class="text-sm sm:text-base font-black tracking-tight truncate">거래처·담당자 마스터 관리</h3>
              <p class="text-[10px] sm:text-[11px] text-teal-100 leading-snug">거래처 조회·등록·수정·삭제 (자동완성 실시간 반영)</p>
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

      <!-- 신규/수정 입력 패널 (기본 접힘) -->
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
          <button type="button" id="btnSearchCustMaster" class="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-lg cursor-pointer">🔍 검색</button>
        </div>
        <div id="custMasterCountBadge" class="text-xs font-bold text-slate-600">로딩 중...</div>
      </div>

      <!-- 목록 영역 (모바일 카드 뷰 + 데스크톱 테이블 뷰) -->
      <div id="custMasterTableWrap" class="flex-1 overflow-y-auto bg-slate-50/60 md:bg-white">
        <!-- 모바일 전용 카드 뷰 -->
        <div id="custMasterMobileCards" class="block md:hidden p-3 space-y-2.5">
          <div class="py-10 text-center text-slate-400 text-xs">⏳ 거래처 마스터를 불러오는 중...</div>
        </div>
        <!-- 데스크톱 전용 테이블 뷰 -->
        <table class="hidden md:table w-full text-left text-xs border-collapse">
          <thead class="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 sticky top-0 z-10 text-[11px]">
            <tr>
              <th class="py-2.5 px-3 w-16 text-center">CID</th>
              <th class="py-2.5 px-3 min-w-[180px]">거래처명 (국문 / 영문)</th>
              <th class="py-2.5 px-3 w-24 text-center">영업담당</th>
              <th class="py-2.5 px-3 min-w-[130px]">담당자</th>
              <th class="py-2.5 px-3 min-w-[140px]">연락처 / 이메일</th>
              <th class="py-2.5 px-3 min-w-[180px]">주소</th>
              <th class="py-2.5 px-3 w-28 text-center">관리</th>
            </tr>
          </thead>
          <tbody id="custMasterTbody" class="divide-y divide-slate-100 bg-white">
            <tr><td colspan="7" class="py-10 text-center text-slate-400">⏳ 거래처 마스터를 불러오는 중...</td></tr>
          </tbody>
        </table>
      </div>

      <!-- 페이지네이션 -->
      <div id="custMasterPagination" class="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs shrink-0"></div>
    </div>
  `;

  modal.classList.remove('hidden');
  bindCustomerModalEvents();
  await loadCustomersPage(1);
}

function bindCustomerModalEvents() {
  const inp = document.getElementById('custMasterSearchInput');
  const btnSearch = document.getElementById('btnSearchCustMaster');
  const btnNew = document.getElementById('btnOpenNewCustomerForm');
  const btnCancel1 = document.getElementById('btnCancelCustomerEdit');
  const btnCancel2 = document.getElementById('btnCancelCustomerEdit2');
  const btnSave = document.getElementById('btnSaveCustomerMaster');

  btnSearch?.addEventListener('click', () => {
    custQuery = inp?.value.trim() || '';
    loadCustomersPage(1);
  });
  inp?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      custQuery = inp.value.trim();
      loadCustomersPage(1);
    }
  });

  btnNew?.addEventListener('click', () => openCustomerEditor(null));
  const closeEditor = () => {
    editingCustId = null;
    document.getElementById('customerEditorPanel')?.classList.add('hidden');
  };
  btnCancel1?.addEventListener('click', closeEditor);
  btnCancel2?.addEventListener('click', closeEditor);
  btnSave?.addEventListener('click', saveCustomerForm);
}

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
  const tbody = document.getElementById('custMasterTbody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-10 text-center text-slate-400">⏳ 조회 중...</td></tr>`;
  }

  try {
    const params = new URLSearchParams({ page: String(custPage), limit: String(custLimit) });
    if (custQuery) params.set('q', custQuery);
    const res = await fetch(`/api/customers?${params.toString()}`);
    const data = await res.json();
    if (data.status !== 'success') throw new Error(data.detail || '조회 실패');

    custTotal = data.total || 0;
    custCache = data.customers || [];

    const badge = document.getElementById('custMasterCountBadge');
    if (badge) badge.innerText = `총 ${custTotal.toLocaleString()}개 거래처`;

    renderCustomersTable();
    renderCustomersPagination();

    const wrap = document.getElementById('custMasterTableWrap');
    if (wrap) wrap.scrollTop = 0;
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="py-10 text-center text-rose-500 font-bold">조회 오류: ${escHtml(err.message)}</td></tr>`;
  }
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
      return `
        <div class="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs space-y-2 text-xs">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">#${c.cid || '-'}</span>
                ${isWeb ? '<span class="text-[9px] font-black text-teal-700 bg-teal-100 rounded px-1.5 py-0.5">WEB</span>' : ''}
                ${c.sales_rep ? `<span class="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">${escHtml(c.sales_rep)}</span>` : ''}
              </div>
              <div class="font-black text-sm text-slate-900 mt-1 break-words">${escHtml(c.kname || c.cname || '-')}</div>
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
            <div><span class="text-[9px] text-slate-400 block font-semibold">담당자</span><span class="font-bold text-slate-800">${escHtml(contactStr || '-')}</span></div>
            <div><span class="text-[9px] text-slate-400 block font-semibold">연락처</span><span class="font-mono text-slate-700">${escHtml(c.tel || c.contact_mobile || '-')}</span></div>
            ${c.email || c.contact_email ? `<div class="col-span-2 truncate"><span class="text-[9px] text-slate-400 mr-1 font-semibold">이메일:</span><span class="font-mono text-slate-600">${escHtml(c.email || c.contact_email)}</span></div>` : ''}
            ${c.address ? `<div class="col-span-2 text-[10px] text-slate-500 leading-snug">📍 ${escHtml(c.address)}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  if (!tbody) return;
  tbody.innerHTML = custCache.map((c, idx) => {
    const isWeb = Number(c.cid) >= 900000;
    const contactStr = [c.contact_name, c.contact_title].filter(Boolean).join(' ');
    return `
      <tr class="hover:bg-teal-50/50 transition-colors">
        <td class="py-2 px-3 text-center font-mono text-[11px] text-slate-500">
          ${c.cid || '-'}
          ${isWeb ? '<span class="block text-[9px] font-black text-teal-700 bg-teal-100 rounded px-1 mt-0.5">WEB</span>' : ''}
        </td>
        <td class="py-2 px-3">
          <div class="font-black text-slate-900">${escHtml(c.kname || c.cname || '-')}</div>
          ${c.cname && c.cname !== c.kname ? `<div class="text-[10px] text-slate-400">${escHtml(c.cname)}</div>` : ''}
        </td>
        <td class="py-2 px-3 text-center">
          ${c.sales_rep ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">${escHtml(c.sales_rep)}</span>` : '<span class="text-slate-300">-</span>'}
        </td>
        <td class="py-2 px-3 text-slate-800 font-medium">${escHtml(contactStr || '-')}</td>
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

window.openCustomerMasterModal = openCustomerMasterModal;
window.goToCustomerPage = loadCustomersPage;
window.editCustomerMasterByIdx = (idx) => {
  if (custCache[idx]) openCustomerEditor(custCache[idx]);
};
window.deleteCustomerMasterByIdx = (idx) => {
  const c = custCache[idx];
  if (c) deleteCustomerMaster(c.id || c.cid, c.kname || c.cname || '거래처');
};
