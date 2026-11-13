/**
 * 📑 expense-approval.js
 * BigShine Korea 전자결재 및 경비 정산 통합 모듈 (Option A: Dual-client bridge)
 * - Project 1 (ERP): https://qheijtepveajdrqerxef.supabase.co
 * - Project 2 (Payment/Expense): https://omtcanlmnpbiqoiakylp.supabase.co
 * 
 * 🔗 연동 핵심: 관리자가 '구매품의서' 최종 승인 시, ERP 재고관리(inventory_items)에
 *    [발주번호: doc_no, 상태: 배정요청(입고예정)]으로 자동 즉시 등록!
 */

import { paymentSupabase, PAYMENT_SUPABASE_URL, PAYMENT_SUPABASE_KEY, ADMIN_PIN } from './payment-client.js';
import { sbClient } from './supabase.js';

// 전역 캐시
let allExpenses = [];
let allApprovals = [];
let myApprovalDocsCache = [];
let cachedApprovedApprovals = [];
let currentExpenseFilter = 'ALL';
let currentApprovalFilter = 'ALL';
let isPaymentAdminAuthed = false;
let selectedReceiptFile = null;
let linkedApprovalId = null;
let linkedApprovalDocNo = null;

// 사내 계정 이메일 -> 사원명 매핑 테이블
const EMAIL_TO_EMP_NAME = {
  'nathan@bigshine.co.kr': '김남천',
  'timothy@bigshine.co.kr': '이동일',
  'tony@bigshine.co.kr': 'Tony',
  'jane@bigshine.co.kr': 'Jane',
  'jamie@bigshine.co.kr': 'Jamie',
  'lily@bigshine.co.kr': 'Lily',
  'raina@bigshine.co.kr': 'Raina',
  'susan@bigshine.co.kr': 'Susan',
  'trisha@bigshine.co.kr': 'Trisha',
  'william@bigshine.co.kr': 'William',
  'joey@bigshine.co.kr': 'Joey',
  'steve@bigshine.co.kr': 'Steve',
  'kelly@bigshine.co.kr': 'Kelly',
  'eric@bigshine.co.kr': 'Eric',
  'logan@bigshine.co.kr': 'Logan',
  'paul@bigshine.co.kr': 'Paul',
  'dustin@bigshine.co.kr': 'Dustin',
  'allenpark@bigshine.co.kr': '박정훈'
};

/**
 * ERP 로그인 세션 동기화 (비로그인 시 내 문서함 데이터 완전 잠금)
 */
export function syncPaymentAuthSession(session) {
  const isAuth = !!(session && session.user);
  const userEmail = session?.user?.email ? session.user.email.toLowerCase().trim() : null;
  const mappedName = userEmail ? (EMAIL_TO_EMP_NAME[userEmail] || userEmail.split('@')[0]) : '';

  const lockedOverlay = document.getElementById('paymentMyLockedOverlay');
  const contentArea = document.getElementById('paymentMyContentArea');
  const myLookup = document.getElementById('myLookupName');
  const empInput = document.getElementById('employeeName');
  const drafterInput = document.getElementById('appDrafterName');

  if (!isAuth) {
    // 🔒 비로그인: 내 문서함 데이터 완전 초기화 & 잠금 화면 활성화
    if (lockedOverlay) lockedOverlay.classList.remove('hidden');
    if (contentArea) contentArea.classList.add('hidden');
    if (myLookup) myLookup.value = '';
    if (empInput) empInput.value = '';
    if (drafterInput) drafterInput.value = '';

    // 테이블 목록 즉시 비우기 (데이터 잔여 방지)
    const expTbody = document.getElementById('myExpenseTableBody');
    if (expTbody) expTbody.innerHTML = `<tr><td colspan="8" class="text-center py-12 text-slate-400">사원명을 입력하고 [조회]를 눌러주세요.</td></tr>`;
    const appTbody = document.getElementById('myApprovalTableBody');
    if (appTbody) appTbody.innerHTML = `<tr><td colspan="7" class="text-center py-12 text-slate-400">사원명을 입력하고 [조회]를 눌러주세요.</td></tr>`;

    myApprovalDocsCache = [];
    localStorage.removeItem('LAST_EMP_NAME');
  } else {
    // 🔓 로그인: 내 문서함 잠금 해제 & 본인 사원명 연동
    if (lockedOverlay) lockedOverlay.classList.add('hidden');
    if (contentArea) contentArea.classList.remove('hidden');

    const empName = mappedName || localStorage.getItem('LAST_EMP_NAME') || '';
    if (empName) {
      if (myLookup) myLookup.value = empName;
      if (empInput && !empInput.value) empInput.value = empName;
      if (drafterInput && !drafterInput.value) drafterInput.value = empName;
      localStorage.setItem('LAST_EMP_NAME', empName);

      // 내 문서함 서브탭이 활성화되어 있는 상태라면 본인 문서 자동 조회
      const mySection = document.getElementById('paymentSectionMy');
      if (mySection && !mySection.classList.contains('hidden')) {
        loadMyAllDocs();
      }
    }
  }

  refreshAdminPaymentAuthUI();
  if (typeof window.updateAuthHeaderUI === 'function') {
    window.updateAuthHeaderUI();
  }
}
window.syncPaymentAuthSession = syncPaymentAuthSession;

/**
 * 1. 초기화 및 모듈 로드
 */
export async function initPaymentModule() {
  const today = new Date().toISOString().split('T')[0];
  const pDate = document.getElementById('paymentDate');
  const aDate = document.getElementById('appTargetDate');
  if (pDate && !pDate.value) pDate.value = today;
  if (aDate && !aDate.value) aDate.value = today;

  // 비로그인 상태에서는 localStorage의 사원명을 자동 기입/조회하지 않음!
  const isAuth = !!(typeof window.getCurrentUserEmail === 'function' && window.getCurrentUserEmail());
  if (isAuth) {
    const savedName = localStorage.getItem('LAST_EMP_NAME');
    if (savedName) {
      const empInput = document.getElementById('employeeName');
      const drafterInput = document.getElementById('appDrafterName');
      const myLookup = document.getElementById('myLookupName');
      if (empInput && !empInput.value) empInput.value = savedName;
      if (drafterInput && !drafterInput.value) drafterInput.value = savedName;
      if (myLookup && !myLookup.value) myLookup.value = savedName;
    }
  }

  // 연결 상태 도트 업데이트
  const dot = document.getElementById('connStatusDot');
  if (dot) {
    dot.className = paymentSupabase 
      ? "w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block ring-2 ring-emerald-200" 
      : "w-2.5 h-2.5 rounded-full bg-rose-500 inline-block";
  }

  // 결재 권한 UI 초기화 (비인가자 관리자 버튼 숨김)
  refreshAdminPaymentAuthUI();

  // 동적 다중 품목 기본 1행 초기화 및 환율 동기화
  const pTbody = document.getElementById('purchaseItemsTbody');
  if (pTbody && pTbody.children.length === 0) {
    addPurchaseItemRow({ part_no: 'IS25LP128F-JBLE-TR', maker: 'ISSI', qty: 5000, unit_price: 1.15, memo: '고객사 양산 프로젝트 안전재고 확보' });
  }
  const eTbody = document.getElementById('expenseItemsTbody');
  if (eTbody && eTbody.children.length === 0) {
    addExpenseItemRow({ item: '고객사 FAE 기술 미팅 식대', amount: 100000, note: '4인 참석 (시제품 기술지원)' });
  }

  try {
    const fxResp = await fetch('/api/fx-rate');
    const fxData = await fxResp.json();
    if (fxData && fxData.current_rate) {
      const fxEl = document.getElementById('appPurchaseFxRate');
      if (fxEl) {
        fxEl.value = Number(fxData.current_rate).toFixed(2);
        updatePurchaseTableTotals();
      }
    }
  } catch (e) {}

  updateKoreanCurrencyPreview();

  if (window.lucide) {
    try { lucide.createIcons(); } catch (e) {}
  }

  // 뱃지 및 대기 건수 업데이트
  await updatePaymentPendingBadge();
}

/**
 * 상단 탭 뱃지 카운트 업데이트 (지정 결재 승인권자에게만 노출)
 */
export async function updatePaymentPendingBadge() {
  if (!paymentSupabase) return;
  const isApprover = (typeof window.isPaymentApprovalAdmin === 'function') ? window.isPaymentApprovalAdmin() : false;
  const badge = document.getElementById('paymentPendingBadge');
  const adminBadge = document.getElementById('pendingBadge');

  if (!isApprover) {
    if (badge) badge.classList.add('hidden');
    if (adminBadge) adminBadge.classList.add('hidden');
    return;
  }

  try {
    const [{ count: expCnt }, { count: appCnt }] = await Promise.all([
      paymentSupabase.from('expense_reports').select('id', { count: 'exact', head: true }).eq('status', 'PENDING'),
      paymentSupabase.from('approval_requests').select('id', { count: 'exact', head: true }).eq('status', 'PENDING')
    ]);

    const totalPending = (expCnt || 0) + (appCnt || 0);
    if (badge) {
      badge.textContent = `${totalPending}건`;
      badge.classList.toggle('hidden', totalPending === 0);
    }
    if (adminBadge) {
      adminBadge.textContent = totalPending;
      adminBadge.classList.toggle('hidden', totalPending === 0);
    }
  } catch (err) {
    console.warn('[Payment] 대기 건수 확인 실패:', err);
  }
}

/**
 * 2. 내부 서브탭 전환
 */
export function switchPaymentSubTab(tab) {
  // 관리자 탭 접근 검증: 지정된 결재 승인권자만 진입 허용 (비승인자는 아예 진입 불가)
  if (tab === 'admin') {
    const isApprover = (typeof window.isPaymentApprovalAdmin === 'function') ? window.isPaymentApprovalAdmin() : false;
    if (!isApprover) {
      alert('관리자 결재 메뉴에 접근할 권한이 없습니다.');
      return;
    }
    isPaymentAdminAuthed = true;
  }

  ['paymentSectionRegister', 'paymentSectionApproval', 'paymentSectionMy', 'paymentSectionAdmin'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });

  const baseClass = "nav-tab px-2.5 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-semibold rounded-lg text-slate-600 hover:bg-slate-100 flex items-center gap-1.5 whitespace-nowrap transition cursor-pointer";
  const activeClass = "nav-tab px-2.5 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-bold rounded-lg bg-blue-600 text-white shadow-sm flex items-center gap-1.5 whitespace-nowrap transition cursor-pointer";

  ['tabBtnRegister', 'tabBtnApproval', 'tabBtnMy', 'tabBtnAdmin'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.className = baseClass;
  });

  if (tab === 'register') {
    document.getElementById('paymentSectionRegister')?.classList.remove('hidden');
    document.getElementById('tabBtnRegister')?.setAttribute('class', activeClass);
  } else if (tab === 'approval') {
    document.getElementById('paymentSectionApproval')?.classList.remove('hidden');
    document.getElementById('tabBtnApproval')?.setAttribute('class', activeClass);
    toggleApprovalAmountField();
  } else if (tab === 'my') {
    document.getElementById('paymentSectionMy')?.classList.remove('hidden');
    document.getElementById('tabBtnMy')?.setAttribute('class', activeClass);
    const isAuth = !!(typeof window.getCurrentUserEmail === 'function' && window.getCurrentUserEmail());
    const lockedOverlay = document.getElementById('paymentMyLockedOverlay');
    const contentArea = document.getElementById('paymentMyContentArea');

    if (!isAuth) {
      if (lockedOverlay) lockedOverlay.classList.remove('hidden');
      if (contentArea) contentArea.classList.add('hidden');
    } else {
      if (lockedOverlay) lockedOverlay.classList.add('hidden');
      if (contentArea) contentArea.classList.remove('hidden');
      const lookupName = document.getElementById('myLookupName')?.value || '';
      if (lookupName) {
        loadMyAllDocs();
      }
    }
  } else if (tab === 'admin') {
    document.getElementById('paymentSectionAdmin')?.classList.remove('hidden');
    document.getElementById('tabBtnAdmin')?.setAttribute('class', activeClass);
    loadAllAdminPaymentData();
  }

  // 결재 권한 UI 초기화 (비인가자 관리자 버튼 숨김)
  refreshAdminPaymentAuthUI();

  if (window.lucide) {
    try { lucide.createIcons(); } catch (e) {}
  }
}

/**
 * 관리자 PIN 번호 검증
 */
export function verifyPaymentAdminPin(e) {
  if (e) e.preventDefault();
  const pinInput = document.getElementById('adminPinInput');
  if (pinInput && pinInput.value.trim() === ADMIN_PIN) {
    isPaymentAdminAuthed = true;
    sessionStorage.setItem('IS_PAYMENT_ADMIN_AUTH', 'true');
    closePaymentModal('adminAuthModal');
    switchPaymentSubTab('admin');
  } else {
    alert('관리자 인증 PIN 번호가 일치하지 않습니다. (기본: 7788)');
    if (pinInput) pinInput.value = '';
  }
}

/**
 * 3. 스마트 영수증 OCR 처리 (Tesseract.js)
 */
export function handleReceiptFileSelect(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  selectedReceiptFile = file;

  const preview = document.getElementById('imagePreview');
  if (preview) preview.src = URL.createObjectURL(file);
  document.getElementById('uploadPlaceholder')?.classList.add('hidden');
  document.getElementById('imagePreviewContainer')?.classList.remove('hidden');

  runReceiptOCR();
}

export function clearReceiptFile(event) {
  if (event) event.stopPropagation();
  selectedReceiptFile = null;
  const input = document.getElementById('receiptFileInput');
  if (input) input.value = '';
  const preview = document.getElementById('imagePreview');
  if (preview) preview.src = '';
  document.getElementById('uploadPlaceholder')?.classList.remove('hidden');
  document.getElementById('imagePreviewContainer')?.classList.add('hidden');
  document.getElementById('ocrStatusArea')?.classList.add('hidden');
  const rawText = document.getElementById('rawOcrText');
  if (rawText) rawText.innerText = '';
}

function resizeImageForOCR(file, maxWidth = 1200) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      let width = img.width, height = img.height;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas 변환 실패')), 'image/jpeg', 0.9);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지 로드 실패'));
    };
    img.src = url;
  });
}

