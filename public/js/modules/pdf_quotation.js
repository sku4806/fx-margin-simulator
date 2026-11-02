/**
 * 📄 빅샤인 코리아 견적서양식.xls 1:1 박제형 공식 견적서 인쇄 모듈
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

  const yy = String(yyyy).slice(2);
  const refNo = `QBK${yy}${mm}-${Math.floor(1000 + Math.random() * 9000)}`;

  const isKrw = data.currency === 'KRW';
  const qty = Number(data.qty) || 0;
  const unitPrice = Number(data.unitPriceUsd) || 0;

  let subtotal = 0;
  let vat = 0;
  let total = 0;
  let unitPriceText = '';
  let subtotalText = '';
  let vatText = '';
  let totalText = '';

  if (isKrw) {
    const upKrw = Math.round(data.unitPriceKrw || (unitPrice * (data.appliedFx || 1380)));
    subtotal = upKrw * qty;
    vat = Math.round(subtotal * 0.1);
    total = subtotal + vat;
    unitPriceText = `₩${upKrw.toLocaleString()}`;
    subtotalText = `₩${subtotal.toLocaleString()}`;
    vatText = `₩${vat.toLocaleString()}`;
    totalText = `₩${total.toLocaleString()}`;
  } else {
    subtotal = unitPrice * qty;
    vat = subtotal * 0.1;
    total = subtotal + vat;
    unitPriceText = `$${unitPrice.toFixed(3)}`;
    subtotalText = `$${subtotal.toFixed(2)}`;
    vatText = `$${vat.toFixed(2)}`;
    totalText = `$${total.toFixed(2)}`;
  }

  // 엑셀 시트별 기본 계좌 정보
  const accountHtml = isKrw 
    ? `
      <div class="font-bold text-slate-900 mb-0.5">* ACCOUNT INFO : <span class="font-normal text-indigo-900">- 원화(₩) 계좌 -</span></div>
      <div>KEB하나은행으로 송금부탁드립니다.</div>
      <div>예금주 : ㈜ 빅샤인코리아</div>
      <div class="font-mono font-bold text-slate-950">계좌번호 : 374-890003-50704 (144-22-01385-8)</div>
    `
    : `
      <div class="font-bold text-slate-900 mb-0.5">* ACCOUNT INFO : <span class="font-normal text-indigo-900">- 외화(USD) 계좌 -</span></div>
      <div>KEB하나은행(구 외환은행)으로 송금 부탁드립니다.</div>
      <div>예금주 : ㈜ 빅샤인코리아</div>
      <div class="font-mono font-bold text-slate-950">계좌번호 : 438-JSD-100648-4</div>
    `;

  preview.innerHTML = `
    <div class="quotation-print-page bg-white text-slate-900 mx-auto font-sans text-[11px] leading-tight p-8 max-w-[210mm] min-h-[297mm] shadow-lg print:shadow-none print:p-0 print:m-0 print:border-0 border border-slate-300">
      
      <!-- 1. 헤더 공급자 정보 (우측 상단 엑셀 규격) -->
      <div class="text-right space-y-0.5 mb-2">
        <div class="text-sm font-black tracking-tight text-slate-900">BIGSHINE KOREA CO., LTD</div>
        <div class="text-[9.5px] text-slate-700 leading-snug">
          B-601, Yongin TechnoValley, 357 Guseong-ro, Giheung-gu,<br>
          Yongin-si, Gyeonggi-do 16914, Rep.of Korea
        </div>
        <div class="text-[9.5px] text-slate-700 pt-0.5">
          Tel: 82-31-711-8881 &nbsp;|&nbsp; Fax : 82-31-711-8174
        </div>
      </div>

      <!-- 2. 중앙 타이틀 -->
      <div class="text-center my-4">
        <h1 class="text-xl font-black tracking-[0.35em] inline-block border-b-2 border-slate-900 pb-0.5 text-slate-950">
          Q U O T A T I O N
        </h1>
      </div>

      <!-- 3. 메타 정보 박스 (엑셀 행 12~18단 구조) -->
      <table class="w-full border-collapse border border-slate-900 mb-3 text-[10.5px]">
        <tbody>
          <tr>
            <td class="w-12 font-bold p-1.5 pl-2 text-slate-800">TO</td>
            <td class="w-3 text-center font-bold">:</td>
            <td class="font-bold text-slate-950 p-1.5">${data.customer || ''}</td>
            <td class="w-14 font-bold p-1.5 pl-3 border-l border-slate-300 text-slate-800">DATE</td>
            <td class="w-3 text-center font-bold">:</td>
            <td class="font-mono font-bold p-1.5 w-32">${dateStr}</td>
          </tr>
          <tr>
            <td class="font-bold p-1.5 pl-2 text-slate-800">ATTN</td>
            <td class="text-center font-bold">:</td>
            <td class="font-bold text-slate-950 p-1.5">${data.attn || ''}</td>
            <td class="font-bold p-1.5 pl-3 border-l border-slate-300 text-slate-800">PAGE</td>
            <td class="text-center font-bold">:</td>
            <td class="p-1.5 font-medium">1 OF 1</td>
          </tr>
          <tr>
            <td class="font-bold p-1.5 pl-2 text-slate-800">TEL</td>
            <td class="text-center font-bold">:</td>
            <td class="font-mono p-1.5">${data.customerTel || ''}</td>
            <td class="font-bold p-1.5 pl-3 border-l border-slate-300 text-slate-800">REF</td>
            <td class="text-center font-bold">:</td>
            <td class="font-mono font-bold p-1.5 text-indigo-900">${refNo}</td>
          </tr>
          <tr>
            <td class="font-bold p-1.5 pl-2 text-slate-800">FAX</td>
            <td class="text-center font-bold">:</td>
            <td class="font-mono p-1.5">${data.customerFax || ''}</td>
            <td class="font-bold p-1.5 pl-3 border-l border-slate-300 text-slate-800">FROM</td>
            <td class="text-center font-bold">:</td>
            <td class="font-bold p-1.5">${data.salesRep || '황 환'}</td>
          </tr>
        </tbody>
      </table>

      <!-- 4. 품목 테이블 (엑셀 행 23~26 규격) -->
      <table class="w-full text-left border-collapse border border-slate-900 mb-3 text-[10.5px]">
        <thead>
          <tr class="bg-slate-100 text-slate-900 font-bold border-b border-slate-900 text-center">
            <th class="border-r border-slate-900 py-2 px-1 w-10">No</th>
            <th class="border-r border-slate-900 py-2 px-2 text-left">PART #</th>
            <th class="border-r border-slate-900 py-2 px-2 w-24">MFG</th>
            <th class="border-r border-slate-900 py-2 px-2 w-24">QTY</th>
            <th class="border-r border-slate-900 py-2 px-2 text-right w-24">U/P</th>
            <th class="border-r border-slate-900 py-2 px-2 text-right w-28">AMOUNT</th>
            <th class="py-2 px-2 text-center w-24">DELIVERY</th>
          </tr>
        </thead>
        <tbody>
          <tr class="border-b border-slate-300 min-h-[35px]">
            <td class="border-r border-slate-900 py-2.5 px-1 text-center font-bold">1</td>
            <td class="border-r border-slate-900 py-2.5 px-2 font-bold text-slate-950">
              <div>${data.partName || ''}</div>
              ${data.dateCode && data.dateCode !== '-' ? `<div class="text-[9.5px] text-slate-500 font-normal">D/C: ${data.dateCode}</div>` : ''}
              ${data.spq ? `<div class="text-[9px] text-slate-400 font-normal">SPQ: ${Number(data.spq).toLocaleString()} EA</div>` : ''}
            </td>
            <td class="border-r border-slate-900 py-2.5 px-2 text-center font-bold text-slate-700">${data.maker || ''}</td>
            <td class="border-r border-slate-900 py-2.5 px-2 text-center font-bold text-slate-900">${qty ? `${qty.toLocaleString()} pcs` : ''}</td>
            <td class="border-r border-slate-900 py-2.5 px-2 text-right font-black font-mono">${unitPriceText}</td>
            <td class="border-r border-slate-900 py-2.5 px-2 text-right font-black font-mono text-slate-950">${subtotalText}</td>
            <td class="py-2.5 px-2 text-center font-bold text-slate-700">${data.delivery || '즉시 출고'}</td>
          </tr>
          <!-- 엑셀 서식 여백 행 -->
          <tr class="border-b border-slate-200 h-7"><td class="border-r border-slate-900"></td><td class="border-r border-slate-900"></td><td class="border-r border-slate-900"></td><td class="border-r border-slate-900"></td><td class="border-r border-slate-900"></td><td class="border-r border-slate-900"></td><td></td></tr>
          <tr class="border-b border-slate-200 h-7"><td class="border-r border-slate-900"></td><td class="border-r border-slate-900"></td><td class="border-r border-slate-900"></td><td class="border-r border-slate-900"></td><td class="border-r border-slate-900"></td><td class="border-r border-slate-900"></td><td></td></tr>
        </tbody>
      </table>

      <!-- 5. 우측 금액 합계 정산 영역 (엑셀 행 35~39) -->
      <div class="flex justify-end mb-4">
        <table class="w-64 border-collapse border border-slate-900 text-[10.5px]">
          <tbody>
            <tr class="border-b border-slate-300">
              <td class="font-bold py-1 px-2 text-slate-700">AMOUNT</td>
              <td class="w-3 text-center font-bold">:</td>
              <td class="text-right py-1 px-2 font-mono font-bold">${subtotalText}</td>
            </tr>
            <tr class="border-b border-slate-300">
              <td class="font-bold py-1 px-2 text-slate-700">VAT(10%)</td>
              <td class="w-3 text-center font-bold">:</td>
              <td class="text-right py-1 px-2 font-mono font-bold">${vatText}</td>
            </tr>
            <tr class="bg-slate-100 font-black border-t-2 border-slate-900">
              <td class="py-1.5 px-2 text-slate-950">* TOTAL AMOUNT</td>
              <td class="w-3 text-center font-bold">:</td>
              <td class="text-right py-1.5 px-2 font-mono text-xs text-slate-950">${totalText}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 6. 거래 조건 (엑셀 행 42~52 규격) -->
      <div class="space-y-1 text-[10.5px] mb-5">
        <div class="flex"><strong class="w-36 text-slate-800">* PAYMENT TERMS</strong> <span class="w-3 text-center">:</span> <span class="font-bold text-slate-950">${data.paymentTerms || '익월말 현금결제 (VAT 포함)'}</span></div>
        <div class="flex"><strong class="w-36 text-slate-800">* INCO TERMS</strong> <span class="w-3 text-center">:</span> <span class="font-bold">${data.incoTerms || 'DOMESTIC'}</span></div>
        <div class="flex"><strong class="w-36 text-slate-800">* ORIGIN</strong> <span class="w-3 text-center">:</span> <span>${data.origin || 'TAIWAN'}</span></div>
        <div class="flex"><strong class="w-36 text-slate-800">* SHIPPING PORT</strong> <span class="w-3 text-center">:</span> <span>${data.shippingPort || 'TAIWAN'}</span></div>
        <div class="flex"><strong class="w-36 text-slate-800">* VALIDITY</strong> <span class="w-3 text-center">:</span> <span class="font-bold text-indigo-900">${data.validity || '7 DAYS'}</span></div>
        <div class="flex items-start"><strong class="w-36 text-slate-800">* REMARKS</strong> <span class="w-3 text-center">:</span> <span class="italic text-slate-700">We are pleased to offer you the parts on the terms and conditions described as above.</span></div>
      </div>

      <!-- 7. 하단 결재/직인 및 계좌 (엑셀 행 56~64 규격) -->
      <div class="pt-3 border-t border-slate-300 grid grid-cols-12 gap-3 items-end">
        <!-- 계좌 정보 -->
        <div class="col-span-8 p-2.5 bg-slate-50 border border-slate-300 rounded text-[10px] leading-relaxed">
          ${accountHtml}
        </div>

        <!-- 직인란 -->
        <div class="col-span-4 text-right space-y-2">
          <div class="text-[10px] text-slate-500 font-semibold">CC : D.I.Lee</div>
          <div class="text-xs font-black text-slate-900 flex items-center justify-end gap-1.5">
            <span>* Authorized by</span>
            <span class="inline-block border-b border-slate-900 w-20 text-center font-serif text-[10px] text-slate-400">
              (인)
            </span>
          </div>
        </div>
      </div>

    </div>
  `;

  modal.classList.remove('hidden');
}
