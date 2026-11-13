import { getCurrentSession, loginWithEmail, logout, updatePassword, subscribeAuthChange } from '../supabase.js';

// 🏢 BigShine 사내 계정별 공식 마스터 프로필 (이메일, 성명, 직급, 직책표기)
export const USER_PROFILES = {
  'nathan@bigshine.co.kr': { name: '김남천', position: '주임', fullTitle: '김남천 주임', isDevAdmin: true },
  'timothy@bigshine.co.kr': { name: '박대원', position: '전무', fullTitle: '박대원 전무' },
  'allenpark@bigshine.co.kr': { name: '박재범', position: '부장', fullTitle: '박재범 부장' },
  'tony@bigshine.co.kr': { name: '이동일', position: '부사장', fullTitle: '이동일 부사장' },
  'jane@bigshine.co.kr': { name: '문숙정', position: '과장', fullTitle: '문숙정 과장' },
  'jamie@bigshine.co.kr': { name: '천소훈', position: '차장', fullTitle: '천소훈 차장' },
  'lily@bigshine.co.kr': { name: '고유진', position: '사원', fullTitle: '고유진 사원' },
  'raina@bigshine.co.kr': { name: '손유경', position: '과장', fullTitle: '손유경 과장' },
  'susan@bigshine.co.kr': { name: '최연아', position: '부장', fullTitle: '최연아 부장' },
  'trisha@bigshine.co.kr': { name: '진혜영', position: '과장', fullTitle: '진혜영 과장' },
  'william@bigshine.co.kr': { name: '고기봉', position: '부장', fullTitle: '고기봉 부장' },
  'joey@bigshine.co.kr': { name: '조지윤', position: '과장', fullTitle: '조지윤 과장' },
  'steve@bigshine.co.kr': { name: '황환', position: '이사', fullTitle: '황환 이사' },
  'kelly@bigshine.co.kr': { name: '김경래', position: '차장', fullTitle: '김경래 차장' },
  'eric@bigshine.co.kr': { name: '이재상', position: '부장', fullTitle: '이재상 부장' },
  'logan@bigshine.co.kr': { name: '이민수', position: '대리', fullTitle: '이민수 대리' },
  'paul@bigshine.co.kr': { name: '김현진', position: '과장', fullTitle: '김현진 과장' },
  'dustin@bigshine.co.kr': { name: '김명호', position: '이사', fullTitle: '김명호 이사' }
};

// 사내 계정 이메일 -> 직급 포함 사원명 (하위 호환 매핑 맵)
export const EMAIL_TO_EMP_NAME = Object.fromEntries(
  Object.entries(USER_PROFILES).map(([email, p]) => [email, p.fullTitle])
);

export function getUserProfile(email) {
  if (!email) return null;
  const key = email.toLowerCase().trim();
  if (USER_PROFILES[key]) return USER_PROFILES[key];
  const prefix = key.split('@')[0];
  return { name: prefix, position: '', fullTitle: prefix };
}

export function getCurrentUserProfile() {
  const session = currentSession || window.__testSession;
  if (!session?.user?.email) return null;
  return getUserProfile(session.user.email);
}

