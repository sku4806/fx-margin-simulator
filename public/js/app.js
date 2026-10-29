import { getCurrentSession, loginWithEmail, logout, updatePassword, subscribeAuthChange } from './supabase.js';
import { computeQuotation, computeAllocatedOverheadRate, computeFxVariance } from './calculator.js';
import { fetchInventoryItems, upsertInventoryItem, splitInventoryShipment, deleteInventoryItem, filterItems, getCachedItem, renderInventoryUI } from './inventory.js';

let currentSession = null;
let rawFxRate = 1380.0;
let appliedFxRate = 1380.0;
let activeTab = 'sales';
let editingItemId = null;
let targetSplitId = null;
let manualRawText = "";

const ADMIN_EMAILS = [
  'timothy@bigshine.co.kr',
  'tony@bigshine.co.kr',
  'nathan@bigshine.co.kr',
  'jamie@bigshine.co.kr',
  'jane@bigshine.co.kr',
  'lily@bigshine.co.kr',
  'raina@bigshine.co.kr',
  'susan@bigshine.co.kr',
  'trisha@bigshine.co.kr'
];

function isCsOrAdminUser() {
  if (!currentSession || !currentSession.user || !currentSession.user.email) return false;
  const userEmail = currentSession.user.email.toLowerCase().trim();
  return ADMIN_EMAILS.includes(userEmail);
}

function safeAddListener(id, event, handler) {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener(event, handler);
  }
}

export async function bootstrap() {
  const entryDateEl = document.getElementById('inputEntryDate');
  if (entryDateEl) {
    entryDateEl.value = new Date().toISOString().slice(0, 10);
  }

  try {
    const fxRes = await fetch('/api/fx-rate');
    const fxData = await fxRes.json();
    rawFxRate = fxData.current_rate;
  } catch (err) {
    console.warn("FX 기본값 유지", err);
  }
  updateFxDisplay();

  bindTabSwitch();
  bindInputs();
  bindModals();
  initManualViewer();

  currentSession = await getCurrentSession();
  updateAuthUI();
  if (currentSession) {
    await refreshInventory();
  }

  subscribeAuthChange(async (_event, session) => {
    currentSession = session;
    updateAuthUI();
    if (currentSession) {
      await refreshInventory();
    } else {
      renderInventoryUI([], activeTab, () => {}, () => {}, () => {}, false);
    }
  });

  updateFormVisibility();
  runEngine();
}

function bindTabSwitch() {
  const tabSales = document.getElementById('tabSales');
  const tabFulfillment = document.getElementById('tabFulfillment');
  const salesPanel = document.getElementById('salesQuotationPanel');
  const csHeaderDesc = document.getElementById('csHeaderDesc');

  tabSales?.addEventListener('click', () => {
    activeTab = 'sales';
    tabSales.className = "px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white shadow-sm transition-colors";
    if (tabFulfillment) tabFulfillment.className = "px-4 py-2 text-xs font-semibold rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors";
    salesPanel?.classList.remove('hidden');
    if (csHeaderDesc) csHeaderDesc.innerText = "영업 협의 수주 현황 및 실판매가를 확인합니다.";
    updateFormVisibility();
    applyFilters();
  });

  tabFulfillment?.addEventListener('click', () => {
    activeTab = 'fulfillment';
    tabFulfillment.className = "px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white shadow-sm transition-colors";
    if (tabSales) tabSales.className = "px-4 py-2 text-xs font-semibold rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors";
    salesPanel?.classList.add('hidden');
    if (csHeaderDesc) csHeaderDesc.innerText = "출하 스케줄, 운송장/인보이스 번호 및 미수금 만기 일정을 관리합니다.";
    updateFormVisibility();
    applyFilters();
  });
}

