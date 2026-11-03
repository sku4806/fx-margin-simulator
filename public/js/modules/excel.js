/**
 * 📥 레거시 마스터(SalesMaster.xls) 완벽 호환 엑셀 다운로드 및 일괄 업로드 모듈
 */

let parsedUploadRows = [];

export function exportToExcel(items) {
  if (!window.XLSX) {
    alert("엑셀 처리 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }

  const rows = items.map(item => {
    const fx = item.shipFx || 1350;
    const qty = item.stock || 0;
    const unitUsd = item.unitUsd || 0;
    const soldPriceUsd = item.soldPriceUsd || 0;

    const unitKrw = Math.round(unitUsd * fx);
    const soldPriceKrw = Math.round(soldPriceUsd * fx);
    const shipAmtKrw = soldPriceKrw * qty;
    const costAmtKrw = unitKrw * qty;
    const mgnAmtKrw = (soldPriceUsd > 0) ? (shipAmtKrw - costAmtKrw) : 0;

    const shipAmtUsd = Number((soldPriceUsd * qty).toFixed(2));
    const costAmtUsd = Number((unitUsd * qty).toFixed(2));
    const mgnAmtUsd = (soldPriceUsd > 0) ? Number((shipAmtUsd - costAmtUsd).toFixed(2)) : 0;

    return {
      'SHIPDT(선적/출하일)': item.shippedDate || item.entryDate || '-',
      'CNAME(계약고객사)': item.customer,
      'REALCUST(실고객사)': item.realCustomer !== '-' ? item.realCustomer : item.customer,
      'PONO(발주번호)': item.poNo || '-',
      'APP(적용처)': item.application || '-',
      'BIZ_TYPE(거래구분)': item.bizType || 'DOMESTIC',
      'PART#(품목번호)': item.partName,
      'MFG(제조사)': item.maker,
      'D/C': item.dateCode,
      'SPQ': item.spq || '-',
      'SHIPQTY(수량)': qty,
      'NETUP(원화매입원가)': unitKrw,
      'SLUP(원화실판매가)': soldPriceKrw,
      'SHIPAMT(원화매출액)': shipAmtKrw,
      'MGNAMT(원화마진액)': mgnAmtKrw,
      'US_NETUP(외화매입단가)': unitUsd,
      'US_SLUP(외화실판매가)': soldPriceUsd,
      'US_SHIPAMT(외화매출액)': shipAmtUsd,
      'US_MGNAMT(외화마진)': mgnAmtUsd,
      'TAXDT(계산서일)': item.taxDate || '-',
      'PayDueDT(만기일)': item.dueDate || '-',
      'PAYDT(수금완료일)': item.settledDate || '-',
      'TAX(계산서상태)': item.invoiceNo ? '발행' : '미발행',
      'PAY(수금상태)': item.paymentStatus || '미수',
      'INV_NO(인보이스)': item.invoiceNo || '-',
      'B/L(운송장)': item.trackingNo || '-',
      'SALES(담당자)': item.owner,
      'STATUS(진행상태)': item.orderStatus,
      'REMARK(비고)': item.memo || ''
    };
  });

  const worksheet = window.XLSX.utils.json_to_sheet(rows);
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, 'SalesMaster');

  const todayStr = new Date().toISOString().slice(0, 10);
  window.XLSX.writeFile(workbook, `BSK_SalesMaster_${todayStr}.xlsx`);
}

export function handleExcelFileSelect(file) {
  if (!window.XLSX) return;
  const reader = new FileReader();

  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = window.XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];
      const json = window.XLSX.utils.sheet_to_json(sheet, { defval: '' });

      parsedUploadRows = json.map(r => ({
        maker: r['MFG'] || r['제조사'] || r['MAKER'] || '기타',
        part_name: r['PART#'] || r['PARTNO'] || r['품목번호'] || r['품명'] || '',
        date_code: String(r['D/C'] || r['DC'] || r['제조주기'] || '-'),
        stock: parseInt(r['재고량'] || r['SHIPQTY'] || r['수량'] || 0),
        unit_usd: parseFloat(r['US_NETUP'] || r['원가'] || r['단가'] || 0),
        customer: r['CNAME'] || r['CUSTOMER'] || r['고객사'] || '본사 일반재고',
        real_customer: r['REALCUST'] || r['실고객사'] || '-',
        po_no: String(r['PONO'] || r['발주번호'] || ''),
        application: r['APP'] || r['적용처'] || '',
        biz_type: r['BIZ_TYPE'] || 'DOMESTIC',
        entry_date: r['입고일'] || r['SHIPDT'] || new Date().toISOString().slice(0, 10),
        owner: r['SALES'] || r['담당자'] || '본사 일반재고',
        order_status: '배정요청'
      })).filter(r => r.part_name);

      renderUploadPreview(parsedUploadRows);
    } catch (err) {
      alert("엑셀 파일 파싱 중 오류가 발생했습니다: " + err.message);
    }
  };

  reader.readAsArrayBuffer(file);
}

function renderUploadPreview(rows) {
  const modal = document.getElementById('excelPreviewModal');
  const tbody = document.getElementById('excelPreviewTbody');
  const countEl = document.getElementById('excelPreviewCount');

  if (!modal || !tbody) return;
  if (countEl) countEl.innerText = `총 ${rows.length.toLocaleString()}건의 부품 데이터 파싱됨`;

  tbody.innerHTML = rows.slice(0, 50).map(r => `
    <tr class="hover:bg-slate-50">
      <td class="py-2 px-2 font-bold">${r.maker}</td>
      <td class="py-2 px-2 font-bold text-indigo-950">${r.part_name}</td>
      <td class="py-2 px-2 font-mono">${r.date_code}</td>
      <td class="py-2 px-2 font-bold text-slate-900">${r.stock.toLocaleString()} EA</td>
      <td class="py-2 px-2">$${r.unit_usd.toFixed(3)}</td>
      <td class="py-2 px-2">${r.entry_date}</td>
      <td class="py-2 px-2 text-indigo-700 font-semibold">${r.customer}</td>
    </tr>
  `).join('');

  modal.classList.remove('hidden');
}

export async function executeBatchUpload() {
  if (parsedUploadRows.length === 0) return 0;
  const { sbClient } = await import('../supabase.js');
  if (!sbClient) throw new Error("클라이언트 미연결");

  const { error } = await sbClient
    .from('inventory_items')
    .insert(parsedUploadRows);

  if (error) throw error;
  const count = parsedUploadRows.length;
  parsedUploadRows = [];
  return count;
}
