export function computeKpiMetrics(items, currentFx) {
  let totalInventoryKrw = 0;
  let totalUnpaidKrw = 0;
  let dueThisMonthKrw = 0;
  let deadStockCount = 0;
  let deadStockKrw = 0;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  items.forEach(item => {
    const fx = item.shipFx || currentFx || 1350;
    const itemCostKrw = item.unitUsd * item.stock * fx;
    
    // 1. 총 재고 평가액
    totalInventoryKrw += itemCostKrw;

    // 2. 미수금 총액
    if (item.paymentStatus === '미수' && item.soldPriceUsd > 0) {
      const soldKrw = item.soldPriceUsd * item.stock * fx;
      totalUnpaidKrw += soldKrw;

      // 3. 당월 만기 도래 채권
      if (item.dueDate) {
        const d = new Date(item.dueDate);
        if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) {
          dueThisMonthKrw += soldKrw;
        }
      }
    }

    // 4. Dead Stock (본사 일반재고 또는 잉여재고 표시건)
    if (item.owner === '본사 일반재고' || (item.memo && item.memo.includes('Dead Stock'))) {
      deadStockCount += 1;
      deadStockKrw += itemCostKrw;
    }
  });

  return {
    totalInventoryKrw,
    totalUnpaidKrw,
    dueThisMonthKrw,
    deadStockCount,
    deadStockKrw
  };
}

export function renderKpiBar(metrics) {
  const container = document.getElementById('kpiSummaryBar');
  if (!container) return;

  container.innerHTML = `
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
      <div class="p-2.5 bg-slate-50 border border-slate-200 rounded-xl space-y-0.5">
        <span class="text-[10px] text-slate-500 font-semibold block">총 보유 재고자산</span>
        <div class="text-sm sm:text-base font-black text-slate-900">₩${Math.round(metrics.totalInventoryKrw).toLocaleString()}</div>
      </div>
      <div class="p-2.5 bg-rose-50/60 border border-rose-200/80 rounded-xl space-y-0.5">
        <span class="text-[10px] text-rose-700 font-semibold block">외상 미수금 (A/R)</span>
        <div class="text-sm sm:text-base font-black text-rose-800">₩${Math.round(metrics.totalUnpaidKrw).toLocaleString()}</div>
      </div>
      <div class="p-2.5 bg-amber-50/60 border border-amber-200/80 rounded-xl space-y-0.5">
        <span class="text-[10px] text-amber-800 font-semibold block">당월 입금 예정 채권</span>
        <div class="text-sm sm:text-base font-black text-amber-900">₩${Math.round(metrics.dueThisMonthKrw).toLocaleString()}</div>
      </div>
      <div class="p-2.5 bg-indigo-50/60 border border-indigo-200/80 rounded-xl space-y-0.5">
        <span class="text-[10px] text-indigo-700 font-semibold block">Dead Stock (공용 잉여재고)</span>
        <div class="text-sm sm:text-base font-black text-indigo-950">${metrics.deadStockCount}건 <span class="text-[11px] font-normal text-slate-600">(₩${Math.round(metrics.deadStockKrw).toLocaleString()})</span></div>
      </div>
    </div>
  `;
}
