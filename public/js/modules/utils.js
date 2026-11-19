/**
 * public/js/modules/utils.js
 * BSK ERP 공통 프론트엔드 유틸리티 (중복 코드 제거 및 일관성 확보)
 */

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function debounce(fn, wait = 200) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

export function formatKrw(amount) {
  return `₩${Math.round(Number(amount) || 0).toLocaleString()}`;
}

export function formatUsd(amount, decimals = 2) {
  return `$${(Number(amount) || 0).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })}`;
}

const KOR_TO_ENG_SALES_MAP = {
  '고기봉': 'WILLIAM',
  '김경래': 'KELLY',
  '김남천': 'NATHAN',
  '김명호': 'DUSTIN',
  '김하진': 'HAROLD',
  '김현진': 'PAUL',
  '박대원': 'TIMOTHY',
  '박재범': 'ALLEN',
  '뱍재범': 'ALLEN',
  '성임선': 'GRACE',
  '윤준영': 'ROBIN',
  '이민수': 'LOGAN',
  '이재상': 'ERIC',
  '조지윤': 'JOEY',
  '최원석': 'WILSON',
  '황환': 'STEVE',
  '염재섭': 'JOSEPH',
  '방경현': 'KEVIN',
  '이정문': 'PHILIP',
  '이동열': 'TONY',
  '이동렬': 'TONY',
  '이동일': 'TONY',
  '안진필': 'JASON',
  '최연유': 'DEAN',
  '이대룡': 'ALEX',
  '이길성': 'KS',
  '서길재': 'ADMIN',
  '이재석': 'JAMES',
  '김경택': 'SCOTT',
  '김상운': 'EDGAR',
  '신석승': 'HUBERT',
  '조웅규': 'BRIAN',
  '한희성': 'HANS',
  '문숙정': 'JANE',
  '천소훈': 'JAMIE',
  '고유진': 'LILY',
  '손유경': 'RAINA',
  '최연아': 'SUSAN',
  '진혜영': 'TRISHA',
  '김현아': 'ANNE',
  '류승윤': 'SIMON',
  '임병세': 'SEAN',
  '조재윤': 'DAVID',
  '이숙희': 'CINDY',
  '유상현': 'RYAN',
  '류상현': 'RYAN',
  '원대연': 'ANDY',
  '신준수': 'THOMAS',
  '강향구': 'PETER',
  '윤현주': 'IRIS',
  '박광민': 'KWANGMIN',
  '박괌민': 'KWANGMIN',
  '박은경': 'EUNKYUNG',
  '강미금': 'MIKEUM',
  '라형준': 'HYUNGJUN',
  '전창주': 'CHANGJOO',
  '전장주': 'CHANGJOO',
  '이혁재': 'HYUKJAE',
  '이혁제': 'HYUKJAE',
  '엄태선': 'TAESUN',
  '빅샤인': 'BSK',
  '빅샤인코리아': 'BSK',
  '빅샤인월드': 'BSW',
  'WILLAM': 'WILLIAM',
  'WILIAM': 'WILLIAM',
  'WIILIAM': 'WILLIAM',
  'WILLLIAM': 'WILLIAM',
  'WILLIMA': 'WILLIAM',
  'WILLIMAM': 'WILLIAM',
  'JOYE': 'JOEY',
  'JEOY': 'JOEY',
  'KELLEY': 'KELLY',
  'KELLLY': 'KELLY',
  'KEELY': 'KELLY',
  'KELL': 'KELLY',
  'KELLYC': 'KELLY',
  'KELLYE': 'KELLY',
  'KELLY KIM': 'KELLY',
  'DUSIN': 'DUSTIN',
  'DUSTIN KIM': 'DUSTIN',
  'EIRC': 'ERIC',
  'ERICE': 'ERIC',
  'ERIC.': 'ERIC',
  'PHLIP': 'PHILIP',
  'PHILIP LEE': 'PHILIP',
  'HALOLD': 'HAROLD',
  'ALLE': 'ALLEN',
  'ALLENS': 'ALLEN',
  'ALLLEN': 'ALLEN',
  'ALLNE': 'ALLEN',
  'WILLSON': 'WILSON',
  'WILSOM': 'WILSON',
  'WILSON CHOI': 'WILSON',
  'SOCTT': 'SCOTT',
  'SCOCCT': 'SCOTT',
  'ROBIB': 'ROBIN',
  'ROBINI': 'ROBIN',
  'STEV': 'STEVE',
  'STVE': 'STEVE',
  'STEVEE': 'STEVE',
  'STEVEW': 'STEVE',
  'STESVE': 'STEVE',
  'STEVSE': 'STEVE',
  'STE VE': 'STEVE',
  'STEV E': 'STEVE',
  'STEVE HWANG': 'STEVE',
  'TONY LEE': 'TONY',
  'TIMOTHY PARK': 'TIMOTHY',
  'KEVIN BANG': 'KEVIN',
  'SIMON RYU': 'SIMON',
  'IRIS YOON': 'IRIS'
};

const RANK_SUFFIX_RE = /(주임|대리|과장|차장|부장|이사|전무|부사장|사장|대표|사원|프로|연구원|선임|책임|님)$/;

function normalizeSingleRepToken(token) {
  const t = String(token ?? '').trim();
  if (!t || t === '.' || t === '-' || t === '0' || t === '11') return '';
  const up = t.toUpperCase();
  if (KOR_TO_ENG_SALES_MAP[up]) return KOR_TO_ENG_SALES_MAP[up];
  const noSpace = t.replace(/\s+/g, '');
  const noRank = noSpace.replace(RANK_SUFFIX_RE, '');
  if (KOR_TO_ENG_SALES_MAP[noRank]) return KOR_TO_ENG_SALES_MAP[noRank];
  if (KOR_TO_ENG_SALES_MAP[noSpace]) return KOR_TO_ENG_SALES_MAP[noSpace];
  for (const [kKor, vEng] of Object.entries(KOR_TO_ENG_SALES_MAP)) {
    if (kKor.length >= 2 && noSpace.includes(kKor)) return vEng;
  }
  return up;
}

export function toEnglishSalesName(val, fallback = '') {
  const raw = String(val ?? '').trim();
  if (!raw) return fallback;
  if (raw.includes('/') || raw.includes(',')) {
    const parts = raw.split(/[/,]/).map(normalizeSingleRepToken).filter(Boolean);
    const uniq = [...new Set(parts)];
    return uniq.join(' / ') || fallback;
  }
  return normalizeSingleRepToken(raw) || fallback;
}

if (typeof window !== 'undefined') {
  window.toEnglishSalesName = toEnglishSalesName;
}