export async function runReceiptOCR() {
  if (!selectedReceiptFile) {
    alert('분석할 영수증 이미지를 먼저 등록해주세요.');
    return;
  }
  if (typeof Tesseract === 'undefined') {
    alert('OCR 라이브러리(Tesseract.js)가 로드되지 않았습니다. 수기로 정보를 입력하실 수 있습니다.');
    return;
  }

  const statusArea = document.getElementById('ocrStatusArea');
  const statusText = document.getElementById('ocrStatusText');
  const progressNum = document.getElementById('ocrProgressNum');
  const progressBar = document.getElementById('ocrProgressBar');

  if (statusArea) statusArea.classList.remove('hidden');
  if (statusText) statusText.innerHTML = '<span class="inline-block animate-spin mr-1">🔄</span> 이미지 최적화 중...';
  if (progressNum) progressNum.innerText = '0%';
  if (progressBar) progressBar.style.width = '0%';

  try {
    const compressedBlob = await resizeImageForOCR(selectedReceiptFile, 1200);
    const worker = await Tesseract.createWorker('kor+eng', 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          const p = Math.round((m.progress || 0) * 100);
          if (progressNum) progressNum.innerText = p + '%';
          if (progressBar) progressBar.style.width = p + '%';
          if (statusText) statusText.innerHTML = `<span class="inline-block animate-spin mr-1">🔄</span> 글자 인식 중 (${p}%)...`;
        }
      }
    });

    const ret = await worker.recognize(compressedBlob);
    await worker.terminate();
    const text = ret.data.text;

    const rawTextEl = document.getElementById('rawOcrText');
    if (rawTextEl) rawTextEl.innerText = text;
    if (progressNum) progressNum.innerText = '100%';
    if (progressBar) progressBar.style.width = '100%';
    if (statusText) statusText.innerHTML = '<span class="text-emerald-600 font-bold">✓ 자동 분석 완료</span>';

    parseReceiptText(text);
  } catch (err) {
    console.warn('[OCR] 분석 에러:', err);
    if (statusText) statusText.innerHTML = `<span class="text-rose-500 font-medium">분석 지연 (수기 직접 입력 가능)</span>`;
  }
}

export function parseReceiptText(rawText) {
  if (!rawText) return;
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const fullText = lines.join(' ');
  const cleanDigits = (str) => (str ? str.replace(/[^0-9]/g, '') : '');

  // 1. 승인번호
  for (const rx of [
    /(?:승\s*인\s*번\s*호|승\s*인\s*(?:NO\.?|코드|NUM)|APPR(?:\.|\s*NO)?)[\s:.\-_]*([0-9\s]{6,12})/i,
    /\b([0-9]{8})\b/
  ]) {
    const match = fullText.match(rx);
    if (match && match[1]) {
      const c = cleanDigits(match[1]);
      if (c.length >= 6 && c.length <= 10 && !c.startsWith('010') && !c.startsWith('02')) {
        const appEl = document.getElementById('approvalNumber');
        if (appEl) appEl.value = c;
        break;
      }
    }
  }

  // 2. 일자
  for (const rx of [
    /(?:일\s*시|승\s*인\s*일\s*시)?[\s:.\-_]*(202[3-9])[.\-\/년\s]+([0-1]?[0-9])[.\-\/월\s]+([0-3]?[0-9])/,
    /([2-3][0-9])[.\-\/]([0-1]?[0-9])[.\-\/]([0-3]?[0-9])/
  ]) {
    const match = fullText.match(rx);
    if (match) {
      let y = match[1].length === 2 ? '20' + match[1] : match[1];
      const m = match[2].padStart(2, '0');
      const d = match[3].padStart(2, '0');
      if (parseInt(m, 10) >= 1 && parseInt(m, 10) <= 12 && parseInt(d, 10) >= 1 && parseInt(d, 10) <= 31) {
        const dateEl = document.getElementById('paymentDate');
        if (dateEl) dateEl.value = `${y}-${m}-${d}`;
        break;
      }
    }
  }

  // 3. 금액
  let parsedAmount = 0;
  for (const rx of [
    /(?:받을금액|합계금액|결제금액|승인금액|총\s*결제금액|합\s*계|이용금액|매입금액|총\s*액)[\s:₩￦]*([0-9,]{3,})\s*원?/i,
    /([0-9,]{3,})\s*원\s*(?:결제|승인|일시불)?/i
  ]) {
    const match = fullText.match(rx);
    if (match && match[1]) {
      const val = parseInt(match[1].replace(/,/g, ''), 10);
      if (val >= 500 && val <= 50000000) {
        parsedAmount = val;
        break;
      }
    }
  }
  if (!parsedAmount) {
    const all = [];
    const gRx = /\b([0-9]{1,3}(?:,[0-9]{3})+)\b/g;
    let m;
    while ((m = gRx.exec(fullText)) !== null) {
      const v = parseInt(m[1].replace(/,/g, ''), 10);
      if (v >= 1000 && v <= 50000000) all.push(v);
    }
    if (all.length > 0) parsedAmount = Math.max(...all);
  }
  if (parsedAmount > 0) {
    const amtEl = document.getElementById('amount');
    if (amtEl) amtEl.value = parsedAmount;
  }

  // 4. 가맹점명
  let merchant = '';
  const sm = fullText.match(/(?:가\s*맹\s*점\s*명|상\s*호\s*명|가\s*맹\s*점|상\s*호)[\s:.\-_]*([가-힣A-Za-z0-9\(\)\s]{2,20}?)(?=\s*(?:대표|사업자|전화|TEL|주소|카드|일시|$))/i);
  if (sm && sm[1]) merchant = sm[1].trim();
  if (!merchant) {
    for (const line of lines) {
      if (/(충전소|주유소|식당|커피|카페|마트|베이커리|스토어|점$)/i.test(line) && !line.includes(':') && !line.includes('TEL') && !line.match(/^[0-9\-]/)) {
        merchant = line.replace(/\(.*\)/, '').trim();
        break;
      }
    }
  }
  if (merchant) {
    const mEl = document.getElementById('merchantName');
    if (mEl) mEl.value = merchant.replace(/^[-\.:\s]+/, '').replace(/[-\.:\s]+$/, '');
  }
}

/**
 * 4. 경비 등록 (승인 품의 연동 및 전표 상신)
 */
export async function loadApprovedApprovalsForSelect() {
  const empName = document.getElementById('employeeName')?.value.trim() || '';
  const box = document.getElementById('linkedApprovalBox');
  const select = document.getElementById('approvedApprovalSelect');
  if (box) box.classList.remove('hidden');
  if (select) select.innerHTML = '<option value="">불러오는 중...</option>';

  try {
    let query = paymentSupabase.from('approval_requests').select('*').eq('status', 'APPROVED').order('created_at', { ascending: false });
    if (empName) query = query.ilike('drafter_name', `%${empName}%`);
    const { data, error } = await query;
    if (error) throw error;
    cachedApprovedApprovals = data || [];

    if (cachedApprovedApprovals.length === 0) {
      if (select) select.innerHTML = '<option value="">승인 완료된 사전 품의서가 없습니다</option>';
      return;
    }
    if (select) {
      select.innerHTML = '<option value="">-- 연결할 사전 승인 품의서를 선택하세요 --</option>';
      cachedApprovedApprovals.forEach(doc => {
        const opt = document.createElement('option');
        opt.value = doc.id;
        opt.textContent = `[${doc.doc_no}] ${doc.title} (${doc.drafter_name} / ₩${Number(doc.expected_amount || 0).toLocaleString()})`;
        select.appendChild(opt);
      });
    }
  } catch (err) {
    if (select) select.innerHTML = '<option value="">목록 불러오기 실패</option>';
  }
}

export function applyLinkedApproval() {
  const select = document.getElementById('approvedApprovalSelect');
  const selectedId = select?.value;
  if (!selectedId) {
    linkedApprovalId = null;
    linkedApprovalDocNo = null;
    return;
  }
  const doc = cachedApprovedApprovals.find(x => String(x.id) === String(selectedId));
  if (doc) {
    linkedApprovalId = doc.id;
    linkedApprovalDocNo = doc.doc_no;
    const emp = document.getElementById('employeeName');
    if (emp) emp.value = doc.drafter_name;
    const cat = document.getElementById('expenseCategory');
    if (cat && doc.category) cat.value = doc.category;
    const purp = document.getElementById('purpose');
    if (purp && !purp.value.trim()) purp.value = `[품의연결: ${doc.doc_no}] ${doc.title}`;
  }
}

export function clearLinkedApproval() {
  linkedApprovalId = null;
  linkedApprovalDocNo = null;
  const sel = document.getElementById('approvedApprovalSelect');
  if (sel) sel.value = '';
  document.getElementById('linkedApprovalBox')?.classList.add('hidden');
}

