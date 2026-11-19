# legacy_mssql.py
import os
import time
import datetime
from typing import List, Dict, Any, Optional

os.environ["TDSVER"] = "7.0"

LEGACY_DB_CONFIG = {
    'server': os.getenv('LEGACY_DB_HOST', '192.168.0.105'),
    'port': int(os.getenv('LEGACY_DB_PORT', 1433)),
    'user': os.getenv('LEGACY_DB_USER', 'linemsid'),
    'password': os.getenv('LEGACY_DB_PASSWORD', 'linepasswd'),
    'database': os.getenv('LEGACY_DB_NAME', 'BigLinemaster'),
    'charset': 'CP949',
    'tds_version': '7.0',
    'timeout': 5
}

def clean_val(v: Any) -> Any:
    if v is None:
        return ""
    if isinstance(v, bytes):
        try:
            return v.decode("cp949", errors="ignore").strip()
        except Exception:
            return v.decode("utf-8", errors="ignore").strip()
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, str):
        return v.strip()
    return v


import re as _re

_KOR_TO_ENG_SALES_MAP: Dict[str, str] = {
    "고기봉": "WILLIAM",
    "김경래": "KELLY",
    "김남천": "NATHAN",
    "김명호": "DUSTIN",
    "김하진": "HAROLD",
    "김현진": "PAUL",
    "박대원": "TIMOTHY",
    "박재범": "ALLEN",
    "뱍재범": "ALLEN",
    "성임선": "GRACE",
    "윤준영": "ROBIN",
    "이민수": "LOGAN",
    "이재상": "ERIC",
    "조지윤": "JOEY",
    "최원석": "WILSON",
    "황환": "STEVE",
    "염재섭": "JOSEPH",
    "방경현": "KEVIN",
    "이정문": "PHILIP",
    "이동열": "TONY",
    "이동렬": "TONY",
    "이동일": "TONY",
    "안진필": "JASON",
    "최연유": "DEAN",
    "이대룡": "ALEX",
    "이길성": "KS",
    "서길재": "ADMIN",
    "이재석": "JAMES",
    "김경택": "SCOTT",
    "김상운": "EDGAR",
    "신석승": "HUBERT",
    "조웅규": "BRIAN",
    "한희성": "HANS",
    "문숙정": "JANE",
    "천소훈": "JAMIE",
    "고유진": "LILY",
    "손유경": "RAINA",
    "최연아": "SUSAN",
    "진혜영": "TRISHA",
    "김현아": "ANNE",
    "류승윤": "SIMON",
    "임병세": "SEAN",
    "조재윤": "DAVID",
    "이숙희": "CINDY",
    "유상현": "RYAN",
    "류상현": "RYAN",
    "원대연": "ANDY",
    "신준수": "THOMAS",
    "강향구": "PETER",
    "윤현주": "IRIS",
    "박광민": "KWANGMIN",
    "박괌민": "KWANGMIN",
    "박은경": "EUNKYUNG",
    "강미금": "MIKEUM",
    "라형준": "HYUNGJUN",
    "전창주": "CHANGJOO",
    "전장주": "CHANGJOO",
    "이혁재": "HYUKJAE",
    "이혁제": "HYUKJAE",
    "엄태선": "TAESUN",
    "빅샤인": "BSK",
    "빅샤인코리아": "BSK",
    "빅샤인월드": "BSW",
    # 영문 오타/약어 표준화
    "WILLAM": "WILLIAM",
    "WILIAM": "WILLIAM",
    "WIILIAM": "WILLIAM",
    "WILLLIAM": "WILLIAM",
    "WILLIMA": "WILLIAM",
    "WILLIMAM": "WILLIAM",
    "JOYE": "JOEY",
    "JEOY": "JOEY",
    "KELLEY": "KELLY",
    "KELLLY": "KELLY",
    "KEELY": "KELLY",
    "KELL": "KELLY",
    "KELLYC": "KELLY",
    "KELLYE": "KELLY",
    "KELLY KIM": "KELLY",
    "DUSIN": "DUSTIN",
    "DUSTIN KIM": "DUSTIN",
    "EIRC": "ERIC",
    "ERICE": "ERIC",
    "ERIC.": "ERIC",
    "PHLIP": "PHILIP",
    "PHILIP LEE": "PHILIP",
    "HALOLD": "HAROLD",
    "ALLE": "ALLEN",
    "ALLENS": "ALLEN",
    "ALLLEN": "ALLEN",
    "ALLNE": "ALLEN",
    "WILLSON": "WILSON",
    "WILSOM": "WILSON",
    "WILSON CHOI": "WILSON",
    "SOCTT": "SCOTT",
    "SCOCCT": "SCOTT",
    "ROBIB": "ROBIN",
    "ROBINI": "ROBIN",
    "STEV": "STEVE",
    "STVE": "STEVE",
    "STEVEE": "STEVE",
    "STEVEW": "STEVE",
    "STESVE": "STEVE",
    "STEVSE": "STEVE",
    "STE VE": "STEVE",
    "STEV E": "STEVE",
    "STEVE HWANG": "STEVE",
    "TONY LEE": "TONY",
    "TIMOTHY PARK": "TIMOTHY",
    "KEVIN BANG": "KEVIN",
    "SIMON RYU": "SIMON",
    "IRIS YOON": "IRIS",
}

_RANK_SUFFIX_RE = _re.compile(r"(주임|대리|과장|차장|부장|이사|전무|부사장|사장|대표|사원|프로|연구원|선임|책임|님)$")

def _normalize_single_rep(token: str) -> str:
    t = token.strip()
    if not t or t in (".", "-", "0", "11"):
        return ""
    up = t.upper()
    if up in _KOR_TO_ENG_SALES_MAP:
        return _KOR_TO_ENG_SALES_MAP[up]
    # 공백 및 직급 제거 후 매칭
    no_space = _re.sub(r"\s+", "", t)
    no_rank = _RANK_SUFFIX_RE.sub("", no_space)
    if no_rank in _KOR_TO_ENG_SALES_MAP:
        return _KOR_TO_ENG_SALES_MAP[no_rank]
    if no_space in _KOR_TO_ENG_SALES_MAP:
        return _KOR_TO_ENG_SALES_MAP[no_space]
    # 부분 매칭 (예: '박 대 원 대원', '조 재 윤 재윤')
    for k_kor, v_eng in _KOR_TO_ENG_SALES_MAP.items():
        if len(k_kor) >= 2 and k_kor in no_space:
            return v_eng
    return up

def normalize_sales_rep(v: Any) -> str:
    """담당자(Sales/Owner/InputPerson) 이름을 항상 표준 영문 대문자로 변환"""
    raw = clean_val(v)
    if not raw or not isinstance(raw, str):
        return ""
    if "/" in raw or "," in raw:
        parts = [_normalize_single_rep(p) for p in _re.split(r"[/,]", raw)]
        parts = [p for p in parts if p]
        # 중복 제거 유지
        seen = []
        for p in parts:
            if p not in seen:
                seen.append(p)
        return " / ".join(seen)
    return _normalize_single_rep(raw)

class _SafeConnection:
    """예외 발생 시에도 MS-SQL 소켓 누수를 원천 차단하는 자동 해제 커넥션 래퍼"""
    __slots__ = ("_conn", "_closed")

    def __init__(self, conn):
        self._conn = conn
        self._closed = False

    def cursor(self, *args, **kwargs):
        return self._conn.cursor(*args, **kwargs)

    def commit(self):
        return self._conn.commit()

    def rollback(self):
        return self._conn.rollback()

    def close(self):
        if not self._closed:
            self._closed = True
            try:
                self._conn.close()
            except Exception:
                pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
        return False

    def __del__(self):
        self.close()


def get_db_connection():
    import pymssql
    return _SafeConnection(pymssql.connect(**LEGACY_DB_CONFIG))

_CACHED_MFGS = {"data": [], "updated_at": 0}

def get_quotation_mfgs() -> List[str]:
    """자주 조회되는 제조사(MFG) 목록 반환 (캐싱 적용)"""
    import time
    now = time.time()
    if _CACHED_MFGS["data"] and (now - _CACHED_MFGS["updated_at"] < 3600):
        return _CACHED_MFGS["data"]
    
    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)
        cur.execute("""
            SELECT DISTINCT LTRIM(RTRIM(MFG)) as mfg
            FROM QuotationFile
            WHERE MFG IS NOT NULL AND LTRIM(RTRIM(MFG)) <> ''
            ORDER BY mfg ASC
        """)
        rows = cur.fetchall()
        conn.close()
        
        mfgs = [clean_val(r['mfg']) for r in rows if clean_val(r['mfg'])]
        # 점(.) 등 특수문자 단독 항목 제외
        mfgs = [m for m in mfgs if m not in ('.', '0', '-')]
        _CACHED_MFGS["data"] = mfgs
        _CACHED_MFGS["updated_at"] = now
        return mfgs
    except Exception as e:
        print(f"[WARN] MS-SQL MFG 목록 조회 실패: {e}")
        return _CACHED_MFGS["data"] or ["ISSI", "Giantec", "GigaDevice", "CCSS", "SMI", "XMOS", "OTHERS"]

SALES_ALIAS_MAP = {
    "william": ["고기봉", "william"],
    "willam": ["고기봉", "willam"],
    "joey": ["조지윤", "조재윤", "joey"],
    "joye": ["조지윤", "조재윤", "joye"],
    "allen": ["박재범", "allen"],
    "kelly": ["김경래", "kelly"],
    "steve": ["황환", "황 환", "steve"],
    "dustin": ["김명호", "dustin"],
    "eric": ["이재상", "eric"],
    "timothy": ["박대원", "timothy"],
    "paul": ["김현진", "paul"],
    "logan": ["이민수", "logan"],
    "tony": ["이동일", "tony"],
    "susan": ["최연아", "susan"],
    "raina": ["손유경", "raina"],
    "trisha": ["진혜영", "trisha"],
    "jane": ["문숙정", "jane"],
    "lily": ["고유진", "lily"]
}

def query_quotations(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    mfg: Optional[str] = None,
    search_query: Optional[str] = None,
    limit: int = 500
) -> List[Dict[str, Any]]:
    """
    QuotationFile 및 CustomerFile 조인 조회
    화면(Sales Daily Report - [frmQuotationSQL])의 그리드 데이터와 100% 일치
    """
    conditions = []
    params = []

    if start_date:
        conditions.append("q.QuoteDT >= %s")
        params.append(start_date)
    if end_date:
        conditions.append("q.QuoteDT <= %s")
        params.append(f"{end_date} 23:59:59")
    if mfg and mfg.strip():
        conditions.append("LTRIM(RTRIM(q.MFG)) = %s")
        params.append(mfg.strip())
    if search_query and search_query.strip():
        term = f"%{search_query.strip()}%"
        sq_clean = search_query.strip().lower()
        alias_conds = []
        alias_params = []
        for a_key, a_vals in SALES_ALIAS_MAP.items():
            if a_key in sq_clean:
                for v in a_vals:
                    alias_conds.append("q.Sales LIKE %s")
                    alias_params.append(f"%{v}%")

        if alias_conds:
            extra_or = " OR " + " OR ".join(alias_conds)
        else:
            extra_or = ""

        conditions.append(f"""(
            q.PartNo LIKE %s OR 
            c.Cname LIKE %s OR 
            q.CNAME LIKE %s OR 
            q.CONTACT LIKE %s OR 
            q.Sales LIKE %s OR 
            q.QuoteNo LIKE %s{extra_or}
        )""")
        params.extend([term, term, term, term, term, term] + alias_params)

    where_clause = ""
    if conditions:
        where_clause = "WHERE " + " AND ".join(conditions)

    sql = f"""
        SELECT TOP ({limit})
            q.IDX as idx,
            q.QuoteDT as quote_dt,
            q.QuoteNo as quote_no,
            q.Quotline as line_no,
            COALESCE(c.Cname, q.CNAME, '') as cname,
            q.CONTACT as contact,
            q.MFG as mfg,
            q.PartNo as part_no,
            q.QTY_STR as qty_str,
            q.QTY_INT as qty_int,
            q.QUnit as qunit,
            q.QP as qp,
            q.Amount as amount,
            q.Payment as payment,
            q.Sales as sales,
            q.Delivery as delivery,
            q.Application as application,
            q.REMARK as remark,
            q.QUOT_TYPE as quot_type,
            c.Address as address,
            c.TEL as tel,
            c.FAX as fax,
            c.Email as email
        FROM QuotationFile q
        LEFT JOIN CustomerFile c ON q.CUSTID = c.CID
        {where_clause}
        ORDER BY q.QuoteDT DESC, q.QuoteNo ASC, q.Quotline ASC, q.IDX DESC
    """

    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)
        cur.execute(sql, tuple(params))
        raw_rows = cur.fetchall()
        conn.close()

        results = []
        for row in raw_rows:
            cleaned = {k: clean_val(v) for k, v in row.items()}
            if "sales" in cleaned:
                cleaned["sales"] = normalize_sales_rep(cleaned["sales"])
            # 수량 및 단가 기본 정리
            if cleaned.get("amount") == "":
                cleaned["amount"] = 0.0
            if cleaned.get("qp") == "":
                cleaned["qp"] = 0.0
            results.append(cleaned)
        return results
    except Exception as e:
        print(f"[ERROR] MS-SQL 견적 목록 조회 에러: {e}")
        raise e

def get_quotation_by_no(quote_no: str) -> List[Dict[str, Any]]:
    """특정 견적 번호(QuoteNo)의 모든 세부 라인 및 고객 정보 조회 (견적서 재출력용)"""
    if not quote_no:
        return []
    
    sql = """
        SELECT 
            q.IDX as idx,
            q.QuoteDT as quote_dt,
            q.QuoteNo as quote_no,
            q.Quotline as line_no,
            COALESCE(c.Cname, q.CNAME, '') as cname,
            q.CONTACT as contact,
            q.MFG as mfg,
            q.PartNo as part_no,
            q.QTY_STR as qty_str,
            q.QTY_INT as qty_int,
            q.QUnit as qunit,
            q.QP as qp,
            q.Amount as amount,
            q.Payment as payment,
            q.Sales as sales,
            q.Delivery as delivery,
            q.Application as application,
            q.REMARK as remark,
            q.QUOT_TYPE as quot_type,
            c.Address as address,
            c.TEL as tel,
            c.FAX as fax,
            c.Email as email
        FROM QuotationFile q
        LEFT JOIN CustomerFile c ON q.CUSTID = c.CID
        WHERE q.QuoteNo = %s
        ORDER BY q.Quotline ASC, q.IDX ASC
    """
    conn = get_db_connection()
    cur = conn.cursor(as_dict=True)
    cur.execute(sql, (quote_no,))
    raw_rows = cur.fetchall()
    conn.close()

    out_rows = []
    for row in raw_rows:
        d = {k: clean_val(v) for k, v in row.items()}
        if "sales" in d:
            d["sales"] = normalize_sales_rep(d["sales"])
        out_rows.append(d)
    return out_rows

