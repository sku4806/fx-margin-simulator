import { sbClient } from '../supabase.js';

let packagingStandardsCache = {};

/**
 * 📦 DB에서 라인별 CS 지정 포장단위 기준 로드
 */
export async function fetchPackagingStandards() {
  if (!sbClient) return {};
  try {
    const { data, error } = await sbClient
      .from('line_packaging_standards')
      .select('*');

    if (error) throw error;

    packagingStandardsCache = {};
    (data || []).forEach(row => {
      packagingStandardsCache[row.maker] = {
        csManager: row.cs_manager || '',
        spq: row.spq || null,
        moq: row.moq || null,
        memo: row.memo || ''
      };
    });
    return packagingStandardsCache;
  } catch (err) {
    console.warn("포장단위 기준 로드 실패:", err);
    return {};
  }
}

/**
 * 특정 라인의 CS 등록 SPQ 가져오기 (미등록 시 null)
 */
export function getStandardSpq(maker) {
  if (packagingStandardsCache[maker] && packagingStandardsCache[maker].spq) {
    return packagingStandardsCache[maker].spq;
  }
  return null;
}

export function getAllStandards() {
  return packagingStandardsCache;
}

/**
 * 💾 담당 CS가 특정 라인의 기준 저장/업데이트
 */
export async function savePackagingStandard(maker, csManager, spq, moq, memo = '') {
  if (!sbClient) throw new Error("클라이언트 미연결");

  const payload = {
    maker,
    cs_manager: csManager,
    spq: spq ? parseInt(spq) : null,
    moq: moq ? parseInt(moq) : null,
    memo,
    updated_at: new Date().toISOString()
  };

  const { error } = await sbClient
    .from('line_packaging_standards')
    .upsert(payload, { onConflict: 'maker' });

  if (error) throw error;
  await fetchPackagingStandards();
}

/**
 * 🔍 실시간 Reel 포장단위 불일치 및 잔여 자투리 검증
 */
export function evaluatePackaging(qty, customSpq) {
  const nQty = parseInt(qty) || 0;
  const spq = parseInt(customSpq) || 0;

  if (nQty <= 0 || spq <= 0) {
    return { isValid: true, spq: spq || 0, remainder: 0, downQty: 0, upQty: 0 };
  }

  const remainder = nQty % spq;
  const isValid = (remainder === 0);
  const downQty = Math.floor(nQty / spq) * spq;
  const upQty = Math.ceil(nQty / spq) * spq;

  return {
    isValid,
    spq,
    currentQty: nQty,
    remainder,
    missingForFullReel: remainder === 0 ? 0 : (spq - remainder),
    downQty: downQty > 0 ? downQty : spq,
    upQty
  };
}
