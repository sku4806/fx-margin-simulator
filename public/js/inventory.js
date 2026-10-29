import { sbClient } from './supabase.js';

let cachedItems = [];

export async function fetchInventoryItems() {
  if (!sbClient) return [];
  const { data, error } = await sbClient
    .from('inventory_items')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;

  cachedItems = (data || []).map(item => ({
    id: item.id,
    maker: item.maker || "기타",
    partName: item.part_name,
    dateCode: item.date_code || "-",
    owner: item.owner || "본사 일반재고",
    customer: item.customer || "-",
    soldPriceUsd: parseFloat(item.sold_price_usd) || 0,
    orderStatus: item.order_status || "배정요청",
    paymentTerms: item.payment_terms || "Net 30",
    paymentStatus: item.payment_status || "미수",
    dueDate: item.due_date ? item.due_date.slice(0, 10) : "",
    shippedDate: item.shipped_date ? item.shipped_date.slice(0, 10) : "",
    settledDate: item.settled_date ? item.settled_date.slice(0, 10) : "",
    invoiceNo: item.invoice_no || "",
    trackingNo: item.tracking_no || "",
    entryDate: item.entry_date ? item.entry_date.slice(0, 10) : "",
    memo: item.memo || "",
    unitUsd: parseFloat(item.unit_usd) || 0,
    shipFx: parseFloat(item.ship_fx) || 1350,
    stock: parseInt(item.stock) || 0,
    isSpa: !!item.is_spa,
    approvedDebitUsd: parseFloat(item.approved_debit_usd) || 0,
    currency: item.currency || "USD",
    settledFx: parseFloat(item.settled_fx) || 0
  }));

  return cachedItems;
}

export async function upsertInventoryItem(payload, targetId = null) {
  if (!sbClient) throw new Error("클라이언트 미연결");

  if (targetId) {
    const { error } = await sbClient
      .from('inventory_items')
      .update(payload)
      .eq('id', targetId);
    if (error) throw error;
    return;
  }

  const { error } = await sbClient
    .from('inventory_items')
    .insert([payload]);
  if (error) throw error;
}

export async function splitInventoryShipment(originalItemId, splitQty, salesPriceUsd, customerName, salesRep, remainingOwnerAction) {
  if (!sbClient) throw new Error("클라이언트 미연결");
  const orig = cachedItems.find(i => i.id === originalItemId);
  if (!orig) throw new Error("원본 재고를 찾을 수 없습니다.");
  if (splitQty <= 0 || splitQty >= orig.stock) {
    throw new Error(`분할 수량은 1개 이상 ${orig.stock - 1}개 이하이어야 합니다.`);
  }

  const remainingQty = orig.stock - splitQty;
  const newRemainingOwner = (remainingOwnerAction === 'hq') ? '본사 일반재고' : orig.owner;
  const memoSuffix = (remainingOwnerAction === 'hq') ? ' [본사 잉여재고(Dead Stock) 전환]' : '';

  const { error: updateErr } = await sbClient
    .from('inventory_items')
    .update({ 
      stock: remainingQty,
      owner: newRemainingOwner,
      memo: `${orig.memo || ''}${memoSuffix}`.trim()
    })
    .eq('id', orig.id);
  if (updateErr) throw updateErr;

  const newRow = {
    maker: orig.maker,
    part_name: orig.partName,
    date_code: orig.dateCode,
    owner: salesRep || orig.owner,
    customer: customerName || orig.customer,
    sold_price_usd: salesPriceUsd || orig.soldPriceUsd,
    order_status: "출하준비",
    payment_terms: orig.paymentTerms,
    payment_status: "미수",
    unit_usd: orig.unitUsd,
    ship_fx: orig.shipFx,
    stock: splitQty,
    entry_date: orig.entryDate,
    memo: `[분할 출하] 원본 Lot 잔여: ${remainingQty} EA`,
    is_spa: orig.isSpa,
    approved_debit_usd: orig.approvedDebitUsd,
    currency: orig.currency
  };

  const { error: insertErr } = await sbClient
    .from('inventory_items')
    .insert([newRow]);
  if (insertErr) throw insertErr;
}

export async function deleteInventoryItem(id) {
  if (!sbClient) throw new Error("클라이언트 미연결");
  const { error } = await sbClient.from('inventory_items').delete().eq('id', id);
  if (error) throw error;
}