function updateFormVisibility() {
  const formTitle = document.getElementById('formTitle');
  const formSubtitle = document.getElementById('formSubtitle');
  const salesFields = document.querySelectorAll('.sales-only-field');
  const fulfillmentFields = document.querySelectorAll('.fulfillment-only-field');
  const saveBtn = document.getElementById('saveItemBtn');
  const formSection = document.getElementById('formSection');

  const canEdit = isCsOrAdminUser();

  if (activeTab === 'sales') {
    if (formTitle) formTitle.innerText = "수주 및 재고 배정 등록 (Sales Order Entry)";
    if (formSubtitle) formSubtitle.innerText = "공식 배정 물량, 협의 단가 및 Date Code를 설정합니다.";
    if (saveBtn) saveBtn.innerText = "수주/배정 저장";
    salesFields.forEach(el => el.classList.remove('hidden'));
    fulfillmentFields.forEach(el => el.classList.add('hidden'));
  } else {
    if (formTitle) formTitle.innerText = "출하 처리 및 세금계산서/정산 등록 (Fulfillment & Billing)";
    if (formSubtitle) formSubtitle.innerText = "실물 출고(송장), 세금계산서(인보이스) 발행 및 채권 결제 만기를 관리합니다.";
    if (saveBtn) saveBtn.innerText = "출하/정산 업데이트";
    salesFields.forEach(el => el.classList.add('hidden'));
    fulfillmentFields.forEach(el => el.classList.remove('hidden'));
  }

  // 💡 관리자가 아니면 '수주/배정 저장' 버튼을 아예 숨김 (티 안 나게 처리)
  if (!canEdit) {
    if (saveBtn) saveBtn.classList.add('hidden');
    // 입력 필드들도 자연스럽게 읽기 전용으로 잠금
    const formInputs = document.querySelectorAll('#formSection input, #formSection select');
    formInputs.forEach(inp => {
      inp.disabled = true;
      inp.classList.add('bg-slate-50', 'cursor-default');
    });
  } else {
    if (saveBtn) saveBtn.classList.remove('hidden');
    const formInputs = document.querySelectorAll('#formSection input, #formSection select');
    formInputs.forEach(inp => {
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
}

function bindInputs() {
  ['inputUsd', 'inputStock', 'inputShipFx', 'inputOverhead', 'inputTargetOffer', 'inputApprovedDebit'].forEach(id => {
    safeAddListener(id, 'input', runEngine);
  });

  safeAddListener('fxBufferSelect', 'change', updateFxDisplay);
  safeAddListener('copyQuoteBtn', 'click', copyQuotation);

  const spaCheck = document.getElementById('checkIsSpa');
  const spaDebitWrapper = document.getElementById('spaDebitWrapper');
  spaCheck?.addEventListener('change', () => {
    if (spaCheck.checked) {
      spaDebitWrapper?.classList.remove('hidden');
    } else {
      spaDebitWrapper?.classList.add('hidden');
    }
    runEngine();
  });

  safeAddListener('inputSettledFx', 'input', updateFxVarianceFeedback);

  bindCustomSelect('selectMaker', 'inputCustomMaker', '__CUSTOM_MAKER__');
  bindCustomSelect('selectOwner', 'inputCustomOwner', '__CUSTOM_OWNER__');

  ['searchInput', 'filterMaker', 'filterOwner', 'filterStatus', 'filterPayment'].forEach(id => {
    safeAddListener(id, 'input', applyFilters);
    safeAddListener(id, 'change', applyFilters);
  });

  safeAddListener('saveItemBtn', 'click', saveCurrentForm);
  safeAddListener('authActionBtn', 'click', handleAuthButton);

  safeAddListener('openLandedCostBtn', 'click', () => {
    document.getElementById('landedCostModal')?.classList.remove('hidden');
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
    if (sel.value === customVal) {
      inp.classList.remove('hidden');
      inp.focus();
    } else {
      inp.classList.add('hidden');
    }
  });
}

function bindModals() {
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.onsubmit = async (e) => {
      e.preventDefault();
      const btn = document.getElementById('loginSubmitBtn');
      const err = document.getElementById('loginErrorMsg');
      if (btn) btn.disabled = true;
      err?.classList.add('hidden');

      try {
        const email = document.getElementById('loginEmail')?.value.trim();
        const pwd = document.getElementById('loginPassword')?.value.trim();
        const { error } = await loginWithEmail(email, pwd);
        if (error) throw error;
        document.getElementById('loginModal')?.classList.add('hidden');
      } catch (error) {
        if (err) {
          err.innerText = "로그인 실패: " + error.message;
          err.classList.remove('hidden');
        }
      } finally {
        if (btn) btn.disabled = false;
      }
    };
  }

  const changePasswordForm = document.getElementById('changePasswordForm');
  if (changePasswordForm) {
    changePasswordForm.onsubmit = async (e) => {
      e.preventDefault();
      const newPwd = document.getElementById('newPasswordInput')?.value.trim();
      const confirmPwd = document.getElementById('confirmPasswordInput')?.value.trim();
      const err = document.getElementById('changePwdErrorMsg');

      if (newPwd !== confirmPwd) {
        if (err) {
          err.innerText = "비밀번호가 일치하지 않습니다.";
          err.classList.remove('hidden');
        }
        return;
      }

      try {
        const { error } = await updatePassword(newPwd);
        if (error) throw error;
        alert("비밀번호가 성공적으로 변경되었습니다.");
        document.getElementById('changePasswordModal')?.classList.add('hidden');
      } catch (error) {
        if (err) {
          err.innerText = error.message;
          err.classList.remove('hidden');
        }
      }
    };
  }

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
      if (!isCsOrAdminUser()) {
        alert("출하 분할은 CS 및 관리자 권한만 실행할 수 있습니다.");
        return;
      }
      const qty = parseInt(document.getElementById('splitQtyInput')?.value) || 0;
      const price = parseFloat(document.getElementById('splitPriceInput')?.value) || 0;
      const cust = document.getElementById('splitCustomerInput')?.value.trim();
      const rep = document.getElementById('splitRepInput')?.value;
      const deadStockAction = document.getElementById('splitDeadStockSelect')?.value || 'maintain';

      try {
        await splitInventoryShipment(targetSplitId, qty, price, cust, rep, deadStockAction);
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
      <td class="py-1.5 px-1">${t.label}</td>
      <td class="py-1.5 px-1 text-indigo-950 font-black text-xs">$${unitUsd.toFixed(4)}</td>
      <td class="py-1.5 px-1 text-slate-600 font-semibold text-[11px]">₩${Math.round(unitKrw).toLocaleString()}</td>
      <td class="py-1.5 px-1 text-slate-800 font-bold">$${(unitUsd * t.qty).toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})}</td>
    </tr>
  `).join('');
}

async function refreshInventory() {
  try {
    await fetchInventoryItems();
    applyFilters();
  } catch (err) {
    console.error("데이터 로드 실패", err);
  }
}

function applyFilters() {
  const canEdit = isCsOrAdminUser();
  const filtered = filterItems({
    query: document.getElementById('searchInput')?.value || "",
    filterMaker: document.getElementById('filterMaker')?.value || "",
    filterOwner: document.getElementById('filterOwner')?.value || "",
    filterStatus: document.getElementById('filterStatus')?.value || "",
    filterPayment: document.getElementById('filterPayment')?.value || ""
  });
  renderInventoryUI(filtered, activeTab, loadFormFromItem, handleDeleteItem, handleOpenSplitModal, canEdit);
}

function loadFormFromItem(id) {
  if (!isCsOrAdminUser()) return; // 관리자가 아니면 수정 모드 진입 안 함
  const item = getCachedItem(id);
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
  setVal('inputStock', item.stock);

  const spaCheck = document.getElementById('checkIsSpa');
  const spaDebitWrapper = document.getElementById('spaDebitWrapper');
  if (spaCheck) {
    spaCheck.checked = item.isSpa;
    if (item.isSpa) {
      spaDebitWrapper?.classList.remove('hidden');
      setVal('inputApprovedDebit', item.approvedDebitUsd || '');
    } else {
      spaDebitWrapper?.classList.add('hidden');
    }
  }

  const editingBanner = document.getElementById('editingBanner');
  editingBanner?.classList.remove('hidden');
  const bannerText = document.getElementById('editingBannerText');
  if (bannerText) {
    bannerText.innerText = `선택된 항목: [${item.maker}] ${item.partName} (D/C: ${item.dateCode} / ${item.customer})`;
  }

  updateFxVarianceFeedback();
  runEngine();
  document.getElementById('formSection')?.scrollIntoView({ behavior: 'smooth' });
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
  if (!currentSession) {
    alert("로그인 후 이용할 수 있습니다.");
    document.getElementById('loginModal')?.classList.remove('hidden');
    return;
  }

  if (!isCsOrAdminUser()) {
    return;
  }

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
    margin: 20,
    is_spa: isSpa,
    approved_debit_usd: isSpa ? approvedDebit : 0
  };

  try {
    await upsertInventoryItem(payload, editingItemId);
    alert(`[${payload.part_name}] 데이터가 안전하게 저장되었습니다.`);
    editingItemId = null;
    document.getElementById('editingBanner')?.classList.add('hidden');
    await refreshInventory();
  } catch (err) {
    alert("저장 실패: " + err.message);
  }
}

async function handleDeleteItem(id) {
  if (!isCsOrAdminUser()) return;
  if (!confirm("해당 건을 영구 삭제하시겠습니까?")) return;
  try {
    await deleteInventoryItem(id);
    editingItemId = null;
    document.getElementById('editingBanner')?.classList.add('hidden');
    await refreshInventory();
  } catch (err) {
    alert("삭제 실패: " + err.message);
  }
}

function updateAuthUI() {
  const isAuth = !!(currentSession && currentSession.user);
  document.getElementById('lockedOverlay')?.classList.toggle('hidden', isAuth);
  document.getElementById('unlockedContent')?.classList.toggle('hidden', !isAuth);
  document.getElementById('changePwdBtn')?.classList.toggle('hidden', !isAuth);

  const badge = document.getElementById('lockStatusBadge');
  const btn = document.getElementById('authActionBtn');
  const sub = document.getElementById('authSubtitle');

  if (isAuth) {
    // 💡 'Sales(조회전용)' 같은 구분 없이 자연스럽게 '사내 인증됨'으로만 표시
    if (badge) {
      badge.className = "text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-900 border border-indigo-200";
      badge.innerHTML = "🔓 사내 인증됨";
    }
    if (sub) sub.innerHTML = `접속 계정: <strong class="text-indigo-700">${currentSession.user.email}</strong>`;
    if (btn) {
      btn.className = "text-xs bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold px-3 py-1.5 rounded-lg transition-colors";
      btn.innerHTML = "🚪 로그아웃";
    }
  } else {
    if (badge) {
      badge.className = "text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full";
      badge.innerHTML = "🔒 로그인 필요";
    }
    if (sub) sub.innerText = "인증된 사내 영업 계정만 원가 및 재고를 조회할 수 있습니다.";
    if (btn) {
      btn.className = "text-xs bg-slate-800 hover:bg-slate-900 active:scale-95 text-white font-semibold px-3.5 py-1.5 rounded-lg transition-transform flex items-center gap-1.5";
      btn.innerHTML = "🔑 사내 계정 로그인";
    }
  }

  updateFormVisibility();
}

function handleAuthButton() {
  if (currentSession) {
    if (confirm("로그아웃하시겠습니까?")) logout();
  } else {
    document.getElementById('loginModal')?.classList.remove('hidden');
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

window.openChangePasswordModal = () => {
  const emailEl = document.getElementById('changePwdUserEmail');
  if (emailEl && currentSession) emailEl.innerText = `계정: ${currentSession.user.email}`;
  document.getElementById('changePasswordModal')?.classList.remove('hidden');
};

function initManualViewer() {
  const openBtn = document.getElementById('openManualBtn');
  const manualModal = document.getElementById('manualModal');
  const contentEl = document.getElementById('manualContent');
  const searchInput = document.getElementById('manualSearchInput');

  openBtn?.addEventListener('click', async () => {
    manualModal?.classList.remove('hidden');
    if (!manualRawText) {
      try {
        const res = await fetch('/BSK_ERP_User_Manual.md');
        manualRawText = await res.text();
        renderManualContent(manualRawText);
      } catch (err) {
        if (contentEl) contentEl.innerText = "매뉴얼을 불러오는 중 오류가 발생했습니다: " + err.message;
      }
    }
  });

  searchInput?.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) {
      renderManualContent(manualRawText);
      return;
    }
    const lines = manualRawText.split('\n');
    const matched = lines.map(line => {
      if (line.toLowerCase().includes(q)) {
        return `<mark class="bg-amber-200 px-1 rounded">${escapeHtml(line)}</mark>`;
      }
      return escapeHtml(line);
    }).join('<br>');
    if (contentEl) contentEl.innerHTML = `<div class="whitespace-pre-line leading-relaxed font-mono">${matched}</div>`;
  });
}

function renderManualContent(text) {
  const contentEl = document.getElementById('manualContent');
  if (!contentEl) return;

  const lines = text.split('\n');
  const html = lines.map(line => {
    let l = escapeHtml(line);
    l = l.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-slate-900">$1</strong>');
    l = l.replace(/\*\*/g, '');
    l = l.replace(/\`(.*?)\`/g, '<code class="bg-indigo-50 text-indigo-700 px-1 py-0.5 rounded text-[11px] font-mono border border-indigo-100">$1</code>');
    l = l.replace(/\[(.*?)\]\((.*?)\)/g, '<span class="text-indigo-600 font-semibold">$1</span>');

    if (line.startsWith('# ')) {
      return `<h1 class="text-base font-black text-indigo-950 mt-4 mb-2 pb-1 border-b border-slate-200">${l.replace(/^#\s*/, '')}</h1>`;
    }
    if (line.startsWith('## ')) {
      return `<h2 class="text-sm font-bold text-indigo-900 mt-4 mb-1.5 flex items-center gap-1.5 bg-slate-100/70 p-1.5 rounded-lg">${l.replace(/^##\s*/, '')}</h2>`;
    }
    if (line.startsWith('### ')) {
      return `<h3 class="text-xs font-bold text-indigo-700 mt-3 mb-1 pl-1 border-l-2 border-indigo-500">${l.replace(/^###\s*/, '')}</h3>`;
    }
    if (line.trim().startsWith('- ')) {
      return `<div class="ml-3 my-1 flex items-start gap-1.5"><span class="text-indigo-500 font-bold">•</span><div>${l.replace(/^\s*-\s*/, '')}</div></div>`;
    }
    if (line.trim().match(/^\d+\.\s/)) {
      return `<div class="ml-3 my-1 flex items-start gap-1.5 font-medium"><span class="text-slate-400 font-bold">•</span><div>${l}</div></div>`;
    }
    if (line.trim() === '---') {
      return '<hr class="my-3 border-slate-200">';
    }
    return line.trim() ? `<div class="leading-relaxed pl-1">${l}</div>` : '<div class="h-1.5"></div>';
  }).join('');

  contentEl.innerHTML = html;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

bootstrap();
