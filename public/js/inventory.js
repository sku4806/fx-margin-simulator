import { sbClient } from './supabase.js';

let cachedItems = [];

export async function fetchInventoryItems() {
  if (!sbClient) return [];
  const { data, error } = await sbClient
    .from('inventory_items')
    .select('*')
    .order('entry_date', { ascending: false });

  if (error) throw error;

  cachedItems = (data || []).map(item => ({
    id: item.id,
    maker: item.maker || '-',
    partName: item.part_name || '-',
    dateCode: item.date_code || '-',
    stock: parseInt(item.stock) || 0,
    arrangedQty: parseInt(item.arranged_qty) || 0,
    spq: parseInt(item.spq) || null,
    unitUsd: parseFloat(item.unit_usd) || 0,
    shipFx: parseFloat(item.ship_fx) || 1350,
    soldPriceUsd: parseFloat(item.sold_price_usd) || 0,
    entryDate: item.entry_date || '-',
    owner: item.owner || '본사 일반재고',
    customer: (item.customer && !/bigshine/i.test(item.customer)) ? item.customer : '-' || '-',
    realCustomer: item.real_customer || '-',
    poNo: item.po_no || '',
    application: item.application || '',
    bizType: item.biz_type || 'DOMESTIC',
    orderStatus: item.order_status || '배정요청',
    paymentTerms: item.payment_terms || 'Net 30',
    currency: item.currency || 'USD',
    invoiceNo: item.invoice_no || '',
    taxDate: item.tax_date || '',
    trackingNo: item.tracking_no || '',
    paymentStatus: item.payment_status || '미수',
    dueDate: item.due_date || '',
    shippedDate: item.shipped_date || '',
    settledDate: item.settled_date || '',
    settledFx: parseFloat(item.settled_fx) || null,
    margin: parseFloat(item.margin) || 20,
    isSpa: item.is_spa || false,
    approvedDebitUsd: parseFloat(item.approved_debit_usd) || 0,
    memo: item.memo || ''
  }));

  return cachedItems;
}

export function getCachedItem(id) {
  return cachedItems.find(item => String(item.id) === String(id));
}

export function filterItems({ query = '', filterMaker = '', filterOwner = '', filterPayment = '' }) {
  const q = query.toLowerCase().trim();
  return cachedItems.filter(item => {
    const matchQuery = !q ||
      item.partName.toLowerCase().includes(q) ||
      item.maker.toLowerCase().includes(q) ||
      (item.customer && !/bigshine/i.test(item.customer)) ? item.customer : '-'.toLowerCase().includes(q) ||
      item.realCustomer.toLowerCase().includes(q) ||
      item.poNo.toLowerCase().includes(q) ||
      item.application.toLowerCase().includes(q) ||
      item.owner.toLowerCase().includes(q) ||
      item.dateCode.toLowerCase().includes(q) ||
      item.trackingNo.toLowerCase().includes(q) ||
      item.invoiceNo.toLowerCase().includes(q);

    const matchMaker = !filterMaker || item.maker === filterMaker;
    const matchOwner = !filterOwner || item.owner === filterOwner;
    const matchPayment = !filterPayment || item.paymentStatus === filterPayment;

    return matchQuery && matchMaker && matchOwner && matchPayment;
  });
}

export async function upsertInventoryItem(payload, editingItemId = null) {
  if (!sbClient) throw new Error("클라이언트 미연결");

  if (editingItemId) {
    const { data, error } = await sbClient
      .from('inventory_items')
      .update(payload)
      .eq('id', editingItemId)
      .select();
    if (error) throw error;
    return data && data[0] ? data[0] : { id: editingItemId, ...payload };
  } else {
    const { data, error } = await sbClient
      .from('inventory_items')
      .insert([payload])
      .select();
    if (error) throw error;
    return data && data[0] ? data[0] : payload;
  }
}

