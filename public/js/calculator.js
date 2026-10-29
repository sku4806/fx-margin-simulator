/**
 * 반도체 견적 및 마진 방어 계산 엔진
 */
export function computeQuotation({ unitUsd, qty, shipFx, overheadRate, targetMarginRate, appliedFxRate, targetOfferUsd }) {
  // 개당 부대비용(관세/운임) 포함 매입원가
  const loadedUnitUsd = unitUsd * (1 + overheadRate);
  
  // 1) 창고 재고 기준 원가 (선적 당시 환율 적용)
  const unitActualCostKrw = loadedUnitUsd * shipFx;
  // 2) 라인 재발주 기준 원가 (현재 변동 환율 적용)
  const unitReplaceCostKrw = loadedUnitUsd * appliedFxRate;

  const totalActualCostKrw = unitActualCostKrw * qty;
  const totalReplaceCostKrw = unitReplaceCostKrw * qty;
  const totalUsdCost = loadedUnitUsd * qty;

  // 마진 방어 최저 견적가 산출 공식: 원가 / (1 - 목표마진율)
  const unitMinPriceActualKrw = targetMarginRate < 1 ? (unitActualCostKrw / (1 - targetMarginRate)) : 0;
  const unitMinPriceReplaceKrw = targetMarginRate < 1 ? (unitReplaceCostKrw / (1 - targetMarginRate)) : 0;

  const unitMinPriceActualUsd = appliedFxRate > 0 ? (unitMinPriceActualKrw / appliedFxRate) : 0;
  const unitMinPriceReplaceUsd = appliedFxRate > 0 ? (unitMinPriceReplaceKrw / appliedFxRate) : 0;

  const totalMinPriceActualUsd = unitMinPriceActualUsd * qty;
  const totalMinPriceReplaceUsd = unitMinPriceReplaceUsd * qty;

  let expectedMargin = null;
  if (targetOfferUsd > 0) {
    // 고객 희망 단가 제시 시 실현 마진율 역산: (제시가 - 원가) / 제시가 * 100
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
 * --------------------------------------------------------------------------------
 * @param {number} totalShipmentValueUsd  - 해당 선적에 포함된 전체 품목 물품대금 총액 ($)
 * @param {number} totalOverheadExpenseUsd - 포워더 운임($) + 관세청 수입세금($ 환산)의 총합
 * 
 * [원리 및 공식]
 * 여러 파트(A, B, C...)가 한 컨테이너/항공편으로 함께 선적되어 운임 및 세금이 묶음 청구되었을 때,
 * 부피 대비 단가가 높은 반도체 IC 특성에 맞춰 "물품 가액 비율(Value-based)"로 배부합니다.
 * 
 * 공식: 가산율(%) = (총 부대비용 $ / 전체 물품가액 $) * 100
 * 
 * 산출된 가산율(%)은 각 파트의 매입단가에 공통 적용되어, 각 파트별 개당 랜디드 코스트(도착원가)를 정확히 확정합니다.
 */
export function computeAllocatedOverheadRate(totalShipmentValueUsd, totalOverheadExpenseUsd) {
  if (!totalShipmentValueUsd || totalShipmentValueUsd <= 0) return 0;
  return (totalOverheadExpenseUsd / totalShipmentValueUsd) * 100;
}
