/**
 * 🚚 실시간 배송조회 모듈 (로젠 / CJ / 해외특송 17TRACK)
 */

export const COURIER_CARRIERS = [
  { 
    id: 'global.17track', 
    name: '해외특송 (DHL / FedEx / SF)', 
    // 영문/숫자 혼합 또는 10자리(DHL), 12/15자리(FedEx), SF(12~15자리) 등
    regex: /^([a-zA-Z0-9]{10,20})$/, 
    iframeUrl: 'https://t.17track.net/ko#nums=',
    officialUrl: 'https://t.17track.net/ko#nums='
  },
  { 
    id: 'kr.logen', 
    name: '로젠택배', 
    regex: /^(\d{11})$/, 
    iframeUrl: 'https://www.ilogen.com/m/personal/trace/',
    officialUrl: 'https://www.ilogen.com/m/personal/trace/'
  },
  { 
    id: 'kr.cjlogistics', 
    name: 'CJ대한통운', 
    regex: /^(\d{12})$/, 
    iframeUrl: 'https://trace.cjlogistics.com/next/tracking.html?wblNo=',
    officialUrl: 'https://trace.cjlogistics.com/next/tracking.html?wblNo='
  }
];

export function detectCarrier(trackingNo) {
  if (!trackingNo) return COURIER_CARRIERS[0];
  const cleanNo = String(trackingNo).replace(/[^a-zA-Z0-9]/g, '');

  // 11자리는 로젠택배 우선 매칭
  if (/^\d{11}$/.test(cleanNo)) {
    return COURIER_CARRIERS.find(c => c.id === 'kr.logen');
  }

  // 12자리 숫자는 CJ대한통운 또는 해외특송
  if (/^\d{12}$/.test(cleanNo)) {
    return COURIER_CARRIERS.find(c => c.id === 'kr.cjlogistics');
  }

  // 그 외 10자리(DHL) 및 영문 혼합/기타 번호는 해외특송(17TRACK) 기본 매칭
  return COURIER_CARRIERS[0];
}

export function openTrackingModal(trackingNo) {
  if (!trackingNo || trackingNo.trim() === '-' || trackingNo.trim() === '') {
    alert("등록된 운송장 번호가 없습니다.");
    return;
  }

  const cleanNo = trackingNo.replace(/[^a-zA-Z0-9]/g, '').trim();
  const carrier = detectCarrier(cleanNo);

  const modal = document.getElementById('courierTrackingModal');
  const infoEl = document.getElementById('trackingInfoText');
  const carrierSelect = document.getElementById('trackingCarrierSelect');

  if (infoEl) infoEl.innerText = `송장번호: ${cleanNo}`;

  // 드롭다운에 [해외특송, 로젠택배, CJ대한통운]만 간결하게 노출
  if (carrierSelect) {
    carrierSelect.innerHTML = COURIER_CARRIERS.map(c => 
      `<option value="${c.id}" ${c.id === carrier.id ? 'selected' : ''}>${c.name}</option>`
    ).join('');

    carrierSelect.onchange = () => {
      loadCarrierTracking(carrierSelect.value, cleanNo);
    };
  }

  loadCarrierTracking(carrier.id, cleanNo);
  modal?.classList.remove('hidden');
}

export function loadCarrierTracking(carrierId, cleanNo) {
  const carrier = COURIER_CARRIERS.find(c => c.id === carrierId) || COURIER_CARRIERS[0];
  const titleEl = document.getElementById('trackingModalTitle');
  const iframeEl = document.getElementById('trackingIframe');
  const directLinkBtn = document.getElementById('trackingDirectLinkBtn');

  let embedUrl = carrier.iframeUrl + cleanNo;
  let officialUrl = carrier.officialUrl + cleanNo;

  if (carrier.id === 'kr.logen') {
    embedUrl = `https://www.ilogen.com/m/personal/trace/${cleanNo}`;
    officialUrl = embedUrl;
  }

  if (titleEl) titleEl.innerText = `[${carrier.name}] 실시간 배송 현황`;
  if (directLinkBtn) {
    directLinkBtn.href = officialUrl;
    directLinkBtn.target = "_blank";
  }

  if (iframeEl) {
    iframeEl.src = embedUrl;
  }
}
