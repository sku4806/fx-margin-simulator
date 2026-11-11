// public/js/shipments.js
import { sbClient } from './supabase.js';
import { openInvoiceModal, openPackingListModal } from './trade-documents.js';

let cachedShipments = [];
let shipmentPage = 1;
let shipmentPageSize = 50;
let lastFilteredShipments = [];
let lastHealTime = 0;
const HEAL_INTERVAL_MS = 10 * 60 * 1000; // 10분에 1회만 자동 보정 검사

function debounce(func, wait = 200) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

async function triggerAutoHealInBackground() {
  const now = Date.now();
  if (now - lastHealTime < HEAL_INTERVAL_MS) return;
  lastHealTime = now;

  try {
    const { data: shippedItems } = await sbClient
      .from('inventory_items')
      .select('*')
      .eq('order_status', '출하완료');

    if (shippedItems && shippedItems.length > 0) {
      const { data: existingShipments } = await sbClient
        .from('legacy_shipments')
        .select('inventory_item_id')
        .not('inventory_item_id', 'is', null);

      const existingIds = new Set((existingShipments || []).map(s => String(s.inventory_item_id)));

      for (const item of shippedItems) {
        if (!existingIds.has(String(item.id))) {
          await syncShipmentLifecycle(item.id, item, item);
        }
      }
    }
  } catch (healErr) {
    console.warn("출하완료 자동 보정 백그라운드 예외:", healErr);
  }
}

export async function fetchShipments() {
  if (!sbClient) {
    console.error("Supabase client not initialized");
    return [];
  }

  // 1. 출하완료 건 누락 보정은 UI 블로킹 없이 백그라운드 비동기로 실행
  triggerAutoHealInBackground();

  // 2. 출하 이력 목록 고속 로드 (출하일자 내림차순, 최신 동기화순)
  const { data, error } = await sbClient
    .from('legacy_shipments')
    .select('*')
    .order('order_date', { ascending: false })
    .order('last_synced_at', { ascending: false, nullsFirst: false });

  if (error) {
    console.error("출하 이력 로드 실패:", error);
    return [];
  }
  cachedShipments = data || [];
  lastFilteredShipments = cachedShipments;
  return cachedShipments;
}

