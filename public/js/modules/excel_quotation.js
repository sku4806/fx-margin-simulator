/**
 * 📄 빅샤인 코리아 원본 "견적서 양식.xls" 스타일/로고/폰트 1:1 보존 엑셀 생성 모듈
 */

export async function downloadOfficialQuotationExcel(data) {
  if (!window.ExcelJS) {
    alert("엑셀 엔진(ExcelJS)을 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }

  try {
    // 1. 원본 엑셀 템플릿 로드
    const response = await fetch('/templates/quotation_template.xls');
    if (!response.ok) {
      throw new Error("원본 견적서 서식(/templates/quotation_template.xls)을 찾을 수 없습니다.");
    }
    const arrayBuffer = await response.arrayBuffer();

    // 2. ExcelJS를 통해 서식/이미지/폰트 그대로 파싱
    const workbook = new window.ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer);

    // 3. 통화에 맞는 시트 선택
    const targetSheetName = data.currency === 'KRW' ? '원화' : '달러';
    const worksheet = workbook.getWorksheet(targetSheetName) || workbook.worksheets[0];

    // 날짜 및 REF 번호 계산
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const yy = String(yyyy).slice(2);
    const refNo = `QBK${yy}${mm}-${Math.floor(1000 + Math.random() * 9000)}`;

    const qty = Number(data.qty) || 0;
    const isKrw = data.currency === 'KRW';

    let unitPrice = 0;
    let subtotal = 0;
    let vat = 0;
    let total = 0;

    if (isKrw) {
      unitPrice = Math.round(data.unitPriceKrw || (data.unitPriceUsd * (data.appliedFx || 1380)));
      subtotal = unitPrice * qty;
      vat = Math.round(subtotal * 0.1);
      total = subtotal + vat;
    } else {
      unitPrice = Number(data.unitPriceUsd) || 0;
      subtotal = Number((unitPrice * qty).toFixed(2));
      vat = Number((subtotal * 0.1).toFixed(2));
      total = Number((subtotal + vat).toFixed(2));
    }

    // 4. 셀 스타일을 깨뜨리지 않고 순수 값(Value)만 안전 주입하는 함수
    const updateCell = (cellRef, val) => {
      const cell = worksheet.getCell(cellRef);
      if (cell) {
        cell.value = val;
      }
    };

    // --- 수신처 & 담당자 정보 ---
    updateCell('C13', data.customer || '');
    updateCell('C15', data.attn || '');

    // --- 문서 관리 정보 ---
    updateCell('J13', dateStr);
    updateCell('J17', refNo);
    // 세일즈 이름이 없거나 '본사 일반재고' 등 미배정 상태면 공란 처리
    const salesRepName = (data.salesRep && data.salesRep !== '본사 일반재고' && data.salesRep !== '__CUSTOM_OWNER__')
      ? data.salesRep
      : '';
    updateCell('J19', salesRepName);

    // --- 품목 정보 (No 1 행: C27 ~ M27) ---
    updateCell('A27', 1);
    
    // 품명에 D/C 및 SPQ 정보 포함
    let fullPartDesc = data.partName || '';
    if (data.dateCode && data.dateCode !== '-') fullPartDesc += ` (D/C: ${data.dateCode})`;
    if (data.spq) fullPartDesc += ` [SPQ: ${Number(data.spq).toLocaleString()}]`;
    updateCell('C27', fullPartDesc);

    updateCell('F27', data.maker || '');
    updateCell('G27', qty > 0 ? qty : '');
    updateCell('H27', qty > 0 ? (data.unitLabel || 'pcs') : '');
    updateCell('J27', unitPrice > 0 ? unitPrice : '');
    updateCell('L27', subtotal > 0 ? subtotal : '');
    updateCell('M27', data.delivery || '즉시 출고');

    // --- 금액 합계 영역 (행 36 ~ 40) ---
    updateCell('L36', subtotal > 0 ? subtotal : '');
    updateCell('L38', vat > 0 ? vat : '');
    updateCell('L40', total > 0 ? total : '');

    // --- 거래 조건 ---
    if (data.paymentTerms) {
      updateCell('D43', data.paymentTerms);
    }

    // 5. 원본 서식/로고/폰트가 보존된 바이너리 버퍼 생성 및 다운로드
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const downloadUrl = URL.createObjectURL(blob);

    const safeCustomer = (data.customer || '고객사').replace(/[/\\?%*:|"<>]/g, '_').trim();
    const safePart = (data.partName || '부품').replace(/[/\\?%*:|"<>]/g, '_').trim();
    const fileName = `BSK_견적서_${safeCustomer}_${safePart}_${dateStr}.xlsx`;

    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);

    alert(`[공식 견적서 엑셀 다운로드 완료]\n${fileName}\n\n로고 이미지와 원본 폰트/서식이 모두 보존된 엑셀 파일이 저장되었습니다.`);

  } catch (err) {
    console.error("[ExcelJS Export Error]", err);
    alert("견적서 엑셀 생성 중 오류가 발생했습니다: " + err.message);
  }
}
