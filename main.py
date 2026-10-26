# main.py
import time
import requests
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import database as db

app = FastAPI(title="FX Margin Simulator")
db.init_db()

# 정적 파일 서빙 (UI)
app.mount("/static", StaticFiles(directory="static"), name="static")

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

@app.get("/")
def serve_index():
    return FileResponse("static/index.html")

@app.get("/api/fx-rate")
def get_fx_rate():
    rate = fetch_current_fx_rate()
    return {"currency": "USD/KRW", "current_rate": rate}

@app.get("/api/products")
def list_products():
    return db.get_all_products()

@app.post("/api/products")
def create_product(item: ProductInput):
    db.insert_or_update_product(
        item.part_number, item.unit_price_usd, item.shipping_fx_rate,
        item.target_margin_rate, item.msrp_krw
    )
    return {"status": "success"}

@app.get("/api/simulate")
def simulate_margin(part_number: str, sale_discount_rate: float = 0.0):
    """
    선적 원가(장부 원가)와 현재 대체 원가(재구매 기준)를 
    현재 할인율에 따라 비교 분석하는 핵심 시뮬레이션 엔드포인트
    """
    products = db.get_all_products()
    product = next((p for p in products if p["part_number"] == part_number), None)
    if not product:
        raise HTTPException(status_code=404, detail="제품을 찾을 수 없습니다.")

    current_fx = fetch_current_fx_rate()
    usd = product["unit_price_usd"]
    ship_fx = product["shipping_fx_rate"]
    msrp = product["msrp_krw"]
    target_margin = product["target_margin_rate"]

    # 1. 원가 계산
    actual_cost_krw = usd * ship_fx           # 실제 선적 매입 원가
    replacement_cost_krw = usd * current_fx    # 현재 환율 기준 차기 매입 원가

    # 2. 제안 판매가 (할인 적용가)
    sale_price = msrp * (1 - sale_discount_rate)

    # 3. 마진 계산
    actual_margin_krw = sale_price - actual_cost_krw
    actual_margin_rate = (actual_margin_krw / sale_price) if sale_price > 0 else 0

    replacement_margin_krw = sale_price - replacement_cost_krw
    replacement_margin_rate = (replacement_margin_krw / sale_price) if sale_price > 0 else 0

    # 4. 방어 가이드라인 (목표 마진 확보를 위한 한계치)
    min_safe_price_actual = actual_cost_krw / (1 - target_margin)
    max_discount_actual = max(0.0, (msrp - min_safe_price_actual) / msrp)

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