export async function submitExpense(e) {
  if (e) e.preventDefault();
  const isAuth = !!(typeof window.getCurrentUserEmail === 'function' && window.getCurrentUserEmail());
  if (!isAuth) {
    alert('경비 정산 신청을 위해 먼저 상단에서 사내 계정으로 로그인해 주세요.');
    document.getElementById('loginModal')?.classList.remove('hidden');
    return;
  }
  if (!selectedReceiptFile) {
    alert('영수증 사진 또는 카드 매출전표 캡처본을 등록해 주세요.');
    return;
  }

  const submitBtn = document.getElementById('submitBtn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="inline-block animate-spin mr-1">🔄</span> 영수증 업로드 및 저장 중...';
  }

  const employeeName = document.getElementById('employeeName')?.value.trim() || '';

  try {
    const fileExt = selectedReceiptFile.name.split('.').pop() || 'jpg';
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${fileExt}`;
    
    // Project 2 Storage 업로드
    const { error: uploadError } = await paymentSupabase.storage.from('receipts').upload(fileName, selectedReceiptFile);
    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = paymentSupabase.storage.from('receipts').getPublicUrl(fileName);

    const { error: dbError } = await paymentSupabase.from('expense_reports').insert([{
      employee_name: employeeName,
      payment_date: document.getElementById('paymentDate')?.value,
      merchant_name: document.getElementById('merchantName')?.value.trim() || '',
      approval_number: document.getElementById('approvalNumber')?.value.trim() || '',
      amount: parseInt(document.getElementById('amount')?.value || '0', 10),
      category: document.getElementById('expenseCategory')?.value || '기타 업무비',
      purpose: document.getElementById('purpose')?.value.trim() || '',
      receipt_url: publicUrl,
      approval_id: linkedApprovalId,
      approval_doc_no: linkedApprovalDocNo,
      status: 'PENDING'
    }]);
    if (dbError) throw dbError;

    localStorage.setItem('LAST_EMP_NAME', employeeName);
    alert('경비 정산 결재 신청이 성공적으로 접수되었습니다!');

    document.getElementById('expenseForm')?.reset();
    const today = new Date().toISOString().split('T')[0];
    if (document.getElementById('paymentDate')) document.getElementById('paymentDate').value = today;
    if (document.getElementById('employeeName')) document.getElementById('employeeName').value = employeeName;

    clearReceiptFile();
    clearLinkedApproval();
    await updatePaymentPendingBadge();
    switchPaymentSubTab('my');
  } catch (err) {
    alert('경비 저장 오류: ' + (err.message || 'Supabase DB 설정 확인 필요'));
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>💳</span> 경비 정산 결재 신청';
    }
  }
}

/**
 * HTML 특수문자 안전 이스케이프 유틸
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 🇰🇷 한글 금액 표기 유틸 (예: 4171875 -> 일금 사백일십칠만 일천팔백칠십오원정)
 */
export function numberToKoreanCurrency(amount) {
  const num = Math.floor(Math.abs(Number(amount) || 0));
  if (num === 0) return '일금 영원정';

  const units = ['', '만', '억', '조'];
  const smallDigits = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const posUnits = ['', '십', '백', '천'];

  let n = num;
  let result = '';
  let unitIdx = 0;

  while (n > 0) {
    const chunk = n % 10000;
    if (chunk > 0) {
      let chunkStr = '';
      let c = chunk;
      for (let i = 0; i < 4; i++) {
        const digit = c % 10;
        if (digit > 0) {
          const digitWord = (digit === 1 && i > 0) ? '' : smallDigits[digit];
          chunkStr = digitWord + posUnits[i] + chunkStr;
        }
        c = Math.floor(c / 10);
      }
      result = chunkStr + (units[unitIdx] ? units[unitIdx] + ' ' : '') + result;
    }
    unitIdx++;
    n = Math.floor(n / 10000);
  }

  return `일금 ${result.trim()}원정`;
}

/**
 * 한글 금액 실시간 미리보기 업데이트
 */
export function updateKoreanCurrencyPreview() {
  const val = Number(document.getElementById('appExpectedAmount')?.value || 0);
  const textEl = document.getElementById('appExpectedAmountKoreanText');
  if (textEl) {
    textEl.innerText = numberToKoreanCurrency(val);
  }
}

/**
 * 📦 동적 부품 구매 품목 그리드 관리
 */
export function addPurchaseItemRow(data = {}) {
  const tbody = document.getElementById('purchaseItemsTbody');
  if (!tbody) return;
  const defaultMaker = data.maker || 'ISSI';
  const defaultPart = data.part_no || '';
  const defaultQty = data.qty || 1000;
  const defaultPrice = data.unit_price !== undefined ? data.unit_price : 1.25;
  const defaultMemo = data.memo || '';

  const tr = document.createElement('tr');
  tr.className = 'border-b border-indigo-100 hover:bg-indigo-50/20 text-xs transition-colors';
  tr.innerHTML = `
    <td class="p-2 text-center text-slate-500 font-mono row-index font-bold"></td>
    <td class="p-2">
      <input type="text" name="part_no" value="${escapeHtml(defaultPart)}" placeholder="예: IS25LP128F-JBLE-TR (검색/자동완성)" autocomplete="off" oninput="window.handlePartNoAutocomplete && window.handlePartNoAutocomplete(this, event)" onfocus="window.handlePartNoAutocomplete && window.handlePartNoAutocomplete(this, event)" required class="w-full px-2 py-1.5 border border-slate-300 rounded-lg font-mono font-bold text-indigo-950 focus:border-indigo-500 focus:outline-none">
    </td>
    <td class="p-2">
      <input type="text" name="maker" value="${escapeHtml(defaultMaker)}" placeholder="예: ISSI, Winbond" class="w-full px-2 py-1.5 border border-slate-300 rounded-lg focus:border-indigo-500 focus:outline-none">
    </td>
    <td class="p-2">
      <input type="number" name="qty" min="1" value="${defaultQty}" required oninput="window.updatePurchaseTableTotals()" class="w-full px-2 py-1.5 text-right border border-slate-300 rounded-lg font-mono font-bold focus:border-indigo-500 focus:outline-none">
    </td>
    <td class="p-2">
      <input type="number" name="unit_price" step="0.0001" min="0" value="${defaultPrice}" required oninput="window.updatePurchaseTableTotals()" class="w-full px-2 py-1.5 text-right border border-slate-300 rounded-lg font-mono focus:border-indigo-500 focus:outline-none">
    </td>
    <td class="p-2 text-right font-mono font-bold text-indigo-900 line-total whitespace-nowrap">
      0
    </td>
    <td class="p-2">
      <input type="text" name="memo" value="${escapeHtml(defaultMemo)}" placeholder="리드타임, 안전재고 등" class="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-[11px] focus:border-indigo-500 focus:outline-none">
    </td>
    <td class="p-2 text-center whitespace-nowrap">
      <div class="flex items-center justify-center gap-1">
        <button type="button" onclick="window.duplicatePurchaseItemRow && window.duplicatePurchaseItemRow(this)" title="이 행 복제 (동일 제조사/단가로 새 품목 추가)" class="text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 w-7 h-7 rounded-lg inline-flex items-center justify-center font-bold text-xs cursor-pointer transition">
          📋
        </button>
        <button type="button" onclick="window.removePurchaseItemRow(this)" title="행 삭제" class="text-rose-500 hover:text-rose-700 hover:bg-rose-50 w-7 h-7 rounded-lg inline-flex items-center justify-center font-bold text-sm cursor-pointer transition">
          ✕
        </button>
      </div>
    </td>
  `;
  tbody.appendChild(tr);
  reindexPurchaseTableRows();
  updatePurchaseTableTotals();
}

/**
 * 📋 행 복제 (동일 제조사, 단가, 비고 정보를 가진 새 행 추가)
 */
export function duplicatePurchaseItemRow(btn) {
  const tr = btn.closest('tr');
  if (!tr) return;
  const partNo = tr.querySelector('input[name="part_no"]')?.value || '';
  const maker = tr.querySelector('input[name="maker"]')?.value || '';
  const qty = parseInt(tr.querySelector('input[name="qty"]')?.value || '1000', 10);
  const unitPrice = parseFloat(tr.querySelector('input[name="unit_price"]')?.value || '0');
  const memo = tr.querySelector('input[name="memo"]')?.value || '';

  addPurchaseItemRow({
    part_no: partNo,
    maker: maker,
    qty: qty,
    unit_price: unitPrice,
    memo: memo
  });

  const tbody = document.getElementById('purchaseItemsTbody');
  if (tbody && tbody.lastElementChild) {
    const input = tbody.lastElementChild.querySelector('input[name="part_no"]');
    if (input) {
      input.focus();
      input.select();
    }
  }
}

/**
 * ⚡ 부품 품번 (Part#) 실시간 인라인 자동완성
 */
let _currentAutocompleteInput = null;

export function handlePartNoAutocomplete(input, event) {
  _currentAutocompleteInput = input;
  window._currentAutocompleteInput = input;
  const val = (input.value || '').trim();
  const dropdown = document.getElementById('purchasePartAutocomplete');
  if (!dropdown) return;

  if (val.length < 1) {
    dropdown.classList.add('hidden');
    return;
  }

  const items = (window.cachedItems && Array.isArray(window.cachedItems)) ? window.cachedItems : [];
  if (items.length === 0) {
    dropdown.classList.add('hidden');
    return;
  }

  const q = val.toUpperCase();
  const matched = [];
  const seenParts = new Set();

  for (const item of items) {
    const pName = (item.part_name || item.partName || '').trim();
    const maker = (item.maker || '').trim();
    if (!pName) continue;
    if (pName.toUpperCase().includes(q) || maker.toUpperCase().includes(q)) {
      if (!seenParts.has(pName)) {
        seenParts.add(pName);
        matched.push(item);
        if (matched.length >= 7) break;
      }
    }
  }

  if (matched.length === 0) {
    dropdown.classList.add('hidden');
    return;
  }

  // 위치 계산 (인라인 입력창 바로 하단에 배치)
  const rect = input.getBoundingClientRect();
  dropdown.style.top = `${rect.bottom + window.scrollY + 4}px`;
  dropdown.style.left = `${rect.left + window.scrollX}px`;
  dropdown.style.width = `${Math.max(340, rect.width)}px`;

  dropdown.innerHTML = `
    <div class="px-3 py-1.5 bg-slate-900 text-white text-[11px] font-bold flex items-center justify-between">
      <span class="flex items-center gap-1.5"><span>⚡</span> 추천 재고 품번 (${matched.length}건)</span>
      <span class="text-[10px] text-slate-300">클릭 시 자동 기입</span>
    </div>
    <div class="divide-y divide-slate-100 max-h-60 overflow-y-auto">
      ${matched.map(m => {
        const pName = m.part_name || m.partName || '';
        const mfg = m.maker || '-';
        const price = (m.unit_usd !== undefined ? m.unit_usd : (m.unitUsd !== undefined ? m.unitUsd : 0)) || 0;
        const stock = m.stock || 0;
        const cust = m.customer && m.customer !== '-' ? m.customer : '본사 일반재고';
        return `
          <div class="p-2 hover:bg-indigo-50/80 cursor-pointer transition-colors flex items-center justify-between gap-2" onmousedown="event.preventDefault(); window.selectPartAutocomplete('${escapeHtml(pName)}', '${escapeHtml(mfg)}', ${price}, '${escapeHtml(cust)}')">
            <div class="min-w-0">
              <div class="font-mono font-bold text-indigo-950 truncate">${escapeHtml(pName)}</div>
              <div class="text-[10px] text-slate-500">${escapeHtml(mfg)} · 재고: <span class="font-bold text-slate-700">${stock.toLocaleString()} EA</span></div>
            </div>
            <div class="text-right shrink-0">
              <div class="font-mono font-bold text-emerald-700">$${price.toFixed(4)}</div>
              <div class="text-[9px] text-slate-400 truncate max-w-[90px]">${escapeHtml(cust)}</div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
  dropdown.classList.remove('hidden');
}

export function selectPartAutocomplete(partName, maker, unitPrice, customer) {
  const targetInput = _currentAutocompleteInput || window._currentAutocompleteInput;
  const dropdown = document.getElementById('purchasePartAutocomplete');
  if (dropdown) dropdown.classList.add('hidden');

  if (!targetInput) return;
  const tr = targetInput.closest('tr');
  if (!tr) return;

  targetInput.value = partName;
  const makerInput = tr.querySelector('input[name="maker"]');
  if (makerInput && maker && maker !== '-') makerInput.value = maker;

  const priceInput = tr.querySelector('input[name="unit_price"]');
  if (priceInput && unitPrice > 0) priceInput.value = unitPrice;

  const memoInput = tr.querySelector('input[name="memo"]');
  if (memoInput && (!memoInput.value || memoInput.value === '리드타임, 안전재고 등')) {
    if (customer && customer !== '-' && customer !== '본사 일반재고') {
      memoInput.value = `고객사 [${customer}] 납기 대응`;
    }
  }

  updatePurchaseTableTotals();

  const qtyInput = tr.querySelector('input[name="qty"]');
  if (qtyInput) {
    qtyInput.focus();
    qtyInput.select();
  }
}

// 자동완성 드롭다운 바깥 클릭 시 닫기 리스너
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const dd = document.getElementById('purchasePartAutocomplete');
    if (!dd || dd.classList.contains('hidden')) return;
    if (!e.target.closest('#purchasePartAutocomplete') && !e.target.closest('input[name="part_no"]')) {
      dd.classList.add('hidden');
    }
  });
}

export function removePurchaseItemRow(btn) {
  const tr = btn.closest('tr');
  const tbody = document.getElementById('purchaseItemsTbody');
  if (tbody && tbody.querySelectorAll('tr').length <= 1) {
    alert('최소 1개 이상의 부품 품목이 등록되어야 합니다.');
    return;
  }
  if (tr) tr.remove();
  reindexPurchaseTableRows();
  updatePurchaseTableTotals();
}

function reindexPurchaseTableRows() {
  const rows = document.querySelectorAll('#purchaseItemsTbody tr');
  rows.forEach((r, idx) => {
    const idxEl = r.querySelector('.row-index');
    if (idxEl) idxEl.innerText = idx + 1;
  });
}

export function updatePurchaseTableTotals() {
  const tbody = document.getElementById('purchaseItemsTbody');
  if (!tbody) return;
  const rows = tbody.querySelectorAll('tr');
  const currency = document.getElementById('appPurchaseCurrency')?.value || 'USD';
  const fxRate = parseFloat(document.getElementById('appPurchaseFxRate')?.value || '1334.18') || 1334.18;

  let totalQty = 0;
  let totalAmount = 0;

  rows.forEach(r => {
    const q = parseInt(r.querySelector('input[name="qty"]')?.value || '0', 10);
    const p = parseFloat(r.querySelector('input[name="unit_price"]')?.value || '0');
    const lineTotal = Math.round((q * p) * 10000) / 10000;
    totalQty += q;
    totalAmount += lineTotal;

    const lineTotalEl = r.querySelector('.line-total');
    if (lineTotalEl) {
      lineTotalEl.innerText = currency === 'USD'
        ? `$${lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
        : `₩${Math.round(lineTotal).toLocaleString()}`;
    }
  });

  const totalQtyEl = document.getElementById('purchaseTotalQty');
  const totalAmountEl = document.getElementById('purchaseTotalAmount');
  const fxSummaryEl = document.getElementById('purchaseFxSummary');

  if (totalQtyEl) totalQtyEl.innerText = `${totalQty.toLocaleString()} EA`;
  if (totalAmountEl) {
    totalAmountEl.innerText = currency === 'USD'
      ? `$${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `₩${Math.round(totalAmount).toLocaleString()}`;
  }

  const krwTotal = currency === 'USD' ? Math.round(totalAmount * fxRate) : Math.round(totalAmount);
  if (fxSummaryEl) {
    fxSummaryEl.innerText = currency === 'USD'
      ? `원화 환산 합계: ₩${krwTotal.toLocaleString()} (환율: ${fxRate.toLocaleString()}원)`
      : `원화 기준: ₩${krwTotal.toLocaleString()}`;
  }

  const docType = document.getElementById('appDocType')?.value;
  if (docType === '구매품의서') {
    const amountInput = document.getElementById('appExpectedAmount');
    if (amountInput) {
      amountInput.value = krwTotal;
      updateKoreanCurrencyPreview();
    }
  }
}

/**
 * 💳 동적 지출 항목 그리드 관리
 */
export function addExpenseItemRow(data = {}) {
  const tbody = document.getElementById('expenseItemsTbody');
  if (!tbody) return;
  const defaultItem = data.item || '';
  const defaultAmount = data.amount !== undefined ? data.amount : 0;
  const defaultNote = data.note || '';

  const tr = document.createElement('tr');
  tr.className = 'border-b border-slate-200 hover:bg-slate-50/60 text-xs transition-colors';
  tr.innerHTML = `
    <td class="p-2 text-center text-slate-500 font-mono row-index font-bold"></td>
    <td class="p-2">
      <input type="text" name="expense_item" value="${escapeHtml(defaultItem)}" placeholder="예: 시제품 제작 지원 식대, KTX 교통비" required class="w-full px-2 py-1.5 border border-slate-300 rounded-lg focus:border-indigo-500 focus:outline-none">
    </td>
    <td class="p-2">
      <input type="number" name="expense_amount" min="0" value="${defaultAmount}" required oninput="window.updateExpenseTableTotals()" class="w-full px-2 py-1.5 text-right border border-slate-300 rounded-lg font-mono font-bold text-slate-900 focus:border-indigo-500 focus:outline-none">
    </td>
    <td class="p-2">
      <input type="text" name="expense_note" value="${escapeHtml(defaultNote)}" placeholder="예: 4명 참석 (고객사 FAE 기술 미팅)" class="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-[11px] focus:border-indigo-500 focus:outline-none">
    </td>
    <td class="p-2 text-center">
      <button type="button" onclick="window.removeExpenseItemRow(this)" title="행 삭제" class="text-rose-500 hover:text-rose-700 hover:bg-rose-50 w-7 h-7 rounded-lg inline-flex items-center justify-center font-bold text-sm cursor-pointer transition">
        ✕
      </button>
    </td>
  `;
  tbody.appendChild(tr);
  reindexExpenseTableRows();
  updateExpenseTableTotals();
}

export function removeExpenseItemRow(btn) {
  const tr = btn.closest('tr');
  const tbody = document.getElementById('expenseItemsTbody');
  if (tbody && tbody.querySelectorAll('tr').length <= 1) {
    alert('최소 1개 이상의 지출 항목이 등록되어야 합니다.');
    return;
  }
  if (tr) tr.remove();
  reindexExpenseTableRows();
  updateExpenseTableTotals();
}

function reindexExpenseTableRows() {
  const rows = document.querySelectorAll('#expenseItemsTbody tr');
  rows.forEach((r, idx) => {
    const idxEl = r.querySelector('.row-index');
    if (idxEl) idxEl.innerText = idx + 1;
  });
}

export function updateExpenseTableTotals() {
  const tbody = document.getElementById('expenseItemsTbody');
  if (!tbody) return;
  const rows = tbody.querySelectorAll('tr');
  let totalAmount = 0;

  rows.forEach(r => {
    const amt = parseInt(r.querySelector('input[name="expense_amount"]')?.value || '0', 10);
    totalAmount += amt;
  });

  const totalAmountEl = document.getElementById('expenseTotalAmount');
  if (totalAmountEl) {
    totalAmountEl.innerText = `₩${totalAmount.toLocaleString()}`;
  }

  const docType = document.getElementById('appDocType')?.value;
  if (docType === '지출품의서') {
    const amountInput = document.getElementById('appExpectedAmount');
    if (amountInput) {
      amountInput.value = totalAmount;
      updateKoreanCurrencyPreview();
    }
  }
}

/**
 * 5. 내부 결재 품의서 상신 (지출/구매/출장/일반)
 */
export function toggleApprovalAmountField() {
  const docTypeEl = document.getElementById('appDocType');
  if (!docTypeEl) return;
  const docType = docTypeEl.value;
  const isGeneral = docType === '일반업무기안';
  const amountInput = document.getElementById('appExpectedAmount');
  if (amountInput) {
    amountInput.value = isGeneral ? 0 : (amountInput.value || 0);
    amountInput.disabled = isGeneral;
    amountInput.required = !isGeneral;
    amountInput.classList.toggle('bg-slate-100', isGeneral);
  }

  const typeFields = {
    '지출품의서': 'appFieldsExpense',
    '구매품의서': 'appFieldsPurchase',
    '출장기안서': 'appFieldsTravel',
    '일반업무기안': 'appFieldsGeneral'
  };

  Object.entries(typeFields).forEach(([type, fieldsetId]) => {
    const fieldset = document.getElementById(fieldsetId);
    if (!fieldset) return;
    const isActive = type === docType;
    fieldset.disabled = !isActive;
    fieldset.classList.toggle('hidden', !isActive);
  });

  if (docType === '구매품의서') {
    updatePurchaseTableTotals();
  } else if (docType === '지출품의서') {
    updateExpenseTableTotals();
  } else {
    updateKoreanCurrencyPreview();
  }
}

/**
 * 표준 4단 공문서 본문 생성 (ERP 연동용 JSON 메타데이터 포함)
 */
export function buildApprovalContent(docType) {
  const purpose = document.getElementById('appPurpose')?.value.trim() || '';
  const budgetPlan = document.getElementById('appBudgetPlan')?.value.trim() || '';
  const expectedEffect = document.getElementById('appExpectedEffect')?.value.trim() || '';

  let sectionTitle = 'Ⅱ. 세부 품의 명세';
  let sectionContent = '';
  let draftData = {
    version: '2.0',
    docType,
    purpose,
    budgetPlan,
    expectedEffect,
    createdAt: new Date().toISOString()
  };
  let metaPayload = null;

  if (docType === '구매품의서') {
    const vendor = document.getElementById('appPurchaseVendor')?.value.trim() || '미정';
    const customer = document.getElementById('appPurchaseCustomer')?.value.trim() || '본사 일반재고';
    const currency = document.getElementById('appPurchaseCurrency')?.value || 'USD';
    const fxRate = parseFloat(document.getElementById('appPurchaseFxRate')?.value || '1334.18') || 1334.18;

    const rows = document.querySelectorAll('#purchaseItemsTbody tr');
    const items = [];
    let totalQty = 0;
    let totalAmount = 0;

    rows.forEach(r => {
      const partNo = r.querySelector('input[name="part_no"]')?.value.trim() || '';
      const maker = r.querySelector('input[name="maker"]')?.value.trim() || '기타';
      const qty = parseInt(r.querySelector('input[name="qty"]')?.value || '0', 10);
      const unitPrice = parseFloat(r.querySelector('input[name="unit_price"]')?.value || '0');
      const memo = r.querySelector('input[name="memo"]')?.value.trim() || '';
      const lineTotal = Math.round((qty * unitPrice) * 10000) / 10000;

      if (partNo || qty > 0) {
        items.push({
          part_no: partNo,
          maker,
          qty,
          unit_price: unitPrice,
          currency,
          line_total: lineTotal,
          memo
        });
        totalQty += qty;
        totalAmount += lineTotal;
      }
    });

    const krwTotal = currency === 'USD' ? Math.round(totalAmount * fxRate) : Math.round(totalAmount);

    // 하위 호환 필드 동기화
    if (items.length > 0) {
      const first = items[0];
      const pNoEl = document.getElementById('appPurchasePartNo');
      const pMakerEl = document.getElementById('appPurchaseMaker');
      const pQtyEl = document.getElementById('appPurchaseQty');
      const pPriceEl = document.getElementById('appPurchaseUnitPrice');
      const pItemsEl = document.getElementById('appPurchaseItems');
      if (pNoEl) pNoEl.value = first.part_no;
      if (pMakerEl) pMakerEl.value = first.maker;
      if (pQtyEl) pQtyEl.value = first.qty;
      if (pPriceEl) pPriceEl.value = first.unit_price;
      if (pItemsEl) pItemsEl.value = items.map(i => `${i.part_no} (${i.qty.toLocaleString()} EA)`).join(', ');
    }

    const itemLines = items.map((i, idx) => 
      `  ${idx + 1}. [${i.maker}] ${i.part_no} | 수량: ${i.qty.toLocaleString()} EA | 단가: ${currency === 'USD' ? '$' : '₩'}${i.unit_price.toLocaleString()} (${currency}) | 공급가액: ${currency === 'USD' ? '$' : '₩'}${i.line_total.toLocaleString()} ${i.memo ? '| ' + i.memo : ''}`
    ).join('\n');

    sectionContent = [
      `• 공급업체(Vendor): ${vendor}`,
      `• 실수요처/배정(Customer): ${customer}`,
      `• 발주 통화 및 환율: ${currency} (환율 ₩${fxRate.toLocaleString()}/$)`,
      `• 발주 품목 명세 (총 ${items.length}건, ${totalQty.toLocaleString()} EA):`,
      itemLines,
      `• 발주 합계: ${currency === 'USD' ? '$' : '₩'}${totalAmount.toLocaleString(undefined, {minimumFractionDigits: 2})} (원화 환산 합계: ₩${krwTotal.toLocaleString()})`
    ].join('\n');

    draftData.vendor = vendor;
    draftData.customer = customer;
    draftData.currency = currency;
    draftData.fxRate = fxRate;
    draftData.items = items;
    draftData.totalQty = totalQty;
    draftData.totalAmount = totalAmount;
    draftData.krwTotal = krwTotal;

    metaPayload = {
      vendor,
      maker: items[0]?.maker || '기타',
      part_name: items.length > 1 ? `${items[0]?.part_no} 외 ${items.length - 1}건` : (items[0]?.part_no || ''),
      qty: totalQty,
      unit_price: items[0]?.unit_price || 0,
      currency,
      customer,
      memo: `${purpose} | 발주 총 ${items.length}건`,
      items
    };
  } else if (docType === '지출품의서') {
    const rows = document.querySelectorAll('#expenseItemsTbody tr');
    const items = [];
    let totalAmount = 0;

    rows.forEach(r => {
      const item = r.querySelector('input[name="expense_item"]')?.value.trim() || '';
      const amount = parseInt(r.querySelector('input[name="expense_amount"]')?.value || '0', 10);
      const note = r.querySelector('input[name="expense_note"]')?.value.trim() || '';

      if (item || amount > 0) {
        items.push({ item, amount, note });
        totalAmount += amount;
      }
    });

    const itemLines = items.map((i, idx) => 
      `  ${idx + 1}. ${i.item} | 금액: ₩${i.amount.toLocaleString()} | 내역: ${i.note || '-'}`
    ).join('\n');

    sectionContent = [
      `• 세부 지출 항목 (총 ${items.length}건):`,
      itemLines,
      `• 지출 합계: ₩${totalAmount.toLocaleString()}`
    ].join('\n');

    draftData.items = items;
    draftData.totalAmount = totalAmount;
  } else if (docType === '출장기안서') {
    const dest = document.getElementById('appTravelDestination')?.value.trim() || '';
    const sDate = document.getElementById('appTravelStartDate')?.value || '';
    const eDate = document.getElementById('appTravelEndDate')?.value || '';
    const sched = document.getElementById('appTravelSchedule')?.value.trim() || '';
    sectionContent = [
      `• 목적지: ${dest}`,
      `• 기간: ${sDate} ~ ${eDate}`,
      `• 방문 일정 및 업무 목표: \n${sched}`
    ].join('\n');
    draftData.travel = { dest, sDate, eDate, sched };
  } else if (docType === '일반업무기안') {
    const outcome = document.getElementById('appGeneralOutcome')?.value.trim() || '';
    sectionContent = `• 업무 목표 및 완료 기준: \n${outcome}`;
    draftData.outcome = outcome;
  }

  const structuredText = [
    `Ⅰ. 추진 배경 및 필요성\n${purpose || '(내용 없음)'}`,
    `\n${sectionTitle}\n${sectionContent}`,
    `\nⅢ. 예산 집행 계획\n${budgetPlan || '(내용 없음)'}`,
    `\nⅣ. 기대 효과\n${expectedEffect || '(내용 없음)'}`
  ].join('\n');

  let fullContent = structuredText;
  fullContent += `\n\n<!-- DRAFT_DATA: ${JSON.stringify(draftData)} -->`;
  if (metaPayload) {
    fullContent += `\n\n<!-- ERP_META: ${JSON.stringify(metaPayload)} -->`;
  }

  const appContentEl = document.getElementById('appContent');
  if (appContentEl) appContentEl.value = fullContent;

  return fullContent;
}

/**
 * 🚀 [견적·재고 -> 전자결재 품의 역연동 (단일 또는 다중 품목)]
 * 영업 견적/재고 화면에서 특정 부품 또는 체크된 다중 품목으로 구매품의서 작성 폼 자동 이동 및 일괄 프리필
 */
export function openPurchaseRequisitionForParts(parts = []) {
  if (!Array.isArray(parts) || parts.length === 0) return;

  // 1. Tab 7 (전자결재·품의) 전환
  if (typeof window.switchToPaymentTab === 'function') {
    window.switchToPaymentTab();
  } else if (typeof window.switchMainTab === 'function') {
    window.switchMainTab('tabPayment');
  }

  // 2. [품의작성] 서브탭 활성화
  if (typeof window.switchPaymentSubTab === 'function') {
    window.switchPaymentSubTab('approval');
  }

  // 3. 품의 구분을 '구매품의서'로 강제 설정 및 필드 전환
  const docTypeEl = document.getElementById('appDocType');
  if (docTypeEl) {
    docTypeEl.value = '구매품의서';
    toggleApprovalAmountField();
  }

  const first = parts[0];
  const firstPartName = first.part_no || first.part_name || first.partName || '부품';
  const firstMaker = first.maker || '기타';
  const customer = (first.customer && first.customer !== '-') ? first.customer : '본사 일반재고';
  const currency = first.currency || 'USD';
  const vendor = first.vendor || (firstMaker && firstMaker !== '기타' ? `${firstMaker} 공식 대리점 / 본사 직납` : '공급업체 미정');

  // 4. 공급처, 실수요처, 통화 프리필
  const vendorEl = document.getElementById('appPurchaseVendor');
  if (vendorEl) vendorEl.value = vendor;

  const customerEl = document.getElementById('appPurchaseCustomer');
  if (customerEl) customerEl.value = customer;

  const currEl = document.getElementById('appPurchaseCurrency');
  if (currEl) currEl.value = currency;

  // 5. 다중 품목 테이블 채우기
  const tbody = document.getElementById('purchaseItemsTbody');
  if (tbody) {
    tbody.innerHTML = '';
    parts.forEach(p => {
      const pName = p.part_no || p.part_name || p.partName || '';
      const pMaker = p.maker || 'ISSI';
      const pQty = parseInt(p.qty || p.stock || 1000, 10) || 1000;
      const pPrice = parseFloat(p.unit_price !== undefined ? p.unit_price : (p.unit_usd !== undefined ? p.unit_usd : (p.unitUsd !== undefined ? p.unitUsd : 1.0))) || 0;
      const pMemo = p.memo || (p.customer && p.customer !== '-' ? `고객사 [${p.customer}] 납기 대응` : '안전재고 확보');
      addPurchaseItemRow({
        part_no: pName,
        maker: pMaker,
        qty: pQty,
        unit_price: pPrice,
        memo: pMemo
      });
    });
  }

  // 6. 표준 공문서 제목 및 4단 기안 내용 자동 완성
  const titleEl = document.getElementById('appTitle');
  if (titleEl) {
    if (parts.length === 1) {
      const q = parseInt(first.qty || first.stock || 1000, 10) || 1000;
      titleEl.value = `[부품구매] ${firstPartName} (${q.toLocaleString()} EA) 매입 및 안전재고 확보 품의의 건`;
    } else {
      titleEl.value = `[부품구매] ${firstPartName} 외 ${parts.length - 1}개 품목 매입 및 안전재고 확보 품의의 건`;
    }
  }

  const purposeEl = document.getElementById('appPurpose');
  if (purposeEl) {
    if (parts.length === 1) {
      purposeEl.value = `고객사 [${customer}] 납기 대응 및 양산 소요 대비 안전재고 확보를 위한 긴급 매입 품의의 건입니다.`;
    } else {
      purposeEl.value = `고객사 납기 대응 및 주요 품목(${firstPartName} 등 총 ${parts.length}종) 양산 소요 대비 안전재고 확보를 위한 긴급 매입 품의의 건입니다.`;
    }
  }

  const budgetEl = document.getElementById('appBudgetPlan');
  if (budgetEl) {
    budgetEl.value = `공급처(${vendor}) 외상 매입 (여신 조건: Net 30일 지급 예정)`;
  }

  const effectEl = document.getElementById('appExpectedEffect');
  if (effectEl) {
    effectEl.value = `부품 리드타임 단축 및 고객사 결품 방지, 안정적인 납기 경쟁력 확보`;
  }

  // 7. 총액 및 한글 금액 실시간 재계산
  updatePurchaseTableTotals();

  // 8. 폼 영역으로 부드럽게 스크롤
  setTimeout(() => {
    const formEl = document.getElementById('paymentSectionApproval');
    if (formEl) {
      formEl.scrollIntoView({ behavior: 'smooth' });
    }
  }, 100);
}

export function openPurchaseRequisitionForPart(partData = {}) {
  openPurchaseRequisitionForParts([partData]);
}

/**
 * 📦 ERP 재고 및 부품 품목 빠른 검색·다중 선택 모달 로직
 */
let partPickerSelectedIds = new Set();
let partPickerCurrentList = [];

export async function openPartPickerModal() {
  const modal = document.getElementById('partPickerModal');
  if (!modal) return;
  modal.classList.remove('hidden');

  // 데이터 확인 및 로드
  if (!window.cachedItems || window.cachedItems.length === 0) {
    const tbody = document.getElementById('partPickerTableBody');
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="p-8 text-center text-slate-500">
            <div class="inline-block animate-spin text-xl mb-2">⏳</div>
            <div>ERP 재고 데이터를 불러오는 중입니다...</div>
          </td>
        </tr>
      `;
    }
    if (typeof window.fetchInventoryItems === 'function') {
      try {
        const items = await window.fetchInventoryItems();
        window.cachedItems = items;
      } catch (e) {
        console.warn('재고 로드 실패:', e);
      }
    }
  }

  // 제조사 셀렉트박스 구성
  const makerSelect = document.getElementById('partPickerMakerFilter');
  if (makerSelect && window.cachedItems) {
    const makers = Array.from(new Set(window.cachedItems.map(it => (it.maker || '').trim()).filter(m => m && m !== '-'))).sort();
    makerSelect.innerHTML = '<option value="ALL">제조사 전체</option>' + makers.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  }

  // 검색창 초기화
  const searchInput = document.getElementById('partPickerSearchInput');
  if (searchInput) searchInput.value = '';

  const masterCb = document.getElementById('partPickerSelectAll');
  if (masterCb) masterCb.checked = false;

  partPickerSelectedIds.clear();
  updatePartPickerSelectedCount();
  filterPartPickerItems();

  if (searchInput) {
    setTimeout(() => searchInput.focus(), 100);
  }
}

export function closePartPickerModal() {
  document.getElementById('partPickerModal')?.classList.add('hidden');
}

export function filterPartPickerItems() {
  const q = (document.getElementById('partPickerSearchInput')?.value || '').trim().toLowerCase();
  const makerFilter = document.getElementById('partPickerMakerFilter')?.value || 'ALL';
  const tbody = document.getElementById('partPickerTableBody');
  if (!tbody) return;

  const items = (window.cachedItems && Array.isArray(window.cachedItems)) ? window.cachedItems : [];
  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400">등록된 ERP 재고 품목이 없습니다.</td></tr>`;
    return;
  }

  // 필터링
  const filtered = items.filter(it => {
    const m = (it.maker || '').trim();
    if (makerFilter !== 'ALL' && m !== makerFilter) return false;
    if (!q) return true;
    const p = (it.part_name || it.partName || '').toLowerCase();
    const cust = (it.customer || '').toLowerCase();
    const realCust = (it.real_customer || it.realCustomer || '').toLowerCase();
    return p.includes(q) || m.toLowerCase().includes(q) || cust.includes(q) || realCust.includes(q);
  });

  partPickerCurrentList = filtered;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400">검색 조건과 일치하는 재고 품목이 없습니다.</td></tr>`;
    return;
  }

  // 상위 150건 렌더링 (성능 최적화)
  const displayList = filtered.slice(0, 150);
  tbody.innerHTML = displayList.map(item => {
    const isChecked = partPickerSelectedIds.has(String(item.id));
    const pName = item.part_name || item.partName || '-';
    const maker = item.maker || '-';
    const stock = item.stock || 0;
    const arranged = item.arranged_qty || item.arrangedQty || 0;
    const unitUsd = parseFloat(item.unit_usd !== undefined ? item.unit_usd : (item.unitUsd || 0));
    const cust = item.customer && item.customer !== '-' ? item.customer : '본사 일반재고';
    const owner = item.owner || '공용';

    return `
      <tr class="border-b border-slate-100 hover:bg-indigo-50/50 cursor-pointer transition-colors ${isChecked ? 'bg-indigo-50/70' : ''}" onclick="window.togglePartPickerRow('${item.id}', event)">
        <td class="p-2 text-center" onclick="event.stopPropagation()">
          <input type="checkbox" class="part-picker-cb rounded cursor-pointer" data-item-id="${item.id}" ${isChecked ? 'checked' : ''} onchange="window.handlePartPickerCheckbox('${item.id}', this.checked)">
        </td>
        <td class="p-2 font-mono font-bold text-indigo-950">
          <div class="truncate max-w-[200px]" title="${escapeHtml(pName)}">${escapeHtml(pName)}</div>
        </td>
        <td class="p-2 text-center">
          <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">${escapeHtml(maker)}</span>
        </td>
        <td class="p-2 text-right font-mono">
          <span class="font-bold text-slate-800">${stock.toLocaleString()}</span>
          <span class="text-[10px] text-slate-400">/ ${arranged.toLocaleString()}</span>
        </td>
        <td class="p-2 text-right font-mono font-bold text-emerald-700">
          $${unitUsd.toFixed(4)}
        </td>
        <td class="p-2 text-slate-600 truncate max-w-[130px]" title="${escapeHtml(cust)} (${escapeHtml(owner)})">
          <div class="truncate font-medium">${escapeHtml(cust)}</div>
          <div class="text-[10px] text-slate-400 truncate">${escapeHtml(owner)}</div>
        </td>
        <td class="p-2 text-center" onclick="event.stopPropagation()">
          <button type="button" onclick="window.addSinglePartToPurchase('${item.id}', this)" class="px-2 py-1 bg-indigo-50 hover:bg-indigo-600 text-indigo-700 hover:text-white rounded font-bold text-[10px] border border-indigo-200 transition cursor-pointer" title="이 품목 즉시 품의서에 추가">
            + 추가
          </button>
        </td>
      </tr>
    `;
  }).join('');

  if (filtered.length > 150) {
    tbody.innerHTML += `
      <tr>
        <td colspan="7" class="p-2 text-center text-[11px] text-slate-400 bg-slate-50">
          ※ 검색 결과가 많아 상위 150건만 표시됩니다. 더 정확한 결과를 위해 검색어를 입력해 주세요. (총 ${filtered.length.toLocaleString()}건)
        </td>
      </tr>
    `;
  }
}

