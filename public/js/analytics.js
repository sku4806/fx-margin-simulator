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

  // 월별 차트 최대값 계산 (SVG 스케일링용)
  const maxBill = Math.max(...monthly.map(m => Math.max(m.billing, m.booking)), 1000000);

  // SVG 차트 막대 생성
  const chartHeight = 180;
  const chartWidth = 720;
  const barGroupWidth = monthly.length > 0 ? Math.floor((chartWidth - 60) / monthly.length) : 50;
  const barWidth = Math.max(8, Math.floor(barGroupWidth * 0.38));

  const chartSvgBars = monthly.map((m, idx) => {
    const x = 50 + idx * barGroupWidth;
    const billH = Math.max(2, Math.round((m.billing / maxBill) * (chartHeight - 40)));
    const bookH = Math.max(2, Math.round((m.booking / maxBill) * (chartHeight - 40)));
    const billY = chartHeight - 25 - billH;
    const bookY = chartHeight - 25 - bookH;
    const monthLabel = m.month.slice(5); // '01', '02', ...

    return `
      <g class="chart-group cursor-pointer group" data-idx="${idx}">
        <!-- Booking Bar (Amber) -->
        <rect x="${x}" y="${bookY}" width="${barWidth}" height="${bookH}" rx="3" fill="#f59e0b" class="opacity-90 group-hover:opacity-100 transition-opacity">
          <title>${m.month} 수주: ₩${Math.round(m.booking).toLocaleString()}</title>
        </rect>
        <!-- Billing Bar (Indigo) -->
        <rect x="${x + barWidth + 2}" y="${billY}" width="${barWidth}" height="${billH}" rx="3" fill="#4f46e5" class="opacity-90 group-hover:opacity-100 transition-opacity">
          <title>${m.month} 매출: ₩${Math.round(m.billing).toLocaleString()} (마진: ${m.margin_rate}%)</title>
        </rect>
        <!-- X-axis Label -->
        <text x="${x + barWidth + 1}" y="${chartHeight - 8}" text-anchor="middle" font-size="10" font-weight="bold" fill="#64748b">${monthLabel}월</text>
      </g>
    `;
  }).join('');

  container.innerHTML = `
    <div class="space-y-4">
      
      <!-- 1. 최상단 헤더 바 -->
      <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-700/60 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-indigo-600/30 border border-indigo-400/40 flex items-center justify-center text-xl shrink-0">
            📊
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-base sm:text-lg font-black tracking-wide text-white">매출 장부 & 다차원 실적 분석 (Book & Bill)</h2>
              <span class="text-[10px] font-bold bg-amber-400/20 text-amber-300 border border-amber-400/40 px-2 py-0.5 rounded-full">실시간 MS-SQL 연동</span>
            </div>
            <p class="text-xs text-slate-300 font-medium mt-0.5">FrmSalesBKBL & FrmSalesGraph 기반 연간·월별 수주/매출/마진 분석</p>
          </div>
        </div>

        <div class="flex items-center gap-2 text-xs">
          <span class="text-slate-300 font-bold">기준 연도:</span>
          <select id="analyticsYearSelect" onchange="window.switchAnalyticsYear(this.value)" class="bg-slate-800 text-amber-300 border border-slate-600 rounded-lg px-2.5 py-1.5 font-bold outline-none cursor-pointer">
            <option value="2026" ${currentYear === '2026' ? 'selected' : ''}>2026년</option>
            <option value="2025" ${currentYear === '2025' ? 'selected' : ''}>2025년</option>
            <option value="2024" ${currentYear === '2024' ? 'selected' : ''}>2024년</option>
          </select>
          <button type="button" onclick="window.refreshSalesAnalytics()" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg shadow-sm transition-colors flex items-center gap-1 cursor-pointer">
            🔄 새로고침
          </button>
        </div>
      </div>

      <!-- 2. 핵심 KPI 4단 카드 -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <!-- 1) 연간 누적 매출액 -->
        <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden">
          <div class="text-[11px] font-bold text-slate-500 flex items-center justify-between">
            <span>${currentYear}년 누적 매출액 (Billing)</span>
            <span class="text-indigo-600">📈 YTD</span>
          </div>
          <div class="text-lg sm:text-xl font-black text-slate-900 mt-1 font-mono">
            ₩${Math.round(billingYtd).toLocaleString()}
          </div>
          <div class="text-[10px] text-slate-400 mt-0.5">
            총 출하 건수: <strong class="text-slate-700">${monthly.reduce((acc, m) => acc + m.bill_count, 0).toLocaleString()}건</strong>
          </div>
        </div>

        <!-- 2) 연간 누적 매출이익 (Margin) -->
        <div class="bg-white p-4 rounded-xl border border-emerald-200 bg-emerald-50/20 shadow-sm relative overflow-hidden">
          <div class="text-[11px] font-bold text-emerald-800 flex items-center justify-between">
            <span>${currentYear}년 누적 매출이익 (Margin)</span>
            <span class="text-emerald-600 font-black">${marginRate}%</span>
          </div>
          <div class="text-lg sm:text-xl font-black text-emerald-900 mt-1 font-mono">
            ₩${Math.round(marginYtd).toLocaleString()}
          </div>
          <div class="text-[10px] text-emerald-700 mt-0.5">
            평균 마진율: <strong class="text-emerald-900 font-bold">${marginRate}% 달성</strong>
          </div>
        </div>

        <!-- 3) 연간 누적 수주액 (Booking) -->
        <div class="bg-white p-4 rounded-xl border border-amber-200 bg-amber-50/20 shadow-sm relative overflow-hidden">
          <div class="text-[11px] font-bold text-amber-800 flex items-center justify-between">
            <span>${currentYear}년 누적 수주액 (Booking)</span>
            <span class="text-amber-600 font-bold">🛒 PO</span>
          </div>
          <div class="text-lg sm:text-xl font-black text-amber-950 mt-1 font-mono">
            ₩${Math.round(bookingYtd).toLocaleString()}
          </div>
          <div class="text-[10px] text-amber-700 mt-0.5">
            수주 건수: <strong class="text-amber-900">${monthly.reduce((acc, m) => acc + m.book_count, 0).toLocaleString()}건</strong>
          </div>
        </div>

        <!-- 4) 당월 매출액 -->
        <div class="bg-white p-4 rounded-xl border border-indigo-200 bg-indigo-50/30 shadow-sm relative overflow-hidden">
          <div class="text-[11px] font-bold text-indigo-800 flex items-center justify-between">
            <span>당월 매출액 (${currentMonthItem.month || 'Current'})</span>
            <span class="text-indigo-600 font-bold">📅 당월</span>
          </div>
          <div class="text-lg sm:text-xl font-black text-indigo-950 mt-1 font-mono">
            ₩${Math.round(currentMonthBill).toLocaleString()}
          </div>
          <div class="text-[10px] text-indigo-700 mt-0.5">
            당월 출하: <strong class="text-indigo-900">${(currentMonthItem.bill_count || 0)}건 진행</strong>
          </div>
        </div>
      </div>

      <!-- 3. 월별 Book & Bill 추이 차트 -->
      <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <h3 class="font-bold text-sm text-slate-900">월별 수주(Booking) vs 매출(Billing) 추이</h3>
            <span class="text-[10px] text-slate-400 font-medium">최근 12개월 월별 비교</span>
          </div>
          <!-- 범례 -->
          <div class="flex items-center gap-3 text-xs font-bold">
            <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-indigo-600 inline-block"></span> 매출 (Billing)</span>
            <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-amber-500 inline-block"></span> 수주 (Booking)</span>
          </div>
        </div>

        <div class="w-full overflow-x-auto pt-2">
          <svg viewBox="0 0 ${chartWidth} ${chartHeight}" class="w-full h-48 select-none">
            <!-- 기준선 그리드 -->
            <line x1="40" y1="20" x2="${chartWidth}" y2="20" stroke="#f1f5f9" stroke-width="1" />
            <line x1="40" y1="70" x2="${chartWidth}" y2="70" stroke="#f1f5f9" stroke-width="1" />
            <line x1="40" y1="120" x2="${chartWidth}" y2="120" stroke="#f1f5f9" stroke-width="1" />
            <line x1="40" y1="${chartHeight - 25}" x2="${chartWidth}" y2="${chartHeight - 25}" stroke="#cbd5e1" stroke-width="1.5" />
            
            <!-- 막대 렌더링 -->
            ${chartSvgBars}
          </svg>
        </div>
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
}

let cachedMemos = [];

async function loadSalesMemos(rep = 'ALL') {
  const container = document.getElementById('salesMemoListContainer');
  if (!container) return;

  try {
    const url = rep === 'ALL' ? '/api/sales/memos' : `/api/sales/memos?sales_rep=${encodeURIComponent(rep)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status === 'success') {
      cachedMemos = data.memos || [];
      renderMemoList(cachedMemos);
    }
  } catch (e) {
    container.innerHTML = '<div class="text-slate-400 text-center py-4">메모 로드에 실패했습니다.</div>';
  }
}

function renderMemoList(memos) {
  const container = document.getElementById('salesMemoListContainer');
  if (!container) return;

  if (!memos || memos.length === 0) {
    container.innerHTML = '<div class="text-slate-400 text-center py-4">등록된 영업 활동 메모가 없습니다.</div>';
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
  loadSalesMemos(rep);
};

window.toggleMemoInputForm = function() {
  const box = document.getElementById('memoInputFormBox');
  if (box) box.classList.toggle('hidden');
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
      const currentRep = document.getElementById('memoSalesFilter')?.value || 'ALL';
      loadSalesMemos(currentRep);
    } else {
      alert("메모 등록 실패: " + (data.message || '오류 발생'));
    }
  } catch (err) {
    alert("서버 연결 실패: " + err.message);
  }
};

window.switchAnalyticsYear = function(year) {
  fetchSalesAnalytics(year).then(() => {
    renderAnalyticsView();
  });
};

window.refreshSalesAnalytics = function() {
  const select = document.getElementById('analyticsYearSelect');
  const year = select ? select.value : currentYear;
  fetchSalesAnalytics(year).then(() => {
    renderAnalyticsView();
  });
};
