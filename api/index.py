import os
import json
import time
from typing import Optional
import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="FX Margin Simulator API")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "products.json")

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
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "").strip()

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

def load_products():
    if not os.path.exists(DATA_FILE):
        return []
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

@app.get("/api/fx-rate")
def fx_rate():
    return {"current_rate": get_current_fx()}

@app.get("/api/products")
def list_products():
    return load_products()

@app.get("/api/simulate")
def simulate(part_number: str, sale_discount_rate: float = 0.0):
    products = load_products()
    product = next((p for p in products if p["part_number"] == part_number), None)
    if not product:
        raise HTTPException(status_code=404, detail="제품을 찾을 수 없습니다.")

    current_fx = get_current_fx()
    usd = product["unit_price_usd"]
    ship_fx = product["shipping_fx_rate"]
    msrp = product["msrp_krw"]
    target_margin = product["target_margin_rate"]

    # 선적 원가 vs 현재 대체 원가
    actual_cost_krw = usd * ship_fx
    replacement_cost_krw = usd * current_fx

    # 제안 판매가 (할인 적용)
    sale_price = msrp * (1 - sale_discount_rate)

    # 마진율 계산
    actual_margin_krw = sale_price - actual_cost_krw
    actual_margin_rate = (actual_margin_krw / sale_price) if sale_price > 0 else 0

    replacement_margin_krw = sale_price - replacement_cost_krw
    replacement_margin_rate = (replacement_margin_krw / sale_price) if sale_price > 0 else 0

    # 목표 마진 방어 한계 할인율
    min_safe_price_actual = actual_cost_krw / (1 - target_margin)
    max_discount_actual = max(0.0, (msrp - min_safe_price_actual) / msrp)

    # 재발주 역마진 방어 한계 할인율
    min_safe_price_replacement = replacement_cost_krw / (1 - target_margin)
    max_discount_replacement = max(0.0, (msrp - min_safe_price_replacement) / msrp)

    return {
        "part_number": part_number,
        "current_fx_rate": current_fx,
        "shipping_fx_rate": ship_fx,
        "actual_cost_krw": round(actual_cost_krw),
        "replacement_cost_krw": round(replacement_cost_krw),
        "applied_sale_price": round(sale_price),
        "actual_margin_rate": round(actual_margin_rate * 100, 2),
        "replacement_margin_rate": round(replacement_margin_rate * 100, 2),
        "max_allowed_discount_for_target_margin": round(max_discount_actual * 100, 2),
        "max_allowed_discount_replacement_safe": round(max_discount_replacement * 100, 2),
        "is_under_margin": actual_margin_rate < target_margin,
        "is_replacement_deficit": sale_price < replacement_cost_krw
    }

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
    # 1. 로컬 MS-SQL 우선 조회 (사내망 환경)
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
        if mfg:
            params.append(("maker", f"eq.{mfg.strip()}"))
        if query:
            term = query.strip()
            params.append(("or", f"(part_name.ilike.%{term}%,customer_name.ilike.%{term}%,sales_rep.ilike.%{term}%,po_no.ilike.%{term}%)"))

        res = requests.get(f"{SUPABASE_URL}/rest/v1/legacy_unpaid", headers=headers, params=params, timeout=10)
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
    try:
        import legacy_mssql
        return {"status": "success", "summary": legacy_mssql.get_unpaid_summary(min_out_date=min_date)}
    except Exception:
        pass
    return {"status": "success", "summary": {}}

@app.get("/api/unpaid/sales-reps")
def unpaid_sales_reps():
    try:
        import legacy_mssql
        return {"status": "success", "sales_reps": legacy_mssql.get_unpaid_sales_reps()}
    except Exception:
        pass
    return {"status": "success", "sales_reps": ["ALLEN", "STEVE", "WILLIAM", "PAUL", "JOEY", "DUSTIN"]}
