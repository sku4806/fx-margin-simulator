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
        reps = [clean_val(r['sales']) for r in rows if clean_val(r['sales'])]
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
            A.OUTDT as out_date,
            A.PONO as po_no,
            A.PARTNO as part_no,
            A.MFG as maker,
            A.QTY as qty,
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
                "out_dt": clean_val(r["out_date"]),
                "po_no": clean_val(r["po_no"]),
                "part_no": clean_val(r["part_no"]),
                "mfg": clean_val(r["maker"]),
                "qty": int(r["qty"]) if r["qty"] else 0,
                "amount_vat": float(r["amount_vat"]) if r["amount_vat"] else 0.0,
                "overdue_days": int(r["overdue_days"]) if r["overdue_days"] is not None else 0,
                "pay_status": clean_val(r["pay_status"]),
                "contact": clean_val(r["contact"]),
                "due_date": clean_val(r["due_date"]),
                "sales": clean_val(r["sales_rep"]),
                "color_code": int(r["gubun_color"])
            })
        return results
    except Exception as e:
        print(f"[ERROR] query_unpaid_list 에러: {e}")
        return []

