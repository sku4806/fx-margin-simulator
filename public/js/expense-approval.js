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
}

/**
 * 품의서 본문 생성 (ERP 연동용 JSON 메타데이터 포함)
 */
export function buildApprovalContent(docType) {
  let sectionTitle = '내역 상세';
  let sectionContent = '';
  let metaPayload = null;

  if (docType === '지출품의서') {
    sectionTitle = '지출 산출 내역';
    sectionContent = document.getElementById('appExpenseBreakdown')?.value.trim() || '';
  } else if (docType === '구매품의서') {
    sectionTitle = '구매 및 발주 상세 정보 (ERP 연동)';
    const vendor = document.getElementById('appPurchaseVendor')?.value.trim() || '미정';
    const maker = document.getElementById('appPurchaseMaker')?.value.trim() || '기타';
    const partNo = document.getElementById('appPurchasePartNo')?.value.trim() || '';
    const qty = parseInt(document.getElementById('appPurchaseQty')?.value || '0', 10);
    const unitPrice = parseFloat(document.getElementById('appPurchaseUnitPrice')?.value || '0');
    const currency = document.getElementById('appPurchaseCurrency')?.value || 'USD';
    const customer = document.getElementById('appPurchaseCustomer')?.value.trim() || '본사 일반재고';
    const memo = document.getElementById('appPurchaseItems')?.value.trim() || '';

    sectionContent = [
      `• 공급업체(Vendor): ${vendor}`,
      `• 제조사(Maker): ${maker}`,
      `• 부품명(Part#): ${partNo || '(제목 참조)'}`,
      `• 발주수량(Qty): ${qty.toLocaleString()} EA`,
      `• 발주단가(Unit Price): ${currency === 'USD' ? '$' : '₩'}${unitPrice.toLocaleString()} (${currency})`,
      `• 실수요처/배정(Customer): ${customer}`,
      `• 구매 사유 및 세부사항: ${memo}`
    ].join('\n');

    metaPayload = {
      vendor,
      maker,
      part_name: partNo,
      qty,
      unit_price: unitPrice,
      currency,
      customer,
      memo
    };
  } else if (docType === '출장기안서') {
    sectionTitle = '출장 일정 및 목적';
    const dest = document.getElementById('appTravelDestination')?.value.trim() || '';
    const sDate = document.getElementById('appTravelStartDate')?.value || '';
    const eDate = document.getElementById('appTravelEndDate')?.value || '';
    const sched = document.getElementById('appTravelSchedule')?.value.trim() || '';
    sectionContent = [
      `• 목적지: ${dest}`,
      `• 기간: ${sDate} ~ ${eDate}`,
      `• 방문 일정 및 업무 목표: \n${sched}`
    ].join('\n');
  } else if (docType === '일반업무기안') {
    sectionTitle = '기대 효과 및 완료 기준';
    sectionContent = document.getElementById('appGeneralOutcome')?.value.trim() || '';
  }

  const background = document.getElementById('appContent')?.value.trim() || '';
  let fullText = `[${sectionTitle}]\n${sectionContent}\n\n[기안 배경 및 추가 설명]\n${background}`;
  if (metaPayload) {
    fullText += `\n\n<!-- ERP_META: ${JSON.stringify(metaPayload)} -->`;
  }
  return fullText;
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
      btn.innerHTML = '<span>📤</span> 결재 품의서 상신하기';
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

  let rejectReason = null;
  if (newStatus === 'REJECTED') {
    rejectReason = prompt('품의 반려 사유를 입력해 주세요:');
    if (rejectReason === null) return;
  } else if (!confirm('해당 품의서를 최종 [승인] 처리하시겠습니까?\n(구매품의서인 경우 BSK ERP 재고 목록에 [배정요청/입고예정]으로 자동 연동 등록됩니다.)')) {
    return;
  }

  // 1. 상태 업데이트 in Project 2
  const { error } = await paymentSupabase
    .from('approval_requests')
    .update({ status: newStatus, reject_reason: rejectReason })
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
    // 메타데이터 추출
    let meta = {};
    const metaMatch = doc.content?.match(/<!-- ERP_META:\s*({.*?})\s*-->/s);
    if (metaMatch && metaMatch[1]) {
      try { meta = JSON.parse(metaMatch[1]); } catch (e) {}
    }

    const partName = meta.part_name || doc.title || '미지정 부품';
    const maker = meta.maker || '기타';
    const vendor = meta.vendor || '';
    const qty = parseInt(meta.qty || '0', 10) || 1;
    const unitPrice = parseFloat(meta.unit_price || 0);
    const currency = meta.currency || 'USD';
    const customer = meta.customer || '본사 일반재고';
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
          approver_email: currentEmail
        })
      });
      const data = await resp.json();
      if (data.status === 'success' || data.status === 'already_exists') {
        alert(`🎉 [구매품의서 ERP 자동 연동 완료]\n\n문서번호: ${doc.doc_no}\n품목: [${maker}] ${partName}\n수량: ${qty.toLocaleString()} EA\n\nBSK ERP 재고 관리 목록에 '배정요청(입고예정)' 상태로 등록되었습니다.`);
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
 * 8. 모달 관리 (기안서 인쇄/보기, 영수증 원본)
 */
export function openApprovalDocModal(docId, source) {
  const pool = source === 'admin' ? allApprovals : myApprovalDocsCache;
  const doc = pool.find(d => String(d.id) === String(docId));
  if (!doc) {
    alert('품의 문서를 찾을 수 없습니다.');
    return;
  }

  const setT = (id, text) => { const el = document.getElementById(id); if (el) el.innerText = text; };
  setT('docViewType', doc.doc_type);
  setT('docViewDrafterSign', doc.drafter_name);
  setT('docViewNo', doc.doc_no);
  setT('docViewDate', (doc.created_at || '').split('T')[0]);
  setT('docViewDept', doc.department || '-');
  setT('docViewTargetDate', doc.target_date || '-');
  setT('docViewCategory', doc.category || '-');
  setT('docViewAmount', `₩${Number(doc.expected_amount || 0).toLocaleString()}`);
  setT('docViewTitle', doc.title);

  // 본문에서 ERP_META 주석 숨기고 깔끔하게 표시
  const cleanContent = (doc.content || '').replace(/<!-- ERP_META:.*?-->/s, '').trim();
  setT('docViewContent', cleanContent);

  const signEl = document.getElementById('docViewAdminSign');
  if (signEl) {
    signEl.innerText = doc.status === 'APPROVED' ? '승인완료' : (doc.status === 'REJECTED' ? '반려됨' : '결재대기');
    signEl.className = doc.status === 'APPROVED'
      ? 'border border-slate-400 px-3 font-bold text-emerald-600'
      : (doc.status === 'REJECTED' ? 'border border-slate-400 px-3 font-bold text-rose-600' : 'border border-slate-400 px-3 font-bold text-amber-600');
  }

  const rBox = document.getElementById('docViewRejectBox');
  if (rBox) {
    if (doc.status === 'REJECTED' && doc.reject_reason) {
      rBox.classList.remove('hidden');
      setT('docViewRejectReason', doc.reject_reason);
    } else {
      rBox.classList.add('hidden');
    }
  }

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