# ========================================================
# 💰 미수금 및 결제예정일 관리 (FrmUnpaidCustList) 모듈
# ========================================================
def get_unpaid_sales_reps() -> List[str]:
    """미수금이 존재하는 영업 담당자 목록"""
    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)
        cur.execute("""
            SELECT DISTINCT LTRIM(RTRIM(A.SALES)) as sales
            FROM DREPORTFILE A
            WHERE A.RESULT = 'OUT' AND A.PAY = '미결제' AND A.SALES IS NOT NULL AND LTRIM(RTRIM(A.SALES)) <> ''
            ORDER BY sales ASC
        """)
        rows = cur.fetchall()
        conn.close()
        reps = sorted(set(normalize_sales_rep(r['sales']) for r in rows if normalize_sales_rep(r['sales'])))
        return reps or ["ALLEN", "STEVE", "WILLIAM", "PAUL", "JOEY", "DUSTIN"]
    except Exception as e:
        print(f"[WARN] 영업사원 목록 조회 실패: {e}")
        return ["ALLEN", "STEVE", "WILLIAM", "PAUL", "JOEY", "DUSTIN"]

def get_unpaid_summary(min_out_date: Optional[str] = "2010-01-01") -> Dict[str, Any]:
    """미수금 총괄 통계 (Grand Summaries & Aging 구간별 통계 및 Top 5 고객사)"""
    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)
        where_date = f"AND A.OUTDT >= '{min_out_date}'" if min_out_date else ""
        sql = f"""
            SELECT 
                COUNT(*) as total_count,
                SUM(A.OUTAMT * 1.1) as total_amount,
                SUM(CASE WHEN DATEDIFF(DAY, A.PAY_PLAN_DT, GETDATE()) > 0 THEN A.OUTAMT * 1.1 ELSE 0 END) as overdue_amount,
                SUM(CASE WHEN DATEDIFF(DAY, A.PAY_PLAN_DT, GETDATE()) <= 0 THEN A.OUTAMT * 1.1 ELSE 0 END) as upcoming_amount,
                SUM(CASE WHEN DATEDIFF(DAY, A.PAY_PLAN_DT, GETDATE()) > 0 AND DATEDIFF(DAY, A.PAY_PLAN_DT, GETDATE()) < 30 THEN A.OUTAMT * 1.1 ELSE 0 END) as amt_1_30,
                SUM(CASE WHEN DATEDIFF(DAY, A.PAY_PLAN_DT, GETDATE()) >= 30 AND DATEDIFF(DAY, A.PAY_PLAN_DT, GETDATE()) < 45 THEN A.OUTAMT * 1.1 ELSE 0 END) as amt_30_45,
                SUM(CASE WHEN DATEDIFF(DAY, A.PAY_PLAN_DT, GETDATE()) >= 45 AND DATEDIFF(DAY, A.PAY_PLAN_DT, GETDATE()) < 60 THEN A.OUTAMT * 1.1 ELSE 0 END) as amt_45_60,
                SUM(CASE WHEN DATEDIFF(DAY, A.PAY_PLAN_DT, GETDATE()) >= 60 THEN A.OUTAMT * 1.1 ELSE 0 END) as amt_60_plus,
                COUNT(CASE WHEN DATEDIFF(DAY, A.PAY_PLAN_DT, GETDATE()) > 0 THEN 1 END) as overdue_count,
                COUNT(CASE WHEN DATEDIFF(DAY, A.PAY_PLAN_DT, GETDATE()) <= 0 THEN 1 END) as upcoming_count
            FROM DREPORTFILE A
            WHERE A.RESULT = 'OUT' AND A.PAY = '미결제' {where_date}
        """
        cur.execute(sql)
        row = cur.fetchone()
        
        # Top 5 고객사별 미수금 순위
        top_sql = f"""
            SELECT TOP 5 
                B.KNAME as customer_name,
                COUNT(*) as item_count,
                SUM(A.OUTAMT * 1.1) as total_amount
            FROM DREPORTFILE A
            INNER JOIN CUSTOMERFILE B ON A.CUSTID = B.CID
            WHERE A.RESULT = 'OUT' AND A.PAY = '미결제' {where_date}
            GROUP BY B.KNAME
            ORDER BY total_amount DESC
        """
        cur.execute(top_sql)
        top_rows = cur.fetchall()
        conn.close()

        return {
            "total_count": int(row["total_count"] or 0),
            "total_amount": float(row["total_amount"] or 0.0),
            "overdue_amount": float(row["overdue_amount"] or 0.0),
            "upcoming_amount": float(row["upcoming_amount"] or 0.0),
            "overdue_count": int(row["overdue_count"] or 0),
            "upcoming_count": int(row["upcoming_count"] or 0),
            "aging_amounts": {
                "1_30": float(row["amt_1_30"] or 0.0),
                "30_45": float(row["amt_30_45"] or 0.0),
                "45_60": float(row["amt_45_60"] or 0.0),
                "60_plus": float(row["amt_60_plus"] or 0.0)
            },
            "top_customers": [
                {
                    "customer_name": clean_val(r["customer_name"]),
                    "item_count": int(r["item_count"] or 0),
                    "total_amount": float(r["total_amount"] or 0.0)
                } for r in top_rows
            ]
        }
    except Exception as e:
        print(f"[ERROR] get_unpaid_summary 에러: {e}")
        return {
            "total_count": 0, "total_amount": 0.0, "overdue_amount": 0.0, "upcoming_amount": 0.0,
            "overdue_count": 0, "upcoming_count": 0,
            "aging_amounts": {"1_30": 0.0, "30_45": 0.0, "45_60": 0.0, "60_plus": 0.0},
            "top_customers": []
        }

def query_unpaid_list(
    sales_rep: Optional[str] = None,
    customer: Optional[str] = None,
    mfg: Optional[str] = None,
    aging_filter: Optional[str] = None,
    search_query: Optional[str] = None,
    min_out_date: Optional[str] = "2010-01-01",
    sort_by: Optional[str] = "due_date_asc",
    limit: int = 1500
) -> List[Dict[str, Any]]:
    """결제예정 및 미수금 목록 상세 조회 (FrmUnpaidCustList 연동)"""
    conditions = ["A.RESULT = 'OUT'", "A.PAY = '미결제'"]
    params = []

    if min_out_date:
        conditions.append("A.OUTDT >= %s")
        params.append(min_out_date)
    if sales_rep and sales_rep.strip() and sales_rep != 'ALL':
        conditions.append("LTRIM(RTRIM(A.SALES)) = %s")
        params.append(sales_rep.strip())
    if customer and customer.strip():
        conditions.append("B.KNAME LIKE %s")
        params.append(f"%{customer.strip()}%")
    if mfg and mfg.strip():
        conditions.append("LTRIM(RTRIM(A.MFG)) = %s")
        params.append(mfg.strip())
    if search_query and search_query.strip():
        term = f"%{search_query.strip()}%"
        conditions.append("(A.PARTNO LIKE %s OR B.KNAME LIKE %s OR A.PONO LIKE %s OR A.CONTACT LIKE %s OR A.SALES LIKE %s)")
        params.extend([term, term, term, term, term])

    # Aging 구간 필터
    if aging_filter == 'upcoming':
        conditions.append("DATEDIFF(DAY, A.PAY_PLAN_DT, GETDATE()) <= 0")
    elif aging_filter == 'overdue':
        conditions.append("DATEDIFF(DAY, A.PAY_PLAN_DT, GETDATE()) > 0")
    elif aging_filter == '1_30':
        conditions.append("(DATEDIFF(DAY, A.PAY_PLAN_DT, GETDATE()) > 0 AND DATEDIFF(DAY, A.PAY_PLAN_DT, GETDATE()) < 30)")
    elif aging_filter == '30_45':
        conditions.append("(DATEDIFF(DAY, A.PAY_PLAN_DT, GETDATE()) >= 30 AND DATEDIFF(DAY, A.PAY_PLAN_DT, GETDATE()) < 45)")
    elif aging_filter == '45_60':
        conditions.append("(DATEDIFF(DAY, A.PAY_PLAN_DT, GETDATE()) >= 45 AND DATEDIFF(DAY, A.PAY_PLAN_DT, GETDATE()) < 60)")
    elif aging_filter == '60_plus':
        conditions.append("DATEDIFF(DAY, A.PAY_PLAN_DT, GETDATE()) >= 60")

    where_clause = "WHERE " + " AND ".join(conditions)

    # 정렬
    order_clause = "ORDER BY A.PAY_PLAN_DT ASC, amount_vat DESC"
    if sort_by == 'amount_desc':
        order_clause = "ORDER BY amount_vat DESC"
    elif sort_by == 'overdue_desc':
        order_clause = "ORDER BY overdue_days DESC"
    elif sort_by == 'out_date_desc':
        order_clause = "ORDER BY A.OUTDT DESC"

    sql = f"""
        SELECT TOP ({limit})
            A.IDX as legacy_idx,
            B.KNAME as customer_name,
            B.CNAME as customer_cname,
            B.Address as customer_address,
            B.TEL as customer_tel,
            A.OUTDT as out_date,
            A.PONO as po_no,
            A.PARTNO as part_no,
            A.MFG as maker,
            A.QTY as qty,
            A.OUTUP as unit_price,
            A.OUTAMT as supply_amount,
            A.TAX as tax_yn,
            CAST(A.OUTAMT * 1.1 AS MONEY) as amount_vat,
            DATEDIFF(DAY, A.PAY_PLAN_DT, GETDATE()) as overdue_days,
            A.PAY as pay_status,
            A.CONTACT as contact,
            A.PAY_PLAN_DT as due_date,
            A.SALES as sales_rep,
            CASE 
                WHEN DATEDIFF(DAY, A.PAY_PLAN_DT, GETDATE()) <= 0 THEN 0
                WHEN DATEDIFF(DAY, A.PAY_PLAN_DT, GETDATE()) < 30 THEN 1
                WHEN DATEDIFF(DAY, A.PAY_PLAN_DT, GETDATE()) < 45 THEN 2
                WHEN DATEDIFF(DAY, A.PAY_PLAN_DT, GETDATE()) < 60 THEN 3
                ELSE 4
            END as gubun_color
        FROM DREPORTFILE A
        INNER JOIN CUSTOMERFILE B ON A.CUSTID = B.CID
        {where_clause}
        {order_clause}
    """

    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        conn.close()

        results = []
        for r in rows:
            results.append({
                "idx": r["legacy_idx"],
                "cname": clean_val(r["customer_name"]),
                "customer_cname": clean_val(r.get("customer_cname")),
                "customer_address": clean_val(r.get("customer_address")),
                "customer_tel": clean_val(r.get("customer_tel")),
                "out_dt": clean_val(r["out_date"]),
                "po_no": clean_val(r["po_no"]),
                "part_no": clean_val(r["part_no"]),
                "mfg": clean_val(r["maker"]),
                "qty": int(r["qty"]) if r["qty"] else 0,
                "unit_price": float(r["unit_price"]) if r.get("unit_price") is not None else 0.0,
                "supply_amount": float(r["supply_amount"]) if r.get("supply_amount") is not None else 0.0,
                "tax_yn": clean_val(r.get("tax_yn")),
                "amount_vat": float(r["amount_vat"]) if r["amount_vat"] else 0.0,
                "overdue_days": int(r["overdue_days"]) if r["overdue_days"] is not None else 0,
                "pay_status": clean_val(r["pay_status"]),
                "contact": clean_val(r["contact"]),
                "due_date": clean_val(r["due_date"]),
                "sales": normalize_sales_rep(r["sales_rep"]),
                "color_code": int(r["gubun_color"])
            })
        return results
    except Exception as e:
        print(f"[ERROR] query_unpaid_list 에러: {e}")
        return []

# ========================================================
# 🏢 거래처 및 담당자 마스터 (CustomerFile & ContactFile) 모듈
# ========================================================
def query_customers(search_query: Optional[str] = None, limit: int = 30) -> List[Dict[str, Any]]:
    """거래처 마스터 및 담당자 자동완성 검색"""
    conditions = []
    params = []

    if search_query and search_query.strip():
        term = f"%{search_query.strip()}%"
        conditions.append("(c.Kname LIKE %s OR c.Cname LIKE %s OR ct.KCONTACT LIKE %s)")
        params.extend([term, term, term])

    where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    sql = f"""
        SELECT TOP ({limit})
            c.CID as cid,
            LTRIM(RTRIM(c.Kname)) as kname,
            LTRIM(RTRIM(c.Cname)) as cname,
            LTRIM(RTRIM(c.TEL)) as tel,
            LTRIM(RTRIM(c.FAX)) as fax,
            LTRIM(RTRIM(c.Address)) as address,
            LTRIM(RTRIM(c.Email)) as email,
            LTRIM(RTRIM(c.SALES)) as sales_rep,
            ct.KCONTACT as contact_name,
            ct.CTITLE as contact_title,
            ct.CHP as contact_mobile,
            ct.CTEL as contact_tel,
            ct.CEMAIL as contact_email
        FROM CustomerFile c
        LEFT JOIN (
            SELECT CID, KCONTACT, CTITLE, CHP, CTEL, CEMAIL,
                   ROW_NUMBER() OVER(PARTITION BY CID ORDER BY IDX ASC) as rn
            FROM ContactFile
        ) ct ON c.CID = ct.CID AND ct.rn = 1
        {where_clause}
        ORDER BY c.Kname ASC
    """

    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()

        results = []
        existing_names = set()

        for r in rows:
            kname = clean_val(r["kname"])
            cname = clean_val(r["cname"])
            contact = clean_val(r["contact_name"])
            title = clean_val(r["contact_title"])
            contact_display = f"{contact} {title}".strip() if contact else ""
            display_name = kname or cname

            if display_name:
                existing_names.add(display_name.lower())

            results.append({
                "cid": int(r["cid"]),
                "kname": kname,
                "cname": cname,
                "display_name": display_name,
                "tel": clean_val(r["tel"]) or clean_val(r["contact_tel"]),
                "fax": clean_val(r["fax"]),
                "address": clean_val(r["address"]),
                "email": clean_val(r["email"]) or clean_val(r["contact_email"]),
                "sales_rep": normalize_sales_rep(r["sales_rep"]),
                "contact_name": contact,
                "contact_title": title,
                "contact_display": contact_display,
                "mobile": clean_val(r["contact_mobile"])
            })

        # 2. CustomerFile에 미등록된 재고 계약사/거래처(DincomeFile.Remark e.g. TOWS, CH Global 등) 추가 매칭
        if search_query and len(results) < limit:
            term = f"%{search_query.strip()}%"
            cur.execute("""
                SELECT DISTINCT TOP 10
                    LTRIM(RTRIM(Remark)) as cust_name,
                    LTRIM(RTRIM(INPUT_PERSON)) as rep
                FROM DincomeFile
                WHERE Remark LIKE %s AND LEN(LTRIM(RTRIM(Remark))) BETWEEN 2 AND 50
            """, (term,))
            for dr in cur.fetchall():
                c_name = clean_val(dr["cust_name"])
                if c_name and c_name.lower() not in existing_names:
                    existing_names.add(c_name.lower())
                    results.append({
                        "cid": 0,
                        "kname": c_name,
                        "cname": c_name,
                        "display_name": c_name,
                        "tel": "",
                        "fax": "",
                        "address": "",
                        "email": "",
                        "sales_rep": normalize_sales_rep(dr["rep"]) or "",
                        "contact_name": "",
                        "contact_title": "",
                        "contact_display": "",
                        "mobile": ""
                    })
                    if len(results) >= limit:
                        break

        conn.close()
        return results
    except Exception as e:
        print(f"[ERROR] query_customers 에러: {e}")
        return []

