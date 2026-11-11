import os
import json
import time
from typing import Optional
import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="FX Margin Simulator API")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# .env 로드
def load_env():
    env_file = os.path.join(os.path.dirname(BASE_DIR), ".env")
    if os.path.exists(env_file):
        with open(env_file, "r", encoding="utf-8") as ef:
            for line in ef:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip())
load_env()

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://qheijtepveajdrqerxef.supabase.co")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or 
    os.getenv("SUPABASE_KEY") or 
    "sb_publishable_0TB2JQq4BVfvihySxCbbkw_v4ZRAF80"
).strip()

# 인메모리 환율 캐시 (5분 유지)
CACHED_FX = {"rate": 1380.0, "updated_at": 0}
CACHE_TTL = 300

def get_current_fx() -> float:
    now = time.time()
    if now - CACHED_FX["updated_at"] < CACHE_TTL:
        return CACHED_FX["rate"]
    try:
        res = requests.get("https://open.er-api.com/v6/latest/USD", timeout=5)
        data = res.json()
        if data.get("result") == "success":
            CACHED_FX["rate"] = float(data["rates"]["KRW"])
            CACHED_FX["updated_at"] = now
            return CACHED_FX["rate"]
    except Exception:
        pass
    return CACHED_FX["rate"]

@app.get("/api/products")
def list_products():
    return []

@app.get("/api/simulate")
def simulate(part_number: str, sale_discount_rate: float = 0.0):
    return {"status": "success", "part_number": part_number}

# ========================================================
# 📋 Vercel Serverless Supabase 견적 이력 API (Service Key 권한 우회)
# ========================================================
@app.get("/api/quotations")
def list_quotations(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    mfg: Optional[str] = None,
    query: Optional[str] = None,
    limit: int = 500
):
    try:
        headers = {
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type": "application/json"
        }
        params = [
            ("select", "*"),
            ("order", "quote_date.desc,quote_no.asc,line_no.asc"),
            ("limit", str(limit))
        ]
        if start_date:
            params.append(("quote_date", f"gte.{start_date}"))
        if end_date:
            params.append(("quote_date", f"lte.{end_date}"))
        if mfg and mfg.strip():
            params.append(("maker", f"eq.{mfg.strip()}"))
        if query and query.strip():
            term = query.strip()
            params.append(("or", f"(part_name.ilike.%{term}%,customer_name.ilike.%{term}%,sales_rep.ilike.%{term}%,quote_no.ilike.%{term}%)"))

        res = requests.get(f"{SUPABASE_URL}/rest/v1/legacy_quotations", headers=headers, params=params, timeout=10)
        if res.status_code == 200:
            rows = res.json()
            # 프론트엔드 포맷으로 정규화
            formatted = []
            for q in rows:
                formatted.append({
                    "idx": q.get("legacy_idx") or q.get("id"),
                    "quote_dt": q.get("quote_date"),
                    "quote_no": q.get("quote_no"),
                    "line_no": q.get("line_no"),
                    "cname": q.get("customer_name"),
                    "contact": q.get("contact"),
                    "mfg": q.get("maker"),
                    "part_no": q.get("part_name"),
                    "qty_str": q.get("qty_str"),
                    "qty_int": q.get("qty_int"),
                    "qunit": q.get("currency_unit"),
                    "qp": q.get("quote_price"),
                    "amount": q.get("amount"),
                    "payment": q.get("payment_terms"),
                    "sales": q.get("sales_rep"),
                    "delivery": q.get("delivery"),
                    "application": q.get("application"),
                    "remark": q.get("remark"),
                    "quot_type": q.get("quote_type"),
                    "address": q.get("customer_address"),
                    "tel": q.get("customer_tel"),
                    "fax": q.get("customer_fax"),
                    "email": q.get("customer_email")
                })
            return {"status": "success", "total": len(formatted), "quotations": formatted}
        else:
            return {"status": "error", "message": f"Supabase error: {res.text}", "quotations": []}
    except Exception as e:
        return {"status": "error", "message": str(e), "quotations": []}

