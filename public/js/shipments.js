// public/js/shipments.js
import { sbClient } from './supabase.js';

let cachedShipments = [];

export async function fetchShipments() {
  if (!sbClient) {
    console.error("Supabase client not initialized");
    return [];
  }
  const { data, error } = await sbClient
    .from('legacy_shipments')
    .select('*')
    .order('order_date', { ascending: false })
    .order('legacy_out_id', { ascending: false });

  if (error) {
    console.error("출하 이력 로드 실패:", error);
    alert("출하 이력 로드 실패: Supabase SQL Editor에서 'ALTER TABLE public.legacy_shipments DISABLE ROW LEVEL SECURITY;'를 실행해 주세요.");
    return [];
  }
  cachedShipments = data || [];
  return cachedShipments;
}

export function renderShipmentsView(containerId = "shipmentsSection") {
  const container = document.getElementById(containerId);
  if (!container) return;

  const totalQty = cachedShipments.reduce((sum, item) => sum + (item.qty || 0), 0);
  const totalSales = cachedShipments.reduce((sum, item) => sum + (item.total_sales_amount || 0), 0);

  container.innerHTML = `
    <div class="space-y-4 pt-2">
      <!-- 상단 요약 카드 -->
      <div class="bg-amber-50/80 border border-amber-200/90 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 text-xs shadow-sm">
        <div class="font-bold text-amber-900 text-sm flex items-center gap-2">
          <span>🚚 최근 출하/수주 Grand Summaries</span>
          <span class="text-xs font-normal text-amber-700">(${cachedShipments.length}건)</span>
        </div>
        <div class="flex flex-wrap items-center gap-5 text-slate-700">
          <div>총 출하수량: <span class="font-bold text-slate-900">${totalQty.toLocaleString()} EA</span></div>
          <div>총 매출액: <span class="font-bold text-rose-600">₩${Math.round(totalSales).toLocaleString()}</span></div>
        </div>
      </div>

      <!-- 검색 바 -->
      <div class="flex items-center gap-2">
        <input type="text" id="shipmentSearchInput" placeholder="품번(Part#), 제조사, PO NO 검색..." 
               class="w-full sm:w-80 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none shadow-sm">
      </div>

      <!-- 출하 내역 테이블 -->
      <div class="overflow-x-auto bg-white border border-slate-200 rounded-xl shadow-sm">
        <table class="w-full text-left border-collapse text-xs">
          <thead class="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
            <tr>
              <th class="py-2.5 px-3">출하일자</th>
              <th class="py-2.5 px-3">품번 (Part#)</th>
              <th class="py-2.5 px-3">제조사</th>
              <th class="py-2.5 px-3 text-right">수량</th>
              <th class="py-2.5 px-3 text-right">단가(₩)</th>
              <th class="py-2.5 px-3 text-right">총 매출액(₩)</th>
              <th class="py-2.5 px-3">PO 번호</th>
              <th class="py-2.5 px-3 text-center">상태</th>
            </tr>
          </thead>
          <tbody id="shipmentTableBody" class="divide-y divide-slate-100 text-slate-700">
            ${generateTableRows(cachedShipments)}
          </tbody>
        </table>
      </div>
    </div>
  `;

  const searchInput = document.getElementById("shipmentSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase().trim();
      const filtered = cachedShipments.filter(item => 
        (item.part_name && item.part_name.toLowerCase().includes(q)) ||
        (item.maker && item.maker.toLowerCase().includes(q)) ||
        (item.po_no && item.po_no.toLowerCase().includes(q))
      );
      const tbody = document.getElementById("shipmentTableBody");
      if (tbody) tbody.innerHTML = generateTableRows(filtered);
    });
  }
}

function generateTableRows(items) {
  if (!items || items.length === 0) {
    return '<tr><td colspan="8" class="text-center py-8 text-slate-400">출하/수주 이력이 없습니다.</td></tr>';
  }
  return items.map(item => `
    <tr class="hover:bg-slate-50/80 transition-colors">
      <td class="py-2.5 px-3 font-mono text-slate-500">${item.order_date || '-'}</td>
      <td class="py-2.5 px-3 font-bold text-slate-900">${item.part_name}</td>
      <td class="py-2.5 px-3 text-slate-600">${item.maker || '-'}</td>
      <td class="py-2.5 px-3 text-right font-semibold text-slate-800">${(item.qty || 0).toLocaleString()} EA</td>
      <td class="py-2.5 px-3 text-right font-mono text-slate-700">₩${Math.round(item.unit_price || 0).toLocaleString()}</td>
      <td class="py-2.5 px-3 text-right font-mono font-bold text-rose-600">₩${Math.round(item.total_sales_amount || 0).toLocaleString()}</td>
      <td class="py-2.5 px-3 font-mono text-slate-500">${item.po_no || '-'}</td>
      <td class="py-2.5 px-3 text-center">
        <span class="inline-block px-2 py-0.5 text-[10px] font-bold rounded-full ${item.status === 'SHIPPED' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">
          ${item.status === 'SHIPPED' ? '출하완료' : '진행중'}
        </span>
      </td>
    </tr>
  `).join('');
}
