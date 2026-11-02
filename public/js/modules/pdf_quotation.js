/**
 * 📄 빅샤인 코리아 공식 견적서(견적서양식.xls 기반) 1:1 인쇄 모듈
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
    const upKrw = Math.round(data.unitPriceKrw || (unitPrice * data.appliedFx));
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

  preview.innerHTML = `
    <div class="quotation-sheet bg-white text-slate-900 mx-auto font-sans text-[12px] leading-tight p-8 max-w-[210mm] min-h-[297mm] shadow-lg print:shadow-none print:p-0 print:m-0 print:border-0 border border-slate-300">
      
      <!-- 1. 상단 공급자 정보 -->
      <div class="text-right space-y-0.5 mb-4">
        <div class="text-base font-black tracking-tight text-slate-900">BIGSHINE KOREA CO., LTD</div>
        <div class="text-[10px] text-slate-700 leading-snug">
          B-601, Yongin TechnoValley, 357 Guseong-ro, Giheung-gu,<br>
          Yongin-si, Gyeonggi-do 16914, Rep. of Korea
        </div>
        <div class="text-[10px] text-slate-700 pt-0.5">
          Tel: 82-31-711-8881 &nbsp; Fax : 82-31-711-8174
        </div>
      </div>

      <!-- 2. 중앙 타이틀 -->
      <div class="text-center my-6">
        <h1 class="text-2xl font-black tracking-[0.3em] inline-block border-b-2 border-slate-900 pb-1">
          Q U O T A T I O N
        </h1>
      </div>

      <!-- 3. 좌/우 수신처 및 메타 박스 (원본 엑셀 테이블 규격) -->
      <div class="border border-slate-900 p-3 mb-4 grid grid-cols-12 gap-2 text-[11px]">
        <!-- 좌측 수신자 -->
        <div class="col-span-7 space-y-1">
          <div class="flex">
            <span class="w-14 font-bold text-slate-800">TO</span>
            <span class="w-3 text-center">:</span>
            <span class="font-bold text-slate-950">${data.customer || ''}</span>
          </div>
          <div class="flex">
            <span class="w-14 font-bold text-slate-800">ATTN</span>
            <span class="w-3 text-center">:</span>
            <span class="font-bold text-slate-950">${data.attn || ''}</span>
          </div>
          <div class="flex">
            <span class="w-14 font-bold text-slate-800">TEL</span>
            <span class="w-3 text-center">:</span>
            <span class="font-mono">${data.customerTel || ''}</span>
          </div>
          <div class="flex">
            <span class="w-14 font-bold text-slate-800">FAX</span>
            <span class="w-3 text-center">:</span>
            <span class="font-mono">${data.customerFax || ''}</span>
          </div>
        </div>

        <!-- 우측 문서 정보 -->
        <div class="col-span-5 space-y-1 pl-4 border-l border-slate-300">
          <div class="flex">
            <span class="w-14 font-bold text-slate-800">DATE</span>
            <span class="w-3 text-center">:</span>
            <span class="font-mono font-bold">${dateStr}</span>
          </div>
          <div class="flex">
            <span class="w-14 font-bold text-slate-800">PAGE</span>
            <span class="w-3 text-center">:</span>
            <span>1 OF 1</span>
          </div>
          <div class="flex">
            <span class="w-14 font-bold text-slate-800">REF</span>
            <span class="w-3 text-center">:</span>
            <span class="font-mono font-bold text-indigo-900">${refNo}</span>
          </div>
          <div class="flex">
            <span class="w-14 font-bold text-slate-800">FROM</span>
            <span class="w-3 text-center">:</span>
            <span class="font-bold">${data.salesRep || '황 환'}</span>
          </div>
        </div>
      </div>

      <!-- 4. 품목 견적 테이블 (엑셀 원본 컬럼 구조) -->
      <table class="w-full text-left border-collapse border border-slate-900 mb-4 text-[11px]">
        <thead>
          <tr class="bg-slate-100 text-slate-900 font-bold border-b border-slate-900 text-center">
            <th class="border-r border-slate-900 py-2 px-1 w-10">No</th>
            <th class="border-r border-slate-900 py-2 px-3 text-left">PART #</th>
            <th class="border-r border-slate-900 py-2 px-2 w-28">MFG</th>
            <th class="border-r border-slate-900 py-2 px-2 w-24">QTY</th>
            <th class="border-r border-slate-900 py-2 px-3 text-right w-28">U/P</th>
            <th class="border-r border-slate-900 py-2 px-3 text-right w-32">AMOUNT</th>
            <th class="py-2 px-2 text-center w-24">DELIVERY</th>
          </tr>
        </thead>
        <tbody>
          <tr class="border-b border-slate-300 min-h-[40px]">
            <td class="border-r border-slate-900 py-3 px-1 text-center font-bold">1</td>
            <td class="border-r border-slate-900 py-3 px-3 font-bold text-slate-950">
              <div>${data.partName || ''}</div>
              ${data.dateCode && data.dateCode !== '-' ? `<div class="text-[10px] text-slate-500 font-normal">D/C: ${data.dateCode}</div>` : ''}
              ${data.spq ? `<div class="text-[9px] text-slate-400 font-normal">SPQ: ${Number(data.spq).toLocaleString()} EA</div>` : ''}
            </td>
            <td class="border-r border-slate-900 py-3 px-2 text-center font-bold text-slate-700">${data.maker || ''}</td>
            <td class="border-r border-slate-900 py-3 px-2 text-center font-bold text-slate-900">${qty ? `${qty.toLocaleString()} pcs` : ''}</td>
            <td class="border-r border-slate-900 py-3 px-3 text-right font-black font-mono">${unitPriceText}</td>
            <td class="border-r border-slate-900 py-3 px-3 text-right font-black font-mono text-slate-950">${subtotalText}</td>
            <td class="py-3 px-2 text-center font-bold text-slate-700">${data.delivery || '즉시 출고'}</td>
          </tr>
          <!-- 빈 줄 여백 유지 -->
          <tr class="border-b border-slate-200 h-10"><td class="border-r border-slate-900"></td><td class="border-r border-slate-900"></td><td class="border-r border-slate-900"></td><td class="border-r border-slate-900"></td><td class="border-r border-slate-900"></td><td class="border-r border-slate-900"></td><td></td></tr>
          <tr class="border-b border-slate-200 h-10"><td class="border-r border-slate-900"></td><td class="border-r border-slate-900"></td><td class="border-r border-slate-900"></td><td class="border-r border-slate-900"></td><td class="border-r border-slate-900"></td><td class="border-r border-slate-900"></td><td></td></tr>
        </tbody>
      </table>

      <!-- 5. 금액 합계 정산 영역 (엑셀 우측 정렬 박스) -->
      <div class="flex justify-end mb-6">
        <div class="w-72 border border-slate-900 divide-y divide-slate-300 text-[11px]">
          <div class="flex justify-between py-1.5 px-3">
            <span class="font-bold text-slate-700">AMOUNT :</span>
            <span class="font-mono font-bold">${subtotalText}</span>
          </div>
          <div class="flex justify-between py-1.5 px-3">
            <span class="font-bold text-slate-700">VAT(10%) :</span>
            <span class="font-mono font-bold">${vatText}</span>
          </div>
          <div class="flex justify-between py-2 px-3 bg-slate-100 font-black text-slate-950 border-t-2 border-slate-900">
            <span>* TOTAL AMOUNT :</span>
            <span class="font-mono text-xs">${totalText}</span>
          </div>
        </div>
      </div>

      <!-- 6. 하단 거래 조건 (엑셀 원본 문구 1:1 반영) -->
      <div class="space-y-1.5 text-[11px] mb-6">
        <div class="flex"><strong class="w-40 text-slate-800">* PAYMENT TERMS</strong> <span class="w-3 text-center">:</span> <span class="font-bold text-slate-950">${data.paymentTerms || '익월말 현금결제 (VAT 포함)'}</span></div>
        <div class="flex"><strong class="w-40 text-slate-800">* INCO TERMS</strong> <span class="w-3 text-center">:</span> <span class="font-bold">${data.incoTerms || 'DOMESTIC'}</span></div>
        <div class="flex"><strong class="w-40 text-slate-800">* ORIGIN</strong> <span class="w-3 text-center">:</span> <span>${data.origin || 'TAIWAN'}</span></div>
        <div class="flex"><strong class="w-40 text-slate-800">* SHIPPING PORT</strong> <span class="w-3 text-center">:</span> <span>${data.shippingPort || 'TAIWAN'}</span></div>
        <div class="flex"><strong class="w-40 text-slate-800">* VALIDITY</strong> <span class="w-3 text-center">:</span> <span class="font-bold text-indigo-900">${data.validity || '7 DAYS'}</span></div>
        <div class="flex items-start"><strong class="w-40 text-slate-800">* REMARKS</strong> <span class="w-3 text-center">:</span> <span class="italic text-slate-700">We are pleased to offer you the parts on the terms and conditions described as above.</span></div>
      </div>

      <!-- 7. 하단 입금 계좌 & 직인 결재란 -->
      <div class="pt-4 border-t border-slate-300 grid grid-cols-12 gap-4 items-end">
        <!-- 계좌 정보 -->
        <div class="col-span-8 p-3 bg-slate-50 border border-slate-300 rounded text-[11px] leading-relaxed">
          <div class="font-bold text-slate-900 mb-1 flex items-center gap-1">
            <span>🏦</span> * ACCOUNT INFO : <span class="text-indigo-900 font-black">${isKrw ? '- 원화(₩) 계좌 -' : '- 외화($) 계좌 -'}</span>
          </div>
          <div class="text-slate-700">KEB하나은행으로 송금부탁드립니다.</div>
          <div class="text-slate-900 font-bold">예금주 : ㈜ 빅샤인코리아</div>
          <div class="font-mono font-black text-slate-950 mt-0.5">계좌번호 : 374-890003-50704</div>
        </div>

        <!-- 직인란 -->
        <div class="col-span-4 text-right space-y-3">
          <div class="text-[11px] text-slate-500 font-semibold">CC : D.I.Lee</div>
          <div class="text-xs font-black text-slate-900 flex items-center justify-end gap-1.5">
            <span>* Authorized by</span>
            <span class="inline-block border-b border-slate-900 w-24 text-center font-serif text-[10px] text-slate-400">
              (인)
            </span>
          </div>
        </div>
      </div>

    </div>
  `;

  modal.classList.remove('hidden');
}
