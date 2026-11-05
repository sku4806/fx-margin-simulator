import { supabase } from '../supabase.js';

let parsedRows = [];

export function normalizeKindValue(val) {
  const s = String(val || '').trim();
  if (s.includes('외자') || /import/i.test(s) || /overseas/i.test(s)) return 'IMPORT';
  if (s.includes('비정식') || /informal/i.test(s) || s.includes('반납') || s.includes('불용')) return 'INFORMAL';
  if (s.includes('분할') || /split/i.test(s)) return 'SPLIT';
  return 'DOMESTIC';
}

// 엑셀 일련번호(25,569일 보정) 및 문자열 날짜를 YYYY-MM-DD 규격으로 정밀 변환
function parseExcelDate(val) {
  if (!val) return new Date().toISOString().slice(0, 10);

  const num = Number(val);
  if (!isNaN(num) && num > 10000 && num < 100000) {
    const utcDays = Math.round(num - 25569);
    const date = new Date(utcDays * 86400 * 1000);
    return date.toISOString().slice(0, 10);
  }

  const str = String(val).trim();
  if (str.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }

  return new Date().toISOString().slice(0, 10);
}

// 원화(KRW) 감지 시 적용 환율(기본 1,350)로 자동 달러 환산
function resolveUnitPrice(usdVal, rawVal, isDomestic, shipFx = 1350) {
  if (usdVal !== undefined && usdVal !== null && usdVal !== '') {
    const parsedUsd = parseFloat(String(usdVal).replace(/[$,]/g, ''));
    if (!isNaN(parsedUsd) && parsedUsd > 0) return Number(parsedUsd.toFixed(8));
  }

  if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
    const parsedRaw = parseFloat(String(rawVal).replace(/[₩$,]/g, ''));
    if (!isNaN(parsedRaw) && parsedRaw > 0) {
      if (parsedRaw >= 100 || isDomestic) {
        return Number((parsedRaw / shipFx).toFixed(8));
      }
      return Number(parsedRaw.toFixed(8));
    }
  }

  return 0;
}

export function handleExcelFileSelect(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const json = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      // 유효한 부품 행 필터링 (Grand Summaries 및 빈 행 완전 배제)
      const validRows = json.filter(r => {
        const part = String(
          r['PART#'] || r['PARTNO'] || r['Part Number'] || r['부품명'] || r['제품명'] || ''
        ).trim();
        const kind = String(r['KIND'] || r['BIZ_TYPE'] || r['구분'] || '').trim();
        if (!part || part === '-' || /grand summar/i.test(part) || /grand summar/i.test(kind)) {
          return false;
        }
        return true;
      });

      parsedRows = validRows.map(r => {
        // 1. 수량 매핑 (3대 양식 호환)
        const rawStock = (r['재고량'] !== undefined && r['재고량'] !== '') ? r['재고량'] :
                         (r['수량'] || r['SHIPQTY'] || r['SHIP_QTY'] || r['QTY'] || 0);
        const stock = parseInt(String(rawStock).replace(/,/g, '')) || 0;

        // 2. 구분 (KIND / BIZ_TYPE)
        const rawKind = r['KIND'] || r['BIZ_TYPE'] || r['구분'] || '내자입고';
        const bizType = normalizeKindValue(rawKind);
        const isDomestic = (bizType === 'DOMESTIC');

        // 3. 매입단가(unit_usd) - 원화 감지 시 환율(1,350) 자동 환산
        const unitUsd = resolveUnitPrice(
          r['US_NETUP'],
          (r['원가'] !== undefined && r['원가'] !== '') ? r['원가'] : (r['NET_UP'] || r['NETUP'] || r['매입단가'] || r['Unit Price']),
          isDomestic,
          1350
        );

        // 4. 협의 실판매단가(sold_price_usd) 복원
        const soldPriceUsd = resolveUnitPrice(
          r['US_SLUP'],
          r['SLUP'] || r['실판매단가'] || r['실판매가'],
          isDomestic,
          1350
        );

        // 5. 날짜 매핑 (입고일 / 출하일)
        const rawDate = r['입고일'] || r['선적일'] || r['SHIPDT'] || r['SHIP_DATE'] || r['Date'];
        const entryDate = parseExcelDate(rawDate);

        // 6. 거래처 및 발주번호
        const customer = String(r['CNAME'] || r['CUSTOMER'] || r['고객사'] || r['Customer'] || '-').trim();
        const realCustomer = String(r['REALCUST'] || r['실납품처'] || customer || '-').trim();
        const poNo = String(r['PONO'] || r['발주번호'] || r['PO'] || '').trim();
        const sales = String(r['SALES'] || r['담당자'] || r['Owner'] || r['소유권'] || '본사 일반재고').trim();
        const memo = String(r['REMARK'] || r['비고'] || r['Memo'] || (r['SUPPLY'] ? `공급처: ${r['SUPPLY']}` : '')).trim();
        const app = String(r['APP'] || r['적용처'] || r['프로젝트'] || '').trim();

        const isShipped = Boolean(r['SHIPDT'] || r['SHIP_DATE']);

        return {
          maker: String(r['MFG'] || r['Maker'] || r['제조사'] || '기타').trim(),
          part_name: String(r['PART#'] || r['PARTNO'] || r['Part Number'] || r['부품명'] || r['제품명'] || '').trim(),
          date_code: String(r['D/C'] || r['DateCode'] || '-').trim(),
          owner: (sales && sales !== '-') ? sales : '본사 일반재고',
          customer: customer || '-',
          real_customer: realCustomer || '-',
          po_no: poNo,
          application: app,
          biz_type: bizType,
          entry_date: entryDate,
          shipped_date: isShipped ? entryDate : null,
          tax_date: r['TAXDT'] ? parseExcelDate(r['TAXDT']) : null,
          due_date: r['PayDueDT'] ? parseExcelDate(r['PayDueDT']) : null,
          settled_date: r['PAYDT'] ? parseExcelDate(r['PAYDT']) : null,
          stock: stock,
          unit_usd: unitUsd,
          sold_price_usd: soldPriceUsd,
          ship_fx: 1350,
          margin: 20,
          order_status: isShipped ? '출하완료' : '배정요청',
          payment_terms: 'Net 30',
          payment_status: (r['PAYDT'] || r['PAY'] === '완료' || r['PAY'] === '수금') ? '완료' : '미수',
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
      <td class="py-2 px-2 text-right font-semibold text-slate-700 whitespace-nowrap" title="실제 매입단가">$${Number(r.unit_usd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
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
