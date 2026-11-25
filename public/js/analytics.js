/**
 * analytics.js
 * 세일즈 마스터 MS-SQL 연동 매출 장부 & 다차원 실적 분석 (Book & Bill) 모듈
 * (FrmSalesBKBL & FrmSalesGraph 기능 완벽 이식)
 * 
 * 특정 월 필터 (당월 보기 / 연간 누적 YTD 보기) 완벽 지원
 */

import { toEnglishSalesName, escapeHtml as escRep, isSelfCompanyName, resolveCustomerName } from './modules/utils.js';

let cachedAnalytics = null;
let lastMergedSalesReps = [];
let currentYear = "2026";
let currentMonth = "all"; // "all" (연간 누적) 또는 "1".."12"
let analyticsChartMode = "profit"; // "profit" (마진+커미션 통합 스택) | "billing" (매출액 추이)

window.switchAnalyticsChartMode = function(mode) {
  analyticsChartMode = mode === 'billing' ? 'billing' : 'profit';
  renderAnalyticsView('analyticsSection');
};

export async function fetchSalesAnalytics(year = "2026", month = "all") {
  currentYear = String(year);
  currentMonth = String(month);
  try {
    const res = await fetch(`/api/analytics/sales?year=${encodeURIComponent(currentYear)}&month=${encodeURIComponent(currentMonth)}`);
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
    fetchSalesAnalytics(currentYear, currentMonth).then(data => {
      if (data) renderAnalyticsView(containerId);
    });
    return;
  }

  const a = cachedAnalytics;
  const isMonthly = a.is_monthly || (currentMonth !== "all");
  const selectedMonthNum = a.selected_month_num || (isMonthly ? parseInt(currentMonth, 10) : null);

  const billingYtd = a.total_billing_ytd || 0;
  const bookingYtd = a.total_booking_ytd || 0;
  const marginYtd = a.total_margin_ytd || 0;
  const marginRate = a.overall_margin_rate || 0;

  // 월별 추이 데이터
  const monthly = a.monthly || [];
  const yearMonthly = monthly.filter(m => m.month && m.month.startsWith(currentYear));
  const latestMonthItem = yearMonthly.length > 0 ? yearMonthly[yearMonthly.length - 1] : { billing: 0, booking: 0, month: `${currentYear}-11` };
  const latestMonthNum = latestMonthItem.month ? parseInt(latestMonthItem.month.slice(5), 10) : 11;
  const currentMonthBill = latestMonthItem.billing || 0;

  // 선택된 월의 목표 데이터 매칭 (monthly 배열 기반)
  let targetM = null;
  if (isMonthly && selectedMonthNum) {
    const ymKey = `${currentYear}-${String(selectedMonthNum).padStart(2, '0')}`;
    targetM = monthly.find(m => m.month === ymKey);
  }

  let periodBilling = a.period_billing;
  if (periodBilling == null || periodBilling === 0) {
    if (isMonthly && targetM && targetM.billing > 0) {
      periodBilling = targetM.billing;
    } else if (isMonthly && a.sales_reps && a.sales_reps.length > 0) {
      periodBilling = a.sales_reps.reduce((acc, s) => acc + (s.billing || 0), 0);
    } else {
      periodBilling = isMonthly ? (targetM ? targetM.billing : 0) : billingYtd;
    }
  }

  let periodMargin = a.period_margin;
  if (periodMargin == null) {
    periodMargin = isMonthly ? (targetM ? targetM.margin : (a.sales_reps ? a.sales_reps.reduce((acc, s) => acc + (s.margin || 0), 0) : 0)) : marginYtd;
  }

  let periodMarginRate = a.period_margin_rate;
  if (periodMarginRate == null) {
    periodMarginRate = isMonthly ? (targetM ? targetM.margin_rate : (periodBilling > 0 ? Number(((periodMargin / periodBilling) * 100).toFixed(1)) : 0)) : marginRate;
  }

  let periodShipmentCount = a.period_shipment_count;
  if (periodShipmentCount == null) {
    periodShipmentCount = isMonthly ? (targetM ? targetM.bill_count : (a.sales_reps ? a.sales_reps.reduce((acc, s) => acc + (s.shipment_count || 0), 0) : 0)) : monthly.reduce((acc, m) => acc + (m.bill_count || 0), 0);
  }

  const periodBooking = a.period_booking != null ? a.period_booking : (isMonthly ? (targetM ? targetM.booking : 0) : bookingYtd);

  // 💎 Commission + Domestic 마진 통합 수익 지표 (동일 포인트 비교용, 현재 실시간 환율 기준)
  const fxRate = (typeof window.getLiveFxRate === 'function' ? window.getLiveFxRate() : window.rawFxRate) || 1380;
  const comm = a.commission || {};
  const commMonthlyList = Array.isArray(comm.monthly) ? comm.monthly : [];
  const commMonthlyMap = {};
  commMonthlyList.forEach(cm => {
    if (cm && cm.month) commMonthlyMap[cm.month] = cm;
  });
  const periodCommUsd = Number(comm.total_comm_amt) || 0;
  const periodCommPaidUsd = Number(comm.paid_comm_amt) || 0;
  const periodCommUnpaidUsd = Number(comm.unpaid_comm_amt) || 0;
  const periodCommPaidPct = periodCommUsd > 0 ? Math.round((periodCommPaidUsd / periodCommUsd) * 100) : 0;
  const periodCommKrw = Math.round(periodCommUsd * fxRate);
  const periodCommCount = Number(comm.comm_count) || 0;
  const ytdCommUsd = commMonthlyList.reduce((s, cm) => s + (Number(cm.comm_amt) || 0), 0);
  const ytdCommKrw = Math.round(ytdCommUsd * fxRate);
  const periodTotalProfitKrw = (isMonthly ? periodMargin : marginYtd) + periodCommKrw;
  const ytdTotalProfitKrw = marginYtd + ytdCommKrw;

  // 영업 담당자별 Domestic + Commission 통합 매핑
  const commBySalesMap = {};
  (Array.isArray(comm.by_sales) ? comm.by_sales : []).forEach(cs => {
    const key = toEnglishSalesName(cs.sales_rep || '') || 'BSK';
    commBySalesMap[key] = {
      comm_amt: Number(cs.comm_amt) || 0,
      unpaid_amt: Number(cs.unpaid_amt) || 0,
      count: Number(cs.count) || 0
    };
  });
  const mergedSalesMap = {};
  (Array.isArray(a.sales_reps) ? a.sales_reps : []).forEach(s => {
    const key = toEnglishSalesName(s.sales_rep || '') || 'BSK';
    mergedSalesMap[key] = {
      sales_rep: key,
      billing: Number(s.billing) || 0,
      margin: Number(s.margin) || 0,
      margin_rate: Number(s.margin_rate) || 0,
      shipment_count: Number(s.shipment_count) || 0,
      comm_usd: 0,
      comm_krw: 0,
      comm_count: 0
    };
  });
  Object.entries(commBySalesMap).forEach(([key, cv]) => {
    if (!mergedSalesMap[key]) {
      mergedSalesMap[key] = { sales_rep: key, billing: 0, margin: 0, margin_rate: 0, shipment_count: 0, comm_usd: 0, comm_krw: 0, comm_count: 0 };
    }
    mergedSalesMap[key].comm_usd = cv.comm_amt;
    mergedSalesMap[key].comm_krw = Math.round(cv.comm_amt * fxRate);
    mergedSalesMap[key].comm_count = cv.count;
  });
  const mergedSalesReps = Object.values(mergedSalesMap)
    .map(s => ({ ...s, total_profit: s.margin + s.comm_krw }))
    .sort((x, y) => y.total_profit - x.total_profit);
  lastMergedSalesReps = mergedSalesReps;

  // 제조사별 Domestic + Commission 통합 목록 (커미션 전용 제조사 SMI/Giantec 등도 포함)
  const commByMakerMap = {};
  (Array.isArray(comm.by_maker) ? comm.by_maker : []).forEach(cm => {
    const k = String(cm.maker || '').trim().toUpperCase();
    if (k) commByMakerMap[k] = cm;
  });
  const mergedMakers = [];
  const seenMakers = new Set();
  (Array.isArray(a.top_makers) ? a.top_makers : []).forEach(m => {
    const k = String(m.maker || '').trim().toUpperCase();
    seenMakers.add(k);
    const cm = commByMakerMap[k];
    mergedMakers.push({
      maker: m.maker,
      billing: Number(m.billing) || 0,
      item_count: Number(m.item_count) || 0,
      comm_usd: cm ? (Number(cm.comm_amt) || 0) : 0,
      comm_unpaid_usd: cm ? (Number(cm.unpaid_amt) || 0) : 0,
      comm_count: cm ? (Number(cm.count) || 0) : 0
    });
  });
  (Array.isArray(comm.by_maker) ? comm.by_maker : []).forEach(cm => {
    const k = String(cm.maker || '').trim().toUpperCase();
    if (!k || seenMakers.has(k) || k === 'OTHERS') return;
    seenMakers.add(k);
    mergedMakers.push({
      maker: cm.maker,
      billing: 0,
      item_count: 0,
      comm_usd: Number(cm.comm_amt) || 0,
      comm_unpaid_usd: Number(cm.unpaid_amt) || 0,
      comm_count: Number(cm.count) || 0
    });
  });

  // 월 선택 드롭다운 옵션 목록 (최신 월부터 1월까지 역순 생성)
  const availableMonths = [];
  const maxMo = Math.max(latestMonthNum, 11);
  for (let mo = maxMo; mo >= 1; mo--) {
    availableMonths.push(mo);
  }

  // 기준 매출액 (비율 계산용: 안전 분모 설정)
  const baseBilling = (isMonthly ? (periodBilling && periodBilling > 0 ? periodBilling : billingYtd) : billingYtd) || 1;

  // 1. 월별 차트 스케일 계산 (국내마진 vs 커미션 2막대 병렬 비교 모드 vs 매출액 모드)
  const isProfitChart = analyticsChartMode === 'profit';
  const maxChartVal = isProfitChart
    ? Math.max(...monthly.map(m => {
        const cm = commMonthlyMap[m.month];
        const cKrw = Math.round((cm ? (Number(cm.comm_amt) || 0) : 0) * fxRate);
        return Math.max(m.margin || 0, cKrw);
      }), 50000000)
    : Math.max(...monthly.map(m => m.billing || 0), 100000000);

  let step = 500000000;
  if (maxChartVal > 2500000000) step = 1000000000;
  else if (maxChartVal > 800000000) step = 500000000;
  else if (maxChartVal > 400000000) step = 200000000;
  else if (maxChartVal > 150000000) step = 100000000;
  else step = 50000000;
  const yCeiling = Math.max(step * 2, Math.ceil((maxChartVal * 1.18) / step) * step);

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
    const label = val === 0 ? '0' : (val >= 100000000 ? `${(val / 100000000).toFixed(val % 100000000 === 0 ? 0 : 1)}억` : `${Math.round(val / 10000)}만`);
    yTicks.push({ val, yPos, label });
  }

  const yGridSvg = yTicks.map(t => `
    <g class="y-tick">
      <line x1="${plotLeft}" y1="${t.yPos}" x2="${plotRight}" y2="${t.yPos}" stroke="${t.val === 0 ? '#94a3b8' : '#f1f5f9'}" stroke-width="${t.val === 0 ? '1.5' : '1'}" stroke-dasharray="${t.val === 0 ? '' : '3 3'}" />
      <text x="${plotLeft - 10}" y="${t.yPos + 4}" text-anchor="end" font-size="10" font-weight="bold" fill="#64748b" class="font-mono">${t.label}</text>
    </g>
  `).join('');

  // X축 및 막대 생성 (통합 총수익 스택바 OR 매출 단일바)
  const slotCount = monthly.length;
  const slotWidth = slotCount > 0 ? plotWidth / slotCount : 60;
  const barWidth = Math.min(38, Math.max(16, Math.floor(slotWidth * 0.58)));

  const fmtCompactKrw = (v) => {
    if (v >= 100000000) return `${(v / 100000000).toFixed(1)}억`;
    if (v > 0) return `${Math.round(v / 10000).toLocaleString()}만`;
    return '';
  };

  const chartSvgBars = monthly.map((m, idx) => {
    const bill = m.billing || 0;
    const mgn = m.margin || 0;
    const mgnRate = m.margin_rate || 0;
    const billCount = m.bill_count || 0;
    const cm = commMonthlyMap[m.month];
    const cUsd = cm ? (Number(cm.comm_amt) || 0) : 0;
    const cKrw = Math.round(cUsd * fxRate);
    const totalProfit = mgn + cKrw;

    const mNum = parseInt(m.month.slice(5), 10);
    const isSelected = isMonthly && (selectedMonthNum === mNum);

    const slotCenter = plotLeft + idx * slotWidth + slotWidth / 2;
    const barX = Math.round(slotCenter - barWidth / 2);

    const isOtherYear = !m.month.startsWith(currentYear);
    const monthLabel = isOtherYear ? `${m.month.slice(2, 4)}.${m.month.slice(5)}` : `${m.month.slice(5)}월`;

    if (isProfitChart) {
      const pairGap = 3;
      const subBarW = Math.min(20, Math.max(10, Math.floor((slotWidth * 0.72 - pairGap) / 2)));
      const leftBarX = Math.round(slotCenter - subBarW - pairGap / 2);
      const rightBarX = Math.round(slotCenter + pairGap / 2);
      const mgnH = mgn > 0 ? Math.max(4, Math.round((mgn / yCeiling) * plotHeight)) : 2;
      const commH = cKrw > 0 ? Math.max(4, Math.round((cKrw / yCeiling) * plotHeight)) : 2;
      const mgnY = plotBottom - mgnH;
      const commY = plotBottom - commH;
      const leftCenter = leftBarX + subBarW / 2;
      const rightCenter = rightBarX + subBarW / 2;

      const fmtShortBar = (v) => {
        if (v >= 100000000) return `${(v / 100000000).toFixed(1)}억`;
        if (v >= 10000000) return `${(v / 10000000).toFixed(1)}천`;
        if (v > 0) return `${Math.round(v / 10000)}만`;
        return '';
      };

      return `
        <g class="chart-group cursor-pointer group" data-idx="${idx}" onclick="window.switchAnalyticsMonth('${mNum}')">
          <rect x="${Math.round(slotCenter - slotWidth / 2 + 2)}" y="${plotTop - 15}" width="${Math.round(slotWidth - 4)}" height="${plotHeight + 25}" fill="${isSelected ? '#f5f3ff' : '#f8fafc'}" rx="8" stroke="${isSelected ? '#c4b5fd' : 'none'}" stroke-width="${isSelected ? '1.5' : '0'}" class="${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity" pointer-events="none"></rect>

          <!-- 막대 1 (왼쪽): Domestic 마진 (에메랄드) -->
          <rect x="${leftBarX}" y="${mgnY}" width="${subBarW}" height="${mgnH}" rx="3"
                fill="url(#marginBarGradient)"
                stroke="${isSelected ? '#f59e0b' : 'none'}" stroke-width="${isSelected ? '1.5' : '0'}"
                class="filter drop-shadow-xs transition-all duration-150 group-hover:brightness-110">
            <title>${m.month} 국내마진 · 💎 커미션 비교 (클릭 시 ${mNum}월 상세 조회)
• 🏆 통합 총수익: ₩${Math.round(totalProfit).toLocaleString()}
• 국내 마진: ₩${Math.round(mgn).toLocaleString()} (마진율 ${mgnRate}%)
• 💎 커미션: $${cUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (≈₩${cKrw.toLocaleString()})
• 국내 매출: ₩${Math.round(bill).toLocaleString()} (${billCount}건)</title>
          </rect>

          <!-- 막대 2 (오른쪽): 💎 커미션 원화환산 (바이올렛) -->
          <rect x="${rightBarX}" y="${commY}" width="${subBarW}" height="${commH}" rx="3"
                fill="${cKrw > 0 ? 'url(#commBarGradient)' : '#e2e8f0'}"
                stroke="${isSelected && cKrw > 0 ? '#f59e0b' : 'none'}" stroke-width="${isSelected && cKrw > 0 ? '1.5' : '0'}"
                class="filter drop-shadow-xs transition-all duration-150 group-hover:brightness-110">
            <title>${m.month} 국내마진 · 💎 커미션 비교 (클릭 시 ${mNum}월 상세 조회)
• 🏆 통합 총수익: ₩${Math.round(totalProfit).toLocaleString()}
• 국내 마진: ₩${Math.round(mgn).toLocaleString()} (마진율 ${mgnRate}%)
• 💎 커미션: $${cUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (≈₩${cKrw.toLocaleString()})
• 국내 매출: ₩${Math.round(bill).toLocaleString()} (${billCount}건)</title>
          </rect>

          <!-- 막대 위에 수치 라벨 렌더링 (흰색 외곽선으로 겹침 방지 & 천만원 단위 'X.X천' 축약) -->
          <text x="${leftCenter - (cKrw > mgn ? 2 : 0)}" y="${mgnY - 5}" text-anchor="middle" font-size="9" font-weight="900" fill="#047857" paint-order="stroke" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" class="font-mono tracking-tighter select-none pointer-events-none">
            ${fmtShortBar(mgn)}
          </text>
          <text x="${rightCenter + (mgn > cKrw ? 3 : 0)}" y="${commY - 5}" text-anchor="middle" font-size="9" font-weight="900" fill="#6d28d9" paint-order="stroke" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" class="font-mono tracking-tighter select-none pointer-events-none">
            ${fmtShortBar(cKrw)}
          </text>

          <text x="${slotCenter}" y="${plotBottom + 18}" text-anchor="middle" font-size="${isSelected ? '12' : '11'}" 
                font-weight="${isSelected ? '900' : (idx >= slotCount - 2 ? '800' : 'bold')}" 
                fill="${isSelected ? '#5b21b6' : (idx >= slotCount - 2 ? '#4338ca' : '#64748b')}" class="select-none">
            ${monthLabel}${isSelected ? '★' : ''}
          </text>
        </g>
      `;
    }

    const barHeight = bill > 0 ? Math.max(4, Math.round((bill / yCeiling) * plotHeight)) : 2;
    const barY = plotBottom - barHeight;
    const eokText = fmtCompactKrw(bill) || '-';

    return `
      <g class="chart-group cursor-pointer group" data-idx="${idx}" onclick="window.switchAnalyticsMonth('${mNum}')">
        <rect x="${Math.round(slotCenter - slotWidth / 2 + 2)}" y="${plotTop - 15}" width="${Math.round(slotWidth - 4)}" height="${plotHeight + 25}" fill="${isSelected ? '#eef2ff' : '#f8fafc'}" rx="8" class="${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity" pointer-events="none"></rect>

        <text x="${slotCenter}" y="${barY - 14}" text-anchor="middle" font-size="${isSelected ? '11.5' : '10.5'}" font-weight="900" fill="${isSelected ? '#4338ca' : '#1e1b4b'}" class="font-mono tracking-tight select-none">
          ${bill > 0 ? eokText : ''}
        </text>
        <text x="${slotCenter}" y="${barY - 3}" text-anchor="middle" font-size="9.5" font-weight="bold" fill="#059669" class="font-mono select-none">
          ${bill > 0 ? `${mgnRate}%` : ''}
        </text>

        <rect x="${barX}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="4" 
              fill="${isSelected ? 'url(#selectedBarGradient)' : 'url(#billingBarGradient)'}" 
              stroke="${isSelected ? '#f59e0b' : 'none'}" stroke-width="${isSelected ? '2.5' : '0'}"
              class="filter drop-shadow-xs transition-all duration-150 group-hover:brightness-110">
          <title>${m.month} 실적 (클릭 시 ${mNum}월 상세 조회)
• 매출액: ₩${Math.round(bill).toLocaleString()}
• 국내 마진: ₩${Math.round(mgn).toLocaleString()} (${mgnRate}%)
• 💎 커미션: $${cUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (≈₩${cKrw.toLocaleString()})
• 출하건수: ${billCount}건</title>
        </rect>

        <text x="${slotCenter}" y="${plotBottom + 18}" text-anchor="middle" font-size="${isSelected ? '12' : '11'}" 
              font-weight="${isSelected ? '900' : (idx >= slotCount - 2 ? '800' : 'bold')}" 
              fill="${isSelected ? '#4338ca' : (idx >= slotCount - 2 ? '#4338ca' : '#64748b')}" class="select-none">
          ${monthLabel}${isSelected ? '★' : ''}
        </text>
      </g>
    `;
  }).join('');

  // 하단 월별 정확한 수치 상세 테이블 HTML 생성 (월 클릭 시 필터 전환 연동)
  const monthlySummaryTableHtml = `
    <div class="overflow-x-auto border-t border-slate-100 mt-2 pt-2.5">
      <table class="w-full text-xs text-center border-collapse">
        <thead>
          <tr class="text-[11px] font-bold text-slate-500 bg-slate-50 border-y border-slate-200">
            <th class="py-1.5 px-3 text-left sticky left-0 bg-slate-50 z-10 shadow-xs">지표</th>
            ${monthly.map(m => {
              const isOtherYear = !m.month.startsWith(currentYear);
              const mLabel = isOtherYear ? `${m.month.slice(2, 4)}.${m.month.slice(5)}` : `${m.month.slice(5)}월`;
              const mNum = parseInt(m.month.slice(5), 10);
              const isSelected = isMonthly && (selectedMonthNum === mNum);
              return `
                <th class="py-1.5 px-2 font-mono whitespace-nowrap cursor-pointer transition-colors ${isSelected ? 'bg-indigo-100/80 text-indigo-900 font-black border-b-2 border-indigo-600' : 'text-slate-700 hover:bg-slate-100'}" 
                    onclick="window.switchAnalyticsMonth('${mNum}')" title="${mNum}월 상세 실적 보기">
                  ${mLabel}${isSelected ? '📍' : ''}
                </th>
              `;
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
              const mNum = parseInt(m.month.slice(5), 10);
              const isSelected = isMonthly && (selectedMonthNum === mNum);
              const eokStr = bill >= 100000000 ? `${(bill / 100000000).toFixed(1)}억` : `${Math.round(bill / 10000).toLocaleString()}만`;
              return `<td class="py-1.5 px-2 font-mono font-black ${isSelected ? 'bg-indigo-50/60 text-indigo-700 font-black' : 'text-indigo-950'} whitespace-nowrap" title="₩${Math.round(bill).toLocaleString()}">₩${eokStr}</td>`;
            }).join('')}
          </tr>
          <!-- 2. 매출이익 (Domestic 마진) -->
          <tr class="hover:bg-emerald-50/30 transition-colors">
            <td class="py-1.5 px-3 text-left font-bold text-emerald-900 sticky left-0 bg-white z-10 shadow-xs flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-emerald-500 inline-block shrink-0"></span>
              <span>국내마진</span>
            </td>
            ${monthly.map(m => {
              const mgn = m.margin || 0;
              const mNum = parseInt(m.month.slice(5), 10);
              const isSelected = isMonthly && (selectedMonthNum === mNum);
              const eokStr = mgn >= 100000000 ? `${(mgn / 100000000).toFixed(1)}억` : `${Math.round(mgn / 10000).toLocaleString()}만`;
              return `<td class="py-1.5 px-2 font-mono font-bold ${isSelected ? 'bg-indigo-50/60 text-emerald-900' : 'text-emerald-800'} whitespace-nowrap" title="Domestic 마진: ₩${Math.round(mgn).toLocaleString()}">₩${eokStr}</td>`;
            }).join('')}
          </tr>
          <!-- 2-2. 💎 커미션 (원화환산) -->
          <tr class="hover:bg-violet-50/40 transition-colors">
            <td class="py-1.5 px-3 text-left font-bold text-violet-800 sticky left-0 bg-white z-10 shadow-xs flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-violet-500 inline-block shrink-0"></span>
              <span>💎 커미션</span>
            </td>
            ${monthly.map(m => {
              const cm = commMonthlyMap[m.month];
              const cUsd = cm ? (Number(cm.comm_amt) || 0) : 0;
              const cKrw = Math.round(cUsd * fxRate);
              const mNum = parseInt(m.month.slice(5), 10);
              const isSelected = isMonthly && (selectedMonthNum === mNum);
              const eokStr = cKrw === 0 ? '-' : (cKrw >= 100000000 ? `₩${(cKrw / 100000000).toFixed(1)}억` : `₩${Math.round(cKrw / 10000).toLocaleString()}만`);
              return `<td class="py-1.5 px-2 font-mono font-bold ${isSelected ? 'bg-indigo-50/60 text-violet-900' : 'text-violet-700'} whitespace-nowrap" title="Commission: $${cUsd.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} (≈₩${cKrw.toLocaleString()} / @${fxRate.toLocaleString()})">${eokStr}</td>`;
            }).join('')}
          </tr>
          <!-- 2-3. 🏆 통합 총수익 (국내마진 + 커미션) -->
          <tr class="bg-gradient-to-r from-emerald-50/50 via-violet-50/40 to-emerald-50/50 hover:bg-violet-50/60 transition-colors">
            <td class="py-1.5 px-3 text-left font-black text-slate-900 sticky left-0 bg-violet-50/90 z-10 shadow-xs flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-gradient-to-r from-emerald-500 to-violet-600 inline-block shrink-0"></span>
              <span>🏆 총수익</span>
            </td>
            ${monthly.map(m => {
              const mgn = m.margin || 0;
              const cm = commMonthlyMap[m.month];
              const cUsd = cm ? (Number(cm.comm_amt) || 0) : 0;
              const tot = mgn + Math.round(cUsd * fxRate);
              const mNum = parseInt(m.month.slice(5), 10);
              const isSelected = isMonthly && (selectedMonthNum === mNum);
              const eokStr = tot >= 100000000 ? `${(tot / 100000000).toFixed(1)}억` : `${Math.round(tot / 10000).toLocaleString()}만`;
              return `<td class="py-1.5 px-2 font-mono font-black ${isSelected ? 'bg-indigo-100/70 text-violet-950' : 'text-slate-900'} whitespace-nowrap" title="통합 총수익: ₩${Math.round(tot).toLocaleString()} (마진 ₩${Math.round(mgn).toLocaleString()} + 커미션 $${cUsd.toLocaleString()})">₩${eokStr}</td>`;
            }).join('')}
          </tr>
          <!-- 3. 실현 마진율 -->
          <tr class="hover:bg-slate-50/50 transition-colors">
            <td class="py-1.5 px-3 text-left font-bold text-slate-700 sticky left-0 bg-white z-10 shadow-xs flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-teal-500 inline-block shrink-0"></span>
              <span>마진율</span>
            </td>
            ${monthly.map(m => {
              const mNum = parseInt(m.month.slice(5), 10);
              const isSelected = isMonthly && (selectedMonthNum === mNum);
              return `
                <td class="py-1.5 px-2 whitespace-nowrap ${isSelected ? 'bg-indigo-50/60' : ''}">
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${isSelected ? 'bg-indigo-100 text-indigo-900 border border-indigo-300' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}">${m.margin_rate || 0}%</span>
                </td>
              `;
            }).join('')}
          </tr>
          <!-- 4. 출하 건수 -->
          <tr class="hover:bg-slate-50/50 transition-colors">
            <td class="py-1.5 px-3 text-left font-medium text-slate-500 sticky left-0 bg-white z-10 shadow-xs flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-slate-400 inline-block shrink-0"></span>
              <span>출하건수</span>
            </td>
            ${monthly.map(m => {
              const mNum = parseInt(m.month.slice(5), 10);
              const isSelected = isMonthly && (selectedMonthNum === mNum);
              return `<td class="py-1.5 px-2 font-mono text-slate-500 text-[10px] whitespace-nowrap ${isSelected ? 'bg-indigo-50/60 font-bold text-indigo-900' : ''}">${m.bill_count || 0}건</td>`;
            }).join('')}
          </tr>
        </tbody>
      </table>
    </div>
  `;

  // 상단 4단 KPI 카드 구성 (월별 모드 vs 연간 누적 모드 분기)
  const kpiCardsHtml = isMonthly ? `
    <!-- [월별 모드] 4단 KPI 카드 -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
      <!-- 1) 선택 월 매출 실적 -->
      <div class="bg-white p-3 sm:p-4 rounded-xl border border-indigo-300 bg-indigo-50/30 shadow-sm relative overflow-hidden flex flex-col justify-between">
        <div class="text-[10px] sm:text-[11px] font-bold text-indigo-900 flex items-center justify-between">
          <span class="truncate">${selectedMonthNum}월 매출 실적</span>
          <span class="text-indigo-700 font-black text-[9px] sm:text-xs shrink-0 bg-indigo-100 px-1.5 py-0.2 rounded">📅 ${selectedMonthNum}월</span>
        </div>
        <div class="text-sm sm:text-xl font-black text-indigo-950 mt-1 font-mono truncate">
          ₩${Math.round(periodBilling).toLocaleString()}
        </div>
        <div class="text-[9px] sm:text-[10px] text-indigo-700 mt-0.5 truncate">
          출하 확정: <strong class="text-indigo-950">${periodShipmentCount.toLocaleString()}건</strong>
        </div>
      </div>

      <!-- 2) 선택 월 통합 총수익 (국내 마진 + 💎 커미션) -->
      <div class="bg-white p-3 sm:p-4 rounded-xl border border-violet-300 bg-gradient-to-br from-emerald-50/40 via-white to-violet-50/40 shadow-sm relative overflow-hidden flex flex-col justify-between">
        <div class="text-[10px] sm:text-[11px] font-bold text-emerald-950 flex items-center justify-between gap-1">
          <span class="truncate">🏆 ${selectedMonthNum}월 총수익 (마진+커미션)</span>
          <span class="text-emerald-700 font-black text-[9px] sm:text-xs shrink-0 bg-emerald-100 px-1.5 py-0.2 rounded">${periodMarginRate}%</span>
        </div>
        <div class="text-sm sm:text-xl font-black text-slate-900 mt-1 font-mono truncate" title="국내마진 ₩${Math.round(periodMargin).toLocaleString()} + 커미션 $${periodCommUsd.toLocaleString()} (≈₩${periodCommKrw.toLocaleString()})">
          ₩${Math.round(periodTotalProfitKrw).toLocaleString()}
        </div>
        <div class="text-[9px] sm:text-[10px] text-slate-600 mt-0.5 flex flex-wrap items-center gap-x-1.5 leading-tight">
          <span>마진 <strong class="text-emerald-700">₩${Math.round(periodMargin).toLocaleString()}</strong></span>
          <span class="text-slate-300">+</span>
          <span class="text-violet-700 font-bold">💎 $${periodCommUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} <span class="font-normal opacity-80">(정산 ${periodCommPaidPct}%)</span></span>
        </div>
      </div>

      <!-- 3) 선택 월 신규 수주 (Booking) -->
      <div class="bg-white p-3 sm:p-4 rounded-xl border border-amber-300 bg-amber-50/20 shadow-sm relative overflow-hidden flex flex-col justify-between">
        <div class="text-[10px] sm:text-[11px] font-bold text-amber-900 flex items-center justify-between">
          <span class="truncate">${selectedMonthNum}월 수주액</span>
          <span class="text-amber-700 font-bold text-[9px] sm:text-xs shrink-0 bg-amber-100 px-1.5 py-0.2 rounded">🛒 PO</span>
        </div>
        <div class="text-sm sm:text-xl font-black text-amber-950 mt-1 font-mono truncate">
          ₩${Math.round(periodBooking).toLocaleString()}
        </div>
        <div class="text-[9px] sm:text-[10px] text-amber-700 mt-0.5 truncate">
          수주 등록 진행
        </div>
      </div>

      <!-- 4) 연간 누적 매출 비교 -->
      <div class="bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden flex flex-col justify-between">
        <div class="text-[10px] sm:text-[11px] font-bold text-slate-500 flex items-center justify-between">
          <span class="truncate">${currentYear}년 연간 누적 매출</span>
          <span class="text-slate-500 font-mono text-[9px] sm:text-xs shrink-0">📈 YTD 비교</span>
        </div>
        <div class="text-sm sm:text-xl font-black text-slate-800 mt-1 font-mono truncate">
          ₩${Math.round(billingYtd).toLocaleString()}
        </div>
        <div class="text-[9px] sm:text-[10px] text-slate-500 mt-0.5 truncate">
          연간 누적 마진: <strong class="text-slate-700">${marginRate}% (₩${Math.round(marginYtd / 100000000).toFixed(1)}억)</strong>
        </div>
      </div>
    </div>
  ` : `
    <!-- [연간 누적 모드 (YTD)] 4단 KPI 카드 -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
      <!-- 1) 연간 누적 매출액 -->
      <div class="bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden flex flex-col justify-between">
        <div class="text-[10px] sm:text-[11px] font-bold text-slate-500 flex items-center justify-between">
          <span class="truncate">${currentYear}년 연간 누적 매출</span>
          <span class="text-indigo-600 font-mono text-[9px] sm:text-xs shrink-0 font-bold">📈 YTD 전체</span>
        </div>
        <div class="text-sm sm:text-xl font-black text-slate-900 mt-1 font-mono truncate">
          ₩${Math.round(billingYtd).toLocaleString()}
        </div>
        <div class="text-[9px] sm:text-[10px] text-slate-400 mt-0.5 truncate">
          출하: <strong class="text-slate-700">${monthly.reduce((acc, m) => acc + (m.bill_count || 0), 0).toLocaleString()}건</strong>
        </div>
      </div>

      <!-- 2) 연간 누적 통합 총수익 (국내 마진 + 💎 커미션) -->
      <div class="bg-white p-3 sm:p-4 rounded-xl border border-violet-300 bg-gradient-to-br from-emerald-50/40 via-white to-violet-50/40 shadow-sm relative overflow-hidden flex flex-col justify-between">
        <div class="text-[10px] sm:text-[11px] font-bold text-emerald-950 flex items-center justify-between gap-1">
          <span class="truncate">🏆 ${currentYear}년 총수익 (마진+커미션)</span>
          <span class="text-emerald-700 font-black text-[9px] sm:text-xs shrink-0 bg-emerald-100 px-1.5 py-0.2 rounded">${marginRate}%</span>
        </div>
        <div class="text-sm sm:text-xl font-black text-slate-900 mt-1 font-mono truncate" title="국내마진 ₩${Math.round(marginYtd).toLocaleString()} + 커미션 $${periodCommUsd.toLocaleString()} (≈₩${periodCommKrw.toLocaleString()})">
          ₩${Math.round(periodTotalProfitKrw).toLocaleString()}
        </div>
        <div class="text-[9px] sm:text-[10px] text-slate-600 mt-0.5 flex flex-wrap items-center gap-x-1.5 leading-tight">
          <span>마진 <strong class="text-emerald-700">₩${(marginYtd / 100000000).toFixed(2)}억</strong></span>
          <span class="text-slate-300">+</span>
          <span class="text-violet-700 font-bold">💎 $${Math.round(periodCommUsd).toLocaleString()} <span class="font-normal opacity-80">(₩${(periodCommKrw / 100000000).toFixed(2)}억 · 미입금 $${Math.round(periodCommUnpaidUsd).toLocaleString()})</span></span>
        </div>
      </div>

      <!-- 3) 연간 누적 수주액 (Booking) -->
      <div class="bg-white p-3 sm:p-4 rounded-xl border border-amber-200 bg-amber-50/20 shadow-sm relative overflow-hidden flex flex-col justify-between">
        <div class="text-[10px] sm:text-[11px] font-bold text-amber-800 flex items-center justify-between">
          <span class="truncate">${currentYear}년 연간 누적 수주</span>
          <span class="text-amber-600 font-bold text-[9px] sm:text-xs shrink-0">🛒 PO</span>
        </div>
        <div class="text-sm sm:text-xl font-black text-amber-950 mt-1 font-mono truncate">
          ₩${Math.round(bookingYtd).toLocaleString()}
        </div>
        <div class="text-[9px] sm:text-[10px] text-amber-700 mt-0.5 truncate">
          수주: <strong class="text-amber-900">${monthly.reduce((acc, m) => acc + (m.book_count || 0), 0).toLocaleString()}건</strong>
        </div>
      </div>

      <!-- 4) 당월 매출액 (최근 월) -->
      <div class="bg-white p-3 sm:p-4 rounded-xl border border-indigo-200 bg-indigo-50/30 shadow-sm relative overflow-hidden flex flex-col justify-between cursor-pointer hover:border-indigo-400 transition-colors"
           onclick="window.switchAnalyticsMonth('${latestMonthNum}')" title="클릭하여 ${latestMonthNum}월 당월 상세 보기">
        <div class="text-[10px] sm:text-[11px] font-bold text-indigo-800 flex items-center justify-between">
          <span class="truncate">최근 당월 매출 (${latestMonthNum}월)</span>
          <span class="text-indigo-600 font-bold text-[9px] sm:text-xs shrink-0 bg-indigo-100 px-1 rounded">📅 당월 바로가기 👉</span>
        </div>
        <div class="text-sm sm:text-xl font-black text-indigo-950 mt-1 font-mono truncate">
          ₩${Math.round(currentMonthBill).toLocaleString()}
        </div>
        <div class="text-[9px] sm:text-[10px] text-indigo-700 mt-0.5 truncate">
          진행: <strong class="text-indigo-900">${(latestMonthItem.bill_count || 0)}건 출하</strong>
        </div>
      </div>
    </div>
  `;

  container.innerHTML = `
    <div class="space-y-4">
      
      <!-- 1. 최상단 헤더 바 (기준 연도 + 조회 기간 필터) -->
      <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-3.5 sm:p-5 rounded-2xl shadow-sm border border-slate-700/60 flex flex-wrap items-center justify-between gap-2.5">
        <div class="flex items-center gap-2.5 sm:gap-3">
          <div class="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-indigo-600/30 border border-indigo-400/40 flex items-center justify-center text-lg sm:text-xl shrink-0">
            📊
          </div>
          <div>
            <div class="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <h2 class="text-sm sm:text-lg font-black tracking-wide text-white break-keep">매출 장부 & 실적 분석 (Book & Bill)</h2>
              ${isMonthly ? `
                <span class="text-[10px] sm:text-xs font-black bg-indigo-500 text-white border border-indigo-300/40 px-2 py-0.5 rounded-full shrink-0 shadow-xs flex items-center gap-1">
                  <span>📅</span> ${selectedMonthNum}월 당월 보기
                </span>
              ` : `
                <span class="text-[10px] sm:text-xs font-black bg-emerald-500 text-white border border-emerald-300/40 px-2 py-0.5 rounded-full shrink-0 shadow-xs flex items-center gap-1">
                  <span>📈</span> ${currentYear}년 연간 누적 (YTD)
                </span>
              `}
            </div>
            <p class="text-[10px] sm:text-xs text-slate-300 font-medium mt-0.5">FrmSalesBKBL & FrmSalesGraph 기반 실시간 출하 실적 및 마진 분석</p>
          </div>
        </div>

        <!-- 우측 필터 컨트롤 바 (기준 연도 & 조회 기간 드롭다운) -->
        <div class="flex items-center gap-2 text-xs w-full sm:w-auto justify-end pt-1 sm:pt-0 border-t sm:border-t-0 border-slate-800 flex-wrap">
          
          <!-- 1) 기준 연도 선택 -->
          <div class="flex items-center gap-1 shrink-0">
            <span class="text-slate-300 font-bold text-[11px] sm:text-xs">연도:</span>
            <select id="analyticsYearSelect" onchange="window.switchAnalyticsYear(this.value)" 
                    class="bg-slate-800 text-amber-300 border border-slate-600 rounded-lg px-2 sm:px-2.5 py-1 sm:py-1.5 font-bold outline-none cursor-pointer text-xs">
              <option value="2026" ${currentYear === '2026' ? 'selected' : ''}>2026년</option>
              <option value="2025" ${currentYear === '2025' ? 'selected' : ''}>2025년</option>
              <option value="2024" ${currentYear === '2024' ? 'selected' : ''}>2024년</option>
            </select>
          </div>

          <!-- 2) 조회 기간 (특정 월 / 연간 누적) 선택 드롭다운 -->
          <div class="flex items-center gap-1 shrink-0">
            <span class="text-slate-300 font-bold text-[11px] sm:text-xs">기간:</span>
            <select id="analyticsMonthSelect" onchange="window.switchAnalyticsMonth(this.value)" 
                    class="bg-slate-800 text-amber-300 border border-indigo-500/60 rounded-lg px-2 sm:px-2.5 py-1 sm:py-1.5 font-bold outline-none cursor-pointer text-xs shadow-xs">
              <option value="all" ${currentMonth === 'all' ? 'selected' : ''}>전체 (연간 누적)</option>
              ${availableMonths.map(mo => {
                const isCurrent = mo === latestMonthNum;
                return `<option value="${mo}" ${String(currentMonth) === String(mo) ? 'selected' : ''}>${mo}월 ${isCurrent ? '(당월)' : ''}</option>`;
              }).join('')}
            </select>
          </div>

          <!-- 3) 새로고침 버튼 -->
          <button type="button" onclick="window.refreshSalesAnalytics()" 
                  class="px-2.5 sm:px-3 py-1 sm:py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg shadow-sm transition-colors flex items-center gap-1 cursor-pointer text-xs shrink-0">
            🔄
          </button>
        </div>
      </div>

      <!-- 2. 핵심 KPI 4단 카드 -->
      ${kpiCardsHtml}

      <!-- 3. 월별 통합 총수익(마진+커미션) / 매출 추이 차트 -->
      <div class="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-sm space-y-2.5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            <h3 class="font-bold text-xs sm:text-sm text-slate-900 flex items-center gap-1.5">
              <span>${isProfitChart ? '🏆' : '📈'}</span>
              <span>${isProfitChart ? '월별 통합 총수익 추이 (국내마진 + 💎 커미션)' : '월별 매출 실적 (Billing) 및 마진율 추이'}</span>
            </h3>
            <!-- 차트 모드 스위처 (총수익 스택 vs 매출액) -->
            <div class="inline-flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-[10px] font-bold">
              <button type="button" onclick="window.switchAnalyticsChartMode('profit')" class="px-2 py-0.5 rounded-md transition cursor-pointer ${isProfitChart ? 'bg-violet-600 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'}">🏆 마진+커미션</button>
              <button type="button" onclick="window.switchAnalyticsChartMode('billing')" class="px-2 py-0.5 rounded-md transition cursor-pointer ${!isProfitChart ? 'bg-indigo-600 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'}">📊 매출(Billing)</button>
            </div>
            ${isMonthly ? `
              <span class="text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full font-bold cursor-pointer hover:bg-indigo-100" 
                    onclick="window.switchAnalyticsMonth('all')" title="클릭하여 전체 연간 누적 보기로 복귀">
                📍 ${selectedMonthNum}월 선택됨 (전체 복귀 ↩)
              </span>
            ` : `
              <span class="text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full font-medium">
                💡 막대 클릭 시 해당 월 상세 전환
              </span>
            `}
          </div>
          <!-- 범례 -->
          <div class="flex items-center gap-3 sm:gap-4 text-[11px] sm:text-xs font-bold">
            ${isProfitChart ? `
              <span class="flex items-center gap-1 text-emerald-800">
                <span class="w-3 h-3 rounded bg-gradient-to-b from-emerald-400 to-emerald-600 shadow-xs inline-block"></span>
                국내마진
              </span>
              <span class="flex items-center gap-1 text-violet-800">
                <span class="w-3 h-3 rounded bg-gradient-to-b from-violet-400 to-violet-600 shadow-xs inline-block"></span>
                💎 커미션(원화환산)
              </span>
            ` : `
              <span class="flex items-center gap-1 text-indigo-900">
                <span class="w-3 h-3 rounded bg-gradient-to-b from-indigo-500 to-indigo-700 shadow-xs inline-block"></span>
                매출액
              </span>
              <span class="flex items-center gap-1 text-emerald-700">
                <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
                마진율 (%)
              </span>
            `}
          </div>
        </div>

        <!-- 모바일 가로 스와이프 안내 힌트 -->
        <div class="sm:hidden flex items-center justify-center gap-1.5 text-[10px] text-indigo-700 bg-indigo-50/80 border border-indigo-200/60 py-1 px-2.5 rounded-lg font-bold">
          <span class="animate-pulse">👈</span> 좌우로 밀어서 1월~11월 전체 실적 확인 <span class="animate-pulse">👉</span>
        </div>

        <div class="w-full overflow-x-auto pt-1 scroll-smooth" style="-webkit-overflow-scrolling: touch;">
          <svg viewBox="0 0 ${chartWidth} ${chartHeight}" class="w-full max-w-5xl mx-auto h-52 sm:h-60 select-none min-w-[680px]">
            <defs>
              <linearGradient id="billingBarGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#6366f1" />
                <stop offset="100%" stop-color="#4338ca" />
              </linearGradient>
              <linearGradient id="selectedBarGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#4f46e5" />
                <stop offset="100%" stop-color="#312e81" />
              </linearGradient>
              <linearGradient id="marginBarGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#34d399" />
                <stop offset="100%" stop-color="#059669" />
              </linearGradient>
              <linearGradient id="commBarGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#a78bfa" />
                <stop offset="100%" stop-color="#6d28d9" />
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
            <span class="text-[10px] ${isMonthly ? 'text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.2 rounded font-bold' : 'text-slate-400 font-medium'}">
              ${isMonthly ? `${selectedMonthNum}월 매출 순` : '연간 매출 기여도 순'}
            </span>
          </div>

          <div class="space-y-2 overflow-y-auto max-h-80 pr-1 text-xs">
            ${(a.top_customers && a.top_customers.length > 0) ? a.top_customers.map((c, idx) => {
              const pct = baseBilling > 0 ? ((c.billing / baseBilling) * 100).toFixed(1) : 0;
              const safeCust = String(c.customer_name || '').replace(/'/g, "\\'");
              return `
                <div class="space-y-0.5 p-1 -mx-1 rounded-lg hover:bg-indigo-50/60 cursor-pointer transition-colors" onclick="window.openCustomer360Modal && window.openCustomer360Modal('${safeCust}')" title="클릭하여 [${c.customer_name}] 360° 통합 브리핑 팝업 보기">
                  <div class="flex items-center justify-between text-[11px]">
                    <span class="font-bold text-slate-800 truncate max-w-[150px] flex items-center gap-1">
                      <span class="text-indigo-600 font-mono font-black">${idx + 1}.</span>
                      <span class="truncate">${c.customer_name}</span>
                      <span class="text-[9px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-1 rounded shrink-0">360°</span>
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
            }).join('') : `
              <div class="text-slate-400 text-center py-8 font-medium">선택된 기간의 출하 고객사 데이터가 없습니다.</div>
            `}
          </div>
        </div>

        <!-- 2) Top 제조사 (Maker) 점유율 -->
        <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col space-y-3">
          <div class="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 class="font-bold text-xs text-slate-900 flex items-center gap-1.5">
              <span>🏭</span> 제조사 (Maker) 점유율
            </h3>
            <span class="text-[10px] ${isMonthly ? 'text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded font-bold' : 'text-slate-400 font-medium'}">
              ${isMonthly ? `${selectedMonthNum}월 라인별 비중` : '연간 라인별 비중'}
            </span>
          </div>

          <div class="space-y-2 overflow-y-auto max-h-80 pr-1 text-xs">
            ${mergedMakers.length > 0 ? mergedMakers.map((m) => {
              const pct = baseBilling > 0 ? ((m.billing / baseBilling) * 100).toFixed(1) : '0.0';
              const cUsd = m.comm_usd || 0;
              const cKrw = Math.round(cUsd * fxRate);
              const isCommOnly = m.billing <= 0 && cUsd > 0;
              const safeMfg = String(m.maker || '').replace(/'/g, "\\'");
              return `
                <div class="space-y-0.5 p-1 -mx-1 rounded-lg hover:bg-emerald-50/60 cursor-pointer transition-colors" onclick="window.jumpToShipmentsFiltered && window.jumpToShipmentsFiltered({ mfg: '${safeMfg}', bizType: '${isCommOnly ? 'COMMISSION' : ''}', year: '${currentYear}' })" title="클릭하여 [${m.maker}] 출하 원장 바로 보기">
                  <div class="flex items-center justify-between text-[11px] gap-1">
                    <span class="font-bold text-slate-800 flex items-center gap-1 min-w-0">
                      <span class="px-1.5 py-0.2 rounded text-[9px] font-black ${isCommOnly ? 'bg-violet-100 text-violet-800 border border-violet-200' : 'bg-indigo-50 text-indigo-800 border border-indigo-200'} shrink-0">${m.maker}</span>
                      <span class="text-slate-400 text-[10px] font-normal shrink-0">(${isCommOnly ? `Comm ${m.comm_count}건` : `${m.item_count}건`})</span>
                      ${cUsd > 0 ? `<span class="px-1 py-0.2 rounded text-[9px] font-bold bg-violet-100 text-violet-800 border border-violet-200 truncate" title="Commission: $${cUsd.toLocaleString()} (≈₩${cKrw.toLocaleString()}) / 미입금 $${Math.round(m.comm_unpaid_usd || 0).toLocaleString()}">💎 +$${Math.round(cUsd).toLocaleString()}</span>` : ''}
                    </span>
                    <span class="font-mono font-bold ${isCommOnly ? 'text-violet-800' : 'text-slate-900'} shrink-0">${isCommOnly ? `₩${cKrw.toLocaleString()}` : `₩${Math.round(m.billing).toLocaleString()}`}</span>
                  </div>
                  <div class="flex items-center gap-2 text-[10px] text-slate-400">
                    <div class="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                      <div class="${isCommOnly ? 'bg-violet-500' : 'bg-emerald-500'} h-full rounded-full" style="width: ${isCommOnly ? '100' : Math.min(Number(pct) * 2.5, 100)}%"></div>
                    </div>
                    <span class="shrink-0 font-mono text-[9px] font-bold ${isCommOnly ? 'text-violet-700' : 'text-emerald-800'}">${isCommOnly ? 'COMM' : `${pct}%`}</span>
                  </div>
                </div>
              `;
            }).join('') : `
              <div class="text-slate-400 text-center py-8 font-medium">선택된 기간의 출하 제조사 데이터가 없습니다.</div>
            `}
          </div>
        </div>

        <!-- 3) 영업 담당자별 통합 실적 (마진 + 💎 커미션) -->
        <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col space-y-3">
          <div class="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 class="font-bold text-xs text-slate-900 flex items-center gap-1.5">
              <span>👤</span> 영업 담당자별 마진 + 💎 커미션
            </h3>
            <span class="text-[10px] ${isMonthly ? 'text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded font-bold' : 'text-violet-700 bg-violet-50 border border-violet-200 px-1.5 py-0.2 rounded font-bold'}">
              🏆 통합 총수익 순
            </span>
          </div>

          <div class="space-y-2.5 overflow-y-auto max-h-80 pr-1 text-xs">
            ${mergedSalesReps.length > 0 ? mergedSalesReps.map(s => {
              const hasComm = s.comm_usd > 0;
              const safeRep = String(s.sales_rep || '').replace(/'/g, "\\'");
              return `
                <div class="bg-slate-50 hover:bg-violet-50/60 p-2.5 rounded-lg border ${hasComm ? 'border-violet-200/80' : 'border-slate-200'} space-y-1 cursor-pointer transition-all hover:shadow-xs group" onclick="window.openSalesRepPortfolioModal && window.openSalesRepPortfolioModal('${safeRep}')" title="클릭하여 [${s.sales_rep}] 개인별 비즈니스 내역 및 재고 현황 상세 팝업 보기">
                  <div class="flex items-center justify-between gap-2">
                    <span class="font-black text-indigo-950 flex items-center gap-1">
                      <span class="w-2 h-2 rounded-full ${hasComm ? 'bg-violet-600' : 'bg-indigo-600'}"></span>
                      ${s.sales_rep}
                      <span class="text-[9px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-1 py-0.2 rounded opacity-80 group-hover:opacity-100">상세 팝업 ↗</span>
                    </span>
                    <span class="font-black font-mono text-slate-900 text-xs" title="통합 총수익 = 국내마진 ₩${Math.round(s.margin).toLocaleString()} + 커미션 ₩${s.comm_krw.toLocaleString()}">
                      🏆 ₩${Math.round(s.total_profit).toLocaleString()}
                    </span>
                  </div>
                  <div class="flex items-center justify-between text-[10px] text-slate-500">
                    <span>국내마진: <strong class="text-emerald-700">₩${Math.round(s.margin).toLocaleString()}</strong> <span class="text-[9px]">(${s.margin_rate}%)</span></span>
                    <span class="font-mono text-slate-500">매출 ₩${Math.round(s.billing / 10000).toLocaleString()}만 · ${s.shipment_count}건</span>
                  </div>
                  ${hasComm ? `
                    <div class="flex items-center justify-between text-[10px] pt-1 border-t border-violet-100">
                      <span class="text-violet-700 font-bold">💎 커미션: $${s.comm_usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span class="font-normal text-violet-500">(≈₩${s.comm_krw.toLocaleString()})</span></span>
                      <span class="text-[9px] font-bold text-violet-600">${s.comm_count}건</span>
                    </div>
                  ` : ''}
                </div>
              `;
            }).join('') : `
              <div class="text-slate-400 text-center py-8 font-medium">선택된 기간의 영업사원 실적 데이터가 없습니다.</div>
            `}
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
              ${Array.from(new Set(['STEVE', 'KELLY', 'WILLIAM', 'ALLEN', 'DUSTIN', 'ERIC', 'JOEY', ...mergedSalesReps.map(s => s.sales_rep)].filter(Boolean))).map(rep => `<option value="${rep}">${rep}</option>`).join('')}
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
              ${Array.from(new Set(['STEVE', 'KELLY', 'WILLIAM', 'ALLEN', 'DUSTIN', 'ERIC', 'JOEY', ...mergedSalesReps.map(s => s.sales_rep)].filter(Boolean))).map(rep => `<option value="${rep}">${rep}</option>`).join('')}
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

  // 메모 자동 로드 (인라인 onchange 중복 호출 방지를 위해 중복 addEventListener 제거)
  loadSalesMemos('ALL');
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

  container.innerHTML = memos.map((m, idx) => {
    const isCloud = m.source === 'CLOUD' || String(m.id || '').startsWith('CLOUD-');
    const safeId = String(m.id || '').replace(/'/g, "\\'");
    return `
      <div class="bg-slate-50/80 hover:bg-indigo-50/40 p-2.5 rounded-lg border border-slate-200 transition-colors space-y-1">
        <div class="flex items-center justify-between text-[11px]">
          <span class="font-bold text-slate-800 flex items-center gap-1.5">
            <span class="px-1.5 py-0.2 rounded text-[9px] font-black bg-indigo-100 text-indigo-700">${m.sales_rep}</span>
            ${isCloud ? '<span class="px-1 py-0.2 rounded text-[8px] font-black bg-emerald-100 text-emerald-700">WEB</span>' : ''}
            <span class="font-mono text-slate-400 text-[10px]">${m.input_date}</span>
          </span>
          ${isCloud ? `
            <div class="flex items-center gap-1">
              <button type="button" onclick="window.editCloudSalesMemo && window.editCloudSalesMemo('${safeId}', ${idx})" class="px-1.5 py-0.5 text-[10px] font-bold bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded cursor-pointer" title="메모 수정">✏️</button>
              <button type="button" onclick="window.deleteCloudSalesMemo && window.deleteCloudSalesMemo('${safeId}')" class="px-1.5 py-0.5 text-[10px] font-bold bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded cursor-pointer" title="메모 삭제">🗑️</button>
            </div>
          ` : ''}
        </div>
        <div class="text-slate-700 whitespace-pre-wrap leading-relaxed text-[11px] font-normal pl-0.5">
          ${m.memo}
        </div>
      </div>
    `;
  }).join('');
}

window.editCloudSalesMemo = async function(memoId) {
  const target = allMemos.find(m => String(m.id) === String(memoId));
  if (!target) return;
  const updatedText = prompt(`[${target.sales_rep} / ${target.input_date}] 영업 활동 메모 수정:`, target.memo || '');
  if (updatedText === null || !updatedText.trim()) return;

  try {
    const res = await fetch(`/api/sales/memos/${encodeURIComponent(memoId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sales_rep: target.sales_rep, memo: updatedText.trim(), input_date: target.input_date })
    });
    const data = await res.json();
    if (!res.ok || data.status !== 'success') throw new Error(data.detail || '수정 실패');
    const currentRep = document.getElementById('memoSalesFilter')?.value || 'ALL';
    await loadSalesMemos(currentRep);
  } catch (err) {
    alert('메모 수정 오류: ' + err.message);
  }
};

window.deleteCloudSalesMemo = async function(memoId) {
  if (!confirm('이 영업 활동 메모를 삭제하시겠습니까?')) return;
  try {
    const res = await fetch(`/api/sales/memos/${encodeURIComponent(memoId)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || data.status !== 'success') throw new Error(data.detail || '삭제 실패');
    const currentRep = document.getElementById('memoSalesFilter')?.value || 'ALL';
    await loadSalesMemos(currentRep);
  } catch (err) {
    alert('메모 삭제 오류: ' + err.message);
  }
};

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
      const newEntry = data.memo || { sales_rep: rep, memo: text, input_date: date, update_date: date, source: 'CLOUD' };
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
  currentYear = String(year);
  fetchSalesAnalytics(currentYear, currentMonth).then(() => {
    renderAnalyticsView('analyticsSection');
  });
};

window.switchAnalyticsMonth = function(month) {
  currentMonth = String(month);
  fetchSalesAnalytics(currentYear, currentMonth).then(() => {
    renderAnalyticsView('analyticsSection');
  });
};

window.refreshSalesAnalytics = function() {
  const yrSelect = document.getElementById('analyticsYearSelect');
  const moSelect = document.getElementById('analyticsMonthSelect');
  if (yrSelect) currentYear = yrSelect.value;
  if (moSelect) currentMonth = moSelect.value;
  fetchSalesAnalytics(currentYear, currentMonth).then(() => {
    renderAnalyticsView('analyticsSection');
  });
};

// ========================================================
// 👤 영업 담당자별 비즈니스 내역 & 보유 재고 종합 포트폴리오 팝업 모달
// ========================================================
let repModalState = {
  rep: '',
  tab: 'biz',       // 'biz' | 'stock' | 'customers'
  bizFilter: 'ALL', // 'ALL' | 'DOMESTIC' | 'COMMISSION'
  search: '',
  domesticSales: [],
  commShipments: [],
  unpaidDom: [],
  loading: false
};

window.openSalesRepPortfolioModal = async function(salesRep) {
  const rep = toEnglishSalesName(salesRep || '') || 'BSK';
  repModalState = { rep, tab: 'biz', bizFilter: 'ALL', search: '', domesticSales: [], commShipments: [], unpaidDom: [], loading: true };

  let modal = document.getElementById('salesRepPortfolioModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'salesRepPortfolioModal';
    modal.className = 'fixed inset-0 bg-slate-900/70 backdrop-blur-xs z-[99994] flex items-center justify-center p-2 sm:p-4 overflow-hidden';
    modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
    document.body.appendChild(modal);
  }
  modal.classList.remove('hidden');
  renderSalesRepPortfolioModal();

  const isMonthly = currentMonth !== 'all';
  const moPad = isMonthly ? String(parseInt(currentMonth, 10)).padStart(2, '0') : '01';
  const startDate = isMonthly ? `${currentYear}-${moPad}-01` : `${currentYear}-01-01`;
  const endDate = isMonthly ? `${currentYear}-${moPad}-31` : `${currentYear}-12-31`;

  try {
    const [detailRes, unpaidRes] = await Promise.all([
      fetch(`/api/analytics/rep-detail?sales_rep=${encodeURIComponent(rep)}&start_date=${startDate}&end_date=${endDate}&limit=600`).then(r => r.json()).catch(() => ({})),
      fetch(`/api/unpaid?sales_rep=${encodeURIComponent(rep)}&limit=500`).then(r => r.json()).catch(() => ({ items: [] }))
    ]);
    repModalState.domesticSales = Array.isArray(detailRes.domestic_sales) ? detailRes.domestic_sales : [];
    repModalState.commShipments = Array.isArray(detailRes.commission_shipments) ? detailRes.commission_shipments : [];
    const rawUnpaid = Array.isArray(unpaidRes.items) ? unpaidRes.items : (Array.isArray(unpaidRes.data) ? unpaidRes.data : []);
    repModalState.unpaidDom = rawUnpaid.filter(u => toEnglishSalesName(u.sales_rep || u.sales || '') === rep && u.pay_status !== '수금완료');
  } catch (e) {
    console.warn('담당자 포트폴리오 상세 로드 예외:', e);
  } finally {
    repModalState.loading = false;
    renderSalesRepPortfolioModal();
  }
};

window.switchSalesRepModalTab = function(tab) {
  repModalState.tab = tab;
  renderSalesRepPortfolioModal();
};

window.setSalesRepBizFilter = function(f) {
  repModalState.bizFilter = f;
  renderSalesRepPortfolioModal();
};

window.setSalesRepModalSearch = function(val) {
  repModalState.search = val || '';
  renderSalesRepPortfolioModal();
  const inp = document.getElementById('repModalSearchInput');
  if (inp) {
    inp.focus();
    const len = inp.value.length;
    try { inp.setSelectionRange(len, len); } catch (_) {}
  }
};

window.jumpFromRepModalToInventory = function(rep, itemId = null) {
  document.getElementById('salesRepPortfolioModal')?.classList.add('hidden');
  document.getElementById('tabSales')?.click();
  const salesFilter = document.getElementById('salesFilter');
  if (salesFilter) {
    salesFilter.value = rep;
    salesFilter.dispatchEvent(new Event('change'));
  }
  if (itemId && typeof window.loadFormFromItem === 'function') {
    setTimeout(() => window.loadFormFromItem(itemId), 120);
  }
};

function renderSalesRepPortfolioModal() {
  const modal = document.getElementById('salesRepPortfolioModal');
  if (!modal) return;

  const { rep, tab, bizFilter, search, domesticSales, commShipments, unpaidDom, loading } = repModalState;
  const fx = (typeof window.getLiveFxRate === 'function' ? window.getLiveFxRate() : window.rawFxRate) || 1380;
  const periodLabel = currentMonth !== 'all' ? `${currentYear}년 ${currentMonth}월` : `${currentYear}년 연간 누적(YTD)`;

  const repStats = lastMergedSalesReps.find(s => s.sales_rep === rep) || {
    sales_rep: rep, billing: 0, margin: 0, margin_rate: 0, shipment_count: 0, comm_usd: 0, comm_krw: 0, comm_count: 0, total_profit: 0
  };

  // Domestic(DReportFile) + Commission(ShippingFile) 통합 비즈니스 내역 (최신순 정렬)
  const unifiedBizRows = [
    ...domesticSales.map(d => ({
      biz_type: 'DOMESTIC',
      date: d.ship_date || '',
      customer: d.customer || '기타',
      maker: d.maker || 'OTHERS',
      part_no: d.part_no || '-',
      po_no: d.po_no || '',
      qty: Number(d.ship_qty) || 0,
      unit_str: `₩${Math.round(Number(d.out_up_krw) || 0).toLocaleString()}`,
      amt_str: `₩${Math.round(Number(d.out_amt_krw) || 0).toLocaleString()}`,
      profit_krw: Math.round(Number(d.margin_krw) || 0),
      profit_str: `₩${Math.round(Number(d.margin_krw) || 0).toLocaleString()}`,
      rate_str: `${Number(d.margin_rate || 0).toFixed(1)}%`,
      status_str: '국내출고',
      awb_no: ''
    })),
    ...commShipments.map(c => ({
      biz_type: 'COMMISSION',
      date: c.ship_date || '',
      customer: resolveCustomerName(c.customer, c.real_cust, '본사 입고(BSK)'),
      maker: c.maker || 'OTHERS',
      part_no: c.part_no || '-',
      po_no: c.po_no || c.invoice_no || '',
      qty: Number(c.ship_qty) || 0,
      unit_str: `$${(Number(c.net_up) || 0).toFixed(4)}`,
      amt_str: `$${(Number(c.ship_amt) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      profit_krw: Math.round((Number(c.comm_amt) || 0) * fx),
      profit_str: `$${(Number(c.comm_amt) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (≈₩${Math.round((Number(c.comm_amt) || 0) * fx).toLocaleString()})`,
      rate_str: `${(Number(c.comm_rate) || 0).toFixed(2)}%`,
      status_str: c.comm_status || '미입금',
      awb_no: c.awb_no || ''
    }))
  ].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // 담당 보유 재고 (window.cachedItems 실시간 연동)
  const allInv = Array.isArray(window.cachedItems) ? window.cachedItems : [];
  const repStocks = allInv.filter(it => toEnglishSalesName(it.owner || it.sales || '') === rep && (Number(it.stock) || 0) > 0);
  const totalStockLotCount = repStocks.length;
  const totalStockQty = repStocks.reduce((s, it) => s + (Number(it.stock) || 0), 0);
  const totalStockUsd = repStocks.reduce((s, it) => s + ((Number(it.stock) || 0) * (Number(it.unitUsd ?? it.unit_usd) || 0)), 0);
  const totalStockKrw = repStocks.reduce((s, it) => s + Math.round((Number(it.stock) || 0) * (Number(it.unitUsd ?? it.unit_usd) || 0) * (Number(it.shipFx ?? it.ship_fx) || fx)), 0);
  const totalAvailQty = repStocks.reduce((s, it) => {
    const stk = Number(it.stock) || 0;
    const rawArr = Number(it.arrangedQty ?? it.arranged_qty) || 0;
    const isExp = it.orderStatus === '배정완료' || it.orderStatus === '배정요청';
    const arr = rawArr > 0 ? Math.min(stk, rawArr) : (isExp ? stk : 0);
    return s + Math.max(0, stk - arr);
  }, 0);

  // 미수금 요약 (Domestic 미수 + Commission 미입금)
  const unpaidDomKrw = unpaidDom.reduce((s, u) => s + (Number(u.amount_vat ?? u.out_amt) || 0), 0);
  const unpaidCommUsd = commShipments.filter(s => s.comm_status === '미입금').reduce((s, r) => s + (Number(r.comm_amt) || 0), 0);

  // 고객사별 통합 집계 (Domestic 매출/마진 + Commission, 자사 BIGSHINE 명의는 실수요처로 치환 및 순수 본사입고 제외)
  const custMap = {};
  domesticSales.forEach(d => {
    const c = resolveCustomerName(d.customer, d.real_cust, '');
    if (!c || isSelfCompanyName(c) || c === '기타') return;
    if (!custMap[c]) custMap[c] = { customer: c, count: 0, dom_krw: 0, mgn_krw: 0, comm_usd: 0, makers: new Set() };
    custMap[c].count += 1;
    custMap[c].dom_krw += Number(d.out_amt_krw) || 0;
    custMap[c].mgn_krw += Number(d.margin_krw) || 0;
    if (d.maker) custMap[c].makers.add(d.maker);
  });
  commShipments.forEach(s => {
    const c = resolveCustomerName(s.customer, s.real_cust, '');
    if (!c || isSelfCompanyName(c) || c === '기타') return;
    if (!custMap[c]) custMap[c] = { customer: c, count: 0, dom_krw: 0, mgn_krw: 0, comm_usd: 0, makers: new Set() };
    custMap[c].count += 1;
    custMap[c].comm_usd += Number(s.comm_amt) || 0;
    if (s.maker) custMap[c].makers.add(s.maker);
  });
  const topRepCustomers = Object.values(custMap)
    .map(c => ({ ...c, total_profit_krw: c.mgn_krw + Math.round(c.comm_usd * fx), makers: Array.from(c.makers).join(', ') }))
    .sort((a, b) => b.total_profit_krw - a.total_profit_krw);

  const q = search.trim().toLowerCase();

  // 탭별 본문 렌더링
  let tabBodyHtml = '';
  if (tab === 'biz') {
    const filteredBiz = unifiedBizRows.filter(it => {
      if (bizFilter === 'COMMISSION' && it.biz_type !== 'COMMISSION') return false;
      if (bizFilter === 'DOMESTIC' && it.biz_type !== 'DOMESTIC') return false;
      if (q) {
        const hay = `${it.customer} ${it.part_no} ${it.po_no} ${it.maker}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const sumProfitKrw = filteredBiz.reduce((s, r) => s + (r.profit_krw || 0), 0);

    tabBodyHtml = `
      <div class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2 bg-white p-2.5 rounded-xl border border-slate-200 text-xs">
          <div class="flex items-center gap-1">
            <button type="button" onclick="window.setSalesRepBizFilter('ALL')" class="px-2.5 py-1 rounded-lg font-bold cursor-pointer ${bizFilter === 'ALL' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">전체 (${unifiedBizRows.length})</button>
            <button type="button" onclick="window.setSalesRepBizFilter('DOMESTIC')" class="px-2.5 py-1 rounded-lg font-bold cursor-pointer ${bizFilter === 'DOMESTIC' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">🏢 Domestic 매출·마진 (${domesticSales.length})</button>
            <button type="button" onclick="window.setSalesRepBizFilter('COMMISSION')" class="px-2.5 py-1 rounded-lg font-bold cursor-pointer ${bizFilter === 'COMMISSION' ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">💎 Commission 직송 (${commShipments.length})</button>
          </div>
          <div class="flex items-center gap-3 text-[11px] font-mono font-bold text-slate-700">
            <span>조회 건수: <strong>${filteredBiz.length.toLocaleString()}건</strong></span>
            <span>🏆 조회 수익합계(마진+커미션): <strong class="text-violet-800">₩${sumProfitKrw.toLocaleString()}</strong></span>
          </div>
        </div>

        ${loading ? `<div class="py-12 text-center text-slate-400 font-bold text-xs">⏳ [${escRep(rep)}] 담당 Domestic 매출·마진 및 Commission 원장을 불러오는 중입니다...</div>` : filteredBiz.length === 0 ? `<div class="py-12 text-center text-slate-400 font-bold text-xs bg-white rounded-xl border border-slate-200">조회된 비즈니스 내역이 없습니다.</div>` : `
          <div class="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-2xs">
            <table class="w-full text-left text-xs border-collapse">
              <thead class="bg-slate-100 text-slate-700 font-bold text-[11px] border-b border-slate-200 sticky top-0 z-10">
                <tr>
                  <th class="py-2 px-2 text-center w-16">구분</th>
                  <th class="py-2 px-2 text-center w-22">일자</th>
                  <th class="py-2 px-2">고객사</th>
                  <th class="py-2 px-2 text-center w-20">제조사</th>
                  <th class="py-2 px-2">품번 (PartNo)</th>
                  <th class="py-2 px-2">PO / 번호</th>
                  <th class="py-2 px-2 text-right">수량</th>
                  <th class="py-2 px-2 text-right">판매단가</th>
                  <th class="py-2 px-2 text-right">매출/선적액</th>
                  <th class="py-2 px-2 text-right">🏆 마진 / 💎 커미션</th>
                  <th class="py-2 px-2 text-center">상태/추적</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 text-[11px]">
                ${filteredBiz.slice(0, 300).map(r => {
                  const isComm = r.biz_type === 'COMMISSION';
                  return `
                    <tr class="hover:bg-slate-50 ${isComm ? 'bg-violet-50/15' : ''}">
                      <td class="py-1.5 px-2 text-center whitespace-nowrap">
                        ${isComm
                          ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-black bg-violet-100 text-violet-800 border border-violet-200">💎 COMM</span>`
                          : `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">🏢 DOM</span>`}
                      </td>
                      <td class="py-1.5 px-2 text-center font-mono text-slate-600 whitespace-nowrap">${escRep(r.date)}</td>
                      <td class="py-1.5 px-2 font-bold text-slate-900 truncate max-w-[160px]" title="${escRep(r.customer)}">
                        ${!isSelfCompanyName(r.customer) && r.customer !== '-' && r.customer !== '기타'
                          ? `<button type="button" onclick="window.openCustomer360Modal && window.openCustomer360Modal('${escRep(r.customer).replace(/'/g, "\\'")}')" class="hover:text-indigo-700 hover:underline cursor-pointer truncate max-w-full text-left" title="클릭하여 고객사 360° 통합 브리핑 열기">${escRep(r.customer)}</button>`
                          : `<span class="text-slate-500">${escRep(r.customer)}</span>`}
                      </td>
                      <td class="py-1.5 px-2 text-center font-bold text-indigo-900 whitespace-nowrap">${escRep(r.maker)}</td>
                      <td class="py-1.5 px-2 font-mono font-bold text-slate-900 whitespace-nowrap">
                        <button type="button" onclick="window.openPriceHistoryModal && window.openPriceHistoryModal('${escRep(r.part_no)}')" class="hover:text-indigo-700 hover:underline cursor-pointer" title="과거 단가·커미션 이력 보기">📈 ${escRep(r.part_no)}</button>
                      </td>
                      <td class="py-1.5 px-2 font-mono text-[10px] text-slate-600 truncate max-w-[125px]">${escRep(r.po_no || '-')}</td>
                      <td class="py-1.5 px-2 text-right font-mono font-bold text-slate-900 whitespace-nowrap">${r.qty.toLocaleString()}</td>
                      <td class="py-1.5 px-2 text-right font-mono text-blue-700 whitespace-nowrap">${escRep(r.unit_str)}</td>
                      <td class="py-1.5 px-2 text-right font-mono font-black text-slate-900 whitespace-nowrap">${escRep(r.amt_str)}</td>
                      <td class="py-1.5 px-2 text-right font-mono whitespace-nowrap">
                        <div class="font-black ${isComm ? 'text-violet-700' : 'text-emerald-700'}">${escRep(r.profit_str)}</div>
                        <div class="text-[9px] ${isComm ? 'text-violet-500' : 'text-emerald-600'} font-bold">${escRep(r.rate_str)}</div>
                      </td>
                      <td class="py-1.5 px-2 text-center whitespace-nowrap">
                        <div class="inline-flex items-center gap-1">
                          <span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${r.status_str === '미입금' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-slate-100 text-slate-700'}">${escRep(r.status_str)}</span>
                          ${r.awb_no ? `<button type="button" onclick="window.openTrackingModal && window.openTrackingModal('${escRep(r.awb_no)}')" class="px-1.5 py-0.5 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 rounded text-[9px] font-bold cursor-pointer" title="배송 조회">🚚</button>` : ''}
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
  } else if (tab === 'stock') {
    const filteredStocks = repStocks.filter(it => {
      if (!q) return true;
      const hay = `${it.partName || it.part_name || ''} ${it.maker || ''} ${it.customer || ''} ${it.poNo || it.po_no || ''} ${it.invoiceNo || it.invoice_no || ''} ${it.memo || ''}`.toLowerCase();
      return hay.includes(q);
    });
    const todayMs = Date.now();

    tabBodyHtml = filteredStocks.length === 0 ? `<div class="py-12 text-center text-slate-400 font-bold text-xs bg-white rounded-xl border border-slate-200">[${escRep(rep)}] 담당으로 보유 중인 재고가 없습니다.</div>` : `
      <div class="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-2xs">
        <table class="w-full text-left text-xs border-collapse">
          <thead class="bg-emerald-50 text-emerald-950 font-bold text-[11px] border-b border-emerald-200 sticky top-0 z-10">
            <tr>
              <th class="py-2 px-2.5 text-center w-16">상태</th>
              <th class="py-2 px-2.5">계약처 / 비고</th>
              <th class="py-2 px-2.5 text-center w-20">제조사</th>
              <th class="py-2 px-2.5">품번 (PartNo)</th>
              <th class="py-2 px-2.5 text-right">보유수량</th>
              <th class="py-2 px-2.5 text-right">배정 / 가용</th>
              <th class="py-2 px-2.5 text-right">매입단가($)</th>
              <th class="py-2 px-2.5 text-right">재고금액($ / ₩)</th>
              <th class="py-2 px-2.5 text-center">입고일 (보유일)</th>
              <th class="py-2 px-2.5 text-center">바로가기</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 text-[11px]">
            ${filteredStocks.map(it => {
              const stk = Number(it.stock) || 0;
              const rawArr = Number(it.arrangedQty ?? it.arranged_qty) || 0;
              const isExp = it.orderStatus === '배정완료' || it.orderStatus === '배정요청';
              const arr = rawArr > 0 ? Math.min(stk, rawArr) : (isExp ? stk : 0);
              const avail = Math.max(0, stk - arr);
              const uUsd = Number(it.unitUsd ?? it.unit_usd) || 0;
              const sFx = Number(it.shipFx ?? it.ship_fx) || fx;
              const amtUsd = stk * uUsd;
              const amtKrw = Math.round(amtUsd * sFx);
              const eDate = (it.entryDate || it.entry_date || '').slice(0, 10);
              const ageDays = eDate ? Math.max(0, Math.floor((todayMs - new Date(eDate).getTime()) / 86400000)) : 0;
              const part = it.partName || it.part_name || '-';
              const cust = (it.customer && it.customer !== '-') ? it.customer : (it.memo || '-');
              return `
                <tr class="hover:bg-emerald-50/30">
                  <td class="py-1.5 px-2.5 text-center whitespace-nowrap">
                    <span class="px-1.5 py-0.5 rounded-full text-[9px] font-bold ${isExp ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}">${escRep(it.orderStatus || '보유')}</span>
                  </td>
                  <td class="py-1.5 px-2.5 font-bold text-slate-800 truncate max-w-[160px]" title="${escRep(cust)}">${escRep(cust)}</td>
                  <td class="py-1.5 px-2.5 text-center font-bold text-indigo-900 whitespace-nowrap">${escRep(it.maker)}</td>
                  <td class="py-1.5 px-2.5 font-mono font-black text-indigo-950 whitespace-nowrap">
                    <button type="button" onclick="window.openPriceHistoryModal && window.openPriceHistoryModal('${escRep(part)}')" class="hover:text-indigo-700 hover:underline cursor-pointer">📈 ${escRep(part)}</button>
                  </td>
                  <td class="py-1.5 px-2.5 text-right font-mono font-black text-slate-900 whitespace-nowrap">${stk.toLocaleString()} EA</td>
                  <td class="py-1.5 px-2.5 text-right font-mono whitespace-nowrap">
                    <span class="text-amber-700 font-bold">배정:${arr.toLocaleString()}</span> · <span class="text-emerald-700 font-black">가용:${avail.toLocaleString()}</span>
                  </td>
                  <td class="py-1.5 px-2.5 text-right font-mono text-slate-700 whitespace-nowrap">$${uUsd.toFixed(4)}</td>
                  <td class="py-1.5 px-2.5 text-right font-mono whitespace-nowrap">
                    <div class="font-black text-slate-900">$${amtUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    <div class="text-[9px] text-rose-600 font-bold">₩${amtKrw.toLocaleString()}</div>
                  </td>
                  <td class="py-1.5 px-2.5 text-center font-mono whitespace-nowrap">
                    <div>${escRep(eDate || '-')}</div>
                    <div class="text-[9px] ${ageDays >= 90 ? 'text-rose-600 font-bold' : 'text-slate-400'}">${ageDays}일 경과</div>
                  </td>
                  <td class="py-1.5 px-2.5 text-center whitespace-nowrap">
                    <button type="button" onclick="window.jumpFromRepModalToInventory('${escRep(rep)}', '${escRep(it.id)}')" class="px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded text-[10px] font-bold cursor-pointer">상세/배정 ↗</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } else {
    const repMemos = (allMemos || []).filter(m => toEnglishSalesName(m.sales_rep || '') === rep);
    tabBodyHtml = `
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <!-- 좌측: 주요 거래 고객사 Top 순위 -->
        <div class="bg-white rounded-xl border border-slate-200 p-3.5 space-y-2.5">
          <div class="flex items-center justify-between border-b border-slate-100 pb-2">
            <h4 class="font-black text-xs text-slate-900">🏢 [${escRep(rep)}] 주요 거래 고객사 (${topRepCustomers.length}개사)</h4>
            <span class="text-[10px] text-slate-400 font-mono">선적액 / 💎 커미션</span>
          </div>
          ${topRepCustomers.length === 0 ? `<div class="py-8 text-center text-slate-400 text-xs font-bold">집계된 고객사 출하 내역이 없습니다.</div>` : `
            <div class="space-y-2 max-h-72 overflow-y-auto pr-1">
              ${topRepCustomers.slice(0, 15).map((c, i) => `
                <div class="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-50 hover:bg-indigo-50/60 border border-slate-100 text-xs cursor-pointer transition-colors" onclick="window.openCustomer360Modal && window.openCustomer360Modal('${escRep(c.customer).replace(/'/g, "\\'")}')" title="클릭하여 [${escRep(c.customer)}] 360° 통합 브리핑 열기">
                  <div class="min-w-0">
                    <div class="font-black text-slate-900 truncate"><span class="text-indigo-600 font-mono">${i + 1}.</span> ${escRep(c.customer)} <span class="text-[9px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-1 rounded">360°</span></div>
                    <div class="text-[10px] text-slate-500 truncate">${escRep(c.makers)} · ${c.count}건 출하</div>
                  </div>
                  <div class="text-right font-mono shrink-0">
                    <div class="font-black text-slate-900">🏆 ₩${Math.round(c.total_profit_krw).toLocaleString()}</div>
                    <div class="text-[10px] text-slate-500">
                      ${c.mgn_krw > 0 ? `<span class="text-emerald-700 font-bold">마진 ₩${Math.round(c.mgn_krw / 10000).toLocaleString()}만</span>` : ''}
                      ${c.comm_usd > 0 ? `<span class="text-violet-700 font-black ml-1">💎 $${c.comm_usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>` : ''}
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>

        <!-- 우측: Domestic 미수금 & 최근 영업 활동 메모 -->
        <div class="space-y-3">
          <div class="bg-white rounded-xl border border-slate-200 p-3.5 space-y-2">
            <div class="flex items-center justify-between border-b border-slate-100 pb-2">
              <h4 class="font-black text-xs text-rose-900">💰 Domestic 미수 채권 (${unpaidDom.length}건)</h4>
              <span class="font-mono font-black text-rose-700 text-xs">₩${Math.round(unpaidDomKrw).toLocaleString()}</span>
            </div>
            ${unpaidDom.length === 0 ? `<div class="py-4 text-center text-slate-400 text-xs">미결제 Domestic 미수금이 없습니다.</div>` : `
              <div class="space-y-1.5 max-h-36 overflow-y-auto pr-1 text-[11px]">
                ${unpaidDom.slice(0, 10).map(u => `
                  <div class="flex items-center justify-between gap-2 py-1 border-b border-slate-100">
                    <span class="font-bold text-slate-800 truncate">${escRep(u.customer_name || u.cname)} · <span class="font-mono text-indigo-800">${escRep(u.part_name || u.part_no)}</span></span>
                    <span class="font-mono font-bold text-rose-700 shrink-0">₩${Math.round(Number(u.amount_vat ?? u.out_amt) || 0).toLocaleString()}</span>
                  </div>
                `).join('')}
              </div>
            `}
          </div>

          <div class="bg-white rounded-xl border border-slate-200 p-3.5 space-y-2">
            <h4 class="font-black text-xs text-slate-900 border-b border-slate-100 pb-2">📝 최근 영업 활동 메모 (${repMemos.length}건)</h4>
            ${repMemos.length === 0 ? `<div class="py-4 text-center text-slate-400 text-xs">작성된 영업 활동 메모가 없습니다.</div>` : `
              <div class="space-y-1.5 max-h-36 overflow-y-auto pr-1 text-[11px]">
                ${repMemos.slice(0, 8).map(m => `
                  <div class="p-2 rounded-lg bg-slate-50 border border-slate-100">
                    <div class="text-[10px] font-mono text-slate-400">${escRep(m.input_date)}</div>
                    <div class="text-slate-700 mt-0.5">${escRep(m.memo)}</div>
                  </div>
                `).join('')}
              </div>
            `}
          </div>
        </div>
      </div>
    `;
  }

  modal.innerHTML = `
    <div class="bg-white w-[96vw] max-w-[1560px] h-[90vh] rounded-2xl shadow-2xl border border-slate-300 flex flex-col overflow-hidden" onclick="event.stopPropagation()">
      <!-- 헤더 -->
      <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-violet-950 text-white px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-violet-500/25 border border-violet-400/40 flex items-center justify-center text-xl font-black">👤</div>
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <h2 class="text-base sm:text-lg font-black tracking-wide">${escRep(rep)} 비즈니스 &amp; 재고 포트폴리오</h2>
              <span class="text-[10px] bg-violet-500/30 border border-violet-300/40 text-violet-100 font-bold px-2 py-0.5 rounded-full">${periodLabel}</span>
            </div>
            <p class="text-[11px] text-slate-300 mt-0.5">개인별 Domestic 마진 · 💎 Commission · 담당 보유재고 · 주요 고객사 및 미수 채권 통합 브리핑</p>
          </div>
        </div>
        <div class="flex items-center gap-1.5">
          <button type="button" onclick="document.getElementById('salesRepPortfolioModal').classList.add('hidden'); window.jumpToShipmentsFiltered && window.jumpToShipmentsFiltered({ query: '${escRep(rep)}', year: '${currentYear}' })" class="px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-bold cursor-pointer transition">🚚 출하원장 전체 ↗</button>
          <button type="button" onclick="window.jumpFromRepModalToInventory('${escRep(rep)}')" class="px-2.5 py-1.5 bg-emerald-500/25 hover:bg-emerald-500/40 border border-emerald-400/40 text-emerald-100 rounded-lg text-xs font-bold cursor-pointer transition">📦 재고탭 필터 ↗</button>
          <button type="button" onclick="document.getElementById('salesRepPortfolioModal').classList.add('hidden')" class="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold flex items-center justify-center cursor-pointer">✕</button>
        </div>
      </div>

      <!-- 4대 핵심 KPI 카드 -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-2.5 p-3 sm:p-4 bg-slate-50 border-b border-slate-200 shrink-0">
        <div class="bg-white border border-violet-200 rounded-xl p-3 shadow-2xs">
          <div class="text-[11px] font-bold text-violet-900 flex items-center justify-between">
            <span>🏆 통합 총수익 (마진+커미션)</span>
            <span class="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded font-black">${repStats.margin_rate}%</span>
          </div>
          <div class="text-base sm:text-lg font-black text-slate-900 font-mono mt-1">₩${Math.round(repStats.total_profit).toLocaleString()}</div>
          <div class="text-[10px] text-slate-600 mt-0.5">마진 <strong class="text-emerald-700">₩${Math.round(repStats.margin).toLocaleString()}</strong> + 💎 <strong class="text-violet-700">$${repStats.comm_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div>
        </div>

        <div class="bg-white border border-indigo-200 rounded-xl p-3 shadow-2xs">
          <div class="text-[11px] font-bold text-indigo-900 flex items-center justify-between">
            <span>📈 Domestic 매출 실적</span>
            <span class="text-[10px] text-indigo-600 font-mono">BILLING</span>
          </div>
          <div class="text-base sm:text-lg font-black text-indigo-950 font-mono mt-1">₩${Math.round(repStats.billing).toLocaleString()}</div>
          <div class="text-[10px] text-slate-500 mt-0.5">국내출하 <strong>${repStats.shipment_count}건</strong> · 커미션 <strong>${repStats.comm_count}건</strong></div>
        </div>

        <div class="bg-white border border-emerald-200 rounded-xl p-3 shadow-2xs cursor-pointer hover:border-emerald-400" onclick="window.switchSalesRepModalTab('stock')">
          <div class="text-[11px] font-bold text-emerald-900 flex items-center justify-between">
            <span>📦 담당 보유 재고 (${totalStockLotCount}건)</span>
            <span class="text-[10px] text-emerald-700 font-bold">재고보기 👉</span>
          </div>
          <div class="text-base sm:text-lg font-black text-emerald-950 font-mono mt-1">$${totalStockUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div class="text-[10px] text-emerald-700 mt-0.5">총 <strong>${totalStockQty.toLocaleString()} EA</strong> (가용 <strong>${totalAvailQty.toLocaleString()} EA</strong> · ≈₩${Math.round(totalStockKrw / 10000).toLocaleString()}만)</div>
        </div>

        <div class="bg-white border border-rose-200 rounded-xl p-3 shadow-2xs cursor-pointer hover:border-rose-400" onclick="window.switchSalesRepModalTab('customers')">
          <div class="text-[11px] font-bold text-rose-900 flex items-center justify-between">
            <span>💰 미회수 채권 (미수/커미션)</span>
            <span class="text-[10px] text-rose-600 font-bold">상세 👉</span>
          </div>
          <div class="text-sm sm:text-base font-black text-rose-700 font-mono mt-1">₩${Math.round(unpaidDomKrw).toLocaleString()} <span class="text-xs text-violet-700">+ 💎$${unpaidCommUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
          <div class="text-[10px] text-slate-500 mt-0.5">국내미수 <strong>${unpaidDom.length}건</strong> · 커미션미입금 <strong>$${unpaidCommUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
        </div>
      </div>

      <!-- 서브탭 & 검색 바 -->
      <div class="px-4 py-2 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div class="flex items-center gap-1">
          <button type="button" onclick="window.switchSalesRepModalTab('biz')" class="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ${tab === 'biz' ? 'bg-indigo-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'}">🚚 진행 비즈니스 내역 (${unifiedBizRows.length})</button>
          <button type="button" onclick="window.switchSalesRepModalTab('stock')" class="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ${tab === 'stock' ? 'bg-emerald-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'}">📦 담당 보유 재고 (${totalStockLotCount})</button>
          <button type="button" onclick="window.switchSalesRepModalTab('customers')" class="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ${tab === 'customers' ? 'bg-violet-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'}">🏢 주요 고객사 &amp; 미수/메모 (${topRepCustomers.length})</button>
        </div>
        <input type="text" id="repModalSearchInput" value="${escRep(search)}" oninput="window.setSalesRepModalSearch(this.value)" placeholder="고객사, 품번(PartNo), 제조사, PO 빠른 검색..." class="w-full sm:w-64 px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg outline-none focus:bg-white focus:border-indigo-500">
      </div>

      <!-- 본문 영역 -->
      <div class="flex-1 overflow-y-auto p-3 sm:p-4 bg-slate-50/70">
        ${tabBodyHtml}
      </div>
    </div>
  `;
}
