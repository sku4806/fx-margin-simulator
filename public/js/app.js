import { getCurrentSession, loginWithEmail, logout, updatePassword, subscribeAuthChange } from './supabase.js';
import { computeQuotation } from './calculator.js';
import { fetchInventoryItems, upsertInventoryItem, deleteInventoryItem, filterItems, getCachedItem, renderInventoryUI } from './inventory.js';

let currentSession = null;
let rawFxRate = 1380.0;
let appliedFxRate = 1380.0;
let activeTab = 'sales'; // 'sales' | 'fulfillment'

export async function bootstrap() {
  document.getElementById('inputEntryDate').value = new Date().toISOString().slice(0, 10);

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
      renderInventoryUI([], activeTab, () => {}, () => {});
    }
  });

  runEngine();
}

function bindTabSwitch() {
  const tabSales = document.getElementById('tabSales');
  const tabFulfillment = document.getElementById('tabFulfillment');
  const salesPanel = document.getElementById('salesQuotationPanel');
  const csHeaderDesc = document.getElementById('csHeaderDesc');

  tabSales.addEventListener('click', () => {
    activeTab = 'sales';
    tabSales.className = "px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white shadow-sm transition-colors";
    tabFulfillment.className = "px-4 py-2 text-xs font-semibold rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors";
    salesPanel.classList.remove('hidden');
    csHeaderDesc.innerText = "영업 협의 수주 현황 및 실판매 마진율을 관리합니다.";
    applyFilters();
  });

  tabFulfillment.addEventListener('click', () => {
    activeTab = 'fulfillment';
    tabFulfillment.className = "px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white shadow-sm transition-colors";
    tabSales.className = "px-4 py-2 text-xs font-semibold rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors";
    salesPanel.classList.add('hidden'); // 출하/채권 모드에서는 견적 계산기 접기
    csHeaderDesc.innerText = "출하 스케줄, 운송장/인보이스 번호 및 미수금 만기 일정을 관리합니다.";
    applyFilters();
  });
}

function updateFxDisplay() {
  const buffer = parseFloat(document.getElementById('fxBufferSelect').value) || 0;
  appliedFxRate = rawFxRate + buffer;
  const bufferText = buffer > 0 ? ` (+${buffer}원)` : "";
  document.getElementById('liveFx').innerText = `$1.00 (₩${Math.round(appliedFxRate).toLocaleString()})${bufferText}`;
  runEngine();
}

function bindInputs() {
  ['inputUsd', 'inputQty', 'inputShipFx', 'inputTargetMargin', 'inputStock', 'inputOverhead', 'inputTargetOffer'].forEach(id => {
    document.getElementById(id).addEventListener('input', runEngine);
  });

  document.getElementById('fxBufferSelect').addEventListener('change', updateFxDisplay);
  document.getElementById('copyQuoteBtn').addEventListener('click', copyQuotation);

  bindCustomSelect('selectMaker', 'inputCustomMaker', '__CUSTOM_MAKER__');
  bindCustomSelect('selectOwner', 'inputCustomOwner', '__CUSTOM_OWNER__');

  ['searchInput', 'filterMaker', 'filterOwner', 'filterStatus', 'filterPayment'].forEach(id => {
    document.getElementById(id).addEventListener('input', applyFilters);
    document.getElementById(id).addEventListener('change', applyFilters);
  });

  document.getElementById('saveItemBtn').addEventListener('click', saveCurrentForm);
  document.getElementById('authActionBtn').addEventListener('click', handleAuthButton);
}