export const ADMIN_EMAILS = [
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

// 📑 전자결재·품의 관리자 결재 승인/반려 권한 계정 (3계정 전용)
export const APPROVAL_ADMIN_EMAILS = [
  'timothy@bigshine.co.kr',
  'tony@bigshine.co.kr',
  'nathan@bigshine.co.kr'
];

let currentSession = null;

export function getSession() {
  return currentSession || window.__testSession || null;
}

export function isCsOrAdminUser() {
  const session = currentSession || window.__testSession;
  if (!session || !session.user || !session.user.email) return false;
  return ADMIN_EMAILS.includes(session.user.email.toLowerCase().trim());
}

export function isPaymentApprovalAdmin() {
  const session = currentSession || window.__testSession;
  if (!session || !session.user || !session.user.email) return false;
  return APPROVAL_ADMIN_EMAILS.includes(session.user.email.toLowerCase().trim());
}

export function getCurrentUserEmail() {
  const session = currentSession || window.__testSession;
  return session?.user?.email ? session.user.email.toLowerCase().trim() : null;
}

window.USER_PROFILES = USER_PROFILES;
window.EMAIL_TO_EMP_NAME = EMAIL_TO_EMP_NAME;
window.getUserProfile = getUserProfile;
window.getCurrentUserProfile = getCurrentUserProfile;
window.ADMIN_EMAILS = ADMIN_EMAILS;
window.isCsOrAdminUser = isCsOrAdminUser;
window.APPROVAL_ADMIN_EMAILS = APPROVAL_ADMIN_EMAILS;
window.isPaymentApprovalAdmin = isPaymentApprovalAdmin;
window.getCurrentUserEmail = getCurrentUserEmail;

export function initAuth(onAuthStateChange) {
  bindAuthModals();

  getCurrentSession().then(session => {
    currentSession = session;
    updateAuthHeaderUI();
    onAuthStateChange(currentSession, isCsOrAdminUser());
  });

  subscribeAuthChange((_event, session) => {
    currentSession = session;
    updateAuthHeaderUI();
    onAuthStateChange(currentSession, isCsOrAdminUser());
  });

  const authBtn = document.getElementById('authActionBtn');
  authBtn?.addEventListener('click', () => {
    if (currentSession) {
      if (confirm("로그아웃하시겠습니까?")) logout();
    } else {
      document.getElementById('loginModal')?.classList.remove('hidden');
    }
  });

  window.handlePaymentAuthAction = () => {
    if (currentSession && currentSession.user) {
      if (confirm("로그아웃하시겠습니까?")) logout();
    } else {
      document.getElementById('loginModal')?.classList.remove('hidden');
    }
  };

  window.openChangePasswordModal = () => {
    const emailEl = document.getElementById('changePwdUserEmail');
    if (emailEl && currentSession) emailEl.innerText = `계정: ${currentSession.user.email}`;
    document.getElementById('changePasswordModal')?.classList.remove('hidden');
  };
}

export function updateAuthHeaderUI() {
  const session = currentSession || window.__testSession;
  const isAuth = !!(session && session.user);
  document.getElementById('lockedOverlay')?.classList.toggle('hidden', isAuth);
  document.getElementById('unlockedContent')?.classList.toggle('hidden', !isAuth);
  document.getElementById('changePwdBtn')?.classList.toggle('hidden', !isAuth);

  const badge = document.getElementById('lockStatusBadge');
  const btn = document.getElementById('authActionBtn');

  // Tab 7 전자결재 상단 로그인/로그아웃 및 사용자 배지
  const payBadge = document.getElementById('paymentUserBadge');
  const payEmail = document.getElementById('paymentUserEmail');
  const payBtn = document.getElementById('paymentAuthBtn');
  const payBtnText = document.getElementById('paymentAuthBtnText');
  const payBtnIcon = document.getElementById('paymentAuthBtnIcon');

  if (isAuth) {
    const userEmail = session.user.email || '';
    const profile = getUserProfile(userEmail);
    const displayName = profile ? profile.fullTitle : userEmail;

    if (badge) {
      badge.className = "text-[9px] sm:text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-900 border border-indigo-200 inline-block";
      badge.innerHTML = `🔓 ${displayName}`;
      badge.title = `${displayName} (${userEmail})`;
    }
    if (btn) {
      btn.className = "text-[11px] sm:text-xs bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold px-2.5 py-1.5 rounded-lg transition-colors";
      btn.innerHTML = "🚪 로그아웃";
    }

    if (payBadge) {
      payBadge.classList.remove('hidden');
      if (payEmail) payEmail.textContent = `${displayName} (${userEmail})`;
    }
    if (payBtn) {
      payBtn.className = "inline-flex items-center gap-1 px-2.5 sm:px-3 py-1 text-[11px] sm:text-xs font-semibold rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 transition-colors cursor-pointer";
    }
    if (payBtnIcon) payBtnIcon.textContent = "🚪";
    if (payBtnText) payBtnText.textContent = "로그아웃";
  } else {
    if (badge) {
      badge.className = "text-[9px] sm:text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full inline-block";
      badge.innerHTML = "🔒 로그인 필요";
    }
    if (btn) {
      btn.className = "text-[11px] sm:text-xs bg-slate-800 hover:bg-slate-900 text-white font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1 shadow-sm";
      btn.innerHTML = "🔑 로그인";
    }

    if (payBadge) {
      payBadge.classList.add('hidden');
      if (payEmail) payEmail.textContent = '-';
    }
    if (payBtn) {
      payBtn.className = "inline-flex items-center gap-1 px-2.5 sm:px-3 py-1 text-[11px] sm:text-xs font-bold rounded-lg bg-slate-900 hover:bg-slate-800 text-white shadow-xs transition-colors cursor-pointer";
    }
    if (payBtnIcon) payBtnIcon.textContent = "🔑";
    if (payBtnText) payBtnText.textContent = "로그인";
  }
}

window.updateAuthHeaderUI = updateAuthHeaderUI;

function bindAuthModals() {
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
}