export function renderShipmentsView(containerId = "shipmentsSection") {
  const container = document.getElementById(containerId);
  if (!container) return;

  lastFilteredShipments = cachedShipments;
  shipmentPage = 1;

  const totalQty = cachedShipments.reduce((sum, item) => sum + (item.qty || 0), 0);
  const totalSales = cachedShipments.reduce((sum, item) => sum + (item.total_sales_amount || 0), 0);

  container.innerHTML = `
    <!-- 출하/수주 이력 메인 카드 래퍼 -->
    <div class="bg-white p-3.5 sm:p-6 rounded-2xl shadow-sm border border-slate-200 space-y-3 sm:space-y-4">
      
      <!-- 상단 헤더 & 검색 바 -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-200 pb-3">
        <div>
          <h2 class="font-black text-xs sm:text-base tracking-wide text-slate-900 flex items-center gap-1.5">
            <span>🚚</span> 출하 및 수주 완료 이력 (Shipment History)
          </h2>
          <p class="text-[10px] sm:text-[11px] text-slate-400 mt-0.5">레거시 ERP 및 시스템을 통해 최종 출하 완료된 실적 내역입니다.</p>
        </div>

        <div class="flex items-center gap-2">
          <div class="relative w-full sm:w-64">
            <input type="text" id="shipmentSearchInput" placeholder="품번(Part#), 제조사, PO NO 검색..." 
                   class="w-full pl-7 pr-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none">
            <span class="absolute left-2.5 top-2 text-slate-400 text-xs">🔍</span>
          </div>
        </div>
      </div>

      <!-- 요약 바 (Grand Summaries 규격 일치) -->
      <div class="bg-amber-50/90 border border-amber-200 rounded-xl p-2.5 text-xs font-mono font-bold text-slate-800 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div class="flex items-center gap-2">
          <span class="text-amber-800 font-sans font-black">출하/수주 Grand Summaries</span>
          <span id="shipmentSummaryCount" class="text-slate-500 font-sans font-normal text-[11px]">(${cachedShipments.length.toLocaleString()}건)</span>
        </div>
        <div class="flex items-center gap-4 text-xs">
          <div>총 출하수량: <span id="shipmentSumQty" class="text-indigo-900 font-black">${totalQty.toLocaleString()}</span> EA</div>
          <div>총 매출액: <span id="shipmentSumSales" class="text-rose-700 font-black">₩${Math.round(totalSales).toLocaleString()}</span></div>
        </div>
      </div>

      <!-- 출하 테이블 (내부 스크롤 및 컴팩트 레이아웃) -->
      <div class="overflow-x-auto max-h-[65vh] overflow-y-auto border border-slate-200 rounded-xl shadow-xs">
        <table class="w-full text-left text-xs border-collapse">
          <thead class="bg-slate-100/95 backdrop-blur-sm text-slate-600 border-b uppercase font-semibold sticky top-0 z-10 shadow-sm text-[11px]">
            <tr>
              <th class="py-2.5 px-3 text-center whitespace-nowrap w-[10%]">출하일자</th>
              <th class="py-2.5 px-3 text-left w-[24%]">품번 (Part#)</th>
              <th class="py-2.5 px-3 text-left w-[12%]">제조사</th>
              <th class="py-2.5 px-3 text-right whitespace-nowrap w-[10%]">수량</th>
              <th class="py-2.5 px-3 text-right whitespace-nowrap w-[12%]">단가(₩)</th>
              <th class="py-2.5 px-3 text-right whitespace-nowrap w-[14%]">총 매출액(₩)</th>
              <th class="py-2.5 px-3 text-left w-[12%]">PO 번호</th>
              <th class="py-2.5 px-3 text-center whitespace-nowrap w-[6%]">상태</th>
              <th class="py-2.5 px-3 text-center whitespace-nowrap w-[14%] no-print">문서 출력</th>
            </tr>
          </thead>
          <tbody id="shipmentTableBody" class="divide-y divide-slate-100 font-medium bg-white text-slate-700">
            ${generateTableRows(getPagedShipments())}
          </tbody>
        </table>
      </div>

      <!-- 📄 출하 페이지네이션 컨트롤러 -->
      <div id="shipmentPagination" class="flex flex-wrap items-center justify-between gap-2 pt-2 px-1 text-xs select-none"></div>
    </div>
  `;

  renderShipmentPaginationUI();

  // 200ms 디바운스 적용 검색 리스너
  const searchInput = document.getElementById("shipmentSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", debounce((e) => {
      const q = e.target.value.toLowerCase().trim();
      lastFilteredShipments = cachedShipments.filter(item => 
        (item.part_name && item.part_name.toLowerCase().includes(q)) ||
        (item.maker && item.maker.toLowerCase().includes(q)) ||
        (item.po_no && item.po_no.toLowerCase().includes(q))
      );
      shipmentPage = 1;
      updateShipmentCurrentPage();
    }, 200));
  }
}

function getPagedShipments() {
  if (shipmentPageSize === 'ALL') return lastFilteredShipments;
  const start = (shipmentPage - 1) * shipmentPageSize;
  return lastFilteredShipments.slice(start, start + shipmentPageSize);
}

function updateShipmentCurrentPage() {
  const tbody = document.getElementById("shipmentTableBody");
  if (tbody) tbody.innerHTML = generateTableRows(getPagedShipments());
  
  // 합계 업데이트
  const totalQty = lastFilteredShipments.reduce((sum, item) => sum + (item.qty || 0), 0);
  const totalSales = lastFilteredShipments.reduce((sum, item) => sum + (item.total_sales_amount || 0), 0);

  const elCount = document.getElementById("shipmentSummaryCount");
  const elQty = document.getElementById("shipmentSumQty");
  const elSales = document.getElementById("shipmentSumSales");

  if (elCount) elCount.innerText = `(${lastFilteredShipments.length.toLocaleString()}건)`;
  if (elQty) elQty.innerText = totalQty.toLocaleString();
  if (elSales) elSales.innerText = `₩${Math.round(totalSales).toLocaleString()}`;

  renderShipmentPaginationUI();
}

