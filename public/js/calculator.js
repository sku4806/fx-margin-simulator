export function computeQuotation({ unitUsd, qty, shipFx, overheadRate, targetMarginRate, appliedFxRate, targetOfferUsd }) {
  const loadedUnitUsd = unitUsd * (1 + overheadRate);
  const unitActualCostKrw = loadedUnitUsd * shipFx;
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

// 통합 선적 부대비용 배부율 계산 (Value-based Allocation)
export function computeAllocatedOverheadRate(totalShipmentValueUsd, totalOverheadExpenseUsd) {
  if (!totalShipmentValueUsd || totalShipmentValueUsd <= 0) return 0;
  return (totalOverheadExpenseUsd / totalShipmentValueUsd) * 100;
}
