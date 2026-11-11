/**
 * customer-autocomplete.js
 * 세일즈 마스터 MS-SQL CustomerFile & ContactFile 실시간 자동완성 모듈
 */

export function attachCustomerAutocomplete(inputEl, onSelect) {
  if (!inputEl) return;

  // 자동완성 드롭다운 컨테이너 생성
  let dropdown = document.createElement('div');
  dropdown.className = 'customer-autocomplete-dropdown hidden fixed z-[99999] bg-white rounded-xl shadow-2xl border border-slate-200 max-h-72 overflow-y-auto text-xs py-1.5 font-sans';
  dropdown.style.minWidth = '280px';
  document.body.appendChild(dropdown);

  let debounceTimer = null;
  let activeIndex = -1;
  let currentResults = [];

  function updatePosition() {
    const rect = inputEl.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.width = `${Math.max(rect.width, 320)}px`;
  }

  function hideDropdown() {
    dropdown.classList.add('hidden');
    dropdown.innerHTML = '';
    activeIndex = -1;
    currentResults = [];
  }

  async function searchCustomers(term) {
    if (!term || term.trim().length < 1) {
      hideDropdown();
      return;
    }

    try {
      const res = await fetch(`/api/customers/search?q=${encodeURIComponent(term.trim())}&limit=20`);
      const data = await res.json();
      if (data.status === 'success' && data.customers && data.customers.length > 0) {
        currentResults = data.customers;
        renderResults(data.customers, term);
      } else {
        currentResults = [{
          display_name: term.trim(),
          kname: term.trim(),
          cname: term.trim(),
          sales_rep: ""
        }];
        dropdown.innerHTML = `
          <div class="px-3 py-1.5 text-slate-400 text-center text-[10px] border-b border-slate-100">
            공식 거래처 마스터에 미등록된 고객사입니다.
          </div>
          <div class="cust-direct-item px-3 py-2 hover:bg-indigo-50/80 cursor-pointer text-indigo-700 font-bold flex items-center justify-between transition-colors">
            <span class="truncate">✨ "${term.trim()}" (직접 입력으로 적용)</span>
            <span class="text-[9px] bg-indigo-100 text-indigo-800 px-1.5 py-0.5 rounded font-black shrink-0">선택</span>
          </div>
        `;
        updatePosition();
        dropdown.classList.remove('hidden');

        const directEl = dropdown.querySelector('.cust-direct-item');
        if (directEl) {
          directEl.addEventListener('click', (e) => {
            e.stopPropagation();
            selectCustomer(currentResults[0]);
          });
        }
      }
    } catch (e) {
      console.warn("거래처 검색 오류:", e);
      hideDropdown();
    }
  }

  function renderResults(customers, term = '') {
    updatePosition();
    let html = customers.map((c, idx) => {
      const displayName = c.display_name || c.kname || c.cname;
      const subName = (c.cname && c.cname !== displayName) ? c.cname : '';
      const contact = c.contact_display || c.contact_name || '';
      const tel = c.tel || c.mobile || '';
      const sales = c.sales_rep || '';

      return `
        <div class="cust-item px-3 py-2 hover:bg-indigo-50/80 cursor-pointer border-b border-slate-100 last:border-b-0 transition-colors flex items-center justify-between gap-2" data-idx="${idx}">
          <div class="flex-1 min-w-0">
            <div class="font-bold text-slate-900 truncate flex items-center gap-1.5">
              <span>${displayName}</span>
              ${sales ? `<span class="px-1.5 py-0.2 rounded text-[9px] font-black bg-indigo-100 text-indigo-700">${sales}</span>` : ''}
            </div>
            ${subName ? `<div class="text-[10px] text-slate-400 truncate">${subName}</div>` : ''}
            <div class="text-[10px] text-slate-500 flex items-center gap-2 mt-0.5">
              ${contact ? `<span class="font-medium text-indigo-900">👤 ${contact}</span>` : ''}
              ${tel ? `<span class="font-mono">📞 ${tel}</span>` : ''}
            </div>
          </div>
          <div class="shrink-0 text-right">
            <span class="text-[9px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">선택</span>
          </div>
        </div>
      `;
    }).join('');

    // 만약 사용자가 입력한 값과 완전히 일치하지 않으면 직접 입력 옵션도 하단에 추가
    const exactMatch = customers.some(c => (c.display_name || c.kname || '').toLowerCase() === term.toLowerCase());
    if (term && !exactMatch) {
      html += `
        <div class="cust-custom-direct px-3 py-1.5 hover:bg-slate-100 cursor-pointer text-slate-500 hover:text-indigo-600 text-[11px] font-medium border-t border-slate-200 flex items-center justify-between transition-colors">
          <span>직접 입력값 적용: "${term}"</span>
          <span class="text-[9px] bg-slate-200 text-slate-700 px-1.5 py-0.2 rounded font-bold">적용</span>
        </div>
      `;
    }

    dropdown.innerHTML = html;
    dropdown.classList.remove('hidden');

    dropdown.querySelectorAll('.cust-item').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(el.getAttribute('data-idx'), 10);
        selectCustomer(currentResults[idx]);
      });
    });

    const customDirectEl = dropdown.querySelector('.cust-custom-direct');
    if (customDirectEl) {
      customDirectEl.addEventListener('click', (e) => {
        e.stopPropagation();
        selectCustomer({ display_name: term, kname: term, cname: term });
      });
    }
  }

  function selectCustomer(cust) {
    if (!cust) return;
    inputEl.value = cust.display_name || cust.kname || cust.cname;
    hideDropdown();
    if (typeof onSelect === 'function') {
      onSelect(cust);
    }
  }

  inputEl.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    const val = e.target.value.trim();
    if (val.length >= 1) {
      debounceTimer = setTimeout(() => searchCustomers(val), 200);
    } else {
      hideDropdown();
    }
  });

  inputEl.addEventListener('focus', () => {
    const val = inputEl.value.trim();
    if (val.length >= 1) {
      searchCustomers(val);
    }
  });

  inputEl.addEventListener('keydown', (e) => {
    if (dropdown.classList.contains('hidden')) return;

    const items = dropdown.querySelectorAll('.cust-item');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % items.length;
      updateActiveItem(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + items.length) % items.length;
      updateActiveItem(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < currentResults.length) {
        selectCustomer(currentResults[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      hideDropdown();
    }
  });

  function updateActiveItem(items) {
    items.forEach((it, idx) => {
      if (idx === activeIndex) {
        it.classList.add('bg-indigo-100');
        it.scrollIntoView({ block: 'nearest' });
      } else {
        it.classList.remove('bg-indigo-100');
      }
    });
  }

  // 외부 클릭 시 닫기
  document.addEventListener('click', (e) => {
    if (!inputEl.contains(e.target) && !dropdown.contains(e.target)) {
      hideDropdown();
    }
  });

  window.addEventListener('resize', () => {
    if (!dropdown.classList.contains('hidden')) updatePosition();
  });
  window.addEventListener('scroll', () => {
    if (!dropdown.classList.contains('hidden')) updatePosition();
  }, true);
}
