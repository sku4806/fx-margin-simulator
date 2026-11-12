import { getCurrentSession, loginWithEmail, logout, updatePassword, subscribeAuthChange } from '../supabase.js';

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
  return currentSession;
}

export function isCsOrAdminUser() {
  if (!currentSession || !currentSession.user || !currentSession.user.email) return false;
  return ADMIN_EMAILS.includes(currentSession.user.email.toLowerCase().trim());
}

export function isPaymentApprovalAdmin() {
  if (!currentSession || !currentSession.user || !currentSession.user.email) return false;
  return APPROVAL_ADMIN_EMAILS.includes(currentSession.user.email.toLowerCase().trim());
}

export function getCurrentUserEmail() {
  return currentSession?.user?.email ? currentSession.user.email.toLowerCase().trim() : null;
}

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

  window.openChangePasswordModal = () => {
    const emailEl = document.getElementById('changePwdUserEmail');
    if (emailEl && currentSession) emailEl.innerText = `계정: ${currentSession.user.email}`;
    document.getElementById('changePasswordModal')?.classList.remove('hidden');
  };
}

export function updateAuthHeaderUI() {
  const isAuth = !!(currentSession && currentSession.user);
  document.getElementById('lockedOverlay')?.classList.toggle('hidden', isAuth);
  document.getElementById('unlockedContent')?.classList.toggle('hidden', !isAuth);
  document.getElementById('changePwdBtn')?.classList.toggle('hidden', !isAuth);

  const badge = document.getElementById('lockStatusBadge');
  const btn = document.getElementById('authActionBtn');

  if (isAuth) {
    if (badge) {
      badge.className = "text-[9px] sm:text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-900 border border-indigo-200 inline-block";
      badge.innerHTML = "🔓 사내 인증됨";
    }
    if (btn) {
      btn.className = "text-[11px] sm:text-xs bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold px-2.5 py-1.5 rounded-lg transition-colors";
      btn.innerHTML = "🚪 로그아웃";
    }
  } else {
    if (badge) {
      badge.className = "text-[9px] sm:text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full inline-block";
      badge.innerHTML = "🔒 로그인 필요";
    }
    if (btn) {
      btn.className = "text-[11px] sm:text-xs bg-slate-800 hover:bg-slate-900 text-white font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1 shadow-sm";
      btn.innerHTML = "🔑 로그인";
    }
  }
}

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
