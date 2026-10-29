/**
 * 반도체 견적 및 마진 방어 계산 엔진
 */
export function computeQuotation({ 
  unitUsd, 
  qty, 
  shipFx, 
  overheadRate, 
  targetMarginRate, 
  appliedFxRate, 
  targetOfferUsd,
  isSpa = false,
  approvedDebitUsd = 0
}) {
  // SPA 승인 건인 경우, 본사 승인 매입가(Approved Debit)를 실제 원가 기준으로 계산
  const effectiveBaseUsd = (isSpa && approvedDebitUsd > 0) ? approvedDebitUsd : unitUsd;
  const loadedUnitUsd = effectiveBaseUsd * (1 + overheadRate);
  
  // 1) 창고 재고 기준 원가 (선적 환율)
  const unitActualCostKrw = loadedUnitUsd * shipFx;
  // 2) 라인 재발주 기준 원가 (현재 환율)
  const unitReplaceCostKrw = loadedUnitUsd * appliedFxRate;

  const totalActualCostKrw = unitActualCostKrw * qty;
  const totalReplaceCostKrw = unitReplaceCostKrw * qty;
  const totalUsdCost = loadedUnitUsd * qty;

  const unitMinPriceActualKrw = targetMarginRate < 1 ? (unitActualCostKrw / (1 - targetMarginRate)) : 0;
  const unitMinPriceReplaceKrw = targetMarginRate < 1 ? (unitReplaceCostKrw / (1 - targetMarginRate)) : 0;

  const unitMinPriceActualUsd = appliedFxRate > 0 ? (unitMinPriceActualKrw / appliedFxRate) : 0;
  const unitMinPriceReplaceUsd = appliedFxRate > 0 ? (unitMinPriceReplaceKrw / appliedFxRate) : 0;

  const totalMinPriceActualUsd = unitMinPriceActualUsd * qty;
  const totalMinPriceReplaceUsd = unitMinPriceReplaceUsd * qty;

  let expectedMargin = null;
  if (targetOfferUsd > 0) {
    expectedMargin = ((targetOfferUsd - loadedUnitUsd) / targetOfferUsd) * 100;
  }

  return {
    loadedUnitUsd,
    unitActualCostKrw,
    unitReplaceCostKrw,
    totalUsdCost,
    totalActualCostKrw,
    totalReplaceCostKrw,
    unitMinPriceActualUsd,
    unitMinPriceActualKrw,
    totalMinPriceActualUsd,
    unitMinPriceReplaceUsd,
    unitMinPriceReplaceKrw,
    totalMinPriceReplaceUsd,
    expectedMargin
  };
}

/**
 * [무역 실무] 선적 부대비용 자동 배부 계산 함수 (Value-based Landed Cost Allocation)
 */
export function computeAllocatedOverheadRate(totalShipmentValueUsd, totalOverheadExpenseUsd) {
  if (!totalShipmentValueUsd || totalShipmentValueUsd <= 0) return 0;
  return (totalOverheadExpenseUsd / totalShipmentValueUsd) * 100;
}

/**
 * [무역 실무] 결제 시점 외환 차손익(FX Variance) 계산
 * @param {number} soldPriceUsd - 판매단가 ($)
 * @param {number} qty          - 출하 수량 (EA)
 * @param {number} orderFx      - 수주/선적 당시 환율
 * @param {number} settledFx    - 실제 입금/수금 환율
 */
export function computeFxVariance(soldPriceUsd, qty, orderFx, settledFx) {
  if (!soldPriceUsd || !qty || !orderFx || !settledFx) return 0;
  const expectedKrw = soldPriceUsd * qty * orderFx;
  const actualKrw = soldPriceUsd * qty * settledFx;
  return actualKrw - expectedKrw; // (+) 환차익, (-) 환차손
}
