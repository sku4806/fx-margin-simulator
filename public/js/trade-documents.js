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

/**
 * 📄 거래처별 미수금 잔액 확인서 / 청구서 (Statement of Account) A4 규격 모달
 */
export function openStatementOfAccountModal(customerName, items = []) {
  let targetItems = items;
  if (!targetItems || targetItems.length === 0) {
    if (window.currentUnpaidList && customerName) {
      targetItems = window.currentUnpaidList.filter(u => 
        (u.cname || u.customer_name || '').trim().toLowerCase() === customerName.trim().toLowerCase()
      );
    }
  }

  if (!targetItems || targetItems.length === 0) {
    alert(`'${customerName || '선택한 거래처'}'의 미수금 내역이 없습니다.`);
    return;
  }

  const modalId = 'statementOfAccountModal';
  let modal = document.getElementById(modalId);
  if (!modal) {
    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'fixed inset-0 bg-slate-900/70 backdrop-blur-xs z-[99999] flex items-center justify-center p-2 sm:p-4 overflow-y-auto';
    modal.onclick = (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    };
    document.body.appendChild(modal);
  }

  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${String(today.getMonth() + 1).padStart(2, '0')}월 ${String(today.getDate()).padStart(2, '0')}일`;
  const docNo = `SOA-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}-${targetItems[0].idx || '01'}`;

  const firstItem = targetItems[0];
  const cname = customerName || firstItem.cname || firstItem.customer_name || '거래처';
  const cAddress = firstItem.customer_address || '-';
  const cTel = firstItem.customer_tel || '-';
  const cContact = firstItem.contact || '-';

  // 합계 계산
  let totalSupply = 0;
  let totalVat = 0;
  let totalAmount = 0;
  let totalQty = 0;

  const rowsHtml = targetItems.map((item, idx) => {
    const qty = Number(item.qty || 1);
    const amountVat = Number(item.amount_vat || item.amountVat || 0);
    const supply = item.supply_amount ? Number(item.supply_amount) : Math.round(amountVat / 1.1);
    const vat = Math.round(amountVat - supply);
    const unitPrice = item.unit_price ? Number(item.unit_price) : Math.round(supply / qty);

    totalSupply += supply;
    totalVat += vat;
    totalAmount += amountVat;
    totalQty += qty;

    const overdueDays = Number(item.overdue_days || 0);
    let overdueLabel = '결제예정';
    let overdueClass = 'text-blue-700 font-semibold';
    if (overdueDays > 0) {
      overdueLabel = `+${overdueDays}일 연체`;
      overdueClass = 'text-rose-700 font-bold';
    } else if (overdueDays < 0) {
      overdueLabel = `D${overdueDays}일`;
    }

    return `
      <tr class="border-b border-slate-300 text-[10px] sm:text-[11px] hover:bg-slate-50">
        <td class="py-1 px-1.5 text-center text-slate-500 font-mono">${idx + 1}</td>
        <td class="py-1 px-1.5 text-center font-mono text-slate-700 whitespace-nowrap">${item.out_dt || item.out_date || '-'}</td>
        <td class="py-1 px-2 font-mono text-slate-800 truncate max-w-[100px]" title="${item.po_no || '-'}">${item.po_no || '-'}</td>
        <td class="py-1 px-2 font-bold text-slate-900 truncate max-w-[170px]" title="${item.part_no || '-'}">${item.part_no || '-'}</td>
        <td class="py-1 px-1.5 text-slate-700">${item.mfg || item.maker || '-'}</td>
        <td class="py-1 px-1.5 text-right font-bold text-slate-900 whitespace-nowrap">${qty.toLocaleString()}</td>
        <td class="py-1 px-2 text-right font-mono text-slate-700 whitespace-nowrap">₩${Math.round(unitPrice).toLocaleString()}</td>
        <td class="py-1 px-2 text-right font-mono text-slate-800 whitespace-nowrap">₩${Math.round(supply).toLocaleString()}</td>
        <td class="py-1 px-2 text-right font-mono font-bold text-indigo-900 whitespace-nowrap">₩${Math.round(amountVat).toLocaleString()}</td>
        <td class="py-1 px-1.5 text-center font-mono whitespace-nowrap">${item.due_date || '-'}</td>
        <td class="py-1 px-1.5 text-center whitespace-nowrap ${overdueClass}">${overdueLabel}</td>
      </tr>
    `;
  }).join('');

  const koreanAmount = numberToKorean(totalAmount);

  modal.innerHTML = `
    <div class="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-300 p-4 sm:p-8 flex flex-col space-y-4 my-auto print:p-0 print:border-none print:shadow-none" onclick="event.stopPropagation()">
      
      <!-- 상단 컨트롤러 (화면 표시 전용) -->
      <div class="flex items-center justify-between border-b pb-3 no-print">
        <div class="flex items-center gap-2">
          <span class="text-xl">📄</span>
          <span class="font-bold text-slate-800 text-sm">거래처별 미수금 잔액 확인서 / 청구서 (A4 규격)</span>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" onclick="window.print()" class="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-black text-xs rounded-lg shadow-sm flex items-center gap-1 cursor-pointer">
            <span>🖨️</span> 인쇄 / PDF 저장
          </button>
          <button type="button" onclick="document.getElementById('${modalId}').classList.add('hidden')" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg cursor-pointer">
            닫기 ✕
          </button>
        </div>
      </div>

      <!-- A4 인쇄 본문 영역 -->
      <div class="text-black font-sans space-y-3.5 print:space-y-2.5">
        
        <!-- 문서 타이틀 & 문서번호 -->
        <div class="text-center relative border-b-2 border-slate-900 pb-2">
          <div class="text-[10px] text-slate-500 font-mono absolute left-0 top-0 text-left">
            문서번호: ${docNo}<br>
            발급일자: ${dateStr}
          </div>
          <h1 class="text-2xl sm:text-3xl font-black tracking-widest text-slate-950">미 수 금  잔 액  확 인 서</h1>
          <div class="text-[11px] font-bold text-slate-600 tracking-wider mt-0.5">( 청 구 서 / STATEMENT OF ACCOUNT )</div>
        </div>

        <!-- 인사말 및 기준일자 -->
        <div class="text-xs text-slate-800 leading-relaxed font-medium">
          귀사의 무궁한 발전을 기원합니다.<br>
          당사와 귀사 간의 거래에 따른 <strong>${dateStr}</strong> 현재 미수금 잔액을 아래와 같이 청구하오니 확인 후 결제 기한 내 입금하여 주시기 바랍니다.
        </div>

        <!-- 공급자 & 공급받는자 2단 정보 테이블 -->
        <div class="grid grid-cols-2 gap-2 text-xs">
          <!-- 공급자 (빅샤인코리아) -->
          <div class="border border-slate-800 rounded-sm p-2.5 flex flex-col justify-between relative bg-slate-50/30">
            <div class="font-black text-slate-900 border-b border-slate-400 pb-1 mb-1 text-[11px] flex items-center justify-between">
              <span>[공급자 (청구인)]</span>
              <span class="text-[10px] font-normal text-slate-500">Bigshine Korea Co., Ltd.</span>
            </div>
            <div class="space-y-1 text-[11px]">
              <div class="flex items-center"><span class="w-16 shrink-0 text-slate-500 font-bold">등록번호:</span><span class="font-black font-mono">214-87-54877</span></div>
              <div class="flex items-center justify-between">
                <div class="flex items-center"><span class="w-16 shrink-0 text-slate-500 font-bold">상&nbsp;&nbsp;&nbsp;&nbsp;호:</span><span class="font-bold">(주)빅샤인코리아</span></div>
                <div class="flex items-center relative pr-10">
                  <span class="text-slate-500 font-bold mr-1 whitespace-nowrap">대 표 자:</span>
                  <span class="font-black text-slate-900 whitespace-nowrap">이동일</span>
                  <img src="/BSK.jpg" alt="직인" class="w-9 h-9 object-contain absolute -right-1 -top-1.5 opacity-90 pointer-events-none">
                </div>
              </div>
              <div class="flex"><span class="w-16 shrink-0 text-slate-500 font-bold">주&nbsp;&nbsp;&nbsp;&nbsp;소:</span><span class="leading-tight">서울특별시 서초구 방배로 125, 3층 (방배동, 정원빌딩)</span></div>
              <div class="flex items-center"><span class="w-16 shrink-0 text-slate-500 font-bold">업태/종목:</span><span>도매 및 소매업 / 전자부품, 무역</span></div>
              <div class="flex items-center"><span class="w-16 shrink-0 text-slate-500 font-bold">전화/팩스:</span><span class="font-mono">02-588-6447 / 02-588-6448</span></div>
            </div>
          </div>

          <!-- 공급받는자 (고객사) -->
          <div class="border border-slate-800 rounded-sm p-2.5 flex flex-col justify-between bg-slate-50/30">
            <div class="font-black text-slate-900 border-b border-slate-400 pb-1 mb-1 text-[11px]">
              [공급받는자 (수신)]
            </div>
            <div class="space-y-1 text-[11px]">
              <div class="flex items-center"><span class="w-16 shrink-0 text-slate-500 font-bold">고 객 사:</span><span class="font-black text-sm text-indigo-950">${cname}</span></div>
              <div class="flex"><span class="w-16 shrink-0 text-slate-500 font-bold">사업장주소:</span><span class="truncate max-w-[240px] leading-tight">${cAddress}</span></div>
              <div class="flex items-center"><span class="w-16 shrink-0 text-slate-500 font-bold">전화번호:</span><span class="font-mono">${cTel}</span></div>
              <div class="flex items-center"><span class="w-16 shrink-0 text-slate-500 font-bold">담 당 자:</span><span>${cContact} 귀하</span></div>
              <div class="flex items-center"><span class="w-16 shrink-0 text-slate-500 font-bold">기준일자:</span><span class="font-mono text-slate-700">${dateStr} 현재</span></div>
            </div>
          </div>
        </div>

        <!-- 총 청구 금액 배너 -->
        <div class="border-2 border-slate-900 bg-slate-100 px-3.5 py-2.5 rounded-sm flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="font-black text-slate-900 text-xs sm:text-sm whitespace-nowrap">총 청구 금액 :</span>
            <span class="text-sm sm:text-base font-black text-rose-700 underline underline-offset-4 font-mono whitespace-nowrap">
              일금 ${koreanAmount} 원정 ( ₩${totalAmount.toLocaleString()} )
            </span>
            <span class="text-[10px] text-slate-600 font-bold whitespace-nowrap">(VAT 포함)</span>
          </div>
          <div class="text-right text-[10.5px] font-mono text-slate-700 whitespace-nowrap">
            공급가액: <strong>₩${totalSupply.toLocaleString()}</strong> | 세액: <strong>₩${totalVat.toLocaleString()}</strong>
          </div>
        </div>

        <!-- 미수금 상세 명세 내역 테이블 -->
        <div class="border border-slate-800 rounded-sm overflow-hidden">
          <table class="w-full text-left border-collapse">
            <thead class="bg-slate-200 text-slate-900 font-bold text-[10px] sm:text-[11px] border-b border-slate-800">
              <tr>
                <th class="py-1 px-1.5 text-center w-8">#</th>
                <th class="py-1 px-1.5 text-center w-20">출하일자</th>
                <th class="py-1 px-2 text-left w-24">발주번호</th>
                <th class="py-1 px-2 text-left min-w-[150px]">품번 (Part Number)</th>
                <th class="py-1 px-1.5 text-left w-16">제조사</th>
                <th class="py-1 px-1.5 text-right w-16">수량</th>
                <th class="py-1 px-2 text-right w-20">공급단가</th>
                <th class="py-1 px-2 text-right w-24">공급가액</th>
                <th class="py-1 px-2 text-right w-24">합계(VAT포함)</th>
                <th class="py-1 px-1.5 text-center w-20">결제예정일</th>
                <th class="py-1 px-1.5 text-center w-18">연체상태</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-300">
              ${rowsHtml}
            </tbody>
            <tfoot class="bg-slate-100 font-black text-[11px] border-t-2 border-slate-800">
              <tr>
                <td colspan="5" class="py-1.5 px-3 text-center">합 계 (Total ${targetItems.length}건)</td>
                <td class="py-1.5 px-1.5 text-right font-mono">${totalQty.toLocaleString()}</td>
                <td class="py-1.5 px-2 text-right">-</td>
                <td class="py-1.5 px-2 text-right font-mono">₩${totalSupply.toLocaleString()}</td>
                <td class="py-1.5 px-2 text-right font-mono text-rose-700">₩${totalAmount.toLocaleString()}</td>
                <td colspan="2" class="py-1.5 px-2 text-center text-[10px] text-slate-600">부가세 포함 금액</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <!-- 🏦 입금 계좌 안내 및 주의사항 (중요 박스) -->
        <div class="border-2 border-blue-900 bg-blue-50/60 p-3 rounded-sm flex items-center justify-between text-xs">
          <div class="space-y-1">
            <div class="font-black text-blue-950 flex items-center gap-1.5 text-xs">
              <span>🏦</span> <span>입금 계좌 안내 (결제 대금 수령 계좌)</span>
            </div>
            <div class="flex items-center gap-3 text-sm font-mono mt-0.5">
              <span class="font-bold text-slate-800">은행명: <strong>KEB하나은행</strong></span>
              <span class="font-bold text-blue-900">계좌번호: <strong class="text-base text-blue-800 underline">374-890003-50704</strong></span>
              <span class="font-bold text-slate-800">예금주: <strong>(주)빅샤인코리아</strong></span>
            </div>
            <div class="text-[10px] text-slate-600 mt-1">
              ※ 송금 시 입금자명을 귀사명으로 입력하여 주시기 바랍니다. 내역 관련 문의는 02-588-6447로 연락 바랍니다.
            </div>
          </div>
          <div class="text-right text-xs pr-4">
            <div class="font-black text-slate-900 text-sm">(주)빅샤인코리아</div>
            <div class="text-[11px] text-slate-600">대표이사 이동일 (직인생략)</div>
          </div>
        </div>

      </div>

    </div>
  `;

  modal.classList.remove('hidden');
}

window.openTradeInvoice = openInvoiceModal;
window.openTradePacking = openPackingListModal;
window.openStatementOfAccount = openStatementOfAccountModal;

