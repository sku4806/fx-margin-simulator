// public/js/shipments.js
import { sbClient } from './supabase.js';

let cachedShipments = [];

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

export async function fetchShipments() {
  if (!sbClient) {
    console.error("Supabase client not initialized");
    return [];
  }

  // 1. inventory_items에서 '출하완료' 상태인 품목들이 legacy_shipments에 누락되어 있는지 자가 복구 (Auto-Heal Sync)
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
    console.warn("출하완료 자동 보정 예외:", healErr);
  }

  // 2. 출하 이력 목록 로드 (출하일자 내림차순, 최신 동기화순)
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
  return cachedShipments;
}

export function renderShipmentsView(containerId = "shipmentsSection") {
  const container = document.getElementById(containerId);
  if (!container) return;

  const totalQty = cachedShipments.reduce((sum, item) => sum + (item.qty || 0), 0);
  const totalSales = cachedShipments.reduce((sum, item) => sum + (item.total_sales_amount || 0), 0);

  container.innerHTML = `
    <!-- 출하/수주 이력 메인 카드 래퍼 (기존 재고 관리 카드 규격과 일치) -->
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
          <span class="text-slate-500 font-sans font-normal text-[11px]">(${cachedShipments.length}건)</span>
        </div>
        <div class="flex items-center gap-4 text-xs">
          <div>총 출하수량: <span class="text-indigo-900 font-black">${totalQty.toLocaleString()}</span> EA</div>
          <div>총 매출액: <span class="text-rose-700 font-black">₩${Math.round(totalSales).toLocaleString()}</span></div>
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
            </tr>
          </thead>
          <tbody id="shipmentTableBody" class="divide-y divide-slate-100 font-medium bg-white text-slate-700">
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
    return `<tr><td colspan="8" class="text-center py-8 text-slate-400">조회된 출하/수주 이력이 없습니다.</td></tr>`;
  }
  return items.map(item => `
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
    </tr>
  `).join('');
}
