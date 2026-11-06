#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import datetime
import pymssql
from supabase import create_client

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
KEY = os.getenv("SUPABASE_SERVICE_KEY", "").strip()


LEGACY_DB_CONFIG = {
    'server': '192.168.0.105',
    'port': 1433,
    'user': 'linemsid',
    'password': 'linepasswd',
    'database': 'BigLinemaster',
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

def main():
    print(f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 재고/AMOUNT 기준 정밀 일치화 동기화 시작...")
    
    try:
        sb = create_client(URL, KEY)
    except Exception as e:
        print(f"❌ Supabase 클라이언트 연결 실패: {e}")
        return

    try:
        conn = pymssql.connect(**LEGACY_DB_CONFIG)
        cur = conn.cursor(as_dict=True)
    except Exception as e:
        print(f"❌ 사내 MS-SQL 연결 실패: {e}")
        return

    # 미출고 가용 수량(NOTOUTQTY > 0) 재고 조회
    query = """
        SELECT 
            IDX, INVOICENO, PARTNO, MFG, INDT, INQTY, NOTOUTQTY, 
            WOUP, Wup, Slup, InRate, RealSales, DATACODE, Remark
        FROM DincomeFile
        WHERE NOTOUTQTY > 0
        ORDER BY INDT DESC, IDX DESC
    """
    cur.execute(query)
    rows = cur.fetchall()
    conn.close()

    items = []
    ship_fx = 1350.0

    for r in rows:
        part = clean_val(r['PARTNO'])
        if not part:
            continue
        
        # 레거시 BSK 재고관리 그리드의 '재고량' 및 'AMOUNT' 기준은 NOTOUTQTY
        remain_qty = int(r['NOTOUTQTY']) if r['NOTOUTQTY'] else 0
        
        indt_str = r['INDT'].strftime('%Y-%m-%d') if r['INDT'] else '2026-01-01'
        owner_val = clean_val(r['RealSales']) or 'BSK'
        
        # WOUP 원화 단가
        krw_cost = float(r['WOUP']) if r['WOUP'] else (float(r['Wup']) if r['Wup'] else 0.0)
        unit_usd = krw_cost / ship_fx if krw_cost > 0 else 0.0

        record = {
            "part_name": part,
            "maker": clean_val(r['MFG']) or "OTHERS",
            "stock": remain_qty,            # 레거시 그리드와 동일하게 현재고(1,729,858 EA)로 지정
            "arranged_qty": 0,              # 레거시의 ARRANGED_ 기본값과 일치
            "unit_usd": unit_usd,
            "ship_fx": ship_fx,
            "owner": owner_val,
            "entry_date": indt_str,
            "invoice_no": clean_val(r['INVOICENO']),
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

    print(f"[*] 레거시 유효 재고 {len(items)}건 변환 완료")

    try:
        sb.table("inventory_items").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    except Exception as e:
        print(f"⚠️ 테이블 초기화 알림: {e}")

    chunk_size = 100
    success_count = 0
    for i in range(0, len(items), chunk_size):
        chunk = items[i:i + chunk_size]
        try:
            sb.table("inventory_items").insert(chunk).execute()
            success_count += len(chunk)
        except Exception as e:
            print(f"❌ 청크 삽입 에러 ({i}~{i+len(chunk)}): {e}")

    print(f"✅ [inventory_items] 총 {success_count}건 웹 ERP 반영 완료!")
    print(f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 동기화 정상 종료.")

if __name__ == '__main__':
    main()