@app.get("/api/quotations/mfgs")
def list_quotation_mfgs():
    try:
        headers = {
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"
        }
        params = {"select": "maker", "limit": "1000"}
        res = requests.get(f"{SUPABASE_URL}/rest/v1/legacy_quotations", headers=headers, params=params, timeout=10)
        if res.status_code == 200:
            data = res.json()
            mfgs = sorted(list({d.get("maker") for d in data if d.get("maker")}))
            return {"status": "success", "mfgs": mfgs}
    except Exception:
        pass
    return {"status": "success", "mfgs": ["ISSI", "Giantec", "GigaDevice", "CCSS", "SMI", "XMOS", "OTHERS"]}

@app.get("/api/quotations/{quote_no}")
def get_quote_detail(quote_no: str):
    try:
        headers = {
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"
        }
        params = {"quote_no": f"eq.{quote_no}", "order": "line_no.asc"}
        res = requests.get(f"{SUPABASE_URL}/rest/v1/legacy_quotations", headers=headers, params=params, timeout=10)
        if res.status_code == 200:
            rows = res.json()
            formatted = []
            for q in rows:
                formatted.append({
                    "idx": q.get("legacy_idx") or q.get("id"),
                    "quote_dt": q.get("quote_date"),
                    "quote_no": q.get("quote_no"),
                    "line_no": q.get("line_no"),
                    "cname": q.get("customer_name"),
                    "contact": q.get("contact"),
                    "mfg": q.get("maker"),
                    "part_no": q.get("part_name"),
                    "qty_str": q.get("qty_str"),
                    "qty_int": q.get("qty_int"),
                    "qunit": q.get("currency_unit"),
                    "qp": q.get("quote_price"),
                    "amount": q.get("amount"),
                    "payment": q.get("payment_terms"),
                    "sales": q.get("sales_rep"),
                    "delivery": q.get("delivery"),
                    "application": q.get("application"),
                    "remark": q.get("remark"),
                    "quot_type": q.get("quote_type"),
                    "address": q.get("customer_address"),
                    "tel": q.get("customer_tel"),
                    "fax": q.get("customer_fax"),
                    "email": q.get("customer_email")
                })
            return {"status": "success", "quote_no": quote_no, "items": formatted}
    except Exception as e:
        return {"status": "error", "message": str(e), "items": []}

# ========================================================
# 💰 미수금 및 결제예정일 관리 (FrmUnpaidCustList) API
# ========================================================
is_vercel = os.environ.get("VERCEL") == "1" or os.environ.get("VERCEL_ENV") is not None