export function filterItems({ query = "", filterMaker = "", filterOwner = "", filterStatus = "", filterPayment = "" }) {
  const q = query.trim().toUpperCase();
  const maker = filterMaker.toUpperCase();
  const owner = filterOwner.toUpperCase();
  const status = filterStatus.toUpperCase();
  const pay = filterPayment.toUpperCase();

  return cachedItems.filter(i => {
    const matchesQuery = !q || (
      i.partName.toUpperCase().includes(q) || 
      i.dateCode.toUpperCase().includes(q) ||
      i.maker.toUpperCase().includes(q) || 
      i.owner.toUpperCase().includes(q) ||
      i.customer.toUpperCase().includes(q) ||
      i.invoiceNo.toUpperCase().includes(q) ||
      i.trackingNo.toUpperCase().includes(q) ||
      i.memo.toUpperCase().includes(q)
    );
    const matchesMaker = !filterMaker || i.maker.toUpperCase() === maker;
    const matchesOwner = !filterOwner || i.owner.toUpperCase() === owner;
    const matchesStatus = !filterStatus || i.orderStatus.toUpperCase() === status;
    const matchesPay = !filterPayment || i.paymentStatus.toUpperCase() === pay;

    return matchesQuery && matchesMaker && matchesOwner && matchesStatus && matchesPay;
  });
}

export function getCachedItem(id) {
  return cachedItems.find(i => i.id === id);
}

function computeDueBadge(dueDateStr, isPaid) {
  if (isPaid) return '<span class="text-[10px] font-bold text-slate-400">정산완료</span>';
  if (!dueDateStr) return '<span class="text-[10px] text-slate-300">-</span>';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr);
  due.setHours(0, 0, 0, 0);

  const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return `<span class="text-[9px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded">연체 ${Math.abs(diffDays)}일</span>`;
  } else if (diffDays === 0) {
    return '<span class="text-[9px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded animate-pulse">오늘 만기</span>';
  } else if (diffDays <= 7) {
    return `<span class="text-[9px] font-bold bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">D-${diffDays}</span>`;
  } else {
    return `<span class="text-[9px] font-semibold text-slate-500">D-${diffDays}</span>`;
  }
}

function getStatusBadge(status) {
  switch (status) {
    case '배정요청':
      return '<span class="text-[10px] font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded">배정요청</span>';
    case '출하준비':
      return '<span class="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded">출하준비</span>';
    case '출하완료':
      return '<span class="text-[10px] font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">출하완료</span>';
    case '정산마감':
      return '<span class="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded">정산마감</span>';
    case '출하보류':
      return '<span class="text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 rounded">⚠️ 출하보류</span>';
    case '무상지원':
      return '<span class="text-[10px] font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded">🎁 샘플지원</span>';
    case '반품검토':
      return '<span class="text-[10px] font-bold bg-rose-100 text-rose-800 px-2 py-0.5 rounded">🔄 반품(RMA)</span>';
    default:
      return `<span class="text-[10px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded">${status}</span>`;
  }
}

function formatPriceKrwUsd(priceUsd, fxRate) {
  if (!priceUsd || priceUsd <= 0) return '-';
  const krw = Math.round(priceUsd * fxRate);
  return `
    <div class="font-bold text-slate-900 leading-tight">₩${krw.toLocaleString()}</div>
    <div class="text-[10px] text-slate-500 font-mono">($${priceUsd.toFixed(3)} / @${Math.round(fxRate).toLocaleString()})</div>
  `;
}

