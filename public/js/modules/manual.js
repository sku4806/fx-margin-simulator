let manualRawText = "";

export function initManualViewer() {
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

  // 목차 링크(#sec-xxx) 클릭 시 모달 내부 부드러운 스크롤 이동
  contentEl?.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#"]');
    if (link) {
      e.preventDefault();
      const targetId = link.getAttribute('href').slice(1);
      const targetEl = document.getElementById(targetId);
      if (targetEl && contentEl) {
        const topPos = targetEl.offsetTop - contentEl.offsetTop;
        contentEl.scrollTo({ top: topPos - 10, behavior: 'smooth' });
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
    if (line.trim().startsWith('<div id=')) return line.trim();

    let l = escapeHtml(line);
    l = l.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-slate-900">$1</strong>');
    l = l.replace(/\*\*/g, '');
    l = l.replace(/\`(.*?)\`/g, '<code class="bg-indigo-50 text-indigo-700 px-1 py-0.5 rounded text-[11px] font-mono border border-indigo-100">$1</code>');
    l = l.replace(/\[(.*?)\]\((#.*?)\)/g, '<a href="$2" class="text-indigo-600 hover:text-indigo-800 font-semibold underline underline-offset-2 cursor-pointer transition-colors">$1</a>');
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