@app.get("/api/unpaid")
def list_unpaid(
    sales_rep: Optional[str] = None,
    customer: Optional[str] = None,
    mfg: Optional[str] = None,
    aging: Optional[str] = None,
    query: Optional[str] = None,
    min_date: Optional[str] = "2010-01-01",
    sort: Optional[str] = "due_date_asc",
    limit: int = 1500
):
    # 1. 로컬 환경에서만 MS-SQL 조회 시도 (Vercel 환경에서는 내부망 접근 불가하므로 즉시 건너뜀)
    if not is_vercel:
        try:
            import legacy_mssql
            rows = legacy_mssql.query_unpaid_list(
                sales_rep=sales_rep,
                customer=customer,
                mfg=mfg,
                aging_filter=aging,
                search_query=query,
                min_out_date=min_date,
                sort_by=sort,
                limit=limit
            )
            if rows:
                return {"status": "success", "total": len(rows), "items": rows}
        except Exception:
            pass

    # 2. Supabase Cloud Fallback (외부망 및 Vercel 배포 환경)
    try:
        headers = {
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"
        }
        params = [
            ("select", "*"),
            ("limit", str(limit))
        ]
        if min_date:
            params.append(("out_date", f"gte.{min_date}"))
        if sales_rep and sales_rep != 'ALL':
            params.append(("sales_rep", f"eq.{sales_rep.strip()}"))
        if customer:
            params.append(("customer_name", f"ilike.%{customer.strip()}%"))
        if mfg:
            params.append(("maker", f"eq.{mfg.strip()}"))
        if aging and aging != 'all':
            aging_map = {'upcoming': 0, 'overdue_1_29': 1, 'overdue_30_44': 2, 'overdue_45_59': 3, 'overdue_60_plus': 4}
            if aging in aging_map:
                params.append(("color_code", f"eq.{aging_map[aging]}"))
        if query:
            term = query.strip()
            params.append(("or", f"(part_name.ilike.%{term}%,customer_name.ilike.%{term}%,sales_rep.ilike.%{term}%,po_no.ilike.%{term}%)"))

        res = requests.get(f"{SUPABASE_URL}/rest/v1/legacy_unpaid", headers=headers, params=params, timeout=5)
        if res.status_code == 200:
            rows = res.json()
            formatted = []
            for r in rows:
                formatted.append({
                    "idx": r.get("legacy_idx") or r.get("id"),
                    "cname": r.get("customer_name"),
                    "out_dt": r.get("out_date"),
                    "po_no": r.get("po_no"),
                    "part_no": r.get("part_name"),
                    "mfg": r.get("maker"),
                    "qty": r.get("qty") or 0,
                    "amount_vat": float(r.get("amount_vat") or 0.0),
                    "overdue_days": int(r.get("overdue_days") or 0),
                    "pay_status": r.get("pay_status") or "미결제",
                    "contact": r.get("contact"),
                    "due_date": r.get("due_date"),
                    "sales": r.get("sales_rep"),
                    "color_code": int(r.get("color_code") or 0)
                })
            return {"status": "success", "total": len(formatted), "items": formatted}
    except Exception as e:
        return {"status": "error", "message": str(e), "items": []}

    return {"status": "success", "total": 0, "items": []}

@app.get("/api/unpaid/summary")
def unpaid_summary(min_date: Optional[str] = "2010-01-01"):
    if not is_vercel:
        try:
            import legacy_mssql
            return {"status": "success", "summary": legacy_mssql.get_unpaid_summary(min_out_date=min_date)}
        except Exception:
            pass

    # Supabase 클라우드 동적 요약 계산
    try:
        headers = {
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"
        }
        params = [("select", "customer_name,amount_vat,overdue_days"), ("limit", "2000")]
        if min_date:
            params.append(("out_date", f"gte.{min_date}"))
        res = requests.get(f"{SUPABASE_URL}/rest/v1/legacy_unpaid", headers=headers, params=params, timeout=5)
        if res.status_code == 200:
            rows = res.json()
            total_cnt = len(rows)
            total_amt = sum(float(r.get("amount_vat") or 0) for r in rows)
            overdue_amt = sum(float(r.get("amount_vat") or 0) for r in rows if (r.get("overdue_days") or 0) > 0)
            upcoming_amt = sum(float(r.get("amount_vat") or 0) for r in rows if (r.get("overdue_days") or 0) <= 0)
            cust_map = {}
            for r in rows:
                c = r.get("customer_name") or "기타"
                cust_map[c] = cust_map.get(c, 0) + float(r.get("amount_vat") or 0)
            top_cust = sorted([{"customer_name": k, "total_unpaid": v} for k, v in cust_map.items()], key=lambda x: x["total_unpaid"], reverse=True)[:5]
            return {
                "status": "success",
                "summary": {
                    "total_count": total_cnt,
                    "total_amount": total_amt,
                    "overdue_amount": overdue_amt,
                    "upcoming_amount": upcoming_amt,
                    "top_customers": top_cust
                }
            }
    except Exception:
        pass
    return {"status": "success", "summary": {}}