# ========================================================
# 📊 매출 장부 및 다차원 실적 분석 (FrmSalesBKBL & FrmSalesGraph)
# ========================================================
def get_sales_analytics(year: str = "2026", month: Optional[str] = "all") -> Dict[str, Any]:
    """월별 수주/매출(Book & Bill), Top 고객사, 제조사 비중, 영업사원 실적 집계 (연간 누적 또는 특정 월 선택)"""
    import calendar
    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)

        start_date = f"{year}-01-01"
        end_date = f"{year}-12-31"

        # 1. 월별 Book & Bill 추이 (연간 전체 추이는 항상 계산)
        cur.execute("""
            SELECT 
                LEFT(CONVERT(VARCHAR, COALESCE(A.OUTDT, A.SDT), 23), 7) as yyyy_mm,
                SUM(CASE WHEN A.RESULT='OUT' THEN A.OutAmt ELSE 0 END) as billing_krw,
                SUM(CASE WHEN A.RESULT='PO' THEN A.OutAmt ELSE 0 END) as booking_krw,
                SUM(CASE WHEN A.RESULT='OUT' THEN COALESCE(A.MGN, 0) ELSE 0 END) as margin_krw,
                COUNT(CASE WHEN A.RESULT='OUT' THEN 1 END) as bill_cnt,
                COUNT(CASE WHEN A.RESULT='PO' THEN 1 END) as book_cnt
            FROM DReportFile A
            WHERE COALESCE(A.OUTDT, A.SDT) >= %s AND COALESCE(A.OUTDT, A.SDT) <= %s
            GROUP BY LEFT(CONVERT(VARCHAR, COALESCE(A.OUTDT, A.SDT), 23), 7)
            ORDER BY yyyy_mm ASC
        """, (start_date, end_date))
        monthly_raw = cur.fetchall()

        monthly_data = []
        total_billing_ytd = 0.0
        total_booking_ytd = 0.0
        total_margin_ytd = 0.0

        for r in monthly_raw:
            bill = float(r["billing_krw"] or 0.0)
            book = float(r["booking_krw"] or 0.0)
            mgn = float(r["margin_krw"] or 0.0)
            mgn_rate = (mgn / bill * 100) if bill > 0 else 0.0
            ym = clean_val(r["yyyy_mm"])
            if ym.startswith(year):
                total_billing_ytd += bill
                total_booking_ytd += book
                total_margin_ytd += mgn
            monthly_data.append({
                "month": ym,
                "billing": bill,
                "booking": book,
                "margin": mgn,
                "margin_rate": round(mgn_rate, 1),
                "bill_count": int(r["bill_cnt"] or 0),
                "book_count": int(r["book_cnt"] or 0)
            })

        # 특정 월 필터링 날짜 설정
        is_monthly = False
        selected_month_num = None
        filter_start = start_date
        filter_end = end_date

        if month and str(month).strip().lower() not in ("all", "ytd", "", "전체"):
            try:
                m_int = int(str(month).replace("월", "").strip())
                if 1 <= m_int <= 12:
                    last_day = calendar.monthrange(int(year), m_int)[1]
                    filter_start = f"{year}-{m_int:02d}-01"
                    filter_end = f"{year}-{m_int:02d}-{last_day:02d}"
                    is_monthly = True
                    selected_month_num = m_int
            except Exception as ex:
                print(f"[WARN] month parsing failed: {ex}")

        # 2. Top 10 고객사 (선택된 기간 기준)
        cur.execute("""
            SELECT TOP 10
                COALESCE(B.KNAME, B.CNAME, '기타') as customer_name,
                SUM(A.OutAmt) as total_billing,
                COUNT(*) as order_count
            FROM DReportFile A
            INNER JOIN CUSTOMERFILE B ON A.CUSTID = B.CID
            WHERE A.RESULT = 'OUT' AND A.OUTDT >= %s AND A.OUTDT <= %s
            GROUP BY COALESCE(B.KNAME, B.CNAME, '기타')
            ORDER BY total_billing DESC
        """, (filter_start, filter_end))
        top_cust_raw = cur.fetchall()
        top_customers = [
            {
                "customer_name": clean_val(r["customer_name"]),
                "billing": float(r["total_billing"] or 0.0),
                "order_count": int(r["order_count"] or 0)
            } for r in top_cust_raw
        ]

        # 3. Top 제조사 (Maker) (선택된 기간 기준)
        cur.execute("""
            SELECT TOP 8
                LTRIM(RTRIM(A.Mfg)) as maker,
                SUM(A.OutAmt) as total_billing,
                COUNT(*) as item_count
            FROM DReportFile A
            WHERE A.RESULT = 'OUT' AND A.OUTDT >= %s AND A.OUTDT <= %s AND A.Mfg IS NOT NULL AND LTRIM(RTRIM(A.Mfg)) <> ''
            GROUP BY LTRIM(RTRIM(A.Mfg))
            ORDER BY total_billing DESC
        """, (filter_start, filter_end))
        top_maker_raw = cur.fetchall()
        top_makers = [
            {
                "maker": clean_val(r["maker"]),
                "billing": float(r["total_billing"] or 0.0),
                "item_count": int(r["item_count"] or 0)
            } for r in top_maker_raw
        ]

        # 4. 영업 담당자별 실적 (선택된 기간 기준)
        cur.execute("""
            SELECT 
                LTRIM(RTRIM(A.Sales)) as sales_rep,
                SUM(A.OutAmt) as total_billing,
                SUM(COALESCE(A.MGN, 0)) as total_margin,
                COUNT(*) as shipment_count
            FROM DReportFile A
            WHERE A.RESULT = 'OUT' AND A.OUTDT >= %s AND A.OUTDT <= %s AND A.Sales IS NOT NULL AND LTRIM(RTRIM(A.Sales)) <> ''
            GROUP BY LTRIM(RTRIM(A.Sales))
            ORDER BY total_billing DESC
        """, (filter_start, filter_end))
        sales_raw = cur.fetchall()
        rep_agg: Dict[str, Dict[str, Any]] = {}
        for r in sales_raw:
            rep_name = normalize_sales_rep(r["sales_rep"]) or "BSK"
            slot = rep_agg.setdefault(rep_name, {"sales_rep": rep_name, "billing": 0.0, "margin": 0.0, "shipment_count": 0})
            slot["billing"] += float(r["total_billing"] or 0.0)
            slot["margin"] += float(r["total_margin"] or 0.0)
            slot["shipment_count"] += int(r["shipment_count"] or 0)
        sales_reps = []
        for slot in sorted(rep_agg.values(), key=lambda x: x["billing"], reverse=True):
            slot["margin_rate"] = round((slot["margin"] / (slot["billing"] or 1.0)) * 100, 1)
            sales_reps.append(slot)

        # 5. 💎 Commission(커미션) 실적 집계 (ShippingFile 기준, USD)
        comm_year_start = f"{year}-01-01"
        comm_year_end = f"{year}-12-31"
        cur.execute("""
            SELECT
                CONVERT(VARCHAR(7), s.SHIPDT, 120) as ym,
                COUNT(*) as cnt,
                SUM(ISNULL(s.ShipAmt, 0)) as ship_amt,
                SUM(ISNULL(s.CommAmt, 0)) as comm_amt,
                SUM(CASE WHEN LTRIM(RTRIM(ISNULL(s.BANKDT, ''))) <> '' OR LTRIM(RTRIM(ISNULL(s.CommDT, ''))) <> '' THEN ISNULL(s.CommAmt, 0) ELSE 0 END) as paid_amt,
                SUM(CASE WHEN LTRIM(RTRIM(ISNULL(s.BANKDT, ''))) = '' AND LTRIM(RTRIM(ISNULL(s.CommDT, ''))) = '' THEN 1 ELSE 0 END) as unpaid_cnt
            FROM ShippingFile s
            WHERE s.SHIPDT >= %s AND s.SHIPDT <= %s AND ISNULL(s.CommAmt, 0) > 0
            GROUP BY CONVERT(VARCHAR(7), s.SHIPDT, 120)
            ORDER BY ym ASC
        """, (comm_year_start, comm_year_end))
        comm_monthly = []
        for r in cur.fetchall():
            c_amt = float(r["comm_amt"] or 0.0)
            p_amt = float(r["paid_amt"] or 0.0)
            comm_monthly.append({
                "month": clean_val(r["ym"]),
                "count": int(r["cnt"] or 0),
                "ship_amt": round(float(r["ship_amt"] or 0.0), 2),
                "comm_amt": round(c_amt, 2),
                "paid_amt": round(p_amt, 2),
                "unpaid_amt": round(max(0.0, c_amt - p_amt), 2),
                "unpaid_count": int(r["unpaid_cnt"] or 0)
            })

        cur.execute("""
            SELECT
                LTRIM(RTRIM(ISNULL(m.Mfg, ''))) as maker,
                LTRIM(RTRIM(ISNULL(m.Sales, ''))) as sales_rep,
                COALESCE(c.CNAME, c.KNAME, m.RealCust, '기타') as customer,
                ISNULL(s.ShipAmt, 0) as ship_amt,
                ISNULL(s.CommAmt, 0) as comm_amt,
                ISNULL(s.Rate, 0) as comm_rate,
                CASE WHEN LTRIM(RTRIM(ISNULL(s.BANKDT, ''))) <> '' OR LTRIM(RTRIM(ISNULL(s.CommDT, ''))) <> '' THEN 1 ELSE 0 END as is_paid
            FROM ShippingFile s
            LEFT JOIN CustomerFile c ON s.Custid = c.CID
            LEFT JOIN MainSubFile sub ON s.Idxsub = sub.IDX
            LEFT JOIN MainFile m ON sub.Midx = m.IDX
            WHERE s.SHIPDT >= %s AND s.SHIPDT <= %s AND ISNULL(s.CommAmt, 0) > 0
        """, (filter_start, filter_end))
        comm_rows = cur.fetchall()

        comm_total_amt = 0.0
        comm_paid_amt = 0.0
        comm_unpaid_amt = 0.0
        comm_ship_amt = 0.0
        comm_unpaid_cnt = 0
        maker_comm_map: Dict[str, Dict[str, Any]] = {}
        sales_comm_map: Dict[str, Dict[str, Any]] = {}
        cust_comm_map: Dict[str, Dict[str, Any]] = {}

        for r in comm_rows:
            c_amt = float(r["comm_amt"] or 0.0)
            s_amt = float(r["ship_amt"] or 0.0)
            is_paid = bool(r["is_paid"])
            comm_total_amt += c_amt
            comm_ship_amt += s_amt
            if is_paid:
                comm_paid_amt += c_amt
            else:
                comm_unpaid_amt += c_amt
                comm_unpaid_cnt += 1

            mk = clean_val(r["maker"]) or "OTHERS"
            mslot = maker_comm_map.setdefault(mk, {"maker": mk, "comm_amt": 0.0, "ship_amt": 0.0, "unpaid_amt": 0.0, "count": 0})
            mslot["comm_amt"] += c_amt
            mslot["ship_amt"] += s_amt
            if not is_paid:
                mslot["unpaid_amt"] += c_amt
            mslot["count"] += 1

            sr = normalize_sales_rep(r["sales_rep"]) or "BSK"
            sslot = sales_comm_map.setdefault(sr, {"sales_rep": sr, "comm_amt": 0.0, "ship_amt": 0.0, "unpaid_amt": 0.0, "count": 0})
            sslot["comm_amt"] += c_amt
            sslot["ship_amt"] += s_amt
            if not is_paid:
                sslot["unpaid_amt"] += c_amt
            sslot["count"] += 1

            cu = clean_val(r["customer"]) or "기타"
            cslot = cust_comm_map.setdefault(cu, {"customer": cu, "comm_amt": 0.0, "ship_amt": 0.0, "count": 0})
            cslot["comm_amt"] += c_amt
            cslot["ship_amt"] += s_amt
            cslot["count"] += 1

        commission_summary = {
            "total_comm_amt": round(comm_total_amt, 2),
            "paid_comm_amt": round(comm_paid_amt, 2),
            "unpaid_comm_amt": round(comm_unpaid_amt, 2),
            "total_ship_amt": round(comm_ship_amt, 2),
            "comm_count": len(comm_rows),
            "unpaid_count": comm_unpaid_cnt,
            "avg_rate": round((comm_total_amt / comm_ship_amt * 100), 2) if comm_ship_amt > 0 else 0.0,
            "monthly": comm_monthly,
            "by_maker": sorted(
                [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in m.items()} for m in maker_comm_map.values()],
                key=lambda x: x["comm_amt"], reverse=True
            )[:12],
            "by_sales": sorted(
                [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in s.items()} for s in sales_comm_map.values()],
                key=lambda x: x["comm_amt"], reverse=True
            ),
            "by_customer": sorted(
                [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in c.items()} for c in cust_comm_map.values()],
                key=lambda x: x["comm_amt"], reverse=True
            )[:10]
        }

        conn.close()

        # 선택된 기간의 실적 수치 계산
        if is_monthly and selected_month_num:
            ym_key = f"{year}-{selected_month_num:02d}"
            target_m = next((m for m in monthly_data if m["month"] == ym_key), None)
            if target_m:
                period_billing = target_m["billing"]
                period_booking = target_m["booking"]
                period_margin = target_m["margin"]
                period_margin_rate = target_m["margin_rate"]
                period_shipment_count = target_m["bill_count"]
            else:
                period_billing = sum(s["billing"] for s in sales_reps)
                period_booking = 0.0
                period_margin = sum(s["margin"] for s in sales_reps)
                period_margin_rate = round((period_margin / period_billing * 100), 1) if period_billing > 0 else 0.0
                period_shipment_count = sum(s["shipment_count"] for s in sales_reps)
        else:
            period_billing = total_billing_ytd
            period_booking = total_booking_ytd
            period_margin = total_margin_ytd
            period_margin_rate = (total_margin_ytd / total_billing_ytd * 100) if total_billing_ytd > 0 else 0.0
            period_shipment_count = sum(m["bill_count"] for m in monthly_data if m["month"].startswith(year))

        overall_margin_rate = (total_margin_ytd / total_billing_ytd * 100) if total_billing_ytd > 0 else 0.0

        return {
            "year": year,
            "month": str(selected_month_num) if is_monthly else "all",
            "is_monthly": is_monthly,
            "selected_month_num": selected_month_num,
            "period_billing": period_billing,
            "period_booking": period_booking,
            "period_margin": period_margin,
            "period_margin_rate": round(period_margin_rate, 1),
            "period_shipment_count": period_shipment_count,
            "total_billing_ytd": total_billing_ytd,
            "total_booking_ytd": total_booking_ytd,
            "total_margin_ytd": total_margin_ytd,
            "overall_margin_rate": round(overall_margin_rate, 1),
            "monthly": monthly_data,
            "top_customers": top_customers,
            "top_makers": top_makers,
            "sales_reps": sales_reps,
            "commission": commission_summary
        }
    except Exception as e:
        print(f"[ERROR] get_sales_analytics 에러: {e}")
        return {
            "year": year,
            "total_billing_ytd": 0.0,
            "total_booking_ytd": 0.0,
            "total_margin_ytd": 0.0,
            "overall_margin_rate": 0.0,
            "monthly": [],
            "top_customers": [],
            "top_makers": [],
            "sales_reps": []
        }

