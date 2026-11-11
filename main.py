# main.py
import time
from typing import Optional
import requests
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import legacy_mssql

app = FastAPI(title="FX Margin Simulator")

# 환율 캐싱 변수
CACHED_FX = {"rate": 1380.0, "updated_at": 0}
CACHE_TTL = 300  # 5분 캐시

def fetch_current_fx_rate() -> float:
    now = time.time()
    if now - CACHED_FX["updated_at"] < CACHE_TTL:
        return CACHED_FX["rate"]
    
    try:
        # 글로벌 오픈 환율 엔드포인트 (USD 기준)
        res = requests.get("https://open.er-api.com/v6/latest/USD", timeout=5)
        data = res.json()
        if data.get("result") == "success":
            rate = data["rates"]["KRW"]
            CACHED_FX["rate"] = float(rate)
            CACHED_FX["updated_at"] = now
            return CACHED_FX["rate"]
    except Exception as e:
        print(f"[WARN] 환율 조회 실패, 캐시값 유지: {e}")
    
    return CACHED_FX["rate"]

class ProductInput(BaseModel):
    part_number: str
    unit_price_usd: float
    shipping_fx_rate: float
    target_margin_rate: float
    msrp_krw: float

@app.get("/api/fx-rate")
def get_fx_rate():
    rate = fetch_current_fx_rate()
    return {"currency": "USD/KRW", "current_rate": rate}

@app.get("/api/products")
def list_products():
    return []

@app.post("/api/products")
def create_product(item: ProductInput):
    return {"status": "success"}

@app.get("/api/simulate")
def simulate_margin(part_number: str, sale_discount_rate: float = 0.0):
    return {"status": "success", "part_number": part_number}

# --- MS-SQL 레거시 세일즈 마스터 [frmQuotationSQL] 견적 연동 API ---
@app.get("/api/quotations")
def list_quotations(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    mfg: Optional[str] = None,
    query: Optional[str] = None,
    limit: int = 500
):
    try:
        results = legacy_mssql.query_quotations(
            start_date=start_date,
            end_date=end_date,
            mfg=mfg,
            search_query=query,
            limit=limit
        )
        return {"status": "success", "total": len(results), "quotations": results}
    except Exception as e:
        return {"status": "error", "message": str(e), "quotations": []}

@app.get("/api/quotations/mfgs")
def list_quotation_mfgs():
    try:
        mfgs = legacy_mssql.get_quotation_mfgs()
        return {"status": "success", "mfgs": mfgs}
    except Exception as e:
        return {"status": "error", "message": str(e), "mfgs": []}

@app.get("/api/quotations/{quote_no}")
def get_quote_detail(quote_no: str):
    try:
        items = legacy_mssql.get_quotation_by_no(quote_no)
        return {"status": "success", "quote_no": quote_no, "items": items}
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
    try:
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
        return {"status": "success", "total": len(rows), "items": rows}
    except Exception as e:
        return {"status": "error", "message": str(e), "items": []}

@app.get("/api/unpaid/summary")
def unpaid_summary(min_date: Optional[str] = "2010-01-01"):
    try:
        summary = legacy_mssql.get_unpaid_summary(min_out_date=min_date)
        return {"status": "success", "summary": summary}
    except Exception as e:
        return {"status": "error", "message": str(e), "summary": {}}

@app.get("/api/unpaid/sales-reps")
def unpaid_sales_reps():
    try:
        reps = legacy_mssql.get_unpaid_sales_reps()
        return {"status": "success", "sales_reps": reps}
    except Exception as e:
        return {"status": "error", "message": str(e), "sales_reps": []}

# ========================================================
# 🏢 거래처 및 담당자 마스터 (CustomerFile & ContactFile) API
# ========================================================
@app.get("/api/customers/search")
def search_customers(q: Optional[str] = None, limit: int = 30):
    try:
        results = legacy_mssql.query_customers(search_query=q, limit=limit)
        return {"status": "success", "total": len(results), "customers": results}
    except Exception as e:
        return {"status": "error", "message": str(e), "customers": []}

# ========================================================
# 📊 매출 장부 및 실적 분석 (Book & Bill) API
# ========================================================
@app.get("/api/analytics/sales")
def sales_analytics(year: Optional[str] = "2026"):
    try:
        data = legacy_mssql.get_sales_analytics(year=year or "2026")
        return {"status": "success", "analytics": data}
    except Exception as e:
        return {"status": "error", "message": str(e), "analytics": {}}

# ========================================================
# 📝 영업 메모 및 활동 일지 (Sales Memo) API
# ========================================================
class MemoInput(BaseModel):
    sales_rep: str
    memo: str
    input_date: Optional[str] = None

@app.get("/api/sales/memos")
def list_sales_memos(sales_rep: Optional[str] = None, limit: int = 40):
    try:
        rows = legacy_mssql.query_sales_memos(sales_rep=sales_rep, limit=limit)
        return {"status": "success", "total": len(rows), "memos": rows}
    except Exception as e:
        return {"status": "error", "message": str(e), "memos": []}

@app.post("/api/sales/memos")
def create_sales_memo(item: MemoInput):
    try:
        ok = legacy_mssql.insert_sales_memo(item.sales_rep, item.memo, item.input_date)
        return {"status": "success" if ok else "error"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# ========================================================
# 🚢 발주(PO) 및 입고 예정(ETA) 조회 API (DPOFile 연동)
# ========================================================
@app.get("/api/purchase-orders")
def list_purchase_orders(
    q: Optional[str] = None,
    part_no: Optional[str] = None,
    po_no: Optional[str] = None,
    maker: Optional[str] = None,
    status: Optional[str] = None,
    sales_rep: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    limit: int = 150
):
    try:
        rows = legacy_mssql.query_purchase_orders(
            part_no=part_no,
            po_no=po_no,
            maker=maker,
            status=status,
            sales_rep=sales_rep,
            search_query=q,
            start_date=start_date,
            end_date=end_date,
            limit=limit
        )
        return {"status": "success", "total": len(rows), "orders": rows}
    except Exception as e:
        return {"status": "error", "message": str(e), "orders": []}

@app.get("/api/purchase-orders/summary")
def purchase_orders_summary():
    try:
        summary = legacy_mssql.get_purchase_orders_summary()
        return {"status": "success", "summary": summary}
    except Exception as e:
        return {"status": "error", "message": str(e), "summary": {}}

# ========================================================
# 📈 품목별 과거 단가 및 마진 이력 추적 (Price History) API
# ========================================================
@app.get("/api/price-history")
def price_history(part_no: str):
    try:
        data = legacy_mssql.get_part_price_history(part_no=part_no)
        return {"status": "success", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e), "data": {}}

# 정적 파일 서빙 (UI 및 SPA 리소스 서빙)
app.mount("/", StaticFiles(directory="public", html=True), name="public")