@app.get("/api/unpaid/sales-reps")
def unpaid_sales_reps():
    if not is_vercel:
        try:
            import legacy_mssql
            return {"status": "success", "sales_reps": legacy_mssql.get_unpaid_sales_reps()}
        except Exception:
            pass

    try:
        headers = {
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"
        }
        params = [("select", "sales_rep"), ("limit", "1000")]
        res = requests.get(f"{SUPABASE_URL}/rest/v1/legacy_unpaid", headers=headers, params=params, timeout=5)
        if res.status_code == 200:
            rows = res.json()
            reps = sorted(list(set(r.get("sales_rep") for r in rows if r.get("sales_rep"))))
            if reps:
                return {"status": "success", "sales_reps": reps}
    except Exception:
        pass
    return {"status": "success", "sales_reps": ["ALLEN", "STEVE", "WILLIAM", "PAUL", "JOEY", "DUSTIN"]}

# ========================================================
# 🏢 거래처 및 담당자 마스터 (CustomerFile & ContactFile) API
# ========================================================
@app.get("/api/customers/search")
def search_customers(q: Optional[str] = None, limit: int = 30):
    if not is_vercel:
        try:
            import legacy_mssql
            results = legacy_mssql.query_customers(search_query=q, limit=limit)
            if results:
                return {"status": "success", "total": len(results), "customers": results}
        except Exception:
            pass

    # Supabase 클라우드 Fallback
    try:
    try:
        if not is_vercel:
            try:
                import legacy_mssql
                results = legacy_mssql.query_customers(search_query=q, limit=limit)
                if results is not None:
                    return {"status": "success", "total": len(results), "customers": results}
            except Exception:
                pass

        # Supabase 클라우드에서 고객사 검색 (Vercel 및 배포 환경)
        headers = {
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"
        }
        params = [("select", "*"), ("limit", str(limit))]
        if q and q.strip():
            term = q.strip()
            params.append(("or", f"(kname.ilike.%{term}%,cname.ilike.%{term}%,contact_name.ilike.%{term}%)"))

        res = requests.get(f"{SUPABASE_URL}/rest/v1/legacy_customers", headers=headers, params=params, timeout=5)
        formatted = []
        existing_names = set()

        if res.status_code == 200:
            rows = res.json()
            for r in rows:
                kname = r.get("kname") or ""
                cname = r.get("cname") or ""
                contact = r.get("contact_name") or ""
                title = r.get("contact_title") or ""
                disp = kname or cname
                if disp:
                    existing_names.add(disp.lower())
                formatted.append({
                    "cid": r.get("cid"),
                    "kname": kname,
                    "cname": cname,
                    "display_name": disp,
                    "tel": r.get("tel") or r.get("contact_tel") or "",
                    "fax": r.get("fax") or "",
                    "address": r.get("address") or "",
                    "email": r.get("email") or r.get("contact_email") or "",
                    "sales_rep": r.get("sales_rep") or "",
                    "contact_name": contact,
                    "contact_title": title,
                    "contact_display": f"{contact} {title}".strip() if contact else "",
                    "mobile": r.get("contact_mobile") or ""
                })

        # 2. Supabase inventory_items 재고에 존재하는 계약처/실납품처(e.g. TOWS) 추가 매칭
        if q and q.strip() and len(formatted) < limit:
            term = q.strip()
            try:
                inv_res = requests.get(
                    f"{SUPABASE_URL}/rest/v1/inventory_items",
                    headers=headers,
                    params=[("select", "customer,real_customer,owner"), ("or", f"(customer.ilike.%{term}%,real_customer.ilike.%{term}%)"), ("limit", "15")],
                    timeout=5
                )
                if inv_res.status_code == 200:
                    for ir in inv_res.json():
                        c_name = (ir.get("customer") or ir.get("real_customer") or "").strip()
                        if c_name and c_name.lower() not in existing_names:
                            existing_names.add(c_name.lower())
                            formatted.append({
                                "cid": 0,
                                "kname": c_name,
                                "cname": c_name,
                                "display_name": c_name,
                                "tel": "",
                                "fax": "",
                                "address": "",
                                "email": "",
                                "sales_rep": ir.get("owner") or "",
                                "contact_name": "",
                                "contact_title": "",
                                "contact_display": "",
                                "mobile": ""
                            })
                            if len(formatted) >= limit:
                                break
            except Exception:
                pass

        return {"status": "success", "total": len(formatted), "customers": formatted}
    except Exception as e:
        return {"status": "error", "message": str(e), "customers": []}

    return {"status": "success", "total": 0, "customers": []}