function renderShipmentPaginationUI() {
  const container = document.getElementById("shipmentPagination");
  if (!container) return;

  const total = lastFilteredShipments.length;
  if (total === 0) {
    container.innerHTML = '';
    return;
  }

  const totalPages = (shipmentPageSize === 'ALL') ? 1 : Math.max(1, Math.ceil(total / shipmentPageSize));
  if (shipmentPage > totalPages) shipmentPage = totalPages;
  if (shipmentPage < 1) shipmentPage = 1;

  const startIdx = (shipmentPageSize === 'ALL') ? 1 : (shipmentPage - 1) * shipmentPageSize + 1;
  const endIdx = (shipmentPageSize === 'ALL') ? total : Math.min(shipmentPage * shipmentPageSize, total);

  let pageButtons = '';
  const maxButtons = 5;
  let startP = Math.max(1, shipmentPage - 2);
  let endP = Math.min(totalPages, startP + maxButtons - 1);
  if (endP - startP < maxButtons - 1) startP = Math.max(1, endP - maxButtons + 1);

  for (let p = startP; p <= endP; p++) {
    const isCurrent = (p === shipmentPage);
    pageButtons += `
      <button type="button" onclick="window.goToShipmentPage(${p})" 
              class="w-7 h-7 flex items-center justify-center rounded-lg text-xs font-bold transition-colors ${isCurrent ? 'bg-indigo-600 text-white shadow-xs' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 cursor-pointer'}">
        ${p}
      </button>
    `;
  }

  container.innerHTML = `
    <div class="flex items-center gap-2 text-slate-500 text-[11px]">
      <span class="font-bold text-slate-800">${startIdx.toLocaleString()} - ${endIdx.toLocaleString()}</span> / 전체 <strong class="text-indigo-900 font-black">${total.toLocaleString()}</strong>건
      <span class="text-slate-300">|</span>
      <span>${shipmentPage} / ${totalPages} 페이지</span>
    </div>

    <div class="flex items-center gap-1.5">
      <button type="button" onclick="window.goToShipmentPage(${shipmentPage - 1})" 
              ${shipmentPage <= 1 ? 'disabled class="px-2 py-1 bg-slate-100 text-slate-400 rounded-lg text-xs cursor-not-allowed"' : 'class="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold rounded-lg text-xs transition-colors cursor-pointer"'}>
        ◀ 이전
      </button>
      
      <div class="flex items-center gap-1">
        ${pageButtons}
      </div>

      <button type="button" onclick="window.goToShipmentPage(${shipmentPage + 1})" 
              ${shipmentPage >= totalPages ? 'disabled class="px-2 py-1 bg-slate-100 text-slate-400 rounded-lg text-xs cursor-not-allowed"' : 'class="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold rounded-lg text-xs transition-colors cursor-pointer"'}>
        다음 ▶
      </button>

      <span class="text-slate-300 mx-1">|</span>

      <select id="selectShipmentPageSize" onchange="window.setShipmentPageSize(this.value)" class="bg-white border border-slate-300 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-700 outline-none cursor-pointer">
        <option value="50" ${shipmentPageSize === 50 ? 'selected' : ''}>50개씩</option>
        <option value="100" ${shipmentPageSize === 100 ? 'selected' : ''}>100개씩</option>
        <option value="200" ${shipmentPageSize === 200 ? 'selected' : ''}>200개씩</option>
        <option value="ALL" ${shipmentPageSize === 'ALL' ? 'selected' : ''}>전체 (${total})</option>
      </select>
    </div>
  `;
}

window.goToShipmentPage = function(page) {
  shipmentPage = page;
  updateShipmentCurrentPage();
};

window.getShipmentByIndex = function(idx) {
  const paged = getPagedShipments();
  return paged[idx] || null;
};

window.setShipmentPageSize = function(size) {
  shipmentPageSize = (size === 'ALL') ? 'ALL' : parseInt(size, 10);
  shipmentPage = 1;
  updateShipmentCurrentPage();
};

