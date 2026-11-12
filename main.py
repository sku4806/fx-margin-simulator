# main.py
import os
import time
import datetime
from typing import Optional
import requests
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import legacy_mssql

# .env 로드
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

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://qheijtepveajdrqerxef.supabase.co")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or 
    os.getenv("SUPABASE_KEY") or 
    "sb_publishable_0TB2JQq4BVfvihySxCbbkw_v4ZRAF80"
).strip()

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

@app.get("/api/fx-rate")
def get_fx_rate():
    rate = fetch_current_fx_rate()
    return {"currency": "USD/KRW", "current_rate": rate}

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

class UnpaidSettlementRequest(BaseModel):
    id: Optional[str] = None
    legacy_idx: Optional[int] = None
    action_type: str = "full_settle"  # 'full_settle', 'partial_settle', 'reschedule', 'note_only'
    collected_amount: Optional[float] = 0.0
    new_amount_vat: Optional[float] = None
    new_due_date: Optional[str] = None
    pay_status: Optional[str] = None
    contact_note: Optional[str] = None

@app.post("/api/unpaid/settlement")
def settle_unpaid(req: UnpaidSettlementRequest):
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }

    # 1. 대상 레코드 조회
    query_params = []
    if req.id:
        query_params.append(("id", f"eq.{req.id}"))
    elif req.legacy_idx:
        query_params.append(("legacy_idx", f"eq.{req.legacy_idx}"))
    else:
        raise HTTPException(status_code=400, detail="레코드 식별자(id 또는 legacy_idx)가 필요합니다.")

    get_res = requests.get(f"{SUPABASE_URL}/rest/v1/legacy_unpaid", headers=headers, params=query_params, timeout=5)
    if get_res.status_code != 200 or not get_res.json():
        raise HTTPException(status_code=404, detail="해당 미수금 레코드를 찾을 수 없습니다.")

    row = get_res.json()[0]
    record_id = row.get("id")

    # 2. 업데이트 필드 계산
    update_data = {
        "last_synced_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
    }

    curr_amount_vat = float(row.get("amount_vat") or 0.0)
    final_amount_vat = curr_amount_vat
    pay_status = req.pay_status or row.get("pay_status") or "미결제"

    if req.action_type == "full_settle":
        final_amount_vat = 0.0
        pay_status = "수금완료"
    elif req.action_type == "partial_settle":
        if req.new_amount_vat is not None:
            final_amount_vat = max(0.0, float(req.new_amount_vat))
        else:
            final_amount_vat = max(0.0, curr_amount_vat - float(req.collected_amount or 0.0))
        pay_status = "수금완료" if final_amount_vat <= 0 else "부분입금"
    elif req.action_type == "reschedule":
        pay_status = req.pay_status or ("결제약속" if curr_amount_vat > 0 else "수금완료")

    update_data["amount_vat"] = final_amount_vat
    update_data["pay_status"] = pay_status

    # 날짜 및 연체일수 재계산
    target_due_date = req.new_due_date or row.get("due_date")
    if target_due_date:
        update_data["due_date"] = target_due_date
        try:
            due_dt = datetime.date.fromisoformat(target_due_date[:10])
            today = datetime.date.today()
            diff_days = (today - due_dt).days
            update_data["overdue_days"] = diff_days

            if final_amount_vat <= 0 or pay_status == "수금완료":
                update_data["color_code"] = 0
            elif diff_days <= 0:
                update_data["color_code"] = 0
            elif diff_days < 30:
                update_data["color_code"] = 1
            elif diff_days < 45:
                update_data["color_code"] = 2
            elif diff_days < 60:
                update_data["color_code"] = 3
            else:
                update_data["color_code"] = 4
        except Exception:
            pass

    # 메모 / 연락 기록 추가
    if req.contact_note and req.contact_note.strip():
        now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
        note_text = f"[{now_str}] {req.contact_note.strip()}"
        existing_contact = row.get("contact") or ""
        if existing_contact:
            update_data["contact"] = f"{existing_contact} | {note_text}" if len(existing_contact) < 150 else f"{note_text} (이전: {existing_contact[:80]}...)"
        else:
            update_data["contact"] = note_text

    # 3. Supabase PATCH 전송
    patch_url = f"{SUPABASE_URL}/rest/v1/legacy_unpaid?id=eq.{record_id}"
    patch_res = requests.patch(patch_url, headers=headers, json=update_data, timeout=5)

    if patch_res.status_code not in (200, 204):
        raise HTTPException(status_code=patch_res.status_code, detail=f"수금 상태 업데이트 실패: {patch_res.text}")

    updated_rows = patch_res.json() if patch_res.status_code == 200 and patch_res.text else [update_data]
    return {
        "status": "success",
        "message": "수금 확인 및 입금약속 메모가 성공적으로 저장되었습니다.",
        "item": updated_rows[0] if updated_rows else update_data
    }

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

