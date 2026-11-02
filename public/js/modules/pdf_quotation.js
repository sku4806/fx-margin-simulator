/**
 * 📄 pdf-lib 기반 빅샤인 코리아 원본 PDF 템플릿 오버레이 모듈
 */

export async function generateOfficialQuotationPdf(data) {
  if (!window.PDFLib) {
    alert("PDF 생성 모듈(pdf-lib)을 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }

  const { PDFDocument, rgb, StandardFonts } = window.PDFLib;

  try {
    // 1. 템플릿 PDF 로드
    const templateBytes = await fetch('/quotation_template.pdf').then(res => {
      if (!res.ok) throw new Error("원본 템플릿(quotation_template.pdf)을 찾을 수 없습니다.");
      return res.arrayBuffer();
    });

    const pdfDoc = await PDFDocument.load(templateBytes);
    if (window.fontkit) {
      pdfDoc.registerFontkit(window.fontkit);
    }

    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const { width, height } = firstPage.getSize();

    // 폰트 로드 (영문 및 숫자용)
    const fontHelvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontHelveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontCourier = await pdfDoc.embedFont(StandardFonts.CourierBold);

    // 날짜 및 REF 번호 계산
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const yy = String(yyyy).slice(2);
    const refNo = `QBK${yy}${mm}-${Math.floor(1000 + Math.random() * 9000)}`;

    // 통화 및 단가 계산
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
      unitPriceText = `\\${upKrw.toLocaleString()}`;
      subtotalText = `\\${subtotal.toLocaleString()}`;
      vatText = `\\${vat.toLocaleString()}`;
      totalText = `\\${total.toLocaleString()}`;
    } else {
      subtotal = unitPrice * qty;
      vat = subtotal * 0.1;
      total = subtotal + vat;
      unitPriceText = `$${unitPrice.toFixed(3)}`;
      subtotalText = `$${subtotal.toFixed(2)}`;
      vatText = `$${vat.toFixed(2)}`;
      totalText = `$${total.toFixed(2)}`;
    }

    // --- 🛠️ 2. 기존 가변 영역 흰색 마스킹 (지우기) ---
    const mask = (x, y, w, h) => {
      firstPage.drawRectangle({
        x, y, width: w, height: h,
        color: rgb(1, 1, 1),
      });
    };

    // TO / ATTN 영역 마스킹
    mask(68, height - 88, 180, 48);

    // DATE / REF / FROM 영역 마스킹
    mask(455, height - 165, 110, 45);

    // 1번 품목 행 데이터 영역 마스킹 (No 1 제외한 나머지 행 내용)
    mask(58, height - 250, 490, 20);

    // AMOUNT, VAT, TOTAL AMOUNT 영역 마스킹
    mask(450, height - 335, 110, 65);

    // --- ✍️ 3. 새 데이터 오버레이 렌더링 ---
    const drawText = (txt, x, y, size = 9, font = fontHelvetica, color = rgb(0, 0, 0)) => {
      firstPage.drawText(String(txt || ''), { x, y, size, font, color });
    };

    // 3-1. 수신처 정보
    drawText(data.customer || 'Customer', 72, height - 58, 10, fontHelveticaBold);
    drawText(data.attn || 'Purchasing / R&D Team', 72, height - 73, 9, fontHelvetica);

    // 3-2. 견적 메타 정보 (DATE, REF, FROM)
    drawText(dateStr, 460, height - 131, 8.5, fontHelveticaBold);
    drawText(refNo, 460, height - 146, 8.5, fontCourier, rgb(0.05, 0.15, 0.4));
    drawText(data.salesRep || 'Nathan Kim', 460, height - 161, 8.5, fontHelveticaBold);

    // 3-3. 품목 행 (No, Part#, MFG, QTY, U/P, AMOUNT, DELIVERY)
    drawText(data.partName || '-', 65, height - 242, 9, fontHelveticaBold);
    drawText(data.maker || '-', 215, height - 242, 8.5, fontHelvetica);
    drawText(`${qty.toLocaleString()} ${data.unitLabel || 'EA'}`, 280, height - 242, 8.5, fontHelvetica);
    drawText(unitPriceText, 350, height - 242, 9, fontCourier);
    drawText(subtotalText, 430, height - 242, 9, fontCourier);
    drawText(data.delivery || 'Stock / 2-3WKS', 505, height - 242, 8, fontHelvetica);

    // 3-4. 우측 정산 금액 영역
    drawText(subtotalText, 475, height - 283, 9, fontCourier);
    drawText(vatText, 475, height - 303, 9, fontCourier);
    drawText(totalText, 475, height - 325, 9.5, fontCourier, rgb(0.1, 0.1, 0.1));

    // 4. 완료된 PDF 바이트 추출 및 Blob URL 생성
    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const pdfUrl = URL.createObjectURL(blob);

    // 5. 모달 내 iframe 미리보기 및 다운로드 연동
    openQuotationPdfModal(pdfUrl, `${data.customer || 'BigShine'}_Quotation_${data.partName || ''}.pdf`);

  } catch (err) {
    console.error("[PDF-Lib Error]", err);
    alert("공식 견적서 생성 중 오류가 발생했습니다: " + err.message);
  }
}

/**
 * 생성된 순정 PDF 미리보기 및 다운로드 모달 열기
 */
function openQuotationPdfModal(pdfUrl, downloadFilename) {
  const modal = document.getElementById('quotationPdfModal');
  const preview = document.getElementById('quotationPrintArea');
  if (!modal || !preview) return;

  preview.innerHTML = `
    <div class="w-full h-[78vh] flex flex-col space-y-2">
      <div class="flex justify-between items-center bg-slate-800 text-white p-2.5 rounded-xl text-xs">
        <span class="font-bold flex items-center gap-1.5">
          <span>📄</span> 원본 규격 공식 견적서가 생성되었습니다.
        </span>
        <a href="${pdfUrl}" download="${downloadFilename}" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-sm transition-colors">
          <span>💾</span> PDF 파일 저장 (다운로드)
        </a>
      </div>
      <iframe src="${pdfUrl}#toolbar=1" class="w-full flex-1 border border-slate-300 rounded-xl bg-white shadow-inner"></iframe>
    </div>
  `;

  modal.classList.remove('hidden');
}

export function openQuotationPrintModal(data) {
  generateOfficialQuotationPdf(data);
}