export function refreshPartPickerList() {
  filterPartPickerItems();
}

export function togglePartPickerRow(id, event) {
  const isSelected = partPickerSelectedIds.has(String(id));
  if (isSelected) {
    partPickerSelectedIds.delete(String(id));
  } else {
    partPickerSelectedIds.add(String(id));
  }
  updatePartPickerRowUI(id, !isSelected);
  updatePartPickerSelectedCount();
}

export function handlePartPickerCheckbox(id, checked) {
  if (checked) {
    partPickerSelectedIds.add(String(id));
  } else {
    partPickerSelectedIds.delete(String(id));
  }
  updatePartPickerRowUI(id, checked);
  updatePartPickerSelectedCount();
}

function updatePartPickerRowUI(id, isChecked) {
  const cb = document.querySelector(`.part-picker-cb[data-item-id="${id}"]`);
  if (cb) cb.checked = isChecked;
  const tr = cb?.closest('tr');
  if (tr) {
    if (isChecked) {
      tr.classList.add('bg-indigo-50/70');
    } else {
      tr.classList.remove('bg-indigo-50/70');
    }
  }
}

export function togglePartPickerSelectAll(masterCb) {
  const isChecked = masterCb.checked;
  partPickerCurrentList.slice(0, 150).forEach(item => {
    if (isChecked) {
      partPickerSelectedIds.add(String(item.id));
    } else {
      partPickerSelectedIds.delete(String(item.id));
    }
    updatePartPickerRowUI(item.id, isChecked);
  });
  updatePartPickerSelectedCount();
}

