let parsedRowsCache = [];

/**
 * 📥 현재 조회된 재고 리스트를 엑셀(.xlsx) 또는 UTF-8 CSV로 내보내기
 */
export function exportToExcel(items, filenamePrefix = "BSK_Inventory_Master") {
  if (!items || items.length === 0) {
    alert("내보낼 데이터가 없습니다. 로그인 상태나 검색 필터를 확인해주세요.");
    return;
  }

  const excelData = items.map(item => ({
    "라인(Maker)": item.maker || "-",
    "제품명(Part No)": item.partName || "-",
    "제조주기(D/C)": item.dateCode || "-",
    "담당 Sales": item.owner || "-",
    "고객사(Account)": item.customer || "-",
    "수량(EA)": item.stock || 0,
    "선적매입단가(USD)": item.unitUsd || 0,
    "선적환율(KRW)": item.shipFx || 1350,
    "실판매단가(USD)": item.soldPriceUsd || 0,
    "진행상태": item.orderStatus || "-",
    "인보이스 No": item.invoiceNo || "-",
    "운송장/BL No": item.trackingNo || "-",
    "결제조건": item.paymentTerms || "-",
    "통화": item.currency || "USD",
    "수금상태": item.paymentStatus || "-",
    "수금만기일": item.dueDate || "-",
    "선적일": item.entryDate || "-",
    "실물출하일": item.shippedDate || "-",
    "수금완료일": item.settledDate || "-",
    "수금환율": item.settledFx || "",
    "SPA 특가여부": item.isSpa ? "Y" : "N",
    "SPA 승인가(USD)": item.approvedDebitUsd || "",
    "비고": item.memo || ""
  }));

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  // 1. SheetJS(XLSX) 라이브러리가 로드되어 있으면 .xlsx 파일 생성
  if (typeof XLSX !== 'undefined') {
    try {
      const worksheet = XLSX.utils.json_to_sheet(excelData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Inventory");

      worksheet['!cols'] = [
        { wch: 14 }, { wch: 20 }, { wch: 10 }, { wch: 12 }, { wch: 18 },
        { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 },
        { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 8 },  { wch: 10 },
        { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
        { wch: 12 }, { wch: 14 }, { wch: 25 }
      ];

      XLSX.writeFile(workbook, `${filenamePrefix}_${dateStr}.xlsx`);
      return;
    } catch (err) {
      console.warn("SheetJS 생성 실패, CSV 폴백으로 자동 전환합니다:", err);
    }
  }

  // 2. SheetJS가 없거나 실패 시 브라우저 기본 CSV 파일로 즉시 다운로드 (한글 안 깨지는 UTF-8 BOM 적용)
  exportToCsvFallback(excelData, `${filenamePrefix}_${dateStr}.csv`);
}

function exportToCsvFallback(dataArray, filename) {
  if (!dataArray || dataArray.length === 0) return;
  const headers = Object.keys(dataArray[0]);
  const csvRows = [];
  
  csvRows.push(headers.map(h => `"${h.replace(/"/g, '""')}"`).join(','));
  
  dataArray.forEach(row => {
    const values = headers.map(h => {
      const val = row[h] === null || row[h] === undefined ? '' : String(row[h]);
      return `"${val.replace(/"/g, '""')}"`;
    });
    csvRows.push(values.join(','));
  });

  const csvContent = '﻿' + csvRows.join('
');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 📤 패킹리스트 파일(Excel/CSV) 선택 시 파싱 및 미리보기 모달
 */
export function handleExcelFileSelect(file, onParsedSuccess) {
  if (!file) return;

  if (typeof XLSX === 'undefined') {
    alert("엑셀 엔진을 로드하지 못했습니다. 페이지를 강력 새로고침(Ctrl + Shift + R) 해주세요.");
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      if (rawRows.length < 2) {
        alert("업로드한 파일에 데이터가 없습니다.");
        return;
      }

      const headers = rawRows[0].map(h => String(h || '').trim().toUpperCase());
      const findColIdx = (aliases) => headers.findIndex(h => aliases.some(a => h.includes(a.toUpperCase())));

      const makerIdx = findColIdx(['MAKER', '라인', '제조사', 'BRAND']);
      const partIdx = findColIdx(['PART', '제품명', 'P/N', 'ITEM', 'DESCRIPTION']);
      const dcIdx = findColIdx(['D/C', 'DC', 'DATE CODE', 'DATECODE', '주기']);
      const qtyIdx = findColIdx(['QTY', '수량', 'QUANTITY', 'PCS']);
      const priceIdx = findColIdx(['PRICE', '단가', 'UNIT PRICE', '매입단가', 'USD']);
      const shipDateIdx = findColIdx(['SHIP DATE', '선적일', 'DATE', 'SHIPPING']);
      const ownerIdx = findColIdx(['OWNER', '담당', 'SALES', 'REP']);

      if (partIdx === -1 || qtyIdx === -1) {
        alert("필수 항목(제품명/Part No, 수량/Qty) 컬럼을 파일에서 찾을 수 없습니다.\n엑셀 첫 줄 헤더를 확인해주세요.");
        return;
      }

      parsedRowsCache = [];
      const todayStr = new Date().toISOString().slice(0, 10);

      for (let i = 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.length === 0 || !row[partIdx]) continue;

        const partName = String(row[partIdx]).trim();
        const stock = parseInt(row[qtyIdx]) || 0;
        if (!partName || stock <= 0) continue;

        const maker = (makerIdx !== -1 && row[makerIdx]) ? String(row[makerIdx]).trim() : "기타";
        const dateCode = (dcIdx !== -1 && row[dcIdx]) ? String(row[dcIdx]).trim() : "-";
        const unitUsd = (priceIdx !== -1 && row[priceIdx]) ? parseFloat(row[priceIdx]) || 0 : 0;
        const entryDate = (shipDateIdx !== -1 && row[shipDateIdx]) ? formatExcelDate(row[shipDateIdx]) : todayStr;
        const owner = (ownerIdx !== -1 && row[ownerIdx]) ? String(row[ownerIdx]).trim() : "본사 일반재고";

        parsedRowsCache.push({
          maker,
          part_name: partName,
          date_code: dateCode,
          stock,
          unit_usd: unitUsd,
          ship_fx: 1350,
          entry_date: entryDate,
          owner,
          customer: "-",
          order_status: "배정요청",
          payment_terms: "Net 30",
          payment_status: "미수",
          currency: "USD",
          margin: 20,
          memo: "[패킹리스트 일괄 업로드 건]"
        });
      }

      if (parsedRowsCache.length === 0) {
        alert("유효한 부품 데이터 행을 찾을 수 없습니다.");
        return;
      }

      showPreviewModal(parsedRowsCache);
      if (onParsedSuccess) onParsedSuccess(parsedRowsCache);

    } catch (err) {
      alert("엑셀 파일 파싱 오류: " + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function formatExcelDate(rawVal) {
  if (!rawVal) return new Date().toISOString().slice(0, 10);
  if (typeof rawVal === 'number') {
    const d = new Date((rawVal - (25567 + 2)) * 86400 * 1000);
    return isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
  }
  const s = String(rawVal).replace(/[\/\.]/g, '-').trim();
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

function showPreviewModal(rows) {
  const modal = document.getElementById('excelPreviewModal');
  const countEl = document.getElementById('excelPreviewCount');
  const tbody = document.getElementById('excelPreviewTbody');

  if (countEl) countEl.innerText = `총 ${rows.length.toLocaleString()}건의 부품 데이터가 파싱되었습니다.`;
  if (tbody) {
    tbody.innerHTML = rows.map((r) => `
      <tr class="hover:bg-indigo-50/50">
        <td class="py-1.5 px-2 font-bold text-slate-800">${r.maker}</td>
        <td class="py-1.5 px-2 font-bold text-indigo-700">${r.part_name}</td>
        <td class="py-1.5 px-2 font-mono text-slate-600 font-bold">${r.date_code}</td>
        <td class="py-1.5 px-2 font-semibold text-slate-900">${r.stock.toLocaleString()} EA</td>
        <td class="py-1.5 px-2 text-slate-600">$${r.unit_usd.toFixed(3)}</td>
        <td class="py-1.5 px-2 text-slate-500">${r.entry_date}</td>
        <td class="py-1.5 px-2 font-semibold text-slate-700">${r.owner}</td>
      </tr>
    `).join('');
  }

  modal?.classList.remove('hidden');
}

export async function executeBatchUpload() {
  const { sbClient } = await import('../supabase.js');
  if (!sbClient) throw new Error("클라이언트 미연결");
  if (!parsedRowsCache || parsedRowsCache.length === 0) {
    throw new Error("업로드할 데이터가 없습니다.");
  }

  const { error } = await sbClient
    .from('inventory_items')
    .insert(parsedRowsCache);

  if (error) throw error;

  const count = parsedRowsCache.length;
  parsedRowsCache = [];
  return count;
}
