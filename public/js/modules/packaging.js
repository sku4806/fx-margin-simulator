/**
 * 📦 제조사 MOQ / SPQ 릴(Reel) 포장 단위 검증 및 보정 모듈
 */

export const LINE_SPQ_MAP = {
  'GigaDevice': 2500,
  'ISSI': 2000,
  'Lumissil': 2500,
  'XMOS': 1000,
  'Silicon Motion': 1000,
  'ESMT': 2000,
  'Innodisk': 500,
  'SSSTC': 500,
  'Giantec': 3000,
  'WIZnet': 1000
};

export function getSpqForMaker(maker) {
  return LINE_SPQ_MAP[maker] || 1000;
}

export function evaluatePackaging(maker, qty) {
  const spq = getSpqForMaker(maker);
  const nQty = parseInt(qty) || 0;

  if (nQty <= 0) {
    return { isValid: true, spq, remainder: 0, downQty: 0, upQty: spq };
  }

  const remainder = nQty % spq;
  const isValid = remainder === 0;
  const downQty = Math.floor(nQty / spq) * spq;
  const upQty = Math.ceil(nQty / spq) * spq;

  return {
    isValid,
    spq,
    currentQty: nQty,
    remainder,
    missingForFullReel: spq - remainder,
    downQty: downQty > 0 ? downQty : spq,
    upQty
  };
}
