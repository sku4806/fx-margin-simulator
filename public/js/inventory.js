
function generateLegacyMasterRow(item) {
  const stock = Number(item.stock) || 0;
  const unitUsd = Number(item.unitUsd ?? item.unit_usd) || 0;
  const amount = stock * unitUsd;

  // 배정량 산출: 출하 완료가 아닌 배정/진행 건
  const isAssigned = (item.orderStatus === '배정완료' || item.orderStatus === '배정요청' || item.customer !== '-');
  const arrangedQty = isAssigned ? (Number(item.arrangedQty) || stock) : 0;
  const notArranQty = Math.max(0, stock - arrangedQty);

  const kind = item.bizType || item.biz_type || '외자입고';
  const cname = item.customer || '-';
  const sales = item.owner || 'BSK';
  const part = item.partName || item.part_name || '-';
  const entryDate = item.entryDate || item.entry_date || '-';
  const mfg = item.maker || '-';
  const pono = item.poNo || item.po_no || '-';

  return `
    <tr class="hover:bg-indigo-50/60 transition-colors border-b border-slate-100 text-[11px] cursor-pointer" onclick="window.loadFormFromItem && window.loadFormFromItem('${item.id}')">
      <td class="py-2 px-2 text-center">
        <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold ${kind.includes('내자') ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}">
          ${kind}
        </span>
      </td>
      <td class="py-2 px-2 font-bold text-slate-800 truncate max-w-[130px]" title="${cname}">
        ${cname}
      </td>
      <td class="py-2 px-2 text-center font-bold text-indigo-700">${sales}</td>
      <td class="py-2 px-2 font-bold text-slate-900">${part}</td>
      <td class="py-2 px-2 text-right font-black text-slate-900">${stock.toLocaleString()}</td>
      <td class="py-2 px-2 text-right text-slate-600 font-semibold">$${unitUsd.toFixed(unitUsd >= 10 ? 2 : 3)}</td>
      <td class="py-2 px-2 text-right font-bold text-rose-600">$${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 })}</td>
      <td class="py-2 px-2 text-right font-bold text-amber-700">${arrangedQty.toLocaleString()}</td>
      <td class="py-2 px-2 text-right font-bold text-emerald-700">${notArranQty.toLocaleString()}</td>
      <td class="py-2 px-2 text-center text-slate-500 font-mono text-[10px]">${entryDate}</td>
      <td class="py-2 px-2 text-center font-semibold text-slate-600">${mfg}</td>
      <td class="py-2 px-2 text-slate-500 font-mono text-[10px] truncate max-w-[90px]" title="${pono}">${pono}</td>
      <td class="py-1 px-2 text-center select-none" onclick="event.stopPropagation()">
        <div class="inline-flex items-center gap-1">
          <button type="button" onclick="window.loadFormFromItem && window.loadFormFromItem('${item.id}')" class="px-1.5 py-0.5 bg-slate-100 hover:bg-indigo-100 text-slate-700 hover:text-indigo-900 rounded border border-slate-300 text-[10px] font-bold transition-all">수정</button>
          <button type="button" onclick="window.handleOpenSplitModal && window.handleOpenSplitModal('${item.id}')" class="px-1.5 py-0.5 bg-white hover:bg-amber-50 text-amber-800 rounded border border-amber-300 text-[10px] font-bold transition-all">분할</button>
          <button type="button" onclick="window.handleDeleteItem && window.handleDeleteItem('${item.id}')" class="px-1.5 py-0.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded border border-rose-200 text-[10px] font-bold transition-all">삭제</button>
        </div>
      </td>
    </tr>
  `;
}


