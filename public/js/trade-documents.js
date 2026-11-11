/**
 * trade-documents.js
 * 전자문서 원클릭 PDF/인쇄 엔진 (거래명세서 & 패킹리스트)
 * (FrmInvoice & FrmPackingList 기능 이식)
 */

function numberToKorean(number) {
  const num = Math.round(number);
  if (num === 0) return '영';
  const units = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const smallUnits = ['', '십', '백', '천'];
  const bigUnits = ['', '만', '억', '조'];

  let result = '';
  let temp = num;
  let bigUnitIdx = 0;

  while (temp > 0) {
    let part = temp % 10000;
    temp = Math.floor(temp / 10000);

    let partStr = '';
    let smallUnitIdx = 0;

    while (part > 0) {
      const digit = part % 10;
      if (digit > 0) {
        partStr = units[digit] + smallUnits[smallUnitIdx] + partStr;
      }
      part = Math.floor(part / 10);
      smallUnitIdx++;
    }

    if (partStr) {
      result = partStr + bigUnits[bigUnitIdx] + ' ' + result;
    }
    bigUnitIdx++;
  }

  return result.trim();
}

export function openInvoiceModal(item) {
  if (!item) return;

  const modalId = 'tradeInvoiceModal';
  let modal = document.getElementById(modalId);
  if (!modal) {
    modal = document.createElement('div');
    modalId && (modal.id = modalId);
    modal.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[99999] flex items-center justify-center p-2 sm:p-4 overflow-y-auto';
    document.body.appendChild(modal);
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const shipDate = item.order_date || item.shipped_date || item.entry_date || todayStr;
  const cname = item.customer_name || item.cname || item.customer || '(주)거래처';
  const partNo = item.part_name || item.part_no || item.partName || '-';
  const maker = item.maker || item.mfg || '-';
  const qty = Number(item.qty || item.stock || 1);
  const unitPrice = Math.round(Number(item.unit_price || item.unitKrw || item.amount_vat / 1.1 / qty || 0));
  const supplyPrice = unitPrice * qty;
  const vat = Math.round(supplyPrice * 0.1);
  const totalAmount = supplyPrice + vat;
  const koreanAmount = numberToKorean(totalAmount);
  const poNo = item.po_no || item.poNo || '-';

  modal.innerHTML = `
    <div class="bg-white w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-300 p-4 sm:p-8 flex flex-col space-y-4 my-auto print:p-0 print:border-none print:shadow-none" onclick="event.stopPropagation()">
      
      <!-- 상단 컨트롤러 (화면 표시 전용) -->
      <div class="flex items-center justify-between border-b pb-3 no-print">
        <div class="flex items-center gap-2">
          <span class="text-xl">📄</span>
          <span class="font-bold text-slate-800 text-sm">전자 거래명세서 (공급받는자 보관용)</span>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" onclick="window.print()" class="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-lg shadow-sm flex items-center gap-1 cursor-pointer">
            <span>🖨️</span> 인쇄 / PDF 저장
          </button>
          <button type="button" onclick="document.getElementById('${modalId}').classList.add('hidden')" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg cursor-pointer">
            닫기 ✕
          </button>
        </div>
      </div>

      <!-- 인쇄 본문 영역 -->
      <div class="text-black font-sans space-y-3 print:space-y-2">
        
        <!-- 타이틀 -->
        <div class="text-center py-1 border-b-2 border-slate-900">
          <h1 class="text-2xl font-black tracking-widest uppercase">거 래 명 세 서</h1>
          <p class="text-[10px] text-slate-500 font-medium tracking-tight mt-0.5">( 공급받는자 보관용 )</p>
        </div>

        <!-- 발행일자 및 공급자/공급받는자 그리드 -->
        <div class="grid grid-cols-2 gap-2 text-[11px]">
          <!-- 공급받는자 -->
          <div class="border border-slate-400 p-2 rounded-lg flex flex-col justify-between">
            <div class="space-y-1">
              <div class="font-bold text-slate-700 flex items-center gap-1">
                <span class="text-xs">🏢</span> 공급받는자
              </div>
              <div class="font-black text-sm text-slate-900">${cname} 귀하</div>
              <div class="text-[10px] text-slate-600">발행일자: <span class="font-mono font-bold">${shipDate}</span></div>
              <div class="text-[10px] text-slate-600">P/O 번호: <span class="font-mono font-bold">${poNo}</span></div>
            </div>
            <div class="pt-2 text-[10px] text-slate-500 border-t border-slate-200 mt-2">
              아래와 같이 계산 공급합니다.
            </div>
          </div>

          <!-- 공급자 (빅샤인코리아 정보 + 직인) -->
          <div class="border border-slate-400 p-2 rounded-lg relative flex flex-col justify-between">
            <div class="space-y-0.5">
              <div class="font-bold text-slate-700 flex items-center justify-between">
                <span>공급자 정보</span>
                <span class="font-mono text-[9px] text-slate-500">등록번호: 214-87-54877</span>
              </div>
              <div class="font-black text-xs text-slate-900">상호: (주)빅샤인코리아</div>
              <div class="text-[10px] text-slate-700">대표자: 이동일</div>
              <div class="text-[10px] text-slate-600">사업장: 경기도 성남시 분당구 성남대로 779번길 18</div>
              <div class="text-[10px] text-slate-600">업태: 도소매 | 종목: 전자부품, 반도체</div>
              <div class="text-[10px] text-slate-600">TEL: 031-711-8881 | FAX: 031-711-8174</div>
            </div>
            <!-- BSK 법인 직인 워터마크 -->
            <img src="/BSK.jpg" alt="직인" class="absolute right-3 bottom-2 w-14 h-14 object-contain opacity-90 drop-shadow-xs pointer-events-none">
          </div>
        </div>

        <!-- 합계 금액 표기 바 -->
        <div class="bg-slate-100 border border-slate-400 px-3 py-1.5 flex items-center justify-between text-xs rounded-lg">
          <span class="font-bold text-slate-700">합계금액 (공급가액 + 세액):</span>
          <div class="font-mono text-right">
            <span class="font-black text-sm text-indigo-950">₩${totalAmount.toLocaleString()}</span>
            <span class="text-[10px] text-slate-600 ml-1 font-bold">(일금 ${koreanAmount}원정)</span>
          </div>
        </div>

        <!-- 품목 상세 테이블 -->
        <table class="w-full text-left text-[11px] border-collapse border border-slate-400">
          <thead class="bg-slate-100 border-b border-slate-400 font-bold text-slate-800 text-center">
            <tr>
              <th class="border border-slate-300 py-1.5 px-2 w-8">No</th>
              <th class="border border-slate-300 py-1.5 px-3 text-left">품명 및 규격 (Part#)</th>
              <th class="border border-slate-300 py-1.5 px-2 w-20">제조사</th>
              <th class="border border-slate-300 py-1.5 px-2 w-16 text-right">수량</th>
              <th class="border border-slate-300 py-1.5 px-2 w-24 text-right">단가(₩)</th>
              <th class="border border-slate-300 py-1.5 px-3 w-28 text-right">공급가액(₩)</th>
              <th class="border border-slate-300 py-1.5 px-2 w-24 text-right">세액(10%)</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200">
            <tr>
              <td class="border border-slate-300 py-2 px-2 text-center font-mono">1</td>
              <td class="border border-slate-300 py-2 px-3 font-bold text-slate-900">${partNo}</td>
              <td class="border border-slate-300 py-2 px-2 text-center text-slate-700">${maker}</td>
              <td class="border border-slate-300 py-2 px-2 text-right font-black font-mono">${qty.toLocaleString()}</td>
              <td class="border border-slate-300 py-2 px-2 text-right font-mono">₩${unitPrice.toLocaleString()}</td>
              <td class="border border-slate-300 py-2 px-3 text-right font-mono font-bold">₩${supplyPrice.toLocaleString()}</td>
              <td class="border border-slate-300 py-2 px-2 text-right font-mono">₩${vat.toLocaleString()}</td>
            </tr>
          </tbody>
          <tfoot class="bg-slate-50 border-t-2 border-slate-400 font-bold text-[11px]">
            <tr>
              <td colspan="5" class="border border-slate-300 py-1.5 px-3 text-center">소 계 및 합 계</td>
              <td class="border border-slate-300 py-1.5 px-3 text-right font-mono font-black text-slate-900">₩${supplyPrice.toLocaleString()}</td>
              <td class="border border-slate-300 py-1.5 px-2 text-right font-mono font-bold text-slate-700">₩${vat.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>

        <!-- 하단 인수자 확인란 -->
        <div class="border border-slate-300 p-2.5 rounded-lg flex items-center justify-between text-xs text-slate-700">
          <div class="space-y-0.5">
            <div class="text-[10px] text-slate-500">위 물품을 정히 영수(인수) 함.</div>
            <div class="font-bold">인수일자: ________년 ____월 ____일</div>
          </div>
          <div class="flex items-center gap-4">
            <span class="font-bold">인수자 성명: ____________________ (인)</span>
          </div>
        </div>

      </div>

    </div>
  `;

  modal.classList.remove('hidden');
  modal.onclick = (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  };
}

export function openPackingListModal(item) {
  if (!item) return;

  const modalId = 'tradePackingModal';
  let modal = document.getElementById(modalId);
  if (!modal) {
    modal = document.createElement('div');
    modalId && (modal.id = modalId);
    modal.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[99999] flex items-center justify-center p-2 sm:p-4 overflow-y-auto';
    document.body.appendChild(modal);
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const shipDate = item.order_date || item.shipped_date || item.entry_date || todayStr;
  const cname = item.customer_name || item.cname || item.customer || 'BIGSHINE OVERSEAS CLIENT';
  const partNo = item.part_name || item.part_no || item.partName || '-';
  const maker = item.maker || item.mfg || '-';
  const qty = Number(item.qty || item.stock || 1);
  const poNo = item.po_no || item.poNo || 'PO-2026-EXPORT';
  const trackingNo = item.tracking_no || item.trackingNo || 'DHL Express';

  modal.innerHTML = `
    <div class="bg-white w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-300 p-4 sm:p-8 flex flex-col space-y-4 my-auto print:p-0 print:border-none print:shadow-none" onclick="event.stopPropagation()">
      
      <!-- 상단 컨트롤러 -->
      <div class="flex items-center justify-between border-b pb-3 no-print">
        <div class="flex items-center gap-2">
          <span class="text-xl">📦</span>
          <span class="font-bold text-slate-800 text-sm">PACKING LIST (공식 패킹 명세서)</span>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" onclick="window.print()" class="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-lg shadow-sm flex items-center gap-1 cursor-pointer">
            <span>🖨️</span> 인쇄 / PDF 저장
          </button>
          <button type="button" onclick="document.getElementById('${modalId}').classList.add('hidden')" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg cursor-pointer">
            닫기 ✕
          </button>
        </div>
      </div>

      <!-- 패킹리스트 본문 -->
      <div class="text-black font-sans space-y-3 print:space-y-2">
        <div class="text-center py-1 border-b-2 border-slate-900">
          <h1 class="text-2xl font-serif font-black tracking-widest uppercase">PACKING LIST</h1>
          <p class="text-[10px] text-slate-500 font-mono tracking-widest mt-0.5">BIGSHINE KOREA CO., LTD.</p>
        </div>

        <div class="grid grid-cols-2 gap-3 text-[11px] border border-slate-400 p-3 rounded-lg">
          <div class="space-y-1">
            <div class="font-bold text-slate-700">SHIPPER / EXPORTER:</div>
            <div class="font-black text-slate-900">BIGSHINE KOREA CO., LTD.</div>
            <div class="text-slate-600 text-[10px]">18, Seongnam-daero 779beon-gil, Bundang-gu, Seongnam-si, Gyeonggi-do, Korea</div>
            <div class="text-slate-600 text-[10px]">TEL: 82-31-711-8881 | FAX: 82-31-711-8174</div>
          </div>
          <div class="space-y-1">
            <div class="font-bold text-slate-700">CONSIGNEE:</div>
            <div class="font-black text-slate-900">${cname}</div>
            <div class="text-slate-600 text-[10px]">DATE: <span class="font-mono font-bold">${shipDate}</span></div>
            <div class="text-slate-600 text-[10px]">P/O NO: <span class="font-mono font-bold">${poNo}</span></div>
            <div class="text-slate-600 text-[10px]">CARRIER / B/L: <span class="font-mono font-bold">${trackingNo}</span></div>
          </div>
        </div>

        <table class="w-full text-left text-[11px] border-collapse border border-slate-400">
          <thead class="bg-slate-100 border-b border-slate-400 font-bold text-slate-800 text-center">
            <tr>
              <th class="border border-slate-300 py-1.5 px-2 w-16">C/No</th>
              <th class="border border-slate-300 py-1.5 px-3 text-left">Description of Goods (Part#)</th>
              <th class="border border-slate-300 py-1.5 px-2 w-20">MFG</th>
              <th class="border border-slate-300 py-1.5 px-2 w-20 text-right">Quantity</th>
              <th class="border border-slate-300 py-1.5 px-2 w-20 text-right">Net Wt.</th>
              <th class="border border-slate-300 py-1.5 px-2 w-20 text-right">Gross Wt.</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="border border-slate-300 py-2 px-2 text-center font-mono">1/1</td>
              <td class="border border-slate-300 py-2 px-3 font-bold text-slate-900">${partNo}</td>
              <td class="border border-slate-300 py-2 px-2 text-center font-medium">${maker}</td>
              <td class="border border-slate-300 py-2 px-2 text-right font-black font-mono">${qty.toLocaleString()} EA</td>
              <td class="border border-slate-300 py-2 px-2 text-right font-mono">0.85 KG</td>
              <td class="border border-slate-300 py-2 px-2 text-right font-mono">1.10 KG</td>
            </tr>
          </tbody>
          <tfoot class="bg-slate-50 border-t-2 border-slate-400 font-bold text-[11px]">
            <tr>
              <td colspan="3" class="border border-slate-300 py-1.5 px-3 text-center">TOTAL</td>
              <td class="border border-slate-300 py-1.5 px-2 text-right font-mono font-black text-slate-900">${qty.toLocaleString()} EA</td>
              <td class="border border-slate-300 py-1.5 px-2 text-right font-mono">0.85 KG</td>
              <td class="border border-slate-300 py-1.5 px-2 text-right font-mono">1.10 KG</td>
            </tr>
          </tfoot>
        </table>

        <!-- 하단 서명 및 직인 -->
        <div class="pt-2 flex items-center justify-between text-xs">
          <div class="text-[10px] text-slate-500">
            TOTAL PACKAGES: 1 CARTON ONLY
          </div>
          <div class="flex items-center gap-3">
            <div class="text-right">
              <div class="font-bold text-slate-800">BIGSHINE KOREA CO., LTD.</div>
              <div class="text-[10px] text-slate-500">Authorized Signature</div>
            </div>
            <img src="/BSK.jpg" alt="직인" class="w-12 h-12 object-contain opacity-95 drop-shadow-xs">
          </div>
        </div>

      </div>

    </div>
  `;

  modal.classList.remove('hidden');
  modal.onclick = (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  };
}

window.openTradeInvoice = openInvoiceModal;
window.openTradePacking = openPackingListModal;
