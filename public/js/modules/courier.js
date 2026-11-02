/**
 * 🚚 배송 추적 모듈 (안전 가드 적용)
 */

export function detectCarrier(trackingNo) {
  const clean = String(trackingNo || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (!clean) return { type: 'unknown', name: '미등록', clean: '' };

  // 1. SF Express (순풍)
  if (clean.startsWith('SF') || (clean.length === 12 && /^\d+$/.test(clean) && clean.startsWith('0'))) {
    return { 
      type: 'sf', 
      name: 'SF Express (순풍택배)', 
      color: 'bg-rose-50 border-rose-300 text-rose-900', 
      btnColor: 'bg-rose-600 hover:bg-rose-700 text-white',
      clean 
    };
  }

  // 2. DHL Express (10자리 숫자)
  if (clean.length === 10 && /^\d+$/.test(clean)) {
    return { 
      type: 'dhl', 
      name: 'DHL Express', 
      color: 'bg-amber-50 border-amber-300 text-amber-950', 
      btnColor: 'bg-amber-400 hover:bg-amber-500 text-slate-950 font-black',
      clean 
    };
  }

  // 3. FedEx Express (12자리 숫자)
  if (clean.length === 12 && /^\d+$/.test(clean)) {
    return { 
      type: 'fedex', 
      name: 'FedEx Express', 
      color: 'bg-purple-50 border-purple-300 text-purple-950', 
      btnColor: 'bg-purple-600 hover:bg-purple-700 text-white',
      clean 
    };
  }

  // 4. 국내 일반 택배
  return { 
    type: 'domestic', 
    name: '국내 택배 / 화물', 
    clean 
  };
}

export function openTrackingModal(trackingNo) {
  const modal = document.getElementById('courierTrackingModal');
  if (!modal) return;

  const titleEl = document.getElementById('courierModalTitle');
  const directBtn = document.getElementById('courierDirectExternalBtn');
  const iframe = document.getElementById('courierFrame');
  const card = document.getElementById('intlCarrierCard');
  const inputEl = document.getElementById('courierInvoiceInput');

  const detected = detectCarrier(trackingNo);
  const cleanNo = detected.clean;

  if (inputEl) inputEl.value = cleanNo;

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

  if (titleEl) {
    titleEl.innerText = `실시간 배송 현황 - [${detected.name}] ${cleanNo}`;
  }

  if (directBtn) {
    directBtn.href = targetUrl;
    directBtn.innerHTML = `<span>🔗</span> [${detected.name}] 새창 조회`;
    directBtn.classList.remove('hidden');
    directBtn.classList.add('inline-flex');
  }

  if (detected.type === 'domestic') {
    if (card) card.classList.add('hidden');
    if (iframe) {
      iframe.classList.remove('hidden');
      iframe.src = targetUrl;
    }
  } else {
    if (iframe) {
      iframe.classList.add('hidden');
      iframe.src = 'about:blank';
    }

    if (card) {
      card.className = `w-full h-full flex flex-col items-center justify-center p-6 text-center border-2 border-dashed rounded-2xl ${detected.color} space-y-4 m-auto`;
      card.innerHTML = `
        <div class="text-6xl animate-bounce">✈️</div>
        <div class="space-y-2 max-w-md">
          <h4 class="text-lg sm:text-xl font-black text-slate-900">${detected.name} 실시간 화물 추적</h4>
          <div class="text-xs sm:text-sm text-slate-700">
            운송장(B/L) 번호: <span class="font-mono font-black text-slate-950 text-base bg-white px-2.5 py-0.5 rounded border border-slate-300 select-all">${cleanNo}</span>
          </div>
          <p class="text-[11px] text-slate-500 leading-relaxed pt-1">
            글로벌 특송사 보안 규정으로 인해 아래 공식 페이지에서 실시간 위치를 확인할 수 있습니다.
          </p>
        </div>
        <div class="pt-2">
          <a href="${targetUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold shadow-lg text-sm transition-transform active:scale-95 ${detected.btnColor}">
            <span>🚀</span> ${detected.name} 공식 배송현황 조회하기
          </a>
        </div>
      `;
      card.classList.remove('hidden');
    }
  }

  modal.classList.remove('hidden');
}