function bindCustomSelect(selectId, inputId, customVal) {
  const sel = document.getElementById(selectId);
  const inp = document.getElementById(inputId);
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
  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('loginSubmitBtn');
    const err = document.getElementById('loginErrorMsg');
    btn.disabled = true;
    err.classList.add('hidden');

    try {
      const email = document.getElementById('loginEmail').value.trim();
      const pwd = document.getElementById('loginPassword').value.trim();
      const { error } = await loginWithEmail(email, pwd);
      if (error) throw error;
      document.getElementById('loginModal').classList.add('hidden');
    } catch (error) {
      err.innerText = "로그인 실패: " + error.message;
      err.classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  };

  document.getElementById('changePasswordForm').onsubmit = async (e) => {
    e.preventDefault();
    const newPwd = document.getElementById('newPasswordInput').value.trim();
    const confirmPwd = document.getElementById('confirmPasswordInput').value.trim();
    const err = document.getElementById('changePwdErrorMsg');

    if (newPwd !== confirmPwd) {
      err.innerText = "비밀번호가 일치하지 않습니다.";
      err.classList.remove('hidden');
      return;
    }

    try {
      const { error } = await updatePassword(newPwd);
      if (error) throw error;
      alert("비밀번호가 성공적으로 변경되었습니다.");
      document.getElementById('changePasswordModal').classList.add('hidden');
    } catch (error) {
      err.innerText = error.message;
      err.classList.remove('hidden');
    }
  };
}

function runEngine() {
  const result = computeQuotation({
    unitUsd: parseFloat(document.getElementById('inputUsd').value) || 0,
    qty: parseFloat(document.getElementById('inputQty').value) || 0,
    shipFx: parseFloat(document.getElementById('inputShipFx').value) || 0,
    overheadRate: (parseFloat(document.getElementById('inputOverhead').value) || 0) / 100,
    targetMarginRate: (parseFloat(document.getElementById('inputTargetMargin').value) || 0) / 100,
    appliedFxRate,
    targetOfferUsd: parseFloat(document.getElementById('inputTargetOffer').value) || 0
  });

  document.getElementById('actualCostUnit').innerText = `$${result.loadedUnitUsd.toFixed(3)} (₩${result.unitActualCostKrw.toFixed(1)})`;
  document.getElementById('actualCostTotal').innerText = `$${result.totalUsdCost.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})} (₩${Math.round(result.totalActualCostKrw).toLocaleString()})`;
  document.getElementById('replaceCostUnit').innerText = `$${result.loadedUnitUsd.toFixed(3)} (₩${result.unitReplaceCostKrw.toFixed(1)})`;
  document.getElementById('replaceCostTotal').innerText = `$${result.totalUsdCost.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})} (₩${Math.round(result.totalReplaceCostKrw).toLocaleString()})`;

  document.getElementById('minSaleUnitActualUsd').innerText = `$${result.unitMinPriceActualUsd.toFixed(4)}`;
  document.getElementById('minSaleUnitActualKrw').innerText = `(₩${result.unitMinPriceActualKrw.toFixed(1)} / EA)`;
  document.getElementById('minSaleTotalActual').innerText = `$${result.totalMinPriceActualUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

  document.getElementById('minSaleUnitReplaceUsd').innerText = `$${result.unitMinPriceReplaceUsd.toFixed(4)}`;
  document.getElementById('minSaleUnitReplaceKrw').innerText = `(₩${result.unitMinPriceReplaceKrw.toFixed(1)} / EA)`;
  document.getElementById('minSaleTotalReplace').innerText = `$${result.totalMinPriceReplaceUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

  const revMarginEl = document.getElementById('reverseMarginReplace');
  const revBadgeEl = document.getElementById('reverseMarginBadge');
  if (result.expectedMargin !== null) {
    revMarginEl.innerText = `${result.expectedMargin.toFixed(2)}%`;
    const targetMargin = parseFloat(document.getElementById('inputTargetMargin').value) || 0;
    if (result.expectedMargin >= targetMargin) {
      revBadgeEl.className = "text-[11px] font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full inline-block mt-0.5";
      revBadgeEl.innerText = "✅ 수주 가능";
    } else if (result.expectedMargin > 0) {
      revBadgeEl.className = "text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full inline-block mt-0.5";
      revBadgeEl.innerText = "⚠️ 마진 미달";
    } else {
      revBadgeEl.className = "text-[11px] font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full inline-block mt-0.5";
      revBadgeEl.innerText = "🚨 역마진 불가";
    }
  } else {
    revMarginEl.innerText = "- %";
    revBadgeEl.className = "text-[11px] font-bold text-slate-400 mt-0.5";
    revBadgeEl.innerText = "단가를 입력하세요";
  }

  renderTierTable(result.unitMinPriceReplaceUsd, result.unitMinPriceReplaceKrw, parseFloat(document.getElementById('inputQty').value) || 0);
}

function renderTierTable(unitUsd, unitKrw, currentQty) {
  const tiers = [
    { label: "1,000", qty: 1000 },
    { label: "5,000", qty: 5000 },
    { label: "10,000", qty: 10000 }
  ];

  if (![1000, 5000, 10000].includes(currentQty) && currentQty > 0) {
    tiers.push({ label: `${currentQty.toLocaleString()}(견적)`, qty: currentQty, isCurrent: true });
    tiers.sort((a, b) => a.qty - b.qty);
  }

  const tbody = document.getElementById('tierTableBody');
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
    query: document.getElementById('searchInput').value,
    filterMaker: document.getElementById('filterMaker').value,
    filterOwner: document.getElementById('filterOwner').value,
    filterStatus: document.getElementById('filterStatus').value,
    filterPayment: document.getElementById('filterPayment').value
  });
  renderInventoryUI(filtered, activeTab, loadFormFromItem, handleDeleteItem);
}

