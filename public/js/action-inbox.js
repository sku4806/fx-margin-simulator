// ========================================================
// 🔔 오늘의 액션 알림 센터 (Action Inbox Notification Center)
// app.js에서 분리된 지연 로딩 전용 모듈
// ========================================================
import { toEnglishSalesName } from './modules/utils.js?v=20261126';

const actionInboxState = {
  tab: 'unpaid_dom', // 'unpaid_dom' | 'unpaid_comm' | 'aging_stock' | 'borrows_po'
  salesRep: 'ALL',
  includeArchive: false, // 기본값 false: 2025~2026년 최근 실무 활성 채권만 표시 (자사 BIGSHINE 명의 더미 제외)
  loading: false,
  data: null,
};

function getAgingInventoryList(salesRep = 'ALL', includeArchive = false) {
  const allInv = Array.isArray(window.cachedItems) ? window.cachedItems : [];
  const todayMs = Date.now();
  const repTarget = (salesRep && salesRep !== 'ALL') ? toEnglishSalesName(salesRep) : 'ALL';
  const liveFx = (typeof window.getLiveFxRate === 'function' ? window.getLiveFxRate() : 0) || 1350;

  return allInv
    .map(it => {
      const stk = Number(it.stock) || 0;
      if (stk <= 0) return null;
      const owner = toEnglishSalesName(it.owner || it.sales || 'BSK');
      if (repTarget !== 'ALL' && owner !== repTarget) return null;
      const eDate = (it.entryDate || it.entry_date || '').slice(0, 10);
      if (!eDate || eDate.length < 10) return null;
      if (!includeArchive && eDate < '2026-01-01') return null;
      const ageDays = Math.max(0, Math.floor((todayMs - new Date(eDate).getTime()) / 86400000));
      if (ageDays < 90) return null;
      const uUsd = Number(it.unitUsd ?? it.unit_usd) || 0;
      const amtUsd = stk * uUsd;
      if (!includeArchive && amtUsd < 2000) return null;
      const sFx = Number(it.shipFx ?? it.ship_fx) || liveFx;
      const rawArr = Number(it.arrangedQty ?? it.arranged_qty) || 0;
      const isExp = it.orderStatus === '배정완료' || it.orderStatus === '배정요청';
      const arr = rawArr > 0 ? Math.min(stk, rawArr) : (isExp ? stk : 0);
      const avail = Math.max(0, stk - arr);
      return {
        id: it.id,
        part_no: it.partName || it.part_name || '-',
        maker: it.maker || 'OTHERS',
        customer: (it.customer && it.customer !== '-') ? it.customer : (it.memo || '본사 일반재고'),
        sales_rep: owner,
        stock: stk,
        avail_qty: avail,
        unit_usd: uUsd,
        amount_usd: amtUsd,
        amount_krw: Math.round(amtUsd * sFx),
        entry_date: eDate,
        age_days: ageDays,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.amount_usd - a.amount_usd);
}

export async function refreshActionInboxBadge(forceFetch = false) {
  const badge = document.getElementById('actionInboxCountBadge');
  if (!badge) return;

  try {
    if (!actionInboxState.data || forceFetch) {
      const qs = new URLSearchParams();
      if (actionInboxState.salesRep !== 'ALL') qs.set('sales_rep', actionInboxState.salesRep);
      if (actionInboxState.includeArchive) qs.set('include_archive', 'true');
      const qStr = qs.toString() ? `?${qs.toString()}` : '';
      const res = await fetch(`/api/notifications/action-inbox${qStr}`);
      const json = await res.json();
      if (json && json.status === 'success') {
        actionInboxState.data = json;
      }
    }
    const d = actionInboxState.data || {};
    const agingStocks = getAgingInventoryList(actionInboxState.salesRep, actionInboxState.includeArchive);
    const totalActions =
      (Number(d.overdue_domestic_total_count) || 0) +
      (Number(d.overdue_commission_total_count) || 0) +
      agingStocks.length +
      (Number(d.overdue_borrows_total_count) || 0) +
      (Number(d.delayed_pos_total_count) || 0);

    badge.textContent = `${totalActions.toLocaleString()}건`;
  } catch (e) {
    console.warn('Action Inbox 배지 갱신 실패:', e);
  }
}

export async function openActionInboxModal() {
  let modal = document.getElementById('actionInboxModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'actionInboxModal';
    modal.className = 'fixed inset-0 bg-slate-900/70 backdrop-blur-xs z-[99994] flex items-center justify-center p-2 sm:p-4 overflow-y-auto';
    modal.onclick = (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    };
    document.body.appendChild(modal);
  }

  modal.classList.remove('hidden');
  actionInboxState.loading = true;
  renderActionInboxModal();

  try {
    await refreshActionInboxBadge(true);
  } finally {
    actionInboxState.loading = false;
    renderActionInboxModal();
  }
}

window.refreshActionInboxBadge = refreshActionInboxBadge;
window.openActionInboxModal = openActionInboxModal;

window.switchActionInboxTab = function(tab) {
  actionInboxState.tab = tab;
  renderActionInboxModal();
};

window.switchActionInboxRep = async function(rep) {
  actionInboxState.salesRep = rep || 'ALL';
  actionInboxState.loading = true;
  renderActionInboxModal();
  await refreshActionInboxBadge(true);
  actionInboxState.loading = false;
  renderActionInboxModal();
};

window.toggleActionInboxArchive = async function() {
  actionInboxState.includeArchive = !actionInboxState.includeArchive;
  actionInboxState.loading = true;
  renderActionInboxModal();
  await refreshActionInboxBadge(true);
  actionInboxState.loading = false;
  renderActionInboxModal();
};

function renderActionInboxModal() {
  const modal = document.getElementById('actionInboxModal');
  if (!modal) return;

  const { tab, salesRep, loading, data } = actionInboxState;
  const d = data || {};
  const domList = Array.isArray(d.overdue_domestic) ? d.overdue_domestic : [];
  const commList = Array.isArray(d.overdue_commission) ? d.overdue_commission : [];
  const brwList = Array.isArray(d.overdue_borrows) ? d.overdue_borrows : [];
  const poList = Array.isArray(d.delayed_pos) ? d.delayed_pos : [];
  const agingStocks = getAgingInventoryList(salesRep, actionInboxState.includeArchive);

  const domTotalCnt = Number(d.overdue_domestic_total_count) || domList.length;
  const domTotalKrw = Number(d.overdue_domestic_total_krw) || domList.reduce((s, r) => s + (r.amount_krw || 0), 0);
  const commTotalCnt = Number(d.overdue_commission_total_count) || commList.length;
  const commTotalUsd = Number(d.overdue_commission_total_usd) || commList.reduce((s, r) => s + (r.comm_usd || 0), 0);
  const agingTotalUsd = agingStocks.reduce((s, r) => s + (r.amount_usd || 0), 0);
  const agingTotalKrw = agingStocks.reduce((s, r) => s + (r.amount_krw || 0), 0);
  const brwPoCnt = (Number(d.overdue_borrows_total_count) || brwList.length) + (Number(d.delayed_pos_total_count) || poList.length);

  const allReps = ['ALL', 'KELLY', 'ALLEN', 'WILLIAM', 'ERIC', 'STEVE', 'PAUL', 'JOEY', 'DUSTIN', 'LOGAN', 'NATHAN', 'TIMOTHY', 'TONY'];
  const myProfile = typeof window.getCurrentUserProfile === 'function' ? window.getCurrentUserProfile() : null;
  const myRepName = myProfile?.name ? toEnglishSalesName(myProfile.name) : '';

  const isMobile = window.innerWidth < 768;

  let bodyHtml = '';
  if (loading) {
    bodyHtml = `<div class="py-16 text-center text-slate-400 font-bold text-xs">⏳ 전사 미수금·커미션·장기재고·대여 미반납 알림을 실시간 점검하고 있습니다...</div>`;
  } else if (tab === 'unpaid_dom') {
    bodyHtml = domList.length === 0 ? `<div class="py-12 text-center text-slate-400 font-bold text-xs bg-white rounded-xl border border-slate-200">14일 이상 연체된 Domestic 미수금이 없습니다. ✅</div>` : isMobile ? `
      <div class="space-y-2.5">
        ${domList.map(u => {
          const safeCust = String(u.customer || '').replace(/'/g, "\\'");
          return `
            <div class="bg-white rounded-xl border border-rose-200 p-3 shadow-2xs space-y-1.5 text-xs">
              <div class="flex items-center justify-between gap-2">
                <span class="px-2 py-0.5 rounded-full text-[10px] font-black ${u.overdue_days >= 60 ? 'bg-red-200 text-red-950 border border-red-400' : 'bg-rose-100 text-rose-900 border border-rose-300'}">+${u.overdue_days}일 연체</span>
                <span class="font-bold text-indigo-900 text-[11px]">${u.sales_rep} · ${u.maker || '-'}</span>
              </div>
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <button type="button" onclick="window.openCustomer360Modal && window.openCustomer360Modal('${safeCust}')" class="font-black text-sm text-slate-900 hover:text-indigo-700 hover:underline text-left truncate max-w-full">${u.customer}</button>
                  <div class="font-mono font-bold text-[11px] text-slate-700 truncate">${u.part_no}</div>
                </div>
                <div class="text-right shrink-0">
                  <div class="font-mono font-black text-sm text-rose-700">₩${Math.round(u.amount_krw).toLocaleString()}</div>
                  <div class="font-mono text-[10px] text-slate-500">만기 ${u.due_date || '-'}</div>
                </div>
              </div>
              <div class="flex justify-end pt-1 border-t border-slate-100">
                <button type="button" onclick="document.getElementById('actionInboxModal').classList.add('hidden'); document.getElementById('tabUnpaid')?.click(); setTimeout(() => window.filterUnpaidByCustomer && window.filterUnpaidByCustomer('${safeCust}'), 120);" class="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[10px] font-bold cursor-pointer">수금/청구 ↗</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    ` : `
      <div class="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-2xs">
        <table class="w-full text-left text-xs border-collapse">
          <thead class="bg-rose-50 text-rose-950 font-bold text-[11px] border-b border-rose-200 sticky top-0 z-10">
            <tr>
              <th class="py-2 px-2.5 text-center w-24">연체상태</th>
              <th class="py-2 px-2.5">고객사 (클릭 시 360°)</th>
              <th class="py-2 px-2.5 text-center w-20">제조사</th>
              <th class="py-2 px-2.5">품번 (PartNo)</th>
              <th class="py-2 px-2.5 text-right">미수금액(VAT)</th>
              <th class="py-2 px-2.5 text-center">출하일 / 만기일</th>
              <th class="py-2 px-2.5 text-center">담당</th>
              <th class="py-2 px-2.5 text-center">즉시 조치</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 text-[11px]">
            ${domList.map(u => {
              const safeCust = String(u.customer || '').replace(/'/g, "\\'");
              return `
                <tr class="hover:bg-rose-50/30">
                  <td class="py-1.5 px-2.5 text-center whitespace-nowrap">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-black ${u.overdue_days >= 60 ? 'bg-red-200 text-red-950 border border-red-400' : 'bg-rose-100 text-rose-900 border border-rose-300'}">+${u.overdue_days}일 연체</span>
                  </td>
                  <td class="py-1.5 px-2.5 font-black text-slate-900">
                    <button type="button" onclick="window.openCustomer360Modal && window.openCustomer360Modal('${safeCust}')" class="hover:text-indigo-700 hover:underline cursor-pointer text-left">${u.customer}</button>
                  </td>
                  <td class="py-1.5 px-2.5 text-center font-bold text-indigo-900">${u.maker || '-'}</td>
                  <td class="py-1.5 px-2.5 font-mono font-bold text-slate-800">${u.part_no}</td>
                  <td class="py-1.5 px-2.5 text-right font-mono font-black text-rose-700">₩${Math.round(u.amount_krw).toLocaleString()}</td>
                  <td class="py-1.5 px-2.5 text-center font-mono text-[10px] text-slate-500">${u.out_date} → <strong class="text-slate-800">${u.due_date || '-'}</strong></td>
                  <td class="py-1.5 px-2.5 text-center font-bold text-indigo-900">${u.sales_rep}</td>
                  <td class="py-1.5 px-2.5 text-center whitespace-nowrap">
                    <button type="button" onclick="document.getElementById('actionInboxModal').classList.add('hidden'); document.getElementById('tabUnpaid')?.click(); setTimeout(() => window.filterUnpaidByCustomer && window.filterUnpaidByCustomer('${safeCust}'), 120);" class="px-2 py-0.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-[10px] font-bold cursor-pointer">수금/청구 ↗</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } else if (tab === 'unpaid_comm') {
    bodyHtml = commList.length === 0 ? `<div class="py-12 text-center text-slate-400 font-bold text-xs bg-white rounded-xl border border-slate-200">45일 이상 경과된 해외 Commission 미입금 건이 없습니다. ✅</div>` : isMobile ? `
      <div class="space-y-2.5">
        ${commList.map(c => {
          const safeCust = String(c.customer || '').replace(/'/g, "\\'");
          return `
            <div class="bg-white rounded-xl border border-violet-200 p-3 shadow-2xs space-y-1.5 text-xs">
              <div class="flex items-center justify-between gap-2">
                <span class="px-2 py-0.5 rounded-full text-[10px] font-black ${c.elapsed_days >= 90 ? 'bg-rose-100 text-rose-800 border border-rose-300' : 'bg-amber-100 text-amber-900 border border-amber-300'}">+${c.elapsed_days}일 경과</span>
                <span class="font-bold text-indigo-900 text-[11px]">${c.sales_rep} · ${c.maker}</span>
              </div>
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <button type="button" onclick="window.openCustomer360Modal && window.openCustomer360Modal('${safeCust}')" class="font-black text-sm text-slate-900 hover:text-indigo-700 hover:underline text-left truncate max-w-full">${c.customer}</button>
                  <div class="font-mono font-bold text-[11px] text-slate-700 truncate">${c.part_no}</div>
                </div>
                <div class="text-right shrink-0">
                  <div class="font-mono font-black text-sm text-violet-800">$${c.comm_usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div class="font-mono text-[10px] text-slate-500">선적 ${c.ship_date}</div>
                </div>
              </div>
              <div class="flex justify-end pt-1 border-t border-slate-100">
                <button type="button" onclick="document.getElementById('actionInboxModal').classList.add('hidden'); document.getElementById('tabUnpaid')?.click(); setTimeout(() => window.switchUnpaidMode && window.switchUnpaidMode('commission'), 120);" class="px-2.5 py-1 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-[10px] font-bold cursor-pointer">커미션 정산 ↗</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    ` : `
      <div class="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-2xs">
        <table class="w-full text-left text-xs border-collapse">
          <thead class="bg-violet-50 text-violet-950 font-bold text-[11px] border-b border-violet-200 sticky top-0 z-10">
            <tr>
              <th class="py-2 px-2.5 text-center w-24">경과일수</th>
              <th class="py-2 px-2.5 text-center w-24">선적일</th>
              <th class="py-2 px-2.5 text-center w-24">제조사(Line)</th>
              <th class="py-2 px-2.5">고객사</th>
              <th class="py-2 px-2.5">품번 (PartNo)</th>
              <th class="py-2 px-2.5 text-right">💎 미입금 커미션($)</th>
              <th class="py-2 px-2.5 text-center">담당</th>
              <th class="py-2 px-2.5 text-center">즉시 조치</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 text-[11px]">
            ${commList.map(c => {
              const safeCust = String(c.customer || '').replace(/'/g, "\\'");
              return `
                <tr class="hover:bg-violet-50/30">
                  <td class="py-1.5 px-2.5 text-center whitespace-nowrap">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-black ${c.elapsed_days >= 90 ? 'bg-rose-100 text-rose-800 border border-rose-300' : 'bg-amber-100 text-amber-900 border border-amber-300'}">+${c.elapsed_days}일 경과</span>
                  </td>
                  <td class="py-1.5 px-2.5 text-center font-mono text-slate-600">${c.ship_date}</td>
                  <td class="py-1.5 px-2.5 text-center font-black text-indigo-900">${c.maker}</td>
                  <td class="py-1.5 px-2.5 font-bold text-slate-900">
                    <button type="button" onclick="window.openCustomer360Modal && window.openCustomer360Modal('${safeCust}')" class="hover:text-indigo-700 hover:underline cursor-pointer text-left">${c.customer}</button>
                  </td>
                  <td class="py-1.5 px-2.5 font-mono font-bold text-slate-800">${c.part_no}</td>
                  <td class="py-1.5 px-2.5 text-right font-mono font-black text-violet-800">$${c.comm_usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td class="py-1.5 px-2.5 text-center font-bold text-indigo-900">${c.sales_rep}</td>
                  <td class="py-1.5 px-2.5 text-center whitespace-nowrap">
                    <button type="button" onclick="document.getElementById('actionInboxModal').classList.add('hidden'); document.getElementById('tabUnpaid')?.click(); setTimeout(() => window.switchUnpaidMode && window.switchUnpaidMode('commission'), 120);" class="px-2 py-0.5 bg-violet-600 hover:bg-violet-700 text-white rounded text-[10px] font-bold cursor-pointer">커미션 정산 ↗</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } else if (tab === 'aging_stock') {
    bodyHtml = agingStocks.length === 0 ? `<div class="py-12 text-center text-slate-400 font-bold text-xs bg-white rounded-xl border border-slate-200">90일 이상 경과된 장기 재고가 없습니다. ✅</div>` : isMobile ? `
      <div class="space-y-2.5">
        ${agingStocks.slice(0, 100).map(st => {
          const safePart = String(st.part_no || '').replace(/'/g, "\\'");
          return `
            <div class="bg-white rounded-xl border border-amber-200 p-3 shadow-2xs space-y-1.5 text-xs">
              <div class="flex items-center justify-between gap-2">
                <span class="px-2 py-0.5 rounded-full text-[10px] font-black ${st.age_days >= 180 ? 'bg-rose-100 text-rose-800 border border-rose-300' : 'bg-amber-100 text-amber-900 border border-amber-300'}">+${st.age_days}일 (${st.entry_date})</span>
                <span class="font-bold text-indigo-900 text-[11px]">${st.sales_rep} · ${st.maker}</span>
              </div>
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <button type="button" onclick="window.openPriceHistoryModal && window.openPriceHistoryModal('${safePart}')" class="font-mono font-black text-sm text-slate-900 hover:text-indigo-700 hover:underline text-left truncate max-w-full">📈 ${st.part_no}</button>
                  <div class="text-[11px] font-bold text-slate-600 truncate">${st.customer}</div>
                </div>
                <div class="text-right shrink-0">
                  <div class="font-mono font-black text-sm text-slate-900">$${st.amount_usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div class="font-mono text-[10px] text-emerald-700 font-bold">${st.stock.toLocaleString()} EA (가용 ${st.avail_qty.toLocaleString()})</div>
                </div>
              </div>
              <div class="flex justify-end pt-1 border-t border-slate-100">
                <button type="button" onclick="document.getElementById('actionInboxModal').classList.add('hidden'); document.getElementById('tabSales')?.click(); setTimeout(() => window.loadFormFromItem && window.loadFormFromItem('${st.id}'), 120);" class="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-bold cursor-pointer">소진 견적 ↗</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    ` : `
      <div class="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-2xs">
        <table class="w-full text-left text-xs border-collapse">
          <thead class="bg-amber-50 text-amber-950 font-bold text-[11px] border-b border-amber-200 sticky top-0 z-10">
            <tr>
              <th class="py-2 px-2.5 text-center w-24">보유 경과일</th>
              <th class="py-2 px-2.5 text-center w-24">입고일</th>
              <th class="py-2 px-2.5 text-center w-20">제조사</th>
              <th class="py-2 px-2.5">품번 (PartNo)</th>
              <th class="py-2 px-2.5">계약 고객사 / 비고</th>
              <th class="py-2 px-2.5 text-right">보유 / 가용수량</th>
              <th class="py-2 px-2.5 text-right">재고금액($ / ₩)</th>
              <th class="py-2 px-2.5 text-center">담당</th>
              <th class="py-2 px-2.5 text-center">즉시 조치</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 text-[11px]">
            ${agingStocks.slice(0, 100).map(st => {
              const safePart = String(st.part_no || '').replace(/'/g, "\\'");
              return `
                <tr class="hover:bg-amber-50/30">
                  <td class="py-1.5 px-2.5 text-center whitespace-nowrap">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-black ${st.age_days >= 180 ? 'bg-rose-100 text-rose-800 border border-rose-300' : 'bg-amber-100 text-amber-900 border border-amber-300'}">+${st.age_days}일</span>
                  </td>
                  <td class="py-1.5 px-2.5 text-center font-mono text-slate-600">${st.entry_date}</td>
                  <td class="py-1.5 px-2.5 text-center font-bold text-indigo-900">${st.maker}</td>
                  <td class="py-1.5 px-2.5 font-mono font-black text-slate-900">
                    <button type="button" onclick="window.openPriceHistoryModal && window.openPriceHistoryModal('${safePart}')" class="hover:text-indigo-700 hover:underline cursor-pointer">📈 ${st.part_no}</button>
                  </td>
                  <td class="py-1.5 px-2.5 font-bold text-slate-700 truncate max-w-[160px]">${st.customer}</td>
                  <td class="py-1.5 px-2.5 text-right font-mono">
                    <strong>${st.stock.toLocaleString()} EA</strong> <span class="text-emerald-700 text-[10px]">(가용 ${st.avail_qty.toLocaleString()})</span>
                  </td>
                  <td class="py-1.5 px-2.5 text-right font-mono">
                    <div class="font-black text-slate-900">$${st.amount_usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    <div class="text-[9px] text-rose-600 font-bold">₩${st.amount_krw.toLocaleString()}</div>
                  </td>
                  <td class="py-1.5 px-2.5 text-center font-bold text-indigo-900">${st.sales_rep}</td>
                  <td class="py-1.5 px-2.5 text-center whitespace-nowrap">
                    <button type="button" onclick="document.getElementById('actionInboxModal').classList.add('hidden'); document.getElementById('tabSales')?.click(); setTimeout(() => window.loadFormFromItem && window.loadFormFromItem('${st.id}'), 120);" class="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-[10px] font-bold cursor-pointer">소진 견적 ↗</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } else {
    bodyHtml = `
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="bg-white rounded-xl border border-slate-200 p-3.5 space-y-2.5">
          <div class="flex items-center justify-between border-b border-slate-100 pb-2">
            <h4 class="font-black text-xs text-teal-900">🔄 대여(Borrow) 장기 미반납 · 반납기한 경과 (${brwList.length}건)</h4>
            <button type="button" onclick="document.getElementById('actionInboxModal').classList.add('hidden'); document.getElementById('tabShipments')?.click(); setTimeout(() => document.getElementById('btnModeBorrow')?.click(), 120);" class="text-[11px] font-bold text-teal-700 hover:underline cursor-pointer">대여/반납 원장 열기 ↗</button>
          </div>
          ${brwList.length === 0 ? `<div class="py-8 text-center text-slate-400 text-xs">기한이 경과된 미반납 대여 건이 없습니다. ✅</div>` : `
            <div class="space-y-1.5 max-h-80 overflow-y-auto pr-1 text-[11px]">
              ${brwList.map(b => `
                <div class="p-2.5 rounded-lg bg-teal-50/40 border border-teal-200/80 flex items-center justify-between gap-2">
                  <div class="min-w-0">
                    <div class="font-mono font-black text-slate-900 truncate">[${b.maker}] ${b.part_no} (${b.qty.toLocaleString()} EA)</div>
                    <div class="text-[10px] text-slate-600">${b.customer} · 대여일: ${b.borrow_date} · <strong class="text-rose-700">+${b.elapsed_days}일 경과</strong></div>
                  </div>
                  <span class="px-2 py-0.5 rounded bg-white border border-teal-200 font-bold text-indigo-900 text-[10px] shrink-0">${b.sales_rep}</span>
                </div>
              `).join('')}
            </div>
          `}
        </div>

        <div class="bg-white rounded-xl border border-slate-200 p-3.5 space-y-2.5">
          <div class="flex items-center justify-between border-b border-slate-100 pb-2">
            <h4 class="font-black text-xs text-indigo-950">🚢 희망납기(CRD/ETA) 경과 미입고 발주 (${poList.length}건)</h4>
            <button type="button" onclick="document.getElementById('actionInboxModal').classList.add('hidden'); window.openPurchaseOrdersModal && window.openPurchaseOrdersModal();" class="text-[11px] font-bold text-indigo-700 hover:underline cursor-pointer">발주·입고예정 모달 열기 ↗</button>
          </div>
          ${poList.length === 0 ? `<div class="py-8 text-center text-slate-400 text-xs">납기가 지연된 미입고 발주(PO)가 없습니다. ✅</div>` : `
            <div class="space-y-1.5 max-h-80 overflow-y-auto pr-1 text-[11px]">
              ${poList.map(p => `
                <div class="p-2.5 rounded-lg bg-indigo-50/40 border border-indigo-200/80 flex items-center justify-between gap-2">
                  <div class="min-w-0">
                    <div class="font-mono font-black text-slate-900 truncate">[${p.maker}] ${p.part_no} (${p.qty.toLocaleString()} EA)</div>
                    <div class="text-[10px] text-slate-600 font-mono">PO: ${p.po_no} · 발주일: ${p.po_dt} · 예정납기: <strong class="text-rose-700">${p.eta_date}</strong></div>
                  </div>
                  <span class="px-2 py-0.5 rounded bg-white border border-indigo-200 font-bold text-indigo-900 text-[10px] shrink-0">${p.sales_rep}</span>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `;
  }

  modal.innerHTML = `
    <div class="bg-white w-full sm:w-[96vw] max-w-[1560px] h-[94dvh] sm:h-[90vh] rounded-2xl shadow-2xl border border-slate-300 flex flex-col overflow-hidden" onclick="event.stopPropagation()">
      <div class="bg-gradient-to-r from-slate-900 via-rose-950 to-indigo-950 text-white px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-rose-500/25 border border-rose-400/40 flex items-center justify-center text-xl font-black">🔔</div>
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <h2 class="text-base sm:text-lg font-black tracking-wide">오늘의 액션 알림 센터 (Action Inbox)</h2>
              <span class="text-[10px] bg-rose-500/30 border border-rose-300/40 text-rose-100 font-bold px-2 py-0.5 rounded-full">실시간 리스크 &amp; 후속조치 브리핑</span>
            </div>
            <p class="text-[11px] text-slate-300 mt-0.5">연체 미수금 · 해외 커미션 미입금 · 90일+ 장기 체화 재고 · 대여 미반납 및 입고지연 발주 통합 점검</p>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <button type="button" onclick="window.toggleActionInboxArchive()" class="px-2.5 py-1.5 rounded-lg text-xs font-black cursor-pointer border transition ${actionInboxState.includeArchive ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-xs' : 'bg-white/10 text-slate-200 border-white/20 hover:bg-white/20'}" title="클릭하여 2024년 이전 과거 장기 레코드 및 자사(BIGSHINE) 내부 명의 데이터 포함 여부 전환">
            ${actionInboxState.includeArchive ? '📂 전체 기간(2010~ 과거/자사 포함) 보기 중' : '✨ 최근 실무 활성(2025~ · 자사더미 제외)'}
          </button>
          ${myRepName ? `
            <button type="button" onclick="window.switchActionInboxRep('${salesRep === myRepName ? 'ALL' : myRepName}')" class="px-2.5 py-1.5 rounded-lg text-xs font-black cursor-pointer border transition ${salesRep === myRepName ? 'bg-amber-400 text-slate-950 border-amber-300' : 'bg-white/10 text-white border-white/20 hover:bg-white/20'}">
              👤 내 담당(${myRepName})만 보기
            </button>
          ` : ''}
          <select onchange="window.switchActionInboxRep(this.value)" class="bg-slate-800 text-amber-300 border border-slate-600 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none cursor-pointer">
            ${allReps.map(r => `<option value="${r}" ${salesRep === r ? 'selected' : ''}>${r === 'ALL' ? '전체 담당자 (ALL)' : r}</option>`).join('')}
          </select>
          <button type="button" onclick="document.getElementById('actionInboxModal').classList.add('hidden')" class="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold flex items-center justify-center cursor-pointer">✕</button>
        </div>
      </div>

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-2.5 p-3 sm:p-4 bg-slate-50 border-b border-slate-200 shrink-0">
        <div onclick="window.switchActionInboxTab('unpaid_dom')" class="bg-white border ${tab === 'unpaid_dom' ? 'border-rose-500 ring-2 ring-rose-200' : 'border-rose-200'} rounded-xl p-3 shadow-2xs cursor-pointer transition">
          <div class="text-[11px] font-bold text-rose-900 flex items-center justify-between">
            <span>🚨 Domestic 연체 미수금</span>
            <span class="text-[10px] bg-rose-100 text-rose-800 px-1.5 py-0.2 rounded font-black">${domTotalCnt}건</span>
          </div>
          <div class="text-base sm:text-lg font-black text-rose-700 font-mono mt-1">₩${Math.round(domTotalKrw).toLocaleString()}</div>
          <div class="text-[10px] text-slate-500 mt-0.5">만기 +14일 이상 경과 외상 채권</div>
        </div>

        <div onclick="window.switchActionInboxTab('unpaid_comm')" class="bg-white border ${tab === 'unpaid_comm' ? 'border-violet-500 ring-2 ring-violet-200' : 'border-violet-200'} rounded-xl p-3 shadow-2xs cursor-pointer transition">
          <div class="text-[11px] font-bold text-violet-900 flex items-center justify-between">
            <span>💎 커미션 장기 미입금</span>
            <span class="text-[10px] bg-violet-100 text-violet-800 px-1.5 py-0.2 rounded font-black">${commTotalCnt}건</span>
          </div>
          <div class="text-base sm:text-lg font-black text-violet-800 font-mono mt-1">$${commTotalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div class="text-[10px] text-slate-500 mt-0.5">선적 후 45일 이상 미정산 커미션</div>
        </div>

        <div onclick="window.switchActionInboxTab('aging_stock')" class="bg-white border ${tab === 'aging_stock' ? 'border-amber-500 ring-2 ring-amber-200' : 'border-amber-200'} rounded-xl p-3 shadow-2xs cursor-pointer transition">
          <div class="text-[11px] font-bold text-amber-900 flex items-center justify-between">
            <span>📦 90일+ 장기 체화 재고</span>
            <span class="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded font-black">${agingStocks.length}건</span>
          </div>
          <div class="text-base sm:text-lg font-black text-amber-900 font-mono mt-1">$${Math.round(agingTotalUsd).toLocaleString()}</div>
          <div class="text-[10px] text-slate-500 mt-0.5">≈ ₩${Math.round(agingTotalKrw / 10000).toLocaleString()}만원 소진 타겟</div>
        </div>

        <div onclick="window.switchActionInboxTab('borrows_po')" class="bg-white border ${tab === 'borrows_po' ? 'border-teal-500 ring-2 ring-teal-200' : 'border-teal-200'} rounded-xl p-3 shadow-2xs cursor-pointer transition">
          <div class="text-[11px] font-bold text-teal-900 flex items-center justify-between">
            <span>🔄 대여 미반납 &amp; 납기지연 PO</span>
            <span class="text-[10px] bg-teal-100 text-teal-800 px-1.5 py-0.2 rounded font-black">${brwPoCnt}건</span>
          </div>
          <div class="text-base sm:text-lg font-black text-teal-900 font-mono mt-1">대여 ${brwList.length} · 발주 ${poList.length}</div>
          <div class="text-[10px] text-slate-500 mt-0.5">21일+ 미반납 샘플 및 ETA 경과 PO</div>
        </div>
      </div>

      <div class="px-4 py-2 bg-white border-b border-slate-200 flex items-center gap-1.5 overflow-x-auto shrink-0">
        <button type="button" onclick="window.switchActionInboxTab('unpaid_dom')" class="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap transition ${tab === 'unpaid_dom' ? 'bg-rose-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'}">🚨 Domestic 연체 미수 (${domTotalCnt})</button>
        <button type="button" onclick="window.switchActionInboxTab('unpaid_comm')" class="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap transition ${tab === 'unpaid_comm' ? 'bg-violet-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'}">💎 Commission 미입금 (${commTotalCnt})</button>
        <button type="button" onclick="window.switchActionInboxTab('aging_stock')" class="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap transition ${tab === 'aging_stock' ? 'bg-amber-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'}">📦 90일+ 장기재고 (${agingStocks.length})</button>
        <button type="button" onclick="window.switchActionInboxTab('borrows_po')" class="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap transition ${tab === 'borrows_po' ? 'bg-teal-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'}">🔄 대여 미반납(${brwList.length}) · 🚢 지연 PO(${poList.length})</button>
      </div>

      <div class="flex-1 overflow-y-auto p-3 sm:p-4 bg-slate-50/70">
        ${bodyHtml}
      </div>
    </div>
  `;
}
