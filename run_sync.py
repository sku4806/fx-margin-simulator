#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import datetime
import argparse
import pymssql
try:
    from supabase import create_client
except ImportError:
    create_client = None

os.environ["TDSVER"] = "7.0"

URL = "https://qheijtepveajdrqerxef.supabase.co"

# .env 로드 함수
def load_env():
    env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(env_file):
        with open(env_file, "r", encoding="utf-8") as ef:
            for line in ef:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip())

load_env()
KEY = os.getenv("SUPABASE_SERVICE_KEY", "").strip() or os.getenv("SUPABASE_KEY", "").strip()

LEGACY_DB_CONFIG = {
    'server': os.getenv('LEGACY_DB_HOST', '192.168.0.105'),
    'port': int(os.getenv('LEGACY_DB_PORT', 1433)),
    'user': os.getenv('LEGACY_DB_USER', 'linemsid'),
    'password': os.getenv('LEGACY_DB_PASSWORD', 'linepasswd'),
    'database': os.getenv('LEGACY_DB_NAME', 'BigLinemaster'),
    'charset': 'CP949',
    'tds_version': '7.0',
    'timeout': 15
}

def clean_val(v):
    if v is None:
        return ""
    if isinstance(v, bytes):
        try:
            return v.decode("cp949", errors="ignore").strip()
        except Exception:
            return v.decode("utf-8", errors="ignore").strip()
    return str(v).strip()

