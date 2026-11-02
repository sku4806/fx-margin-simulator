/**
 * 📄 pdf-lib 기반 빅샤인 코리아 원본 PDF 템플릿 한글 지원 오버레이 모듈
 */

let cachedFontRegular = null;
let cachedFontBold = null;

async function loadKoreanFonts() {
  if (cachedFontRegular && cachedFontBold) {
    return { fontRegularBytes: cachedFontRegular, fontBoldBytes: cachedFontBold };
  }
  
  const [resReg, resBold] = await Promise.all([
    fetch('/fonts/NanumGothic.ttf'),
    fetch('/fonts/NanumGothicBold.ttf')
  ]);

  if (!resReg.ok || !resBold.ok) {
    throw new Error("한글 폰트 파일(/fonts/NanumGothic.ttf)을 불러올 수 없습니다.");
  }

  cachedFontRegular = await resReg.arrayBuffer();
  cachedFontBold = await resBold.arrayBuffer();

  return { fontRegularBytes: cachedFontRegular, fontBoldBytes: cachedFontBold };
}

export async function generateOfficialQuotationPdf(data) {
  if (!window.PDFLib) {
    alert("PDF 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }

  const { PDFDocument, rgb } = window.PDFLib;

  try {
    // 1. 템플릿 PDF 로드
    const templateBytes = await fetch('/quotation_template.pdf').then(res => {
      if (!res.ok) throw new Error("원본 템플릿(quotation_template.pdf)을 찾을 수 없습니다.");
      return res.arrayBuffer();
    });

    const pdfDoc = await PDFDocument.load(templateBytes);
    
    // fontkit 등록
    if (window.fontkit) {
      pdfDoc.registerFontkit(window.fontkit);
    } else {
      throw new Error("fontkit 모듈이 로드되지 않았습니다.");
    }

    // 2. 한글 TTF 폰트 임베딩
    const { fontRegularBytes, fontBoldBytes } = await loadKoreanFonts();
    const fontKrRegular = await pdfDoc.embedFont(fontRegularBytes);
    const fontKrBold = await pdfDoc.embedFont(fontBoldBytes);

    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const { width, height } = firstPage.getSize();

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

    // --- 🛠️ 3. 기존 원본 가변 영역 흰색 마스킹 (지우기) ---
    const mask = (x, y, w, h) => {
      firstPage.drawRectangle({
        x, y, width: w, height: h,
        color: rgb(1, 1, 1),
      });
    };

    // TO / ATTN 영역
    mask(68, height - 88, 180, 48);

    // DATE / REF / FROM 영역
    mask(455, height - 165, 110, 45);

    // 1번 품목 행 데이터 영역 (No 1 제외한 나머지)
    mask(58, height - 250, 490, 20);

    // AMOUNT, VAT, TOTAL AMOUNT 영역
    mask(450, height - 335, 110, 65);

    // --- ✍️ 4. 한글 폰트로 새 데이터 오버레이 렌더링 ---
    const drawText = (txt, x, y, size = 9, font = fontKrRegular, color = rgb(0, 0, 0)) => {
      firstPage.drawText(String(txt || ''), { x, y, size, font, color });
    };

    // 4-1. 수신처 정보
    drawText(data.customer || '고객사', 72, height - 58, 10, fontKrBold);
    drawText(`${data.attn || '구매/개발 담당자'} 님`, 72, height - 73, 9, fontKrRegular);

    // 4-2. 견적 메타 정보 (DATE, REF, FROM)
    drawText(dateStr, 460, height - 131, 8.5, fontKrBold);
    drawText(refNo, 460, height - 146, 8.5, fontKrBold, rgb(0.05, 0.15, 0.4));
    drawText(data.salesRep || 'Nathan Kim', 460, height - 161, 8.5, fontKrBold);

    // 4-3. 품목 행 (PART#, MFG, QTY, U/P, AMOUNT, DELIVERY)
    drawText(data.partName || '-', 65, height - 242, 8.5, fontKrBold);
    drawText(data.maker || '-', 215, height - 242, 8.5, fontKrRegular);
    drawText(`${qty.toLocaleString()} ${data.unitLabel || 'EA'}`, 280, height - 242, 8.5, fontKrRegular);
    drawText(unitPriceText, 350, height - 242, 8.5, fontKrBold);
    drawText(subtotalText, 430, height - 242, 8.5, fontKrBold);
    drawText(data.delivery || '2-3WKS', 505, height - 242, 8, fontKrRegular);

    // 4-4. 우측 정산 금액 영역
    drawText(subtotalText, 470, height - 283, 8.5, fontKrBold);
    drawText(vatText, 470, height - 303, 8.5, fontKrBold);
    drawText(totalText, 470, height - 325, 9, fontKrBold, rgb(0.1, 0.1, 0.1));

    // 5. PDF 바이트 생성
    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const pdfUrl = URL.createObjectURL(blob);

    // 6. 모달 내 미리보기 및 다운로드 연동
    openQuotationPdfModal(pdfUrl, `${data.customer || 'BigShine'}_견적서_${data.partName || ''}.pdf`);

  } catch (err) {
    console.error("[PDF-Lib Error]", err);
    alert("공식 견적서 생성 중 오류가 발생했습니다: " + err.message);
  }
}

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