# ========================================================
# 📑 전자결재 구매품의서 -> ERP 재고(inventory_items) 자동 브릿지 API
# ========================================================
class PurchaseBridgeInput(BaseModel):
    doc_no: str
    part_name: str
    maker: Optional[str] = "기타"
    vendor: Optional[str] = None
    qty: int = 1
    unit_price: float = 0.0
    currency: Optional[str] = "USD"
    customer: Optional[str] = "본사 일반재고"
    drafter_name: Optional[str] = "본사 일반재고"
    memo: Optional[str] = ""
    target_date: Optional[str] = None

@app.post("/api/approvals/bridge-purchase-order")
def bridge_purchase_order(data: PurchaseBridgeInput):
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }

    # 1. 중복 체크 (동일 po_no 존재 여부 확인)
    check_url = f"{SUPABASE_URL}/rest/v1/inventory_items?po_no=eq.{data.doc_no}&select=id"
    check_res = requests.get(check_url, headers=headers, timeout=5)
    if check_res.status_code == 200 and check_res.json():
        return {
            "status": "already_exists",
            "message": f"이미 ERP 재고에 등록된 발주번호입니다: {data.doc_no}",
            "item": check_res.json()[0]
        }

    # 2. USD 환산 단가 계산
    today_str = datetime.date.today().isoformat()
    entry_date = data.target_date or today_str
    unit_usd = data.unit_price if data.currency == "USD" else round(data.unit_price / 1350.0, 4)

    payload = {
        "maker": data.maker or "기타",
        "part_name": data.part_name,
        "date_code": "-",
        "owner": data.drafter_name or "본사 일반재고",
        "customer": data.customer or "본사 일반재고",
        "real_customer": data.customer or "본사 일반재고",
        "po_no": data.doc_no,
        "application": "품의승인 발주 (PO)",
        "biz_type": "외자" if data.currency == "USD" else "내자",
        "entry_date": entry_date,
        "stock": max(1, data.qty),
        "unit_usd": unit_usd,
        "sold_price_usd": 0,
        "ship_fx": 1350,
        "margin": 20,
        "order_status": "배정요청",
        "payment_terms": "Net 30",
        "payment_status": "미수",
        "currency": data.currency or "USD",
        "memo": f"[전자결재 승인 발주] 문서번호: {data.doc_no} / 기안자: {data.drafter_name} / 승인일: {today_str} | {data.memo or ''}".strip()
    }

    ins_url = f"{SUPABASE_URL}/rest/v1/inventory_items"
    ins_res = requests.post(ins_url, headers=headers, json=[payload], timeout=5)
    if ins_res.status_code not in (200, 201):
        raise HTTPException(status_code=ins_res.status_code, detail=f"ERP 재고 삽입 실패: {ins_res.text}")

    inserted = ins_res.json() if ins_res.text else [payload]
    return {
        "status": "success",
        "message": f"구매품의서({data.doc_no})가 ERP 재고관리에 성공적으로 등록되었습니다.",
        "item": inserted[0] if inserted else payload
    }

# 정적 파일 서빙 (UI 및 SPA 리소스 서빙)
app.mount("/", StaticFiles(directory="public", html=True), name="public")