export async function splitInventoryShipment(targetId, splitQty, soldPriceUsd, customer, owner, deadStockAction) {
  if (!sbClient) throw new Error("클라이언트 미연결");
  const orig = getCachedItem(targetId);
  if (!orig) throw new Error("분할 대상을 찾을 수 없습니다.");
  if (splitQty >= orig.stock) throw new Error("분할 수량은 전체 보유 재고보다 작아야 합니다.");

  const remainQty = orig.stock - splitQty;
  const remainOwner = (deadStockAction === 'hq') ? '본사 일반재고' : orig.owner;
  const remainMemo = (deadStockAction === 'hq') 
    ? (orig.memo ? `${orig.memo} [본사 이관 잔여재고]` : '[본사 이관 잔여재고]')
    : orig.memo;

  const { error: updErr } = await sbClient
    .from('inventory_items')
    .update({
      stock: remainQty,
      owner: remainOwner,
      memo: remainMemo
    })
    .eq('id', targetId);

  if (updErr) throw updErr;

  const { error: insErr } = await sbClient
    .from('inventory_items')
    .insert([{
      maker: orig.maker,
      part_name: orig.partName,
      date_code: orig.dateCode,
      stock: splitQty,
      arranged_qty: 0,
      spq: orig.spq,
      unit_usd: orig.unitUsd,
      ship_fx: orig.shipFx,
      sold_price_usd: soldPriceUsd,
      entry_date: orig.entryDate,
      owner: owner || orig.owner,
      customer: customer || orig.customer,
      real_customer: orig.realCustomer,
      po_no: orig.poNo,
      application: orig.application,
      biz_type: orig.bizType,
      order_status: '출하준비',
      payment_terms: orig.paymentTerms,
      currency: orig.currency,
      invoice_no: '',
      tax_date: null,
      tracking_no: '',
      payment_status: '미수',
      margin: orig.margin,
      is_spa: orig.isSpa,
      approved_debit_usd: orig.approvedDebitUsd,
      memo: `[부분 출하 분할] 원 건 #${orig.id}에서 ${splitQty}EA 분할`
    }]);

  if (insErr) throw insErr;
}

