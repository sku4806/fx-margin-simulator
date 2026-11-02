import { sbClient } from '../supabase.js';
import { getSession } from './auth.js';

/**
 * 📝 변경 감사 로그 기록
 */
export async function recordAuditLog(itemId, partName, actionType, details) {
  if (!sbClient) return;
  const session = getSession();
  const userEmail = session?.user?.email || '시스템/익명';

  // itemId가 유효하지 않으면 null로 저장
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
    
    const { data, error } = await sbClient
      .from('inventory_audit_logs')
      .insert([payload])
      .select();

    if (error) {
      console.error("[Audit] DB 저장 실패 에러:", error);
    } else {
      console.log("[Audit] 로그 저장 성공:", data);
    }
  } catch (err) {
    console.error("[Audit] 예외 발생:", err);
  }
}

/**
 * 📜 특정 품목의 최근 변경 이력 조회 (최신 10건)
 */
export async function fetchAuditLogs(itemId) {
  if (!sbClient) return [];
  
  // itemId가 없거나 'NaN'이면 조회를 즉시 중단
  if (!itemId || String(itemId) === 'NaN' || String(itemId).trim() === '') {
    return [];
  }

  try {
    const queryId = String(itemId).trim();
    const { data, error } = await sbClient
      .from('inventory_audit_logs')
      .select('*')
      .eq('item_id', queryId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error("[Audit] 조회 실패 에러:", error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn("[Audit] 감사 로그 조회 실패:", err);
    return [];
  }
}

/**
 * 🎨 폼 하단에 감사 로그 타임라인 렌더링
 */
export async function renderAuditHistory(containerId, itemId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!itemId || String(itemId) === 'NaN' || String(itemId).trim() === '') {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  const logs = await fetchAuditLogs(itemId);
  container.classList.remove('hidden');

  if (!logs || logs.length === 0) {
    container.innerHTML = `
      <div class="text-[10px] text-slate-400 p-2.5 bg-slate-50 rounded-lg border border-slate-200">
        기록된 변경 이력이 없습니다.
      </div>
    `;
    return;
  }

  const listHtml = logs.map(log => {
    const d = new Date(log.created_at);
    const timeStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const userShort = log.user_email ? log.user_email.split('@')[0] : '익명';

    let actionBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-700">${log.action_type}</span>`;
    if (log.action_type === 'CREATE') actionBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-green-100 text-green-800">신규등록</span>`;
    if (log.action_type === 'UPDATE') actionBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-800">정보수정</span>`;
    if (log.action_type === 'SPLIT') actionBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-800">출하분할</span>`;
    if (log.action_type === 'DELETE') actionBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 text-rose-800">삭제</span>`;

    return `
      <li class="flex items-start gap-2 py-1.5 text-[11px] border-b border-slate-100 last:border-0">
        <span class="text-slate-400 font-mono shrink-0">${timeStr}</span>
        <span class="font-bold text-slate-700 shrink-0">[${userShort}]</span>
        ${actionBadge}
        <span class="text-slate-800 break-all font-medium leading-relaxed">${escapeHtml(log.details)}</span>
      </li>
    `;
  }).join('');

  container.innerHTML = `
    <div class="p-3 bg-slate-50/80 rounded-xl border border-slate-200 space-y-1.5">
      <div class="text-[11px] font-bold text-slate-700 flex items-center gap-1">
        <span>🕒</span> 항목 변경 이력 (Audit History)
      </div>
      <ul class="space-y-0.5 divide-y divide-slate-100">
        ${listHtml}
      </ul>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