// 💡 canEdit(관리자 여부)을 전달받아 관리자가 아니면 관리 열/버튼 자체를 렌더링하지 않음
export function renderInventoryUI(filtered, activeTab, onSelect, onDelete, onSplit, canEdit = false) {
  const cardContainer = document.getElementById('inventoryCardContainer');
  const tableHeader = document.getElementById('inventoryTableHeader');
  const tbody = document.getElementById('inventoryTableBody');
  document.getElementById('itemCount').innerText = `총 ${filtered.length}건`;

  if (filtered.length === 0) {
    cardContainer.innerHTML = `<div class="p-6 text-center text-xs text-slate-400 bg-slate-50 rounded-xl">조회된 내역이 없습니다.</div>`;
    tbody.innerHTML = `<tr><td colspan="12" class="py-6 text-center text-slate-400">등록된 내역이 없습니다.</td></tr>`;
    return;
  }

  const adminTh = canEdit ? '<th class="py-3 px-2 text-right">관리</th>' : '';

  if (activeTab === 'sales') {
    tableHeader.innerHTML = `
      <tr>
        <th class="py-3 px-2">라인</th>
        <th class="py-3 px-2">Part Number</th>
        <th class="py-3 px-2">D/C</th>
        <th class="py-3 px-2">담당 Sales</th>
        <th class="py-3 px-2">수주 고객사</th>
        <th class="py-3 px-2">선적 매입단가 (KRW / USD)</th>
        <th class="py-3 px-2">협의 실판매단가 (KRW / USD)</th>
        <th class="py-3 px-2">선적일 / 출하일</th>
        <th class="py-3 px-2">보유수량</th>
        <th class="py-3 px-2">진행 상태</th>
        ${adminTh}
      </tr>
    `;
  } else {
    tableHeader.innerHTML = `
      <tr>
        <th class="py-3 px-2">상태</th>
        <th class="py-3 px-2">고객사 (Account)</th>
        <th class="py-3 px-2">Part Number</th>
        <th class="py-3 px-2">D/C</th>
        <th class="py-3 px-2">수량</th>
        <th class="py-3 px-2">실판매단가 (KRW / USD)</th>
        <th class="py-3 px-2">선적일 / 출하일</th>
        <th class="py-3 px-2">인보이스 / B/L</th>
        <th class="py-3 px-2">수금/환차손익</th>
        <th class="py-3 px-2">만기일정</th>
        ${adminTh}
      </tr>
    `;
  }

  tbody.innerHTML = filtered.map(item => {
    const isPaid = item.paymentStatus === '완료';
    const dueBadge = computeDueBadge(item.dueDate, isPaid);
    const statusBadge = getStatusBadge(item.orderStatus);

    const buyPriceHtml = formatPriceKrwUsd(item.unitUsd, item.shipFx);
    const soldPriceHtml = formatPriceKrwUsd(item.soldPriceUsd, item.shipFx);

    const dateDisplayHtml = `
      <div class="text-[11px] text-slate-700">선적: <strong class="text-slate-900">${item.entryDate || '-'}</strong></div>
      <div class="text-[10px] text-indigo-700">출하: <strong>${item.shippedDate || '미출하'}</strong></div>
    `;

    // 💡 관리자에게만 분할/삭제 버튼 표시
    let adminTd = '';
    if (canEdit) {
      const splitBtn = item.stock > 1 
        ? `<button class="split-btn text-indigo-600 hover:text-indigo-800 font-semibold text-xs px-2 py-1 rounded bg-indigo-50 mr-1" data-id="${item.id}">출하분할</button>`
        : '';
      adminTd = `
        <td class="py-3 px-2 text-right whitespace-nowrap">
          ${splitBtn}
          <button class="delete-btn text-red-500 hover:text-red-700 font-semibold text-xs px-2 py-1 rounded bg-red-50" data-id="${item.id}">삭제</button>
        </td>
      `;
    }

    if (activeTab === 'sales') {
      return `
        <tr class="hover:bg-indigo-50/50 ${canEdit ? 'cursor-pointer' : ''} transition-colors" data-item-id="${item.id}">
          <td class="py-3 px-2"><span class="font-semibold text-indigo-800 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded text-[11px]">${item.maker}</span></td>
          <td class="py-3 px-2 font-bold text-slate-800">${item.partName}</td>
          <td class="py-3 px-2 font-mono text-[11px] text-slate-600 font-bold">${item.dateCode}</td>
          <td class="py-3 px-2 font-semibold text-indigo-950">${item.owner}</td>
          <td class="py-3 px-2 font-bold text-slate-900">${item.customer}</td>
          <td class="py-3 px-2">${buyPriceHtml}</td>
          <td class="py-3 px-2">${soldPriceHtml}</td>
          <td class="py-3 px-2">${dateDisplayHtml}</td>
          <td class="py-3 px-2 font-semibold text-slate-800">${item.stock.toLocaleString()} EA</td>
          <td class="py-3 px-2">${statusBadge}</td>
          ${adminTd}
        </tr>
      `;
    } else {
      const payBadge = isPaid
        ? '<span class="font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded text-[11px]">수금완료</span>'
        : '<span class="font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded text-[11px]">미수</span>';

      let fxDiffBadge = '';
      if (isPaid && item.settledFx > 0 && item.soldPriceUsd > 0) {
        const diffKrw = (item.settledFx - item.shipFx) * item.soldPriceUsd * item.stock;
        if (diffKrw > 0) {
          fxDiffBadge = `<div class="text-[9px] font-bold text-green-600">+₩${Math.round(diffKrw).toLocaleString()} (환차익)</div>`;
        } else if (diffKrw < 0) {
          fxDiffBadge = `<div class="text-[9px] font-bold text-red-500">-₩${Math.round(Math.abs(diffKrw)).toLocaleString()} (환차손)</div>`;
        }
      }

      return `
        <tr class="hover:bg-indigo-50/50 ${canEdit ? 'cursor-pointer' : ''} transition-colors" data-item-id="${item.id}">
          <td class="py-3 px-2">${statusBadge}</td>
          <td class="py-3 px-2 font-bold text-slate-900">${item.customer}</td>
          <td class="py-3 px-2 font-bold text-slate-700">${item.partName}</td>
          <td class="py-3 px-2 font-mono text-[11px] text-slate-600 font-bold">${item.dateCode}</td>
          <td class="py-3 px-2 font-semibold text-slate-800">${item.stock.toLocaleString()} EA</td>
          <td class="py-3 px-2">${soldPriceHtml}</td>
          <td class="py-3 px-2">${dateDisplayHtml}</td>
          <td class="py-3 px-2 font-mono text-[10px] text-slate-600 leading-tight">
            <div>INV: ${item.invoiceNo || '-'}</div>
            <div>B/L: ${item.trackingNo || '-'}</div>
          </td>
          <td class="py-3 px-2">${payBadge}${fxDiffBadge}</td>
          <td class="py-3 px-2">${dueBadge}</td>
          ${adminTd}
        </tr>
      `;
    }
  }).join('');

  // 모바일 카드 뷰
  cardContainer.innerHTML = filtered.map(item => {
    const isPaid = item.paymentStatus === '완료';
    const dueBadge = computeDueBadge(item.dueDate, isPaid);
    const statusBadge = getStatusBadge(item.orderStatus);
    const soldPriceHtml = formatPriceKrwUsd(item.soldPriceUsd, item.shipFx);

    const adminActions = canEdit ? `
      <div>
        ${item.stock > 1 ? `<button class="split-btn text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold px-2 py-0.5 rounded bg-indigo-50 mr-1" data-id="${item.id}">출하분할</button>` : ''}
        <button class="delete-btn text-red-500 hover:text-red-700 px-2 py-0.5 rounded bg-red-50 text-[11px]" data-id="${item.id}">삭제</button>
      </div>
    ` : '';

    return `
      <div class="p-3 bg-slate-50 hover:bg-indigo-50/50 rounded-xl border border-slate-200 ${canEdit ? 'cursor-pointer' : ''} space-y-2" data-item-id="${item.id}">
        <div class="flex justify-between items-start">
          <div>
            <span class="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">${item.maker}</span>
            <span class="text-[10px] font-mono text-slate-500 font-bold ml-1">D/C: ${item.dateCode}</span>
            <div class="font-bold text-slate-900 text-sm mt-0.5">${item.partName}</div>
          </div>
          <div class="text-right">
            ${dueBadge}
            <div class="mt-1">${statusBadge}</div>
          </div>
        </div>

        <div class="bg-white/90 p-2.5 rounded-lg border border-slate-200/60 text-xs space-y-1.5">
          <div class="flex justify-between text-slate-700">
            <span>고객사: <strong class="text-slate-900">${item.customer}</strong></span>
            <span>Sales: <strong class="text-indigo-900">${item.owner}</strong></span>
          </div>
          <div class="grid grid-cols-2 gap-2 text-[11px] text-slate-600 pt-1 border-t border-slate-100">
            <div>
              <span class="text-[10px] text-slate-400 block">선적 매입가</span>
              ${formatPriceKrwUsd(item.unitUsd, item.shipFx)}
            </div>
            <div class="text-right">
              <span class="text-[10px] text-slate-400 block">협의 판매가</span>
              ${soldPriceHtml}
            </div>
          </div>
          <div class="grid grid-cols-2 gap-1 text-[10px] text-slate-500 pt-1 border-t border-slate-100">
            <div>선적: ${item.entryDate || '-'}</div>
            <div class="text-right">출하: ${item.shippedDate || '미출하'}</div>
            <div>수량: <strong class="text-slate-900">${item.stock.toLocaleString()} EA</strong></div>
            <div class="text-right">INV: ${item.invoiceNo || '-'}</div>
          </div>
        </div>

        <div class="flex justify-between items-center pt-0.5 text-[11px]">
          <span class="text-slate-500">결제: <strong>${item.paymentTerms}</strong></span>
          ${adminActions}
        </div>
      </div>
    `;
  }).join('');

  [cardContainer, tbody].forEach(container => {
    container.onclick = (e) => {
      const splitBtn = e.target.closest('.split-btn');
      if (splitBtn && canEdit) {
        e.stopPropagation();
        onSplit(splitBtn.dataset.id);
        return;
      }
      const deleteBtn = e.target.closest('.delete-btn');
      if (deleteBtn && canEdit) {
        e.stopPropagation();
        onDelete(deleteBtn.dataset.id);
        return;
      }
      const row = e.target.closest('[data-item-id]');
      // 💡 관리자만 클릭 시 입력/수정 폼으로 로드됨
      if (row && canEdit) {
        onSelect(row.dataset.itemId);
      }
    };
  });
}
