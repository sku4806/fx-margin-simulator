# database.py
import sqlite3

DB_NAME = "products.db"

def init_db():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            part_number TEXT UNIQUE NOT NULL,      -- 품번 / 제품명
            unit_price_usd REAL NOT NULL,          -- 매입 외화 단가 (USD)
            shipping_fx_rate REAL NOT NULL,        -- 선적 시점 적용 환율 (KRW)
            target_margin_rate REAL DEFAULT 0.20,  -- 기본 목표 마진율 (기본 20%)
            msrp_krw REAL NOT NULL                 -- 기준 소비자가 / 정가 (KRW)
        )
    """)
    conn.commit()
    conn.close()

def get_all_products():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM products")
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows

def insert_or_update_product(part_number, unit_price_usd, shipping_fx_rate, target_margin_rate, msrp_krw):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO products (part_number, unit_price_usd, shipping_fx_rate, target_margin_rate, msrp_krw)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(part_number) DO UPDATE SET
            unit_price_usd=excluded.unit_price_usd,
            shipping_fx_rate=excluded.shipping_fx_rate,
            target_margin_rate=excluded.target_margin_rate,
            msrp_krw=excluded.msrp_krw
    """, (part_number, unit_price_usd, shipping_fx_rate, target_margin_rate, msrp_krw))
    conn.commit()
    conn.close()