export async function deleteInventoryItem(id) {
  if (!sbClient) throw new Error("클라이언트 미연결");
  const { error } = await sbClient
    .from('inventory_items')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export function renderInventoryUI(items, activeTab, onEdit, onDelete, onSplit, canEdit) {
  const countEl = document.getElementById('itemCount');
  if (countEl) countEl.innerText = `총 ${items.length.toLocaleString()}건`;

  renderDesktopTable(items, activeTab, onEdit, onDelete, onSplit, canEdit);
  renderMobileCards(items, activeTab, onEdit, onDelete, onSplit, canEdit);
}

function renderDesktopTable(items, activeTab, onEdit, onDelete, onSplit, canEdit) {
  const thead = document.getElementById('inventoryTableHeader');
  const tbody = document.getElementById('inventoryTableBody');
  if (!thead || !tbody) return;

  if (activeTab === 'sales') {
    thead.innerHTML = `
      <tr>
        <th class="py-2.5 px-2">상태</th>
        <th class="py-2.5 px-2">라인 / Part No</th>
        <th class="py-2.5 px-2">D/C / PO</th>
        <th class="py-2.5 px-2">수량(SPQ)</th>
        <th class="py-2.5 px-2">선적원가(USD/KRW)</th>
        <th class="py-2.5 px-2">협의실판매가</th>
        <th class="py-2.5 px-2">계약처 / 실납품처</th>
        <th class="py-2.5 px-2">적용처 / Sales</th>
        <th class="py-2.5 px-2 text-right">관리</th>
      </tr>
    `;
  } else {
    thead.innerHTML = `
      <tr>
        <th class="py-2.5 px-2">상태</th>
        <th class="py-2.5 px-2">계약처 / 실고객사</th>
        <th class="py-2.5 px-2">Part No / 구분</th>
        <th class="py-2.5 px-2">수량</th>
        <th class="py-2.5 px-2">실판매단가</th>
        <th class="py-2.5 px-2">출하일 / 계산서일</th>
        <th class="py-2.5 px-2">인보이스 / B/L</th>
        <th class="py-2.5 px-2">수금/환차손익</th>
        <th class="py-2.5 px-2">만기일정</th>
        <th class="py-2.5 px-2 text-right">관리</th>
      </tr>
    `;
  }

  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="py-8 text-center text-slate-400">조회된 데이터가 없습니다.</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map(item => {
    const costKrw = Math.round(item.unitUsd * item.shipFx);

    if (activeTab === 'sales') {
      return `
        <tr class="hover:bg-indigo-50/40 cursor-pointer transition-colors border-b border-slate-100" data-row-id="${item.id}">
          <td class="py-2.5 px-2">
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full ${getStatusBadgeClass(item.orderStatus)}">${item.orderStatus}</span>
          </td>
          <td class="py-2.5 px-2">
            <div class="text-[10px] font-bold text-slate-400">${item.maker}</div>
            <div class="font-bold text-slate-900">${item.partName}</div>
          </td>
          <td class="py-2.5 px-2 font-mono text-[11px] font-semibold text-slate-600">
            <div>D/C: ${item.dateCode}</div>
            ${item.poNo ? `<div class="text-[9px] text-indigo-700 font-bold">PO: ${item.poNo}</div>` : ''}
          </td>
          <td class="py-2.5 px-2">
            <span class="font-black text-slate-900">${item.stock.toLocaleString()} EA</span>
            ${item.spq ? `<div class="text-[9px] text-slate-400 font-semibold">SPQ: ${item.spq.toLocaleString()}</div>` : ''}
          </td>
          <td class="py-2.5 px-2 text-[11px]">
            <div class="font-bold text-slate-800">$${item.unitUsd.toFixed(3)}</div>
            <div class="text-[10px] text-slate-500 font-medium">(₩${costKrw.toLocaleString()})</div>
          </td>
          <td class="py-2.5 px-2 text-[11px]">
            ${item.soldPriceUsd > 0 ? `<div class="font-black text-indigo-700">$${item.soldPriceUsd.toFixed(3)}</div>` : '<span class="text-slate-400">-</span>'}
          </td>
          <td class="py-2.5 px-2 text-xs">
            <div class="font-bold text-slate-900">${(item.customer && !/bigshine/i.test(item.customer)) ? item.customer : '-'}</div>
            ${item.realCustomer !== '-' && item.realCustomer !== (item.customer && !/bigshine/i.test(item.customer)) ? item.customer : '-' ? `<div class="text-[10px] text-indigo-700 font-semibold">↳ 실고객: ${item.realCustomer}</div>` : ''}
          </td>
          <td class="py-2.5 px-2 text-xs">
            <div class="font-semibold text-slate-700">${item.owner}</div>
            ${item.application ? `<div class="text-[9px] text-slate-400 font-medium">${item.application}</div>` : ''}
          </td>
          <td class="py-2.5 px-2 text-right align-middle" onclick="event.stopPropagation()">
            ${canEdit ? `
              <div class="inline-flex items-center gap-1">
                <button class="split-btn text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-2 py-1 rounded whitespace-nowrap border border-slate-200 transition-colors" data-id="${item.id}">분할</button>
                <button class="delete-btn text-[10px] bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold px-1.5 py-1 rounded whitespace-nowrap border border-rose-200 transition-colors" data-id="${item.id}">삭제</button>
              </div>
            ` : '-'}
          </td>
        </tr>
      `;
    } else {
      return `
        <tr class="hover:bg-indigo-50/40 cursor-pointer transition-colors border-b border-slate-100" data-row-id="${item.id}">
          <td class="py-2.5 px-2">
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full ${getStatusBadgeClass(item.orderStatus)}">${item.orderStatus}</span>
          </td>
          <td class="py-2.5 px-2 font-bold text-slate-900">
            <div>${(item.customer && !/bigshine/i.test(item.customer)) ? item.customer : '-'}</div>
            ${item.realCustomer !== '-' && item.realCustomer !== (item.customer && !/bigshine/i.test(item.customer)) ? item.customer : '-' ? `<div class="text-[10px] text-indigo-700 font-normal">↳ ${item.realCustomer}</div>` : ''}
          </td>
          <td class="py-2.5 px-2">
            <div class="font-bold text-indigo-950">${item.partName}</div>
            <div class="text-[9px] text-slate-400 font-semibold">${item.maker} · <span class="text-indigo-600">${item.bizType}</span></div>
          </td>
          <td class="py-2.5 px-2 font-bold text-slate-900">${item.stock.toLocaleString()} EA</td>
          <td class="py-2.5 px-2 font-black text-indigo-700">$${item.soldPriceUsd > 0 ? item.soldPriceUsd.toFixed(3) : '-'}</td>
          <td class="py-2.5 px-2 text-[10px] text-slate-600">
            <div>출하: ${item.shippedDate || '미출하'}</div>
            <div class="text-indigo-900 font-semibold">계산서: ${item.taxDate || '-'}</div>
          </td>
          <td class="py-2.5 px-2 text-[10px] text-slate-600 align-middle">
            <div class="font-mono text-slate-500 truncate max-w-[130px]">INV: ${item.invoiceNo || '-'}</div>
            <div class="mt-1 flex items-center justify-between gap-1 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 max-w-[155px]">
              <span class="font-mono font-bold text-slate-800 truncate" title="${item.trackingNo || ''}">
                ${item.trackingNo ? item.trackingNo : '<span class="text-slate-400 font-normal">B/L 미등록</span>'}
              </span>
              <button type="button" class="tracking-btn shrink-0 text-[10px] bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded border border-indigo-200 transition-colors" data-tracking="${item.trackingNo || ''}">
                🚚 조회
              </button>
            </div>
          </td>
          <td class="py-2.5 px-2 align-middle">
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${item.paymentStatus === '완료' ? 'bg-green-100 text-green-800' : 'bg-rose-100 text-rose-800'}">${item.paymentStatus}</span>
          </td>
          <td class="py-2.5 px-2 text-[10px] text-slate-600 whitespace-nowrap align-middle">${item.dueDate || '-'}</td>
          <td class="py-2.5 px-2 text-right align-middle" onclick="event.stopPropagation()">
            ${canEdit ? `
              <div class="inline-flex items-center gap-1">
                <button class="split-btn text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-2 py-1 rounded whitespace-nowrap border border-slate-200 transition-colors" data-id="${item.id}">분할</button>
                <button class="delete-btn text-[10px] bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold px-1.5 py-1 rounded whitespace-nowrap border border-rose-200 transition-colors" data-id="${item.id}">삭제</button>
              </div>
            ` : '-'}
          </td>
        </tr>
      `;
    }
  }).join('');

  bindRowActions(tbody, onEdit, onDelete, onSplit);
}

function renderMobileCards(items, activeTab, onEdit, onDelete, onSplit, canEdit) {
  const container = document.getElementById('inventoryCardContainer');
  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = `<div class="p-6 text-center text-xs text-slate-400 bg-white rounded-xl border border-slate-200">조회된 데이터가 없습니다.</div>`;
    return;
  }

  container.innerHTML = items.map(item => {
    const costKrw = Math.round(item.unitUsd * item.shipFx);
    return `
      <div class="p-3.5 bg-white rounded-xl border border-slate-200 shadow-sm space-y-2 cursor-pointer" data-card-id="${item.id}">
        <div class="flex justify-between items-start">
          <div>
            <span class="text-[9px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">${item.maker}</span>
            <span class="text-[10px] font-mono font-bold text-slate-500 ml-1">D/C: ${item.dateCode}</span>
            ${item.poNo ? `<span class="text-[9px] text-indigo-700 font-bold ml-1">PO: ${item.poNo}</span>` : ''}
            <div class="font-black text-sm text-slate-900 mt-0.5">${item.partName}</div>
          </div>
          <span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full ${getStatusBadgeClass(item.orderStatus)}">${item.orderStatus}</span>
        </div>

        <div class="grid grid-cols-2 gap-2 text-xs border-y py-2 border-slate-100">
          <div>
            <span class="text-[10px] text-slate-400 block font-semibold">계약처 / 실납품처</span>
            <div class="font-bold text-slate-800">${(item.customer && !/bigshine/i.test(item.customer)) ? item.customer : '-'}</div>
            ${item.realCustomer !== '-' && item.realCustomer !== (item.customer && !/bigshine/i.test(item.customer)) ? item.customer : '-' ? `<div class="text-[10px] text-indigo-700 font-semibold">↳ ${item.realCustomer}</div>` : ''}
          </div>
          <div>
            <span class="text-[10px] text-slate-400 block font-semibold">담당 Sales / 적용처</span>
            <div class="font-semibold text-slate-700">${item.owner}</div>
            ${item.application ? `<div class="text-[9px] text-slate-400">${item.application}</div>` : ''}
          </div>
          <div>
            <span class="text-[10px] text-slate-400 block font-semibold">선적 매입가</span>
            <div class="font-bold text-slate-800">₩${costKrw.toLocaleString()} <span class="text-[10px] text-slate-500 font-normal">($${item.unitUsd.toFixed(3)})</span></div>
          </div>
          <div>
            <span class="text-[10px] text-slate-400 block font-semibold">협의 판매가</span>
            <div class="font-black text-indigo-700">${item.soldPriceUsd > 0 ? `$${item.soldPriceUsd.toFixed(3)}` : '-'}</div>
          </div>
          <div>
            <span class="text-[10px] text-slate-400 block font-semibold">수량</span>
            <div class="font-black text-slate-900">${item.stock.toLocaleString()} EA ${item.spq ? `<span class="text-[9px] text-slate-400 font-semibold">(SPQ: ${item.spq.toLocaleString()})</span>` : ''}</div>
          </div>
          <div class="text-right text-[10px] text-slate-500 space-y-1">
            <div>출하: ${item.shippedDate || '미출하'}</div>
            <div>계산서: ${item.taxDate || '-'}</div>
            <div class="flex items-center justify-end gap-1 mt-1" onclick="event.stopPropagation()">
              <span class="text-[10px] font-mono text-slate-600 truncate max-w-[90px]">B/L: ${item.trackingNo || '-'}</span>
              <button type="button" class="tracking-btn text-[10px] bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded border border-indigo-200 shrink-0" data-tracking="${item.trackingNo || ''}">🚚 조회</button>
            </div>
          </div>
        </div>

        <div class="flex justify-between items-center pt-0.5 text-xs">
          <span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${item.paymentStatus === '완료' ? 'bg-green-100 text-green-800' : 'bg-rose-100 text-rose-800'}">수금: ${item.paymentStatus}</span>
          ${canEdit ? `
            <div class="space-x-1" onclick="event.stopPropagation()">
              <button class="split-btn text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-2 py-1 rounded" data-id="${item.id}">출하분할</button>
              <button class="delete-btn text-[10px] bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold px-1.5 py-1 rounded" data-id="${item.id}">삭제</button>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-card-id]').forEach(card => {
    card.onclick = () => onEdit(card.dataset.cardId);
  });
  container.querySelectorAll('.delete-btn').forEach(btn => {
    btn.onclick = () => onDelete(btn.dataset.id);
  });
  container.querySelectorAll('.split-btn').forEach(btn => {
    btn.onclick = () => onSplit(btn.dataset.id);
  });
}

function bindRowActions(tbody, onEdit, onDelete, onSplit) {
  tbody.querySelectorAll('[data-row-id]').forEach(row => {
    row.onclick = () => onEdit(row.dataset.rowId);
  });
  tbody.querySelectorAll('.delete-btn').forEach(btn => {
    btn.onclick = () => onDelete(btn.dataset.id);
  });
  tbody.querySelectorAll('.split-btn').forEach(btn => {
    btn.onclick = () => onSplit(btn.dataset.id);
  });
}

function getStatusBadgeClass(status) {
  switch (status) {
    case '배정요청': return 'bg-amber-100 text-amber-800';
    case '출하준비': return 'bg-blue-100 text-blue-800';
    case '출하완료': return 'bg-indigo-100 text-indigo-800';
    case '정산마감': return 'bg-emerald-100 text-emerald-800';
    case '출하보류': return 'bg-red-100 text-red-800';
    case '무상지원': return 'bg-purple-100 text-purple-800';
    default: return 'bg-slate-100 text-slate-700';
  }
}
