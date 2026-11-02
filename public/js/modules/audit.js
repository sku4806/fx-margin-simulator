import { sbClient } from '../supabase.js';
import { getSession } from './auth.js';

let currentAuditItemId = null;
let currentAuditPartName = '';

/**
 * 📝 변경 감사 로그 기록
 */
export async function recordAuditLog(itemId, partName, actionType, details) {
  if (!sbClient) return;
  const session = getSession();
  const userEmail = session?.user?.email || '시스템/익명';

  const safeId = (itemId !== undefined && itemId !== null && String(itemId) !== 'NaN' && String(itemId).trim() !== '') 
    ? String(itemId) 
    : null;

  try {
    const payload = {
      item_id: safeId,
      part_name: partName || '-',
      action_type: actionType,
      user_email: userEmail,
      details: details
    };
    
    await sbClient
      .from('inventory_audit_logs')
      .insert([payload]);
  } catch (err) {
    console.error("[Audit] 예외 발생:", err);
  }
}

/**
 * 📜 품목의 변경 이력 조회
 */
export async function fetchAuditLogs(itemId, limit = null) {
  if (!sbClient) return [];
  if (!itemId || String(itemId) === 'NaN' || String(itemId).trim() === '') return [];

  try {
    let query = sbClient
      .from('inventory_audit_logs')
      .select('*')
      .eq('item_id', String(itemId).trim())
      .order('created_at', { ascending: false });

    if (limit) {
      query = query.limit(limit);
    }

    const { data, error } = await query;
    if (error) {
      console.error("[Audit] 조회 실패:", error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn("[Audit] 감사 로그 조회 실패:", err);
    return [];
  }
}

/**
 * 🎨 폼 하단 최근 변경 이력 렌더링 + '전체 이력 보기' 버튼 연결
 */
export async function renderAuditHistory(containerId, itemId, partName = '') {
  const container = document.getElementById(containerId);
  if (!container) return;

  currentAuditItemId = itemId;
  currentAuditPartName = partName;

  if (!itemId || String(itemId) === 'NaN' || String(itemId).trim() === '') {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  const allLogs = await fetchAuditLogs(itemId);
  container.classList.remove('hidden');

  if (!allLogs || allLogs.length === 0) {
    container.innerHTML = `
      <div class="text-[10px] text-slate-400 p-2.5 bg-slate-50 rounded-lg border border-slate-200">
        기록된 변경 이력이 없습니다.
      </div>
    `;
    return;
  }

  const previewLogs = allLogs.slice(0, 5);
  const listHtml = previewLogs.map(log => formatLogItemHtml(log)).join('');

  container.innerHTML = `
    <div class="p-3 bg-slate-50/80 rounded-xl border border-slate-200 space-y-2">
      <div class="flex justify-between items-center text-[11px]">
        <div class="font-bold text-slate-800 flex items-center gap-1">
          <span>🕒</span> 항목 최근 변경 이력 <span class="text-indigo-600 font-semibold">(최근 ${previewLogs.length}건 / 총 ${allLogs.length}건)</span>
        </div>
        <button type="button" id="openAllAuditBtn" class="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 bg-white hover:bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded shadow-sm transition-colors">
          전체 이력 보기 (${allLogs.length}건) ➔
        </button>
      </div>

      <ul class="space-y-0.5 divide-y divide-slate-100">
        ${listHtml}
      </ul>
    </div>
  `;

  document.getElementById('openAllAuditBtn')?.addEventListener('click', () => {
    openAllAuditModal(allLogs, currentAuditPartName);
  });
}

/**
 * 📜 전체 변경 이력 모달 팝업 열기
 */
export function openAllAuditModal(logs, partName = '') {
  const modal = document.getElementById('allAuditModal');
  const title = document.getElementById('allAuditTitle');
  const subtitle = document.getElementById('allAuditSubtitle');
  const list = document.getElementById('allAuditList');
  const countText = document.getElementById('allAuditCountText');

  if (!modal || !list) return;

  if (title) title.innerText = `[${partName || '부품'}] 전체 변경 이력`;
  if (subtitle) subtitle.innerText = `총 ${logs.length}건의 히스토리가 기록되어 있습니다.`;
  if (countText) countText.innerText = `총 ${logs.length}건 조회됨`;

  list.innerHTML = logs.map(log => formatLogItemHtml(log, true)).join('');
  modal.classList.remove('hidden');
}

function formatLogItemHtml(log, isModal = false) {
  const d = new Date(log.created_at);
  const timeStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  const userShort = log.user_email ? log.user_email.split('@')[0] : '익명';

  let actionBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-700">${log.action_type}</span>`;
  if (log.action_type === 'CREATE') actionBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-green-100 text-green-800">신규등록</span>`;
  if (log.action_type === 'UPDATE') actionBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-800">정보수정</span>`;
  if (log.action_type === 'SPLIT') actionBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-800">출하분할</span>`;
  if (log.action_type === 'DELETE') actionBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 text-rose-800">삭제</span>`;

  return `
    <li class="flex items-start gap-2 py-1.5 text-[11px] border-b border-slate-100 last:border-0 ${isModal ? 'hover:bg-slate-100/50 p-1 rounded' : ''}">
      <span class="text-slate-400 font-mono text-[10px] shrink-0 pt-0.5">${timeStr}</span>
      <span class="font-bold text-slate-700 shrink-0">[${userShort}]</span>
      ${actionBadge}
      <span class="text-slate-800 break-all font-medium leading-relaxed">${escapeHtml(log.details)}</span>
    </li>
  `;
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