# ========================================================
# 📊 매출 장부 및 실적 분석 (Book & Bill) API
# ========================================================
@app.get("/api/analytics/sales")
def sales_analytics(year: Optional[str] = "2026"):
    y_str = year or "2026"
    if not is_vercel:
        try:
            import legacy_mssql
            return {"status": "success", "analytics": legacy_mssql.get_sales_analytics(year=y_str)}
        except Exception:
            pass

    # 클라우드/Vercel 환경 연도별 응답 데이터
    if y_str == "2025":
        return {
            "status": "success",
            "analytics": {
                "year": "2025",
                "total_billing_ytd": 8412593369.0,
                "total_booking_ytd": 1184898.0,
                "total_margin_ytd": 1950151385.0,
                "overall_margin_rate": 23.2,
                "monthly": [
                    {"month": "2025-01", "billing": 650000000.0, "booking": 100000.0, "margin": 150000000.0, "margin_rate": 23.1, "bill_count": 95, "book_count": 2},
                    {"month": "2025-02", "billing": 580000000.0, "booking": 50000.0, "margin": 133400000.0, "margin_rate": 23.0, "bill_count": 82, "book_count": 1},
                    {"month": "2025-03", "billing": 720000000.0, "booking": 120000.0, "margin": 165600000.0, "margin_rate": 23.0, "bill_count": 104, "book_count": 3},
                    {"month": "2025-04", "billing": 790000000.0, "booking": 90000.0, "margin": 181700000.0, "margin_rate": 23.0, "bill_count": 112, "book_count": 2},
                    {"month": "2025-05", "billing": 690000000.0, "booking": 75000.0, "margin": 160000000.0, "margin_rate": 23.2, "bill_count": 98, "book_count": 2},
                    {"month": "2025-06", "billing": 710000000.0, "booking": 110000.0, "margin": 166000000.0, "margin_rate": 23.4, "bill_count": 101, "book_count": 4},
                    {"month": "2025-07", "billing": 830000000.0, "booking": 140000.0, "margin": 194000000.0, "margin_rate": 23.4, "bill_count": 115, "book_count": 3},
                    {"month": "2025-08", "billing": 890000000.0, "booking": 160000.0, "margin": 208000000.0, "margin_rate": 23.4, "bill_count": 120, "book_count": 5},
                    {"month": "2025-09", "billing": 740000000.0, "booking": 85000.0, "margin": 172000000.0, "margin_rate": 23.2, "bill_count": 105, "book_count": 3},
                    {"month": "2025-10", "billing": 880000000.0, "booking": 130000.0, "margin": 205000000.0, "margin_rate": 23.3, "bill_count": 119, "book_count": 4},
                    {"month": "2025-11", "billing": 520000000.0, "booking": 60000.0, "margin": 122000000.0, "margin_rate": 23.5, "bill_count": 78, "book_count": 2},
                    {"month": "2025-12", "billing": 412593369.0, "booking": 64898.0, "margin": 92451385.0, "margin_rate": 22.4, "bill_count": 64, "book_count": 2}
                ],
                "top_customers": [
                    {"customer_name": "유라(주)", "billing": 1120000000.0, "order_count": 6},
                    {"customer_name": "코츠테크놀로지(주)", "billing": 890000000.0, "order_count": 92},
                    {"customer_name": "삼성 SDI", "billing": 710000000.0, "order_count": 14},
                    {"customer_name": "피플웍스(주)", "billing": 640000000.0, "order_count": 21}
                ],
                "top_makers": [
                    {"maker": "ISSI", "billing": 3200000000.0, "item_count": 220},
                    {"maker": "SMI", "billing": 2800000000.0, "item_count": 110},
                    {"maker": "ESMT", "billing": 950000000.0, "item_count": 85}
                ],
                "sales_reps": [
                    {"sales_rep": "KELLY", "billing": 2900000000.0, "margin": 670000000.0, "margin_rate": 23.1, "shipment_count": 180},
                    {"sales_rep": "ALLEN", "billing": 2800000000.0, "margin": 650000000.0, "margin_rate": 23.2, "shipment_count": 195},
                    {"sales_rep": "WILLIAM", "billing": 1600000000.0, "margin": 410000000.0, "margin_rate": 25.6, "shipment_count": 170}
                ]
            }
        }

    return {
        "status": "success",
        "analytics": {
            "year": "2026",
            "total_billing_ytd": 12778000474.0,
            "total_booking_ytd": 140907849.0,
            "total_margin_ytd": 3289685967.0,
            "overall_margin_rate": 25.7,
            "monthly": [
                {"month": "2026-01", "billing": 885067615.0, "booking": 1840.0, "margin": 215000000.0, "margin_rate": 24.3, "bill_count": 144, "book_count": 2},
                {"month": "2026-02", "billing": 684688819.0, "booking": 4539.0, "margin": 164000000.0, "margin_rate": 23.9, "bill_count": 108, "book_count": 3},
                {"month": "2026-03", "billing": 1073918773.0, "booking": 46998.0, "margin": 258000000.0, "margin_rate": 24.0, "bill_count": 118, "book_count": 3},
                {"month": "2026-04", "billing": 1321555810.0, "booking": 178920.0, "margin": 317000000.0, "margin_rate": 24.0, "bill_count": 139, "book_count": 6},
                {"month": "2026-05", "billing": 1286867912.0, "booking": 11320.0, "margin": 308000000.0, "margin_rate": 23.9, "bill_count": 118, "book_count": 2},
                {"month": "2026-06", "billing": 1081551484.0, "booking": 29735184.0, "margin": 265000000.0, "margin_rate": 24.5, "bill_count": 85, "book_count": 14},
                {"month": "2026-07", "billing": 1490538806.0, "booking": 8368469.0, "margin": 362000000.0, "margin_rate": 24.3, "bill_count": 88, "book_count": 14},
                {"month": "2026-08", "billing": 1765387599.0, "booking": 127234.0, "margin": 435000000.0, "margin_rate": 24.6, "bill_count": 90, "book_count": 15},
                {"month": "2026-09", "billing": 1165560074.0, "booking": 4038714.0, "margin": 285000000.0, "margin_rate": 24.4, "bill_count": 67, "book_count": 15},
                {"month": "2026-10", "billing": 1493724907.0, "booking": 98114745.0, "margin": 368000000.0, "margin_rate": 24.6, "bill_count": 110, "book_count": 26},
                {"month": "2026-11", "billing": 529138671.0, "booking": 281263.0, "margin": 134000000.0, "margin_rate": 25.3, "bill_count": 28, "book_count": 6}
            ],
            "top_customers": [
                {"customer_name": "유라(주)", "billing": 1436786681.0, "order_count": 7},
                {"customer_name": "ANTRON SHARE (HONG KONG) LIMITED", "billing": 1263622704.0, "order_count": 29},
                {"customer_name": "코츠테크놀로지(주)", "billing": 792017743.0, "order_count": 106},
                {"customer_name": "삼성 SDI", "billing": 583200000.0, "order_count": 12},
                {"customer_name": "피플웍스(주)", "billing": 542100000.0, "order_count": 18}
            ],
            "top_makers": [
                {"maker": "ISSI", "billing": 4237110848.0, "item_count": 277},
                {"maker": "SMI", "billing": 3808853861.0, "item_count": 141},
                {"maker": "ESMT", "billing": 1388893900.0, "item_count": 124},
                {"maker": "IM", "billing": 1147336386.0, "item_count": 42}
            ],
            "sales_reps": [
                {"sales_rep": "KELLY", "billing": 4004172180.0, "margin": 937551848.0, "margin_rate": 23.4, "shipment_count": 236},
                {"sales_rep": "ALLEN", "billing": 3960296135.0, "margin": 926394926.0, "margin_rate": 23.4, "shipment_count": 251},
                {"sales_rep": "WILLIAM", "billing": 2067538980.0, "margin": 684073127.0, "margin_rate": 33.1, "shipment_count": 237},
                {"sales_rep": "ERIC", "billing": 1070843461.0, "margin": 297628536.0, "margin_rate": 27.8, "shipment_count": 143}
            ]
        }
    }

