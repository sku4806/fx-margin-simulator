/**
 * 🚚 실시간 배송 및 B/L 추적 모듈 (국내 택배 + DHL Express + SF Express + FedEx 통합)
 */

export function detectCarrier(trackingNo) {
  const clean = String(trackingNo || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  
  if (!clean) return { type: 'unknown', clean: '' };

  // 1. SF Express (순풍)
  if (clean.startsWith('SF') || (clean.length === 12 && /^\d+$/.test(clean) && clean.startsWith('0'))) {
    return { type: 'sf', name: 'SF Express (순풍)', clean };
  }

  // 2. DHL Express (10자리 순수 숫자)
  if (clean.length === 10 && /^\d+$/.test(clean)) {
    return { type: 'dhl', name: 'DHL Express', clean };
  }

  // 3. FedEx (12자리 순수 숫자)
  if (clean.length === 12 && /^\d+$/.test(clean)) {
    return { type: 'fedex', name: 'FedEx Express', clean };
  }

  // 4. 국내 일반 택배 (CJ, 롯데, 우체국, 로젠, 한진 등)
  return { type: 'domestic', name: '국내 택배 / 화물', clean };
}

export function openTrackingModal(trackingNo) {
  const modal = document.getElementById('courierTrackingModal');
  const iframe = document.getElementById('courierFrame');
  const carrierSelect = document.getElementById('courierSelect');
  const invoiceInput = document.getElementById('courierInvoiceInput');

  if (!modal) return;

  const detected = detectCarrier(trackingNo);
  const cleanNo = detected.clean;

  if (invoiceInput) invoiceInput.value = cleanNo;

  // 특송사별 전용 추적 URL 분기
  let targetUrl = '';

  if (detected.type === 'dhl') {
    targetUrl = `https://www.dhl.com/kr-ko/home/tracking/tracking-express.html?submit=1&tracking-id=${cleanNo}`;
  } else if (detected.type === 'sf') {
    targetUrl = `https://www.sf-international.com/kr/ko/dynamic_function/waybill/waybill_trace?billCodes=${cleanNo}`;
  } else if (detected.type === 'fedex') {
    targetUrl = `https://www.fedex.com/fedextrack/?trknbr=${cleanNo}`;
  } else {
    // 국내 택배 배송조회 엔진
    targetUrl = `https://tracker.delivery/#/auto/${cleanNo}`;
  }

  // Iframe 로드 및 보안 정책에 따라 외부 새창 열기 버튼도 함께 제공
  if (iframe) {
    iframe.src = targetUrl;
  }

  updateCarrierNoticeBadge(detected, targetUrl);
  modal.classList.remove('hidden');
}

function updateCarrierNoticeBadge(detected, targetUrl) {
  const headerContainer = document.querySelector('#courierTrackingModal .flex.items-center.gap-2') || document.querySelector('#courierTrackingModal h3')?.parentElement;
  let extBtn = document.getElementById('carrierExternalLinkBtn');

  if (!extBtn && headerContainer) {
    extBtn = document.createElement('a');
    extBtn.id = 'carrierExternalLinkBtn';
    extBtn.target = '_blank';
    extBtn.rel = 'noopener noreferrer';
    extBtn.className = 'text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-2.5 py-1 rounded-lg flex items-center gap-1 shadow-sm transition-colors ml-auto mr-2';
    headerContainer.appendChild(extBtn);
  }

  if (extBtn) {
    extBtn.href = targetUrl;
    extBtn.innerHTML = `<span>🔗</span> [${detected.name}] 공식 사이트 새창 조회`;
  }
}
