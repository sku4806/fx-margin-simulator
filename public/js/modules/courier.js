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

export function extractTrackingNumber(rawText) {
  if (!rawText) return '';
  const str = String(rawText).trim();
  // SF1573596306734 등 영문+숫자 AWB 또는 10~15자리 숫자 송장번호 추출
  const m = str.match(/\b([A-Za-z]{2}\d{10,15}|\d{10,15})\b/);
  return m ? m[1] : '';
}

export function detectCarrier(trackingNo, hint = '') {
  if (!trackingNo) return COURIER_CARRIERS[0];
  const cleanNo = String(trackingNo).replace(/[^a-zA-Z0-9]/g, '');
  const h = String(hint || '').toLowerCase();

  if (h.includes('로젠') || h.includes('logen')) {
    return COURIER_CARRIERS.find(c => c.id === 'kr.logen') || COURIER_CARRIERS[0];
  }
  if (h.includes('cj') || h.includes('대한통운')) {
    return COURIER_CARRIERS.find(c => c.id === 'kr.cjlogistics') || COURIER_CARRIERS[0];
  }
  if (h.includes('dhl') || h.includes('fedex') || h.includes('sf') || h.includes('ups')) {
    return COURIER_CARRIERS[0];
  }

  // 11자리는 로젠택배 우선 매칭
  if (/^\d{11}$/.test(cleanNo)) {
    return COURIER_CARRIERS.find(c => c.id === 'kr.logen');
  }

  // 12자리 숫자는 CJ대한통운 우선 매칭
  if (/^\d{12}$/.test(cleanNo)) {
    return COURIER_CARRIERS.find(c => c.id === 'kr.cjlogistics');
  }

  // 그 외 10자리(DHL) 및 영문 혼합/기타 번호는 해외특송(17TRACK) 기본 매칭
  return COURIER_CARRIERS[0];
}

export function openTrackingModal(trackingNo = '', hint = '') {
  const modal = document.getElementById('courierTrackingModal');
  const infoEl = document.getElementById('trackingInfoText');
  const carrierSelect = document.getElementById('trackingCarrierSelect');
  const quickInput = document.getElementById('trackingQuickInput');
  const quickBtn = document.getElementById('trackingQuickSearchBtn');
  const iframeEl = document.getElementById('trackingIframe');
  const directLinkBtn = document.getElementById('trackingDirectLinkBtn');
  const titleEl = document.getElementById('trackingModalTitle');

  const raw = String(trackingNo || '').trim();
  const cleanNo = (raw === '-' ? '' : raw).replace(/[^a-zA-Z0-9]/g, '').trim();
  const carrier = detectCarrier(cleanNo, hint || raw);

  if (quickInput) {
    quickInput.value = cleanNo;
    if (!quickInput.dataset.bound) {
      quickInput.dataset.bound = '1';
      quickInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          openTrackingModal(quickInput.value);
        }
      });
    }
  }
  if (quickBtn && !quickBtn.dataset.bound) {
    quickBtn.dataset.bound = '1';
    quickBtn.addEventListener('click', () => {
      openTrackingModal(quickInput?.value || '');
    });
  }

  if (carrierSelect) {
    carrierSelect.innerHTML = COURIER_CARRIERS.map(c => 
      `<option value="${c.id}" ${c.id === carrier.id ? 'selected' : ''}>${c.name}</option>`
    ).join('');

    carrierSelect.onchange = () => {
      const num = (quickInput?.value || cleanNo).replace(/[^a-zA-Z0-9]/g, '').trim();
      if (num) loadCarrierTracking(carrierSelect.value, num);
    };
  }

  modal?.classList.remove('hidden');

  if (!cleanNo) {
    if (titleEl) titleEl.innerText = '실시간 배송 조회 (로젠 · CJ · DHL/FedEx/SF)';
    if (infoEl) infoEl.innerText = '운송장 번호 또는 B/L · AWB 번호를 입력하고 [조회]를 눌러주세요.';
    if (iframeEl) iframeEl.src = 'about:blank';
    if (directLinkBtn) directLinkBtn.href = 'https://t.17track.net/ko';
    setTimeout(() => quickInput?.focus(), 80);
    return;
  }

  if (infoEl) infoEl.innerText = `송장번호: ${cleanNo}`;
  loadCarrierTracking(carrier.id, cleanNo);
}

if (typeof window !== 'undefined') {
  window.extractTrackingNumber = extractTrackingNumber;
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
