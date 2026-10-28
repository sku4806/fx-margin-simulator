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
    paymentStatus: item.payment_status || "미수",
    dueDate: item.due_date ? item.due_date.slice(0, 10) : "",
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

export function filterItems({ query = "", filterMaker = "", filterOwner = "", filterPayment = "" }) {
  const q = query.trim().toUpperCase();
  const maker = filterMaker.toUpperCase();
  const owner = filterOwner.toUpperCase();
  const pay = filterPayment.toUpperCase();

  return cachedItems.filter(i => {
    const matchesQuery = !q || (
      i.partName.toUpperCase().includes(q) || 
      i.maker.toUpperCase().includes(q) || 
      i.owner.toUpperCase().includes(q) ||
      i.customer.toUpperCase().includes(q) ||
      i.memo.toUpperCase().includes(q)
    );
    const matchesMaker = !maker || i.maker.toUpperCase() === maker;
    const matchesOwner = !owner || i.owner.toUpperCase() === owner;
    const matchesPay = !pay || i.paymentStatus.toUpperCase() === pay;

    return matchesQuery && matchesMaker && matchesOwner && matchesPay;
  });
}

export function getCachedItem(id) {
  return cachedItems.find(i => i.id === id);
}

export function renderInventoryUI(filtered, onSelect, onDelete) {
  const cardContainer = document.getElementById('inventoryCardContainer');
  const tbody = document.getElementById('inventoryTableBody');
  document.getElementById('itemCount').innerText = `총 ${filtered.length}건`;

  if (filtered.length === 0) {
    cardContainer.innerHTML = `<div class="p-6 text-center text-xs text-slate-400 bg-slate-50 rounded-xl">조건과 일치하는 데이터가 없습니다.</div>`;
    tbody.innerHTML = `<tr><td colspan="11" class="py-6 text-center text-slate-400">등록된 데이터가 없습니다.</td></tr>`;
    return;
  }

  // 모바일 카드 뷰
  cardContainer.innerHTML = filtered.map(item => {
    const payBadge = item.paymentStatus === '완료' 
      ? '<span class="text-[9px] font-bold bg-green-100 text-green-700 px-1.5 py-0.5 rounded">수금완료</span>'
      : '<span class="text-[9px] font-bold bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded">미수</span>';

    return `
      <div class="p-3 bg-slate-50 hover:bg-indigo-50/50 rounded-xl border border-slate-200 cursor-pointer space-y-2" data-item-id="${item.id}">
        <div class="flex justify-between items-start">
          <div>
            <span class="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">${item.maker}</span>
            <div class="font-bold text-slate-900 text-sm mt-1">${item.partName}</div>
          </div>
          <div class="text-right">
            ${payBadge}
            <span class="text-[10px] text-slate-400 mt-1 block">${item.entryDate || '-'}</span>
          </div>
        </div>
        <div class="bg-white/90 p-2 rounded-lg border border-slate-200/60 text-xs space-y-1">
          <div class="flex justify-between text-slate-600">
            <span>Sales: <strong class="text-indigo-900">${item.owner}</strong></span>
            <span>고객사: <strong class="text-slate-800">${item.customer}</strong></span>
          </div>
          <div class="grid grid-cols-2 gap-1 text-[11px] text-slate-500 pt-1 border-t border-slate-100">
            <div>원가: $${item.unitUsd.toFixed(3)}</div>
            <div class="text-right">판매가: <strong class="text-slate-800">$${item.soldPriceUsd > 0 ? item.soldPriceUsd.toFixed(3) : '-'}</strong></div>
            <div>재고: <strong class="text-indigo-900">${item.stock.toLocaleString()} EA</strong></div>
            <div class="text-right">만기: ${item.dueDate || '-'}</div>
          </div>
        </div>
        <div class="flex justify-end pt-0.5">
          <button class="delete-btn text-[11px] text-red-500 hover:text-red-700 px-2 py-0.5 rounded bg-red-50" data-id="${item.id}">삭제</button>
        </div>
      </div>
    `;
  }).join('');

  // 데스크톱 테이블 뷰
  tbody.innerHTML = filtered.map(item => {
    const payBadge = item.paymentStatus === '완료' 
      ? '<span class="font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded">완료</span>'
      : '<span class="font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded">미수</span>';

    return `
      <tr class="hover:bg-indigo-50/50 cursor-pointer transition-colors" data-item-id="${item.id}">
        <td class="py-3 px-3"><span class="font-semibold text-indigo-800 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded">${item.maker}</span></td>
        <td class="py-3 px-3 font-bold text-slate-800">${item.partName}</td>
        <td class="py-3 px-3 text-indigo-900 font-bold">${item.owner}</td>
        <td class="py-3 px-3 text-slate-800 font-semibold">${item.customer}</td>
        <td class="py-3 px-3 text-slate-700">$${item.unitUsd.toFixed(3)}</td>
        <td class="py-3 px-3 text-slate-900 font-bold">${item.soldPriceUsd > 0 ? `$${item.soldPriceUsd.toFixed(3)}` : '-'}</td>
        <td class="py-3 px-3">${payBadge}</td>
        <td class="py-3 px-3 text-slate-500 text-[11px]">${item.dueDate || '-'}</td>
        <td class="py-3 px-3 font-semibold text-slate-800">${item.stock.toLocaleString()} EA</td>
        <td class="py-3 px-3 text-indigo-600 font-semibold">${item.margin}%</td>
        <td class="py-3 px-3 text-right">
          <button class="delete-btn text-red-500 hover:text-red-700 font-semibold text-xs px-2 py-1 rounded bg-red-50" data-id="${item.id}">삭제</button>
        </td>
      </tr>
    `;
  }).join('');

  // 이벤트 위임 바인딩
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
