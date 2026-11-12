/**
 * analytics.js
 * 세일즈 마스터 MS-SQL 연동 매출 장부 & 다차원 실적 분석 (Book & Bill) 모듈
 * (FrmSalesBKBL & FrmSalesGraph 기능 완벽 이식)
 */

let cachedAnalytics = null;
let currentYear = "2026";

export async function fetchSalesAnalytics(year = "2026") {
  currentYear = year;
  try {
    const res = await fetch(`/api/analytics/sales?year=${encodeURIComponent(year)}`);
    const data = await res.json();
    if (data.status === "success" && data.analytics) {
      cachedAnalytics = data.analytics;
      return cachedAnalytics;
    }
  } catch (err) {
    console.error("실적 분석 데이터 로드 실패:", err);
  }
  return null;
}

export function renderAnalyticsView(containerId = "analyticsSection") {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!cachedAnalytics) {
    container.innerHTML = `
      <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center space-y-3">
        <div class="text-3xl animate-bounce">⏳</div>
        <div class="text-slate-600 font-bold text-sm">세일즈 마스터 매출 장부 및 실적 데이터를 불러오는 중입니다...</div>
      </div>
    `;
    fetchSalesAnalytics(currentYear).then(data => {
      if (data) renderAnalyticsView(containerId);
    });
    return;
  }

  const a = cachedAnalytics;
  const billingYtd = a.total_billing_ytd || 0;
  const bookingYtd = a.total_booking_ytd || 0;
  const marginYtd = a.total_margin_ytd || 0;
  const marginRate = a.overall_margin_rate || 0;

  // 당월 매출 계산
  const monthly = a.monthly || [];
  const currentMonthItem = monthly.length > 0 ? monthly[monthly.length - 1] : { billing: 0, booking: 0 };
  const currentMonthBill = currentMonthItem.billing || 0;

  // 1. 월별 매출 차트 스케일 계산 (매출액 전용 + Y축 눈금선)
  const maxBill = Math.max(...monthly.map(m => m.billing || 0), 100000000);
  
  // 가독성 좋은 Y축 눈금(억 단위) 스케일 계산
  let step = 500000000; // 기본 5억 단위
  if (maxBill > 2500000000) step = 1000000000; // 10억
  else if (maxBill < 800000000) step = 200000000; // 2억
  else if (maxBill < 400000000) step = 100000000; // 1억
  const yCeiling = Math.max(step * 2, Math.ceil((maxBill * 1.15) / step) * step); // 상단 수치 라벨 여유 확보(1.15배)

  // SVG 차트 좌표 설정
  const chartHeight = 230;
  const chartWidth = 840;
  const plotLeft = 65;
  const plotRight = chartWidth - 25;
  const plotWidth = plotRight - plotLeft;
  const plotTop = 38;
  const plotBottom = chartHeight - 32;
  const plotHeight = plotBottom - plotTop;

  // Y축 그리드 라인 & 눈금 라벨 생성
  const yTicks = [];
  for (let val = 0; val <= yCeiling; val += step) {
    const yPos = plotBottom - Math.round((val / yCeiling) * plotHeight);
    const label = val === 0 ? '0' : `${(val / 100000000).toFixed(0)}억`;
    yTicks.push({ val, yPos, label });
  }

  const yGridSvg = yTicks.map(t => `
    <g class="y-tick">
      <line x1="${plotLeft}" y1="${t.yPos}" x2="${plotRight}" y2="${t.yPos}" stroke="${t.val === 0 ? '#94a3b8' : '#f1f5f9'}" stroke-width="${t.val === 0 ? '1.5' : '1'}" stroke-dasharray="${t.val === 0 ? '' : '3 3'}" />
      <text x="${plotLeft - 10}" y="${t.yPos + 4}" text-anchor="end" font-size="10" font-weight="bold" fill="#64748b" class="font-mono">${t.label}</text>
    </g>
  `).join('');

  // X축 및 매출 단일 막대 생성 (상단 금액 & 마진율 수치 직접 표기)
  const slotCount = monthly.length;
  const slotWidth = slotCount > 0 ? plotWidth / slotCount : 60;
  const barWidth = Math.min(38, Math.max(16, Math.floor(slotWidth * 0.58)));

  const chartSvgBars = monthly.map((m, idx) => {
    const bill = m.billing || 0;
    const mgn = m.margin || 0;
    const mgnRate = m.margin_rate || 0;
    const billCount = m.bill_count || 0;

    const slotCenter = plotLeft + idx * slotWidth + slotWidth / 2;
    const barX = Math.round(slotCenter - barWidth / 2);
    const barHeight = bill > 0 ? Math.max(4, Math.round((bill / yCeiling) * plotHeight)) : 2;
    const barY = plotBottom - barHeight;

    // 월 라벨 (연도가 다른 경우 25.11 형태, 당해 연도는 01월)
    const isOtherYear = !m.month.startsWith(currentYear);
    const monthLabel = isOtherYear ? `${m.month.slice(2, 4)}.${m.month.slice(5)}` : `${m.month.slice(5)}월`;

    // 억/천만 단위 가독성 텍스트
    let eokText = '-';
    if (bill >= 100000000) {
      eokText = `${(bill / 100000000).toFixed(1)}억`;
    } else if (bill >= 10000000) {
      eokText = `${Math.round(bill / 10000).toLocaleString()}만`;
    } else if (bill > 0) {
      eokText = `${Math.round(bill / 10000).toLocaleString()}만`;
    }

    return `
      <g class="chart-group cursor-pointer group" data-idx="${idx}">
        <!-- 호버 시 배경 슬롯 하이라이트 -->
        <rect x="${Math.round(slotCenter - slotWidth / 2 + 2)}" y="${plotTop - 15}" width="${Math.round(slotWidth - 4)}" height="${plotHeight + 25}" fill="#f8fafc" rx="8" class="opacity-0 group-hover:opacity-100 transition-opacity" pointer-events="none"></rect>

        <!-- 막대 상단 1: 매출액 수치 직접 표기 (굵은 남색) -->
        <text x="${slotCenter}" y="${barY - 14}" text-anchor="middle" font-size="10.5" font-weight="900" fill="#1e1b4b" class="font-mono tracking-tight select-none">
          ${bill > 0 ? eokText : ''}
        </text>

        <!-- 막대 상단 2: 실현 마진율 수치 직접 표기 (에메랄드) -->
        <text x="${slotCenter}" y="${barY - 3}" text-anchor="middle" font-size="9.5" font-weight="bold" fill="#059669" class="font-mono select-none">
          ${bill > 0 ? `${mgnRate}%` : ''}
        </text>

        <!-- 매출 단일 바 (그라디언트 + 모던 라운딩) -->
        <rect x="${barX}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="4" fill="url(#billingBarGradient)" class="filter drop-shadow-xs transition-all duration-150 group-hover:brightness-110">
          <title>${m.month} 실적
• 매출액: ₩${Math.round(bill).toLocaleString()}
• 매출이익: ₩${Math.round(mgn).toLocaleString()}
• 실현마진율: ${mgnRate}%
• 출하건수: ${billCount}건</title>
        </rect>

        <!-- X축 월 라벨 -->
        <text x="${slotCenter}" y="${plotBottom + 18}" text-anchor="middle" font-size="11" font-weight="${idx >= slotCount - 2 ? '900' : 'bold'}" fill="${idx >= slotCount - 2 ? '#4338ca' : '#64748b'}" class="select-none">
          ${monthLabel}
        </text>
      </g>
    `;
  }).join('');

  // 하단 월별 정확한 수치 상세 테이블 HTML 생성
  const monthlySummaryTableHtml = `
    <div class="overflow-x-auto border-t border-slate-100 mt-2 pt-2.5">
      <table class="w-full text-xs text-center border-collapse">
        <thead>
          <tr class="text-[11px] font-bold text-slate-500 bg-slate-50 border-y border-slate-200">
            <th class="py-1.5 px-3 text-left sticky left-0 bg-slate-50 z-10 shadow-xs">지표</th>
            ${monthly.map(m => {
              const isOtherYear = !m.month.startsWith(currentYear);
              const mLabel = isOtherYear ? `${m.month.slice(2, 4)}.${m.month.slice(5)}` : `${m.month.slice(5)}월`;
              return `<th class="py-1.5 px-2 font-mono text-slate-700 whitespace-nowrap">${mLabel}</th>`;
            }).join('')}
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 text-[11px]">
          <!-- 1. 매출액 -->
          <tr class="hover:bg-indigo-50/30 transition-colors">
            <td class="py-1.5 px-3 text-left font-black text-slate-800 sticky left-0 bg-white z-10 shadow-xs flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-indigo-600 inline-block shrink-0"></span>
              <span>매출액</span>
            </td>
            ${monthly.map(m => {
              const bill = m.billing || 0;
              const eokStr = bill >= 100000000 ? `${(bill / 100000000).toFixed(1)}억` : `${Math.round(bill / 10000).toLocaleString()}만`;
              return `<td class="py-1.5 px-2 font-mono font-black text-indigo-950 whitespace-nowrap" title="₩${Math.round(bill).toLocaleString()}">₩${eokStr}</td>`;
            }).join('')}
          </tr>
          <!-- 2. 매출이익 (마진) -->
          <tr class="hover:bg-emerald-50/30 transition-colors">
            <td class="py-1.5 px-3 text-left font-bold text-emerald-900 sticky left-0 bg-white z-10 shadow-xs flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-emerald-500 inline-block shrink-0"></span>
              <span>매출이익</span>
            </td>
            ${monthly.map(m => {
              const mgn = m.margin || 0;
              const eokStr = mgn >= 100000000 ? `${(mgn / 100000000).toFixed(1)}억` : `${Math.round(mgn / 10000).toLocaleString()}만`;
              return `<td class="py-1.5 px-2 font-mono font-bold text-emerald-800 whitespace-nowrap" title="₩${Math.round(mgn).toLocaleString()}">₩${eokStr}</td>`;
            }).join('')}
          </tr>
          <!-- 3. 실현 마진율 -->
          <tr class="hover:bg-slate-50/50 transition-colors">
            <td class="py-1.5 px-3 text-left font-bold text-slate-700 sticky left-0 bg-white z-10 shadow-xs flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-teal-500 inline-block shrink-0"></span>
              <span>마진율</span>
            </td>
            ${monthly.map(m => `
              <td class="py-1.5 px-2 whitespace-nowrap">
                <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">${m.margin_rate || 0}%</span>
              </td>
            `).join('')}
          </tr>
          <!-- 4. 출하 건수 -->
          <tr class="hover:bg-slate-50/50 transition-colors">
            <td class="py-1.5 px-3 text-left font-medium text-slate-500 sticky left-0 bg-white z-10 shadow-xs flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-slate-400 inline-block shrink-0"></span>
              <span>출하건수</span>
            </td>
            ${monthly.map(m => `<td class="py-1.5 px-2 font-mono text-slate-500 text-[10px] whitespace-nowrap">${m.bill_count || 0}건</td>`).join('')}
          </tr>
        </tbody>
      </table>
    </div>
  `;

  container.innerHTML = `
    <div class="space-y-4">
      
      <!-- 1. 최상단 헤더 바 -->
      <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-3.5 sm:p-5 rounded-2xl shadow-sm border border-slate-700/60 flex flex-wrap items-center justify-between gap-2.5">
        <div class="flex items-center gap-2.5 sm:gap-3">
          <div class="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-indigo-600/30 border border-indigo-400/40 flex items-center justify-center text-lg sm:text-xl shrink-0">
            📊
          </div>
          <div>
            <div class="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <h2 class="text-sm sm:text-lg font-black tracking-wide text-white break-keep">매출 장부 & 실적 분석 (Book & Bill)</h2>
              <span class="text-[9px] sm:text-[10px] font-bold bg-amber-400/20 text-amber-300 border border-amber-400/40 px-1.5 py-0.5 rounded-full shrink-0">실시간 연동</span>
            </div>
            <p class="text-[10px] sm:text-xs text-slate-300 font-medium mt-0.5">FrmSalesBKBL & FrmSalesGraph 기반 연간·월별 실적 분석</p>
          </div>
        </div>

        <div class="flex items-center gap-2 text-xs w-full sm:w-auto justify-end pt-1 sm:pt-0 border-t sm:border-t-0 border-slate-800">
          <span class="text-slate-300 font-bold text-[11px] sm:text-xs shrink-0">기준 연도:</span>
          <select id="analyticsYearSelect" onchange="window.switchAnalyticsYear(this.value)" class="bg-slate-800 text-amber-300 border border-slate-600 rounded-lg px-2 sm:px-2.5 py-1 sm:py-1.5 font-bold outline-none cursor-pointer text-xs">
            <option value="2026" ${currentYear === '2026' ? 'selected' : ''}>2026년</option>
            <option value="2025" ${currentYear === '2025' ? 'selected' : ''}>2025년</option>
            <option value="2024" ${currentYear === '2024' ? 'selected' : ''}>2024년</option>
          </select>
          <button type="button" onclick="window.refreshSalesAnalytics()" class="px-2.5 sm:px-3 py-1 sm:py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg shadow-sm transition-colors flex items-center gap-1 cursor-pointer text-xs shrink-0">
            🔄 새로고침
          </button>
        </div>
      </div>

      <!-- 2. 핵심 KPI 4단 카드 (모바일 2x2 그리드) -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <!-- 1) 연간 누적 매출액 -->
        <div class="bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden flex flex-col justify-between">
          <div class="text-[10px] sm:text-[11px] font-bold text-slate-500 flex items-center justify-between">
            <span class="truncate">${currentYear}년 누적 매출</span>
            <span class="text-indigo-600 font-mono text-[9px] sm:text-xs shrink-0">📈 YTD</span>
          </div>
          <div class="text-sm sm:text-xl font-black text-slate-900 mt-1 font-mono truncate">
            ₩${Math.round(billingYtd).toLocaleString()}
          </div>
          <div class="text-[9px] sm:text-[10px] text-slate-400 mt-0.5 truncate">
            출하: <strong class="text-slate-700">${monthly.reduce((acc, m) => acc + m.bill_count, 0).toLocaleString()}건</strong>
          </div>
        </div>

        <!-- 2) 연간 누적 매출이익 (Margin) -->
        <div class="bg-white p-3 sm:p-4 rounded-xl border border-emerald-200 bg-emerald-50/20 shadow-sm relative overflow-hidden flex flex-col justify-between">
          <div class="text-[10px] sm:text-[11px] font-bold text-emerald-800 flex items-center justify-between">
            <span class="truncate">${currentYear}년 누적 마진</span>
            <span class="text-emerald-600 font-black text-[9px] sm:text-xs shrink-0">${marginRate}%</span>
          </div>
          <div class="text-sm sm:text-xl font-black text-emerald-900 mt-1 font-mono truncate">
            ₩${Math.round(marginYtd).toLocaleString()}
          </div>
          <div class="text-[9px] sm:text-[10px] text-emerald-700 mt-0.5 truncate">
            평균: <strong class="text-emerald-900 font-bold">${marginRate}% 달성</strong>
          </div>
        </div>

        <!-- 3) 연간 누적 수주액 (Booking) -->
        <div class="bg-white p-3 sm:p-4 rounded-xl border border-amber-200 bg-amber-50/20 shadow-sm relative overflow-hidden flex flex-col justify-between">
          <div class="text-[10px] sm:text-[11px] font-bold text-amber-800 flex items-center justify-between">
            <span class="truncate">${currentYear}년 누적 수주</span>
            <span class="text-amber-600 font-bold text-[9px] sm:text-xs shrink-0">🛒 PO</span>
          </div>
          <div class="text-sm sm:text-xl font-black text-amber-950 mt-1 font-mono truncate">
            ₩${Math.round(bookingYtd).toLocaleString()}
          </div>
          <div class="text-[9px] sm:text-[10px] text-amber-700 mt-0.5 truncate">
            수주: <strong class="text-amber-900">${monthly.reduce((acc, m) => acc + m.book_count, 0).toLocaleString()}건</strong>
          </div>
        </div>

        <!-- 4) 당월 매출액 -->
        <div class="bg-white p-3 sm:p-4 rounded-xl border border-indigo-200 bg-indigo-50/30 shadow-sm relative overflow-hidden flex flex-col justify-between">
          <div class="text-[10px] sm:text-[11px] font-bold text-indigo-800 flex items-center justify-between">
            <span class="truncate">당월 매출 (${currentMonthItem.month || 'Current'})</span>
            <span class="text-indigo-600 font-bold text-[9px] sm:text-xs shrink-0">📅 당월</span>
          </div>
          <div class="text-sm sm:text-xl font-black text-indigo-950 mt-1 font-mono truncate">
            ₩${Math.round(currentMonthBill).toLocaleString()}
          </div>
          <div class="text-[9px] sm:text-[10px] text-indigo-700 mt-0.5 truncate">
            진행: <strong class="text-indigo-900">${(currentMonthItem.bill_count || 0)}건 출하</strong>
          </div>
        </div>
      </div>

      <!-- 3. 월별 매출 실적 (Billing) 및 마진율 추이 차트 -->
      <div class="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-sm space-y-2.5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 sm:gap-2">
            <h3 class="font-bold text-xs sm:text-sm text-slate-900 flex items-center gap-1.5">
              <span>📈</span>
              <span>월별 매출 실적 (Billing) 및 마진율 추이</span>
            </h3>
            <span class="text-[9px] sm:text-[10px] text-slate-400 font-medium">${currentYear}년 월별 출하 확정 매출 및 마진율</span>
          </div>
          <!-- 범례 -->
          <div class="flex items-center gap-3 sm:gap-4 text-[11px] sm:text-xs font-bold">
            <span class="flex items-center gap-1 text-indigo-900">
              <span class="w-3 h-3 rounded bg-gradient-to-b from-indigo-500 to-indigo-700 shadow-xs inline-block"></span>
              매출액
            </span>
            <span class="flex items-center gap-1 text-emerald-700">
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
              마진율 (%)
            </span>
          </div>
        </div>

        <!-- 모바일 가로 스와이프 안내 힌트 -->
        <div class="sm:hidden flex items-center justify-center gap-1.5 text-[10px] text-indigo-700 bg-indigo-50/80 border border-indigo-200/60 py-1 px-2.5 rounded-lg font-bold">
          <span class="animate-pulse">👈</span> 좌우로 밀어서 1월~11월 전체 실적 확인 <span class="animate-pulse">👉</span>
        </div>

        <div class="w-full overflow-x-auto pt-1 scroll-smooth" style="-webkit-overflow-scrolling: touch;">
          <svg viewBox="0 0 ${chartWidth} ${chartHeight}" class="w-full h-52 select-none min-w-[700px]">
            <defs>
              <linearGradient id="billingBarGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#6366f1" />
                <stop offset="100%" stop-color="#4338ca" />
              </linearGradient>
            </defs>
            <!-- Y축 그리드 라인 & 눈금 라벨 -->
            ${yGridSvg}
            <!-- 막대 렌더링 & 수치 라벨 -->
            ${chartSvgBars}
          </svg>
        </div>

        <!-- 하단 월별 정확한 수치 상세 테이블 -->
        ${monthlySummaryTableHtml}
      </div>

      <!-- 4. 하단 3개 분석 컬럼 (고객사 Top 10 / 제조사 점유율 / 영업사원 기여도) -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        
        <!-- 1) Top 10 고객사 -->
        <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col space-y-3">
          <div class="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 class="font-bold text-xs text-slate-900 flex items-center gap-1.5">
              <span>🏢</span> Top 10 주요 고객사
            </h3>
            <span class="text-[10px] text-slate-400 font-medium">매출 기여도 순</span>
          </div>

          <div class="space-y-2 overflow-y-auto max-h-80 pr-1 text-xs">
            ${(a.top_customers || []).map((c, idx) => {
              const pct = billingYtd > 0 ? ((c.billing / billingYtd) * 100).toFixed(1) : 0;
              return `
                <div class="space-y-0.5">
                  <div class="flex items-center justify-between text-[11px]">
                    <span class="font-bold text-slate-800 truncate max-w-[150px]" title="${c.customer_name}">
                      <span class="text-indigo-600 font-mono font-black">${idx + 1}.</span> ${c.customer_name}
                    </span>
                    <span class="font-mono font-bold text-slate-900">₩${Math.round(c.billing).toLocaleString()}</span>
                  </div>
                  <div class="flex items-center gap-2 text-[10px] text-slate-400">
                    <div class="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                      <div class="bg-indigo-600 h-full rounded-full" style="width: ${Math.min(pct * 3, 100)}%"></div>
                    </div>
                    <span class="shrink-0 font-mono text-[9px] font-bold text-indigo-700">${pct}%</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- 2) Top 제조사 (Maker) 점유율 -->
        <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col space-y-3">
          <div class="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 class="font-bold text-xs text-slate-900 flex items-center gap-1.5">
              <span>🏭</span> 제조사 (Maker) 점유율
            </h3>
            <span class="text-[10px] text-slate-400 font-medium">라인별 매출 비중</span>
          </div>

          <div class="space-y-2 overflow-y-auto max-h-80 pr-1 text-xs">
            ${(a.top_makers || []).map((m, idx) => {
              const pct = billingYtd > 0 ? ((m.billing / billingYtd) * 100).toFixed(1) : 0;
              return `
                <div class="space-y-0.5">
                  <div class="flex items-center justify-between text-[11px]">
                    <span class="font-bold text-slate-800 flex items-center gap-1">
                      <span class="px-1.5 py-0.2 rounded text-[9px] font-black bg-indigo-50 text-indigo-800 border border-indigo-200">${m.maker}</span>
                      <span class="text-slate-400 text-[10px] font-normal">(${m.item_count}건)</span>
                    </span>
                    <span class="font-mono font-bold text-slate-900">₩${Math.round(m.billing).toLocaleString()}</span>
                  </div>
                  <div class="flex items-center gap-2 text-[10px] text-slate-400">
                    <div class="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                      <div class="bg-emerald-500 h-full rounded-full" style="width: ${Math.min(pct * 2.5, 100)}%"></div>
                    </div>
                    <span class="shrink-0 font-mono text-[9px] font-bold text-emerald-800">${pct}%</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- 3) 영업 담당자별 실적 기여도 -->
        <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col space-y-3">
          <div class="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 class="font-bold text-xs text-slate-900 flex items-center gap-1.5">
              <span>👤</span> 영업 담당자별 실적 & 마진
            </h3>
            <span class="text-[10px] text-slate-400 font-medium">영업사원 기여도</span>
          </div>

          <div class="space-y-2.5 overflow-y-auto max-h-80 pr-1 text-xs">
            ${(a.sales_reps || []).map(s => {
              return `
                <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-200 space-y-1">
                  <div class="flex items-center justify-between">
                    <span class="font-black text-indigo-950 flex items-center gap-1">
                      <span class="w-2 h-2 rounded-full bg-indigo-600"></span>
                      ${s.sales_rep}
                    </span>
                    <span class="font-black font-mono text-slate-900 text-xs">
                      ₩${Math.round(s.billing).toLocaleString()}
                    </span>
                  </div>
                  <div class="flex items-center justify-between text-[10px] text-slate-500">
                    <span>마진: <strong class="text-emerald-700">₩${Math.round(s.margin).toLocaleString()}</strong> (${s.margin_rate}%)</span>
                    <span>출하: <strong class="text-slate-700">${s.shipment_count}건</strong></span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

      </div>

      <!-- 5. 영업 활동 메모 & 일지 섹션 (FrmDailyMemo) -->
      <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
          <div class="flex items-center gap-2">
            <span class="text-base">📝</span>
            <h3 class="font-bold text-sm text-slate-900">영업 활동 일지 & 고객 방문 메모 (Daily Memo)</h3>
            <span class="text-[10px] text-slate-400 font-medium">FrmDailyMemo 연동</span>
          </div>

          <div class="flex items-center gap-2 text-xs">
            <select id="memoSalesFilter" onchange="window.filterSalesMemos(this.value)" class="bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-700 outline-none">
              <option value="ALL">전체 영업사원</option>
              <option value="STEVE">STEVE</option>
              <option value="KELLY">KELLY</option>
              <option value="WILLIAM">WILLIAM</option>
              <option value="ALLEN">ALLEN</option>
              <option value="DUSTIN">DUSTIN</option>
            </select>
            <button type="button" onclick="window.toggleMemoInputForm()" class="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-lg border border-indigo-200 text-xs transition-colors cursor-pointer">
              + 메모 작성
            </button>
          </div>
        </div>

        <!-- 메모 작성 폼 (기본 접힘) -->
        <div id="memoInputFormBox" class="hidden bg-slate-50 border border-slate-200 p-3 rounded-xl space-y-2">
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <select id="newMemoRep" class="bg-white border border-slate-300 rounded-lg px-2 py-1 font-bold text-slate-800">
              <option value="STEVE">STEVE</option>
              <option value="KELLY">KELLY</option>
              <option value="WILLIAM">WILLIAM</option>
              <option value="ALLEN">ALLEN</option>
              <option value="DUSTIN">DUSTIN</option>
            </select>
            <input type="date" id="newMemoDate" value="${new Date().toISOString().slice(0, 10)}" class="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-mono">
            <button type="button" onclick="window.saveNewSalesMemo()" class="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs cursor-pointer shadow-xs">
              등록 완료
            </button>
          </div>
          <textarea id="newMemoText" rows="2" placeholder="고객사 방문 내용, 샘플 전달, 견적 협의 사항 등을 입력하세요..." class="w-full p-2 border border-slate-300 rounded-lg bg-white text-xs outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
        </div>

        <!-- 메모 리스트 컨테이너 -->
        <div id="salesMemoListContainer" class="space-y-2 text-xs max-h-72 overflow-y-auto pr-1">
          <div class="text-slate-400 text-center py-4">영업 메모를 불러오는 중입니다...</div>
        </div>
      </div>

    </div>
  `;

  // 메모 자동 로드
  loadSalesMemos('ALL');

  // DOM 이벤트 리스너 안전 바인딩 (인라인 핸들러 외 이중 보장)
  const yrSelect = container.querySelector('#analyticsYearSelect');
  if (yrSelect) {
    yrSelect.addEventListener('change', (e) => {
      window.switchAnalyticsYear(e.target.value);
    });
  }

  const memoFilter = container.querySelector('#memoSalesFilter');
  if (memoFilter) {
    memoFilter.addEventListener('change', (e) => {
      window.filterSalesMemos(e.target.value);
    });
  }
}

let allMemos = [];
let cachedMemos = [];

async function loadSalesMemos(rep = 'ALL') {
  const container = document.getElementById('salesMemoListContainer');
  if (!container) return;

  try {
    const url = rep === 'ALL' ? '/api/sales/memos' : `/api/sales/memos?sales_rep=${encodeURIComponent(rep)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status === 'success') {
      if (rep === 'ALL') {
        allMemos = data.memos || [];
        cachedMemos = allMemos;
      } else {
        cachedMemos = data.memos || [];
      }
      renderMemoList(cachedMemos);
    }
  } catch (e) {
    if (rep !== 'ALL' && allMemos.length > 0) {
      const fallback = allMemos.filter(m => (m.sales_rep || '').toUpperCase() === rep.toUpperCase());
      renderMemoList(fallback);
    } else {
      container.innerHTML = '<div class="text-slate-400 text-center py-4">메모 로드에 실패했습니다.</div>';
    }
  }
}

function renderMemoList(memos) {
  const container = document.getElementById('salesMemoListContainer');
  if (!container) return;

  if (!memos || memos.length === 0) {
    container.innerHTML = '<div class="text-slate-400 text-center py-6 font-medium">선택한 영업사원의 활동 메모가 없습니다.</div>';
    return;
  }

  container.innerHTML = memos.map(m => {
    return `
      <div class="bg-slate-50/80 hover:bg-indigo-50/40 p-2.5 rounded-lg border border-slate-200 transition-colors space-y-1">
        <div class="flex items-center justify-between text-[11px]">
          <span class="font-bold text-slate-800 flex items-center gap-1.5">
            <span class="px-1.5 py-0.2 rounded text-[9px] font-black bg-indigo-100 text-indigo-700">${m.sales_rep}</span>
            <span class="font-mono text-slate-400 text-[10px]">${m.input_date}</span>
          </span>
        </div>
        <div class="text-slate-700 whitespace-pre-wrap leading-relaxed text-[11px] font-normal pl-0.5">
          ${m.memo}
        </div>
      </div>
    `;
  }).join('');
}

window.filterSalesMemos = function(rep) {
  if (rep === 'ALL') {
    renderMemoList(allMemos);
  } else {
    const localFiltered = allMemos.filter(m => (m.sales_rep || '').toUpperCase() === rep.toUpperCase());
    renderMemoList(localFiltered);
  }
  loadSalesMemos(rep);
};

window.toggleMemoInputForm = function() {
  const box = document.getElementById('memoInputFormBox');
  if (box) {
    box.classList.toggle('hidden');
    if (!box.classList.contains('hidden')) {
      document.getElementById('newMemoText')?.focus();
    }
  }
};

window.saveNewSalesMemo = async function() {
  const rep = document.getElementById('newMemoRep')?.value;
  const date = document.getElementById('newMemoDate')?.value;
  const text = document.getElementById('newMemoText')?.value.trim();

  if (!text) {
    alert("메모 내용을 입력해 주세요.");
    return;
  }

  try {
    const res = await fetch('/api/sales/memos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sales_rep: rep, memo: text, input_date: date })
    });
    const data = await res.json();
    if (data.status === 'success') {
      document.getElementById('newMemoText').value = '';
      window.toggleMemoInputForm();
      const newEntry = { sales_rep: rep, memo: text, input_date: date, update_date: date };
      allMemos.unshift(newEntry);
      const currentRep = document.getElementById('memoSalesFilter')?.value || 'ALL';
      window.filterSalesMemos(currentRep);
    } else {
      alert("메모 등록 실패: " + (data.message || '오류 발생'));
    }
  } catch (err) {
    alert("서버 연결 실패: " + err.message);
  }
};

window.switchAnalyticsYear = function(year) {
  currentYear = year;
  fetchSalesAnalytics(year).then(() => {
    renderAnalyticsView('analyticsSection');
  });
};

window.refreshSalesAnalytics = function() {
  const select = document.getElementById('analyticsYearSelect');
  const year = select ? select.value : currentYear;
  currentYear = year;
  fetchSalesAnalytics(year).then(() => {
    renderAnalyticsView('analyticsSection');
  });
};
