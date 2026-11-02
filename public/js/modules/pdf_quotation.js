/**
 * 📄 빅샤인 코리아(BIGSHINE KOREA CO., LTD) 공식 실무 견적서 발행 모듈
 */

export function openQuotationPrintModal(data) {
  const modal = document.getElementById('quotationPdfModal');
  const preview = document.getElementById('quotationPrintArea');
  if (!modal || !preview) return;

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  // 빅샤인 코리아 공식 견적 REF 번호 생성 (예: QBK2611-1025)
  const yy = String(yyyy).slice(2);
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const refNo = `QBK${yy}${mm}-${randomSuffix}`;

  // 통화 및 단가 계산
  const isKrw = data.currency === 'KRW' || (data.unitPriceKrw && !data.unitPriceUsd);
  const qty = Number(data.qty) || 0;
  
  let unitPriceFormatted = '';
  let subtotal = 0;
  let vat = 0;
  let totalAmount = 0;
  let currencySymbol = '';

  if (isKrw) {
    currencySymbol = '₩';
    const upKrw = Math.round(data.unitPriceKrw || (data.unitPriceUsd * data.appliedFx));
    subtotal = upKrw * qty;
    vat = Math.round(subtotal * 0.1);
    totalAmount = subtotal + vat;
    unitPriceFormatted = `₩${upKrw.toLocaleString()}`;
  } else {
    currencySymbol = '$';
    const upUsd = Number(data.unitPriceUsd) || 0;
    subtotal = upUsd * qty;
    vat = subtotal * 0.1;
    totalAmount = subtotal + vat;
    unitPriceFormatted = `$${upUsd.toFixed(3)}`;
  }

  const formatMoney = (val) => {
    return isKrw 
      ? `₩${Math.round(val).toLocaleString()}` 
      : `$${val.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  };

  preview.innerHTML = `
    <div class="bg-white text-slate-900 mx-auto font-sans text-[11px] leading-tight p-6 sm:p-10 max-w-4xl border border-slate-300 shadow-md print:border-0 print:shadow-none print:p-0 print:w-full">
      
      <!-- 상단 1: TO(고객사) & 공급자 정보 (2단 레이아웃) -->
      <div class="grid grid-cols-2 gap-4 pb-4 border-b border-slate-900">
        <!-- 좌측 수신자 -->
        <div class="space-y-1.5 pt-1">
          <div class="flex items-start">
            <span class="w-14 font-black text-slate-900 shrink-0">TO:</span>
            <span class="font-bold text-sm text-slate-900">${data.customer || '고객사'}</span>
          </div>
          <div class="flex items-start">
            <span class="w-14 font-bold text-slate-600 shrink-0">ATTN:</span>
            <span class="font-bold text-slate-900">${data.attn || '구매/개발 담당자'} 님</span>
          </div>
          <div class="flex items-center text-slate-600">
            <span class="w-14 shrink-0">TEL:</span>
            <span>${data.customerTel || '-'}</span>
          </div>
          <div class="flex items-center text-slate-600">
            <span class="w-14 shrink-0">FAX:</span>
            <span>${data.customerFax || '-'}</span>
          </div>
        </div>

        <!-- 우측 공급자 정보 -->
        <div class="text-right space-y-1 text-slate-700">
          <div class="text-base font-black tracking-tight text-[#0b2046]">BIGSHINE KOREA CO., LTD</div>
          <div class="text-[10px] text-slate-600 leading-snug font-medium">
            B-601, Yongin TechnoValley, 357 Guseong-ro, Giheung-gu,<br>
            Yongin-si, Gyeonggi-do 16914, Rep. of Korea
          </div>
          <div class="text-[10px] text-slate-600 pt-0.5">
            <span class="font-bold">Tel:</span> 82-31-711-8881 &nbsp;|&nbsp; <span class="font-bold">Fax:</span> 82-31-711-8174
          </div>
        </div>
      </div>

      <!-- 상단 2: 견적 메타 정보 -->
      <div class="py-3 border-b-2 border-slate-900 flex justify-between items-center">
        <h1 class="text-2xl font-black tracking-widest text-[#0b2046] m-0">QUOTATION</h1>
        
        <div class="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] text-right font-medium">
          <div><strong class="text-slate-500">DATE:</strong> <span class="font-mono font-bold">${dateStr}</span></div>
          <div><strong class="text-slate-500">PAGE:</strong> <span class="font-bold">1 OF 1</span></div>
          <div><strong class="text-slate-500">REF:</strong> <span class="font-mono font-bold text-indigo-900">${refNo}</span></div>
          <div><strong class="text-slate-500">FROM:</strong> <span class="font-bold">${data.salesRep || '김경래'}</span></div>
        </div>
      </div>

      <!-- 본문: 품목 견적 테이블 -->
      <table class="w-full text-left border-collapse border border-slate-900 mt-4 text-[11px]">
        <thead>
          <tr class="bg-slate-100 text-slate-900 font-bold border-b border-slate-900 text-center">
            <th class="border-r border-slate-900 py-2 px-1 w-10">No</th>
            <th class="border-r border-slate-900 py-2 px-3 text-left">PART#</th>
            <th class="border-r border-slate-900 py-2 px-2 w-28">MFG</th>
            <th class="border-r border-slate-900 py-2 px-2 w-20">QTY</th>
            <th class="border-r border-slate-900 py-2 px-3 text-right w-28">U/P</th>
            <th class="border-r border-slate-900 py-2 px-3 text-right w-32">AMOUNT</th>
            <th class="py-2 px-2 text-center w-24">DELIVERY</th>
          </tr>
        </thead>
        <tbody>
          <tr class="border-b border-slate-300">
            <td class="border-r border-slate-900 py-3 px-1 text-center font-bold">1</td>
            <td class="border-r border-slate-900 py-3 px-3 font-black text-slate-900">
              <div>${data.partName}</div>
              ${data.dateCode && data.dateCode !== '-' ? `<div class="text-[10px] text-slate-500 font-normal">D/C: ${data.dateCode}</div>` : ''}
              ${data.spq ? `<div class="text-[9px] text-slate-400 font-normal">SPQ: ${Number(data.spq).toLocaleString()} EA</div>` : ''}
            </td>
            <td class="border-r border-slate-900 py-3 px-2 text-center font-bold text-slate-700">${data.maker}</td>
            <td class="border-r border-slate-900 py-3 px-2 text-center font-bold text-slate-900">${qty.toLocaleString()} ${data.unitLabel || 'EA'}</td>
            <td class="border-r border-slate-900 py-3 px-3 text-right font-black font-mono">${unitPriceFormatted}</td>
            <td class="border-r border-slate-900 py-3 px-3 text-right font-black font-mono text-slate-900">${formatMoney(subtotal)}</td>
            <td class="py-3 px-2 text-center font-bold text-slate-700">${data.delivery || '즉시 출고'}</td>
          </tr>
        </tbody>
      </table>

      <!-- 합계 및 공급 조건 (2단 그리드) -->
      <div class="grid grid-cols-12 gap-4 mt-3">
        <!-- 좌측 거래 조건 -->
        <div class="col-span-7 space-y-1 text-[10.5px]">
          <div class="flex items-center"><strong class="w-36 text-slate-700">* PAYMENT TERMS:</strong> <span class="font-bold text-slate-900">${data.paymentTerms || '선입금 (VAT 포함)'}</span></div>
          <div class="flex items-center"><strong class="w-36 text-slate-700">* INCO TERMS:</strong> <span class="font-bold text-slate-900">${data.incoTerms || 'DOMESTIC'}</span></div>
          <div class="flex items-center"><strong class="w-36 text-slate-700">* ORIGIN:</strong> <span class="font-bold text-slate-900">${data.origin || 'Hong Kong'}</span></div>
          <div class="flex items-center"><strong class="w-36 text-slate-700">SHIPPING PORT:</strong> <span class="font-bold text-slate-900">${data.shippingPort || 'H.K.'}</span></div>
          <div class="flex items-center"><strong class="w-36 text-slate-700">* VALIDITY:</strong> <span class="font-bold text-indigo-900">${data.validity || '7 DAYS'}</span></div>
          ${data.memo ? `<div class="flex items-start pt-0.5"><strong class="w-36 text-slate-700">REMARKS:</strong> <span class="font-medium text-slate-800">${data.memo}</span></div>` : ''}
        </div>

        <!-- 우측 금액 합계 정산 테이블 -->
        <div class="col-span-5 border border-slate-900 divide-y divide-slate-300 text-[11px] self-start">
          <div class="flex justify-between py-1.5 px-3">
            <span class="font-bold text-slate-700">AMOUNT:</span>
            <span class="font-mono font-bold">${formatMoney(subtotal)}</span>
          </div>
          <div class="flex justify-between py-1.5 px-3">
            <span class="font-bold text-slate-700">VAT (10%):</span>
            <span class="font-mono font-bold">${formatMoney(vat)}</span>
          </div>
          <div class="flex justify-between py-2 px-3 bg-slate-100 font-black text-slate-950 border-t-2 border-slate-900">
            <span>* TOTAL AMOUNT :</span>
            <span class="font-mono text-xs">${formatMoney(totalAmount)}</span>
          </div>
        </div>
      </div>

      <!-- 공식 레터 문구 -->
      <div class="mt-4 pt-3 border-t border-slate-300 text-[10.5px] text-slate-600 italic">
        We are pleased to offer you the parts on the terms and conditions described as above.
      </div>

      <!-- 하단: 입금 계좌 정보 & 결재(Authorized by) 날인란 -->
      <div class="mt-4 grid grid-cols-2 gap-4 items-end">
        <!-- 계좌 정보 -->
        <div class="p-3 bg-slate-50 border border-slate-300 rounded-lg text-[10.5px] leading-relaxed">
          <div class="font-bold text-slate-900 mb-1 flex items-center gap-1">
            <span>🏦</span> * ACCOUNT INFO: <span class="text-indigo-900 font-black">- 원화(₩) 계좌 -</span>
          </div>
          <div class="text-slate-700">KEB하나은행으로 송금부탁드립니다.</div>
          <div class="text-slate-900 font-bold">예금주: (주)빅샤인코리아</div>
          <div class="font-mono font-black text-slate-950 text-xs mt-0.5">계좌번호 : 374-890003-50704 (144-22-01385-8)</div>
        </div>

        <!-- 결재 및 직인 서명란 -->
        <div class="text-right space-y-2 pr-2">
          <div class="text-[11px] text-slate-500 font-semibold">CC: D.I.Lee</div>
          <div class="text-sm font-black text-slate-900 tracking-wide flex items-center justify-end gap-2">
            <span>* Authorized by</span>
            <span class="inline-block border-b-2 border-slate-800 w-28 text-center text-xs font-serif text-slate-400 font-normal">
              (주)빅샤인코리아
            </span>
          </div>
        </div>
      </div>

    </div>
  `;

  modal.classList.remove('hidden');
}