function updatePartPickerSelectedCount() {
  const countEl = document.getElementById('partPickerSelectedCount');
  if (countEl) countEl.innerText = partPickerSelectedIds.size;
  const btn = document.getElementById('partPickerConfirmBtn');
  if (btn) {
    if (partPickerSelectedIds.size > 0) {
      btn.innerHTML = `<span>➕</span> 선택 ${partPickerSelectedIds.size}건 품의서에 추가`;
      btn.className = 'px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold rounded-lg text-xs shadow transition cursor-pointer flex items-center gap-1.5';
    } else {
      btn.innerHTML = `<span>➕</span> 선택 품목 품의서에 추가`;
      btn.className = 'px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs shadow transition cursor-pointer flex items-center gap-1.5';
    }
  }
}

export function addSinglePartToPurchase(itemId, btnEl) {
  const items = (window.cachedItems && Array.isArray(window.cachedItems)) ? window.cachedItems : [];
  const item = items.find(it => String(it.id) === String(itemId));
  if (!item) return;

  const tbody = document.getElementById('purchaseItemsTbody');
  if (!tbody) return;

  const rows = tbody.querySelectorAll('tr');
  const pName = item.part_name || item.partName || '';
  const maker = item.maker || 'ISSI';
  const unitPrice = parseFloat(item.unit_usd !== undefined ? item.unit_usd : (item.unitUsd || 0));
  const qty = parseInt(item.stock || 1000, 10) || 1000;
  const cust = item.customer && item.customer !== '-' ? item.customer : '';
  const memo = cust ? `고객사 [${cust}] 납기 대응` : '안전재고 확보';

  // 첫 번째 행이 기본 빈 상태인지 확인
  if (rows.length === 1) {
    const firstPartInput = rows[0].querySelector('input[name="part_no"]');
    const firstPartVal = (firstPartInput?.value || '').trim();
    if (!firstPartVal) {
      // 1행 채우기
      firstPartInput.value = pName;
      const mInput = rows[0].querySelector('input[name="maker"]');
      if (mInput) mInput.value = maker;
      const pInput = rows[0].querySelector('input[name="unit_price"]');
      if (pInput) pInput.value = unitPrice;
      const qInput = rows[0].querySelector('input[name="qty"]');
      if (qInput) qInput.value = qty;
      const memoInput = rows[0].querySelector('input[name="memo"]');
      if (memoInput) memoInput.value = memo;

      updatePurchaseTableTotals();
      if (btnEl) {
        btnEl.innerText = '✓ 완료';
        btnEl.className = 'px-2 py-1 bg-emerald-600 text-white rounded font-bold text-[10px] transition';
        setTimeout(() => {
          btnEl.innerText = '+ 추가';
          btnEl.className = 'px-2 py-1 bg-indigo-50 hover:bg-indigo-600 text-indigo-700 hover:text-white rounded font-bold text-[10px] border border-indigo-200 transition cursor-pointer';
        }, 1200);
      }
      return;
    }
  }

  // 새 행 추가
  addPurchaseItemRow({
    part_no: pName,
    maker: maker,
    qty: qty,
    unit_price: unitPrice,
    memo: memo
  });

  if (btnEl) {
    btnEl.innerText = '✓ 추가됨';
    btnEl.className = 'px-2 py-1 bg-emerald-600 text-white rounded font-bold text-[10px] transition';
    setTimeout(() => {
      btnEl.innerText = '+ 추가';
      btnEl.className = 'px-2 py-1 bg-indigo-50 hover:bg-indigo-600 text-indigo-700 hover:text-white rounded font-bold text-[10px] border border-indigo-200 transition cursor-pointer';
    }, 1200);
  }
}

export function confirmPartPickerSelection() {
  if (partPickerSelectedIds.size === 0) {
    alert('품의서에 추가할 부품 품목을 최소 1개 이상 체크해 주세요.');
    return;
  }

  const items = (window.cachedItems && Array.isArray(window.cachedItems)) ? window.cachedItems : [];
  const selectedItems = [];
  partPickerSelectedIds.forEach(id => {
    const it = items.find(x => String(x.id) === String(id));
    if (it) selectedItems.push(it);
  });

  if (selectedItems.length === 0) {
    alert('선택한 품목 데이터를 찾을 수 없습니다.');
    return;
  }

  const tbody = document.getElementById('purchaseItemsTbody');
  if (!tbody) return;

  const rows = tbody.querySelectorAll('tr');
  let startIdx = 0;

  // 1행이 비어있는지 체크
  if (rows.length === 1) {
    const firstPartInput = rows[0].querySelector('input[name="part_no"]');
    const firstPartVal = (firstPartInput?.value || '').trim();
    if (!firstPartVal) {
      const first = selectedItems[0];
      firstPartInput.value = first.part_name || first.partName || '';
      const mInput = rows[0].querySelector('input[name="maker"]');
      if (mInput) mInput.value = first.maker || 'ISSI';
      const pInput = rows[0].querySelector('input[name="unit_price"]');
      if (pInput) pInput.value = parseFloat(first.unit_usd !== undefined ? first.unit_usd : (first.unitUsd || 0));
      const qInput = rows[0].querySelector('input[name="qty"]');
      if (qInput) qInput.value = parseInt(first.stock || 1000, 10) || 1000;
      const memoInput = rows[0].querySelector('input[name="memo"]');
      if (memoInput) memoInput.value = first.customer && first.customer !== '-' ? `고객사 [${first.customer}] 납기 대응` : '안전재고 확보';

      startIdx = 1;
    }
  }

  // 나머지 품목들 addPurchaseItemRow로 추가
  for (let i = startIdx; i < selectedItems.length; i++) {
    const it = selectedItems[i];
    addPurchaseItemRow({
      part_no: it.part_name || it.partName || '',
      maker: it.maker || 'ISSI',
      qty: parseInt(it.stock || 1000, 10) || 1000,
      unit_price: parseFloat(it.unit_usd !== undefined ? it.unit_usd : (it.unitUsd || 0)),
      memo: it.customer && it.customer !== '-' ? `고객사 [${it.customer}] 납기 대응` : '안전재고 확보'
    });
  }

  updatePurchaseTableTotals();
  closePartPickerModal();
}

export async function submitApproval(e) {
  if (e) e.preventDefault();
  const isAuth = !!(typeof window.getCurrentUserEmail === 'function' && window.getCurrentUserEmail());
  if (!isAuth) {
    alert('전자결재 품의서를 상신하려면 먼저 상단에서 사내 계정으로 로그인해 주세요.');
    document.getElementById('loginModal')?.classList.remove('hidden');
    return;
  }
  const btn = document.getElementById('appSubmitBtn');
  const docType = document.getElementById('appDocType')?.value || '지출품의서';

  if (docType === '출장기안서') {
    const sDate = document.getElementById('appTravelStartDate')?.value;
    const eDate = document.getElementById('appTravelEndDate')?.value;
    if (sDate && eDate && sDate > eDate) {
      alert('출장 종료일은 시작일보다 빠를 수 없습니다.');
      return;
    }
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="inline-block animate-spin mr-1">🔄</span> 품의서 상신 처리 중...';
  }

  const drafterName = document.getElementById('appDrafterName')?.value.trim() || '';
  const department = document.getElementById('appDepartment')?.value.trim() || '영업/기술지원팀';
  const now = new Date();
  const docNo = `BSK-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${String(Math.floor(100 + Math.random() * 900))}`;

  try {
    let attachmentUrl = '';
    const attachFile = document.getElementById('appAttachmentInput')?.files?.[0];
    if (attachFile && paymentSupabase) {
      const ext = attachFile.name.split('.').pop() || 'bin';
      const storagePath = `approvals/${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${ext}`;
      const { error: upErr } = await paymentSupabase.storage.from('receipts').upload(storagePath, attachFile);
      if (upErr) throw upErr;
      attachmentUrl = paymentSupabase.storage.from('receipts').getPublicUrl(storagePath).data.publicUrl;
    }

    const { error } = await paymentSupabase.from('approval_requests').insert([{
      doc_no: docNo,
      drafter_name: drafterName,
      department: department,
      doc_type: docType,
      title: document.getElementById('appTitle')?.value.trim() || '',
      content: buildApprovalContent(docType),
      expected_amount: parseInt(document.getElementById('appExpectedAmount')?.value || '0', 10),
      category: document.getElementById('appCategory')?.value || '일반행정 / 해당없음',
      target_date: document.getElementById('appTargetDate')?.value || null,
      attachment_url: attachmentUrl,
      status: 'PENDING'
    }]);
    if (error) throw error;

    localStorage.setItem('LAST_EMP_NAME', drafterName);
    alert(`전자결재 품의서가 성공적으로 상신되었습니다!\n문서번호: ${docNo}\n관리자 최종 승인 시 상태가 업데이트됩니다.`);

    document.getElementById('approvalForm')?.reset();
    if (document.getElementById('appDrafterName')) document.getElementById('appDrafterName').value = drafterName;
    if (document.getElementById('appDepartment')) document.getElementById('appDepartment').value = department;
    const today = new Date().toISOString().split('T')[0];
    if (document.getElementById('appTargetDate')) document.getElementById('appTargetDate').value = today;

    toggleApprovalAmountField();
    await updatePaymentPendingBadge();
    switchPaymentSubTab('my');
    switchMySubTab('approval');
  } catch (err) {
    alert('품의 상신 오류: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>📤</span> 전자결재 품의서 상신하기';
    }
  }
}

/**
 * 6. 내 문서함 (품의 및 경비 조회)
 */
export function switchMySubTab(sub) {
  const isExp = sub === 'expense';
  document.getElementById('myExpensePanel')?.classList.toggle('hidden', !isExp);
  document.getElementById('myApprovalPanel')?.classList.toggle('hidden', isExp);

  const active = "px-3.5 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white shadow-xs transition cursor-pointer";
  const inactive = "px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200 transition cursor-pointer";

  const btnExp = document.getElementById('mySubTabExpense');
  const btnApp = document.getElementById('mySubTabApproval');
  if (btnExp) btnExp.className = isExp ? active : inactive;
  if (btnApp) btnApp.className = !isExp ? active : inactive;
}

export function loadMyAllDocs() {
  const isAuth = !!(typeof window.getCurrentUserEmail === 'function' && window.getCurrentUserEmail());
  if (!isAuth) {
    alert('내 문서함을 조회하려면 먼저 상단에서 사내 계정으로 로그인해 주세요.');
    document.getElementById('loginModal')?.classList.remove('hidden');
    return;
  }
  const name = document.getElementById('myLookupName')?.value.trim();
  if (!name) {
    alert('조회할 사원명을 입력해 주세요.');
    return;
  }
  loadMyExpenses(name);
  loadMyApprovals(name);
}