def sync_inventory(conn, sb):
    """
    1. 재고 데이터 동기화: DincomeFile (NOTOUTQTY > 0) -> Supabase inventory_items
    DPOFile 및 ShippingFile을 조인하여 실제 발주번호(po_no)를 완벽하게 추출하여 적재합니다.
    """
    print(f"\n📦 [1/2] 재고(DincomeFile) 데이터 동기화 시작 (DPOFile & ShippingFile PO 번호 조인)...")
    cur = conn.cursor(as_dict=True)
    query = """
        SELECT 
            d.IDX, d.INVOICENO, d.PARTNO, d.MFG, d.INDT, d.INQTY, d.NOTOUTQTY, 
            d.WOUP, d.Wup, d.Slup, d.InRate, d.RealSales, d.DATACODE, d.Remark,
            COALESCE(
                NULLIF(LTRIM(RTRIM(p1.PONO)), ''),
                NULLIF(LTRIM(RTRIM(s1.PoNo)), ''),
                NULLIF(LTRIM(RTRIM(s2.PoNo)), ''),
                NULLIF(LTRIM(RTRIM(s3.PoNo)), ''),
                NULLIF(LTRIM(RTRIM(p2.PONO)), '')
            ) as po_no
        FROM DincomeFile d
        LEFT JOIN DPOFile p1 ON d.DPOIDX = p1.idx
        LEFT JOIN ShippingFile s1 ON d.idxship = s1.IDX
        LEFT JOIN (
            SELECT INVOICENO, PartNo, MAX(PoNo) as PoNo
            FROM ShippingFile
            GROUP BY INVOICENO, PartNo
        ) s2 ON LTRIM(RTRIM(d.INVOICENO)) = LTRIM(RTRIM(s2.INVOICENO)) 
             AND LTRIM(RTRIM(d.PARTNO)) = LTRIM(RTRIM(s2.PartNo))
        LEFT JOIN (
            SELECT INVOICENO, MAX(PoNo) as PoNo
            FROM ShippingFile
            GROUP BY INVOICENO
        ) s3 ON LTRIM(RTRIM(d.INVOICENO)) = LTRIM(RTRIM(s3.INVOICENO))
        LEFT JOIN (
            SELECT PONO, MAX(Partno) as Partno
            FROM DPOFile
            GROUP BY PONO
        ) p2 ON LTRIM(RTRIM(d.INVOICENO)) = LTRIM(RTRIM(p2.PONO))
        WHERE d.NOTOUTQTY > 0
        ORDER BY d.INDT DESC, d.IDX DESC
    """
    cur.execute(query)
    rows = cur.fetchall()

    items = []

    for r in rows:
        part = clean_val(r['PARTNO'])
        if not part:
            continue
        
        remain_qty = int(r['NOTOUTQTY']) if r['NOTOUTQTY'] else 0
        indt_str = r['INDT'].strftime('%Y-%m-%d') if r['INDT'] else '2026-01-01'
        owner_val = clean_val(r['RealSales']) or 'BSK'
        
        # 사내 ERP 원장의 실제 입고/선적 환율(InRate) 및 원화/외화 단가 반영
        raw_in_rate = float(r['InRate']) if r.get('InRate') and float(r['InRate']) > 500 else 1350.0
        sl_up = float(r['Slup']) if r.get('Slup') and float(r['Slup']) > 0 else 0.0
        krw_cost = float(r['WOUP']) if r.get('WOUP') else (float(r['Wup']) if r.get('Wup') else 0.0)
        
        unit_usd = sl_up if sl_up > 0 else (krw_cost / raw_in_rate if krw_cost > 0 else 0.0)
        ship_fx = raw_in_rate

        record = {
            "part_name": part,
            "maker": clean_val(r['MFG']) or "OTHERS",
            "stock": remain_qty,
            "arranged_qty": 0,
            "unit_usd": unit_usd,
            "ship_fx": ship_fx,
            "owner": owner_val,
            "entry_date": indt_str,
            "invoice_no": clean_val(r['INVOICENO']),
            "po_no": clean_val(r.get('po_no')),
            "memo": clean_val(r['Remark']),
            "customer": clean_val(r['Remark']) or "BIGSHINE KOREA",
            "real_customer": clean_val(r['Remark']) or "BIGSHINE KOREA",
            "date_code": clean_val(r['DATACODE']) or "-",
            "payment_status": "미수",
            "order_status": "보유",
            "currency": "USD",
            "margin": 20
        }
        items.append(record)

    po_count = sum(1 for it in items if it["po_no"])
    print(f"[*] 레거시 유효 재고 {len(items)}건 변환 완료 (실제 PO 번호 확인: {po_count}건, 기타/실사재고: {len(items)-po_count}건)")

    # 웹 ERP에서 수동 등록·수주·입고·결재 연동된 항목은 보호하고, 레거시 보유 재고만 안전 교체
    try:
        sb.table("inventory_items").delete().eq("order_status", "보유").not_.ilike("memo", "%[전자결재%").not_.ilike("memo", "%[부분 출하%").not_.ilike("memo", "%[PO 입고완료%").not_.ilike("memo", "%[웹 직접%").execute()
    except Exception as e:
        print(f"⚠️ 레거시 재고 선택 초기화 알림: {e}")

    chunk_size = 100
    success_count = 0
    for i in range(0, len(items), chunk_size):
        chunk = items[i:i + chunk_size]
        try:
            sb.table("inventory_items").insert(chunk).execute()
            success_count += len(chunk)
        except Exception as e:
            print(f"❌ 재고 청크 삽입 에러 ({i}~{i+len(chunk)}): {e}")

    print(f"✅ [inventory_items] 총 {success_count}건 웹 ERP 반영 완료!")
    return success_count