function updateGrandSummaries(items) {
  let totalStock = 0;
  let totalArranged = 0;
  let totalAvailable = 0;
  let totalAmount = 0;

  items.forEach(it => {
    const stock = it.stock || 0;
    const arranged = it.arrangedQty || (it.orderStatus === '배정요청' || it.orderStatus === '출하준비' ? stock : 0);
    const available = Math.max(0, stock - (it.orderStatus === '정산마감' || it.orderStatus === '출하완료' ? 0 : arranged));
    const unitUsd = it.unitUsd || 0;

    totalStock += stock;
    totalArranged += arranged;
    totalAvailable += available;
    totalAmount += (unitUsd * stock);
  });

  const elCount = document.getElementById('summaryCount');
  const elStock = document.getElementById('sumTotalStock');
  const elArranged = document.getElementById('sumArrangedStock');
  const elAvailable = document.getElementById('sumAvailableStock');
  const elAmount = document.getElementById('sumTotalAmount');

  if (elCount) elCount.innerText = `(${items.length.toLocaleString()}건)`;
  if (elStock) elStock.innerText = totalStock.toLocaleString();
  if (elArranged) elArranged.innerText = totalArranged.toLocaleString();
  if (elAvailable) elAvailable.innerText = totalAvailable.toLocaleString();
  if (elAmount) elAmount.innerText = '$' + totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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
      ((item.customer && !/bigshine/i.test(item.customer)) ? item.customer : '-').toLowerCase().includes(q) ||
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
  updateGrandSummaries(items);

  renderDesktopTable(items, activeTab, onEdit, onDelete, onSplit, canEdit);
  renderMobileCards(items, activeTab, onEdit, onDelete, onSplit, canEdit);
}