export async function loadMyExpenses(name) {
  const tbody = document.getElementById('myExpenseTableBody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="8" class="text-center py-10 text-slate-400">경비 정산 내역 조회 중...</td></tr>`;

  try {
    const { data, error } = await paymentSupabase
      .from('expense_reports')
      .select('*')
      .ilike('employee_name', `%${name}%`)
      .order('payment_date', { ascending: false });
    if (error) throw error;
    const myData = data || [];

    if (myData.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-10 text-slate-400">'${name}' 사원의 경비 청구 내역이 없습니다.</td></tr>`;
      return;
    }

    tbody.innerHTML = '';
    myData.forEach(item => {
      const tr = document.createElement('tr');
      tr.className = "hover:bg-slate-50/80 transition border-b border-slate-100";
      const docTag = item.approval_doc_no
        ? `<span class="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[10px] font-mono border border-indigo-200">${item.approval_doc_no}</span>`
        : '<span class="text-slate-300">-</span>';

      tr.innerHTML = `
        <td class="py-3 px-3 font-mono whitespace-nowrap">${item.payment_date}</td>
        <td class="py-3 px-3 whitespace-nowrap">${docTag}</td>
        <td class="py-3 px-3 max-w-[130px] truncate whitespace-nowrap font-medium text-slate-800">${item.merchant_name || '-'}</td>
        <td class="py-3 px-3 font-mono text-slate-500 whitespace-nowrap">${item.approval_number}</td>
        <td class="py-3 px-3 font-bold text-slate-900 font-mono whitespace-nowrap">₩${Number(item.amount).toLocaleString()}</td>
        <td class="py-3 px-3 max-w-xs truncate whitespace-nowrap text-slate-600" title="${item.purpose}">${item.purpose}</td>
        <td class="py-3 px-3 text-center whitespace-nowrap">
          <button type="button" onclick="window.openPaymentReceiptModal('${item.receipt_url}')" class="text-blue-600 hover:text-blue-800 font-semibold inline-flex items-center gap-1 cursor-pointer">
            <span>🔍</span> 영수증
          </button>
        </td>
        <td class="py-3 px-3 text-center whitespace-nowrap">
          ${getStatusBadgeHtml(item.status, item.reject_reason)}
          ${item.status === 'REJECTED' && item.reject_reason ? `<div class="text-[10px] text-rose-500 mt-0.5 font-medium">${item.reject_reason}</div>` : ''}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-10 text-rose-500">조회 오류가 발생했습니다.</td></tr>`;
  }
}

export async function loadMyApprovals(name) {
  const tbody = document.getElementById('myApprovalTableBody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" class="text-center py-10 text-slate-400">품의서 내역 조회 중...</td></tr>`;

  try {
    const { data, error } = await paymentSupabase
      .from('approval_requests')
      .select('*')
      .ilike('drafter_name', `%${name}%`)
      .order('created_at', { ascending: false });
    if (error) throw error;
    myApprovalDocsCache = data || [];

    if (myApprovalDocsCache.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-10 text-slate-400">'${name}' 사원의 품의 내역이 없습니다.</td></tr>`;
      return;
    }

    tbody.innerHTML = '';
    myApprovalDocsCache.forEach(doc => {
      const tr = document.createElement('tr');
      tr.className = "hover:bg-slate-50/80 transition border-b border-slate-100";
      tr.innerHTML = `
        <td class="py-3 px-3 font-mono text-indigo-700 font-bold whitespace-nowrap">${doc.doc_no}</td>
        <td class="py-3 px-3 whitespace-nowrap"><span class="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[11px] font-semibold">${doc.doc_type}</span></td>
        <td class="py-3 px-3 font-semibold text-slate-900 max-w-xs truncate" title="${doc.title}">${doc.title}</td>
        <td class="py-3 px-3 font-mono font-bold whitespace-nowrap">₩${Number(doc.expected_amount || 0).toLocaleString()}</td>
        <td class="py-3 px-3 font-mono text-slate-500 whitespace-nowrap">${(doc.created_at || '').split('T')[0]}</td>
        <td class="py-3 px-3 text-center whitespace-nowrap">
          <button type="button" onclick="window.openPaymentDocModal(${doc.id}, 'my')" class="text-indigo-600 hover:text-indigo-800 font-bold inline-flex items-center gap-1 cursor-pointer">
            <span>📄</span> 기안서 보기
          </button>
        </td>
        <td class="py-3 px-3 text-center whitespace-nowrap">
          ${getStatusBadgeHtml(doc.status, doc.reject_reason)}
          ${doc.status === 'REJECTED' && doc.reject_reason ? `<div class="text-[10px] text-rose-500 mt-0.5 font-medium">${doc.reject_reason}</div>` : ''}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-10 text-rose-500">품의 조회 오류가 발생했습니다.</td></tr>`;
  }
}

/**
 * 상태 뱃지 렌더러
 */
export function getStatusBadgeHtml(status, rejectReason) {
  if (status === 'APPROVED') {
    return '<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">승인완료</span>';
  }
  if (status === 'REJECTED') {
    const tip = rejectReason ? ` title="사유: ${rejectReason}"` : '';
    return `<span${tip} class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-700 border border-rose-300 cursor-help">반려됨</span>`;
  }
  return '<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300">결재대기</span>';
}

/**
 * 7. 관리자 결재 대시보드
 */
export async function loadAllAdminPaymentData() {
  await Promise.all([loadAdminExpenseData(), loadAdminApprovalData()]);
  const expPending = allExpenses.filter(x => x.status === 'PENDING').length;
  const appPending = allApprovals.filter(x => x.status === 'PENDING').length;

  const expCntEl = document.getElementById('adminExpPendingCnt');
  const appCntEl = document.getElementById('adminAppPendingCnt');
  if (expCntEl) expCntEl.innerText = expPending;
  if (appCntEl) appCntEl.innerText = appPending;

  refreshAdminPaymentAuthUI();
  await updatePaymentPendingBadge();
}

/**
 * 결재 승인권자 권한 UI 갱신 (지정 3계정 전용 검증 & 비승인자 완전 차단)
 */
export function refreshAdminPaymentAuthUI() {
  const isApprover = (typeof window.isPaymentApprovalAdmin === 'function') ? window.isPaymentApprovalAdmin() : false;

  // 1. 관리자 결재 서브탭 버튼(#tabBtnAdmin): 승인권자가 아니면 화면에서 완전히 숨김
  const adminTabBtn = document.getElementById('tabBtnAdmin');
  if (adminTabBtn) {
    adminTabBtn.classList.toggle('hidden', !isApprover);
  }

  // 2. 비승인자가 현재 admin 섹션에 머물러 있는 경우 즉시 register로 강제 이탈
  const adminSection = document.getElementById('paymentSectionAdmin');
  if (!isApprover && adminSection && !adminSection.classList.contains('hidden')) {
    switchPaymentSubTab('register');
  }

  // 3. 상단 결재 권한 배지: 승인권자인 경우에만 심플하게 표시 (개인 이름 미노출)
  const badge = document.getElementById('adminApproverStatusBadge');
  if (badge) {
    if (isApprover) {
      badge.className = "text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300";
      badge.innerHTML = "🛡️ 관리자 결재 권한 확인됨";
    } else {
      badge.className = "hidden";
      badge.innerHTML = "";
    }
  }

  updatePaymentPendingBadge();

  if (isApprover) {
    if (allExpenses && allExpenses.length > 0) renderAdminExpenseTable();
    if (allApprovals && allApprovals.length > 0) renderAdminApprovalTable();
  }
}
window.refreshAdminPaymentAuthUI = refreshAdminPaymentAuthUI;

/**
 * 결재 승인/반려 권한 검증 헬퍼 (개인 이름 미노출)
 */
function checkApproverAuthority() {
  const isApprover = (typeof window.isPaymentApprovalAdmin === 'function') ? window.isPaymentApprovalAdmin() : false;

  if (!isApprover) {
    alert("결재 승인 및 반려 권한이 없습니다.");
    return false;
  }
  return true;
}

export function switchAdminPaymentMode(mode) {
  const isExp = mode === 'expense';
  document.getElementById('adminExpensePanel')?.classList.toggle('hidden', !isExp);
  document.getElementById('adminApprovalPanel')?.classList.toggle('hidden', isExp);

  const activeExp = "px-4 py-2 rounded-lg text-xs font-bold bg-blue-600 text-white shadow-sm transition flex items-center gap-1.5 cursor-pointer";
  const inactiveExp = "px-4 py-2 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100 transition flex items-center gap-1.5 cursor-pointer";
  const activeApp = "px-4 py-2 rounded-lg text-xs font-bold bg-indigo-600 text-white shadow-sm transition flex items-center gap-1.5 cursor-pointer";
  const inactiveApp = "px-4 py-2 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100 transition flex items-center gap-1.5 cursor-pointer";

  const btnExp = document.getElementById('adminModeExpenseBtn');
  const btnApp = document.getElementById('adminModeApprovalBtn');
  if (btnExp) btnExp.className = isExp ? activeExp : inactiveExp;
  if (btnApp) btnApp.className = !isExp ? activeApp : inactiveApp;
}

export async function loadAdminExpenseData() {
  try {
    const { data, error } = await paymentSupabase.from('expense_reports').select('*').order('payment_date', { ascending: false });
    if (error) throw error;
    allExpenses = data || [];

    const p = allExpenses.filter(x => x.status === 'PENDING');
    const a = allExpenses.filter(x => x.status === 'APPROVED');
    const r = allExpenses.filter(x => x.status === 'REJECTED');
    const sum = l => l.reduce((acc, c) => acc + Number(c.amount || 0), 0);

    const setEl = (id, text) => { const el = document.getElementById(id); if (el) el.innerText = text; };
    setEl('statPendingCount', `${p.length}건`);
    setEl('statPendingAmount', `₩${sum(p).toLocaleString()}`);
    setEl('statApprovedCount', `${a.length}건`);
    setEl('statApprovedAmount', `₩${sum(a).toLocaleString()}`);
    setEl('statRejectedCount', `${r.length}건`);
    setEl('statRejectedAmount', `₩${sum(r).toLocaleString()}`);
    setEl('statTotalCount', `${allExpenses.length}건`);
    setEl('statTotalAmount', `₩${sum(allExpenses).toLocaleString()}`);

    renderAdminExpenseTable();
  } catch (err) {
    console.error('[Admin Expense] 로드 실패:', err);
  }
}

export function renderAdminExpenseTable() {
  const tbody = document.getElementById('expenseTableBody');
  if (!tbody) return;
  const kw = (document.getElementById('adminSearchInput')?.value || '').toLowerCase();
  let list = currentExpenseFilter === 'ALL' ? allExpenses : allExpenses.filter(x => x.status === currentExpenseFilter);
  if (kw) {
    list = list.filter(x => (x.employee_name || '').toLowerCase().includes(kw) || (x.merchant_name || '').toLowerCase().includes(kw));
  }

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-10 text-slate-400">조건에 부합하는 경비 청구 내역이 없습니다.</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  list.forEach(item => {
    const tr = document.createElement('tr');
    tr.className = "hover:bg-slate-50/80 transition border-b border-slate-100";
    const docBadge = item.approval_doc_no
      ? `<button type="button" onclick="window.openPaymentDocModal(${item.approval_id}, 'admin')" class="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded text-[10px] font-mono underline border border-indigo-200 cursor-pointer">${item.approval_doc_no}</button>`
      : '<span class="text-slate-300">-</span>';

    const isApprover = (typeof window.isPaymentApprovalAdmin === 'function') ? window.isPaymentApprovalAdmin() : false;

    tr.innerHTML = `
      <td class="py-3 px-3 font-mono whitespace-nowrap">${item.payment_date}</td>
      <td class="py-3 px-3 font-bold text-slate-900 whitespace-nowrap">${item.employee_name}</td>
      <td class="py-3 px-3 whitespace-nowrap">${docBadge}</td>
      <td class="py-3 px-3 whitespace-nowrap max-w-[130px] truncate text-slate-800" title="${item.merchant_name}">${item.merchant_name || '-'}</td>
      <td class="py-3 px-3 font-mono text-slate-500 whitespace-nowrap">${item.approval_number}</td>
      <td class="py-3 px-3 font-bold text-slate-900 font-mono whitespace-nowrap">₩${Number(item.amount).toLocaleString()}</td>
      <td class="py-3 px-3 max-w-xs truncate whitespace-nowrap text-slate-600" title="${item.purpose}">${item.purpose}</td>
      <td class="py-3 px-3 text-center whitespace-nowrap">
        <button type="button" onclick="window.openPaymentReceiptModal('${item.receipt_url}')" class="text-blue-600 hover:text-blue-800 font-bold inline-flex items-center gap-1 cursor-pointer">
          <span>🔍</span> 영수증
        </button>
      </td>
      <td class="py-3 px-3 text-center whitespace-nowrap">${getStatusBadgeHtml(item.status, item.reject_reason)}</td>
      <td class="py-3 px-3 text-right space-x-1 whitespace-nowrap">
        ${item.status === 'PENDING' ? (
          isApprover ? `
            <button type="button" onclick="window.updateExpenseStatusAction(${item.id}, 'APPROVED')" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs shadow-xs cursor-pointer">승인</button>
            <button type="button" onclick="window.updateExpenseStatusAction(${item.id}, 'REJECTED')" class="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg text-xs shadow-xs cursor-pointer">반려</button>
          ` : `<span class="text-[11px] text-slate-400 font-semibold px-2 py-1 bg-slate-100 rounded border border-slate-200" title="결재 권한 없음">권한 제한</span>`
        ) : `<span class="text-slate-400 text-[11px] mr-1 font-semibold">결재완료</span>`}
        ${isApprover ? `
          <button type="button" onclick="window.deleteExpenseAction(${item.id}, '${item.receipt_url || ''}')" class="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-lg text-xs cursor-pointer">삭제</button>
        ` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

export async function updateExpenseStatus(id, newStatus) {
  if (!checkApproverAuthority()) return;

  let rejectReason = null;
  if (newStatus === 'REJECTED') {
    rejectReason = prompt('경비 반려 사유를 입력해 주세요:');
    if (rejectReason === null) return;
  } else if (!confirm('해당 경비 건을 [최종 승인] 처리하시겠습니까?')) {
    return;
  }

  const { error } = await paymentSupabase
    .from('expense_reports')
    .update({ status: newStatus, reject_reason: rejectReason })
    .eq('id', id);

  if (error) return alert('결재 처리 실패: ' + error.message);
  await loadAllAdminPaymentData();
}

export async function deleteExpense(id, receiptUrl) {
  if (!checkApproverAuthority()) return;
  if (!confirm('이 경비 내역과 등록된 영수증 증빙을 영구 삭제하시겠습니까?')) return;
  if (receiptUrl && receiptUrl.includes('/receipts/')) {
    const fileName = receiptUrl.split('/receipts/').pop();
    if (fileName) {
      try { await paymentSupabase.storage.from('receipts').remove([fileName]); } catch (e) {}
    }
  }
  const { error } = await paymentSupabase.from('expense_reports').delete().eq('id', id);
  if (error) return alert('삭제 실패: ' + error.message);
  await loadAllAdminPaymentData();
}

export function filterAdminExpenseStatus(status) {
  currentExpenseFilter = status;
  document.querySelectorAll('.status-tab').forEach(b => {
    b.className = b.dataset.status === status
      ? "status-tab px-3 py-1 rounded-lg text-xs font-bold bg-slate-900 text-white shadow-xs cursor-pointer"
      : "status-tab px-3 py-1 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 cursor-pointer";
  });
  renderAdminExpenseTable();
}

export async function loadAdminApprovalData() {
  try {
    const { data, error } = await paymentSupabase
      .from('approval_requests')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    allApprovals = data || [];
    renderAdminApprovalTable();
  } catch (err) {
    console.error('[Admin Approval] 로드 실패:', err);
  }
}

export function renderAdminApprovalTable() {
  const tbody = document.getElementById('adminApprovalTableBody');
  if (!tbody) return;
  const kw = (document.getElementById('adminAppSearchInput')?.value || '').toLowerCase();
  let list = currentApprovalFilter === 'ALL' ? allApprovals : allApprovals.filter(x => x.status === currentApprovalFilter);
  if (kw) {
    list = list.filter(x => (x.drafter_name || '').toLowerCase().includes(kw) || (x.title || '').toLowerCase().includes(kw) || (x.doc_no || '').toLowerCase().includes(kw));
  }

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-10 text-slate-400">결재할 품의 문서가 없습니다.</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  const isApprover = (typeof window.isPaymentApprovalAdmin === 'function') ? window.isPaymentApprovalAdmin() : false;

  list.forEach(doc => {
    const tr = document.createElement('tr');
    tr.className = "hover:bg-slate-50/80 transition border-b border-slate-100";
    const isPurchase = doc.doc_type === '구매품의서';

    tr.innerHTML = `
      <td class="py-3 px-3 font-mono font-bold text-indigo-700 whitespace-nowrap">${doc.doc_no}</td>
      <td class="py-3 px-3 whitespace-nowrap">
        <span class="px-2 py-0.5 rounded text-[11px] font-bold ${isPurchase ? 'bg-blue-100 text-blue-800 border border-blue-300' : 'bg-slate-100 text-slate-700'}">${doc.doc_type}</span>
      </td>
      <td class="py-3 px-3 font-bold text-slate-900 whitespace-nowrap">${doc.drafter_name}</td>
      <td class="py-3 px-3 max-w-xs truncate font-medium text-slate-800" title="${doc.title}">${doc.title}</td>
      <td class="py-3 px-3 font-mono font-bold whitespace-nowrap">₩${Number(doc.expected_amount || 0).toLocaleString()}</td>
      <td class="py-3 px-3 font-mono text-slate-500 whitespace-nowrap">${(doc.created_at || '').split('T')[0]}</td>
      <td class="py-3 px-3 text-center whitespace-nowrap">
        <button type="button" onclick="window.openPaymentDocModal(${doc.id}, 'admin')" class="text-indigo-600 hover:text-indigo-800 font-bold inline-flex items-center gap-1 cursor-pointer">
          <span>📄</span> 기안서 인쇄
        </button>
      </td>
      <td class="py-3 px-3 text-center whitespace-nowrap">${getStatusBadgeHtml(doc.status, doc.reject_reason)}</td>
      <td class="py-3 px-3 text-right space-x-1 whitespace-nowrap">
        ${doc.status === 'PENDING' ? (
          isApprover ? `
            <button type="button" onclick="window.updateApprovalStatusAction(${doc.id}, 'APPROVED')" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs shadow-xs cursor-pointer">승인</button>
            <button type="button" onclick="window.updateApprovalStatusAction(${doc.id}, 'REJECTED')" class="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg text-xs shadow-xs cursor-pointer">반려</button>
          ` : `<span class="text-[11px] text-slate-400 font-semibold px-2 py-1 bg-slate-100 rounded border border-slate-200" title="결재 권한 없음">권한 제한</span>`
        ) : `<span class="text-slate-400 text-[11px] mr-1 font-semibold">결재완료</span>`}
        ${isApprover ? `
          <button type="button" onclick="window.deleteApprovalDocAction(${doc.id})" class="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-lg text-xs cursor-pointer">삭제</button>
        ` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * ⚡ 핵심 연동: 품의서 승인/반려 및 [구매품의서 -> ERP 재고/PO 자동 브릿지]
 */
export async function updateApprovalStatus(id, newStatus) {
  if (!checkApproverAuthority()) return;

  let approvalComment = null;
  if (newStatus === 'REJECTED') {
    const inputReason = prompt('품의 반려 사유를 입력해 주세요 (필수):');
    if (inputReason === null) return;
    if (!inputReason.trim()) {
      alert('반려 사유를 입력해야 반려 처리가 가능합니다.');
      return;
    }
    approvalComment = `[반려사유] ${inputReason.trim()}`;
  } else if (newStatus === 'APPROVED') {
    const inputComment = prompt(
      '해당 품의서를 최종 [승인]하시겠습니까?\n\n결재권자 종합 검토 의견 및 지시사항을 입력해 주세요 (선택):\n(구매품의서인 경우 BSK ERP 재고 목록에 [배정요청/입고예정]으로 자동 연동 등록됩니다.)',
      '정상 검토 완료되어 승인합니다. 납기 및 품질 관리에 만전을 기해주시기 바랍니다.'
    );
    if (inputComment === null) return;
    approvalComment = inputComment.trim() ? `[승인의견] ${inputComment.trim()}` : '[승인의견] 정상 검토 승인 완료';
  }

  // 1. 상태 업데이트 in Project 2
  const { error } = await paymentSupabase
    .from('approval_requests')
    .update({ status: newStatus, reject_reason: approvalComment })
    .eq('id', id);

  if (error) return alert('품의 결재 실패: ' + error.message);

  // 2. 구매품의서 승인 시 ERP 재고관리(inventory_items) 자동 브릿지 실행!
  if (newStatus === 'APPROVED') {
    const doc = allApprovals.find(d => String(d.id) === String(id));
    if (doc && doc.doc_type === '구매품의서') {
      await bridgePurchaseRequisitionToInventory(doc);
    }
  }

  await loadAllAdminPaymentData();
}

/**
 * 구매품의서 데이터를 ERP inventory_items 테이블로 자동 삽입 (Backend API 우선, 클라이언트 직접 등록 fallback)
 */
async function bridgePurchaseRequisitionToInventory(doc) {
  try {
    let draftData = null;
    const draftMatch = doc.content?.match(/<!-- DRAFT_DATA:\s*({.*?})\s*-->/s);
    if (draftMatch && draftMatch[1]) {
      try { draftData = JSON.parse(draftMatch[1]); } catch (e) {}
    }

    let meta = {};
    const metaMatch = doc.content?.match(/<!-- ERP_META:\s*({.*?})\s*-->/s);
    if (metaMatch && metaMatch[1]) {
      try { meta = JSON.parse(metaMatch[1]); } catch (e) {}
    }

    const items = draftData?.items || meta.items || null;
    const vendor = draftData?.vendor || meta.vendor || '';
    const currency = draftData?.currency || meta.currency || 'USD';
    const customer = draftData?.customer || meta.customer || '본사 일반재고';
    const partName = meta.part_name || doc.title || '미지정 부품';
    const maker = meta.maker || '기타';
    const qty = parseInt(meta.qty || '0', 10) || 1;
    const unitPrice = parseFloat(meta.unit_price || 0);
    const today = new Date().toISOString().split('T')[0];
    const targetDate = doc.target_date || today;
    const currentEmail = (typeof window.getCurrentUserEmail === 'function') ? window.getCurrentUserEmail() : '';

    // 1. 서버 전용 백엔드 브릿지 API 호출 (RLS 권한 제약 없이 안전 실행)
    try {
      const resp = await fetch('/api/approvals/bridge-purchase-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc_no: doc.doc_no,
          part_name: partName,
          maker: maker,
          vendor: vendor,
          qty: qty,
          unit_price: unitPrice,
          currency: currency,
          customer: customer,
          drafter_name: doc.drafter_name,
          memo: meta.memo || '',
          target_date: targetDate,
          approver_email: currentEmail,
          items: items
        })
      });
      const data = await resp.json();
      if (data.status === 'success' || data.status === 'already_exists') {
        const countMsg = (items && items.length > 1) ? `총 ${items.length}개 품목이` : `품목 [${maker}] ${partName} (${qty.toLocaleString()} EA)이`;
        alert(`🎉 [구매품의서 ERP 자동 연동 완료]\n\n문서번호: ${doc.doc_no}\n${countMsg} BSK ERP 재고 관리 목록에 '배정요청(입고예정)' 상태로 등록되었습니다.`);
        if (typeof window.refreshInventory === 'function') {
          window.refreshInventory();
        }
        return;
      }
    } catch (apiErr) {
      console.warn('[Bridge] 백엔드 API 호출 실패, 클라이언트 직접 시도:', apiErr);
    }

    // 2. Fallback: 클라이언트 sbClient 직접 삽입 시도
    if (sbClient) {
      const unitUsd = (currency === 'USD')
        ? unitPrice
        : (unitPrice > 0 ? Number((unitPrice / 1350).toFixed(4)) : (doc.expected_amount && qty > 0 ? Number((doc.expected_amount / (qty * 1350)).toFixed(4)) : 0));

      const payload = {
        maker: maker,
        part_name: partName,
        date_code: '-',
        owner: doc.drafter_name || '본사 일반재고',
        customer: customer,
        real_customer: customer,
        po_no: doc.doc_no,
        application: '품의승인 발주 (PO)',
        biz_type: currency === 'USD' ? '외자' : '내자',
        entry_date: targetDate,
        stock: qty > 0 ? qty : 1,
        unit_usd: unitUsd,
        sold_price_usd: 0,
        ship_fx: 1350,
        margin: 20,
        order_status: '배정요청',
        payment_terms: 'Net 30',
        payment_status: '미수',
        currency: currency,
        memo: `[전자결재 승인 발주] 문서번호: ${doc.doc_no} / 승인자: ${currentEmail || '지정 결재권자'} / 기안자: ${doc.drafter_name} / 승인일: ${today}`
      };

      const { error: insErr } = await sbClient.from('inventory_items').insert([payload]);
      if (!insErr) {
        alert(`🎉 [구매품의서 ERP 자동 연동 완료]\n\n문서번호: ${doc.doc_no}\n품목: [${maker}] ${partName}\n수량: ${qty.toLocaleString()} EA\n\nBSK ERP 재고 관리 목록에 '배정요청(입고예정)' 상태로 등록되었습니다.`);
        if (typeof window.refreshInventory === 'function') {
          window.refreshInventory();
        }
      }
    }
  } catch (err) {
    console.error('[Bridge] 연동 처리 예외:', err);
  }
}

export async function deleteApprovalDoc(id) {
  if (!checkApproverAuthority()) return;
  if (!confirm('이 품의 문서를 영구 삭제하시겠습니까?')) return;
  const { error } = await paymentSupabase.from('approval_requests').delete().eq('id', id);
  if (error) return alert('삭제 실패: ' + error.message);
  await loadAllAdminPaymentData();
}

export function filterAdminApprovalStatus(status) {
  currentApprovalFilter = status;
  document.querySelectorAll('.app-status-tab').forEach(b => {
    b.className = b.dataset.status === status
      ? "app-status-tab px-3 py-1 rounded-lg text-xs font-bold bg-slate-900 text-white shadow-xs cursor-pointer"
      : "app-status-tab px-3 py-1 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 cursor-pointer";
  });
  renderAdminApprovalTable();
}

/**
 * 경비 정산 CSV 내보내기
 */
export function exportPaymentExpensesToCSV() {
  if (allExpenses.length === 0) {
    alert('다운로드할 경비 내역이 없습니다.');
    return;
  }
  const headers = ['신청ID', '연결품의번호', '사원명', '결제일자', '가맹점명', '승인번호', '금액(원)', '계정구분', '지출목적', '결재상태', '영수증URL'];
  const rows = allExpenses.map(i => [
    i.id,
    i.approval_doc_no || '',
    `"${i.employee_name || ''}"`,
    i.payment_date,
    `"${(i.merchant_name || '').replace(/"/g, '""')}"`,
    `'${i.approval_number}'`,
    i.amount,
    `"${i.category || ''}"`,
    `"${(i.purpose || '').replace(/"/g, '""')}"`,
    i.status === 'APPROVED' ? '승인완료' : (i.status === 'REJECTED' ? '반려됨' : '결재대기'),
    i.receipt_url || ''
  ]);
  const blob = new Blob(['\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `빅샤인코리아_경비정산내역_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
}

/**
 * 8. 모달 관리 (BSK 공식 A4 인쇄 / 기안서 미리보기, 영수증 원본)
 */
export function openApprovalDocModal(docId, source) {
  const pool = source === 'admin'
    ? (allApprovals && allApprovals.length ? allApprovals : (typeof window !== 'undefined' && window.allApprovals ? window.allApprovals : []))
    : (myApprovalDocsCache && myApprovalDocsCache.length ? myApprovalDocsCache : (typeof window !== 'undefined' && window.myApprovalDocsCache ? window.myApprovalDocsCache : []));
  const doc = pool.find(d => String(d.id) === String(docId));
  if (!doc) {
    alert('품의 문서를 찾을 수 없습니다.');
    return;
  }

  const docDate = (doc.created_at || '').split('T')[0] || new Date().toISOString().split('T')[0];
  const setT = (id, text) => { const el = document.getElementById(id); if (el) el.innerText = text; };

  // 1. 레터헤드 & 기본 문서 메타데이터
  setT('docViewType', `【 ${doc.doc_type || '품 의 서'} 】`);
  setT('docViewNo', doc.doc_no || '-');
  setT('docViewDate', docDate);
  setT('docViewDept', doc.department || '영업/기술지원팀');
  setT('docViewTargetDate', doc.target_date || '-');
  setT('docViewCategory', doc.category || '부품 매입/재고비');
  setT('docViewDrafterNameFull', doc.drafter_name || '-');
  setT('docViewTitle', doc.title || '-');

  // 3단 결재선 렌더링
  setT('docViewDrafterSign', doc.drafter_name || '-');
  setT('docViewDrafterDate', docDate);
  setT('docViewReviewSign', '영업지원팀');
  setT('docViewReviewDate', docDate);

  // 승인권자 전자 직인 날인 칸 (docViewAdminStamp)
  const adminStampEl = document.getElementById('docViewAdminStamp');
  if (adminStampEl) {
    if (doc.status === 'APPROVED') {
      adminStampEl.innerHTML = `
        <div class="relative inline-flex flex-col items-center justify-center w-14 h-14 rounded-full border-2 border-red-600 text-red-600 font-black text-center p-0.5 select-none mx-auto shadow-xs transform -rotate-3" style="border-style: double; border-width: 3px;">
          <div class="text-[7.5px] leading-none tracking-tighter">(주)빅샤인</div>
          <div class="text-[9.5px] leading-tight font-extrabold">대표이사</div>
          <div class="text-[11px] leading-none font-black tracking-wider">이동일</div>
          <div class="text-[7px] leading-none tracking-widest text-red-500 mt-0.5 font-bold">[ 印 ]</div>
        </div>
        <div class="text-[9px] text-red-600 font-mono font-bold mt-0.5">${docDate}</div>
      `;
    } else if (doc.status === 'REJECTED') {
      adminStampEl.innerHTML = `
        <div class="inline-flex flex-col items-center justify-center px-2.5 py-1.5 rounded-lg border-2 border-rose-600 text-rose-600 font-black text-xs mx-auto">
          <span>반 려</span>
          <span class="text-[9px] font-mono mt-0.5">${docDate}</span>
        </div>
      `;
    } else {
      adminStampEl.innerHTML = `
        <div class="inline-flex flex-col items-center justify-center px-2 py-1.5 rounded-lg border border-dashed border-amber-400 bg-amber-50 text-amber-700 font-bold text-xs mx-auto">
          <span>결재 대기</span>
        </div>
      `;
    }
  }

  // 2. 한글 금액 표기 및 환율 정보
  const expAmount = Number(doc.expected_amount || 0);
  const koreanAmt = numberToKoreanCurrency(expAmount);
  const amountKoreanEl = document.getElementById('docViewAmountKorean');
  const amountRawEl = document.getElementById('docViewAmountRaw');

  // 메타데이터 추출
  let draftData = null;
  const draftMatch = doc.content?.match(/<!-- DRAFT_DATA:\s*({.*?})\s*-->/s);
  if (draftMatch && draftMatch[1]) {
    try { draftData = JSON.parse(draftMatch[1]); } catch (e) {}
  }

  if (amountKoreanEl) amountKoreanEl.innerText = koreanAmt;
  if (amountRawEl) {
    if (draftData && draftData.currency === 'USD' && draftData.totalAmount) {
      amountRawEl.innerText = `(₩${expAmount.toLocaleString()} / $${Number(draftData.totalAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD)`;
    } else {
      amountRawEl.innerText = `(₩${expAmount.toLocaleString()})`;
    }
  }

  // 3. 본문 4단 구성 렌더링
  const purposeEl = document.getElementById('docViewPurpose');
  const itemsContainer = document.getElementById('docViewItemsContainer');
  const budgetPlanEl = document.getElementById('docViewBudgetPlan');
  const expectedEffectEl = document.getElementById('docViewExpectedEffect');

  if (draftData) {
    if (purposeEl) purposeEl.innerText = draftData.purpose || '-';
    if (budgetPlanEl) budgetPlanEl.innerText = draftData.budgetPlan || '-';
    if (expectedEffectEl) expectedEffectEl.innerText = draftData.expectedEffect || '-';

    // 세부 품의 명세 그리드 표 렌더링
    if (itemsContainer) {
      if (draftData.docType === '구매품의서' && draftData.items && draftData.items.length > 0) {
        const rowsHtml = draftData.items.map((i, idx) => `
          <tr class="border-b border-slate-200 hover:bg-slate-50/50">
            <td class="p-2 border-r border-slate-200 text-center font-mono">${idx + 1}</td>
            <td class="p-2 border-r border-slate-200 font-mono font-bold text-indigo-950">${escapeHtml(i.part_no)}</td>
            <td class="p-2 border-r border-slate-200 text-slate-800">${escapeHtml(i.maker || '-')}</td>
            <td class="p-2 border-r border-slate-200 text-right font-mono font-bold text-slate-900">${Number(i.qty || 0).toLocaleString()} EA</td>
            <td class="p-2 border-r border-slate-200 text-right font-mono">${draftData.currency === 'USD' ? '$' : '₩'}${Number(i.unit_price || 0).toLocaleString(undefined, { minimumFractionDigits: draftData.currency === 'USD' ? 2 : 0 })}</td>
            <td class="p-2 border-r border-slate-200 text-right font-mono font-bold text-indigo-900">${draftData.currency === 'USD' ? '$' : '₩'}${Number(i.line_total || 0).toLocaleString(undefined, { minimumFractionDigits: draftData.currency === 'USD' ? 2 : 0 })}</td>
            <td class="p-2 text-slate-600 text-[11px]">${escapeHtml(i.memo || '-')}</td>
          </tr>
        `).join('');

        itemsContainer.innerHTML = `
          <div class="bg-indigo-50/40 p-2 border-b border-slate-300 text-[11px] flex flex-wrap gap-x-4 gap-y-1 text-slate-700 font-medium">
            <span><strong>공급처(Vendor):</strong> ${escapeHtml(draftData.vendor || '미정')}</span>
            <span><strong>실수요처(Customer):</strong> ${escapeHtml(draftData.customer || '본사 일반재고')}</span>
            <span><strong>기준 통화:</strong> ${draftData.currency || 'USD'} (적용환율: ₩${Number(draftData.fxRate || 1334.18).toLocaleString()})</span>
          </div>
          <table class="w-full text-xs text-left border-collapse">
            <thead class="bg-slate-100 text-slate-800 font-bold border-b border-slate-300">
              <tr>
                <th class="p-2 border-r border-slate-300 text-center w-8">No</th>
                <th class="p-2 border-r border-slate-300">부품 품번 (Part#)</th>
                <th class="p-2 border-r border-slate-300 w-24">제조사</th>
                <th class="p-2 border-r border-slate-300 text-right w-24">발주수량</th>
                <th class="p-2 border-r border-slate-300 text-right w-24">매입단가</th>
                <th class="p-2 border-r border-slate-300 text-right w-28">공급가액</th>
                <th class="p-2 min-w-[120px]">비고 / 견적특기</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
            <tfoot class="bg-slate-50 border-t border-slate-300 font-bold text-slate-900">
              <tr>
                <td colspan="3" class="p-2 text-right border-r border-slate-300">합계 (Total):</td>
                <td class="p-2 text-right border-r border-slate-300 font-mono text-indigo-950">${Number(draftData.totalQty || 0).toLocaleString()} EA</td>
                <td class="p-2 border-r border-slate-300"></td>
                <td class="p-2 text-right border-r border-slate-300 font-mono text-indigo-950">${draftData.currency === 'USD' ? '$' : '₩'}${Number(draftData.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td class="p-2 text-[11px] text-slate-600 font-mono">원화 합계: ₩${Number(draftData.krwTotal || expAmount).toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        `;
      } else if (draftData.docType === '지출품의서' && draftData.items && draftData.items.length > 0) {
        const rowsHtml = draftData.items.map((i, idx) => `
          <tr class="border-b border-slate-200 hover:bg-slate-50/50">
            <td class="p-2 border-r border-slate-200 text-center font-mono">${idx + 1}</td>
            <td class="p-2 border-r border-slate-200 font-medium text-slate-900">${escapeHtml(i.item)}</td>
            <td class="p-2 border-r border-slate-200 text-right font-mono font-bold text-indigo-900">₩${Number(i.amount || 0).toLocaleString()}</td>
            <td class="p-2 text-slate-600">${escapeHtml(i.note || '-')}</td>
          </tr>
        `).join('');

        itemsContainer.innerHTML = `
          <table class="w-full text-xs text-left border-collapse">
            <thead class="bg-slate-100 text-slate-800 font-bold border-b border-slate-300">
              <tr>
                <th class="p-2 border-r border-slate-300 text-center w-8">No</th>
                <th class="p-2 border-r border-slate-300 min-w-[180px]">지출 적요 / 항목명</th>
                <th class="p-2 border-r border-slate-300 text-right w-36">지출 금액 (원화 ₩)</th>
                <th class="p-2 min-w-[200px]">산출 근거 및 사용 내역</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
            <tfoot class="bg-slate-50 border-t border-slate-300 font-bold text-slate-900">
              <tr>
                <td colspan="2" class="p-2 text-right border-r border-slate-300">지출 합계 (VAT 포함):</td>
                <td class="p-2 text-right border-r border-slate-300 font-mono text-indigo-950">₩${Number(draftData.totalAmount || expAmount).toLocaleString()}</td>
                <td class="p-2 text-[11px] text-slate-500">정산 영수증 첨부 기준</td>
              </tr>
            </tfoot>
          </table>
        `;
      } else if (draftData.travel) {
        itemsContainer.innerHTML = `
          <div class="p-3 bg-slate-50 space-y-1 text-xs">
            <div><strong>출장 목적지:</strong> ${escapeHtml(draftData.travel.dest || '-')}</div>
            <div><strong>출장 기간:</strong> ${escapeHtml(draftData.travel.sDate || '-')} ~ ${escapeHtml(draftData.travel.eDate || '-')}</div>
            <div class="pt-1 whitespace-pre-wrap"><strong>일정 및 업무 목표:</strong>\n${escapeHtml(draftData.travel.sched || '-')}</div>
          </div>
        `;
      } else {
        const cleanContent = (doc.content || '').replace(/<!-- DRAFT_DATA:.*?-->/s, '').replace(/<!-- ERP_META:.*?-->/s, '').trim();
        itemsContainer.innerHTML = `<div class="p-3 text-xs leading-relaxed whitespace-pre-wrap bg-slate-50">${escapeHtml(cleanContent)}</div>`;
      }
    }
  } else {
    // 하위 호환: 기존 형식의 일반 텍스트 문서
    const cleanContent = (doc.content || '').replace(/<!-- ERP_META:.*?-->/s, '').trim();
    if (purposeEl) purposeEl.innerText = cleanContent || '(상세 내용 없음)';
    if (itemsContainer) itemsContainer.innerHTML = `<div class="p-3 text-xs text-slate-600 bg-slate-50">상기 기안 목적 내용에 통합 기술되어 있습니다.</div>`;
    if (budgetPlanEl) budgetPlanEl.innerText = `예상 금액: ₩${expAmount.toLocaleString()} (${koreanAmt})`;
    if (expectedEffectEl) expectedEffectEl.innerText = '품의 목적 달성 및 업무 정상 수행';
  }

  // 4. 결재권자 종합 검토 의견 및 지시사항 렌더링
  const execReviewEl = document.getElementById('docViewExecutiveReview');
  if (execReviewEl) {
    if (doc.status === 'APPROVED') {
      const comment = (doc.reject_reason || '').replace('[승인의견]', '').trim() || '정상 검토 완료되어 최종 승인합니다. 관련 규정에 의거하여 후속 업무를 진행해 주시기 바랍니다.';
      execReviewEl.innerHTML = `
        <div class="flex items-start gap-3 bg-emerald-50/70 border border-emerald-200 rounded-lg p-3.5 text-emerald-950">
          <span class="text-lg">✅</span>
          <div class="space-y-1">
            <div class="font-bold flex items-center gap-2 text-xs text-emerald-900">
              <span class="px-1.5 py-0.5 bg-emerald-200 text-emerald-950 rounded text-[10px] font-black">최종 승인 완료</span>
              <span class="text-[11px] font-normal text-emerald-800">결재권자: 대표이사 이동일 (D.I.Lee) | 승인일: ${docDate}</span>
            </div>
            <p class="text-xs text-emerald-950 whitespace-pre-wrap font-medium leading-relaxed">${escapeHtml(comment)}</p>
          </div>
        </div>
      `;
    } else if (doc.status === 'REJECTED') {
      const reason = (doc.reject_reason || '반려 사유가 입력되지 않았습니다.').replace('[반려사유]', '').trim();
      execReviewEl.innerHTML = `
        <div class="flex items-start gap-3 bg-rose-50 border border-rose-200 rounded-lg p-3.5 text-rose-950">
          <span class="text-lg">⚠️</span>
          <div class="space-y-1">
            <div class="font-bold flex items-center gap-2 text-xs text-rose-800">
              <span class="px-1.5 py-0.5 bg-rose-200 text-rose-950 rounded text-[10px] font-black">품의 반려 안내</span>
              <span class="text-[11px] font-normal text-rose-700">결재권자: 대표이사 이동일 (D.I.Lee) | 반려일: ${docDate}</span>
            </div>
            <p class="text-xs text-rose-950 whitespace-pre-wrap font-semibold leading-relaxed">${escapeHtml(reason)}</p>
          </div>
        </div>
      `;
    } else {
      execReviewEl.innerHTML = `
        <div class="flex items-center gap-2.5 bg-amber-50/70 border border-amber-200 rounded-lg p-3 text-amber-900 text-xs">
          <span class="text-base">⏳</span>
          <span class="font-medium">현재 대표이사 및 결재권자 종합 검토 진행 중입니다. (결재 대기)</span>
        </div>
      `;
    }
  }

  // 5. 첨부파일 박스
  const aBox = document.getElementById('docViewAttachBox');
  const aLink = document.getElementById('docViewAttachLink');
  if (aBox && aLink) {
    if (doc.attachment_url) {
      aBox.classList.remove('hidden');
      aLink.href = doc.attachment_url;
    } else {
      aBox.classList.add('hidden');
    }
  }

  document.getElementById('approvalDocModal')?.classList.remove('hidden');
}

export function openReceiptModalByUrl(url) {
  if (!url) {
    alert('등록된 영수증 이미지가 없습니다.');
    return;
  }
  const img = document.getElementById('receiptModalImg');
  const link = document.getElementById('receiptDownloadLink');
  if (img) img.src = url;
  if (link) link.href = url;
  document.getElementById('receiptModal')?.classList.remove('hidden');
}

export function closePaymentModal(modalId) {
  document.getElementById(modalId)?.classList.add('hidden');
}

// 윈도우 전역 바인딩 (인라인 HTML onclick 지원)
if (typeof window !== 'undefined') {
  window.escapeHtml = escapeHtml;
  window.numberToKoreanCurrency = numberToKoreanCurrency;
  window.updateKoreanCurrencyPreview = updateKoreanCurrencyPreview;
  window.addPurchaseItemRow = addPurchaseItemRow;
  window.duplicatePurchaseItemRow = duplicatePurchaseItemRow;
  window.removePurchaseItemRow = removePurchaseItemRow;
  window.updatePurchaseTableTotals = updatePurchaseTableTotals;
  window.handlePartNoAutocomplete = handlePartNoAutocomplete;
  window.selectPartAutocomplete = selectPartAutocomplete;
  window.openPartPickerModal = openPartPickerModal;
  window.closePartPickerModal = closePartPickerModal;
  window.filterPartPickerItems = filterPartPickerItems;
  window.refreshPartPickerList = refreshPartPickerList;
  window.togglePartPickerRow = togglePartPickerRow;
  window.handlePartPickerCheckbox = handlePartPickerCheckbox;
  window.togglePartPickerSelectAll = togglePartPickerSelectAll;
  window.addSinglePartToPurchase = addSinglePartToPurchase;
  window.confirmPartPickerSelection = confirmPartPickerSelection;
  window.openPurchaseRequisitionForParts = openPurchaseRequisitionForParts;
  window.addExpenseItemRow = addExpenseItemRow;
  window.removeExpenseItemRow = removeExpenseItemRow;
  window.updateExpenseTableTotals = updateExpenseTableTotals;

  window.switchPaymentSubTab = switchPaymentSubTab;
  window.verifyPaymentAdminPin = verifyPaymentAdminPin;
  window.handleReceiptFileSelect = handleReceiptFileSelect;
  window.clearReceiptFile = clearReceiptFile;
  window.runReceiptOCR = runReceiptOCR;
  window.loadApprovedApprovalsForSelect = loadApprovedApprovalsForSelect;
  window.applyLinkedApproval = applyLinkedApproval;
  window.clearLinkedApproval = clearLinkedApproval;
  window.submitExpense = submitExpense;
  window.toggleApprovalAmountField = toggleApprovalAmountField;
  window.buildApprovalContent = buildApprovalContent;
  window.openPurchaseRequisitionForPart = openPurchaseRequisitionForPart;
  window.submitApproval = submitApproval;
  window.switchMySubTab = switchMySubTab;
  window.loadMyAllDocs = loadMyAllDocs;
  window.switchAdminPaymentMode = switchAdminPaymentMode;
  window.updateExpenseStatusAction = updateExpenseStatus;
  window.deleteExpenseAction = deleteExpense;
  window.filterAdminExpenseStatus = filterAdminExpenseStatus;
  window.updateApprovalStatusAction = updateApprovalStatus;
  window.deleteApprovalDocAction = deleteApprovalDoc;
  window.filterAdminApprovalStatus = filterAdminApprovalStatus;
  window.exportPaymentExpensesToCSV = exportPaymentExpensesToCSV;
  window.openPaymentDocModal = openApprovalDocModal;
  window.openPaymentReceiptModal = openReceiptModalByUrl;
  window.closePaymentModal = closePaymentModal;
  window.initPaymentModule = initPaymentModule;
  window.loadAllAdminPaymentData = loadAllAdminPaymentData;
}
