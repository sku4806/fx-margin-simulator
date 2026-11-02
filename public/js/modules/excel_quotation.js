/**
 * 📄 빅샤인 코리아 원본 "견적서 양식.xls" 기반 데이터 자동 주입 엑셀 다운로드 모듈
 */

export async function downloadOfficialQuotationExcel(data) {
  if (!window.XLSX) {
    alert("엑셀 처리 라이브러리를 로드하는 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }

  try {
    // 1. 원본 엑셀 템플릿 로드
    const response = await fetch('/templates/quotation_template.xls');
    if (!response.ok) {
      throw new Error("원본 견적서 양식(/templates/quotation_template.xls)을 찾을 수 없습니다.");
    }
    const arrayBuffer = await response.arrayBuffer();
    
    // 2. 엑셀 워크북 파싱 (서식 및 수식 보존)
    const workbook = window.XLSX.read(arrayBuffer, { type: 'array', cellStyles: true, cellNF: true });

    // 3. 통화에 맞는 시트 선택
    const targetSheetName = data.currency === 'KRW' ? '원화' : '달러';
    const worksheet = workbook.Sheets[targetSheetName] || workbook.Sheets[workbook.SheetNames[0]];

    // 오늘 날짜 및 REF 번호 채번
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

    // 4. 안전 셀 값 주입 헬퍼 함수
    const setCellValue = (cellAddress, val, valType = 's') => {
      if (!worksheet[cellAddress]) {
        worksheet[cellAddress] = { t: valType, v: val };
      } else {
        worksheet[cellAddress].v = val;
        worksheet[cellAddress].t = valType;
        if (worksheet[cellAddress].w) delete worksheet[cellAddress].w;
      }
    };

    // 5. 셀 좌표별 실시간 데이터 주입
    // 수신처 정보
    setCellValue('C13', data.customer || '고객사 귀중', 's');
    setCellValue('C15', data.attn || '구매/개발 담당자 님', 's');
    
    // 문서 메타 정보
    setCellValue('J13', dateStr, 's');
    setCellValue('J17', refNo, 's');
    setCellValue('J19', data.salesRep || '황 환', 's');

    // 품목 테이블 1번 행 (No 1)
    setCellValue('A27', 1, 'n');
    setCellValue('C27', data.partName || '-', 's');
    setCellValue('F27', data.maker || '-', 's');
    setCellValue('G27', qty, 'n');
    setCellValue('H27', data.unitLabel || 'pcs', 's');
    setCellValue('J27', unitPrice, 'n');
    setCellValue('L27', subtotal, 'n');
    setCellValue('M27', data.delivery || '즉시 출고 (2~3WKS)', 's');

    // 금액 합계 영역
    setCellValue('L36', subtotal, 'n');
    setCellValue('L38', vat, 'n');
    setCellValue('L40', total, 'n');

    // 거래 조건
    if (data.paymentTerms) {
      setCellValue('D43', data.paymentTerms, 's');
    }

    // 6. 주입 완료된 엑셀 파일 다운로드 실행
    const downloadFileName = `BSK_견적서_${(data.customer || '고객사').replace(/\s+/g, '_')}_${data.partName || '부품'}_${dateStr}.xlsx`;
    window.XLSX.writeFile(workbook, downloadFileName);

    alert(`[견적서 생성 완료]\n${downloadFileName} 파일이 성공적으로 다운로드되었습니다.\n엑셀을 열어 확인하거나 바로 인쇄/PDF 저장이 가능합니다.`);

  } catch (err) {
    console.error("[Excel Quotation Error]", err);
    alert("견적서 엑셀 다운로드 중 오류가 발생했습니다: " + err.message);
  }
}