function renderDesktopTable(items, activeTab, onEdit, onDelete, onSplit, canEdit) {
  const thead = document.getElementById('inventoryTableHeader');
  const tbody = document.getElementById('inventoryTableBody');
  if (!thead || !tbody) return;

  renderInventoryHeaders(activeTab);

  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${activeTab === 'sales' ? 13 : 10}" class="py-8 text-center text-slate-400">조회된 데이터가 없습니다.</td></tr>`;
    return;
  }

      if (activeTab === 'sales') {
        tbody.innerHTML = items.map(item => generateLegacyMasterRow(item)).join('');
      } else {
        tbody.innerHTML = items.map(item => {
          return `
        <tr class="hover:bg-indigo-50/40 cursor-pointer transition-colors border-b border-slate-100" data-row-id="${item.id}">
          <td class="py-2.5 px-2">
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full ${getStatusBadgeClass(item.orderStatus)}">${item.orderStatus}</span>
          </td>
          <td class="py-2.5 px-2 font-bold text-slate-900">
            <div>${(item.customer && !/bigshine/i.test(item.customer)) ? item.customer : '-'}</div>
            ${(item.realCustomer && item.realCustomer !== '-' && item.realCustomer !== item.customer) ? `<div class="text-[10px] text-indigo-700 font-normal">↳ ${item.realCustomer}</div>` : ''}
          </td>
          <td class="py-2.5 px-2">
            <div class="font-bold text-indigo-950">${item.partName}</div>
            <div class="text-[9px] text-slate-400 font-semibold">${item.maker} · <span class="text-indigo-600">${item.bizType}</span></div>
          </td>
          <td class="py-2.5 px-2 font-bold text-slate-900">${item.stock.toLocaleString()} EA</td>
          <td class="py-2.5 px-2 font-black text-indigo-700">$${item.soldPriceUsd > 0 ? (Number(item.soldPriceUsd) || 0).toFixed(3) : '-'}</td>
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
}).join('');

bindRowActions(tbody, onEdit, onDelete, onSplit);
  }
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
            ${(item.realCustomer && item.realCustomer !== '-' && item.realCustomer !== item.customer) ? `<div class="text-[10px] text-indigo-700 font-semibold">↳ ${item.realCustomer}</div>` : ''}
          </div>
          <div>
            <span class="text-[10px] text-slate-400 block font-semibold">담당 Sales / 적용처</span>
            <div class="font-semibold text-slate-700">${item.owner}</div>
            ${item.application ? `<div class="text-[9px] text-slate-400">${item.application}</div>` : ''}
          </div>
          <div>
            <span class="text-[10px] text-slate-400 block font-semibold">선적 매입가</span>
            <div class="font-bold text-slate-800">₩${costKrw.toLocaleString()} <span class="text-[10px] text-slate-500 font-normal">($${(Number(item.unitUsd) || 0).toFixed(3)})</span></div>
          </div>
          <div>
            <span class="text-[10px] text-slate-400 block font-semibold">협의 판매가</span>
            <div class="font-black text-indigo-700">${item.soldPriceUsd > 0 ? `$${(Number(item.soldPriceUsd) || 0).toFixed(3)}` : '-'}</div>
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

  const editHandler = (typeof onEdit === 'function') ? onEdit : window.loadFormFromItem;
  const deleteHandler = (typeof onDelete === 'function') ? onDelete : window.handleDeleteItem;
  const splitHandler = (typeof onSplit === 'function') ? onSplit : window.handleOpenSplitModal;

  container.querySelectorAll('[data-card-id]').forEach(card => {
    card.onclick = () => {
      if (typeof editHandler === 'function') editHandler(card.dataset.cardId);
    };
  });
  container.querySelectorAll('.delete-btn').forEach(btn => {
    btn.onclick = () => {
      if (typeof deleteHandler === 'function') deleteHandler(btn.dataset.id);
    };
  });
  container.querySelectorAll('.split-btn').forEach(btn => {
    btn.onclick = () => {
      if (typeof splitHandler === 'function') splitHandler(btn.dataset.id);
    };
  });
}

function bindRowActions(tbody, onEdit, onDelete, onSplit) {
  const editHandler = (typeof onEdit === 'function') ? onEdit : window.loadFormFromItem;
  const deleteHandler = (typeof onDelete === 'function') ? onDelete : window.handleDeleteItem;
  const splitHandler = (typeof onSplit === 'function') ? onSplit : window.handleOpenSplitModal;

  tbody.querySelectorAll('[data-row-id]').forEach(row => {
    row.onclick = () => {
      if (typeof editHandler === 'function') editHandler(row.dataset.rowId);
    };
  });
  tbody.querySelectorAll('.delete-btn').forEach(btn => {
    btn.onclick = () => {
      if (typeof deleteHandler === 'function') deleteHandler(btn.dataset.id);
    };
  });
  tbody.querySelectorAll('.split-btn').forEach(btn => {
    btn.onclick = () => {
      if (typeof splitHandler === 'function') splitHandler(btn.dataset.id);
    };
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

export const renderInventoryList = renderInventoryUI;

export function renderInventoryHeaders(activeTab) {
  const thead = document.getElementById('inventoryTableHeader');
  if (!thead) return;

  if (activeTab === 'sales') {
    thead.innerHTML = `
      <tr class="bg-slate-100/90 text-slate-700 text-[11px] font-bold border-b border-slate-200 uppercase tracking-tight">
        <th class="py-2.5 px-2 text-center w-16">KIND</th>
        <th class="py-2.5 px-2 text-left min-w-[120px]">CNAME</th>
        <th class="py-2.5 px-2 text-center w-16">SALES</th>
        <th class="py-2.5 px-2 text-left min-w-[160px]">PART#</th>
        <th class="py-2.5 px-2 text-right font-black w-20">재고량</th>
        <th class="py-2.5 px-2 text-right w-20">원가</th>
        <th class="py-2.5 px-2 text-right text-rose-700 font-bold w-24">AMOUNT</th>
        <th class="py-2.5 px-2 text-right text-amber-700 font-bold w-20">ARRANGED_</th>
        <th class="py-2.5 px-2 text-right text-emerald-700 font-bold w-20">NOT_ARRAN</th>
        <th class="py-2.5 px-2 text-center w-24">입고일</th>
        <th class="py-2.5 px-2 text-center w-20">MFG</th>
        <th class="py-2.5 px-2 text-left w-24">PONO</th>
        <th class="py-2.5 px-2 text-center w-28">관리</th>
      </tr>
    `;
  } else {
    thead.innerHTML = `
      <tr class="bg-slate-100/90 text-slate-700 text-[11px] font-bold border-b border-slate-200 uppercase tracking-tight">
        <th class="py-2.5 px-2 text-center">상태</th>
        <th class="py-2.5 px-2 text-left">계약처 / 실고객사</th>
        <th class="py-2.5 px-2 text-left">Part No / 구분</th>
        <th class="py-2.5 px-2 text-right">수량</th>
        <th class="py-2.5 px-2 text-right">실판매단가</th>
        <th class="py-2.5 px-2 text-left">출하일 / 계산서일</th>
        <th class="py-2.5 px-2 text-left">인보이스 / B/L</th>
        <th class="py-2.5 px-2 text-center">수금/환차손익</th>
        <th class="py-2.5 px-2 text-center">만기일정</th>
        <th class="py-2.5 px-2 text-right">관리</th>
      </tr>
    `;
  }
}

