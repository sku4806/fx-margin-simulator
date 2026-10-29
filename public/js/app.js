import { getCurrentSession, loginWithEmail, logout, updatePassword, subscribeAuthChange } from './supabase.js';
import { computeQuotation, computeAllocatedOverheadRate } from './calculator.js';
import { fetchInventoryItems, upsertInventoryItem, splitInventoryShipment, deleteInventoryItem, filterItems, getCachedItem, renderInventoryUI } from './inventory.js';

let currentSession = null;
let rawFxRate = 1380.0;
let appliedFxRate = 1380.0;
let activeTab = 'sales';
let editingItemId = null;
let targetSplitId = null;

// 안전한 이벤트 리스너 헬퍼 (null 요소 참조 에러 원천 차단)
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
      renderInventoryUI([], activeTab, () => {}, () => {}, () => {});
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
    if (csHeaderDesc) csHeaderDesc.innerText = "영업 협의 수주 현황 및 실판매 마진율을 관리합니다.";
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

  if (activeTab === 'sales') {
    if (formTitle) formTitle.innerText = "수주 및 재고 배정 등록 (Sales Order Entry)";
    if (formSubtitle) formSubtitle.innerText = "고객사 수주 물량, 협의 단가 및 마진 방어선을 설정합니다.";
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
  // 존재하는 요소만 안전하게 이벤트 등록 (Uncaught TypeError 원천 방어)
  ['inputUsd', 'inputStock', 'inputShipFx', 'inputOverhead', 'inputTargetOffer'].forEach(id => {
    safeAddListener(id, 'input', runEngine);
  });

  safeAddListener('fxBufferSelect', 'change', updateFxDisplay);
  safeAddListener('copyQuoteBtn', 'click', copyQuotation);

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

  // 선적 부대비용 자동 배부 계산 처리
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

  // 부분 출하 분할 실행 처리
  const splitShipmentForm = document.getElementById('splitShipmentForm');
  if (splitShipmentForm) {
    splitShipmentForm.onsubmit = async (e) => {
      e.preventDefault();
      const qty = parseInt(document.getElementById('splitQtyInput')?.value) || 0;
      const price = parseFloat(document.getElementById('splitPriceInput')?.value) || 0;
      const cust = document.getElementById('splitCustomerInput')?.value.trim();
      const rep = document.getElementById('splitRepInput')?.value;

      try {
        await splitInventoryShipment(targetSplitId, qty, price, cust, rep);
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

  const result = computeQuotation({
    unitUsd,
    qty: stock,
    shipFx,
    overheadRate: overhead,
    targetMarginRate: 0.20,
    appliedFxRate,
    targetOfferUsd: targetOffer
  });

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerText = val;
  };

  setText('minSaleUnitActualUsd', `$${result.unitMinPriceActualUsd.toFixed(4)}`);
  setText('minSaleUnitActualKrw', `(₩${result.unitMinPriceActualKrw.toFixed(1)} / EA)`);
  setText('minSaleTotalActual', `$${result.totalMinPriceActualUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);

  setText('minSaleUnitReplaceUsd', `$${result.unitMinPriceReplaceUsd.toFixed(4)}`);
  setText('minSaleUnitReplaceKrw', `(₩${result.unitMinPriceReplaceKrw.toFixed(1)} / EA)`;
  setText('minSaleTotalReplace', `$${result.totalMinPriceReplaceUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);

  const revMarginEl = document.getElementById('reverseMarginReplace');
  const revBadgeEl = document.getElementById('reverseMarginBadge');
  if (result.expectedMargin !== null) {
    if (revMarginEl) revMarginEl.innerText = `${result.expectedMargin.toFixed(2)}%`;
    if (revBadgeEl) {
      if (result.expectedMargin >= 20) {
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
      <td class="py-1.5 px-1 text-indigo-600 font-semibold">$${unitUsd.toFixed(4)}</td>
      <td class="py-1.5 px-1 text-slate-600">₩${unitKrw.toFixed(1)}</td>
      <td class="py-1.5 px-1 text-slate-800">$${(unitUsd * t.qty).toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})}</td>
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
  const filtered = filterItems({
    query: document.getElementById('searchInput')?.value || "",
    filterMaker: document.getElementById('filterMaker')?.value || "",
    filterOwner: document.getElementById('filterOwner')?.value || "",
    filterStatus: document.getElementById('filterStatus')?.value || "",
    filterPayment: document.getElementById('filterPayment')?.value || ""
  });
  renderInventoryUI(filtered, activeTab, loadFormFromItem, handleDeleteItem, handleOpenSplitModal);
}

function loadFormFromItem(id) {
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
  setVal('inputCustomer', item.customer !== '-' ? item.customer : '');
  setVal('inputSoldPrice', item.soldPriceUsd || '');
  setVal('selectOrderStatus', item.orderStatus);
  setVal('selectPaymentTerms', item.paymentTerms);
  setVal('selectPaymentStatus', item.paymentStatus);
  setVal('inputInvoiceNo', item.invoiceNo || '');
  setVal('inputTrackingNo', item.trackingNo || '');
  setVal('inputDueDate', item.dueDate || '');
  setVal('inputShippedDate', item.shippedDate || '');
  setVal('inputSettledDate', item.settledDate || '');
  setVal('inputEntryDate', item.entryDate);
  setVal('inputMemo', item.memo);
  setVal('inputUsd', item.unitUsd);
  setVal('inputShipFx', item.shipFx);
  setVal('inputStock', item.stock);

  const editingBanner = document.getElementById('editingBanner');
  editingBanner?.classList.remove('hidden');
  const bannerText = document.getElementById('editingBannerText');
  if (bannerText) {
    bannerText.innerText = `선택된 항목: [${item.maker}] ${item.partName} (${item.customer})`;
  }

  runEngine();
  document.getElementById('formSection')?.scrollIntoView({ behavior: 'smooth' });
}

function handleOpenSplitModal(id) {
  const item = getCachedItem(id);
  if (!item) return;
  targetSplitId = item.id;

  const titleEl = document.getElementById('splitModalTitle');
  if (titleEl) titleEl.innerText = `[${item.partName}] 출하 분할`;
  const maxStockEl = document.getElementById('splitMaxStockText');
  if (maxStockEl) maxStockEl.innerText = `현재 보유 재고: ${item.stock.toLocaleString()} EA`;
  
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

  const partName = document.getElementById('inputPartName')?.value.trim();
  if (!partName) {
    alert("제품명을 입력해주세요.");
    return;
  }

  const makerSel = document.getElementById('selectMaker');
  const maker = (makerSel && makerSel.value === '__CUSTOM_MAKER__') ? document.getElementById('inputCustomMaker')?.value.trim() : makerSel?.value;
  const ownerSel = document.getElementById('selectOwner');
  const owner = (ownerSel && ownerSel.value === '__CUSTOM_OWNER__') ? document.getElementById('inputCustomOwner')?.value.trim() : ownerSel?.value;

  const payload = {
    maker: maker || "기타",
    part_name: partName,
    owner: owner || "본사 일반재고",
    customer: document.getElementById('inputCustomer')?.value.trim() || "-",
    sold_price_usd: parseFloat(document.getElementById('inputSoldPrice')?.value) || 0,
    order_status: document.getElementById('selectOrderStatus')?.value || "배정요청",
    payment_terms: document.getElementById('selectPaymentTerms')?.value || "Net 30",
    payment_status: document.getElementById('selectPaymentStatus')?.value || "미수",
    invoice_no: document.getElementById('inputInvoiceNo')?.value.trim() || "",
    tracking_no: document.getElementById('inputTrackingNo')?.value.trim() || "",
    due_date: document.getElementById('inputDueDate')?.value || null,
    shipped_date: document.getElementById('inputShippedDate')?.value || null,
    settled_date: document.getElementById('inputSettledDate')?.value || null,
    entry_date: document.getElementById('inputEntryDate')?.value || new Date().toISOString().slice(0, 10),
    memo: document.getElementById('inputMemo')?.value.trim() || "",
    unit_usd: parseFloat(document.getElementById('inputUsd')?.value) || 0,
    ship_fx: parseFloat(document.getElementById('inputShipFx')?.value) || 1350,
    stock: parseInt(document.getElementById('inputStock')?.value) || 0,
    margin: 20
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
    if (badge) {
      badge.className = "text-[10px] font-bold bg-green-100 text-green-800 px-2 py-0.5 rounded-full";
      badge.innerHTML = "🔓 보안 인증됨";
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
  const qty = parseFloat(document.getElementById('inputStock')?.value) || 0;
  const unitUsd = document.getElementById('minSaleUnitReplaceUsd')?.innerText || "-";
  const unitKrw = document.getElementById('minSaleUnitReplaceKrw')?.innerText || "-";
  const totalUsd = document.getElementById('minSaleTotalReplace')?.innerText || "-";
  const fxRateText = document.getElementById('liveFx')?.innerText || "-";

  const quote = `[견적 안내] ${partName}\n- 수량: ${qty.toLocaleString()} EA\n- 공급단가: ${unitUsd} / EA ${unitKrw}\n- 총견적액: ${totalUsd}\n* 기준환율: ${fxRateText}`;
  navigator.clipboard.writeText(quote).then(() => alert("견적서 텍스트가 복사되었습니다!"));
}

window.openChangePasswordModal = () => {
  const emailEl = document.getElementById('changePwdUserEmail');
  if (emailEl && currentSession) emailEl.innerText = `계정: ${currentSession.user.email}`;
  document.getElementById('changePasswordModal')?.classList.remove('hidden');
};

bootstrap();
