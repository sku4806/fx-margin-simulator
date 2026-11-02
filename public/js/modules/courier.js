/**
 * 🚚 실시간 배송 및 B/L 추적 모듈 (국내 일반 택배)
 */

export function openTrackingModal(trackingNo) {
  const modal = document.getElementById('courierTrackingModal');
  const iframe = document.getElementById('courierFrame');

  if (!modal) return;

  const cleanNo = String(trackingNo || '').replace(/[^a-zA-Z0-9]/g, '');

  if (iframe) {
    iframe.src = `https://tracker.delivery/#/auto/${cleanNo}`;
  }

  modal.classList.remove('hidden');
}