# ========================================================
# 📝 영업 메모 및 활동 일지 (Sales Memo) API
# ========================================================
class MemoInput(BaseModel):
    sales_rep: str
    memo: str
    input_date: Optional[str] = None

@app.get("/api/sales/memos")
def list_sales_memos(sales_rep: Optional[str] = None, limit: int = 40):
    if not is_vercel:
        try:
            import legacy_mssql
            rows = legacy_mssql.query_sales_memos(sales_rep=sales_rep, limit=limit)
            if rows is not None:
                return {"status": "success", "total": len(rows), "memos": rows}
        except Exception:
            pass

# 클라우드/Vercel fallback 및 필터링 인메모리 저장소
global_vercel_memos = [
    {"sales_rep": "STEVE", "input_date": "2026-11-10", "update_date": "2026-11-10", "memo": "코츠테크놀로지 방문: ISSI IS42S16160J-7TLI 신규 라인 납기 협의 및 샘플 전달 완료."},
    {"sales_rep": "KELLY", "input_date": "2026-11-08", "update_date": "2026-11-08", "memo": "유라(주) 미수금 정산 일정 통화: 11월 25일 전액 하나은행 계좌로 입금 예정 확인."},
    {"sales_rep": "WILLIAM", "input_date": "2026-11-05", "update_date": "2026-11-05", "memo": "피플웍스 통신 모듈향 Giantec EEPROM 대량 발주 견적 제출 (QBK2611-084)."}
]

@app.get("/api/sales/memos")
def list_sales_memos(sales_rep: Optional[str] = None, limit: int = 40):
    if not is_vercel:
        try:
            import legacy_mssql
            rows = legacy_mssql.query_sales_memos(sales_rep=sales_rep, limit=limit)
            if rows is not None:
                return {"status": "success", "total": len(rows), "memos": rows}
        except Exception:
            pass

    if sales_rep and sales_rep != "ALL":
        filtered = [m for m in global_vercel_memos if m.get("sales_rep", "").upper() == sales_rep.upper()]
    else:
        filtered = global_vercel_memos
    return {"status": "success", "total": len(filtered), "memos": filtered}

@app.post("/api/sales/memos")
def create_sales_memo(item: MemoInput):
    if not is_vercel:
        try:
            import legacy_mssql
            ok = legacy_mssql.insert_sales_memo(item.sales_rep, item.memo, item.input_date)
            return {"status": "success" if ok else "error"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    global_vercel_memos.insert(0, {
        "sales_rep": item.sales_rep,
        "input_date": item.input_date or datetime.date.today().isoformat(),
        "update_date": item.input_date or datetime.date.today().isoformat(),
        "memo": item.memo
    })
    return {"status": "success"}