// ========================================================
// 🔄 출하완료(SHIPPED) 양방향 동기화 및 롤백 엔진
// ========================================================
export async function syncShipmentLifecycle(itemId, payload, origItem = null) {
  if (!itemId || !sbClient) return;

  const currentStatus = String(payload.order_status || payload.orderStatus || origItem?.order_status || '').trim();

  if (currentStatus === '출하완료') {
    try {
      const todayStr = new Date().toISOString().slice(0, 10);
      const shipDate = payload.shipped_date || payload.shippedDate || origItem?.shipped_date || origItem?.shippedDate || todayStr;
      const shipQty = Number(payload.arranged_qty ?? payload.arrangedQty ?? payload.stock ?? origItem?.stock ?? 1);
      const fx = Number(payload.ship_fx ?? payload.shipFx ?? origItem?.ship_fx ?? 1350) || 1350;

      const soldUsd = Number(payload.sold_price_usd ?? payload.soldPriceUsd ?? origItem?.sold_price_usd ?? 0);
      const unitUsd = Number(payload.unit_usd ?? payload.unitUsd ?? origItem?.unit_usd ?? 0);
      const effectiveUnitUsd = soldUsd > 0 ? soldUsd : unitUsd;

      const unitKrw = Math.round(effectiveUnitUsd * fx);
      const costKrw = Math.round(unitUsd * fx);
      const totalSales = unitKrw * shipQty;

      const partName = payload.part_name || payload.partName || origItem?.part_name || origItem?.partName || 'UNKNOWN';
      const maker = payload.maker || origItem?.maker || 'OTHERS';
      const poNo = payload.po_no || payload.poNo || payload.tracking_no || payload.trackingNo || origItem?.po_no || origItem?.tracking_no || 'WEB-MANUAL';

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(itemId));

      const shipmentRecord = {
        inventory_item_id: isUuid ? String(itemId) : null,
        part_name: partName,
        maker: maker,
        qty: shipQty,
        unit_price: unitKrw,
        cost_price: costKrw,
        total_sales_amount: totalSales,
        po_no: poNo,
        order_date: shipDate,
        status: 'SHIPPED',
        last_synced_at: new Date().toISOString()
      };

      let existing = null;
      if (isUuid) {
        const { data } = await sbClient
          .from('legacy_shipments')
          .select('id')
          .eq('inventory_item_id', String(itemId))
          .limit(1);
        existing = data;
      }

      if (existing && existing.length > 0) {
        await sbClient.from('legacy_shipments').update(shipmentRecord).eq('id', existing[0].id);
        console.log(`✅ [legacy_shipments] 출하 이력 업데이트 성공: ${partName} (${itemId})`);
      } else {
        await sbClient.from('legacy_shipments').insert([shipmentRecord]);
        console.log(`✅ [legacy_shipments] 출하 이력 신규 등록 성공: ${partName} (${itemId})`);
      }
    } catch (shipErr) {
      console.error("❌ [legacy_shipments] 출하 이력 동기화 에러:", shipErr);
    }
  } else {
    // '출하완료'가 아닌 다른 상태로 변경/롤백 시, 기존 등록된 출하 이력 자동 회수 (삭제)
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(itemId));
      if (isUuid) {
        const { error: delErr } = await sbClient
          .from('legacy_shipments')
          .delete()
          .eq('inventory_item_id', String(itemId));
        if (!delErr) {
          console.log(`ℹ️ [legacy_shipments] 상태 롤백(${currentStatus}) -> 출하 이력 자동 삭제 완료 (${itemId})`);
        }
      }
    } catch (delErr) {
      console.error("❌ [legacy_shipments] 출하 이력 회수 실패:", delErr);
    }
  }
}

function generateTableRows(items) {
  if (!items || items.length === 0) {
    return `<tr><td colspan="9" class="text-center py-8 text-slate-400">조회된 출하/수주 이력이 없습니다.</td></tr>`;
  }
  return items.map((item, idx) => `
    <tr class="hover:bg-indigo-50/70 transition-colors border-b border-slate-100 text-[11px]">
      <td class="py-2 px-3 text-center font-mono text-slate-500 whitespace-nowrap">${item.order_date || '-'}</td>
      <td class="py-2 px-3 font-bold text-slate-900">${item.part_name}</td>
      <td class="py-2 px-3 text-slate-600">${item.maker || '-'}</td>
      <td class="py-2 px-3 text-right font-black text-slate-900 whitespace-nowrap">${(item.qty || 0).toLocaleString()} EA</td>
      <td class="py-2 px-3 text-right font-mono text-slate-700 whitespace-nowrap">₩${Math.round(item.unit_price || 0).toLocaleString()}</td>
      <td class="py-2 px-3 text-right font-mono font-bold text-rose-600 whitespace-nowrap">₩${Math.round(item.total_sales_amount || 0).toLocaleString()}</td>
      <td class="py-2 px-3 font-mono text-slate-500 text-[10px] truncate max-w-[150px]" title="${item.po_no || '-'}">${item.po_no || '-'}</td>
      <td class="py-2 px-3 text-center whitespace-nowrap">
        <span class="inline-block px-2 py-0.5 text-[9px] font-bold rounded-full ${item.status === 'SHIPPED' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">
          ${item.status === 'SHIPPED' ? '출하완료' : '진행중'}
        </span>
      </td>
      <td class="py-2 px-3 text-center whitespace-nowrap no-print" onclick="event.stopPropagation()">
        <div class="inline-flex items-center gap-1">
          <button type="button" onclick="window.openTradeInvoice && window.openTradeInvoice(window.getShipmentByIndex(${idx}))" 
                  class="px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded border border-indigo-200 text-[10px] font-bold transition-colors cursor-pointer" title="공식 거래명세서 출력">
            📄 명세서
          </button>
          <button type="button" onclick="window.openTradePacking && window.openTradePacking(window.getShipmentByIndex(${idx}))" 
                  class="px-2 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded border border-amber-300 text-[10px] font-bold transition-colors cursor-pointer" title="공식 패킹리스트 출력">
            📦 패킹
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}
