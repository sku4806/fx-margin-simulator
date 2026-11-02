/**
 * 📄 고객사 제출용 공식 견적서 (Quotation) / 패킹리스트 렌더링 모듈
 */

export function openQuotationPrintModal(data) {
  const modal = document.getElementById('quotationPdfModal');
  const preview = document.getElementById('quotationPrintArea');
  if (!modal || !preview) return;

  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;
  const validUntil = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
  const validStr = `${validUntil.getFullYear()}년 ${validUntil.getMonth() + 1}월 ${validUntil.getDate()}일 (14일간 유효)`;

  const quoteNo = `BSK-QT-${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}-${Math.floor(100 + Math.random() * 900)}`;

  const totalUsd = data.qty * data.unitPriceUsd;
  const totalKrw = Math.round(totalUsd * data.appliedFx);

  preview.innerHTML = `
    <div class="p-8 sm:p-10 bg-white text-slate-800 max-w-3xl mx-auto border sm:border-slate-300 sm:rounded-xl shadow-none sm:shadow-lg font-sans text-xs leading-normal print:p-0 print:border-0 print:shadow-none">
      
      <!-- 헤더: 타이틀 & 공급자 정보 -->
      <div class="flex justify-between items-start border-b-2 border-slate-900 pb-4 mb-6">
        <div>
          <h1 class="text-2xl sm:text-3xl font-black tracking-widest text-[#0b2046]">QUOTATION</h1>
          <div class="text-[11px] font-bold text-slate-500 mt-1">견적 번호: <span class="font-mono text-slate-800">${quoteNo}</span></div>
          <div class="text-[11px] text-slate-500">견적 일자: <span class="font-semibold text-slate-800">${dateStr}</span></div>
          <div class="text-[11px] text-slate-500">유효 기간: <span class="font-bold text-indigo-700">${validStr}</span></div>
        </div>

        <div class="text-right text-[11px] space-y-0.5">
          <div class="text-base font-black text-slate-900">빅샤인 코리아 주식회사</div>
          <div class="text-slate-600">BIGSHINE KOREA CO., LTD.</div>
          <div class="text-slate-500">담당자: ${data.salesRep || '영업부'} (${data.userEmail || 'sales@bigshine.co.kr'})</div>
          <div class="text-slate-500">공식 웹사이트: www.bigshine.co.kr</div>
        </div>
      </div>

      <!-- 수신 고객사 정보 -->
      <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 mb-6 flex justify-between items-center">
        <div>
          <span class="text-[10px] text-slate-400 font-bold block">수신 (BUYER / CUSTOMER)</span>
          <div class="text-sm font-black text-slate-900 mt-0.5">${data.customer || '귀하 (고객사명 미지정)'} 님 귀하</div>
        </div>
        <div class="text-right text-[11px] text-slate-600">
          <div>기준 적용 환율: <strong class="text-slate-900 font-mono font-bold">₩${Math.round(data.appliedFx).toLocaleString()} / USD</strong></div>
          <div>결제 조건: <strong class="text-indigo-900 font-bold">${data.paymentTerms || 'Net 30'}</strong></div>
        </div>
      </div>

      <!-- 품목 견적 테이블 -->
      <table class="w-full text-left border-collapse border border-slate-300 mb-6 text-xs">
        <thead>
          <tr class="bg-slate-100 text-slate-700 text-[11px] font-bold">
            <th class="border border-slate-300 py-2 px-2 text-center w-10">No</th>
            <th class="border border-slate-300 py-2 px-2.5">품목명 (Description / Part No)</th>
            <th class="border border-slate-300 py-2 px-2 text-center w-20">제조사</th>
            <th class="border border-slate-300 py-2 px-2 text-center w-16">D/C</th>
            <th class="border border-slate-300 py-2 px-2 text-right w-20">수량(EA)</th>
            <th class="border border-slate-300 py-2 px-2.5 text-right w-28">공급단가 (USD)</th>
            <th class="border border-slate-300 py-2 px-2.5 text-right w-32">견적 합계 (USD)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="border border-slate-300 py-3 px-2 text-center font-bold">1</td>
            <td class="border border-slate-300 py-3 px-2.5 font-bold text-slate-900">
              <div>${data.partName}</div>
              ${data.spq ? `<div class="text-[10px] text-slate-500 font-normal">포장 단위(SPQ): ${Number(data.spq).toLocaleString()} EA/Reel</div>` : ''}
            </td>
            <td class="border border-slate-300 py-3 px-2 text-center font-semibold text-slate-700">${data.maker}</td>
            <td class="border border-slate-300 py-3 px-2 text-center font-mono font-semibold">${data.dateCode || '-'}</td>
            <td class="border border-slate-300 py-3 px-2 text-right font-black text-slate-900">${Number(data.qty).toLocaleString()}</td>
            <td class="border border-slate-300 py-3 px-2.5 text-right font-black text-indigo-950 font-mono">$${Number(data.unitPriceUsd).toFixed(4)}</td>
            <td class="border border-slate-300 py-3 px-2.5 text-right font-black text-slate-900 font-mono">$${totalUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="bg-indigo-50/60 font-bold">
            <td colspan="6" class="border border-slate-300 py-2.5 px-3 text-right text-indigo-950">총 견적 합계 (USD):</td>
            <td class="border border-slate-300 py-2.5 px-2.5 text-right font-black text-indigo-950 font-mono text-sm">$${totalUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
          </tr>
          <tr class="bg-slate-50">
            <td colspan="6" class="border border-slate-300 py-2 px-3 text-right text-slate-600 text-[11px]">원화(KRW) 환산 참고액 (VAT 별도):</td>
            <td class="border border-slate-300 py-2 px-2.5 text-right font-bold text-slate-800 font-mono text-xs">₩${totalKrw.toLocaleString()}</td>
          </tr>
        </tfoot>
      </table>

      <!-- 비고사항 및 조건 -->
      <div class="border rounded-lg p-3 bg-slate-50/50 text-[11px] text-slate-600 space-y-1 mb-8">
        <div class="font-bold text-slate-800">[특약 및 거래조건]</div>
        <div>1. 납기 (Delivery): 발주 접수 후 본사 재고 즉시 출고 (익일 납품 가능)</div>
        <div>2. 인도 조건: 당사 창고 상차도 또는 택배/화물 발송</div>
        <div>3. 부가세(VAT)는 별도이며, 기준 환율 급변(±3% 이상) 시 상호 협의 후 단가 재조정될 수 있습니다.</div>
        ${data.memo ? `<div>4. 특이사항: ${data.memo}</div>` : ''}
      </div>

      <!-- 직인 서명란 -->
      <div class="flex justify-between items-end pt-4 border-t border-slate-200">
        <div class="text-[10px] text-slate-400">
          본 견적서는 전자 시스템을 통해 생성된 공식 문서입니다.
        </div>
        <div class="text-right">
          <div class="text-xs font-bold text-slate-900">빅샤인 코리아 주식회사 代表理事</div>
          <div class="text-[10px] text-slate-500 font-serif mt-0.5">(직인 생략)</div>
        </div>
      </div>

    </div>
  `;

  modal.classList.remove('hidden');
}
