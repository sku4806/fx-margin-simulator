# legacy_mssql.py
import os
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

def get_db_connection():
    import pymssql
    return pymssql.connect(**LEGACY_DB_CONFIG)

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
        conditions.append("""(
            q.PartNo LIKE %s OR 
            c.Cname LIKE %s OR 
            q.CNAME LIKE %s OR 
            q.CONTACT LIKE %s OR 
            q.Sales LIKE %s OR 
            q.QuoteNo LIKE %s
        )""")
        params.extend([term, term, term, term, term, term])

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

    return [{k: clean_val(v) for k, v in row.items()} for row in raw_rows]