def sync_quotations(conn, sb, min_date='2020-01-01'):
    """
    2. 견적 데이터 동기화: QuotationFile + CustomerFile -> Supabase legacy_quotations
    """
    print(f"\n📋 [2/2] 견적(QuotationFile) 데이터 동기화 시작 (기준일자: {min_date or '전체'})...")
    cur = conn.cursor(as_dict=True)

    where_clause = f"WHERE q.QuoteDT >= '{min_date}'" if min_date else ""
    sql = f"""
        SELECT 
            q.IDX as legacy_idx,
            q.QuoteDT as quote_date,
            q.QuoteNo as quote_no,
            q.Quotline as line_no,
            COALESCE(c.Cname, q.CNAME, '') as customer_name,
            q.CONTACT as contact,
            q.MFG as maker,
            q.PartNo as part_name,
            q.QTY_STR as qty_str,
            q.QTY_INT as qty_int,
            q.QUnit as currency_unit,
            q.QP as quote_price,
            q.Amount as amount,
            q.Payment as payment_terms,
            q.Sales as sales_rep,
            q.Delivery as delivery,
            q.Application as application,
            q.REMARK as remark,
            q.QUOT_TYPE as quote_type,
            c.Address as customer_address,
            c.TEL as customer_tel,
            c.FAX as customer_fax,
            c.Email as customer_email
        FROM QuotationFile q
        LEFT JOIN CustomerFile c ON q.CUSTID = c.CID
        {where_clause}
        ORDER BY q.QuoteDT DESC, q.QuoteNo ASC, q.Quotline ASC, q.IDX DESC
    """
    cur.execute(sql)
    rows = cur.fetchall()

    records = []
    for r in rows:
        part = clean_val(r['part_name'])
        if not part:
            continue
        
        quote_dt_str = r['quote_date'].strftime('%Y-%m-%d') if r['quote_date'] else None
        
        rec = {
            "legacy_idx": r['legacy_idx'],
            "quote_no": clean_val(r['quote_no']) or "QBK-LEGACY",
            "quote_date": quote_dt_str,
            "line_no": r['line_no'] if r['line_no'] is not None else 1,
            "customer_name": clean_val(r['customer_name']),
            "contact": clean_val(r['contact']),
            "maker": clean_val(r['maker']) or "OTHERS",
            "part_name": part,
            "qty_str": clean_val(r['qty_str']),
            "qty_int": r['qty_int'] if r['qty_int'] is not None else None,
            "currency_unit": clean_val(r['currency_unit']),
            "quote_price": float(r['quote_price']) if r['quote_price'] is not None else 0.0,
            "amount": float(r['amount']) if r['amount'] is not None else 0.0,
            "payment_terms": clean_val(r['payment_terms']),
            "sales_rep": clean_val(r['sales_rep']),
            "delivery": clean_val(r['delivery']),
            "application": clean_val(r['application']),
            "remark": clean_val(r['remark']),
            "quote_type": clean_val(r['quote_type']),
            "customer_address": clean_val(r['customer_address']),
            "customer_tel": clean_val(r['customer_tel']),
            "customer_fax": clean_val(r['customer_fax']),
            "customer_email": clean_val(r['customer_email']),
            "last_synced_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }
        records.append(rec)

    print(f"[*] 레거시 유효 견적 {len(records)}건 변환 완료")

    chunk_size = 100
    success_count = 0
    for i in range(0, len(records), chunk_size):
        chunk = records[i:i + chunk_size]
        try:
            sb.table("legacy_quotations").upsert(chunk, on_conflict="legacy_idx").execute()
            success_count += len(chunk)
        except Exception as e:
            # 테이블이 아직 생성되지 않은 경우 친절한 안내 출력
            err_msg = str(e)
            if "legacy_quotations" in err_msg or "PGRST205" in err_msg:
                print(f"⚠️ Supabase에 'legacy_quotations' 테이블이 아직 생성되지 않았습니다.")
                print(f"👉 안내된 DDL 스크립트를 Supabase SQL Editor에서 먼저 1회 실행해 주세요.")
                return 0
            else:
                print(f"❌ 견적 청크 업서트 에러 ({i}~{i+len(chunk)}): {e}")

    print(f"✅ [legacy_quotations] 총 {success_count}건 Supabase 동기화 완료!")
    return success_count

def sync_unpaid(conn, sb, min_date='2010-01-01'):
    """
    3. 미수금 데이터 동기화: DREPORTFILE + CUSTOMERFILE -> Supabase legacy_unpaid
    """
    print(f"\n💰 [3/3] 미수금(DREPORTFILE) 데이터 동기화 시작 (기준일자: {min_date or '전체'})...")
    cur = conn.cursor(as_dict=True)
    where_date = f"AND A.OUTDT >= '{min_date}'" if min_date else ""
    sql = f"""
        SELECT 
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
        WHERE A.RESULT = 'OUT' AND A.PAY = '미결제' {where_date}
        ORDER BY A.PAY_PLAN_DT ASC, amount_vat DESC
    """
    cur.execute(sql)
    rows = cur.fetchall()

    records = []
    for r in rows:
        part = clean_val(r['part_no'])
        if not part: continue
        out_dt_str = r['out_date'].strftime('%Y-%m-%d') if r['out_date'] else None
        due_dt_str = r['due_date'].strftime('%Y-%m-%d') if r['due_date'] else None
        records.append({
            "legacy_idx": int(r['legacy_idx']),
            "customer_name": clean_val(r['customer_name']),
            "out_date": out_dt_str,
            "po_no": clean_val(r['po_no']),
            "part_name": part,
            "maker": clean_val(r['maker']) or "OTHERS",
            "qty": int(r['qty']) if r['qty'] else 0,
            "amount_vat": float(r['amount_vat']) if r['amount_vat'] else 0.0,
            "due_date": due_dt_str,
            "contact": clean_val(r['contact']),
            "sales_rep": clean_val(r['sales_rep']),
            "pay_status": clean_val(r['pay_status']) or "미결제",
            "overdue_days": int(r['overdue_days']) if r['overdue_days'] is not None else 0,
            "color_code": int(r['gubun_color']),
            "last_synced_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        })

    print(f"[*] 미수금 유효 데이터 {len(records)}건 변환 완료")
    if not records:
        return 0

    chunk_size = 100
    success_count = 0
    for i in range(0, len(records), chunk_size):
        chunk = records[i:i + chunk_size]
        try:
            sb.table("legacy_unpaid").upsert(chunk, on_conflict="legacy_idx").execute()
            success_count += len(chunk)
        except Exception as e:
            err_msg = str(e)
            if "legacy_unpaid" in err_msg or "PGRST205" in err_msg:
                print(f"⚠️ Supabase에 'legacy_unpaid' 테이블이 아직 생성되지 않았습니다.")
                print(f"   Supabase 대시보드 SQL Editor에서 DDL 스크립트를 먼저 실행해 주세요.")
                break
            else:
                print(f"❌ 미수금 청크 삽입 알림 ({i}~{i+len(chunk)}): {e}")

    print(f"✅ [legacy_unpaid] 총 {success_count}건 클라우드 동기화 완료!")
    return success_count

def sync_customers(conn, sb):
    """
    4. 거래처 및 담당자 마스터 동기화: CustomerFile + ContactFile -> Supabase legacy_customers
    """
    print(f"\n🏢 [4/4] 거래처 마스터(CustomerFile) 데이터 동기화 시작...")
    cur = conn.cursor(as_dict=True)
    sql = """
        SELECT 
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
        ORDER BY c.CID ASC
    """
    cur.execute(sql)
    rows = cur.fetchall()

    records = []
    for r in rows:
        cid = r['cid']
        kname = clean_val(r['kname'])
        cname = clean_val(r['cname'])
        if not kname and not cname:
            continue
        records.append({
            "cid": int(cid),
            "kname": kname,
            "cname": cname,
            "tel": clean_val(r['tel']) or clean_val(r['contact_tel']),
            "fax": clean_val(r['fax']),
            "address": clean_val(r['address']),
            "email": clean_val(r['email']) or clean_val(r['contact_email']),
            "sales_rep": clean_val(r['sales_rep']),
            "contact_name": clean_val(r['contact_name']),
            "contact_title": clean_val(r['contact_title']),
            "contact_tel": clean_val(r['contact_tel']),
            "contact_mobile": clean_val(r['contact_mobile']),
            "contact_email": clean_val(r['contact_email']),
            "last_synced_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        })

    print(f"[*] 거래처 유효 데이터 {len(records)}건 변환 완료")

    chunk_size = 100
    success_count = 0
    for i in range(0, len(records), chunk_size):
        chunk = records[i:i + chunk_size]
        try:
            sb.table("legacy_customers").upsert(chunk, on_conflict="cid").execute()
            success_count += len(chunk)
        except Exception as e:
            err_msg = str(e)
            if "legacy_customers" in err_msg or "PGRST205" in err_msg:
                print(f"⚠️ Supabase에 'legacy_customers' 테이블이 아직 생성되지 않았습니다.")
                print(f"   Supabase 대시보드 SQL Editor에서 DDL 스크립트를 먼저 실행해 주세요.")
                break
            else:
                print(f"❌ 거래처 청크 삽입 알림 ({i}~{i+len(chunk)}): {e}")

    print(f"✅ [legacy_customers] 총 {success_count}건 클라우드 동기화 완료!")
    return success_count

def sync_bundled_files(conn):
    """
    5. Vercel 클라우드 및 오프라인용 정적 번들 데이터(PO 2,828건, 단가 이력 27,000건) 파일 갱신
    """
    print(f"\n📦 [5/5] Vercel 배포용 번들 데이터(PO 및 단가 이력) 갱신 시작...")
    import legacy_mssql
    import json
    
    # 1. PO 전체 내역
    pos = legacy_mssql.query_purchase_orders(limit=10000)
    for p_dir in ["api/data", "data"]:
        os.makedirs(p_dir, exist_ok=True)
        with open(os.path.join(p_dir, "purchase_orders.json"), "w", encoding="utf-8") as f:
            json.dump(pos, f, ensure_ascii=False, default=float)
    print(f"[*] purchase_orders.json: 총 {len(pos)}건 저장 완료")

    # 2. 단가 이력 (매입/매출)
    cur = conn.cursor(as_dict=True)
    cur.execute("""
        SELECT 
            IDX as idx, INDT as in_date, INVOICENO as invoice_no, PARTNO as part_no, 
            MFG as maker, INQTY as qty, Slup as sl_up, SlAmt as sl_amt, 
            InRate as in_rate, Wup as w_up, WAmt as w_amt, Remark as remark
        FROM DincomeFile
        ORDER BY INDT DESC, IDX DESC
    """)
    incomes = []
    for r in cur.fetchall():
        incomes.append({
            "idx": r["idx"],
            "in_date": r["in_date"].strftime('%Y-%m-%d') if r.get("in_date") else "",
            "invoice_no": clean_val(r["invoice_no"]),
            "part_no": clean_val(r["part_no"]),
            "maker": clean_val(r["maker"]),
            "qty": int(r["qty"]) if r.get("qty") is not None else 0,
            "sl_up": float(r["sl_up"]) if r.get("sl_up") is not None else 0.0,
            "sl_amt": float(r["sl_amt"]) if r.get("sl_amt") is not None else 0.0,
            "in_rate": float(r["in_rate"]) if r.get("in_rate") is not None else 0.0,
            "w_up": float(r["w_up"]) if r.get("w_up") is not None else 0.0,
            "w_amt": float(r["w_amt"]) if r.get("w_amt") is not None else 0.0,
            "remark": clean_val(r["remark"])
        })

    cur.execute("""
        SELECT 
            r.IDX as idx, r.OUTDT as out_date, r.Partno as part_no, r.Mfg as maker, 
            r.Qty as qty, r.InUP as in_up, r.OutUP as out_up, r.OutAmt as out_amt, 
            r.MGN as mgn, r.Sales as sales_rep, c.Kname as customer_name, r.Remark as remark
        FROM DReportFile r
        LEFT JOIN CustomerFile c ON r.Custid = c.CID
        ORDER BY r.OUTDT DESC, r.IDX DESC
    """)
    sales = []
    for r in cur.fetchall():
        out_amt = float(r["out_amt"]) if r.get("out_amt") is not None else 0.0
        mgn = float(r["mgn"]) if r.get("mgn") is not None else 0.0
        sales.append({
            "idx": r["idx"],
            "out_date": r["out_date"].strftime('%Y-%m-%d') if r.get("out_date") else "",
            "part_no": clean_val(r["part_no"]),
            "maker": clean_val(r["maker"]),
            "qty": int(r["qty"]) if r.get("qty") is not None else 0,
            "in_up": float(r["in_up"]) if r.get("in_up") is not None else 0.0,
            "out_up": float(r["out_up"]) if r.get("out_up") is not None else 0.0,
            "out_amt": out_amt,
            "mgn": mgn,
            "sales_rep": clean_val(r["sales_rep"]),
            "customer_name": clean_val(r["customer_name"]),
            "remark": clean_val(r["remark"]),
            "mgn_rate": round(mgn / out_amt * 100, 2) if out_amt > 0 else 0.0
        })

    ph_data = {"incomes": incomes, "sales": sales}
    for p_dir in ["api/data", "data"]:
        with open(os.path.join(p_dir, "price_history.json"), "w", encoding="utf-8") as f:
            json.dump(ph_data, f, ensure_ascii=False, default=float)
    print(f"[*] price_history.json: 매입 {len(incomes)}건, 매출 {len(sales)}건 저장 완료")

    # 3. 출하 종합 원장 (shipped_info.json)
    try:
        shipped_rows = legacy_mssql.query_shipped_info(limit=3000)
        for p_dir in ["api/data", "data"]:
            with open(os.path.join(p_dir, "shipped_info.json"), "w", encoding="utf-8") as f:
                json.dump(shipped_rows, f, ensure_ascii=False, default=float)
        print(f"[*] shipped_info.json: 총 {len(shipped_rows)}건 저장 완료")
    except Exception as se:
        print(f"⚠️ shipped_info.json 갱신 예외: {se}")

    # 4. 매출/실적 분석 캐시 (sales_analytics_cache.json)
    try:
        curr_year = str(datetime.date.today().year)
        prev_year = str(datetime.date.today().year - 1)
        analytics_cache = {}
        for y in (curr_year, prev_year):
            analytics_cache[y] = {"all": legacy_mssql.get_sales_analytics(year=y, month="all")}
            for m in range(1, 13):
                analytics_cache[y][str(m)] = legacy_mssql.get_sales_analytics(year=y, month=str(m))
        for p_dir in ["api/data", "data"]:
            with open(os.path.join(p_dir, "sales_analytics_cache.json"), "w", encoding="utf-8") as f:
                json.dump(analytics_cache, f, ensure_ascii=False, default=float)
        print(f"[*] sales_analytics_cache.json ({prev_year}~{curr_year}년 월별/연간) 저장 완료")
    except Exception as ae:
        print(f"⚠️ sales_analytics_cache.json 갱신 예외: {ae}")

    # 5. Phase 1 확장 번들 (복수 담당자, 매입처, 지정 포워더, 재고상세, 대여/RMA/손실)
    try:
        all_contacts = legacy_mssql.query_customer_contacts(limit=10000)
        contacts_by_cid = {}
        for c in all_contacts:
            cid_key = str(c.get("cid", ""))
            if cid_key:
                contacts_by_cid.setdefault(cid_key, []).append(c)
        suppliers = legacy_mssql.query_suppliers(limit=3000)
        forwarders = legacy_mssql.query_forwarders(limit=2000)
        borrows = legacy_mssql.query_borrows(limit=1000)
        rmas = legacy_mssql.query_rmas(limit=500)
        losses = legacy_mssql.query_losses(limit=1000)

        # 보유재고 품목들의 입고량/스케줄/패킹 번들
        cur.execute("""
            SELECT TOP 2000 IDX as idx, PARTNO as part_no, INVOICENO as invoice_no, INDT as in_date,
                   INQTY as in_qty, NOTOUTQTY as remain_qty, DATACODE as date_code,
                   InRate as in_rate, Slup as sl_up, Wup as w_up, Remark as remark
            FROM DincomeFile
            WHERE NOTOUTQTY > 0
            ORDER BY INDT DESC, IDX DESC
        """)
        active_incomes = cur.fetchall()
        inv_details = {}
        active_parts = set()
        for r in active_incomes:
            p = clean_val(r["part_no"])
            inv = clean_val(r["invoice_no"])
            if not p:
                continue
            active_parts.add(p)
            inc_obj = {
                "idx": r["idx"], "invoice_no": inv,
                "in_date": r["in_date"].strftime('%Y-%m-%d') if r.get("in_date") else "",
                "in_qty": int(r["in_qty"] or 0), "remain_qty": int(r["remain_qty"] or 0),
                "date_code": clean_val(r["date_code"]),
                "in_rate": float(r["in_rate"] or 0.0), "sl_up": float(r["sl_up"] or 0.0),
                "w_up": float(r["w_up"] or 0.0), "remark": clean_val(r["remark"]),
            }
            for k in (p, f"{p}||{inv}"):
                slot = inv_details.setdefault(k, {"incomes": [], "schedules": [], "packings": []})
                if len(slot["incomes"]) < 5:
                    slot["incomes"].append(inc_obj)

        cur.execute("""
            SELECT s.IDX as idx, d.PARTNO as part_no, d.INVOICENO as invoice_no,
                   s.QTY as qty, s.SALES as sales, s.ACTUALCUSTOMER as actual_customer,
                   s.SCHEDULE_DT as schedule_dt
            FROM DincomeScheduleFile s
            INNER JOIN DincomeFile d ON s.IDX_IN = d.IDX
            ORDER BY s.SCHEDULE_DT DESC, s.IDX DESC
        """)
        for r in cur.fetchall():
            p = clean_val(r["part_no"])
            if p not in active_parts:
                continue
            inv = clean_val(r["invoice_no"])
            sch_obj = {
                "idx": r["idx"], "qty": int(r["qty"] or 0),
                "sales": clean_val(r["sales"]), "actual_customer": clean_val(r["actual_customer"]),
                "schedule_dt": clean_val(r["schedule_dt"]), "invoice_no": inv,
            }
            for k in (p, f"{p}||{inv}"):
                if k in inv_details and len(inv_details[k]["schedules"]) < 15:
                    inv_details[k]["schedules"].append(sch_obj)

        cur.execute("""
            SELECT TOP 5000 p.PIDX as pidx, s.PartNo as part_no, s.INVOICENO as invoice_no,
                   p.PACKQTY as pack_qty, p.DCLOT as dc_lot, p.FABLOTNO as fab_lot,
                   p.Weight as weight, p.CartonNo as carton_no, p.Dimension as dimension,
                   s.SHIPDT as ship_date
            FROM PackingFile p
            INNER JOIN ShippingFile s ON p.IDX = s.IDX
            ORDER BY p.PIDX DESC
        """)
        for r in cur.fetchall():
            p = clean_val(r["part_no"])
            if p not in active_parts:
                continue
            inv = clean_val(r["invoice_no"])
            pk_obj = {
                "pidx": r["pidx"], "pack_qty": int(r["pack_qty"] or 0),
                "dc_lot": clean_val(r["dc_lot"]), "fab_lot": clean_val(r["fab_lot"]),
                "weight": float(r["weight"] or 0.0), "carton_no": r["carton_no"],
                "dimension": clean_val(r["dimension"]), "invoice_no": inv,
                "ship_date": r["ship_date"].strftime('%Y-%m-%d') if r.get("ship_date") else "",
            }
            for k in (p, f"{p}||{inv}"):
                if k in inv_details and len(inv_details[k]["packings"]) < 15:
                    inv_details[k]["packings"].append(pk_obj)

        for p_dir in ["api/data", "data"]:
            with open(os.path.join(p_dir, "contacts_by_cid.json"), "w", encoding="utf-8") as f:
                json.dump(contacts_by_cid, f, ensure_ascii=False)
            with open(os.path.join(p_dir, "suppliers.json"), "w", encoding="utf-8") as f:
                json.dump(suppliers, f, ensure_ascii=False)
            with open(os.path.join(p_dir, "forwarders.json"), "w", encoding="utf-8") as f:
                json.dump(forwarders, f, ensure_ascii=False)
            with open(os.path.join(p_dir, "borrows_rma_loss.json"), "w", encoding="utf-8") as f:
                json.dump({"borrows": borrows, "rmas": rmas, "losses": losses}, f, ensure_ascii=False)
            with open(os.path.join(p_dir, "inventory_details.json"), "w", encoding="utf-8") as f:
                json.dump(inv_details, f, ensure_ascii=False)
        print(f"[*] Phase 1 번들 저장 완료: 담당자 {len(all_contacts)}명, 매입처 {len(suppliers)}건, 포워더 {len(forwarders)}건, 대여/RMA/손실 {len(borrows)}/{len(rmas)}/{len(losses)}건")
    except Exception as p1e:
        print(f"⚠️ Phase 1 번들 갱신 예외: {p1e}")

    # 6. Phase 2 확장 번들 (수입 통관·부대비용 DchargeFile & 해외 송금 FinanceFile)
    try:
        import_charges = legacy_mssql.query_import_charges(limit=1000)
        remittances = legacy_mssql.query_remittances(limit=1000)
        for p_dir in ["api/data", "data"]:
            with open(os.path.join(p_dir, "import_charges.json"), "w", encoding="utf-8") as f:
                json.dump(import_charges, f, ensure_ascii=False)
            with open(os.path.join(p_dir, "remittances.json"), "w", encoding="utf-8") as f:
                json.dump(remittances, f, ensure_ascii=False)
        print(f"[*] Phase 2 번들 저장 완료: 수입통관/부대비용 {len(import_charges)}건, 해외송금 T/T {len(remittances)}건")
    except Exception as p2e:
        print(f"⚠️ Phase 2 번들 갱신 예외: {p2e}")

    print(f"✅ 번들 데이터 갱신 완료!")

def main():
    parser = argparse.ArgumentParser(description="사내 MS-SQL -> Supabase 클라우드 동기화 브릿지")
    parser.add_argument("--only-inventory", action="store_true", help="재고(inventory_items)만 동기화")
    parser.add_argument("--only-quotations", action="store_true", help="견적(legacy_quotations)만 동기화")
    parser.add_argument("--only-unpaid", action="store_true", help="미수금(legacy_unpaid)만 동기화")
    parser.add_argument("--only-customers", action="store_true", help="거래처(legacy_customers)만 동기화")
    parser.add_argument("--only-bundle", action="store_true", help="Vercel/오프라인용 정적 번들 JSON만 갱신")
    parser.add_argument("--full-quotations", action="store_true", help="견적 전체(1999년~현재) 동기화")
    parser.add_argument("--since", default="2020-01-01", help="견적 동기화 시작일 (기본: 2020-01-01)")
    args = parser.parse_args()

    print(f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 사내 MS-SQL -> Supabase 데이터 동기화 시작...")
    
    sb = None
    if not args.only_bundle:
        try:
            sb = create_client(URL, KEY)
        except Exception as e:
            print(f"❌ Supabase 클라이언트 연결 실패: {e}")
            return

    try:
        conn = pymssql.connect(**LEGACY_DB_CONFIG)
    except Exception as e:
        print(f"❌ 사내 MS-SQL 연결 실패: {e}")
        return

    try:
        if args.only_quotations:
            min_date = None if args.full_quotations else args.since
            sync_quotations(conn, sb, min_date=min_date)
        elif args.only_inventory:
            sync_inventory(conn, sb)
        elif args.only_unpaid:
            min_date = "2010-01-01" if args.since == "2020-01-01" else args.since
            sync_unpaid(conn, sb, min_date=min_date)
        elif args.only_customers:
            sync_customers(conn, sb)
        elif args.only_bundle:
            sync_bundled_files(conn)
        else:
            sync_inventory(conn, sb)
            min_date = None if args.full_quotations else args.since
            sync_quotations(conn, sb, min_date=min_date)
            sync_unpaid(conn, sb, min_date="2010-01-01")
            sync_customers(conn, sb)
            sync_bundled_files(conn)
    finally:
        conn.close()

    print(f"\n[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 전체 동기화 정상 종료.")

if __name__ == '__main__':
    main()
