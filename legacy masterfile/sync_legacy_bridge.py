# -*- coding: utf-8 -*-
import os, sys, time, datetime, pymssql
from supabase import create_client

LEGACY_DB_CONFIG = {
    "server": "192.168.0.105",
    "port": 1433,
    "user": "linemsid",
    "password": "linepasswd",
    "database": "BigLinemaster",
    "charset": "CP949",
    "tds_version": "7.0",
    "timeout": 15
}

raw_url = os.getenv("SUPABASE_URL", "").strip().encode("ascii", "ignore").decode("ascii")
raw_key = os.getenv("SUPABASE_SERVICE_KEY", "").strip().encode("ascii", "ignore").decode("ascii")

def sanitize_str(val):
    if val is None:
        return ""
    if isinstance(val, bytes):
        try:
            return val.decode("cp949", errors="ignore").strip()
        except:
            return val.decode("utf-8", errors="ignore").strip()
    return str(val).strip()

def fetch_orders(cursor):
    query = """
        SELECT idx, Custid, SDT, PONO, Partno, Mfg, Qty, Woup, Wamt, Slup, Slamt, Result
        FROM DOutFile
        WHERE SDT >= DATEADD(day, -14, GETDATE())
        ORDER BY SDT DESC, idx DESC
    """
    cursor.execute(query)
    out = []
    for r in cursor.fetchall():
        part = sanitize_str(r["Partno"])
        if not part: continue
        sdt_str = r["SDT"].strftime("%Y-%m-%d") if r["SDT"] else None
        res_flag = sanitize_str(r["Result"]).upper()
        out.append({
            "legacy_out_id": int(r["idx"]),
            "part_name": part,
            "maker": sanitize_str(r["Mfg"]) or "OTHERS",
            "qty": int(r["Qty"]) if r["Qty"] else 0,
            "unit_price": float(r["Slup"]) if r["Slup"] else 0.0,
            "cost_price": float(r["Woup"]) if r["Woup"] else 0.0,
            "total_sales_amount": float(r["Slamt"]) if r["Slamt"] else 0.0,
            "po_no": sanitize_str(r["PONO"]),
            "order_date": sdt_str,
            "status": "SHIPPED" if res_flag == "Y" else "PENDING",
            "last_synced_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        })
    return out

def fetch_stock(cursor):
    query = """
        SELECT STOCK, PARTNO, RemainTotQty, RemainQty, ArrangedQty, AvailQty, Customer, INPUTDT
        FROM BSWInventory
        WHERE RemainTotQty IS NOT NULL AND RemainTotQty <> ''
    """
    cursor.execute(query)
    out = []
    for r in cursor.fetchall():
        raw_tot = sanitize_str(r["RemainTotQty"])
        try: tot = int(raw_tot)
        except: tot = 0
        if tot <= 0: continue
        part = sanitize_str(r["PARTNO"])
        if not part: continue
        loc = sanitize_str(r["STOCK"]) or "BSK"
        raw_av = sanitize_str(r["AvailQty"])
        try: av = int(raw_av) if raw_av else tot
        except: av = tot
        dt = r["INPUTDT"].strftime("%Y-%m-%d") if r["INPUTDT"] else "2026-01-01"
        out.append({
            "sync_key": f"{part}_{loc}",
            "part_name": part,
            "stock_location": loc,
            "total_qty": tot,
            "avail_qty": av,
            "date_code": dt,
            "customer_tag": sanitize_str(r["Customer"]),
            "last_synced_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        })
    return out

def main():
    os.environ["TDSVER"] = "7.0"
    print(f"[*] Supabase URL: {raw_url[:30]}...")
    try:
        sb = create_client(raw_url, raw_key)
        print("[*] Supabase 클라이언트 생성 성공")
    except Exception as e:
        print(f"[!] Supabase 초기화 에러: {e}")
        return

    conn = pymssql.connect(**LEGACY_DB_CONFIG)
    cur = conn.cursor(as_dict=True)
    orders = fetch_orders(cur)
    stocks = fetch_stock(cur)
    conn.close()

    print(f"[*] 추출 완료: 출하 {len(orders)}건, 재고 {len(stocks)}건")
    
    if orders:
        try:
            sb.table("legacy_shipments").upsert(orders, on_conflict="legacy_out_id").execute()
        except Exception as e:
            print(f"[!] 출하 업서트 에러: {e}")

    if stocks:
        try:
            sb.table("legacy_inventory").upsert(stocks, on_conflict="sync_key").execute()
        except Exception as e:
            print(f"[!] 재고 업서트 에러: {e}")

if __name__ == '__main__':
    main()