# ========================================================
# 📝 영업 메모 및 활동 일지 (T_SalesReport_Memo) 모듈
# ========================================================
def query_sales_memos(sales_rep: Optional[str] = None, limit: int = 40) -> List[Dict[str, Any]]:
    """영업 담당자별 활동 일지 및 방문 메모 조회"""
    conditions = []
    params = []
    if sales_rep and sales_rep != 'ALL':
        conditions.append("LTRIM(RTRIM(SALES)) = %s")
        params.append(sales_rep.strip())

    where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    sql = f"""
        SELECT TOP ({limit})
            LTRIM(RTRIM(SALES)) as sales_rep,
            INPUT_DT as input_date,
            UPDATE_DT as update_date,
            MEMO as memo
        FROM T_SalesReport_Memo
        {where_clause}
        ORDER BY INPUT_DT DESC
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        conn.close()

        results = []
        for r in rows:
            results.append({
                "sales_rep": normalize_sales_rep(r["sales_rep"]),
                "input_date": clean_val(r["input_date"]),
                "update_date": clean_val(r["update_date"]),
                "memo": clean_val(r["memo"])
            })
        return results
    except Exception as e:
        print(f"[ERROR] query_sales_memos 에러: {e}")
        return []

def insert_sales_memo(sales_rep: str, memo: str, input_date: Optional[str] = None) -> bool:
    """신규 영업 활동 메모 등록"""
    today_str = input_date or datetime.date.today().strftime("%Y-%m-%d")
    sql = """
        INSERT INTO T_SalesReport_Memo (SALES, INPUT_DT, UPDATE_DT, MEMO)
        VALUES (%s, %s, %s, %s)
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(sql, (sales_rep, today_str, today_str, memo))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"[ERROR] insert_sales_memo 에러: {e}")
        return False

# ========================================================
# 🚢 발주(PO) 및 입고 예정(ETA) 조회 모듈 (DPOFile 연동)
# ========================================================
def query_purchase_orders(
    part_no: Optional[str] = None,
    po_no: Optional[str] = None,
    maker: Optional[str] = None,
    status: Optional[str] = None,
    sales_rep: Optional[str] = None,
    search_query: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    limit: int = 150
) -> List[Dict[str, Any]]:
    """발주 및 입고예정(PO/ETA) 상세 조회"""
    conditions = []
    params = []

    if status and status.strip() and status != 'ALL':
        conditions.append("LTRIM(RTRIM(d.Result)) = %s")
        params.append(status.strip())
    if part_no and part_no.strip():
        conditions.append("d.Partno LIKE %s")
        params.append(f"%{part_no.strip()}%")
    if po_no and po_no.strip():
        conditions.append("d.PONO LIKE %s")
        params.append(f"%{po_no.strip()}%")
    if maker and maker.strip():
        conditions.append("LTRIM(RTRIM(d.Mfg)) = %s")
        params.append(maker.strip())
    if sales_rep and sales_rep.strip() and sales_rep != 'ALL':
        conditions.append("LTRIM(RTRIM(d.Sales)) = %s")
        params.append(sales_rep.strip())
    if start_date:
        conditions.append("d.PODT >= %s")
        params.append(start_date)
    if end_date:
        conditions.append("d.PODT <= %s")
        params.append(f"{end_date} 23:59:59")
    if search_query and search_query.strip():
        term = f"%{search_query.strip()}%"
        conditions.append("(d.Partno LIKE %s OR d.PONO LIKE %s OR d.Mfg LIKE %s OR c.Kname LIKE %s OR d.RealCust LIKE %s OR d.Sales LIKE %s OR d.Remark LIKE %s)")
        params.extend([term, term, term, term, term, term, term])

    where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    sql = f"""
        SELECT TOP ({limit})
            d.idx,
            d.PODT as po_dt,
            d.PONO as po_no,
            d.Partno as part_no,
            d.Mfg as maker,
            d.Qty as qty,
            d.UP as unit_price,
            d.Amount as amount,
            d.SL_UNIT as currency,
            d.SL_UP as foreign_up,
            d.SL_AMT as foreign_amount,
            d.CRD as eta_date,
            d.Result as status,
            d.Sales as sales_rep,
            d.Remark as remark,
            d.RealCust as real_cust,
            d.END_CUST as end_cust,
            d.PAY_TERMS as pay_terms,
            d.INRATE as inrate,
            c.Kname as supplier_name,
            c.Cname as supplier_cname
        FROM DPOFile d
        LEFT JOIN CustomerFile c ON d.Custid = c.CID
        {where_clause}
        ORDER BY d.PODT DESC, d.idx DESC
    """

    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        conn.close()

        results = []
        for r in rows:
            st = clean_val(r["status"])
            results.append({
                "idx": r["idx"],
                "po_dt": clean_val(r["po_dt"]),
                "po_no": clean_val(r["po_no"]),
                "part_no": clean_val(r["part_no"]),
                "maker": clean_val(r["maker"]),
                "qty": int(r["qty"]) if r["qty"] is not None else 0,
                "unit_price": float(r["unit_price"]) if r["unit_price"] is not None else 0.0,
                "amount": float(r["amount"]) if r["amount"] is not None else 0.0,
                "currency": clean_val(r.get("currency")) or "KRW",
                "foreign_up": float(r["foreign_up"]) if r.get("foreign_up") is not None else 0.0,
                "foreign_amount": float(r["foreign_amount"]) if r.get("foreign_amount") is not None else 0.0,
                "eta_date": clean_val(r.get("eta_date")),
                "status": st,
                "status_label": "입고대기(예정)" if st == "PO" else ("입고완료" if st == "IN" else ("취소" if st == "CNL" else st)),
                "sales_rep": normalize_sales_rep(r["sales_rep"]),
                "supplier_name": clean_val(r.get("supplier_name")),
                "supplier_cname": clean_val(r.get("supplier_cname")),
                "real_cust": clean_val(r.get("real_cust")),
                "end_cust": clean_val(r.get("end_cust")),
                "remark": clean_val(r.get("remark")),
                "pay_terms": clean_val(r.get("pay_terms")),
                "inrate": float(r["inrate"]) if r.get("inrate") is not None else 0.0
            })
        return results
    except Exception as e:
        print(f"[ERROR] query_purchase_orders 에러: {e}")
        return []

_CACHED_PO_SUMMARY = {"data": None, "updated_at": 0.0}

