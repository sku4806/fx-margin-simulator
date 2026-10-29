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
    margin: parseFloat(item.margin) || 20
  }));

  return cachedItems;
}

export async function upsertInventoryItem(payload) {
  if (!sbClient) throw new Error("클라이언트 미연결");

  const existing = cachedItems.find(i => 
    i.partName.toUpperCase() === payload.part_name.toUpperCase() && 
    i.owner.toUpperCase() === payload.owner.toUpperCase() &&
    i.customer.toUpperCase() === payload.customer.toUpperCase()
  );

  if (existing) {
    const { error } = await sbClient
      .from('inventory_items')
      .update(payload)
      .eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await sbClient
      .from('inventory_items')
      .insert([payload]);
    if (error) throw error;
  }
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

// 만기 D-Day 계산 함수
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

// 탭 모드별(Sales vs Fulfillment) 전문 렌더링
export function renderInventoryUI(filtered, activeTab, onSelect, onDelete) {
  const cardContainer = document.getElementById('inventoryCardContainer');
  const tableHeader = document.getElementById('inventoryTableHeader');
  const tbody = document.getElementById('inventoryTableBody');
  document.getElementById('itemCount').innerText = `총 ${filtered.length}건`;

  if (filtered.length === 0) {
    cardContainer.innerHTML = `<div class="p-6 text-center text-xs text-slate-400 bg-slate-50 rounded-xl">조회된 내역이 없습니다.</div>`;
    tbody.innerHTML = `<tr><td colspan="12" class="py-6 text-center text-slate-400">등록된 내역이 없습니다.</td></tr>`;
    return;
  }

  // 1. 데스크톱 헤더 구성 (영업 수주 뷰 vs 출하 채권 뷰)
  if (activeTab === 'sales') {
    tableHeader.innerHTML = `
      <tr>
        <th class="py-3 px-2">라인</th>
        <th class="py-3 px-2">Part Number</th>
        <th class="py-3 px-2">담당 Sales</th>
        <th class="py-3 px-2">수주 고객사</th>
        <th class="py-3 px-2">매입단가($)</th>
        <th class="py-3 px-2">실판매단가($)</th>
        <th class="py-3 px-2">배정 수량</th>
        <th class="py-3 px-2">마진율</th>
        <th class="py-3 px-2">진행 상태</th>
        <th class="py-3 px-2 text-right">관리</th>
      </tr>
    `;
  } else {
    // Fulfillment & Billing 뷰
    tableHeader.innerHTML = `
      <tr>
        <th class="py-3 px-2">상태</th>
        <th class="py-3 px-2">고객사 (Account)</th>
        <th class="py-3 px-2">Part Number</th>
        <th class="py-3 px-2">출하수량</th>
        <th class="py-3 px-2">인보이스 No</th>
        <th class="py-3 px-2">송장 / B/L No</th>
        <th class="py-3 px-2">결제조건</th>
        <th class="py-3 px-2">수금상태</th>
        <th class="py-3 px-2">만기일정</th>
        <th class="py-3 px-2 text-right">관리</th>
      </tr>
    `;
  }

  // 2. 데스크톱 본문 구성
  tbody.innerHTML = filtered.map(item => {
    const isPaid = item.paymentStatus === '완료';
    const dueBadge = computeDueBadge(item.dueDate, isPaid);

    let statusBadge = '<span class="text-[10px] font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded">배정요청</span>';
    if (item.orderStatus === '출하준비') statusBadge = '<span class="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded">출하준비</span>';
    if (item.orderStatus === '출하완료') statusBadge = '<span class="text-[10px] font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">출하완료</span>';
    if (item.orderStatus === '정산마감') statusBadge = '<span class="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded">정산마감</span>';

    if (activeTab === 'sales') {
      return `
        <tr class="hover:bg-indigo-50/50 cursor-pointer transition-colors" data-item-id="${item.id}">
          <td class="py-3 px-2"><span class="font-semibold text-indigo-800 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded text-[11px]">${item.maker}</span></td>
          <td class="py-3 px-2 font-bold text-slate-800">${item.partName}</td>
          <td class="py-3 px-2 font-semibold text-indigo-950">${item.owner}</td>
          <td class="py-3 px-2 font-bold text-slate-900">${item.customer}</td>
          <td class="py-3 px-2 text-slate-600">$${item.unitUsd.toFixed(3)}</td>
          <td class="py-3 px-2 font-bold text-indigo-600">${item.soldPriceUsd > 0 ? `$${item.soldPriceUsd.toFixed(3)}` : '-'}</td>
          <td class="py-3 px-2 font-semibold text-slate-800">${item.stock.toLocaleString()} EA</td>
          <td class="py-3 px-2 text-slate-700 font-semibold">${item.margin}%</td>
          <td class="py-3 px-2">${statusBadge}</td>
          <td class="py-3 px-2 text-right">
            <button class="delete-btn text-red-500 hover:text-red-700 font-semibold text-xs px-2 py-1 rounded bg-red-50" data-id="${item.id}">삭제</button>
          </td>
        </tr>
      `;
    } else {
      const payBadge = isPaid
        ? '<span class="font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded text-[11px]">수금완료</span>'
        : '<span class="font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded text-[11px]">미수</span>';

      return `
        <tr class="hover:bg-indigo-50/50 cursor-pointer transition-colors" data-item-id="${item.id}">
          <td class="py-3 px-2">${statusBadge}</td>
          <td class="py-3 px-2 font-bold text-slate-900">${item.customer}</td>
          <td class="py-3 px-2 font-bold text-slate-700">${item.partName}</td>
          <td class="py-3 px-2 font-semibold text-slate-800">${item.stock.toLocaleString()} EA</td>
          <td class="py-3 px-2 font-mono text-[11px] text-slate-600">${item.invoiceNo || '-'}</td>
          <td class="py-3 px-2 font-mono text-[11px] text-slate-600">${item.trackingNo || '-'}</td>
          <td class="py-3 px-2 text-slate-600 text-[11px]">${item.paymentTerms}</td>
          <td class="py-3 px-2">${payBadge}</td>
          <td class="py-3 px-2">${dueBadge}</td>
          <td class="py-3 px-2 text-right">
            <button class="delete-btn text-red-500 hover:text-red-700 font-semibold text-xs px-2 py-1 rounded bg-red-50" data-id="${item.id}">삭제</button>
          </td>
        </tr>
      `;
    }
  }).join('');

  // 3. 모바일 카드 뷰 구성
  cardContainer.innerHTML = filtered.map(item => {
    const isPaid = item.paymentStatus === '완료';
    const dueBadge = computeDueBadge(item.dueDate, isPaid);

    return `
      <div class="p-3 bg-slate-50 hover:bg-indigo-50/50 rounded-xl border border-slate-200 cursor-pointer space-y-2" data-item-id="${item.id}">
        <div class="flex justify-between items-start">
          <div>
            <span class="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">${item.maker}</span>
            <div class="font-bold text-slate-900 text-sm mt-1">${item.partName}</div>
          </div>
          <div class="text-right">
            ${dueBadge}
            <div class="text-[10px] text-slate-400 mt-0.5">${item.orderStatus}</div>
          </div>
        </div>

        <div class="bg-white/90 p-2 rounded-lg border border-slate-200/60 text-xs space-y-1">
          <div class="flex justify-between text-slate-700">
            <span>고객사: <strong class="text-slate-900">${item.customer}</strong></span>
            <span>Sales: <strong class="text-indigo-900">${item.owner}</strong></span>
          </div>
          <div class="grid grid-cols-2 gap-1 text-[11px] text-slate-500 pt-1 border-t border-slate-100">
            <div>수량: <strong class="text-slate-800">${item.stock.toLocaleString()} EA</strong></div>
            <div class="text-right">실판매가: <strong class="text-indigo-600">${item.soldPriceUsd > 0 ? `$${item.soldPriceUsd.toFixed(3)}` : '-'}</strong></div>
            <div>인보이스: ${item.invoiceNo || '-'}</div>
            <div class="text-right">송장: ${item.trackingNo || '-'}</div>
          </div>
        </div>

        <div class="flex justify-between items-center pt-0.5 text-[11px]">
          <span class="text-slate-500">결제: <strong>${item.paymentTerms}</strong> (${item.paymentStatus})</span>
          <button class="delete-btn text-red-500 hover:text-red-700 px-2 py-0.5 rounded bg-red-50" data-id="${item.id}">삭제</button>
        </div>
      </div>
    `;
  }).join('');

  [cardContainer, tbody].forEach(container => {
    container.onclick = (e) => {
      const deleteBtn = e.target.closest('.delete-btn');
      if (deleteBtn) {
        e.stopPropagation();
        onDelete(deleteBtn.dataset.id);
        return;
      }
      const row = e.target.closest('[data-item-id]');
      if (row) {
        onSelect(row.dataset.itemId);
      }
    };
  });
}
