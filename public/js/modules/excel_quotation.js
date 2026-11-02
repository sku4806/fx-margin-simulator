/**
 * 📄 ExcelJS 기반 빅샤인 코리아 공식 견적서 생성기
 * 로고 이미지, 폰트(맑은 고딕), 셀 테두리 선, 정렬을 100% 유지하며 순정 .xlsx로 생성
 */

export async function downloadOfficialQuotationExcel(data) {
  if (!window.ExcelJS) {
    alert("엑셀 생성 엔진(ExcelJS)을 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }

  try {
    const workbook = new window.ExcelJS.Workbook();
    workbook.creator = "BIGSHINE KOREA";
    workbook.created = new Date();

    const isKrw = data.currency === 'KRW';
    const sheetName = isKrw ? '원화' : '달러';
    const sheet = workbook.addWorksheet(sheetName, {
      pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1 }
    });

    // 1. 열 너비 설정 (원본 엑셀과 1:1 일치)
    sheet.columns = [
      { width: 5.5 },  // A (No)
      { width: 2.5 },  // B (:)
      { width: 14.0 }, // C (PART #)
      { width: 14.0 }, // D
      { width: 11.0 }, // E
      { width: 11.0 }, // F (MFG)
      { width: 10.0 }, // G (QTY)
      { width: 5.5 },  // H (pcs)
      { width: 3.5 },  // I (:)
      { width: 14.0 }, // J (U/P)
      { width: 3.5 },  // K (:)
      { width: 15.0 }, // L (AMOUNT)
      { width: 14.0 }  // M (DELIVERY)
    ];

    // 기본 폰트 스타일 헬퍼
    const fontMain = { name: '맑은 고딕', size: 10, color: { argb: 'FF000000' } };
    const fontBold = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FF000000' } };
    const borderThin = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } }
    };

    // 2. 회사 로고 이미지 삽입 (좌측 상단)
    try {
      const logoRes = await fetch('/BSK.jpg');
      if (logoRes.ok) {
        const logoBuffer = await logoRes.arrayBuffer();
        const logoId = workbook.addImage({
          buffer: logoBuffer,
          extension: 'jpeg'
        });
        sheet.addImage(logoId, {
          tl: { col: 0.2, row: 0.5 },
          ext: { width: 130, height: 55 }
        });
      }
    } catch (e) {
      console.warn("로고 로드 건너뜀:", e);
    }

    // 3. 우측 상단 공급자 영문 정보 (행 2~5)
    sheet.mergeCells('F2:M2');
    sheet.getCell('F2').value = "BIGSHINE KOREA CO., LTD";
    sheet.getCell('F2').font = { name: '맑은 고딕', size: 12, bold: true, color: { argb: 'FF0B2046' } };
    sheet.getCell('F2').alignment = { horizontal: 'right', vertical: 'middle' };

    sheet.mergeCells('F3:M3');
    sheet.getCell('F3').value = "B-601, Yongin TechnoValley, 357 Guseong-ro, Giheung-gu,";
    sheet.getCell('F3').font = { name: '맑은 고딕', size: 8.5, color: { argb: 'FF555555' } };
    sheet.getCell('F3').alignment = { horizontal: 'right' };

    sheet.mergeCells('F4:M4');
    sheet.getCell('F4').value = "Yongin-si, Gyeonggi-do 16914, Rep.of Korea";
    sheet.getCell('F4').font = { name: '맑은 고딕', size: 8.5, color: { argb: 'FF555555' } };
    sheet.getCell('F4').alignment = { horizontal: 'right' };

    sheet.mergeCells('F5:M5');
    sheet.getCell('F5').value = "Tel: 82-31-711-8881  Fax : 82-31-711-8174";
    sheet.getCell('F5').font = { name: '맑은 고딕', size: 8.5, color: { argb: 'FF555555' } };
    sheet.getCell('F5').alignment = { horizontal: 'right' };

    // 4. 중앙 QUOTATION 타이틀 (행 9)
    sheet.mergeCells('D9:K9');
    const titleCell = sheet.getCell('D9');
    titleCell.value = "Q U O T A T I O N";
    titleCell.font = { name: 'Georgia', size: 18, bold: true, color: { argb: 'FF000000' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

    // 오늘 날짜 및 REF 번호 계산
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const yy = String(yyyy).slice(2);
    const refNo = `QBK${yy}${mm}-${Math.floor(1000 + Math.random() * 9000)}`;

    // 담당 Sales 이름 처리: 미배정이거나 '본사 일반재고'이면 빈칸으로 둠
    let salesRepName = "";
    if (data.salesRep && data.salesRep !== '본사 일반재고' && data.salesRep !== '미배정') {
      salesRepName = data.salesRep;
    }

    // 5. 상단 수신처 & 견적 메타 정보 박스 (행 13~19)
    const metaRows = [
      { r: 13, leftLabel: 'TO', leftVal: data.customer || '', rightLabel: 'DATE', rightVal: dateStr },
      { r: 15, leftLabel: 'ATTN', leftVal: data.attn || '', rightLabel: 'PAGE', rightVal: '1 OF 1' },
      { r: 17, leftLabel: 'TEL', leftVal: data.customerTel || '', rightLabel: 'REF', rightVal: refNo },
      { r: 19, leftLabel: 'FAX', leftVal: data.customerFax || '', rightLabel: 'FROM', rightVal: salesRepName }
    ];

    metaRows.forEach(({ r, leftLabel, leftVal, rightLabel, rightVal }) => {
      // 좌측
      sheet.getCell(`A${r}`).value = leftLabel;
      sheet.getCell(`A${r}`).font = fontBold;
      sheet.getCell(`B${r}`).value = ":";
      sheet.getCell(`B${r}`).font = fontBold;
      sheet.mergeCells(`C${r}:E${r}`);
      sheet.getCell(`C${r}`).value = leftVal;
      sheet.getCell(`C${r}`).font = fontBold;

      // 우측
      sheet.getCell(`H${r}`).value = rightLabel;
      sheet.getCell(`H${r}`).font = fontBold;
      sheet.getCell(`I${r}`).value = ":";
      sheet.getCell(`I${r}`).font = fontBold;
      sheet.mergeCells(`J${r}:L${r}`);
      sheet.getCell(`J${r}`).value = rightVal;
      sheet.getCell(`J${r}`).font = (rightLabel === 'REF') ? { ...fontBold, color: { argb: 'FF1E3A8A' } } : fontBold;
    });

    // 6. 품목 테이블 헤더 (행 24)
    const headerCols = [
      { col: 'A', title: 'No' },
      { col: 'C', title: 'PART #' },
      { col: 'F', title: 'MFG' },
      { col: 'G', title: 'QTY' },
      { col: 'J', title: 'U/P' },
      { col: 'L', title: 'AMOUNT' },
      { col: 'M', title: 'DELIVERY' }
    ];

    sheet.mergeCells('A24:B24');
    sheet.mergeCells('C24:E24');
    sheet.mergeCells('G24:I24');
    sheet.mergeCells('J24:K24');

    sheet.getCell('A24').value = "No";
    sheet.getCell('C24').value = "PART #";
    sheet.getCell('F24').value = "MFG";
    sheet.getCell('G24').value = "QTY";
    sheet.getCell('J24').value = "U/P";
    sheet.getCell('L24').value = "AMOUNT";
    sheet.getCell('M24').value = "DELIVERY";

    ['A24', 'C24', 'F24', 'G24', 'J24', 'L24', 'M24'].forEach(c => {
      sheet.getCell(c).font = fontBold;
      sheet.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      sheet.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // 헤더 테두리 선
    for (let c = 1; c <= 13; c++) {
      const cell = sheet.getRow(24).getCell(c);
      cell.border = borderThin;
    }

    // 7. 금액 및 단가 계산
    const qty = Number(data.qty) || 0;
    const unitPrice = isKrw 
      ? Math.round(data.unitPriceKrw || (data.unitPriceUsd * (data.appliedFx || 1380)))
      : Number(data.unitPriceUsd) || 0;

    const subtotal = isKrw ? (unitPrice * qty) : Number((unitPrice * qty).toFixed(2));
    const vat = isKrw ? Math.round(subtotal * 0.1) : Number((subtotal * 0.1).toFixed(2));
    const total = isKrw ? (subtotal + vat) : Number((subtotal + vat).toFixed(2));

    // 8. 품목 1번 행 데이터 기입 (행 27)
    sheet.mergeCells('A27:B27');
    sheet.mergeCells('C27:E27');
    sheet.mergeCells('J27:K27');

    sheet.getCell('A27').value = 1;
    sheet.getCell('A27').alignment = { horizontal: 'center' };
    sheet.getCell('A27').font = fontBold;

    sheet.getCell('C27').value = data.partName || '';
    sheet.getCell('C27').alignment = { horizontal: 'left' };
    sheet.getCell('C27').font = fontBold;

    sheet.getCell('F27').value = data.maker || '';
    sheet.getCell('F27').alignment = { horizontal: 'center' };
    sheet.getCell('F27').font = fontMain;

    sheet.getCell('G27').value = qty;
    sheet.getCell('G27').numFmt = '#,##0';
    sheet.getCell('G27').alignment = { horizontal: 'right' };
    sheet.getCell('G27').font = fontBold;

    sheet.getCell('H27').value = data.unitLabel || 'pcs';
    sheet.getCell('H27').alignment = { horizontal: 'left' };
    sheet.getCell('H27').font = fontMain;

    sheet.getCell('J27').value = unitPrice;
    sheet.getCell('J27').numFmt = isKrw ? '₩#,##0' : '$#,##0.000';
    sheet.getCell('J27').alignment = { horizontal: 'right' };
    sheet.getCell('J27').font = fontBold;

    sheet.getCell('L27').value = subtotal;
    sheet.getCell('L27').numFmt = isKrw ? '₩#,##0' : '$#,##0.00';
    sheet.getCell('L27').alignment = { horizontal: 'right' };
    sheet.getCell('L27').font = fontBold;

    sheet.getCell('M27').value = data.delivery || '즉시 출고 (2~3WKS)';
    sheet.getCell('M27').alignment = { horizontal: 'center' };
    sheet.getCell('M27').font = fontMain;

    // 품목 행 테두리
    for (let c = 1; c <= 13; c++) {
      sheet.getRow(27).getCell(c).border = borderThin;
    }

    // 9. 우측 정산 합계 영역 (행 36, 38, 40)
    sheet.getCell('J36').value = "AMOUNT";
    sheet.getCell('J36').font = fontBold;
    sheet.getCell('K36').value = ":";
    sheet.mergeCells('L36:M36');
    sheet.getCell('L36').value = subtotal;
    sheet.getCell('L36').numFmt = isKrw ? '₩#,##0' : '$#,##0.00';
    sheet.getCell('L36').font = fontBold;
    sheet.getCell('L36').alignment = { horizontal: 'right' };

    sheet.getCell('J38').value = "VAT(10%)";
    sheet.getCell('J38').font = fontBold;
    sheet.getCell('K38').value = ":";
    sheet.mergeCells('L38:M38');
    sheet.getCell('L38').value = vat;
    sheet.getCell('L38').numFmt = isKrw ? '₩#,##0' : '$#,##0.00';
    sheet.getCell('L38').font = fontBold;
    sheet.getCell('L38').alignment = { horizontal: 'right' };

    sheet.getCell('J40').value = "* TOTAL AMOUNT";
    sheet.getCell('J40').font = fontBold;
    sheet.getCell('K40').value = ":";
    sheet.mergeCells('L40:M40');
    sheet.getCell('L40').value = total;
    sheet.getCell('L40').numFmt = isKrw ? '₩#,##0' : '$#,##0.00';
    sheet.getCell('L40').font = { ...fontBold, size: 11 };
    sheet.getCell('L40').alignment = { horizontal: 'right' };

    // 합계 박스 테두리
    [36, 38, 40].forEach(r => {
      for (let c = 10; c <= 13; c++) {
        sheet.getRow(r).getCell(c).border = borderThin;
      }
    });

    // 10. 하단 거래 조건 (행 43~53)
    const terms = [
      { r: 43, k: '* PAYMENT TERMS', v: data.paymentTerms || (isKrw ? '익월말 현금결제 (VAT 포함)' : '선입금 (VAT 포함)') },
      { r: 45, k: '* INCO TERMS', v: data.incoTerms || 'DOMESTIC' },
      { r: 47, k: '* ORIGIN', v: data.origin || 'TAIWAN' },
      { r: 49, k: '* SHIPPING PORT', v: data.shippingPort || 'TAIWAN' },
      { r: 51, k: '* VALIDITY', v: data.validity || '7 DAYS' },
      { r: 53, k: '* REMARKS', v: 'We are pleased to offer you the parts on the terms and conditions described as above.' }
    ];

    terms.forEach(({ r, k, v }) => {
      sheet.mergeCells(`A${r}:C${r}`);
      sheet.getCell(`A${r}`).value = k;
      sheet.getCell(`A${r}`).font = fontBold;
      sheet.mergeCells(`D${r}:M${r}`);
      sheet.getCell(`D${r}`).value = v;
      sheet.getCell(`D${r}`).font = fontMain;
    });

    // 11. 하단 계좌 정보 & 결재란 (행 57~63)
    sheet.mergeCells('A57:C57');
    sheet.getCell('A57').value = "* ACCOUNT INFO";
    sheet.getCell('A57').font = fontBold;

    sheet.mergeCells('D57:I57');
    sheet.getCell('D57').value = isKrw ? "KEB하나은행" : "KEB하나은행(구 외환은행)";
    sheet.getCell('D57').font = fontBold;

    sheet.getCell('D58').value = "예금주";
    sheet.getCell('D58').font = fontMain;
    sheet.mergeCells('E58:I58');
    sheet.getCell('E58').value = "㈜ 빅샤인코리아";
    sheet.getCell('E58').font = fontBold;

    sheet.getCell('D59').value = "계좌번호";
    sheet.getCell('D59').font = fontMain;
    sheet.mergeCells('E59:I59');
    sheet.getCell('E59').value = isKrw ? "374-890003-50704 (144-22-01385-8)" : "438-JSD-100648-4";
    sheet.getCell('E59').font = fontBold;

    sheet.mergeCells('A62:C62');
    sheet.getCell('A62').value = "* Authorized by";
    sheet.getCell('A62').font = fontBold;

    sheet.mergeCells('A63:C63');
    sheet.getCell('A63').value = "CC : D.I.Lee";
    sheet.getCell('A63').font = { ...fontMain, size: 9, color: { argb: 'FF666666' } };

    // 12. 브라우저 파일 다운로드 트리거
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BSK_견적서_${(data.customer || '고객사').replace(/\s+/g, '_')}_${data.partName || '부품'}_${dateStr}.xlsx`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

  } catch (err) {
    console.error("[ExcelJS Error]", err);
    alert("견적서 엑셀 다운로드 중 오류가 발생했습니다: " + err.message);
  }
}