def get_purchase_orders_summary() -> Dict[str, Any]:
    """발주/입고예정 종합 요약 지표 (30초 TTL 캐싱 적용)"""
    now = time.time()
    if _CACHED_PO_SUMMARY["data"] is not None and (now - _CACHED_PO_SUMMARY["updated_at"] < 30.0):
        cached = dict(_CACHED_PO_SUMMARY["data"])
        cached["recent_pending_orders"] = list(cached.get("recent_pending_orders", []))
        return cached
    sql = """
        SELECT 
            COUNT(*) as total_count,
            SUM(CASE WHEN LTRIM(RTRIM(Result)) = 'PO' THEN 1 ELSE 0 END) as pending_count,
            SUM(CASE WHEN LTRIM(RTRIM(Result)) = 'PO' THEN Qty ELSE 0 END) as pending_qty,
            SUM(CASE WHEN LTRIM(RTRIM(Result)) = 'IN' THEN 1 ELSE 0 END) as arrived_count,
            SUM(CASE WHEN LTRIM(RTRIM(Result)) = 'CNL' THEN 1 ELSE 0 END) as cnl_count
        FROM DPOFile
    """
    sql_recent = """
        SELECT TOP 10
            d.idx,
            d.PODT as po_dt,
            d.PONO as po_no,
            d.Partno as part_no,
            d.Mfg as maker,
            d.Qty as qty,
            d.UP as unit_price,
            d.CRD as eta_date,
            d.Sales as sales_rep,
            d.RealCust as real_cust,
            c.Kname as supplier_name
        FROM DPOFile d
        LEFT JOIN CustomerFile c ON d.Custid = c.CID
        WHERE LTRIM(RTRIM(d.Result)) = 'PO'
        ORDER BY d.PODT DESC, d.idx DESC
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)
        cur.execute(sql)
        row = cur.fetchone() or {}

        cur.execute(sql_recent)
        recent_rows = cur.fetchall() or []
        conn.close()

        recent = []
        for r in recent_rows:
            recent.append({
                "idx": r["idx"],
                "po_dt": clean_val(r["po_dt"]),
                "po_no": clean_val(r["po_no"]),
                "part_no": clean_val(r["part_no"]),
                "maker": clean_val(r["maker"]),
                "qty": int(r["qty"]) if r["qty"] is not None else 0,
                "unit_price": float(r["unit_price"]) if r["unit_price"] is not None else 0.0,
                "eta_date": clean_val(r.get("eta_date")),
                "sales_rep": normalize_sales_rep(r["sales_rep"]),
                "real_cust": clean_val(r.get("real_cust")),
                "supplier_name": clean_val(r.get("supplier_name"))
            })

        result = {
            "total_count": int(row.get("total_count") or 0),
            "pending_count": int(row.get("pending_count") or 0),
            "pending_qty": int(row.get("pending_qty") or 0),
            "arrived_count": int(row.get("arrived_count") or 0),
            "cnl_count": int(row.get("cnl_count") or 0),
            "recent_pending_orders": recent
        }
        _CACHED_PO_SUMMARY["data"] = result
        _CACHED_PO_SUMMARY["updated_at"] = now
        out = dict(result)
        out["recent_pending_orders"] = list(recent)
        return out
    except Exception as e:
        print(f"[ERROR] get_purchase_orders_summary 에러: {e}")
        return {
            "total_count": 0,
            "pending_count": 0,
            "pending_qty": 0,
            "arrived_count": 0,
            "cnl_count": 0,
            "recent_pending_orders": []
        }

# ========================================================
# 📈 품목별 과거 매입·판매·견적 단가 이력 조회 모듈
# ========================================================
def get_part_price_history(part_no: str) -> Dict[str, Any]:
    """품목별 매입(DincomeFile), 판매(DReportFile), 견적(QuotationFile), 발주(DPOFile) 통합 단가 이력 추적"""
    p_clean = part_no.strip() if part_no else ""
    if not p_clean:
        return {"part_no": "", "summary": {}, "purchases": [], "sales": [], "quotations": [], "purchase_orders": []}

    p_term = f"%{p_clean}%"

    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)

        # 1. 매입 이력 (DincomeFile)
        cur.execute("""
            SELECT TOP 50
                IDX as idx,
                INDT as in_date,
                INVOICENO as invoice_no,
                PARTNO as part_no,
                MFG as maker,
                INQTY as qty,
                Slup as sl_up,
                SlAmt as sl_amt,
                InRate as in_rate,
                Wup as w_up,
                WAmt as w_amt,
                Remark as remark
            FROM DincomeFile
            WHERE PARTNO LIKE %s
            ORDER BY INDT DESC, IDX DESC
        """, (p_term,))
        income_rows = cur.fetchall() or []

        # 2. 판매 및 마진 이력 (DReportFile + CustomerFile)
        cur.execute("""
            SELECT TOP 50
                r.IDX as idx,
                r.OUTDT as out_date,
                r.Partno as part_no,
                r.Mfg as maker,
                r.Qty as qty,
                r.InUP as in_up,
                r.OutUP as out_up,
                r.OutAmt as out_amt,
                r.MGN as mgn,
                r.US_MGN as us_mgn,
                r.Sales as sales_rep,
                c.Kname as customer_name,
                c.Cname as customer_cname,
                r.Remark as remark
            FROM DReportFile r
            LEFT JOIN CustomerFile c ON r.Custid = c.CID
            WHERE r.Partno LIKE %s
            ORDER BY r.OUTDT DESC, r.IDX DESC
        """, (p_term,))
        report_rows = cur.fetchall() or []

        # 3. 견적 이력 (QuotationFile)
        cur.execute("""
            SELECT TOP 50
                IDX as idx,
                QuoteDT as quote_date,
                QuoteNo as quote_no,
                MFG as maker,
                CNAME as customer_name,
                Sales as sales_rep,
                PartNo as part_no,
                QTY_INT as qty,
                QUnit as qunit,
                QP as qp,
                Amount as amount,
                REMARK as remark
            FROM QuotationFile
            WHERE PartNo LIKE %s
            ORDER BY QuoteDT DESC, IDX DESC
        """, (p_term,))
        quote_rows = cur.fetchall() or []

        # 4. 발주 이력 (DPOFile)
        cur.execute("""
            SELECT TOP 30
                d.idx,
                d.PODT as po_date,
                d.PONO as po_no,
                d.Partno as part_no,
                d.Mfg as maker,
                d.Qty as qty,
                d.UP as unit_price,
                d.Amount as amount,
                d.SL_UNIT as currency,
                d.CRD as eta_date,
                d.Result as status,
                d.Sales as sales_rep,
                d.Remark as remark,
                d.RealCust as real_cust,
                c.Kname as supplier_name
            FROM DPOFile d
            LEFT JOIN CustomerFile c ON d.Custid = c.CID
            WHERE d.Partno LIKE %s
            ORDER BY d.PODT DESC, d.idx DESC
        """, (p_term,))
        po_rows = cur.fetchall() or []

        conn.close()

        # 정제 및 파싱
        purchases = []
        total_in_qty = 0
        for r in income_rows:
            qty = int(r["qty"]) if r["qty"] is not None else 0
            total_in_qty += qty
            purchases.append({
                "idx": r["idx"],
                "in_date": clean_val(r["in_date"]),
                "invoice_no": clean_val(r["invoice_no"]),
                "part_no": clean_val(r["part_no"]),
                "maker": clean_val(r["maker"]),
                "qty": qty,
                "sl_up": float(r["sl_up"]) if r["sl_up"] is not None else 0.0,
                "sl_amt": float(r["sl_amt"]) if r["sl_amt"] is not None else 0.0,
                "in_rate": float(r["in_rate"]) if r["in_rate"] is not None else 0.0,
                "w_up": float(r["w_up"]) if r["w_up"] is not None else 0.0,
                "w_amt": float(r["w_amt"]) if r["w_amt"] is not None else 0.0,
                "remark": clean_val(r["remark"])
            })

        sales = []
        total_out_qty = 0
        margin_rates = []
        for r in report_rows:
            qty = int(r["qty"]) if r["qty"] is not None else 0
            total_out_qty += qty
            out_amt = float(r["out_amt"]) if r["out_amt"] is not None else 0.0
            mgn = float(r["mgn"]) if r["mgn"] is not None else 0.0
            mgn_rate = round((mgn / out_amt * 100), 2) if out_amt > 0 else 0.0
            margin_rates.append(mgn_rate)
            sales.append({
                "idx": r["idx"],
                "out_date": clean_val(r["out_date"]),
                "part_no": clean_val(r["part_no"]),
                "maker": clean_val(r["maker"]),
                "qty": qty,
                "in_up": float(r["in_up"]) if r["in_up"] is not None else 0.0,
                "out_up": float(r["out_up"]) if r["out_up"] is not None else 0.0,
                "out_amt": out_amt,
                "mgn": mgn,
                "mgn_rate": mgn_rate,
                "sales_rep": normalize_sales_rep(r["sales_rep"]),
                "customer_name": clean_val(r.get("customer_name")) or clean_val(r.get("customer_cname")),
                "remark": clean_val(r["remark"])
            })

        quotations = []
        for r in quote_rows:
            quotations.append({
                "idx": r["idx"],
                "quote_date": clean_val(r["quote_date"]),
                "quote_no": clean_val(r["quote_no"]),
                "maker": clean_val(r["maker"]),
                "customer_name": clean_val(r["customer_name"]),
                "sales_rep": normalize_sales_rep(r["sales_rep"]),
                "part_no": clean_val(r["part_no"]),
                "qty": int(r["qty"]) if r["qty"] is not None else 0,
                "qunit": clean_val(r["qunit"]),
                "qp": float(r["qp"]) if r["qp"] is not None else 0.0,
                "amount": float(r["amount"]) if r["amount"] is not None else 0.0,
                "remark": clean_val(r["remark"])
            })

        purchase_orders = []
        pending_po_qty = 0
        for r in po_rows:
            st = clean_val(r["status"])
            qty = int(r["qty"]) if r["qty"] is not None else 0
            if st == "PO":
                pending_po_qty += qty
            purchase_orders.append({
                "idx": r["idx"],
                "po_date": clean_val(r["po_date"]),
                "po_no": clean_val(r["po_no"]),
                "part_no": clean_val(r["part_no"]),
                "maker": clean_val(r["maker"]),
                "qty": qty,
                "unit_price": float(r["unit_price"]) if r["unit_price"] is not None else 0.0,
                "amount": float(r["amount"]) if r["amount"] is not None else 0.0,
                "currency": clean_val(r.get("currency")) or "KRW",
                "eta_date": clean_val(r.get("eta_date")),
                "status": st,
                "status_label": "입고대기(예정)" if st == "PO" else ("입고완료" if st == "IN" else ("취소" if st == "CNL" else st)),
                "sales_rep": normalize_sales_rep(r["sales_rep"]),
                "real_cust": clean_val(r.get("real_cust")),
                "supplier_name": clean_val(r.get("supplier_name")),
                "remark": clean_val(r["remark"])
            })

        # 요약 데이터 생성
        latest_purchase = purchases[0] if purchases else None
        latest_sale = sales[0] if sales else None
        avg_margin = round(sum(margin_rates) / len(margin_rates), 1) if margin_rates else 0.0

        return {
            "part_no": p_clean,
            "summary": {
                "latest_purchase_usd": latest_purchase["sl_up"] if latest_purchase else 0.0,
                "latest_purchase_krw": latest_purchase["w_up"] if latest_purchase else 0.0,
                "latest_purchase_date": latest_purchase["in_date"] if latest_purchase else "-",
                "latest_sale_price": latest_sale["out_up"] if latest_sale else 0.0,
                "latest_sale_date": latest_sale["out_date"] if latest_sale else "-",
                "latest_margin_rate": latest_sale["mgn_rate"] if latest_sale else 0.0,
                "avg_margin_rate": avg_margin,
                "total_purchased_qty": total_in_qty,
                "total_sold_qty": total_out_qty,
                "pending_po_qty": pending_po_qty,
                "purchase_count": len(purchases),
                "sale_count": len(sales),
                "quote_count": len(quotations),
                "po_count": len(purchase_orders)
            },
            "purchases": purchases,
            "sales": sales,
            "quotations": quotations,
            "purchase_orders": purchase_orders
        }
    except Exception as e:
        print(f"[ERROR] get_part_price_history 에러: {e}")
        return {"part_no": p_clean, "summary": {}, "purchases": [], "sales": [], "quotations": [], "purchase_orders": []}

# ========================================================
# 🚚 세일즈 마스터 [Sales Daily Report - FrmShippedInfo] 공식 출하 원장 모듈
# ========================================================
_CACHED_SHIPPED_FILTERS = {"makers": [], "supplies": [], "updated_at": 0}

def get_shipped_info_filters() -> Dict[str, Any]:
    """출하 원장의 고유 제조사(MFG) 및 공급사(SUPPLY) 목록 반환 (캐싱 적용)"""
    global _CACHED_SHIPPED_FILTERS
    now = time.time()
    if _CACHED_SHIPPED_FILTERS["makers"] and (now - _CACHED_SHIPPED_FILTERS["updated_at"] < 3600):
        return _CACHED_SHIPPED_FILTERS

    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)

        cur.execute("""
            SELECT DISTINCT LTRIM(RTRIM(m.Mfg)) as maker
            FROM ShippingFile s
            LEFT JOIN MainSubFile sub ON s.Idxsub = sub.IDX
            LEFT JOIN MainFile m ON sub.Midx = m.IDX
            WHERE m.Mfg IS NOT NULL AND LTRIM(RTRIM(m.Mfg)) <> ''
            ORDER BY maker ASC
        """)
        makers = [clean_val(r['maker']) for r in cur.fetchall() if clean_val(r['maker'])]

        cur.execute("""
            SELECT DISTINCT LTRIM(RTRIM(m.SUPPLY)) as supply
            FROM ShippingFile s
            LEFT JOIN MainSubFile sub ON s.Idxsub = sub.IDX
            LEFT JOIN MainFile m ON sub.Midx = m.IDX
            WHERE m.SUPPLY IS NOT NULL AND LTRIM(RTRIM(m.SUPPLY)) <> ''
            ORDER BY supply ASC
        """)
        supplies = [clean_val(r['supply']) for r in cur.fetchall() if clean_val(r['supply'])]

        conn.close()

        _CACHED_SHIPPED_FILTERS = {
            "makers": [m for m in makers if m not in ('.', '0', '-')],
            "supplies": [s for s in supplies if s not in ('.', '0', '-')],
            "updated_at": now
        }
        return _CACHED_SHIPPED_FILTERS
    except Exception as e:
        print(f"[WARN] MS-SQL 출하 원장 필터 조회 실패: {e}")
        return {
            "makers": ["ISSI", "ESMT", "SMI", "LUMISSIL", "Giantec", "GigaDevice", "OTHERS"],
            "supplies": ["ISSI", "ESMT", "SMI", "LUMISSIL", "BSHK", "BSTW", "OTHERS"],
            "updated_at": now
        }

def query_shipped_info(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    mfg: Optional[str] = None,
    supply: Optional[str] = None,
    search_query: Optional[str] = None,
    biz_type: Optional[str] = None,
    comm_status: Optional[str] = None,
    limit: int = 1000
) -> List[Dict[str, Any]]:
    """
    세일즈 마스터 [Sales Daily Report - FrmShippedInfo] 공식 출하 원장 조회
    ShippingFile + CustomerFile + MainSubFile + MainFile 조인 (Commission/Domestic 구분 포함)
    """
    conditions = []
    params = []

    if start_date:
        conditions.append("s.SHIPDT >= %s")
        params.append(start_date)
    if end_date:
        conditions.append("s.SHIPDT <= %s")
        params.append(f"{end_date} 23:59:59")
    if mfg and mfg.strip() and mfg.strip().upper() != 'ALL':
        conditions.append("LTRIM(RTRIM(m.Mfg)) = %s")
        params.append(mfg.strip())
    if supply and supply.strip() and supply.strip().upper() != 'ALL':
        conditions.append("LTRIM(RTRIM(m.SUPPLY)) = %s")
        params.append(supply.strip())
    if biz_type and biz_type.strip().upper() != 'ALL':
        bt = biz_type.strip().upper()
        if bt == 'COMMISSION':
            conditions.append("ISNULL(s.CommAmt, 0) > 0")
        elif bt == 'DOMESTIC':
            conditions.append("(ISNULL(s.CommAmt, 0) = 0 AND LTRIM(RTRIM(ISNULL(s.Result, ''))) = 'IN')")
        elif bt == 'DIRECT':
            conditions.append("(ISNULL(s.CommAmt, 0) = 0 AND LTRIM(RTRIM(ISNULL(s.Result, ''))) <> 'IN')")
    if comm_status and comm_status.strip().upper() != 'ALL':
        cs = comm_status.strip().upper()
        if cs == 'UNPAID':
            conditions.append("(ISNULL(s.CommAmt, 0) > 0 AND LTRIM(RTRIM(ISNULL(s.BANKDT, ''))) = '' AND LTRIM(RTRIM(ISNULL(s.CommDT, ''))) = '')")
        elif cs == 'PAID':
            conditions.append("(ISNULL(s.CommAmt, 0) > 0 AND (LTRIM(RTRIM(ISNULL(s.BANKDT, ''))) <> '' OR LTRIM(RTRIM(ISNULL(s.CommDT, ''))) <> ''))")
    if search_query and search_query.strip():
        term = f"%{search_query.strip()}%"
        conditions.append("""(
            s.PartNo LIKE %s OR 
            s.PoNo LIKE %s OR 
            c.CNAME LIKE %s OR 
            c.KNAME LIKE %s OR 
            sub.RealCust LIKE %s OR 
            m.RealCust LIKE %s OR 
            sub.APP LIKE %s OR 
            m.App LIKE %s OR
            s.INVOICENO LIKE %s OR
            m.FileNo LIKE %s OR
            m.Sales LIKE %s
        )""")
        params.extend([term] * 11)

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    query = f"""
        SELECT TOP {limit}
            s.IDX as idx,
            COALESCE(c.CNAME, c.KNAME, '기타') as customer,
            COALESCE(sub.RealCust, m.RealCust, '') as real_cust,
            s.PoNo as po_no,
            s.PartNo as part_no,
            CONVERT(VARCHAR, s.SHIPDT, 23) as ship_date,
            s.SHIPQTY as ship_qty,
            s.Slup as sl_up,
            s.Netup as net_up,
            s.ShipAmt as ship_amt,
            COALESCE(sub.APP, m.App, '') as app,
            m.Mfg as maker,
            m.SUPPLY as supply,
            s.INVOICENO as invoice_no,
            s.AWBNO as awb_no,
            s.Lotno as lot_no,
            LTRIM(RTRIM(ISNULL(s.Result, ''))) as ship_result,
            ISNULL(s.Rate, 0) as comm_rate,
            ISNULL(s.CommAmt, 0) as comm_amt,
            LTRIM(RTRIM(ISNULL(s.CommDT, ''))) as comm_dt,
            LTRIM(RTRIM(ISNULL(s.BANKDT, ''))) as bank_dt,
            LTRIM(RTRIM(ISNULL(m.Sales, ''))) as sales_rep,
            LTRIM(RTRIM(ISNULL(m.FileNo, ''))) as file_no
        FROM ShippingFile s
        LEFT JOIN CustomerFile c ON s.Custid = c.CID
        LEFT JOIN MainSubFile sub ON s.Idxsub = sub.IDX
        LEFT JOIN MainFile m ON sub.Midx = m.IDX
        {where_clause}
        ORDER BY s.SHIPDT DESC, s.IDX DESC
    """

    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)
        cur.execute(query, tuple(params))
        rows = cur.fetchall()
        conn.close()

        results = []
        for r in rows:
            comm_amt = round(float(r["comm_amt"] or 0.0), 4)
            comm_rate = round(float(r["comm_rate"] or 0.0), 2)
            ship_res = clean_val(r["ship_result"]).upper()
            comm_dt = clean_val(r["comm_dt"])
            bank_dt = clean_val(r["bank_dt"])
            if comm_amt > 0:
                biz_t = "COMMISSION"
                c_status = "입금완료" if bank_dt else ("정산완료" if comm_dt else "미입금")
            elif ship_res == "IN":
                biz_t = "DOMESTIC"
                c_status = ""
            else:
                biz_t = "DIRECT"
                c_status = ""

            results.append({
                "idx": r["idx"],
                "customer": clean_val(r["customer"]),
                "real_cust": clean_val(r["real_cust"]),
                "po_no": clean_val(r["po_no"]),
                "part_no": clean_val(r["part_no"]),
                "ship_date": clean_val(r["ship_date"]),
                "ship_qty": int(r["ship_qty"] or 0),
                "sl_up": float(r["sl_up"] or 0.0),
                "net_up": float(r["net_up"] or 0.0),
                "ship_amt": round(float(r["ship_amt"] or 0.0), 2),
                "app": clean_val(r["app"]),
                "maker": clean_val(r["maker"]) or "OTHERS",
                "supply": clean_val(r["supply"]) or "OTHERS",
                "invoice_no": clean_val(r["invoice_no"]),
                "awb_no": clean_val(r["awb_no"]),
                "lot_no": clean_val(r["lot_no"]),
                "biz_type": biz_t,
                "ship_result": ship_res,
                "comm_rate": comm_rate,
                "comm_amt": round(comm_amt, 2),
                "comm_dt": comm_dt,
                "bank_dt": bank_dt,
                "comm_status": c_status,
                "sales_rep": normalize_sales_rep(r["sales_rep"]),
                "file_no": clean_val(r["file_no"])
            })
        return results
    except Exception as e:
        print(f"[ERROR] query_shipped_info 에러: {e}")
        return []


def query_unpaid_commissions(
    status: str = "UNPAID",
    maker: Optional[str] = None,
    sales_rep: Optional[str] = None,
    search_query: Optional[str] = None,
    min_date: str = "2024-01-01",
    limit: int = 1000
) -> List[Dict[str, Any]]:
    """
    💎 미수 커미션(해외 공급사/제조사로부터 수취 예정 커미션) 전용 조회
    ShippingFile에서 CommAmt > 0 이며 미입금/정산대기 건 조회
    """
    rows = query_shipped_info(
        start_date=min_date,
        mfg=maker if (maker and maker != "ALL") else None,
        search_query=search_query,
        biz_type="COMMISSION",
        comm_status=status if (status and status.upper() != "ALL") else None,
        limit=limit
    )
    today = datetime.date.today()
    out = []
    for r in rows:
        if sales_rep and sales_rep != "ALL":
            if (r.get("sales_rep") or "").upper() != sales_rep.strip().upper():
                continue
        sd = r.get("ship_date") or ""
        overdue_days = 0
        if len(sd) >= 10:
            try:
                d = datetime.date.fromisoformat(sd[:10])
                overdue_days = max(0, (today - d).days)
            except Exception:
                overdue_days = 0
        r["overdue_days"] = overdue_days
        out.append(r)
    return out


# ========================================================
# 🏢 Phase 1 확장 모듈: 복수 담당자 · 매입처 · 지정 포워더 · 재고상세(입고/스케줄/패킹) · 대여/RMA/손실
# ========================================================
_PHASE1_BUNDLE_CACHE: Dict[str, Any] = {}

def _load_phase1_bundle(filename: str) -> Any:
    """Vercel 클라우드/오프라인 환경용 번들 JSON 로더 (메모리 캐시)"""
    if filename in _PHASE1_BUNDLE_CACHE:
        return _PHASE1_BUNDLE_CACHE[filename]
    import json
    base_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(base_dir, "data", filename),
        os.path.join(base_dir, "api", "data", filename),
        os.path.join(os.getcwd(), "data", filename),
        os.path.join(os.getcwd(), "api", "data", filename),
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                _PHASE1_BUNDLE_CACHE[filename] = data
                return data
            except Exception:
                pass
    return None

def _fmt_dt(val: Any) -> str:
    if not val:
        return ""
    s = str(val)[:10]
    if s.startswith("1900-01-01") or s.startswith("1899-"):
        return ""
    return s

def query_customer_contacts(cid: Optional[int] = None, query: Optional[str] = None, limit: int = 500) -> List[Dict[str, Any]]:
    """ContactFile: 거래처별 전체 복수 담당자 조회"""
    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)
        conditions = []
        params = []
        if cid is not None:
            conditions.append("ct.CID = %s")
            params.append(int(cid))
        if query and query.strip():
            term = f"%{query.strip()}%"
            conditions.append("(ct.KCONTACT LIKE %s OR ct.CCONTACT LIKE %s OR ct.CTEL LIKE %s OR ct.CHP LIKE %s OR ct.CEMAIL LIKE %s OR c.Kname LIKE %s OR c.Cname LIKE %s)")
            params.extend([term] * 7)
        where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        sql = f"""
            SELECT TOP {int(limit)}
                ct.IDX as idx, ct.CID as cid,
                COALESCE(c.Kname, c.Cname, '') as customer_name,
                ct.KCONTACT as kcontact, ct.CCONTACT as ccontact,
                ct.CTITLE as title, ct.CTEL as tel, ct.CDTEL as dtel,
                ct.CFAX as fax, ct.CHP as mobile, ct.CEMAIL as email,
                ct.CREMARK as remark
            FROM ContactFile ct
            LEFT JOIN CustomerFile c ON ct.CID = c.CID
            {where_sql}
            ORDER BY ct.CID ASC, ct.IDX ASC
        """
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        conn.close()
        return [{
            "idx": r["idx"],
            "cid": r["cid"],
            "customer_name": clean_val(r["customer_name"]),
            "name": clean_val(r["kcontact"]) or clean_val(r["ccontact"]),
            "title": clean_val(r["title"]),
            "tel": clean_val(r["tel"]) or clean_val(r["dtel"]),
            "fax": clean_val(r["fax"]),
            "mobile": clean_val(r["mobile"]),
            "email": clean_val(r["email"]),
            "remark": clean_val(r["remark"]),
        } for r in rows if (clean_val(r["kcontact"]) or clean_val(r["ccontact"]))]
    except Exception:
        bundle = _load_phase1_bundle("contacts_by_cid.json") or {}
        if cid is not None:
            items = bundle.get(str(cid), [])
        else:
            items = [it for lst in bundle.values() for it in lst]
        if query and query.strip():
            q = query.strip().lower()
            items = [it for it in items if q in (it.get("name", "").lower() + " " + it.get("tel", "").lower() + " " + it.get("mobile", "").lower() + " " + it.get("email", "").lower() + " " + it.get("customer_name", "").lower())]
        return items[:limit]

def query_contact_counts() -> Dict[str, int]:
    """거래처(CID)별 담당자 수 카운트 맵"""
    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)
        cur.execute("SELECT CID as cid, COUNT(*) as cnt FROM ContactFile WHERE (KCONTACT IS NOT NULL AND LTRIM(RTRIM(KCONTACT)) <> '') OR (CCONTACT IS NOT NULL AND LTRIM(RTRIM(CCONTACT)) <> '') GROUP BY CID")
        rows = cur.fetchall()
        conn.close()
        return {str(r["cid"]): int(r["cnt"]) for r in rows if r.get("cid") is not None}
    except Exception:
        bundle = _load_phase1_bundle("contacts_by_cid.json") or {}
        return {str(k): len(v) for k, v in bundle.items()}

def query_suppliers(query: Optional[str] = None, limit: int = 500) -> List[Dict[str, Any]]:
    """CustomerBFile: 해외/국내 매입처(공급사) 마스터 조회"""
    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)
        conditions = []
        params = []
        if query and query.strip():
            term = f"%{query.strip()}%"
            conditions.append("(Cname LIKE %s OR NATION LIKE %s OR Product LIKE %s OR Email LIKE %s OR TEL LIKE %s OR Remark LIKE %s OR SALES LIKE %s)")
            params.extend([term] * 7)
        where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        sql = f"""
            SELECT TOP {int(limit)}
                CID as cid, Cname as cname, TEL as tel, FAX as fax,
                NATION as nation, Email as email, Product as product,
                Address as address, Remark as remark, SALES as sales,
                CS as cs, GUBUN as gubun, UPDATE_DT as update_dt
            FROM CustomerBFile
            {where_sql}
            ORDER BY UPDATE_DT DESC, CID DESC
        """
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        conn.close()
        return [{
            "cid": r["cid"],
            "cname": clean_val(r["cname"]),
            "tel": clean_val(r["tel"]),
            "fax": clean_val(r["fax"]),
            "nation": clean_val(r["nation"]),
            "email": clean_val(r["email"]),
            "product": clean_val(r["product"]),
            "address": clean_val(r["address"]),
            "remark": clean_val(r["remark"]),
            "sales": normalize_sales_rep(r["sales"]),
            "cs": normalize_sales_rep(r["cs"]),
            "gubun": clean_val(r["gubun"]),
            "update_dt": _fmt_dt(r.get("update_dt")),
        } for r in rows if clean_val(r["cname"])]
    except Exception:
        items = _load_phase1_bundle("suppliers.json") or []
        if query and query.strip():
            q = query.strip().lower()
            items = [it for it in items if q in f"{it.get('cname','')} {it.get('nation','')} {it.get('product','')} {it.get('email','')} {it.get('tel','')} {it.get('remark','')}".lower()]
        return items[:limit]

def query_forwarders(cid: Optional[int] = None, query: Optional[str] = None, limit: int = 500) -> List[Dict[str, Any]]:
    """CustForwarder: 고객사별 지정 포워더 및 Account 정보 조회"""
    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)
        conditions = []
        params = []
        if cid is not None:
            conditions.append("f.CID = %s")
            params.append(int(cid))
        if query and query.strip():
            term = f"%{query.strip()}%"
            conditions.append("(f.FName LIKE %s OR f.FACCOUNT LIKE %s OR f.FRegion LIKE %s OR f.Fkinds LIKE %s OR c.Kname LIKE %s OR c.Cname LIKE %s)")
            params.extend([term] * 6)
        where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        sql = f"""
            SELECT TOP {int(limit)}
                f.IDX as idx, f.CID as cid, f.FID as fid,
                COALESCE(c.Kname, c.Cname, '') as customer_name,
                f.FName as fname, f.FACCOUNT as account, f.FRegion as region,
                f.Fkinds as kinds, f.Chk as chk,
                CAST(f.Comment AS NVARCHAR(MAX)) as comment
            FROM CustForwarder f
            LEFT JOIN CustomerFile c ON f.CID = c.CID
            {where_sql}
            ORDER BY f.IDX DESC
        """
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        conn.close()
        return [{
            "idx": r["idx"],
            "cid": r["cid"],
            "customer_name": clean_val(r["customer_name"]),
            "fname": clean_val(r["fname"]),
            "account": clean_val(r["account"]),
            "region": clean_val(r["region"]),
            "kinds": clean_val(r["kinds"]),
            "chk": clean_val(r["chk"]),
            "comment": clean_val(r["comment"]),
        } for r in rows if clean_val(r["fname"])]
    except Exception:
        items = _load_phase1_bundle("forwarders.json") or []
        if cid is not None:
            items = [it for it in items if str(it.get("cid")) == str(cid)]
        if query and query.strip():
            q = query.strip().lower()
            items = [it for it in items if q in f"{it.get('customer_name','')} {it.get('fname','')} {it.get('account','')} {it.get('region','')} {it.get('kinds','')} {it.get('comment','')}".lower()]
        return items[:limit]

def query_inventory_detail(part_no: str, invoice_no: Optional[str] = None) -> Dict[str, Any]:
    """재고 품목 클릭 시 상세 드로어 확장 정보: 최초입고량(INQTY), 출하스케줄(DincomeScheduleFile), 패킹/Lot(PackingFile)"""
    p_clean = (part_no or "").strip()
    inv_clean = (invoice_no or "").strip()
    if not p_clean:
        return {"incomes": [], "schedules": [], "packings": []}

    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)

        # 1. DincomeFile (최초 입고량 vs 잔여재고)
        if inv_clean:
            cur.execute("""
                SELECT TOP 5 IDX as idx, INVOICENO as invoice_no, INDT as in_date,
                       INQTY as in_qty, NOTOUTQTY as remain_qty, DATACODE as date_code,
                       InRate as in_rate, Slup as sl_up, Wup as w_up, Remark as remark
                FROM DincomeFile
                WHERE LTRIM(RTRIM(PARTNO)) = %s AND LTRIM(RTRIM(INVOICENO)) = %s
                ORDER BY INDT DESC, IDX DESC
            """, (p_clean, inv_clean))
        else:
            cur.execute("""
                SELECT TOP 5 IDX as idx, INVOICENO as invoice_no, INDT as in_date,
                       INQTY as in_qty, NOTOUTQTY as remain_qty, DATACODE as date_code,
                       InRate as in_rate, Slup as sl_up, Wup as w_up, Remark as remark
                FROM DincomeFile
                WHERE LTRIM(RTRIM(PARTNO)) = %s
                ORDER BY INDT DESC, IDX DESC
            """, (p_clean,))
        incomes = [{
            "idx": r["idx"],
            "invoice_no": clean_val(r["invoice_no"]),
            "in_date": _fmt_dt(r.get("in_date")),
            "in_qty": int(r["in_qty"] or 0),
            "remain_qty": int(r["remain_qty"] or 0),
            "date_code": clean_val(r["date_code"]),
            "in_rate": float(r["in_rate"] or 0.0),
            "sl_up": float(r["sl_up"] or 0.0),
            "w_up": float(r["w_up"] or 0.0),
            "remark": clean_val(r["remark"]),
        } for r in cur.fetchall()]

        # 2. DincomeScheduleFile (배정 및 월별 출하 스케줄)
        cur.execute("""
            SELECT TOP 15 s.IDX as idx, s.IDX_IN as idx_in, s.QTY as qty,
                   s.SALES as sales, s.ACTUALCUSTOMER as actual_customer,
                   s.SCHEDULE_DT as schedule_dt, d.INVOICENO as invoice_no
            FROM DincomeScheduleFile s
            INNER JOIN DincomeFile d ON s.IDX_IN = d.IDX
            WHERE LTRIM(RTRIM(d.PARTNO)) = %s
            ORDER BY s.SCHEDULE_DT DESC, s.IDX DESC
        """, (p_clean,))
        schedules = [{
            "idx": r["idx"],
            "qty": int(r["qty"] or 0),
            "sales": normalize_sales_rep(r["sales"]),
            "actual_customer": clean_val(r["actual_customer"]),
            "schedule_dt": clean_val(r["schedule_dt"]),
            "invoice_no": clean_val(r["invoice_no"]),
        } for r in cur.fetchall()]

        # 3. PackingFile JOIN ShippingFile (패킹 & D/C Lot / Fab Lot 상세)
        if inv_clean:
            cur.execute("""
                SELECT TOP 15 p.PIDX as pidx, p.PACKQTY as pack_qty, p.DCLOT as dc_lot,
                       p.FABLOTNO as fab_lot, p.Weight as weight, p.CartonNo as carton_no,
                       p.Dimension as dimension, s.INVOICENO as invoice_no, s.SHIPDT as ship_date
                FROM PackingFile p
                INNER JOIN ShippingFile s ON p.IDX = s.IDX
                WHERE LTRIM(RTRIM(s.PartNo)) = %s AND LTRIM(RTRIM(s.INVOICENO)) = %s
                ORDER BY p.PIDX DESC
            """, (p_clean, inv_clean))
        else:
            cur.execute("""
                SELECT TOP 15 p.PIDX as pidx, p.PACKQTY as pack_qty, p.DCLOT as dc_lot,
                       p.FABLOTNO as fab_lot, p.Weight as weight, p.CartonNo as carton_no,
                       p.Dimension as dimension, s.INVOICENO as invoice_no, s.SHIPDT as ship_date
                FROM PackingFile p
                INNER JOIN ShippingFile s ON p.IDX = s.IDX
                WHERE LTRIM(RTRIM(s.PartNo)) = %s
                ORDER BY p.PIDX DESC
            """, (p_clean,))
        packings = [{
            "pidx": r["pidx"],
            "pack_qty": int(r["pack_qty"] or 0),
            "dc_lot": clean_val(r["dc_lot"]),
            "fab_lot": clean_val(r["fab_lot"]),
            "weight": float(r["weight"] or 0.0),
            "carton_no": r["carton_no"],
            "dimension": clean_val(r["dimension"]),
            "invoice_no": clean_val(r["invoice_no"]),
            "ship_date": _fmt_dt(r.get("ship_date")),
        } for r in cur.fetchall()]

        conn.close()
        return {"incomes": incomes, "schedules": schedules, "packings": packings}
    except Exception:
        bundle = _load_phase1_bundle("inventory_details.json") or {}
        key_exact = f"{p_clean}||{inv_clean}" if inv_clean else ""
        if key_exact and key_exact in bundle:
            return bundle[key_exact]
        if p_clean in bundle:
            return bundle[p_clean]
        return {"incomes": [], "schedules": [], "packings": []}

def query_borrows(query: Optional[str] = None, limit: int = 300) -> List[Dict[str, Any]]:
    """DBRWFile: 대여/반납 원장 조회"""
    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)
        conditions = []
        params = []
        if query and query.strip():
            term = f"%{query.strip()}%"
            conditions.append("(b.Partno LIKE %s OR b.Mfg LIKE %s OR b.PONO LIKE %s OR b.Sales LIKE %s OR b.Remark LIKE %s OR c.Kname LIKE %s OR c.Cname LIKE %s)")
            params.extend([term] * 7)
        where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        sql = f"""
            SELECT TOP {int(limit)}
                b.IDX as idx, COALESCE(c.Kname, c.Cname, '') as customer_name,
                b.SDT as sdt, b.OUTDT as out_dt, b.RTNDT as rtn_dt, b.RDT as rdt,
                b.PONO as po_no, b.Partno as part_no, b.Mfg as maker,
                b.Qty as qty, b.Sales as sales, b.Gubun as gubun,
                b.Result as result, b.Remark as remark
            FROM DBRWFile b
            LEFT JOIN CustomerFile c ON b.Custid = c.CID
            {where_sql}
            ORDER BY b.SDT DESC, b.IDX DESC
        """
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        conn.close()
        return [{
            "idx": r["idx"],
            "customer_name": clean_val(r["customer_name"]) or "-",
            "date": _fmt_dt(r.get("out_dt")) or _fmt_dt(r.get("sdt")),
            "rtn_date": _fmt_dt(r.get("rtn_dt")),
            "rdt": clean_val(r["rdt"]),
            "po_no": clean_val(r["po_no"]),
            "part_no": clean_val(r["part_no"]),
            "maker": clean_val(r["maker"]) or "OTHERS",
            "qty": int(r["qty"] or 0),
            "sales": normalize_sales_rep(r["sales"]),
            "gubun": clean_val(r["gubun"]),
            "result": clean_val(r["result"]),
            "remark": clean_val(r["remark"]),
        } for r in rows]
    except Exception:
        bundle = _load_phase1_bundle("borrows_rma_loss.json") or {}
        items = bundle.get("borrows", [])
        if query and query.strip():
            q = query.strip().lower()
            items = [it for it in items if q in f"{it.get('customer_name','')} {it.get('part_no','')} {it.get('maker','')} {it.get('po_no','')} {it.get('sales','')} {it.get('remark','')}".lower()]
        return items[:limit]

def query_rmas(query: Optional[str] = None, limit: int = 300) -> List[Dict[str, Any]]:
    """DRMAFile: 반품(RMA) 원장 조회"""
    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)
        conditions = []
        params = []
        if query and query.strip():
            term = f"%{query.strip()}%"
            conditions.append("(r.Partno LIKE %s OR r.Mfg LIKE %s OR r.PONO LIKE %s OR r.Sales LIKE %s OR c.Kname LIKE %s OR c.Cname LIKE %s)")
            params.extend([term] * 6)
        where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        sql = f"""
            SELECT TOP {int(limit)}
                r.IDX as idx, COALESCE(c.Kname, c.Cname, '') as customer_name,
                r.SDT as sdt, r.PONO as po_no, r.Partno as part_no, r.Mfg as maker,
                r.Qty as qty, r.InUP as in_up, r.OutUP as out_up, r.OutAmt as out_amt,
                r.MGN as mgn, r.Sales as sales, r.Gubun as gubun, r.Result as result
            FROM DRMAFile r
            LEFT JOIN CustomerFile c ON r.Custid = c.CID
            {where_sql}
            ORDER BY r.SDT DESC, r.IDX DESC
        """
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        conn.close()
        return [{
            "idx": r["idx"],
            "customer_name": clean_val(r["customer_name"]) or "-",
            "date": _fmt_dt(r.get("sdt")),
            "po_no": clean_val(r["po_no"]),
            "part_no": clean_val(r["part_no"]),
            "maker": clean_val(r["maker"]) or "OTHERS",
            "qty": int(r["qty"] or 0),
            "in_up": float(r["in_up"] or 0.0),
            "out_up": float(r["out_up"] or 0.0),
            "out_amt": float(r["out_amt"] or 0.0),
            "mgn": float(r["mgn"] or 0.0),
            "sales": normalize_sales_rep(r["sales"]),
            "gubun": clean_val(r["gubun"]),
            "result": clean_val(r["result"]) or "RMA",
        } for r in rows]
    except Exception:
        bundle = _load_phase1_bundle("borrows_rma_loss.json") or {}
        items = bundle.get("rmas", [])
        if query and query.strip():
            q = query.strip().lower()
            items = [it for it in items if q in f"{it.get('customer_name','')} {it.get('part_no','')} {it.get('maker','')} {it.get('po_no','')} {it.get('sales','')}".lower()]
        return items[:limit]

def query_losses(query: Optional[str] = None, limit: int = 300) -> List[Dict[str, Any]]:
    """LossFile: 손실/불량/폐기 원장 조회"""
    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)
        conditions = []
        params = []
        if query and query.strip():
            term = f"%{query.strip()}%"
            conditions.append("(PARTNO LIKE %s OR MFG LIKE %s OR Lossno LIKE %s OR Remark LIKE %s OR RESULT LIKE %s)")
            params.extend([term] * 5)
        where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        sql = f"""
            SELECT TOP {int(limit)}
                IDX as idx, SDT as sdt, PARTNO as part_no, MFG as maker,
                QTY as qty, RESULT as result, Lossno as loss_no,
                Remark as remark, NP as np, NPAMT as np_amt
            FROM LossFile
            {where_sql}
            ORDER BY SDT DESC, IDX DESC
        """
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        conn.close()
        results = []
        for r in rows:
            raw_qty = clean_val(r["qty"])
            try:
                qty_int = int(float(raw_qty.replace(",", ""))) if raw_qty else 0
            except Exception:
                qty_int = 0
            results.append({
                "idx": r["idx"],
                "date": _fmt_dt(r.get("sdt")),
                "part_no": clean_val(r["part_no"]),
                "maker": clean_val(r["maker"]) or "OTHERS",
                "qty": qty_int,
                "result": clean_val(r["result"]) or "LOSS",
                "loss_no": clean_val(r["loss_no"]),
                "remark": clean_val(r["remark"]),
                "np": float(r["np"] or 0.0),
                "np_amt": float(r["np_amt"] or 0.0),
            })
        return results
    except Exception:
        bundle = _load_phase1_bundle("borrows_rma_loss.json") or {}
        items = bundle.get("losses", [])
        if query and query.strip():
            q = query.strip().lower()
            items = [it for it in items if q in f"{it.get('part_no','')} {it.get('maker','')} {it.get('loss_no','')} {it.get('remark','')} {it.get('result','')}".lower()]
        return items[:limit]


# ========================================================
# 🛃 Phase 2 확장 모듈: 수입 통관·B/L·부대비용 원장(DchargeFile) & 해외 송금 T/T(FinanceFile)
# ========================================================
def query_import_charges(query: Optional[str] = None, supp: Optional[str] = None, limit: int = 300) -> List[Dict[str, Any]]:
    """DchargeFile: 수입 통관 · B/L · 관세/운임 부대비용 원장 조회"""
    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)
        conditions = []
        params = []
        if supp and supp.strip() and supp.strip().upper() != "ALL":
            conditions.append("LTRIM(RTRIM(Supp)) = %s")
            params.append(supp.strip())
        if query and query.strip():
            term = f"%{query.strip()}%"
            conditions.append("(BL LIKE %s OR Supp LIKE %s OR FWinfo LIKE %s OR Noticenum LIKE %s OR Origin LIKE %s OR Invoiceno LIKE %s OR INPUT_PERSON LIKE %s)")
            params.extend([term] * 7)
        where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        sql = f"""
            SELECT TOP {int(limit)}
                Idx as idx, Invoiceno as invoice_no, Supp as supp,
                BL as bl_no, FWinfo as forwarder, Origin as origin,
                Indate as in_date, Rate as rate, Charge as charge,
                Weight as weight, VAT as vat, Duty as duty,
                Warehouse as warehouse, Entry as entry_fee,
                Freight as freight, Etc as etc_fee, AWB as awb_fee,
                Noticenum as notice_no, INPUT_PERSON as input_person
            FROM DchargeFile
            {where_sql}
            ORDER BY Indate DESC, Idx DESC
        """
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        conn.close()
        results = []
        for r in rows:
            rate = float(r.get("rate") or 0.0)
            vat = float(r.get("vat") or 0.0)
            duty = int(r.get("duty") or 0)
            charge = float(r.get("charge") or 0.0)
            awb_fee = int(r.get("awb_fee") or 0)
            freight = int(r.get("freight") or 0)
            warehouse = int(r.get("warehouse") or 0)
            entry_fee = int(r.get("entry_fee") or 0)
            etc_fee = int(r.get("etc_fee") or 0)

            # 수입 부가세(10%) 기준 물품 과세가격 역산: (VAT * 10) - 관세
            est_goods_krw = max(0.0, (vat * 10.0) - duty) if vat > 0 else 0.0
            est_goods_usd = round(est_goods_krw / rate, 2) if (est_goods_krw > 0 and rate > 500) else 0.0
            overhead_pct = round((charge / est_goods_krw) * 100.0, 2) if est_goods_krw > 0 else 0.0

            results.append({
                "idx": r["idx"],
                "invoice_no": clean_val(r.get("invoice_no")),
                "supp": clean_val(r.get("supp")) or "-",
                "bl_no": clean_val(r.get("bl_no")),
                "forwarder": clean_val(r.get("forwarder")),
                "origin": clean_val(r.get("origin")),
                "in_date": _fmt_dt(r.get("in_date")),
                "rate": rate,
                "charge": charge,
                "weight": float(r.get("weight") or 0.0),
                "vat": vat,
                "duty": duty,
                "awb_fee": awb_fee,
                "freight": freight,
                "warehouse": warehouse,
                "entry_fee": entry_fee,
                "etc_fee": etc_fee,
                "notice_no": clean_val(r.get("notice_no")),
                "input_person": normalize_sales_rep(r.get("input_person")),
                "est_goods_krw": round(est_goods_krw),
                "est_goods_usd": est_goods_usd,
                "overhead_pct": overhead_pct,
            })
        return results
    except Exception:
        items = _load_phase1_bundle("import_charges.json") or []
        if supp and supp.strip() and supp.strip().upper() != "ALL":
            s_up = supp.strip().upper()
            items = [it for it in items if (it.get("supp") or "").upper() == s_up]
        if query and query.strip():
            q = query.strip().lower()
            items = [it for it in items if q in f"{it.get('bl_no','')} {it.get('supp','')} {it.get('forwarder','')} {it.get('notice_no','')} {it.get('origin','')} {it.get('invoice_no','')} {it.get('input_person','')}".lower()]
        return items[:limit]

def query_remittances(query: Optional[str] = None, mfg: Optional[str] = None, limit: int = 300) -> List[Dict[str, Any]]:
    """FinanceFile: 해외 송금(T/T) 및 외환 결제 내역 조회"""
    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)
        conditions = []
        params = []
        if mfg and mfg.strip() and mfg.strip().upper() != "ALL":
            conditions.append("LTRIM(RTRIM(MFG)) = %s")
            params.append(mfg.strip())
        if query and query.strip():
            term = f"%{query.strip()}%"
            conditions.append("(MFG LIKE %s OR TTNO LIKE %s OR INPUT_PERSON LIKE %s OR REMARK LIKE %s OR CURRENCY LIKE %s)")
            params.extend([term] * 5)
        where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        sql = f"""
            SELECT TOP {int(limit)}
                IDX as idx, MFG as mfg, REMITTANCE_DT as remittance_dt,
                CURRENCY as currency, REMITTANCE as remittance,
                COMMODITY_COST as commodity_cost, EXRATE as exrate,
                TTNO as tt_no, INPUT_PERSON as input_person,
                INPUT_DT as input_dt, REMARK as remark
            FROM FinanceFile
            {where_sql}
            ORDER BY REMITTANCE_DT DESC, IDX DESC
        """
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        conn.close()
        results = []
        for r in rows:
            rem = float(r.get("remittance") or 0.0)
            ex = float(r.get("exrate") or 0.0)
            results.append({
                "idx": r["idx"],
                "mfg": clean_val(r.get("mfg")) or "-",
                "remittance_dt": _fmt_dt(r.get("remittance_dt")),
                "currency": clean_val(r.get("currency")) or "US$",
                "remittance": rem,
                "commodity_cost": float(r.get("commodity_cost") or 0.0),
                "exrate": ex,
                "krw_amount": round(rem * ex) if ex > 0 else 0,
                "tt_no": clean_val(r.get("tt_no")),
                "input_person": normalize_sales_rep(r.get("input_person")),
                "input_dt": _fmt_dt(r.get("input_dt")),
                "remark": clean_val(r.get("remark")),
            })
        return results
    except Exception:
        items = _load_phase1_bundle("remittances.json") or []
        if mfg and mfg.strip() and mfg.strip().upper() != "ALL":
            m_up = mfg.strip().upper()
            items = [it for it in items if (it.get("mfg") or "").upper() == m_up]
        if query and query.strip():
            q = query.strip().lower()
            items = [it for it in items if q in f"{it.get('mfg','')} {it.get('tt_no','')} {it.get('input_person','')} {it.get('remark','')}".lower()]
        return items[:limit]


# ========================================================
# 🧪 Phase 3 확장 모듈: 샘플 & Design-In 프로젝트 트래킹 (SAMPLE_* 5종 테이블)
# ========================================================
_SAMPLE_RESULT_MAP = {1: "Design Win", 2: "Design Fail", 3: "Pending", 4: "Working"}
_SAMPLE_FAIL_MAP = {1: "Test Fail", 2: "Sample LT", 3: "PJT Drop", 4: "Others"}
_BIZ_RESULT_MAP = {1: "Taking P.O", 2: "Fail", 3: "Waiting"}
_BIZ_FAIL_MAP = {1: "Price", 2: "Others"}

def query_sample_tracking(
    query: Optional[str] = None,
    sample_result: Optional[str] = None,
    sales_rep: Optional[str] = None,
    limit: int = 400
) -> List[Dict[str, Any]]:
    """SAMPLE_TRACKING + SAMPLE_OUTFILE / DBRWFile + CustomerFile 조인 조회"""
    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)
        conditions = ["COALESCE(t.DEL_YN, 'N') <> 'Y'"]
        params = []
        if sample_result and sample_result.strip().upper() not in ("", "ALL"):
            sr_val = sample_result.strip()
            if sr_val.isdigit():
                conditions.append("t.SAMPLE_RESULT = %s")
                params.append(int(sr_val))
        if sales_rep and sales_rep.strip().upper() not in ("", "ALL"):
            s_val = sales_rep.strip()
            conditions.append("(LTRIM(RTRIM(o.SALES)) = %s OR LTRIM(RTRIM(b.Sales)) = %s)")
            params.extend([s_val, s_val])
        if query and query.strip():
            term = f"%{query.strip()}%"
            conditions.append("""(
                t.APP LIKE %s OR t.PRJ_MODEL LIKE %s OR t.CHIPSET_VENDOR LIKE %s OR
                t.CHIPSET_PARTNO LIKE %s OR t.COMPETITOR LIKE %s OR t.REMARK LIKE %s OR
                o.PARTNO LIKE %s OR b.Partno LIKE %s OR c1.Kname LIKE %s OR c1.Cname LIKE %s OR
                c2.Kname LIKE %s OR c2.Cname LIKE %s
            )""")
            params.extend([term] * 12)
        where_sql = f"WHERE {' AND '.join(conditions)}"
        sql = f"""
            SELECT TOP {int(limit)}
                t.IDX as idx, t.APP as app, t.PRJ_MODEL as prj_model,
                t.VOLUME as volume, t.PP_DATE as pp_date, t.MP_DATE as mp_date,
                t.CHIPSET_VENDOR as chipset_vendor, t.CHIPSET_PARTNO as chipset_partno,
                t.COMPETITOR as competitor, t.COMP_PARTNO as comp_partno,
                t.COMP_PRICE as comp_price, t.SAMPLE_DATE as sample_date,
                t.SAMPLE_QTY as sample_qty, t.QUOTE_QTY as quote_qty,
                t.QUOTE_PRICE as quote_price, t.SAMPLE_RESULT as sample_result,
                t.SAMPLE_RESULT2 as sample_result2, t.BUSINESS_RESULT as business_result,
                t.BUSINESS_RESULT2 as business_result2, t.UPDATEDT as update_dt,
                t.REMARK as remark, t.OUT_KIND as out_kind,
                COALESCE(o.PARTNO, b.Partno, '') as part_no,
                COALESCE(o.MFG, b.Mfg, '') as mfg,
                COALESCE(o.SALES, b.Sales, '') as sales,
                COALESCE(c1.Kname, c1.Cname, c2.Kname, c2.Cname, '') as customer_name
            FROM SAMPLE_TRACKING t
            LEFT JOIN SAMPLE_OUTFILE o ON t.OUT_KIND = 'SM_OUT' AND t.OUT_IDX = o.IDX
            LEFT JOIN CustomerFile c1 ON o.CUSTID = c1.CID
            LEFT JOIN DBRWFile b ON t.OUT_KIND <> 'SM_OUT' AND t.OUT_IDX = b.IDX
            LEFT JOIN CustomerFile c2 ON b.Custid = c2.CID
            {where_sql}
            ORDER BY t.IDX DESC
        """
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        conn.close()
        results = []
        for r in rows:
            sr = int(r.get("sample_result") or 0)
            sr2 = int(r.get("sample_result2") or 0)
            br = int(r.get("business_result") or 0)
            br2 = int(r.get("business_result2") or 0)
            sr_label = _SAMPLE_RESULT_MAP.get(sr, "Working")
            if sr == 2 and sr2 in _SAMPLE_FAIL_MAP:
                sr_label = f"Design Fail ({_SAMPLE_FAIL_MAP[sr2]})"
            br_label = _BIZ_RESULT_MAP.get(br, "Waiting")
            if br == 2 and br2 in _BIZ_FAIL_MAP:
                br_label = f"Fail ({_BIZ_FAIL_MAP[br2]})"
            results.append({
                "idx": r["idx"],
                "customer_name": clean_val(r.get("customer_name")) or "-",
                "part_no": clean_val(r.get("part_no")) or "-",
                "mfg": clean_val(r.get("mfg")) or "-",
                "sales": normalize_sales_rep(r.get("sales")) or "-",
                "app": clean_val(r.get("app")),
                "prj_model": clean_val(r.get("prj_model")),
                "volume": int(r.get("volume") or 0),
                "pp_date": _fmt_dt(r.get("pp_date")),
                "mp_date": _fmt_dt(r.get("mp_date")),
                "chipset_vendor": clean_val(r.get("chipset_vendor")),
                "chipset_partno": clean_val(r.get("chipset_partno")),
                "competitor": clean_val(r.get("competitor")),
                "comp_partno": clean_val(r.get("comp_partno")),
                "comp_price": float(r.get("comp_price") or 0.0),
                "sample_date": _fmt_dt(r.get("sample_date")),
                "sample_qty": int(r.get("sample_qty") or 0),
                "quote_qty": int(r.get("quote_qty") or 0),
                "quote_price": float(r.get("quote_price") or 0.0),
                "sample_result": sr,
                "sample_result_label": sr_label,
                "business_result": br,
                "business_result_label": br_label,
                "update_dt": _fmt_dt(r.get("update_dt")),
                "remark": clean_val(r.get("remark")),
                "source": "LEGACY",
            })
        return results
    except Exception:
        bundle = _load_phase1_bundle("samples_bundle.json") or {}
        items = bundle.get("tracking", [])
        if sample_result and sample_result.strip().upper() not in ("", "ALL"):
            items = [it for it in items if str(it.get("sample_result")) == str(sample_result).strip()]
        if sales_rep and sales_rep.strip().upper() not in ("", "ALL"):
            s_up = sales_rep.strip().upper()
            items = [it for it in items if (it.get("sales") or "").upper() == s_up]
        if query and query.strip():
            q = query.strip().lower()
            items = [it for it in items if q in f"{it.get('customer_name','')} {it.get('part_no','')} {it.get('mfg','')} {it.get('app','')} {it.get('prj_model','')} {it.get('chipset_vendor','')} {it.get('chipset_partno','')} {it.get('competitor','')} {it.get('remark','')}".lower()]
        return items[:limit]

def query_sample_stock(query: Optional[str] = None, only_avail: bool = True, limit: int = 400) -> List[Dict[str, Any]]:
    """SAMPLE_STOCKFILE: 샘플 보유 재고 조회"""
    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)
        conditions = ["COALESCE(DEL_YN, 'N') <> 'Y'"]
        params = []
        if only_avail:
            conditions.append("QTY > 0")
        if query and query.strip():
            term = f"%{query.strip()}%"
            conditions.append("(PARTNO LIKE %s OR MFG LIKE %s)")
            params.extend([term, term])
        where_sql = f"WHERE {' AND '.join(conditions)}"
        sql = f"""
            SELECT TOP {int(limit)}
                IDX as idx, PARTNO as part_no, MFG as mfg,
                QTY as qty, TIMESTAMP as updated_at
            FROM SAMPLE_STOCKFILE
            {where_sql}
            ORDER BY TIMESTAMP DESC, IDX DESC
        """
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        conn.close()
        return [{
            "idx": r["idx"],
            "part_no": clean_val(r.get("part_no")),
            "mfg": clean_val(r.get("mfg")) or "OTHERS",
            "qty": int(r.get("qty") or 0),
            "updated_at": _fmt_dt(r.get("updated_at")),
        } for r in rows if clean_val(r.get("part_no"))]
    except Exception:
        bundle = _load_phase1_bundle("samples_bundle.json") or {}
        items = bundle.get("stock", [])
        if only_avail:
            items = [it for it in items if (it.get("qty") or 0) > 0]
        if query and query.strip():
            q = query.strip().lower()
            items = [it for it in items if q in f"{it.get('part_no','')} {it.get('mfg','')}".lower()]
        return items[:limit]

def query_sample_requests(query: Optional[str] = None, limit: int = 300) -> List[Dict[str, Any]]:
    """SAMPLE_REQFILE: 샘플 요청 내역 조회"""
    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)
        conditions = ["COALESCE(r.DEL_YN, 'N') <> 'Y'"]
        params = []
        if query and query.strip():
            term = f"%{query.strip()}%"
            conditions.append("(r.SRNO LIKE %s OR r.PARTNO LIKE %s OR r.MFG LIKE %s OR r.SALES LIKE %s OR r.REALCUST LIKE %s OR c.Kname LIKE %s OR c.Cname LIKE %s)")
            params.extend([term] * 7)
        where_sql = f"WHERE {' AND '.join(conditions)}"
        sql = f"""
            SELECT TOP {int(limit)}
                r.IDX as idx, r.REQDATE as req_date, r.SRNO as sr_no,
                COALESCE(c.Kname, c.Cname, '') as customer_name,
                r.REALCUST as real_cust, r.MFG as mfg, r.SUPPLIER as supplier,
                r.PARTNO as part_no, r.QTY as qty, r.CRD as crd_date,
                r.SHIPDT as ship_date, r.SALES as sales, r.STATUS as status,
                r.APP as app, r.REMARK as remark
            FROM SAMPLE_REQFILE r
            LEFT JOIN CustomerFile c ON r.CUSTID = c.CID
            {where_sql}
            ORDER BY r.IDX DESC
        """
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        conn.close()
        return [{
            "idx": r["idx"],
            "req_date": _fmt_dt(r.get("req_date")),
            "sr_no": clean_val(r.get("sr_no")),
            "customer_name": clean_val(r.get("customer_name")) or clean_val(r.get("real_cust")) or "-",
            "real_cust": clean_val(r.get("real_cust")),
            "mfg": clean_val(r.get("mfg")) or "OTHERS",
            "supplier": clean_val(r.get("supplier")),
            "part_no": clean_val(r.get("part_no")),
            "qty": int(r.get("qty") or 0),
            "crd_date": _fmt_dt(r.get("crd_date")),
            "ship_date": _fmt_dt(r.get("ship_date")),
            "sales": normalize_sales_rep(r.get("sales")),
            "status": clean_val(r.get("status")) or "REQ",
            "app": clean_val(r.get("app")),
            "remark": clean_val(r.get("remark")),
        } for r in rows]
    except Exception:
        bundle = _load_phase1_bundle("samples_bundle.json") or {}
        items = bundle.get("requests", [])
        if query and query.strip():
            q = query.strip().lower()
            items = [it for it in items if q in f"{it.get('sr_no','')} {it.get('part_no','')} {it.get('mfg','')} {it.get('customer_name','')} {it.get('real_cust','')} {it.get('sales','')}".lower()]
        return items[:limit]

def query_sample_incomes(query: Optional[str] = None, limit: int = 300) -> List[Dict[str, Any]]:
    """SAMPLE_INCOMEFILE: 샘플 입고 내역 조회"""
    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)
        conditions = ["COALESCE(i.DEL_YN, 'N') <> 'Y'"]
        params = []
        if query and query.strip():
            term = f"%{query.strip()}%"
            conditions.append("(i.SRNO LIKE %s OR i.PARTNO LIKE %s OR i.MFG LIKE %s OR i.AWBNO LIKE %s OR i.SALES LIKE %s OR i.REALCUST LIKE %s)")
            params.extend([term] * 6)
        where_sql = f"WHERE {' AND '.join(conditions)}"
        sql = f"""
            SELECT TOP {int(limit)}
                i.IDX as idx, i.SRNO as sr_no, i.PARTNO as part_no,
                i.MFG as mfg, i.SUPPLIER as supplier, i.STATUS as status,
                i.SHIPDT as ship_date, i.INDT as in_date,
                i.INQTY as in_qty, i.NOTOUTQTY as remain_qty,
                i.DATECODE as date_code, i.LOTNO as lot_no, i.AWBNO as awb_no,
                i.SALES as sales, i.REALCUST as real_cust, i.REMARK as remark
            FROM SAMPLE_INCOMEFILE i
            {where_sql}
            ORDER BY i.IDX DESC
        """
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        conn.close()
        return [{
            "idx": r["idx"],
            "sr_no": clean_val(r.get("sr_no")),
            "part_no": clean_val(r.get("part_no")),
            "mfg": clean_val(r.get("mfg")) or "OTHERS",
            "supplier": clean_val(r.get("supplier")),
            "status": clean_val(r.get("status")) or "IN",
            "ship_date": _fmt_dt(r.get("ship_date")),
            "in_date": _fmt_dt(r.get("in_date")),
            "in_qty": int(r.get("in_qty") or 0),
            "remain_qty": int(r.get("remain_qty") or 0),
            "date_code": clean_val(r.get("date_code")),
            "lot_no": clean_val(r.get("lot_no")),
            "awb_no": clean_val(r.get("awb_no")),
            "sales": normalize_sales_rep(r.get("sales")),
            "real_cust": clean_val(r.get("real_cust")),
            "remark": clean_val(r.get("remark")),
        } for r in rows]
    except Exception:
        bundle = _load_phase1_bundle("samples_bundle.json") or {}
        items = bundle.get("incomes", [])
        if query and query.strip():
            q = query.strip().lower()
            items = [it for it in items if q in f"{it.get('sr_no','')} {it.get('part_no','')} {it.get('mfg','')} {it.get('awb_no','')} {it.get('real_cust','')} {it.get('sales','')}".lower()]
        return items[:limit]

def query_sample_outflows(query: Optional[str] = None, limit: int = 300) -> List[Dict[str, Any]]:
    """SAMPLE_OUTFILE: 샘플 출고 및 반납 내역 조회"""
    try:
        conn = get_db_connection()
        cur = conn.cursor(as_dict=True)
        conditions = ["COALESCE(o.DEL_YN, 'N') <> 'Y'"]
        params = []
        if query and query.strip():
            term = f"%{query.strip()}%"
            conditions.append("(o.SONO LIKE %s OR o.PARTNO LIKE %s OR o.MFG LIKE %s OR o.SALES LIKE %s OR o.CONTACT LIKE %s OR c.Kname LIKE %s OR c.Cname LIKE %s)")
            params.extend([term] * 7)
        where_sql = f"WHERE {' AND '.join(conditions)}"
        sql = f"""
            SELECT TOP {int(limit)}
                o.IDX as idx, COALESCE(c.Kname, c.Cname, '') as customer_name,
                o.PARTNO as part_no, o.MFG as mfg, o.STATUS as status,
                o.GUBUN as gubun, o.SONO as so_no, o.OUTDT as out_date,
                o.RTNDT as rtn_date, o.RTN_PLANDT as rtn_plan_date,
                o.QTY as qty, o.SALES as sales, o.ITEM as item_type,
                o.DELIVERY as delivery, o.CONTACT as contact, o.REMARK as remark
            FROM SAMPLE_OUTFILE o
            LEFT JOIN CustomerFile c ON o.CUSTID = c.CID
            {where_sql}
            ORDER BY o.IDX DESC
        """
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        conn.close()
        return [{
            "idx": r["idx"],
            "customer_name": clean_val(r.get("customer_name")) or "-",
            "part_no": clean_val(r.get("part_no")),
            "mfg": clean_val(r.get("mfg")) or "OTHERS",
            "status": clean_val(r.get("status")) or "OUT",
            "gubun": clean_val(r.get("gubun")) or "SAM",
            "so_no": clean_val(r.get("so_no")),
            "out_date": _fmt_dt(r.get("out_date")),
            "rtn_date": _fmt_dt(r.get("rtn_date")),
            "rtn_plan_date": _fmt_dt(r.get("rtn_plan_date")),
            "qty": int(r.get("qty") or 0),
            "sales": normalize_sales_rep(r.get("sales")),
            "item_type": clean_val(r.get("item_type")),
            "delivery": clean_val(r.get("delivery")),
            "contact": clean_val(r.get("contact")),
            "remark": clean_val(r.get("remark")),
        } for r in rows]
    except Exception:
        bundle = _load_phase1_bundle("samples_bundle.json") or {}
        items = bundle.get("outflows", [])
        if query and query.strip():
            q = query.strip().lower()
            items = [it for it in items if q in f"{it.get('so_no','')} {it.get('part_no','')} {it.get('mfg','')} {it.get('customer_name','')} {it.get('contact','')} {it.get('sales','')}".lower()]
        return items[:limit]









