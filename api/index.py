import os
import json
import time
import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="FX Margin Simulator API")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "products.json")

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
