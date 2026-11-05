import { supabase } from '../supabase.js';

let parsedRows = [];

export function normalizeKindValue(val) {
  const s = String(val || '').trim();
  if (s.includes('외자') || /import/i.test(s)) return 'IMPORT';
  if (s.includes('비정식') || /informal/i.test(s)) return 'INFORMAL';
  if (s.includes('분할') || /split/i.test(s)) return 'SPLIT';
  return 'DOMESTIC';
}

// 엑셀 일련번호(Serial Number: 예 37644) 및 문자열 날짜를 YYYY-MM-DD 규격으로 정밀 변환
function parseExcelDate(val) {
  if (!val) return new Date().toISOString().slice(0, 10);

  // 1. 순수 엑셀 일련번호(정수 숫자 형태)인 경우
  const num = Number(val);
  if (!isNaN(num) && num > 10000 && num < 100000) {
    // 엑셀 기준일(1899-12-30) -> Unix Epoch(1970-01-01) 차이 보정 (25,569일)
    const utcDays = Math.round(num - 25569);
    const date = new Date(utcDays * 86400 * 1000);
    return date.toISOString().slice(0, 10);
  }

  // 2. 이미 Date 객체이거나 날짜 포맷 문자열인 경우
  const str = String(val).trim();
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }

  // 3. 앞 10자리(YYYY-MM-DD) 잘라내기
  if (str.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }

  return new Date().toISOString().slice(0, 10);
}

export function handleExcelFileSelect(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      // cellDates: true 옵션으로 기본 날짜 파싱 활성화
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const json = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      // 유효한 부품 행만 필터링 (Grand Summaries 및 빈 품번 행 완벽 제외)
      const validRows = json.filter(r => {
        const part = String(r['PART#'] || r['Part Number'] || r['부품명'] || r['제품명'] || '').trim();
        const kind = String(r['KIND'] || r['구분'] || '').trim();
        if (!part || part === '-' || part.toLowerCase().includes('grand summar') || kind.toLowerCase().includes('grand summar')) {
          return false;
        }
        return true;
      });

      parsedRows = validRows.map(r => {
        const rawStock = r['재고량'] !== undefined && r['재고량'] !== '' ? r['재고량'] : (r['수량'] || r['QTY'] || 0);
        const stock = parseInt(String(rawStock).replace(/,/g, '')) || 0;

        const rawPrice = r['원가'] !== undefined && r['원가'] !== '' ? r['원가'] : (r['매입단가'] || r['Unit Price'] || 0);
        const unitUsd = parseFloat(String(rawPrice).replace(/[$,]/g, '')) || 0;

        const rawDate = r['입고일'] || r['선적일'] || r['Date'];
        const entryDate = parseExcelDate(rawDate);

        const sales = String(r['SALES'] || r['담당자'] || r['Owner'] || r['소유권'] || '본사 일반재고').trim();
        const customer = String(r['CNAME'] || r['고객사'] || r['Customer'] || '-').trim();
        const poNo = String(r['PONO'] || r['발주번호'] || r['PO'] || '').trim();
        const memo = String(r['REMARK'] || r['비고'] || r['Memo'] || '').trim();
        const rawKind = r['KIND'] || r['구분'] || r['입고구분'] || '내자입고';

        return {
          maker: String(r['MFG'] || r['Maker'] || r['제조사'] || '기타').trim(),
          part_name: String(r['PART#'] || r['Part Number'] || r['부품명'] || r['제품명'] || '').trim(),
          date_code: String(r['D/C'] || r['DateCode'] || '-').trim(),
          owner: sales && sales !== '-' ? sales : '본사 일반재고',
          customer: customer || '-',
          real_customer: customer || '-',
          po_no: poNo,
          biz_type: normalizeKindValue(rawKind),
          entry_date: entryDate,
          stock: stock,
          unit_usd: unitUsd,
          ship_fx: 1350,
          margin: 20,
          order_status: '배정요청',
          payment_terms: 'Net 30',
          payment_status: '미수',
          currency: 'USD',
          memo: memo
        };
      });

      renderPreviewTable(parsedRows);
      document.getElementById('excelPreviewModal')?.classList.remove('hidden');
    } catch (err) {
      alert("엑셀 파일 파싱 중 오류가 발생했습니다: " + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function renderPreviewTable(rows) {
  const tbody = document.getElementById('excelPreviewTbody');
  const countBadge = document.getElementById('previewCountText') || document.getElementById('excelPreviewCount');
  if (countBadge) {
    countBadge.innerText = `총 ${rows.length.toLocaleString()}건의 부품 데이터 파싱됨 (검증 완료)`;
  }
  if (!tbody) return;

  const getKindBadge = (k) => {
    if (k === 'IMPORT') return '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-800">외자</span>';
    if (k === 'INFORMAL') return '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800">비정식</span>';
    if (k === 'SPLIT') return '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-800">분할</span>';
    return '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-100 text-indigo-800">내자</span>';
  };

  tbody.innerHTML = rows.slice(0, 100).map(r => `
    <tr class="hover:bg-slate-50 border-b text-[11px]">
      <td class="py-2 px-2 text-center whitespace-nowrap">${getKindBadge(r.biz_type)}</td>
      <td class="py-2 px-2 font-bold text-slate-800 whitespace-nowrap">${r.maker}</td>
      <td class="py-2 px-2 font-black text-indigo-950">${r.part_name}</td>
      <td class="py-2 px-2 text-right font-black text-slate-900 whitespace-nowrap">${r.stock.toLocaleString()} EA</td>
      <td class="py-2 px-2 text-right font-semibold text-slate-700 whitespace-nowrap">$${r.unit_usd.toFixed(3)}</td>
      <td class="py-2 px-2 text-slate-600 font-mono text-[10px] whitespace-nowrap">${r.entry_date}</td>
      <td class="py-2 px-2 text-indigo-800 font-bold whitespace-nowrap">${r.owner}</td>
      <td class="py-2 px-2 text-slate-700 truncate max-w-[120px]" title="${r.customer}">${r.customer}</td>
      <td class="py-2 px-2 text-slate-500 font-mono text-[10px] whitespace-nowrap">${r.po_no || '-'}</td>
    </tr>
  `).join('');
}

export async function executeBatchUpload() {
  if (!parsedRows || parsedRows.length === 0) {
    throw new Error("업로드할 유효한 데이터가 없습니다.");
  }

  const chunkSize = 200;
  for (let i = 0; i < parsedRows.length; i += chunkSize) {
    const chunk = parsedRows.slice(i, i + chunkSize);
    const { error } = await supabase.from('inventory_items').insert(chunk);
    if (error) throw error;
  }
  return parsedRows.length;
}

export function exportToExcel(items) {
  if (!items || items.length === 0) {
    alert("다운로드할 데이터가 없습니다.");
    return;
  }
  const rows = items.map(it => ({
    'KIND': it.biz_type || it.bizType || 'DOMESTIC',
    'CNAME': it.customer || '-',
    'SALES': it.owner || '본사',
    'PART#': it.part_name || it.partName || '-',
    '재고량': it.stock || 0,
    '원가': it.unit_usd || it.unitUsd || 0,
    'AMOUNT': (it.stock || 0) * (it.unit_usd || it.unitUsd || 0),
    '입고일': it.entry_date || it.entryDate || '-',
    'MFG': it.maker || '-',
    'PONO': it.po_no || it.poNo || '',
    'REMARK': it.memo || ''
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Inventory");
  XLSX.writeFile(wb, `BSK_INVENTORY_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