function loadFormFromItem(id) {
  const item = getCachedItem(id);
  if (!item) return;

  setSelectValue('selectMaker', 'inputCustomMaker', item.maker, '__CUSTOM_MAKER__');
  setSelectValue('selectOwner', 'inputCustomOwner', item.owner, '__CUSTOM_OWNER__');
  document.getElementById('inputPartName').value = item.partName;
  document.getElementById('inputCustomer').value = item.customer !== '-' ? item.customer : '';
  document.getElementById('inputSoldPrice').value = item.soldPriceUsd || '';
  document.getElementById('selectOrderStatus').value = item.orderStatus;
  document.getElementById('selectPaymentTerms').value = item.paymentTerms;
  document.getElementById('selectPaymentStatus').value = item.paymentStatus;
  document.getElementById('inputInvoiceNo').value = item.invoiceNo || '';
  document.getElementById('inputTrackingNo').value = item.trackingNo || '';
  document.getElementById('inputDueDate').value = item.dueDate || '';
  document.getElementById('inputShippedDate').value = item.shippedDate || '';
  document.getElementById('inputEntryDate').value = item.entryDate;
  document.getElementById('inputMemo').value = item.memo;
  document.getElementById('inputUsd').value = item.unitUsd;
  document.getElementById('inputShipFx').value = item.shipFx;
  document.getElementById('inputStock').value = item.stock;
  document.getElementById('inputTargetMargin').value = item.margin;

  runEngine();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setSelectValue(selectId, inputId, val, customKey) {
  const sel = document.getElementById(selectId);
  const inp = document.getElementById(inputId);
  const exists = Array.from(sel.options).some(o => o.value === val);
  if (exists && val !== customKey) {
    sel.value = val;
    inp.classList.add('hidden');
    inp.value = '';
  } else {
    sel.value = customKey;
    inp.classList.remove('hidden');
    inp.value = val || '';
  }
}

async function saveCurrentForm() {
  if (!currentSession) {
    alert("로그인 후 이용할 수 있습니다.");
    document.getElementById('loginModal').classList.remove('hidden');
    return;
  }

  const partName = document.getElementById('inputPartName').value.trim();
  if (!partName) {
    alert("제품명을 입력해주세요.");
    return;
  }

  const makerSel = document.getElementById('selectMaker');
  const maker = makerSel.value === '__CUSTOM_MAKER__' ? document.getElementById('inputCustomMaker').value.trim() : makerSel.value;
  const ownerSel = document.getElementById('selectOwner');
  const owner = ownerSel.value === '__CUSTOM_OWNER__' ? document.getElementById('inputCustomOwner').value.trim() : ownerSel.value;

  const payload = {
    maker: maker || "기타",
    part_name: partName,
    owner: owner || "본사 일반재고",
    customer: document.getElementById('inputCustomer').value.trim() || "-",
    sold_price_usd: parseFloat(document.getElementById('inputSoldPrice').value) || 0,
    order_status: document.getElementById('selectOrderStatus').value,
    payment_terms: document.getElementById('selectPaymentTerms').value,
    payment_status: document.getElementById('selectPaymentStatus').value,
    invoice_no: document.getElementById('inputInvoiceNo').value.trim(),
    tracking_no: document.getElementById('inputTrackingNo').value.trim(),
    due_date: document.getElementById('inputDueDate').value || null,
    shipped_date: document.getElementById('inputShippedDate').value || null,
    entry_date: document.getElementById('inputEntryDate').value || new Date().toISOString().slice(0, 10),
    memo: document.getElementById('inputMemo').value.trim(),
    unit_usd: parseFloat(document.getElementById('inputUsd').value) || 0,
    ship_fx: parseFloat(document.getElementById('inputShipFx').value) || 1350,
    stock: parseInt(document.getElementById('inputStock').value) || 0,
    margin: parseFloat(document.getElementById('inputTargetMargin').value) || 20
  };

  try {
    await upsertInventoryItem(payload);
    alert(`[${payload.part_name}] 데이터가 안전하게 저장되었습니다.`);
    await refreshInventory();
  } catch (err) {
    alert("저장 실패: " + err.message);
  }
}

async function handleDeleteItem(id) {
  if (!confirm("해당 건을 삭제하시겠습니까?")) return;
  try {
    await deleteInventoryItem(id);
    await refreshInventory();
  } catch (err) {
    alert("삭제 실패: " + err.message);
  }
}

function updateAuthUI() {
  const isAuth = !!(currentSession && currentSession.user);
  document.getElementById('lockedOverlay').classList.toggle('hidden', isAuth);
  document.getElementById('unlockedContent').classList.toggle('hidden', !isAuth);
  document.getElementById('changePwdBtn').classList.toggle('hidden', !isAuth);

  const badge = document.getElementById('lockStatusBadge');
  const btn = document.getElementById('authActionBtn');
  const sub = document.getElementById('authSubtitle');

  if (isAuth) {
    badge.className = "text-[10px] font-bold bg-green-100 text-green-800 px-2 py-0.5 rounded-full";
    badge.innerHTML = "🔓 보안 인증됨";
    sub.innerHTML = `접속 계정: <strong class="text-indigo-700">${currentSession.user.email}</strong>`;
    btn.className = "text-xs bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold px-3 py-1.5 rounded-lg transition-colors";
    btn.innerHTML = "🚪 로그아웃";
  } else {
    badge.className = "text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full";
    badge.innerHTML = "🔒 로그인 필요";
    sub.innerText = "인증된 사내 영업 계정만 원가 및 재고를 조회할 수 있습니다.";
    btn.className = "text-xs bg-slate-800 hover:bg-slate-900 active:scale-95 text-white font-semibold px-3.5 py-1.5 rounded-lg transition-transform flex items-center gap-1.5";
    btn.innerHTML = "🔑 사내 계정 로그인";
  }
}

function handleAuthButton() {
  if (currentSession) {
    if (confirm("로그아웃하시겠습니까?")) logout();
  } else {
    document.getElementById('loginModal').classList.remove('hidden');
  }
}

function copyQuotation() {
  const partName = document.getElementById('inputPartName').value.trim();
  const qty = parseFloat(document.getElementById('inputQty').value) || 0;
  const unitUsd = document.getElementById('minSaleUnitReplaceUsd').innerText;
  const unitKrw = document.getElementById('minSaleUnitReplaceKrw').innerText;
  const totalUsd = document.getElementById('minSaleTotalReplace').innerText;
  const fxRateText = document.getElementById('liveFx').innerText;

  const quote = `[견적 안내] ${partName}\n- 수량: ${qty.toLocaleString()} EA\n- 공급단가: ${unitUsd} / EA ${unitKrw}\n- 총견적액: ${totalUsd}\n* 기준환율: ${fxRateText}`;
  navigator.clipboard.writeText(quote).then(() => alert("견적서 텍스트가 복사되었습니다!"));
}

window.openChangePasswordModal = () => {
  document.getElementById('changePwdUserEmail').innerText = `계정: ${currentSession.user.email}`;
  document.getElementById('changePasswordModal').classList.remove('hidden');
};

bootstrap();
