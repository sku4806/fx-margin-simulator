import * as SupabaseModule from './supabase.js';
import { getCurrentSession, loginWithEmail, logout, sbClient, subscribeAuthChange, updatePassword } from './supabase.js';

// Supabase 삭제 함수 래퍼 (미존재 시 직접 쿼리)
async function safeDeleteInventoryItem(id) {
  if (typeof deleteInventoryItem === 'function') return safeDeleteInventoryItem(id);
  if (typeof deleteItem === 'function') return deleteItem(id);
  if (SupabaseModule.deleteInventoryItem) return SupabaseModule.safeDeleteInventoryItem(id);
  if (SupabaseModule.deleteItem) return SupabaseModule.deleteItem(id);
  const client = SupabaseModule.supabase || window.supabase;
  if (client) {
    const { error } = await client.from('inventory_items').delete().eq('id', id);
    if (error) throw error;
  }
}
import * as InventoryModule from './inventory.js';

function callRenderInventoryHeaders(tab) {
  const fn = InventoryModule.renderInventoryHeaders || InventoryModule.default?.renderInventoryHeaders;
  if (typeof fn === 'function') fn(tab);
}

function callRenderInventoryList(items) {
  const fn = InventoryModule.renderInventoryList || InventoryModule.renderInventoryTable || InventoryModule.default;
  if (typeof fn === 'function') fn(items);
}
let cachedItems = [];

// 🗂️ 폼 서브탭 동적 자동 빌더 (1.수주/배정, 2.출하/물류, 3.계산서/정산)
function initDynamicFormTabs() {
  const formSection = document.getElementById('formSection');
  if (!formSection) return;

  const oldNav = document.getElementById('dynamicSubTabNav');
  if (oldNav) oldNav.remove();

  // 다른 섹션의 제목을 포함하지 않는 '순수 단일 카드 박스'만 정확히 추출하는 함수
  const allTitles = ['부품 및 영업 정보', '수주 거래처 및 수량', '매입/판매 단가 및 환율', '출하 및 물류 관리', '세금계산서 및 수금 정산'];

  const getIsolatedCard = (targetTitle) => {
    const otherTitles = allTitles.filter(t => t !== targetTitle);
    const elements = formSection.querySelectorAll('div, section');
    for (const el of elements) {
      // 타겟 타이틀을 포함하고 있으면서
      if (el.textContent.includes(targetTitle)) {
        // 다른 타이틀은 전혀 포함하지 않는 가장 바깥쪽 독립 박스
        const hasOthers = otherTitles.some(ot => el.textContent.includes(ot));
        if (!hasOthers) {
          // 부모가 다른 타이틀을 포함하고 있다면, 현재 el이 바로 독립 카드 단위임
          if (!el.parentElement || otherTitles.some(ot => el.parentElement.textContent.includes(ot)) || el.parentElement.id === 'formSection') {
            return el;
          }
        }
      }
    }
    return null;
  };

  const cardPart = getIsolatedCard('부품 및 영업 정보');
  const cardOrder = getIsolatedCard('수주 거래처 및 수량');
  const cardPrice = getIsolatedCard('매입/판매 단가 및 환율');
  const cardShip = getIsolatedCard('출하 및 물류 관리');
  const cardBill = getIsolatedCard('세금계산서 및 수금 정산');

  if (!cardPart) return;

  // 두 카드를 감싸고 있는 상위 부모 래퍼(fulfillment-only-field 등)의 스타일 제약 해제
  if (cardShip && cardShip.parentElement && cardShip.parentElement !== formSection) {
    cardShip.parentElement.style.display = 'contents';
  }

  // 3단계 서브탭 네비게이션 생성
  const nav = document.createElement('div');
  nav.id = 'dynamicSubTabNav';
  nav.className = 'w-full flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-xl text-xs font-bold mb-3 select-none shadow-inner';
  nav.innerHTML = `
    <button type="button" id="tabBtnOrder" class="flex-1 py-2 px-2 rounded-lg bg-white text-indigo-900 shadow-sm transition-all text-center">
      1. 수주 및 배정 등록
    </button>
    <button type="button" id="tabBtnShip" class="flex-1 py-2 px-2 rounded-lg text-slate-600 hover:text-slate-900 transition-all text-center">
      2. 출하 및 물류 관리 (송장/INV)
    </button>
    <button type="button" id="tabBtnBill" class="flex-1 py-2 px-2 rounded-lg text-slate-600 hover:text-slate-900 transition-all text-center">
      3. 세금계산서 및 수금 정산
    </button>
  `;

  cardPart.parentNode.insertBefore(nav, cardPart);

  const btnOrder = document.getElementById('tabBtnOrder');
  const btnShip = document.getElementById('tabBtnShip');
  const btnBill = document.getElementById('tabBtnBill');

  const activeStyle = "flex-1 py-2 px-2 rounded-lg bg-white text-indigo-900 shadow-sm transition-all text-center font-bold";
  const inactiveStyle = "flex-1 py-2 px-2 rounded-lg text-slate-600 hover:text-slate-900 transition-all text-center font-semibold";

  function switchTab(active) {
    if (btnOrder) btnOrder.className = (active === 'order') ? activeStyle : inactiveStyle;
    if (btnShip) btnShip.className = (active === 'shipping') ? activeStyle : inactiveStyle;
    if (btnBill) btnBill.className = (active === 'billing') ? activeStyle : inactiveStyle;

    const isOrder = (active === 'order');
    const isShip = (active === 'shipping');
    const isBill = (active === 'billing');

    // 1단계 카드 (부품, 거래처, 단가)
    if (cardPart) cardPart.style.display = isOrder ? '' : 'none';
    if (cardOrder) cardOrder.style.display = isOrder ? '' : 'none';
    if (cardPrice) cardPrice.style.display = isOrder ? '' : 'none';

    // 2단계 카드 (출하 및 물류 관리)
    if (cardShip) cardShip.style.display = isShip ? '' : 'none';

    // 3단계 카드 (세금계산서 및 수금 정산)
    if (cardBill) cardBill.style.display = isBill ? '' : 'none';
  }

  btnOrder.onclick = () => switchTab('order');
  btnShip.onclick = () => switchTab('shipping');
  btnBill.onclick = () => switchTab('billing');

  switchTab('order');
}

