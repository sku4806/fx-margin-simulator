// 대표 라인별 표준 포장 단위 (SPQ) 가이드 기본값
const DEFAULT_SPQ_MAP = {
  'GigaDevice': 2500,
  'ISSI': 2000,
  'XMOS': 1000,
  'Silicon Motion': 1000,
  'ESMT': 2000,
  'Lumissil': 2500
};

export function validateSpq(maker, qty) {
  const spq = DEFAULT_SPQ_MAP[maker] || 1000;
  if (!qty || qty <= 0) return { isValid: true, spq };

  const remainder = qty % spq;
  const isMultiple = (remainder === 0);
  const recommendedQty = Math.ceil(qty / spq) * spq;

  return {
    isValid: isMultiple,
    spq,
    remainder,
    recommendedQty
  };
}
