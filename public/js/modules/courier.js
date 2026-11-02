/**
 * 🚚 배송 추적 모듈 (국내 일반택배 인앱 + 해외 특송사 안전 리다이렉트 카드 통합)
 */

export function detectCarrier(trackingNo) {
  const clean = String(trackingNo || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  
  if (!clean) return { type: 'unknown', name: '미등록', clean: '' };

  // 1. SF Express (순풍택배)
  if (clean.startsWith('SF') || (clean.length === 12 && /^\d+$/.test(clean) && clean.startsWith('0'))) {
    return { 
      type: 'sf', 
      name: 'SF Express (순풍택배)', 
      color: 'bg-rose-50 border-rose-200 text-rose-800', 
      btnColor: 'bg-rose-600 hover:bg-rose-700 text-white',
      clean 
    };
  }

  // 2. DHL Express (10자리 순수 숫자)
  if (clean.length === 10 && /^\d+$/.test(clean)) {
    return { 
      type: 'dhl', 
      name: 'DHL Express', 
      color: 'bg-amber-50 border-amber-200 text-amber-900', 
      btnColor: 'bg-amber-500 hover:bg-amber-600 text-slate-950 font-black',
      clean 
    };
  }

  // 3. FedEx Express (12자리 순수 숫자)
  if (clean.length === 12 && /^\d+$/.test(clean)) {
    return { 
      type: 'fedex', 
      name: 'FedEx Express', 
      color: 'bg-purple-50 border-purple-200 text-purple-900', 
      btnColor: 'bg-purple-600 hover:bg-purple-700 text-white',
      clean 
    };
  }

  // 4. 국내 일반 택배 (CJ, 우체국, 로젠, 롯데, 한진 등)
  return { 
    type: 'domestic', 
    name: '국내 택배 / 화물', 
    clean 
  };
}

export function openTrackingModal(trackingNo) {
  const modal = document.getElementById('courierTrackingModal');
  const iframe = document.getElementById('courierFrame');
  const modalContentArea = iframe?.parentElement;

  if (!modal) return;

  const detected = detectCarrier(trackingNo);
  const cleanNo = detected.clean;

  // 기존 삽입된 국제특송 카드 및 헤더 외부 버튼 정리
  const oldCard = document.getElementById('intlCarrierCard');
  if (oldCard) oldCard.remove();

  const oldHeaderBtn = document.getElementById('carrierHeaderDirectBtn');
  if (oldHeaderBtn) oldHeaderBtn.remove();

  // 특송사별 공식 URL 생성
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

  // 모달 상단 헤더 우측에 안전하게 새창 바로가기 버튼 배치 (DOM insertBefore 오류 방지)
  const headerContainer = modal.querySelector('#courierHeaderActionContainer') || modal.querySelector('.flex.justify-between.items-center');
  if (headerContainer) {
    const extBtn = document.createElement('a');
    extBtn.id = 'carrierHeaderDirectBtn';
    extBtn.href = targetUrl;
    extBtn.target = '_blank';
    extBtn.rel = 'noopener noreferrer';
    extBtn.className = 'text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold px-3 py-1.5 rounded-lg inline-flex items-center gap-1 border border-slate-300 transition-colors mr-2 shadow-sm';
    extBtn.innerHTML = `<span>🔗</span> [${detected.name}] 공식 사이트 새창 조회`;

    const closeBtn = headerContainer.querySelector('button');
    if (closeBtn && closeBtn.parentNode === headerContainer) {
      headerContainer.insertBefore(extBtn, closeBtn);
    } else {
      headerContainer.appendChild(extBtn);
    }
  }

  if (detected.type === 'domestic') {
    if (iframe) {
      iframe.classList.remove('hidden');
      iframe.src = targetUrl;
    }
  } else {
    if (iframe) {
      iframe.classList.add('hidden');
      iframe.src = 'about:blank';
    }

    if (modalContentArea) {
      const card = document.createElement('div');
      card.id = 'intlCarrierCard';
      card.className = `w-full h-full flex flex-col items-center justify-center p-6 text-center border-2 border-dashed rounded-2xl ${detected.color} space-y-4 my-auto min-h-[400px]`;
      card.innerHTML = `
        <div class="text-5xl">✈️</div>
        <div class="space-y-1.5">
          <h4 class="text-lg sm:text-xl font-black text-slate-900">${detected.name} 실시간 화물 추적</h4>
          <div class="text-xs sm:text-sm text-slate-700">
            운송장 B/L 번호: <span class="font-mono font-black text-slate-950 text-base bg-white/80 px-2.5 py-0.5 rounded border border-slate-300 select-all">${cleanNo}</span>
          </div>
          <p class="text-[11px] text-slate-500 pt-1">
            해외 특송사의 외부 사이트 삽입(Iframe) 보안 제한으로 인해 아래 버튼을 누르면 공식 페이지로 즉시 연결됩니다.
          </p>
        </div>
        <div class="pt-3">
          <a href="${targetUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold shadow-lg text-sm transition-transform active:scale-95 ${detected.btnColor}">
            <span>🚀</span> ${detected.name} 공식 배송현황 조회하기
          </a>
        </div>
      `;
      modalContentArea.appendChild(card);
    }
  }

  modal.classList.remove('hidden');
}