import { initAuth, isCsOrAdminUser } from './modules/auth.js';
import { initManualViewer } from './modules/manual.js';
import { computeKpiMetrics, renderKpiBar } from './modules/kpi.js';
import { 
  evaluatePackaging, 
  fetchPackagingStandards, 
  getStandardSpq, 
  getAllStandards, 
  savePackagingStandard 
} from './modules/packaging.js';
import { openTrackingModal } from './modules/courier.js';
import { exportToExcel, handleExcelFileSelect, executeBatchUpload } from './modules/excel.js';
import { recordAuditLog, renderAuditHistory } from './modules/audit.js';
import { computeQuotation, computeAllocatedOverheadRate, computeFxVariance } from './calculator.js';


let rawFxRate = 1380.0;
let appliedFxRate = 1380.0;
let activeTab = 'sales';
let editingItemId = null;
let targetSplitId = null;

function safeAddListener(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

export async function bootstrap() {
  const entryDateEl = document.getElementById('inputEntryDate');
  if (entryDateEl) entryDateEl.value = new Date().toISOString().slice(0, 10);

  try {
    const fxRes = await fetch('/api/fx-rate');
    const fxData = await fxRes.json();
    rawFxRate = fxData.current_rate;
  } catch (err) {
    console.warn("FX 기본값 유지", err);
  }
  updateFxDisplay();

  await fetchPackagingStandards();
  renderPackagingTable();

  bindTabSwitch();
  bindInputs();
  bindModals();
  initManualViewer();

  initAuth(async (session, canEdit) => {
    updateFormVisibility(canEdit);
    if (session) {
      await refreshInventory();
    } else {
      renderInventoryUI([], activeTab, () => {}, () => {}, () => {}, false);
    }
  });

  runEngine();
  initDynamicFormTabs();
  if (activeTab === 'sales') {
    document.getElementById('formSection')?.classList.add('hidden');
  }
}

function bindTabSwitch() {
  const tabSales = document.getElementById('tabSales');
  const tabFulfillment = document.getElementById('tabFulfillment');
  const salesPanel = document.getElementById('salesQuotationPanel');
  const formSection = document.getElementById('formSection');
  const csHeaderDesc = document.getElementById('csHeaderDesc');

  tabSales?.addEventListener('click', () => {
    activeTab = 'sales';
    tabSales.className = "py-2 px-2 sm:px-4 text-[11px] sm:text-xs font-bold rounded-lg bg-indigo-600 text-white shadow-sm text-center transition-colors";
    if (tabFulfillment) tabFulfillment.className = "py-2 px-2 sm:px-4 text-[11px] sm:text-xs font-semibold rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 text-center transition-colors";
    
    // 영업 탭: 계산기 노출, 입력 폼 숨김
    salesPanel?.classList.remove('hidden');
    formSection?.classList.add('hidden');

    if (csHeaderDesc) csHeaderDesc.innerText = "부품별 실시간 마진 계산 및 보유 재고 현황을 확인합니다.";
    applyFilters();
  });

  tabFulfillment?.addEventListener('click', () => {
    activeTab = 'fulfillment';
    tabFulfillment.className = "py-2 px-2 sm:px-4 text-[11px] sm:text-xs font-bold rounded-lg bg-indigo-600 text-white shadow-sm text-center transition-colors";
    if (tabSales) tabSales.className = "py-2 px-2 sm:px-4 text-[11px] sm:text-xs font-semibold rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 text-center transition-colors";
    
    // 채권/출하 탭: 계산기 숨김, 통합 관리 폼 노출
    salesPanel?.classList.add('hidden');
    formSection?.classList.remove('hidden');

    if (csHeaderDesc) csHeaderDesc.innerText = "수주 등록, 재고 배정, 출하 스케줄, 세금계산서 및 채권 결제 만기를 통합 관리합니다.";
    updateFormVisibility(isCsOrAdminUser());
    applyFilters();
  });
}

function updateFormVisibility(canEdit) {
  const formSection = document.getElementById('formSection');
  const formTitle = document.getElementById('formTitle');
  const formSubtitle = document.getElementById('formSubtitle');
  const salesFields = document.querySelectorAll('.sales-only-field');
  const fulfillmentFields = document.querySelectorAll('.fulfillment-only-field');
  const saveBtn = document.getElementById('saveItemBtn');

  // 영업 탭일 때는 폼 자체를 숨김
  if (activeTab === 'sales') {
    formSection?.classList.add('hidden');
    return;
  }

  // 출하/채권 관리 탭일 때는 모든 입력 필드(수주/배정 + 출하/정산)를 통합 노출
  formSection?.classList.remove('hidden');
  if (formTitle) formTitle.innerText = "수주 등록 / 재고 배정 및 출하·정산 관리";
  if (formSubtitle) formSubtitle.innerText = "고객사 수주 배정 물량, 단가, 출고(송장) 및 세금계산서/채권 만기를 통합 설정합니다.";
  if (saveBtn) saveBtn.innerText = "정보 저장 및 업데이트";

  salesFields.forEach(el => el.classList.remove('hidden'));
  fulfillmentFields.forEach(el => el.classList.remove('hidden'));

  if (!canEdit) {
    if (saveBtn) saveBtn.classList.add('hidden');
    document.querySelectorAll('#formSection input, #formSection select').forEach(inp => {
      inp.disabled = true;
      inp.classList.add('bg-slate-50', 'cursor-default');
    });
  } else {
    if (saveBtn) saveBtn.classList.remove('hidden');
    document.querySelectorAll('#formSection input, #formSection select').forEach(inp => {
      inp.disabled = false;
      inp.classList.remove('bg-slate-50', 'cursor-default');
    });
  }
}

function updateFxDisplay() {
  const bufferEl = document.getElementById('fxBufferSelect');
  const buffer = bufferEl ? (parseFloat(bufferEl.value) || 0) : 0;
  appliedFxRate = rawFxRate + buffer;
  const bufferText = buffer > 0 ? ` (+${buffer}원)` : "";
  const liveFxEl = document.getElementById('liveFx');
  if (liveFxEl) {
    liveFxEl.innerText = `$1.00 (₩${Math.round(appliedFxRate).toLocaleString()})${bufferText}`;
  }
  runEngine();
  if (activeTab === 'sales') {
    document.getElementById('formSection')?.classList.add('hidden');
  }
}

function updateSpqNotice() {
  const stockEl = document.getElementById('inputStock');
  const spqEl = document.getElementById('inputSpq');
  const container = document.getElementById('spqFeedbackContainer');
  if (!stockEl || !container) return;

  const qty = parseInt(stockEl.value) || 0;
  const spq = parseInt(spqEl?.value) || 0;
  const res = evaluatePackaging(qty, spq);

  if (res.isValid || qty === 0 || spq === 0) {
    container.classList.add('hidden');
    container.innerHTML = '';
  } else {
    container.classList.remove('hidden');
    container.innerHTML = `
      <div class="p-1.5 bg-amber-50 border border-amber-200 rounded-lg text-[10px] space-y-1">
        <div class="text-amber-800 font-bold flex items-center justify-between">
          <span>⚠️ Reel 포장단위(${res.spq.toLocaleString()} EA) 불일치</span>
          <span class="text-rose-600 font-black">-${res.missingForFullReel.toLocaleString()} EA 자투리</span>
        </div>
        <div class="flex items-center gap-1 pt-0.5">
          <button type="button" class="spq-fix-btn flex-1 bg-white hover:bg-amber-100 text-slate-700 font-bold py-0.5 px-1 rounded border border-amber-300 transition-colors" data-target="${res.downQty}">
            ${res.downQty.toLocaleString()} EA 하향
          </button>
          <button type="button" class="spq-fix-btn flex-1 bg-amber-600 hover:bg-amber-700 text-white font-bold py-0.5 px-1 rounded transition-colors" data-target="${res.upQty}">
            ${res.upQty.toLocaleString()} EA 상향
          </button>
        </div>
      </div>
    `;
    container.querySelectorAll('.spq-fix-btn').forEach(btn => {
      btn.onclick = () => {
        stockEl.value = btn.dataset.target;
        updateSpqNotice();
        runEngine();
      };
    });
  }
}

function renderPackagingTable() {
  const tbody = document.getElementById('packagingConfigTbody');
  if (!tbody) return;
  const standards = getAllStandards();
  const keys = Object.keys(standards);
  if (keys.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-slate-400">등록된 라인별 CS 포장 기준이 없습니다.</td></tr>';
    return;
  }
  tbody.innerHTML = keys.map(k => {
    const item = standards[k];
    return `
      <tr class="hover:bg-indigo-50/50">
        <td class="py-2 px-2 font-bold text-slate-900">${k}</td>
        <td class="py-2 px-2 font-semibold text-indigo-700">${item.csManager || '-'}</td>
        <td class="py-2 px-2 font-bold text-slate-800">${item.spq ? item.spq.toLocaleString() + ' EA' : '-'}</td>
        <td class="py-2 px-2 text-slate-600">${item.moq ? item.moq.toLocaleString() + ' EA' : '-'}</td>
        <td class="py-2 px-2 text-slate-500 text-[11px]">${item.memo || '-'}</td>
      </tr>
    `;
  }).join('');
}



function switchSubFormTab(tabName) {
  const btnOrder = document.getElementById('subTabOrder');
  const btnShip = document.getElementById('subTabShipping');
  const btnBill = document.getElementById('subTabBilling');

  const secOrder = document.getElementById('stepOrderSection');
  const secShip = document.getElementById('stepShippingSection');
  const secBill = document.getElementById('stepBillingSection');

  const activeStyle = "flex-1 py-1.5 rounded-lg bg-white text-indigo-900 shadow-sm transition-all text-center font-bold";
  const inactiveStyle = "flex-1 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 transition-all text-center font-semibold";

  if (btnOrder) btnOrder.className = (tabName === 'order') ? activeStyle : inactiveStyle;
  if (btnShip) btnShip.className = (tabName === 'shipping') ? activeStyle : inactiveStyle;
  if (btnBill) btnBill.className = (tabName === 'billing') ? activeStyle : inactiveStyle;

  secOrder?.classList.toggle('hidden', tabName !== 'order');
  secShip?.classList.toggle('hidden', tabName !== 'shipping');
  secBill?.classList.toggle('hidden', tabName !== 'billing');
}


function bindInputs() {
  // 🗂️ 폼 서브탭 전환 리스너
  safeAddListener('subTabOrder', 'click', () => switchSubFormTab('order'));
  safeAddListener('subTabShipping', 'click', () => switchSubFormTab('shipping'));
  safeAddListener('subTabBilling', 'click', () => switchSubFormTab('billing'));

  ['inputUsd', 'inputStock', 'inputShipFx', 'inputOverhead', 'inputTargetOffer', 'inputApprovedDebit'].forEach(id => {
    safeAddListener(id, 'input', runEngine);
  });

  safeAddListener('inputStock', 'input', updateSpqNotice);
  safeAddListener('inputSpq', 'input', updateSpqNotice);

  safeAddListener('selectMaker', 'change', () => {
    const maker = document.getElementById('selectMaker')?.value;
    const spqEl = document.getElementById('inputSpq');
    if (spqEl) {
      const csSpq = getStandardSpq(maker);
      spqEl.value = csSpq !== null ? csSpq : '';
    }
    updateSpqNotice();
  });

  safeAddListener('openPackagingConfigBtn', 'click', () => {
    if (!isCsOrAdminUser()) {
      alert("포장단위 기준 마스터 관리는 CS 및 관리자 권한만 가능합니다.");
      return;
    }
    renderPackagingTable();
    document.getElementById('packagingConfigModal')?.classList.remove('hidden');
  });

  const pkgConfigForm = document.getElementById('packagingConfigForm');
  if (pkgConfigForm) {
    pkgConfigForm.onsubmit = async (e) => {
      e.preventDefault();
      const maker = document.getElementById('pkgConfigMaker')?.value;
      const cs = document.getElementById('pkgConfigCs')?.value.trim();
      const spq = document.getElementById('pkgConfigSpq')?.value;
      const moq = document.getElementById('pkgConfigMoq')?.value;
      const memo = document.getElementById('pkgConfigMemo')?.value.trim();

      try {
        await savePackagingStandard(maker, cs, spq, moq, memo);
        alert(`[${maker}] 라인의 CS 포장 단위 기준이 성공적으로 저장되었습니다.`);
        renderPackagingTable();
        const curMaker = document.getElementById('selectMaker')?.value;
        if (curMaker === maker) {
          const spqInp = document.getElementById('inputSpq');
          if (spqInp) spqInp.value = spq || '';
          updateSpqNotice();
        }
      } catch (err) {
        alert("저장 실패: " + err.message);
      }
    };
  }

  safeAddListener('fxBufferSelect', 'change', updateFxDisplay);
  safeAddListener('copyQuoteBtn', 'click', copyQuotation);

  // 📊 KPI 서머리 바 토글
  safeAddListener('toggleKpiBtn', 'click', () => {
    const bar = document.getElementById('kpiSummaryBar');
    const arrow = document.getElementById('kpiToggleArrow');
    if (!bar) return;
    const isHidden = bar.classList.toggle('hidden');
    if (arrow) {
      arrow.innerText = isHidden ? '▼' : '▲';
    }
  });

  const spaCheck = document.getElementById('checkIsSpa');
  const spaDebitWrapper = document.getElementById('spaDebitWrapper');
  spaCheck?.addEventListener('change', () => {
    spaDebitWrapper?.classList.toggle('hidden', !spaCheck.checked);
    runEngine();
  });

  safeAddListener('inputSettledFx', 'input', updateFxVarianceFeedback);

  bindCustomSelect('selectMaker', 'inputCustomMaker', '__CUSTOM_MAKER__');
  bindCustomSelect('selectOwner', 'inputCustomOwner', '__CUSTOM_OWNER__');

  ['searchInput', 'filterMaker', 'filterOwner', 'filterPayment'].forEach(id => {
    safeAddListener(id, 'input', applyFilters);
    safeAddListener(id, 'change', applyFilters);
  });

  safeAddListener('saveItemBtn', 'click', saveCurrentForm);
  safeAddListener('resetFormSelectionBtn', 'click', resetCurrentForm);
  safeAddListener('openLandedCostBtn', 'click', () => {
    document.getElementById('landedCostModal')?.classList.remove('hidden');
  });

  safeAddListener('excelExportBtn', 'click', () => {
    try {
      const q = document.getElementById('searchInput')?.value || "";
      const maker = document.getElementById('filterMaker')?.value || "";
      const owner = document.getElementById('filterOwner')?.value || "";
      const pay = document.getElementById('filterPayment')?.value || "";

      const filtered = filterItems({
        query: q,
        filterMaker: maker,
        filterOwner: owner,
        filterPayment: pay
      });

      exportToExcel(filtered);
    } catch (err) {
      console.error("[Excel Export Error]", err);
      alert("엑셀 다운로드 중 오류가 발생했습니다: " + err.message);
    }
  });

  const fileInp = document.getElementById('excelFileInput');
  fileInp?.addEventListener('change', (e) => {
    if (!isCsOrAdminUser()) {
      alert("패킹리스트 일괄 업로드는 CS 및 관리자 권한만 가능합니다.");
      fileInp.value = "";
      return;
    }
    const file = e.target.files?.[0];
    if (file) {
      handleExcelFileSelect(file);
      fileInp.value = "";
    }
  });

  safeAddListener('excelConfirmUploadBtn', 'click', async () => {
    const btn = document.getElementById('excelConfirmUploadBtn');
    if (btn) btn.disabled = true;
    try {
      const count = await executeBatchUpload();
      alert(`[업로드 완료] ${count.toLocaleString()}건의 부품 데이터가 클라우드에 성공적으로 등록되었습니다.`);
      document.getElementById('excelPreviewModal')?.classList.add('hidden');
      await refreshInventory();
    } catch (err) {
      alert("일괄 업로드 실패: " + err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

function updateFxVarianceFeedback() {
  const orderFx = parseFloat(document.getElementById('inputShipFx')?.value) || 1350;
  const settledFx = parseFloat(document.getElementById('inputSettledFx')?.value) || 0;
  const soldPrice = parseFloat(document.getElementById('inputSoldPrice')?.value) || 0;
  const stock = parseInt(document.getElementById('inputStock')?.value) || 0;
  const display = document.getElementById('fxVarianceDisplay');

  if (!display) return;

  if (settledFx > 0 && soldPrice > 0 && stock > 0) {
    const diffKrw = computeFxVariance(soldPrice, stock, orderFx, settledFx);
    if (diffKrw > 0) {
      display.className = "text-[11px] font-bold text-green-600 block mt-1";
      display.innerText = `📈 환차익: +₩${Math.round(diffKrw).toLocaleString()} 발생 (수금 환율 +${(settledFx - orderFx).toFixed(1)}원)`;
    } else if (diffKrw < 0) {
      display.className = "text-[11px] font-bold text-red-600 block mt-1";
      display.innerText = `📉 환차손: -₩${Math.round(Math.abs(diffKrw)).toLocaleString()} 발생 (수금 환율 ${(settledFx - orderFx).toFixed(1)}원)`;
    } else {
      display.className = "text-[11px] font-semibold text-slate-500 block mt-1";
      display.innerText = `환율 변동 없음 (₩0)`;
    }
  } else {
    display.innerText = "";
  }
}

function bindCustomSelect(selectId, inputId, customVal) {
  const sel = document.getElementById(selectId);
  const inp = document.getElementById(inputId);
  if (!sel || !inp) return;
  sel.addEventListener('change', () => {
    inp.classList.toggle('hidden', sel.value !== customVal);
    if (sel.value === customVal) inp.focus();
  });
}

function bindModals() {
  const landedCostForm = document.getElementById('landedCostForm');
  if (landedCostForm) {
    landedCostForm.onsubmit = (e) => {
      e.preventDefault();
      const totalGoods = parseFloat(document.getElementById('lcTotalGoodsUsd')?.value) || 0;
      const totalFreight = parseFloat(document.getElementById('lcFreightUsd')?.value) || 0;
      const totalCustomsKrw = parseFloat(document.getElementById('lcCustomsKrw')?.value) || 0;
      const shipFxEl = document.getElementById('inputShipFx');
      const fxRate = shipFxEl ? (parseFloat(shipFxEl.value) || 1350) : 1350;

      const totalCustomsUsd = totalCustomsKrw / fxRate;
      const totalOverheadUsd = totalFreight + totalCustomsUsd;

      const calculatedOverheadRate = computeAllocatedOverheadRate(totalGoods, totalOverheadUsd);
      const overheadInput = document.getElementById('inputOverhead');
      if (overheadInput) overheadInput.value = calculatedOverheadRate.toFixed(2);
      
      const overheadDisplay = document.getElementById('overheadDisplay');
      if (overheadDisplay) overheadDisplay.innerText = `+${calculatedOverheadRate.toFixed(2)}% 배부됨`;

      document.getElementById('landedCostModal')?.classList.add('hidden');
      runEngine();
      alert(`[배부 완료] 선적 총액($${totalGoods.toLocaleString()}) 대비 부대비용 가산율 +${calculatedOverheadRate.toFixed(2)}%가 원가에 자동 적용되었습니다.`);
    };
  }

  const splitShipmentForm = document.getElementById('splitShipmentForm');
  if (splitShipmentForm) {
    splitShipmentForm.onsubmit = async (e) => {
      e.preventDefault();
      if (!isCsOrAdminUser()) return;
      const qty = parseInt(document.getElementById('splitQtyInput')?.value) || 0;
      const price = parseFloat(document.getElementById('splitPriceInput')?.value) || 0;
      const cust = document.getElementById('splitCustomerInput')?.value.trim();
      const rep = document.getElementById('splitRepInput')?.value;
      const deadStockAction = document.getElementById('splitDeadStockSelect')?.value || 'maintain';

      try {
        await splitInventoryShipment(targetSplitId, qty, price, cust, rep, deadStockAction);
        await recordAuditLog(targetSplitId, document.getElementById('splitModalTitle')?.innerText || '부품', 'SPLIT', `출하 분할: ${qty.toLocaleString()} EA -> [${cust}] (판매가 $${price}, 잔여: ${deadStockAction})`);
        alert(`${qty.toLocaleString()}개가 [${cust}] 건으로 분할 출하 등록되었습니다.`);
        document.getElementById('splitShipmentModal')?.classList.add('hidden');
        await refreshInventory();
      } catch (err) {
        alert("분할 실패: " + err.message);
      }
    };
  }
}

function runEngine() {
  const unitUsd = parseFloat(document.getElementById('inputUsd')?.value) || 0;
  const stock = parseFloat(document.getElementById('inputStock')?.value) || 0;
  const shipFx = parseFloat(document.getElementById('inputShipFx')?.value) || 0;
  const overhead = (parseFloat(document.getElementById('inputOverhead')?.value) || 0) / 100;
  const targetOffer = parseFloat(document.getElementById('inputTargetOffer')?.value) || 0;

  const isSpa = document.getElementById('checkIsSpa')?.checked || false;
  const approvedDebit = parseFloat(document.getElementById('inputApprovedDebit')?.value) || 0;

  const result = computeQuotation({
    unitUsd,
    qty: stock,
    shipFx,
    overheadRate: overhead,
    targetMarginRate: 0.20,
    appliedFxRate,
    targetOfferUsd: targetOffer,
    isSpa,
    approvedDebitUsd: approvedDebit
  });

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerText = val;
  };

  setText('minSaleUnitActualUsd', `$${result.unitMinPriceActualUsd.toFixed(4)}`);
  setText('minSaleUnitActualKrw', `(₩${Math.round(result.unitMinPriceActualKrw).toLocaleString()} / @${Math.round(shipFx).toLocaleString()})`);
  setText('minSaleTotalActual', `$${result.totalMinPriceActualUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} (₩${Math.round(result.totalActualCostKrw / (1 - 0.2)).toLocaleString()})`);

  setText('minSaleUnitReplaceUsd', `$${result.unitMinPriceReplaceUsd.toFixed(4)}`);
  setText('minSaleUnitReplaceKrw', `(₩${Math.round(result.unitMinPriceReplaceKrw).toLocaleString()} / @${Math.round(appliedFxRate).toLocaleString()})`);
  setText('minSaleTotalReplace', `$${result.totalMinPriceReplaceUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} (₩${Math.round(result.totalReplaceCostKrw / (1 - 0.2)).toLocaleString()})`);

  const revMarginEl = document.getElementById('reverseMarginReplace');
  const revBadgeEl = document.getElementById('reverseMarginBadge');
  if (result.expectedMargin !== null) {
    if (revMarginEl) revMarginEl.innerText = `${result.expectedMargin.toFixed(2)}%`;
    if (revBadgeEl) {
      if (isSpa && approvedDebit > 0) {
        revBadgeEl.className = "text-[11px] font-bold text-cyan-800 bg-cyan-100 border border-cyan-300 px-2 py-0.5 rounded-full inline-block mt-0.5";
        revBadgeEl.innerText = `🔵 SPA 승인가 적용`;
      } else if (result.expectedMargin >= 20) {
        revBadgeEl.className = "text-[11px] font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full inline-block mt-0.5";
        revBadgeEl.innerText = "✅ 수주 가능";
      } else if (result.expectedMargin > 0) {
        revBadgeEl.className = "text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full inline-block mt-0.5";
        revBadgeEl.innerText = "⚠️ 마진 미달";
      } else {
        revBadgeEl.className = "text-[11px] font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full inline-block mt-0.5";
        revBadgeEl.innerText = "🚨 역마진 불가";
      }
    }
  } else {
    if (revMarginEl) revMarginEl.innerText = "- %";
    if (revBadgeEl) {
      revBadgeEl.className = "text-[11px] font-bold text-slate-400 mt-0.5";
      revBadgeEl.innerText = "단가를 입력하세요";
    }
  }

  renderTierTable(result.unitMinPriceReplaceUsd, result.unitMinPriceReplaceKrw, stock);
}

function renderTierTable(unitUsd, unitKrw, currentQty) {
  const tiers = [
    { label: "1,000", qty: 1000 },
    { label: "5,000", qty: 5000 },
    { label: "10,000", qty: 10000 }
  ];

  if (![1000, 5000, 10000].includes(currentQty) && currentQty > 0) {
    tiers.push({ label: `${currentQty.toLocaleString()}(현재)`, qty: currentQty, isCurrent: true });
    tiers.sort((a, b) => a.qty - b.qty);
  }

  const tbody = document.getElementById('tierTableBody');
  if (!tbody) return;
  tbody.innerHTML = tiers.map(t => `
    <tr class="${t.isCurrent ? "bg-indigo-50/70 font-bold text-indigo-900" : ""}">
      <td class="py-1 px-1">${t.label}</td>
      <td class="py-1 px-1 text-indigo-950 font-black text-xs">$${unitUsd.toFixed(4)}</td>
      <td class="py-1 px-1 text-slate-600 font-semibold text-[11px]">₩${Math.round(unitKrw).toLocaleString()}</td>
      <td class="py-1 px-1 text-slate-800 font-bold">$${(unitUsd * t.qty).toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})}</td>
    </tr>
  `).join('');
}

async function refreshInventory() {
  try {
    const items = await fetchInventoryItems();
    const kpiMetrics = computeKpiMetrics(items, rawFxRate);
    renderKpiBar(kpiMetrics);
    applyFilters();
  } catch (err) {
    console.error("데이터 로드 실패", err);
  }
}

function applyFilters() {
  const searchInput = document.getElementById('searchQuery');
  const lineFilter = document.getElementById('filterLine');
  const salesFilter = document.getElementById('filterSales');
  const statusFilter = document.getElementById('filterStatus');

  const q = (searchInput?.value || '').trim().toLowerCase();
  const selectedLine = lineFilter?.value || 'ALL';
  const selectedSales = salesFilter?.value || 'ALL';
  const selectedStatus = statusFilter?.value || 'ALL';

    // 캐시 데이터 안전 참조
  const sourceItems = (typeof cachedItems !== 'undefined' && Array.isArray(cachedItems) && cachedItems.length > 0)
    ? cachedItems
    : (window.cachedItems || []);
  let filtered = sourceItems.slice();

  // 1. 키워드 검색 (품번, 제조사, 계약처, 실고객사, D/C, 송장, 비고 전방위 검색)
  if (q) {
    filtered = filtered.filter(item => {
      const part = String(item.partName || '').toLowerCase();
      const maker = String(item.maker || '').toLowerCase();
      const cust = String(item.customer || '').toLowerCase();
      const realCust = String(item.realCustomer || '').toLowerCase();
      const dc = String(item.dateCode || '').toLowerCase();
      const track = String(item.trackingNo || '').toLowerCase();
      const po = String(item.poNo || '').toLowerCase();
      const memo = String(item.memo || '').toLowerCase();

      return part.includes(q) ||
             maker.includes(q) ||
             cust.includes(q) ||
             realCust.includes(q) ||
             dc.includes(q) ||
             track.includes(q) ||
             po.includes(q) ||
             memo.includes(q);
    });
  }

  // 2. 라인/제조사 필터
  if (selectedLine !== 'ALL' && selectedLine !== '전체' && selectedLine !== '') {
    filtered = filtered.filter(item => item.maker === selectedLine);
  }

  // 3. 담당 Sales 필터
  if (selectedSales !== 'ALL' && selectedSales !== '전체' && selectedSales !== '') {
    filtered = filtered.filter(item => item.owner === selectedSales);
  }

  // 4. 수금/상태 필터
  if (selectedStatus !== 'ALL' && selectedStatus !== '전체' && selectedStatus !== '') {
    if (selectedStatus === '미수' || selectedStatus === '완료') {
      filtered = filtered.filter(item => item.paymentStatus === selectedStatus);
    } else {
      filtered = filtered.filter(item => item.orderStatus === selectedStatus);
    }
  }

    const countBadge = document.getElementById('filterCountBadge');
  if (countBadge) {
    countBadge.innerText = `총 ${filtered.length.toLocaleString()}건`;
  }

  callRenderInventoryList(filtered);
}

function loadFormFromItem(id) {
  const item = getCachedItem(id);
  if (!item) return;

  // 영업 탭인 경우: 계산기 입력창에 바로 해당 부품 스펙을 채워 빠른 견적 산출 지원
  if (activeTab === 'sales') {
    const unitUsdInp = document.getElementById('inputUsd');
    const stockInp = document.getElementById('inputStock');
    const shipFxInp = document.getElementById('inputShipFx');
    if (unitUsdInp) unitUsdInp.value = item.unitUsd;
    if (stockInp) stockInp.value = item.stock;
    if (shipFxInp) shipFxInp.value = item.shipFx;
    
    // 계산기 즉시 재연산
    runEngine();
    document.getElementById('salesQuotationPanel')?.scrollIntoView({ behavior: 'smooth' });
    return;
  }

  if (!isCsOrAdminUser()) return;
  if (!item) return;

  editingItemId = item.id;

  setSelectValue('selectMaker', 'inputCustomMaker', item.maker, '__CUSTOM_MAKER__');
  setSelectValue('selectOwner', 'inputCustomOwner', item.owner, '__CUSTOM_OWNER__');
  
  const setVal = (inputKey, val) => {
    const el = document.getElementById(inputKey);
    if (el) el.value = val;
  };

  setVal('inputPartName', item.partName);
  setVal('inputDateCode', item.dateCode !== '-' ? item.dateCode : '');
  setVal('inputCustomer', item.customer !== '-' ? item.customer : '');
  setVal('inputRealCustomer', item.realCustomer !== '-' ? item.realCustomer : '');
  setVal('inputPoNo', item.poNo || '');
  setVal('inputApplication', item.application || '');
  setVal('inputTaxDate', item.taxDate || '');
  setVal('selectBizType', item.bizType || 'DOMESTIC');
  setVal('inputSoldPrice', item.soldPriceUsd || '');
  setVal('selectOrderStatus', item.orderStatus);
  setVal('selectPaymentTerms', item.paymentTerms);
  setVal('selectPaymentStatus', item.paymentStatus);
  setVal('selectCurrency', item.currency);
  setVal('inputInvoiceNo', item.invoiceNo || '');
  setVal('inputTrackingNo', item.trackingNo || '');
  setVal('inputDueDate', item.dueDate || '');
  setVal('inputShippedDate', item.shippedDate || '');
  setVal('inputSettledDate', item.settledDate || '');
  setVal('inputSettledFx', item.settledFx || '');
  setVal('inputEntryDate', item.entryDate);
  setVal('inputMemo', item.memo);
  setVal('inputUsd', item.unitUsd);
  setVal('inputShipFx', item.shipFx);
  setVal('inputStock', item.stock || '');
  setVal('inputSpq', item.spq || getStandardSpq(item.maker) || '');

  const spaCheck = document.getElementById('checkIsSpa');
  const spaDebitWrapper = document.getElementById('spaDebitWrapper');
  if (spaCheck) {
    spaCheck.checked = item.isSpa;
    spaDebitWrapper?.classList.toggle('hidden', !item.isSpa);
    if (item.isSpa) setVal('inputApprovedDebit', item.approvedDebitUsd || '');
  }

  const editingBanner = document.getElementById('editingBanner');
  editingBanner?.classList.remove('hidden');
  const bannerText = document.getElementById('editingBannerText');
  if (bannerText) {
    bannerText.innerText = `선택된 항목: [${item.maker}] ${item.partName} (D/C: ${item.dateCode} / ${item.customer})`;
  }

  updateFxVarianceFeedback();
  updateSpqNotice();
  runEngine();

  if (item && item.id) {
    renderAuditHistory('auditHistoryContainer', item.id, item.partName);
  }
  document.getElementById('formSection')?.scrollIntoView({ behavior: 'smooth' });
}

export function resetCurrentForm() {
  const titleEl = document.getElementById('selectedPartTitle');
  const badgeEl = document.getElementById('selectedPartBadge');
  if (titleEl) titleEl.innerText = "신규 부품 등록 / 배정 모드";
  if (badgeEl) badgeEl.classList.add('hidden');
  editingItemId = null;
  const banner = document.getElementById('editingBanner');
  if (banner) banner.classList.add('hidden');

  const auditContainer = document.getElementById('auditHistoryContainer');
  if (auditContainer) {
    auditContainer.classList.add('hidden');
    auditContainer.innerHTML = '';
  }

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };

  setVal('inputPartName', '');
  setVal('inputDateCode', '');
  setVal('inputCustomer', '');
  setVal('inputRealCustomer', '');
  setVal('inputPoNo', '');
  setVal('inputApplication', '');
  setVal('inputTaxDate', '');
  setVal('selectBizType', 'DOMESTIC');
  setVal('inputSoldPrice', '');
  setVal('inputInvoiceNo', '');
  setVal('inputTrackingNo', '');
  setVal('inputDueDate', '');
  setVal('inputShippedDate', '');
  setVal('inputSettledDate', '');
  setVal('inputSettledFx', '');
  setVal('inputMemo', '');
  setVal('inputStock', '');
  setVal('inputSpq', '');
  setVal('inputUsd', '');

  const spqContainer = document.getElementById('spqFeedbackContainer');
  if (spqContainer) {
    spqContainer.classList.add('hidden');
    spqContainer.innerHTML = '';
  }

  runEngine();
  if (activeTab === 'sales') {
    document.getElementById('formSection')?.classList.add('hidden');
  }
}

function handleOpenSplitModal(id) {
  if (!isCsOrAdminUser()) return;
  const item = getCachedItem(id);
  if (!item) return;
  targetSplitId = item.id;

  const titleEl = document.getElementById('splitModalTitle');
  if (titleEl) titleEl.innerText = `[${item.partName}] 출하 분할 (D/C: ${item.dateCode})`;
  const maxStockEl = document.getElementById('splitMaxStockText');
  if (maxStockEl) maxStockEl.innerText = `현재 보유 재고: ${item.stock.toLocaleString()} EA (소유: ${item.owner})`;
  
  const qtyInput = document.getElementById('splitQtyInput');
  if (qtyInput) {
    qtyInput.max = item.stock - 1;
    qtyInput.value = Math.min(1000, item.stock - 1);
  }
  const priceInput = document.getElementById('splitPriceInput');
  if (priceInput) priceInput.value = item.soldPriceUsd || item.unitUsd;
  const custInput = document.getElementById('splitCustomerInput');
  if (custInput) custInput.value = item.customer !== '-' ? item.customer : '';
  const repInput = document.getElementById('splitRepInput');
  if (repInput) repInput.value = item.owner;

  document.getElementById('splitShipmentModal')?.classList.remove('hidden');
}

function setSelectValue(selectId, inputId, val, customKey) {
  const sel = document.getElementById(selectId);
  const inp = document.getElementById(inputId);
  if (!sel) return;
  const exists = Array.from(sel.options).some(o => o.value === val);
  if (exists && val !== customKey) {
    sel.value = val;
    inp?.classList.add('hidden');
    if (inp) inp.value = '';
  } else {
    sel.value = customKey;
    inp?.classList.remove('hidden');
    if (inp) inp.value = val || '';
  }
}

async function saveCurrentForm() {
  if (!isCsOrAdminUser()) return;

  const partName = document.getElementById('inputPartName')?.value.trim();
  if (!partName) {
    alert("제품명을 입력해주세요.");
    return;
  }

  const makerSel = document.getElementById('selectMaker');
  const maker = (makerSel && makerSel.value === '__CUSTOM_MAKER__') ? document.getElementById('inputCustomMaker')?.value.trim() : makerSel?.value;
  const ownerSel = document.getElementById('selectOwner');
  const owner = (ownerSel && ownerSel.value === '__CUSTOM_OWNER__') ? document.getElementById('inputCustomOwner')?.value.trim() : ownerSel?.value;

  const isSpa = document.getElementById('checkIsSpa')?.checked || false;
  const approvedDebit = parseFloat(document.getElementById('inputApprovedDebit')?.value) || 0;

  const payload = {
    maker: maker || "기타",
    part_name: partName,
    date_code: document.getElementById('inputDateCode')?.value.trim() || "-",
    owner: owner || "본사 일반재고",
    customer: document.getElementById('inputCustomer')?.value.trim() || "-",
    real_customer: document.getElementById('inputRealCustomer')?.value.trim() || "-",
    po_no: document.getElementById('inputPoNo')?.value.trim() || "",
    application: document.getElementById('inputApplication')?.value.trim() || "",
    biz_type: document.getElementById('selectBizType')?.value || "DOMESTIC",
    tax_date: document.getElementById('inputTaxDate')?.value || null,
    sold_price_usd: parseFloat(document.getElementById('inputSoldPrice')?.value) || 0,
    order_status: document.getElementById('selectOrderStatus')?.value || "배정요청",
    payment_terms: document.getElementById('selectPaymentTerms')?.value || "Net 30",
    payment_status: document.getElementById('selectPaymentStatus')?.value || "미수",
    currency: document.getElementById('selectCurrency')?.value || "USD",
    invoice_no: document.getElementById('inputInvoiceNo')?.value.trim() || "",
    tracking_no: document.getElementById('inputTrackingNo')?.value.trim() || "",
    due_date: document.getElementById('inputDueDate')?.value || null,
    shipped_date: document.getElementById('inputShippedDate')?.value || null,
    settled_date: document.getElementById('inputSettledDate')?.value || null,
    settled_fx: parseFloat(document.getElementById('inputSettledFx')?.value) || 0,
    entry_date: document.getElementById('inputEntryDate')?.value || new Date().toISOString().slice(0, 10),
    memo: document.getElementById('inputMemo')?.value.trim() || "",
    unit_usd: parseFloat(document.getElementById('inputUsd')?.value) || 0,
    ship_fx: parseFloat(document.getElementById('inputShipFx')?.value) || 1350,
    stock: parseInt(document.getElementById('inputStock')?.value) || 0,
    spq: parseInt(document.getElementById('inputSpq')?.value) || null,
    margin: 20,
    is_spa: isSpa,
    approved_debit_usd: isSpa ? approvedDebit : 0
  };

  try {
    const isNew = !editingItemId;
    const oldItem = editingItemId ? getCachedItem(editingItemId) : null;
    const savedItem = await upsertInventoryItem(payload, editingItemId);
    const targetId = editingItemId || savedItem?.id;

    let auditDetail = "";
    if (isNew) {
      auditDetail = `신규 등록: ${payload.maker} / ${payload.stock.toLocaleString()} EA / 매입원가 $${payload.unit_usd}`;
    } else {
      const changes = [];
      if (oldItem && oldItem.stock !== payload.stock) {
        changes.push(`수량: ${oldItem.stock.toLocaleString()} -> ${payload.stock.toLocaleString()} EA`);
      }
      if (oldItem && oldItem.soldPriceUsd !== payload.sold_price_usd) {
        changes.push(`판매가: $${oldItem.soldPriceUsd} -> $${payload.sold_price_usd}`);
      }
      if (oldItem && oldItem.orderStatus !== payload.order_status) {
        changes.push(`상태: ${oldItem.orderStatus} -> ${payload.order_status}`);
      }
      if (oldItem && oldItem.trackingNo !== payload.tracking_no) {
        changes.push(`송장번호: ${oldItem.trackingNo || '없음'} -> ${payload.tracking_no || '없음'}`);
      }
      if (changes.length === 0) {
        changes.push(`기타 정보 수정 (수량 ${payload.stock.toLocaleString()} EA)`);
      }
      auditDetail = changes.join(', ');
    }

    if (targetId) {
      await recordAuditLog(targetId, payload.part_name, isNew ? 'CREATE' : 'UPDATE', auditDetail);
      await renderAuditHistory('auditHistoryContainer', targetId, payload.part_name);
    }

    alert(`[${payload.part_name}] 데이터가 안전하게 저장되었습니다.`);
    await refreshInventory();
  } catch (err) {
    alert("저장 실패: " + err.message);
  }
}

async function handleDeleteItem(id) {
  if (!isCsOrAdminUser()) return;
  if (!confirm("해당 건을 영구 삭제하시겠습니까?")) return;
  try {
    const delTarget = getCachedItem(id);
    await recordAuditLog(id, delTarget?.partName || '부품', 'DELETE', `항목 영구 삭제 (수량: ${delTarget?.stock || 0} EA, 소유: ${delTarget?.owner || '-'})`);
    await safeDeleteInventoryItem(id);
    resetCurrentForm();
    await refreshInventory();
  } catch (err) {
    alert("삭제 실패: " + err.message);
  }
}

function copyQuotation() {
  const partName = document.getElementById('inputPartName')?.value.trim() || "-";
  const dateCode = document.getElementById('inputDateCode')?.value.trim() || "-";
  const qty = parseFloat(document.getElementById('inputStock')?.value) || 0;
  const unitUsd = document.getElementById('minSaleUnitReplaceUsd')?.innerText || "-";
  const unitKrw = document.getElementById('minSaleUnitReplaceKrw')?.innerText || "-";
  const totalReplace = document.getElementById('minSaleTotalReplace')?.innerText || "-";
  const fxRateText = document.getElementById('liveFx')?.innerText || "-";

  const quote = `[견적 안내] ${partName} (D/C: ${dateCode})\n- 수량: ${qty.toLocaleString()} EA\n- 공급단가: ${unitUsd} ${unitKrw}\n- 총견적액: ${totalReplace}\n* 기준환율: ${fxRateText}`;
  navigator.clipboard.writeText(quote).then(() => alert("견적서 텍스트가 복사되었습니다!"));
}

window.resetCurrentForm = resetCurrentForm;

bootstrap();
