/**
 * 🚚 실시간 배송 및 B/L 추적 모듈 (국내 택배 인앱 + 해외 특송사 안전 리다이렉트 카드 통합)
 */

export function detectCarrier(trackingNo) {
  const clean = String(trackingNo || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  
  if (!clean) return { type: 'unknown', clean: '' };

  // 1. SF Express (순풍)
  if (clean.startsWith('SF') || (clean.length === 12 && /^\d+$/.test(clean) && clean.startsWith('0'))) {
    return { 
      type: 'sf', 
      name: 'SF Express (순풍택배)', 
      color: 'bg-rose-50 border-rose-200 text-rose-800', 
      btnColor: 'bg-rose-600 hover:bg-rose-700',
      clean 
    };
  }

  // 2. DHL Express (10자리 숫자)
  if (clean.length === 10 && /^\d+$/.test(clean)) {
    return { 
      type: 'dhl', 
      name: 'DHL Express', 
      color: 'bg-amber-50 border-amber-200 text-amber-900', 
      btnColor: 'bg-amber-500 hover:bg-amber-600 text-black',
      clean 
    };
  }

  // 3. FedEx (12자리 숫자)
  if (clean.length === 12 && /^\d+$/.test(clean)) {
    return { 
      type: 'fedex', 
      name: 'FedEx Express', 
      color: 'bg-purple-50 border-purple-200 text-purple-900', 
      btnColor: 'bg-purple-600 hover:bg-purple-700',
      clean 
    };
  }

  // 4. 국내 일반 택배 (CJ, 롯데, 우체국, 로젠, 한진 등)
  return { 
    type: 'domestic', 
    name: '국내 택배 / 화물', 
    clean 
  };
}

export function openTrackingModal(trackingNo) {
  const modal = document.getElementById('courierTrackingModal');
  const iframe = document.getElementById('courierFrame');
  const container = iframe?.parentElement;

  if (!modal) return;

  const detected = detectCarrier(trackingNo);
  const cleanNo = detected.clean;

  // 기존 안내 카드 제거
  const existingCard = document.getElementById('intlCarrierCard');
  if (existingCard) existingCard.remove();

  let targetUrl = '';
  if (detected.type === 'dhl') {
    targetUrl = `https://www.dhl.com/kr-ko/home/tracking/tracking-express.html?submit=1&tracking-id=${cleanNo}`;
  } else if (detected.type === 'sf') {
    targetUrl = `https://www.sf-international.com/kr/ko/dynamic_function/waybill/waybill_trace?billCodes=${cleanNo}`;
  } else if (detected.type === 'fedex') {
    targetUrl = `https://www.fedex.com/fedextrack/?trknbr=${cleanNo}`;
  } else {
    targetUrl = `https://tracker.delivery/#/auto/${cleanNo}`;
  }

  // 상단 새창 열기 버튼 동기화
  const topExternalBtn = document.getElementById('carrierExternalLinkBtn');
  if (topExternalBtn) {
    topExternalBtn.href = targetUrl;
    topExternalBtn.innerHTML = `<span>🔗</span> [${detected.name}] 새창 열기`;
  }

  if (detected.type === 'domestic') {
    // 국내 택배: 기존처럼 iframe 렌더링
    if (iframe) {
      iframe.classList.remove('hidden');
      iframe.src = targetUrl;
    }
  } else {
    // 해외 특송사(DHL / SF / FedEx): 보안 차단 방지를 위해 iframe 숨기고 안내 카드 노출
    if (iframe) {
      iframe.classList.add('hidden');
      iframe.src = 'about:blank';
    }

    const card = document.createElement('div');
    card.id = 'intlCarrierCard';
    card.className = `w-full h-full flex flex-col items-center justify-center p-6 text-center border rounded-xl ${detected.color} space-y-4`;
    card.innerHTML = `
      <div class="text-4xl">✈️</div>
      <div class="space-y-1">
        <h4 class="text-base sm:text-lg font-black text-slate-900">${detected.name} 국제 특송 조회</h4>
        <p class="text-xs text-slate-600">
          운송장 번호: <span class="font-mono font-bold text-slate-900 text-sm select-all">${cleanNo}</span>
        </p>
        <p class="text-[11px] text-slate-500 pt-1">
          특송사 자체 보안 규정(Iframe 제한)에 따라 공식 배송 조회 페이지로 직접 안전하게 연결됩니다.
        </p>
      </div>
      <div class="pt-2">
        <a href="${targetUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-white shadow-md text-xs sm:text-sm transition-transform active:scale-95 ${detected.btnColor}">
          <span>🚀</span> 공식 사이트에서 실시간 위치 조회하기
        </a>
      </div>
    `;

    if (container) {
      container.appendChild(card);
    }
  }

  modal.classList.remove('hidden');
}
