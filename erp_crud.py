"""
erp_crud.py
웹 ERP 클라우드(Supabase) 통합 CRUD 엔진
- 출하 원장 (legacy_shipments)
- 견적 이력 (legacy_quotations)
- 미수금 관리 (legacy_unpaid)
- 거래처·담당자 마스터 (legacy_customers)
- 영업 메모 클라우드 영구 저장 (inventory_audit_logs[action_type=SALES_MEMO])
- 발주(PO/ETA) 직접 등록·수정·입고완료 전환 (approval_requests + inventory_items)
"""

import os
import json
import datetime
from concurrent.futures import ThreadPoolExecutor
from typing import Optional, List, Dict, Any
from fastapi import HTTPException
from pydantic import BaseModel
from http_pool import get_http_session

requests = get_http_session()

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://qheijtepveajdrqerxef.supabase.co")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY")
    or os.getenv("SUPABASE_KEY")
    or "sb_publishable_0TB2JQq4BVfvihySxCbbkw_v4ZRAF80"
).strip()

PAYMENT_SB_URL = "https://omtcanlmnpbiqoiakylp.supabase.co"
PAYMENT_SB_KEY = "sb_publishable_80MMaw7IKefD7v2lx8PgeA_eWuX2Yeq"


def _sb_headers(prefer: str = "return=representation") -> Dict[str, str]:
    key = (
        os.getenv("SUPABASE_SERVICE_KEY")
        or os.getenv("SUPABASE_KEY")
        or SUPABASE_SERVICE_KEY
    ).strip()
    h = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if prefer:
        h["Prefer"] = prefer
    return h


def _sb_url(table: str) -> str:
    base = os.getenv("SUPABASE_URL", SUPABASE_URL).rstrip("/")
    return f"{base}/rest/v1/{table}"


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


# ========================================================
# 📦 1. 출하 원장 (legacy_shipments) CRUD
# ========================================================
class ShipmentCrudInput(BaseModel):
    part_name: str
    maker: Optional[str] = "OTHERS"
    qty: int = 1
    unit_price: Optional[float] = 0.0        # 원화 판매단가 (KRW)
    unit_usd: Optional[float] = None         # 외화 판매단가 (USD, 입력 시 환산)
    cost_price: Optional[float] = 0.0        # 원화 원가 (KRW)
    fx_rate: Optional[float] = 1350.0
    po_no: Optional[str] = ""
    order_date: Optional[str] = None         # 출하일 YYYY-MM-DD
    customer_name: Optional[str] = ""
    real_cust: Optional[str] = ""
    app: Optional[str] = ""
    status: Optional[str] = "SHIPPED"
    create_unpaid: Optional[bool] = False    # 미수금 자동 연동 옵션
    sales_rep: Optional[str] = ""
    due_date: Optional[str] = None
    biz_type: Optional[str] = "DOMESTIC"     # DOMESTIC | COMMISSION
    comm_rate: Optional[float] = 0.0         # 커미션 요율 (%)
    comm_amt: Optional[float] = 0.0          # 커미션 금액 (USD)
    awb_no: Optional[str] = ""               # 운송장 / AWB 번호


def _encode_shipment_status(
    base_status: str,
    customer: str,
    real_cust: str,
    app: str,
    biz_type: str = "DOMESTIC",
    comm_rate: float = 0.0,
    comm_amt: float = 0.0,
    sales_rep: str = "",
    awb_no: str = "",
) -> str:
    """legacy_shipments 테이블 스키마를 보존하면서 거래처/실수요처/용도/커미션/담당자/송장 메타 저장"""
    clean_base = (base_status or "SHIPPED").split("||")[0].strip() or "SHIPPED"
    c = (customer or "").replace("||", " ").strip()
    rc = (real_cust or "").replace("||", " ").strip()
    a = (app or "").replace("||", " ").strip()
    bt = (biz_type or "DOMESTIC").strip().upper()
    cr = round(float(comm_rate or 0.0), 2)
    ca = round(float(comm_amt or 0.0), 2)
    sr = (sales_rep or "").replace("||", " ").strip().upper()
    awb = (awb_no or "").replace("||", " ").strip()
    if bt != "DOMESTIC" or cr > 0 or ca > 0 or sr or awb:
        return f"{clean_base}||{c}||{rc}||{a}||{bt}||{cr}||{ca}||{sr}||{awb}"
    if c or rc or a:
        return f"{clean_base}||{c}||{rc}||{a}"
    return clean_base


def create_shipment_record(data: ShipmentCrudInput) -> Dict[str, Any]:
    part = (data.part_name or "").strip()
    if not part:
        raise HTTPException(status_code=400, detail="품번(Part#)은 필수 입력 항목입니다.")

    qty = max(1, int(data.qty or 1))
    fx = float(data.fx_rate or 1350.0)
    if data.unit_usd is not None and float(data.unit_usd) > 0 and (not data.unit_price or float(data.unit_price) <= 0):
        unit_krw = round(float(data.unit_usd) * fx)
    else:
        unit_krw = float(data.unit_price or 0.0)

    total_sales = round(unit_krw * qty)
    ship_date = (data.order_date or "").strip() or datetime.date.today().isoformat()
    biz_type = (data.biz_type or "DOMESTIC").strip().upper()
    comm_rate = float(data.comm_rate or 0.0)
    comm_amt = float(data.comm_amt or 0.0)
    if biz_type == "COMMISSION" and comm_amt <= 0 and comm_rate > 0:
        ship_usd = (float(data.unit_usd or 0.0) * qty) if (data.unit_usd and float(data.unit_usd) > 0) else (total_sales / fx if fx > 0 else 0.0)
        comm_amt = round(ship_usd * (comm_rate / 100.0), 2)

    encoded_status = _encode_shipment_status(
        data.status or "SHIPPED",
        data.customer_name or "",
        data.real_cust or "",
        data.app or "",
        biz_type=biz_type,
        comm_rate=comm_rate,
        comm_amt=comm_amt,
        sales_rep=data.sales_rep or "",
        awb_no=data.awb_no or "",
    )

    payload = {
        "part_name": part,
        "maker": (data.maker or "OTHERS").strip(),
        "qty": qty,
        "unit_price": unit_krw,
        "cost_price": float(data.cost_price or 0.0),
        "total_sales_amount": total_sales,
        "po_no": (data.po_no or "WEB-SHIP").strip(),
        "order_date": ship_date,
        "status": encoded_status,
        "last_synced_at": _now_iso(),
    }

    res = requests.post(_sb_url("legacy_shipments"), headers=_sb_headers(), json=[payload], timeout=8)
    if res.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail=f"출하 등록 실패: {res.text[:200]}")

    created = res.json()[0] if res.json() else payload

    # 옵션: 미수금 자동 연동
    if data.create_unpaid and total_sales > 0:
        try:
            due = data.due_date or (datetime.date.fromisoformat(ship_date) + datetime.timedelta(days=30)).isoformat()
            create_unpaid_record(UnpaidCrudInput(
                customer_name=data.customer_name or "웹 출하 거래처",
                out_date=ship_date,
                po_no=payload["po_no"],
                part_name=part,
                maker=payload["maker"],
                qty=qty,
                amount_vat=round(total_sales * 1.1),
                due_date=due,
                sales_rep=data.sales_rep or "WEB",
                contact="[웹 출하 자동 연동]",
                pay_status="미결제",
            ))
        except Exception as ue:
            print(f"[WARN] 출하->미수금 자동 연동 실패: {ue}")

    return {"status": "success", "item": created}


def update_shipment_record(record_id: str, data: ShipmentCrudInput) -> Dict[str, Any]:
    if not record_id:
        raise HTTPException(status_code=400, detail="수정할 출하 ID가 필요합니다.")

    qty = max(1, int(data.qty or 1))
    fx = float(data.fx_rate or 1350.0)
    if data.unit_usd is not None and float(data.unit_usd) > 0 and (not data.unit_price or float(data.unit_price) <= 0):
        unit_krw = round(float(data.unit_usd) * fx)
    else:
        unit_krw = float(data.unit_price or 0.0)

    total_sales = round(unit_krw * qty)
    biz_type = (data.biz_type or "DOMESTIC").strip().upper()
    comm_rate = float(data.comm_rate or 0.0)
    comm_amt = float(data.comm_amt or 0.0)
    if biz_type == "COMMISSION" and comm_amt <= 0 and comm_rate > 0:
        ship_usd = (float(data.unit_usd or 0.0) * qty) if (data.unit_usd and float(data.unit_usd) > 0) else (total_sales / fx if fx > 0 else 0.0)
        comm_amt = round(ship_usd * (comm_rate / 100.0), 2)
    encoded_status = _encode_shipment_status(
        data.status or "SHIPPED",
        data.customer_name or "",
        data.real_cust or "",
        data.app or "",
        biz_type=biz_type,
        comm_rate=comm_rate,
        comm_amt=comm_amt,
        sales_rep=data.sales_rep or "",
        awb_no=data.awb_no or "",
    )

    payload = {
        "part_name": (data.part_name or "").strip(),
        "maker": (data.maker or "OTHERS").strip(),
        "qty": qty,
        "unit_price": unit_krw,
        "cost_price": float(data.cost_price or 0.0),
        "total_sales_amount": total_sales,
        "po_no": (data.po_no or "").strip(),
        "order_date": (data.order_date or "").strip() or datetime.date.today().isoformat(),
        "status": encoded_status,
        "last_synced_at": _now_iso(),
    }

    res = requests.patch(f"{_sb_url('legacy_shipments')}?id=eq.{record_id}", headers=_sb_headers(), json=payload, timeout=8)
    if res.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail=f"출하 수정 실패: {res.text[:200]}")
    rows = res.json() if res.text else []
    return {"status": "success", "item": rows[0] if rows else payload}


def delete_shipment_record(record_id: str) -> Dict[str, Any]:
    if not record_id:
        raise HTTPException(status_code=400, detail="삭제할 출하 ID가 필요합니다.")
    res = requests.delete(f"{_sb_url('legacy_shipments')}?id=eq.{record_id}", headers=_sb_headers(), timeout=8)
    if res.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail=f"출하 삭제 실패: {res.text[:200]}")
    return {"status": "success", "deleted_id": record_id}


# ========================================================
# 📋 2. 견적 이력 (legacy_quotations) CRUD
# ========================================================
class QuotationCrudInput(BaseModel):
    quote_no: Optional[str] = ""
    quote_date: Optional[str] = None
    line_no: Optional[int] = 1
    customer_name: str
    contact: Optional[str] = ""
    maker: Optional[str] = "OTHERS"
    part_name: str
    qty_int: Optional[int] = 1
    qty_str: Optional[str] = ""
    currency_unit: Optional[str] = "$"
    quote_price: float = 0.0
    amount: Optional[float] = None
    payment_terms: Optional[str] = "T/T in advance"
    sales_rep: Optional[str] = ""
    delivery: Optional[str] = "2-3WKS"
    application: Optional[str] = ""
    remark: Optional[str] = ""
    customer_tel: Optional[str] = ""
    customer_fax: Optional[str] = ""
    customer_email: Optional[str] = ""
    customer_address: Optional[str] = ""


def create_quotation_record(data: QuotationCrudInput) -> Dict[str, Any]:
    part = (data.part_name or "").strip()
    cust = (data.customer_name or "").strip()
    if not part or not cust:
        raise HTTPException(status_code=400, detail="거래처명과 품번(Part#)은 필수 입력 항목입니다.")

    q_date = (data.quote_date or "").strip() or datetime.date.today().isoformat()
    q_no = (data.quote_no or "").strip()
    if not q_no:
        now_tag = datetime.datetime.now().strftime("%y%m%d-%H%M")
        q_no = f"QBK-WEB-{now_tag}"

    qty_int = max(0, int(data.qty_int or 0))
    qty_str = (data.qty_str or "").strip() or (f"{qty_int:,}EA" if qty_int > 0 else "-")
    qp = float(data.quote_price or 0.0)
    amt = float(data.amount) if data.amount is not None else round(qty_int * qp, 4)

    payload = {
        "quote_no": q_no,
        "quote_date": q_date,
        "line_no": int(data.line_no or 1),
        "customer_name": cust,
        "contact": (data.contact or "").strip(),
        "maker": (data.maker or "OTHERS").strip(),
        "part_name": part,
        "qty_str": qty_str,
        "qty_int": qty_int,
        "currency_unit": (data.currency_unit or "$").strip(),
        "quote_price": qp,
        "amount": amt,
        "payment_terms": (data.payment_terms or "").strip(),
        "sales_rep": (data.sales_rep or "").strip(),
        "delivery": (data.delivery or "").strip(),
        "application": (data.application or "").strip(),
        "remark": (data.remark or "").strip(),
        "quote_type": (data.currency_unit or "$").strip(),
        "customer_tel": (data.customer_tel or "").strip(),
        "customer_fax": (data.customer_fax or "").strip(),
        "customer_email": (data.customer_email or "").strip(),
        "customer_address": (data.customer_address or "").strip(),
        "last_synced_at": _now_iso(),
    }

    res = requests.post(_sb_url("legacy_quotations"), headers=_sb_headers(), json=[payload], timeout=8)
    if res.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail=f"견적 등록 실패: {res.text[:200]}")
    created = res.json()[0] if res.json() else payload
    return {"status": "success", "item": created}


def update_quotation_record(record_id: str, data: QuotationCrudInput) -> Dict[str, Any]:
    if not record_id:
        raise HTTPException(status_code=400, detail="수정할 견적 ID가 필요합니다.")

    qty_int = max(0, int(data.qty_int or 0))
    qty_str = (data.qty_str or "").strip() or (f"{qty_int:,}EA" if qty_int > 0 else "-")
    qp = float(data.quote_price or 0.0)
    amt = float(data.amount) if data.amount is not None else round(qty_int * qp, 4)

    payload = {
        "quote_no": (data.quote_no or "").strip(),
        "quote_date": (data.quote_date or "").strip() or datetime.date.today().isoformat(),
        "customer_name": (data.customer_name or "").strip(),
        "contact": (data.contact or "").strip(),
        "maker": (data.maker or "OTHERS").strip(),
        "part_name": (data.part_name or "").strip(),
        "qty_str": qty_str,
        "qty_int": qty_int,
        "currency_unit": (data.currency_unit or "$").strip(),
        "quote_price": qp,
        "amount": amt,
        "payment_terms": (data.payment_terms or "").strip(),
        "sales_rep": (data.sales_rep or "").strip(),
        "delivery": (data.delivery or "").strip(),
        "application": (data.application or "").strip(),
        "remark": (data.remark or "").strip(),
        "quote_type": (data.currency_unit or "$").strip(),
        "last_synced_at": _now_iso(),
    }

    # id(UUID) 또는 legacy_idx(정수) 모두 지원
    filter_param = f"id=eq.{record_id}" if "-" in str(record_id) else f"legacy_idx=eq.{record_id}"
    res = requests.patch(f"{_sb_url('legacy_quotations')}?{filter_param}", headers=_sb_headers(), json=payload, timeout=8)
    if res.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail=f"견적 수정 실패: {res.text[:200]}")
    rows = res.json() if res.text else []
    return {"status": "success", "item": rows[0] if rows else payload}


def delete_quotation_record(record_id: str) -> Dict[str, Any]:
    if not record_id:
        raise HTTPException(status_code=400, detail="삭제할 견적 ID가 필요합니다.")
    filter_param = f"id=eq.{record_id}" if "-" in str(record_id) else f"legacy_idx=eq.{record_id}"
    res = requests.delete(f"{_sb_url('legacy_quotations')}?{filter_param}", headers=_sb_headers(), timeout=8)
    if res.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail=f"견적 삭제 실패: {res.text[:200]}")
    return {"status": "success", "deleted_id": record_id}


# ========================================================
# 💰 3. 미수금 관리 (legacy_unpaid) CRUD
# ========================================================
class UnpaidCrudInput(BaseModel):
    customer_name: str
    out_date: Optional[str] = None
    po_no: Optional[str] = ""
    part_name: str
    maker: Optional[str] = "OTHERS"
    qty: int = 1
    amount_vat: float = 0.0
    due_date: Optional[str] = None
    contact: Optional[str] = ""
    sales_rep: Optional[str] = ""
    pay_status: Optional[str] = "미결제"


def _calc_overdue(due_date_str: Optional[str], amount_vat: float, pay_status: str):
    overdue_days = 0
    color_code = 0
    if due_date_str:
        try:
            due_dt = datetime.datetime.strptime(due_date_str[:10], "%Y-%m-%d").date()
            overdue_days = (datetime.date.today() - due_dt).days
        except Exception:
            overdue_days = 0
    if pay_status == "수금완료" or amount_vat <= 0 or overdue_days <= 0:
        color_code = 0
    elif overdue_days < 30:
        color_code = 1
    elif overdue_days < 45:
        color_code = 2
    elif overdue_days < 60:
        color_code = 3
    else:
        color_code = 4
    return overdue_days, color_code


def create_unpaid_record(data: UnpaidCrudInput) -> Dict[str, Any]:
    cust = (data.customer_name or "").strip()
    part = (data.part_name or "").strip()
    if not cust or not part:
        raise HTTPException(status_code=400, detail="거래처명과 품번은 필수입니다.")

    out_dt = (data.out_date or "").strip() or datetime.date.today().isoformat()
    due_dt = (data.due_date or "").strip() or (datetime.date.fromisoformat(out_dt) + datetime.timedelta(days=30)).isoformat()
    amt = max(0.0, float(data.amount_vat or 0.0))
    status = (data.pay_status or "미결제").strip()
    overdue_days, color_code = _calc_overdue(due_dt, amt, status)

    payload = {
        "customer_name": cust,
        "out_date": out_dt,
        "po_no": (data.po_no or "").strip(),
        "part_name": part,
        "maker": (data.maker or "OTHERS").strip(),
        "qty": max(1, int(data.qty or 1)),
        "amount_vat": amt,
        "due_date": due_dt,
        "contact": (data.contact or "").strip(),
        "sales_rep": (data.sales_rep or "").strip(),
        "pay_status": status,
        "overdue_days": overdue_days,
        "color_code": color_code,
        "last_synced_at": _now_iso(),
    }

    res = requests.post(_sb_url("legacy_unpaid"), headers=_sb_headers(), json=[payload], timeout=8)
    if res.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail=f"미수금 등록 실패: {res.text[:200]}")
    created = res.json()[0] if res.json() else payload
    return {"status": "success", "item": created}


def update_unpaid_record(record_id: str, data: UnpaidCrudInput) -> Dict[str, Any]:
    if not record_id:
        raise HTTPException(status_code=400, detail="수정할 미수금 ID가 필요합니다.")

    out_dt = (data.out_date or "").strip() or datetime.date.today().isoformat()
    due_dt = (data.due_date or "").strip() or out_dt
    amt = max(0.0, float(data.amount_vat or 0.0))
    status = (data.pay_status or "미결제").strip()
    overdue_days, color_code = _calc_overdue(due_dt, amt, status)

    payload = {
        "customer_name": (data.customer_name or "").strip(),
        "out_date": out_dt,
        "po_no": (data.po_no or "").strip(),
        "part_name": (data.part_name or "").strip(),
        "maker": (data.maker or "OTHERS").strip(),
        "qty": max(1, int(data.qty or 1)),
        "amount_vat": amt,
        "due_date": due_dt,
        "contact": (data.contact or "").strip(),
        "sales_rep": (data.sales_rep or "").strip(),
        "pay_status": status,
        "overdue_days": overdue_days,
        "color_code": color_code,
        "last_synced_at": _now_iso(),
    }

    filter_param = f"id=eq.{record_id}" if "-" in str(record_id) else f"legacy_idx=eq.{record_id}"
    res = requests.patch(f"{_sb_url('legacy_unpaid')}?{filter_param}", headers=_sb_headers(), json=payload, timeout=8)
    if res.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail=f"미수금 수정 실패: {res.text[:200]}")
    rows = res.json() if res.text else []
    return {"status": "success", "item": rows[0] if rows else payload}


def delete_unpaid_record(record_id: str) -> Dict[str, Any]:
    if not record_id:
        raise HTTPException(status_code=400, detail="삭제할 미수금 ID가 필요합니다.")
    filter_param = f"id=eq.{record_id}" if "-" in str(record_id) else f"legacy_idx=eq.{record_id}"
    res = requests.delete(f"{_sb_url('legacy_unpaid')}?{filter_param}", headers=_sb_headers(), timeout=8)
    if res.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail=f"미수금 삭제 실패: {res.text[:200]}")
    return {"status": "success", "deleted_id": record_id}


# ========================================================
# 🏢 4. 거래처·담당자 마스터 (legacy_customers) CRUD
# ========================================================
class CustomerCrudInput(BaseModel):
    kname: str
    cname: Optional[str] = ""
    tel: Optional[str] = ""
    fax: Optional[str] = ""
    address: Optional[str] = ""
    email: Optional[str] = ""
    sales_rep: Optional[str] = ""
    contact_name: Optional[str] = ""
    contact_title: Optional[str] = ""
    contact_tel: Optional[str] = ""
    contact_mobile: Optional[str] = ""
    contact_email: Optional[str] = ""


def list_customers_cloud(q: Optional[str] = None, page: int = 1, limit: int = 50) -> Dict[str, Any]:
    headers = _sb_headers(prefer="count=exact")
    offset = max(0, (page - 1) * limit)
    params = [
        ("select", "*"),
        ("order", "last_synced_at.desc.nullslast,cid.desc"),
        ("limit", str(limit)),
        ("offset", str(offset)),
    ]
    if q and q.strip():
        term = q.strip()
        params.append(("or", f"(kname.ilike.%{term}%,cname.ilike.%{term}%,contact_name.ilike.%{term}%,sales_rep.ilike.%{term}%,tel.ilike.%{term}%)"))

    res = requests.get(_sb_url("legacy_customers"), headers=headers, params=params, timeout=8)
    if res.status_code not in (200, 206):
        raise HTTPException(status_code=500, detail=f"거래처 조회 실패: {res.text[:200]}")

    total = 0
    cr = res.headers.get("content-range", "")
    if "/" in cr:
        try:
            total = int(cr.split("/")[1])
        except Exception:
            total = len(res.json())
    else:
        total = len(res.json())

    return {"status": "success", "total": total, "page": page, "limit": limit, "customers": res.json()}


def create_customer_record(data: CustomerCrudInput) -> Dict[str, Any]:
    kname = (data.kname or "").strip()
    if not kname:
        raise HTTPException(status_code=400, detail="거래처명(한글/공식명)은 필수입니다.")

    # 웹 신규 거래처 CID 채번 (900000번대 이상으로 레거시 CID 충돌 방지)
    next_cid = 900001
    try:
        max_res = requests.get(
            _sb_url("legacy_customers"),
            headers=_sb_headers(prefer=""),
            params=[("select", "cid"), ("order", "cid.desc"), ("limit", "1")],
            timeout=5,
        )
        if max_res.status_code == 200 and max_res.json():
            curr_max = int(max_res.json()[0].get("cid") or 0)
            next_cid = max(900001, curr_max + 1)
    except Exception:
        pass

    payload = {
        "cid": next_cid,
        "kname": kname,
        "cname": (data.cname or kname).strip(),
        "tel": (data.tel or "").strip(),
        "fax": (data.fax or "").strip(),
        "address": (data.address or "").strip(),
        "email": (data.email or "").strip(),
        "sales_rep": (data.sales_rep or "").strip(),
        "contact_name": (data.contact_name or "").strip(),
        "contact_title": (data.contact_title or "").strip(),
        "contact_tel": (data.contact_tel or "").strip(),
        "contact_mobile": (data.contact_mobile or "").strip(),
        "contact_email": (data.contact_email or "").strip(),
        "last_synced_at": _now_iso(),
    }

    res = requests.post(_sb_url("legacy_customers"), headers=_sb_headers(), json=[payload], timeout=8)
    if res.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail=f"거래처 등록 실패: {res.text[:200]}")
    created = res.json()[0] if res.json() else payload
    return {"status": "success", "customer": created}


def update_customer_record(record_id: str, data: CustomerCrudInput) -> Dict[str, Any]:
    if not record_id:
        raise HTTPException(status_code=400, detail="수정할 거래처 ID가 필요합니다.")

    payload = {
        "kname": (data.kname or "").strip(),
        "cname": (data.cname or data.kname or "").strip(),
        "tel": (data.tel or "").strip(),
        "fax": (data.fax or "").strip(),
        "address": (data.address or "").strip(),
        "email": (data.email or "").strip(),
        "sales_rep": (data.sales_rep or "").strip(),
        "contact_name": (data.contact_name or "").strip(),
        "contact_title": (data.contact_title or "").strip(),
        "contact_tel": (data.contact_tel or "").strip(),
        "contact_mobile": (data.contact_mobile or "").strip(),
        "contact_email": (data.contact_email or "").strip(),
        "last_synced_at": _now_iso(),
    }

    filter_param = f"id=eq.{record_id}" if "-" in str(record_id) else f"cid=eq.{record_id}"
    res = requests.patch(f"{_sb_url('legacy_customers')}?{filter_param}", headers=_sb_headers(), json=payload, timeout=8)
    if res.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail=f"거래처 수정 실패: {res.text[:200]}")
    rows = res.json() if res.text else []
    return {"status": "success", "customer": rows[0] if rows else payload}


def delete_customer_record(record_id: str) -> Dict[str, Any]:
    if not record_id:
        raise HTTPException(status_code=400, detail="삭제할 거래처 ID가 필요합니다.")
    filter_param = f"id=eq.{record_id}" if "-" in str(record_id) else f"cid=eq.{record_id}"
    res = requests.delete(f"{_sb_url('legacy_customers')}?{filter_param}", headers=_sb_headers(), timeout=8)
    if res.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail=f"거래처 삭제 실패: {res.text[:200]}")
    return {"status": "success", "deleted_id": record_id}


# ========================================================
# 🚢 5. 발주(PO/ETA) 직접 등록 · 수정 · 입고완료(IN) 전환
# ========================================================
class WebPoCrudInput(BaseModel):
    po_no: Optional[str] = ""
    part_no: str
    maker: Optional[str] = "OTHERS"
    qty: int = 1
    unit_price: float = 0.0
    currency: Optional[str] = "USD"
    fx_rate: Optional[float] = 1350.0
    eta_date: Optional[str] = None
    supplier_name: Optional[str] = ""
    real_cust: Optional[str] = ""
    sales_rep: Optional[str] = ""
    remark: Optional[str] = ""


class PoReceiveInput(BaseModel):
    po_no: str
    part_no: str
    maker: Optional[str] = "OTHERS"
    qty: int = 1
    unit_usd: Optional[float] = 0.0
    unit_krw: Optional[float] = 0.0
    currency: Optional[str] = "USD"
    fx_rate: Optional[float] = 1350.0
    entry_date: Optional[str] = None
    supplier_name: Optional[str] = ""
    real_cust: Optional[str] = ""
    sales_rep: Optional[str] = "BSK"
    date_code: Optional[str] = "-"
    remark: Optional[str] = ""
    is_web: Optional[bool] = True


def create_direct_web_po(data: WebPoCrudInput) -> Dict[str, Any]:
    part = (data.part_no or "").strip()
    if not part:
        raise HTTPException(status_code=400, detail="품번(Part#)은 필수입니다.")

    today_str = datetime.date.today().isoformat()
    po_no = (data.po_no or "").strip()
    if not po_no:
        po_no = f"PO-WEB-{datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}"

    qty = max(1, int(data.qty or 1))
    curr = (data.currency or "USD").upper().strip()
    fx = float(data.fx_rate or 1350.0)
    up = float(data.unit_price or 0.0)
    is_usd = curr in ("USD", "US$", "$")
    up_krw = round(up * fx) if is_usd else round(up)
    amt_krw = up_krw * qty
    foreign_up = up if is_usd else (round(up / fx, 4) if fx > 0 else 0.0)
    foreign_amt = round(foreign_up * qty, 4)
    eta = (data.eta_date or "").strip() or today_str

    meta = {
        "part_name": part,
        "maker": (data.maker or "OTHERS").strip(),
        "qty": qty,
        "unit_price": up,
        "currency": "USD" if is_usd else "KRW",
        "fx_rate": fx,
        "vendor": (data.supplier_name or "").strip(),
        "customer": (data.real_cust or "").strip(),
        "memo": (data.remark or "").strip(),
        "items": [{
            "part_no": part,
            "maker": (data.maker or "OTHERS").strip(),
            "qty": qty,
            "unit_price": up,
            "currency": "USD" if is_usd else "KRW",
            "vendor": (data.supplier_name or "").strip(),
            "customer": (data.real_cust or "").strip(),
            "memo": (data.remark or "").strip(),
        }],
    }

    # 1. Payment Supabase approval_requests에 클라우드 영구 저장 (Vercel & 로컬 공통)
    pay_headers = {
        "apikey": PAYMENT_SB_KEY,
        "Authorization": f"Bearer {PAYMENT_SB_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    doc_payload = {
        "doc_no": po_no,
        "doc_type": "구매품의서",
        "drafter_name": (data.sales_rep or "ERP 담당자").strip(),
        "title": f"[직접 발주] {part} ({qty:,} EA)",
        "expected_amount": amt_krw,
        "target_date": eta,
        "status": "APPROVED",
        "content": f"웹 ERP 직접 등록 발주 ({part} / {qty:,} EA)\n<!-- ERP_META: {json.dumps(meta, ensure_ascii=False)} -->",
    }
    try:
        requests.post(f"{PAYMENT_SB_URL}/rest/v1/approval_requests", headers=pay_headers, json=[doc_payload], timeout=6)
    except Exception as pe:
        print(f"[WARN] Payment Supabase PO 저장 경고: {pe}")

    # 2. 로컬 캐시 저장 (로컬 서버용)
    po_item = {
        "idx": f"WEB-{po_no}",
        "po_dt": today_str,
        "po_no": po_no,
        "part_no": part,
        "maker": (data.maker or "OTHERS").strip(),
        "qty": qty,
        "unit_price": up_krw,
        "amount": amt_krw,
        "currency": "USD" if is_usd else "KRW",
        "foreign_up": foreign_up,
        "foreign_amount": foreign_amt,
        "eta_date": eta,
        "status": "PO",
        "status_label": "입고대기(웹발주)",
        "sales_rep": (data.sales_rep or "ERP 담당자").strip(),
        "supplier_name": (data.supplier_name or "공급사 미지정").strip(),
        "real_cust": (data.real_cust or "").strip(),
        "remark": f"[웹 직접 발주] {(data.remark or '').strip()}".strip(),
        "source": "WEB_APPROVAL",
    }
    try:
        import web_purchase_orders
        web_purchase_orders.save_local_web_order(po_item)
    except Exception:
        pass

    return {"status": "success", "item": po_item}


def update_direct_web_po(data: WebPoCrudInput) -> Dict[str, Any]:
    po_no = (data.po_no or "").strip()
    if not po_no:
        raise HTTPException(status_code=400, detail="수정할 발주번호(po_no)가 필요합니다.")

    qty = max(1, int(data.qty or 1))
    curr = (data.currency or "USD").upper().strip()
    fx = float(data.fx_rate or 1350.0)
    up = float(data.unit_price or 0.0)
    is_usd = curr in ("USD", "US$", "$")
    up_krw = round(up * fx) if is_usd else round(up)
    amt_krw = up_krw * qty
    foreign_up = up if is_usd else (round(up / fx, 4) if fx > 0 else 0.0)
    foreign_amt = round(foreign_up * qty, 4)
    eta = (data.eta_date or "").strip() or datetime.date.today().isoformat()

    meta = {
        "part_name": (data.part_no or "").strip(),
        "maker": (data.maker or "OTHERS").strip(),
        "qty": qty,
        "unit_price": up,
        "currency": "USD" if is_usd else "KRW",
        "fx_rate": fx,
        "vendor": (data.supplier_name or "").strip(),
        "customer": (data.real_cust or "").strip(),
        "memo": (data.remark or "").strip(),
        "items": [{
            "part_no": (data.part_no or "").strip(),
            "maker": (data.maker or "OTHERS").strip(),
            "qty": qty,
            "unit_price": up,
            "currency": "USD" if is_usd else "KRW",
            "vendor": (data.supplier_name or "").strip(),
            "customer": (data.real_cust or "").strip(),
            "memo": (data.remark or "").strip(),
        }],
    }

    # 1. Payment Supabase 업데이트
    pay_headers = {
        "apikey": PAYMENT_SB_KEY,
        "Authorization": f"Bearer {PAYMENT_SB_KEY}",
        "Content-Type": "application/json",
    }
    try:
        patch_body = {
            "target_date": eta,
            "expected_amount": amt_krw,
            "drafter_name": (data.sales_rep or "ERP 담당자").strip(),
            "content": f"웹 ERP 수정 발주 ({data.part_no} / {qty:,} EA)\n<!-- ERP_META: {json.dumps(meta, ensure_ascii=False)} -->",
        }
        requests.patch(f"{PAYMENT_SB_URL}/rest/v1/approval_requests?doc_no=eq.{po_no}", headers=pay_headers, json=patch_body, timeout=6)
    except Exception as pe:
        print(f"[WARN] Payment Supabase PO 수정 경고: {pe}")

    # 2. 로컬 캐시 업데이트
    try:
        import web_purchase_orders
        orders = web_purchase_orders.load_local_web_orders()
        updated = False
        for o in orders:
            if (o.get("po_no") or "").strip() == po_no:
                o.update({
                    "part_no": (data.part_no or "").strip(),
                    "maker": (data.maker or "OTHERS").strip(),
                    "qty": qty,
                    "unit_price": up_krw,
                    "amount": amt_krw,
                    "currency": "USD" if is_usd else "KRW",
                    "foreign_up": foreign_up,
                    "foreign_amount": foreign_amt,
                    "eta_date": eta,
                    "sales_rep": (data.sales_rep or o.get("sales_rep") or "").strip(),
                    "supplier_name": (data.supplier_name or "").strip(),
                    "real_cust": (data.real_cust or "").strip(),
                    "remark": (data.remark or "").strip(),
                })
                updated = True
        if updated:
            web_purchase_orders.write_local_web_orders(orders)
    except Exception:
        pass

    return {"status": "success", "po_no": po_no}


def receive_purchase_order_to_inventory(data: PoReceiveInput) -> Dict[str, Any]:
    """발주(PO) 건을 [입고완료(IN)]로 전환하고 Supabase inventory_items에 실재고 자동 등록/갱신"""
    po_no = (data.po_no or "").strip()
    part_no = (data.part_no or "").strip()
    if not po_no or not part_no:
        raise HTTPException(status_code=400, detail="발주번호와 품번이 필요합니다.")

    entry_date = (data.entry_date or "").strip() or datetime.date.today().isoformat()
    qty = max(1, int(data.qty or 1))
    fx = float(data.fx_rate or 1350.0)
    unit_usd = float(data.unit_usd or 0.0)
    if unit_usd <= 0 and float(data.unit_krw or 0.0) > 0 and fx > 0:
        unit_usd = round(float(data.unit_krw) / fx, 4)

    # 1. 기존 inventory_items에 동일 po_no + part_name이 있으면 '보유'로 업데이트, 없으면 신규 입고 등록
    check_res = requests.get(
        _sb_url("inventory_items"),
        headers=_sb_headers(prefer=""),
        params=[("po_no", f"eq.{po_no}"), ("part_name", f"eq.{part_no}"), ("select", "id,stock")],
        timeout=6,
    )
    existing = check_res.json() if check_res.status_code == 200 else []

    if existing:
        item_id = existing[0]["id"]
        upd_payload = {
            "stock": qty,
            "order_status": "보유",
            "entry_date": entry_date,
            "date_code": (data.date_code or "-").strip(),
            "unit_usd": unit_usd,
            "ship_fx": fx,
            "memo": f"[입고완료 전환 {entry_date}] {(data.remark or '').strip()}".strip(),
        }
        requests.patch(f"{_sb_url('inventory_items')}?id=eq.{item_id}", headers=_sb_headers(), json=upd_payload, timeout=8)
        action = "updated"
    else:
        ins_payload = {
            "part_name": part_no,
            "maker": (data.maker or "OTHERS").strip(),
            "stock": qty,
            "arranged_qty": 0,
            "unit_usd": unit_usd,
            "ship_fx": fx,
            "sold_price_usd": 0,
            "entry_date": entry_date,
            "date_code": (data.date_code or "-").strip(),
            "owner": (data.sales_rep or "BSK").strip(),
            "customer": (data.real_cust or "BIGSHINE KOREA").strip(),
            "real_customer": (data.real_cust or "BIGSHINE KOREA").strip(),
            "po_no": po_no,
            "biz_type": "IMPORT" if (data.currency or "").upper() in ("USD", "US$", "$") else "DOMESTIC",
            "order_status": "보유",
            "payment_terms": "Net 30",
            "payment_status": "미수",
            "currency": "USD",
            "margin": 20,
            "memo": f"[PO 입고완료 {entry_date}] 공급사: {data.supplier_name or '-'} / {(data.remark or '').strip()}".strip(),
        }
        ins_res = requests.post(_sb_url("inventory_items"), headers=_sb_headers(), json=[ins_payload], timeout=8)
        if ins_res.status_code not in (200, 201):
            raise HTTPException(status_code=500, detail=f"재고 입고 등록 실패: {ins_res.text[:200]}")
        action = "inserted"

    # 2. 웹 PO인 경우 상태를 'IN' (입고완료)로 변경
    if data.is_web:
        try:
            import web_purchase_orders
            web_purchase_orders.mark_web_order_received(po_no=po_no, part_no=part_no)
        except Exception as we:
            print(f"[WARN] 웹 PO 입고 상태 갱신 경고: {we}")

    return {"status": "success", "action": action, "po_no": po_no, "part_no": part_no, "qty": qty}


# ========================================================
# 📝 6. 영업 메모 클라우드 CRUD (Supabase inventory_audit_logs[action_type=SALES_MEMO])
# ========================================================
class SalesMemoUpdateInput(BaseModel):
    sales_rep: Optional[str] = None
    memo: str
    input_date: Optional[str] = None


class SampleTrackingCrudInput(BaseModel):
    customer_name: str
    part_no: str
    mfg: Optional[str] = "OTHERS"
    sales: Optional[str] = "BSK"
    app: Optional[str] = ""
    prj_model: Optional[str] = ""
    volume: Optional[int] = 0
    pp_date: Optional[str] = ""
    mp_date: Optional[str] = ""
    chipset_vendor: Optional[str] = ""
    chipset_partno: Optional[str] = ""
    competitor: Optional[str] = ""
    sample_qty: Optional[int] = 0
    sample_date: Optional[str] = ""
    sample_result: Optional[int] = 4   # 1:Design Win, 2:Design Fail, 3:Pending, 4:Working
    business_result: Optional[int] = 3 # 1:Taking P.O, 2:Fail, 3:Waiting
    remark: Optional[str] = ""


class SubLedgerCrudInput(BaseModel):
    date: Optional[str] = ""
    customer_name: Optional[str] = ""
    part_no: str
    maker: Optional[str] = ""
    qty: int = 0
    gubun: Optional[str] = ""       # borrow: 대여/반납/샘플대여
    result: Optional[str] = ""      # borrow: 대여중/반납완료, loss: 폐기/불량/분실/재고조정
    rtn_date: Optional[str] = ""    # borrow: 반납일
    po_no: Optional[str] = ""       # rma: PO번호
    out_up: Optional[float] = 0.0   # rma: 판매단가
    out_amt: Optional[float] = 0.0  # rma: 반품금액
    loss_no: Optional[str] = ""     # loss: 손실번호
    np: Optional[float] = 0.0       # loss: 단가
    np_amt: Optional[float] = 0.0   # loss: 손실금액
    sales: Optional[str] = ""
    remark: Optional[str] = ""


_SUB_LEDGER_ACTION = {
    "borrow": "WEB_BORROW",
    "rma": "WEB_RMA",
    "loss": "WEB_LOSS",
}


def list_cloud_sub_ledgers(kind: str, query: Optional[str] = None, limit: int = 200) -> List[Dict[str, Any]]:
    action_type = _SUB_LEDGER_ACTION.get(kind)
    if not action_type:
        return []
    params = [
        ("select", "id,part_name,user_email,details,created_at"),
        ("action_type", f"eq.{action_type}"),
        ("order", "created_at.desc"),
        ("limit", str(limit)),
    ]
    try:
        res = requests.get(_sb_url("inventory_audit_logs"), headers=_sb_headers(prefer=""), params=params, timeout=6)
        if res.status_code != 200:
            return []
        rows = res.json() or []
        q_lower = (query or "").strip().lower()
        out = []
        for r in rows:
            try:
                rec = json.loads(r.get("details") or "{}")
            except Exception:
                rec = {}
            rec["id"] = f"CLOUD-{r['id']}"
            rec["cloud_id"] = r["id"]
            rec["source"] = "CLOUD"
            rec["is_web"] = True
            if not rec.get("part_no"):
                rec["part_no"] = r.get("part_name") or ""
            if q_lower:
                hay = " ".join(str(rec.get(k, "")) for k in ("part_no", "customer_name", "maker", "po_no", "loss_no", "sales", "remark", "gubun", "result")).lower()
                if q_lower not in hay:
                    continue
            out.append(rec)
        return out
    except Exception as e:
        print(f"[WARN] 클라우드 {kind} 원장 조회 실패: {e}")
        return []


def _build_sub_ledger_record(kind: str, data: SubLedgerCrudInput) -> Dict[str, Any]:
    dt = (data.date or "").strip() or datetime.date.today().isoformat()
    qty = int(data.qty or 0)
    sales_en = (data.sales or "").strip().upper()
    if kind == "borrow":
        return {
            "date": dt,
            "customer_name": (data.customer_name or "").strip() or "-",
            "part_no": (data.part_no or "").strip(),
            "maker": (data.maker or "").strip() or "-",
            "qty": qty,
            "gubun": (data.gubun or "대여").strip(),
            "result": (data.result or "대여중").strip(),
            "rtn_date": (data.rtn_date or "").strip(),
            "sales": sales_en,
            "remark": (data.remark or "").strip(),
        }
    elif kind == "rma":
        out_up = float(data.out_up or 0.0)
        out_amt = float(data.out_amt or 0.0) or (out_up * qty)
        return {
            "date": dt,
            "customer_name": (data.customer_name or "").strip() or "-",
            "part_no": (data.part_no or "").strip(),
            "maker": (data.maker or "").strip() or "-",
            "po_no": (data.po_no or "").strip(),
            "qty": qty,
            "out_up": round(out_up, 2),
            "out_amt": round(out_amt, 2),
            "sales": sales_en,
            "remark": (data.remark or "").strip(),
        }
    else:
        np_val = float(data.np or 0.0)
        np_amt = float(data.np_amt or 0.0) or (np_val * qty)
        loss_no = (data.loss_no or "").strip() or f"LOSS-{dt.replace('-', '')}"
        return {
            "date": dt,
            "loss_no": loss_no,
            "part_no": (data.part_no or "").strip(),
            "maker": (data.maker or "").strip() or "-",
            "qty": qty,
            "np": round(np_val, 2),
            "np_amt": round(np_amt, 2),
            "result": (data.result or "폐기").strip(),
            "remark": (data.remark or "").strip(),
        }


def create_cloud_sub_ledger(kind: str, data: SubLedgerCrudInput) -> Dict[str, Any]:
    action_type = _SUB_LEDGER_ACTION.get(kind)
    if not action_type:
        raise HTTPException(status_code=400, detail="지원하지 않는 원장 구분입니다.")
    if not (data.part_no or "").strip():
        raise HTTPException(status_code=400, detail="품번(Part#)은 필수 입력 항목입니다.")
    rec = _build_sub_ledger_record(kind, data)
    payload = {
        "item_id": action_type,
        "part_name": rec["part_no"],
        "action_type": action_type,
        "user_email": rec["date"],
        "details": json.dumps(rec, ensure_ascii=False),
    }
    res = requests.post(_sb_url("inventory_audit_logs"), headers=_sb_headers(), json=[payload], timeout=8)
    if res.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail=f"원장 등록 실패: {res.text[:200]}")
    created = res.json()[0] if res.json() else {}
    rec["id"] = f"CLOUD-{created.get('id', '')}"
    rec["cloud_id"] = created.get("id")
    rec["source"] = "CLOUD"
    rec["is_web"] = True
    return {"status": "success", "item": rec}


def update_cloud_sub_ledger(kind: str, record_id: str, data: SubLedgerCrudInput) -> Dict[str, Any]:
    raw_id = str(record_id).replace("CLOUD-", "").strip()
    if not raw_id:
        raise HTTPException(status_code=400, detail="수정할 레코드 ID가 필요합니다.")
    rec = _build_sub_ledger_record(kind, data)
    payload = {
        "part_name": rec["part_no"],
        "user_email": rec["date"],
        "details": json.dumps(rec, ensure_ascii=False),
    }
    res = requests.patch(f"{_sb_url('inventory_audit_logs')}?id=eq.{raw_id}", headers=_sb_headers(), json=payload, timeout=8)
    if res.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail=f"원장 수정 실패: {res.text[:200]}")
    rec["id"] = f"CLOUD-{raw_id}"
    rec["cloud_id"] = raw_id
    rec["source"] = "CLOUD"
    rec["is_web"] = True
    return {"status": "success", "item": rec}


def delete_cloud_sub_ledger(record_id: str) -> Dict[str, Any]:
    raw_id = str(record_id).replace("CLOUD-", "").strip()
    if not raw_id:
        raise HTTPException(status_code=400, detail="삭제할 레코드 ID가 필요합니다.")
    res = requests.delete(f"{_sb_url('inventory_audit_logs')}?id=eq.{raw_id}", headers=_sb_headers(), timeout=8)
    if res.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail=f"원장 삭제 실패: {res.text[:200]}")
    return {"status": "success", "deleted_id": record_id}


class CommissionSettleInput(BaseModel):
    idx: str
    bank_dt: Optional[str] = ""
    comm_amt: Optional[float] = 0.0
    note: Optional[str] = ""


def get_commission_settlement_map() -> Dict[str, Dict[str, Any]]:
    """Supabase 클라우드에 기록된 커미션 입금완료 정산 맵 반환 ({str(idx): {bank_dt, cloud_id, note}})"""
    params = [
        ("select", "id,item_id,user_email,details"),
        ("action_type", "eq.COMM_SETTLEMENT"),
        ("order", "created_at.desc"),
        ("limit", "1000"),
    ]
    try:
        res = requests.get(_sb_url("inventory_audit_logs"), headers=_sb_headers(prefer=""), params=params, timeout=6)
        if res.status_code != 200:
            return {}
        out: Dict[str, Dict[str, Any]] = {}
        for r in (res.json() or []):
            key = str(r.get("item_id") or "").strip()
            if not key or key in out:
                continue
            try:
                det = json.loads(r.get("details") or "{}")
            except Exception:
                det = {}
            out[key] = {
                "bank_dt": (r.get("user_email") or det.get("bank_dt") or "")[:10],
                "cloud_id": r.get("id"),
                "note": det.get("note") or "",
            }
        return out
    except Exception as e:
        print(f"[WARN] 커미션 정산 맵 조회 실패: {e}")
        return {}


def settle_commission_record(data: CommissionSettleInput) -> Dict[str, Any]:
    idx_key = str(data.idx or "").strip()
    if not idx_key:
        raise HTTPException(status_code=400, detail="정산할 커미션 ID(idx)가 필요합니다.")
    bank_dt = (data.bank_dt or "").strip() or datetime.date.today().isoformat()
    payload = {
        "item_id": idx_key,
        "part_name": f"COMM-{idx_key}",
        "action_type": "COMM_SETTLEMENT",
        "user_email": bank_dt,
        "details": json.dumps({"idx": idx_key, "bank_dt": bank_dt, "comm_amt": float(data.comm_amt or 0.0), "note": (data.note or "").strip()}, ensure_ascii=False),
    }
    res = requests.post(_sb_url("inventory_audit_logs"), headers=_sb_headers(), json=[payload], timeout=8)
    if res.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail=f"커미션 입금완료 저장 실패: {res.text[:200]}")
    created = res.json()[0] if res.json() else {}
    return {"status": "success", "idx": idx_key, "bank_dt": bank_dt, "cloud_id": created.get("id")}


def unsettle_commission_record(idx: str) -> Dict[str, Any]:
    idx_key = str(idx or "").strip()
    if not idx_key:
        raise HTTPException(status_code=400, detail="정산 취소할 커미션 ID가 필요합니다.")
    res = requests.delete(
        f"{_sb_url('inventory_audit_logs')}?action_type=eq.COMM_SETTLEMENT&item_id=eq.{idx_key}",
        headers=_sb_headers(),
        timeout=8,
    )
    if res.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail=f"커미션 정산 취소 실패: {res.text[:200]}")
    return {"status": "success", "idx": idx_key}


def list_cloud_sales_memos(sales_rep: Optional[str] = None, limit: int = 40) -> List[Dict[str, Any]]:
    params = [
        ("select", "id,item_id,part_name,user_email,details,created_at"),
        ("action_type", "eq.SALES_MEMO"),
        ("order", "created_at.desc"),
        ("limit", str(limit)),
    ]
    if sales_rep and sales_rep != "ALL":
        params.append(("part_name", f"ilike.{sales_rep.strip()}"))

    try:
        res = requests.get(_sb_url("inventory_audit_logs"), headers=_sb_headers(prefer=""), params=params, timeout=6)
        if res.status_code != 200:
            return []
        rows = res.json() or []
        out = []
        for r in rows:
            dt_str = (r.get("user_email") or (r.get("created_at") or "")[:10])[:10]
            out.append({
                "id": f"CLOUD-{r['id']}",
                "cloud_id": r["id"],
                "sales_rep": r.get("part_name") or "BSK",
                "input_date": dt_str,
                "update_date": (r.get("created_at") or dt_str)[:10],
                "memo": r.get("details") or "",
                "source": "CLOUD",
            })
        return out
    except Exception as e:
        print(f"[WARN] 클라우드 영업 메모 조회 실패: {e}")
        return []


def create_cloud_sales_memo(sales_rep: str, memo: str, input_date: Optional[str] = None) -> Dict[str, Any]:
    dt = (input_date or "").strip() or datetime.date.today().isoformat()
    payload = {
        "item_id": "SALES_MEMO",
        "part_name": (sales_rep or "BSK").strip().upper(),
        "action_type": "SALES_MEMO",
        "user_email": dt,
        "details": (memo or "").strip(),
    }
    res = requests.post(_sb_url("inventory_audit_logs"), headers=_sb_headers(), json=[payload], timeout=6)
    if res.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail=f"영업 메모 저장 실패: {res.text[:200]}")
    created = res.json()[0] if res.json() else payload
    return {
        "status": "success",
        "memo": {
            "id": f"CLOUD-{created.get('id', '')}",
            "cloud_id": created.get("id"),
            "sales_rep": payload["part_name"],
            "input_date": dt,
            "update_date": dt,
            "memo": payload["details"],
            "source": "CLOUD",
        },
    }


def update_cloud_sales_memo(memo_id: str, data: SalesMemoUpdateInput) -> Dict[str, Any]:
    clean_id = str(memo_id).replace("CLOUD-", "").strip()
    if not clean_id.isdigit():
        raise HTTPException(status_code=400, detail="수정 가능한 클라우드 메모 ID가 아닙니다.")
    patch_body: Dict[str, Any] = {"details": (data.memo or "").strip()}
    if data.sales_rep:
        patch_body["part_name"] = data.sales_rep.strip().upper()
    if data.input_date:
        patch_body["user_email"] = data.input_date.strip()[:10]

    res = requests.patch(
        f"{_sb_url('inventory_audit_logs')}?id=eq.{clean_id}&action_type=eq.SALES_MEMO",
        headers=_sb_headers(),
        json=patch_body,
        timeout=6,
    )
    if res.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail=f"영업 메모 수정 실패: {res.text[:200]}")
    return {"status": "success", "id": memo_id}


def delete_cloud_sales_memo(memo_id: str) -> Dict[str, Any]:
    clean_id = str(memo_id).replace("CLOUD-", "").strip()
    if not clean_id.isdigit():
        raise HTTPException(status_code=400, detail="삭제 가능한 클라우드 메모 ID가 아닙니다.")
    res = requests.delete(
        f"{_sb_url('inventory_audit_logs')}?id=eq.{clean_id}&action_type=eq.SALES_MEMO",
        headers=_sb_headers(),
        timeout=6,
    )
    if res.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail=f"영업 메모 삭제 실패: {res.text[:200]}")
    return {"status": "success", "deleted_id": memo_id}


# ========================================================
# 📈 7. 품목 단가 이력(Price History)에 웹 클라우드 신규 데이터 병합
# ========================================================
def fetch_cloud_part_history(part_no: str) -> Dict[str, List[Dict[str, Any]]]:
    """Supabase 클라우드에 새로 등록된 웹 견적/출하/재고를 조회하여 레거시 단가 이력에 병합"""
    p = (part_no or "").strip()
    if not p:
        return {"purchases": [], "sales": [], "quotations": [], "purchase_orders": []}

    headers = _sb_headers(prefer="")
    res_out = {"purchases": [], "sales": [], "quotations": [], "purchase_orders": []}

    def _fetch_quotes():
        out = []
        try:
            r = requests.get(
                _sb_url("legacy_quotations"),
                headers=headers,
                params=[("part_name", f"ilike.%{p}%"), ("legacy_idx", "is.null"), ("order", "quote_date.desc"), ("limit", "30")],
                timeout=3.5,
            )
            if r.status_code == 200:
                for row in r.json() or []:
                    out.append({
                        "idx": row.get("id"),
                        "quote_date": row.get("quote_date") or "-",
                        "quote_no": row.get("quote_no") or "-",
                        "maker": row.get("maker") or "-",
                        "customer_name": row.get("customer_name") or "-",
                        "sales_rep": row.get("sales_rep") or "-",
                        "part_no": row.get("part_name") or p,
                        "qty": int(row.get("qty_int") or 0),
                        "qunit": row.get("currency_unit") or "₩",
                        "qp": float(row.get("quote_price") or 0.0),
                        "amount": float(row.get("amount") or 0.0),
                        "remark": f"[웹견적] {row.get('remark') or ''}".strip(),
                    })
        except Exception:
            pass
        return out

    def _fetch_shipments():
        out = []
        try:
            r = requests.get(
                _sb_url("legacy_shipments"),
                headers=headers,
                params=[("part_name", f"ilike.%{p}%"), ("legacy_out_id", "is.null"), ("order", "order_date.desc"), ("limit", "30")],
                timeout=3.5,
            )
            if r.status_code == 200:
                for row in r.json() or []:
                    qty = int(row.get("qty") or 0)
                    out_up = float(row.get("unit_price") or 0.0)
                    in_up = float(row.get("cost_price") or 0.0)
                    out_amt = float(row.get("total_sales_amount") or (out_up * qty))
                    mgn = out_amt - (in_up * qty)
                    mgn_rate = round((mgn / out_amt * 100), 2) if out_amt > 0 else 0.0
                    st_parts = str(row.get("status") or "").split("||")
                    cust_name = st_parts[1] if len(st_parts) > 1 and st_parts[1] else "웹 출하 거래처"
                    out.append({
                        "idx": row.get("id"),
                        "out_date": row.get("order_date") or "-",
                        "part_no": row.get("part_name") or p,
                        "maker": row.get("maker") or "-",
                        "qty": qty,
                        "in_up": in_up,
                        "out_up": out_up,
                        "out_amt": out_amt,
                        "mgn": mgn,
                        "mgn_rate": mgn_rate,
                        "sales_rep": "WEB",
                        "customer_name": cust_name,
                        "remark": f"[웹출하] PO: {row.get('po_no') or '-'}",
                    })
        except Exception:
            pass
        return out

    def _fetch_web_pos():
        out = []
        try:
            import web_purchase_orders
            for o in web_purchase_orders.get_all_web_purchase_orders():
                if p.lower() in (o.get("part_no") or "").lower():
                    out.append({
                        "idx": o.get("idx"),
                        "po_date": o.get("po_dt") or "-",
                        "po_no": o.get("po_no") or "-",
                        "part_no": o.get("part_no") or p,
                        "maker": o.get("maker") or "-",
                        "qty": int(o.get("qty") or 0),
                        "unit_price": float(o.get("foreign_up") or o.get("unit_price") or 0.0),
                        "amount": float(o.get("foreign_amount") or o.get("amount") or 0.0),
                        "currency": o.get("currency") or "USD",
                        "eta_date": o.get("eta_date") or "-",
                        "status": o.get("status") or "PO",
                        "status_label": o.get("status_label") or "입고대기(웹)",
                        "sales_rep": o.get("sales_rep") or "-",
                        "real_cust": o.get("real_cust") or "-",
                        "supplier_name": o.get("supplier_name") or "-",
                        "remark": o.get("remark") or "",
                    })
        except Exception:
            pass
        return out

    # 3개 클라우드 조회를 병렬 실행 (기존 순차 대기 대비 ~3배 속도 향상)
    with ThreadPoolExecutor(max_workers=3) as pool:
        f_q = pool.submit(_fetch_quotes)
        f_s = pool.submit(_fetch_shipments)
        f_p = pool.submit(_fetch_web_pos)
        res_out["quotations"] = f_q.result()
        res_out["sales"] = f_s.result()
        res_out["purchase_orders"] = f_p.result()

    return res_out


def merge_cloud_price_history(base_data: Dict[str, Any], part_no: str) -> Dict[str, Any]:
    """레거시/번들 단가 이력에 웹 클라우드 신규(견적/출하/발주) 데이터 병합"""
    if not base_data:
        base_data = {"part_no": part_no, "summary": {}, "purchases": [], "sales": [], "quotations": [], "purchase_orders": []}
    cloud = fetch_cloud_part_history(part_no)
    if cloud["sales"]:
        base_data["sales"] = cloud["sales"] + (base_data.get("sales") or [])
    if cloud["quotations"]:
        base_data["quotations"] = cloud["quotations"] + (base_data.get("quotations") or [])
    if cloud["purchase_orders"]:
        existing_pos = {(o.get("po_no"), o.get("part_no")) for o in (base_data.get("purchase_orders") or [])}
        new_pos = [o for o in cloud["purchase_orders"] if (o.get("po_no"), o.get("part_no")) not in existing_pos]
        if new_pos:
            base_data["purchase_orders"] = new_pos + (base_data.get("purchase_orders") or [])
    summary = base_data.get("summary") or {}
    summary["sale_count"] = len(base_data.get("sales") or [])
    summary["quote_count"] = len(base_data.get("quotations") or [])
    summary["po_count"] = len(base_data.get("purchase_orders") or [])
    base_data["summary"] = summary
    return base_data


# ========================================================
# 🔌 FastAPI 라우트 통합 등록 (main.py & api/index.py 공통 호출)
# ========================================================
def register_crud_routes(app):
    # 1. 출하 원장 CRUD
    @app.post("/api/shipments")
    def api_create_shipment(data: ShipmentCrudInput):
        return create_shipment_record(data)

    @app.put("/api/shipments/{record_id}")
    def api_update_shipment(record_id: str, data: ShipmentCrudInput):
        return update_shipment_record(record_id, data)

    @app.delete("/api/shipments/{record_id}")
    def api_delete_shipment(record_id: str):
        return delete_shipment_record(record_id)

    # 2. 견적 이력 CRUD
    @app.post("/api/quotations")
    def api_create_quotation(data: QuotationCrudInput):
        return create_quotation_record(data)

    @app.put("/api/quotations/{record_id}")
    def api_update_quotation(record_id: str, data: QuotationCrudInput):
        return update_quotation_record(record_id, data)

    @app.delete("/api/quotations/{record_id}")
    def api_delete_quotation(record_id: str):
        return delete_quotation_record(record_id)

    # 3. 미수금 관리 CRUD
    @app.post("/api/unpaid")
    def api_create_unpaid(data: UnpaidCrudInput):
        return create_unpaid_record(data)

    @app.put("/api/unpaid/{record_id}")
    def api_update_unpaid(record_id: str, data: UnpaidCrudInput):
        return update_unpaid_record(record_id, data)

    @app.delete("/api/unpaid/{record_id}")
    def api_delete_unpaid(record_id: str):
        return delete_unpaid_record(record_id)

    # 4. 거래처·담당자 마스터 CRUD
    @app.get("/api/customers")
    def api_list_customers(q: Optional[str] = None, page: int = 1, limit: int = 50):
        return list_customers_cloud(q=q, page=page, limit=limit)

    @app.post("/api/customers")
    def api_create_customer(data: CustomerCrudInput):
        return create_customer_record(data)

    @app.put("/api/customers/{record_id}")
    def api_update_customer(record_id: str, data: CustomerCrudInput):
        return update_customer_record(record_id, data)

    @app.delete("/api/customers/{record_id}")
    def api_delete_customer(record_id: str):
        return delete_customer_record(record_id)

    # 5. 발주(PO/ETA) 직접 등록 · 수정 · 입고완료 전환
    @app.post("/api/purchase-orders/web")
    def api_create_web_po(data: WebPoCrudInput):
        return create_direct_web_po(data)

    @app.put("/api/purchase-orders/web")
    def api_update_web_po(data: WebPoCrudInput):
        return update_direct_web_po(data)

    @app.post("/api/purchase-orders/receive")
    def api_receive_po(data: PoReceiveInput):
        return receive_purchase_order_to_inventory(data)

    # 6. 영업 메모 수정/삭제 (클라우드 영구 저장소)
    @app.put("/api/sales/memos/{memo_id}")
    def api_update_sales_memo(memo_id: str, data: SalesMemoUpdateInput):
        return update_cloud_sales_memo(memo_id, data)

    @app.delete("/api/sales/memos/{memo_id}")
    def api_delete_sales_memo(memo_id: str):
        return delete_cloud_sales_memo(memo_id)

    # 7. Phase 1 확장 조회 API (복수 담당자 · 매입처 · 지정 포워더 · 재고상세 · 대여/RMA/손실)
    @app.get("/api/customers/contacts")
    def api_list_customer_contacts(cid: Optional[int] = None, query: Optional[str] = None, limit: int = 500):
        import legacy_mssql
        items = legacy_mssql.query_customer_contacts(cid=cid, query=query, limit=limit)
        return {"status": "success", "total": len(items), "items": items}

    @app.get("/api/customers/contact-counts")
    def api_customer_contact_counts():
        import legacy_mssql
        counts = legacy_mssql.query_contact_counts()
        return {"status": "success", "counts": counts}

    @app.get("/api/customers/suppliers")
    def api_list_suppliers(query: Optional[str] = None, limit: int = 500):
        import legacy_mssql
        items = legacy_mssql.query_suppliers(query=query, limit=limit)
        return {"status": "success", "total": len(items), "items": items}

    @app.get("/api/customers/forwarders")
    def api_list_forwarders(cid: Optional[int] = None, query: Optional[str] = None, limit: int = 500):
        import legacy_mssql
        items = legacy_mssql.query_forwarders(cid=cid, query=query, limit=limit)
        return {"status": "success", "total": len(items), "items": items}

    @app.get("/api/inventory/detail")
    def api_inventory_detail(part_no: str, invoice_no: Optional[str] = None):
        import legacy_mssql
        detail = legacy_mssql.query_inventory_detail(part_no=part_no, invoice_no=invoice_no)
        return {"status": "success", "data": detail}

    @app.get("/api/shipped-info/borrows")
    def api_list_borrows(query: Optional[str] = None, limit: int = 300):
        import legacy_mssql
        cloud_items = list_cloud_sub_ledgers("borrow", query=query, limit=limit)
        legacy_items = legacy_mssql.query_borrows(query=query, limit=limit)
        items = cloud_items + legacy_items
        return {"status": "success", "total": len(items), "items": items}

    @app.post("/api/shipped-info/borrows")
    def api_create_borrow(payload: SubLedgerCrudInput):
        return create_cloud_sub_ledger("borrow", payload)

    @app.put("/api/shipped-info/borrows/{record_id}")
    def api_update_borrow(record_id: str, payload: SubLedgerCrudInput):
        return update_cloud_sub_ledger("borrow", record_id, payload)

    @app.delete("/api/shipped-info/borrows/{record_id}")
    def api_delete_borrow(record_id: str):
        return delete_cloud_sub_ledger(record_id)

    @app.get("/api/shipped-info/rmas")
    def api_list_rmas(query: Optional[str] = None, limit: int = 300):
        import legacy_mssql
        cloud_items = list_cloud_sub_ledgers("rma", query=query, limit=limit)
        legacy_items = legacy_mssql.query_rmas(query=query, limit=limit)
        items = cloud_items + legacy_items
        return {"status": "success", "total": len(items), "items": items}

    @app.post("/api/shipped-info/rmas")
    def api_create_rma(payload: SubLedgerCrudInput):
        return create_cloud_sub_ledger("rma", payload)

    @app.put("/api/shipped-info/rmas/{record_id}")
    def api_update_rma(record_id: str, payload: SubLedgerCrudInput):
        return update_cloud_sub_ledger("rma", record_id, payload)

    @app.delete("/api/shipped-info/rmas/{record_id}")
    def api_delete_rma(record_id: str):
        return delete_cloud_sub_ledger(record_id)

    @app.get("/api/shipped-info/losses")
    def api_list_losses(query: Optional[str] = None, limit: int = 300):
        import legacy_mssql
        cloud_items = list_cloud_sub_ledgers("loss", query=query, limit=limit)
        legacy_items = legacy_mssql.query_losses(query=query, limit=limit)
        items = cloud_items + legacy_items
        return {"status": "success", "total": len(items), "items": items}

    @app.post("/api/shipped-info/losses")
    def api_create_loss(payload: SubLedgerCrudInput):
        return create_cloud_sub_ledger("loss", payload)

    @app.put("/api/shipped-info/losses/{record_id}")
    def api_update_loss(record_id: str, payload: SubLedgerCrudInput):
        return update_cloud_sub_ledger("loss", record_id, payload)

    @app.delete("/api/shipped-info/losses/{record_id}")
    def api_delete_loss(record_id: str):
        return delete_cloud_sub_ledger(record_id)

    # 💎 Commission 미수금 클라우드 입금완료 정산 / 취소
    @app.post("/api/unpaid/commissions/settle")
    def api_settle_commission(payload: CommissionSettleInput):
        return settle_commission_record(payload)

    @app.delete("/api/unpaid/commissions/settle/{idx}")
    def api_unsettle_commission(idx: str):
        return unsettle_commission_record(idx)

    # 👤 영업 담당자별 포트폴리오 상세 조회 (Domestic 매출·마진 DReportFile + Commission 선적 ShippingFile 통합)
    @app.get("/api/analytics/rep-detail")
    def api_sales_rep_detail(
        sales_rep: str,
        start_date: Optional[str] = "2026-01-01",
        end_date: Optional[str] = "2026-12-31",
        limit: int = 500
    ):
        import legacy_mssql
        target = legacy_mssql.normalize_sales_rep(sales_rep)
        dom_sales = legacy_mssql.query_rep_domestic_sales(
            sales_rep=target, start_date=start_date, end_date=end_date, limit=limit
        )
        comm_rows = legacy_mssql.query_shipped_info(
            start_date=start_date, end_date=end_date, search_query=target, biz_type="COMMISSION", limit=limit
        )
        for it in (bundle_ships if not comm_rows else []):
            pass
        if not comm_rows:
            bundle_ships = legacy_mssql._load_phase1_bundle("shipped_info.json") or []
            s_dt = (start_date or "")[:10]
            e_dt = (end_date or "")[:10]
            for it in bundle_ships:
                if legacy_mssql.normalize_sales_rep(it.get("sales_rep")) != target:
                    continue
                if (it.get("comm_amt") or 0) <= 0 and it.get("biz_type") != "COMMISSION":
                    continue
                dt = (it.get("ship_date") or "")[:10]
                if s_dt and dt and dt < s_dt:
                    continue
                if e_dt and dt and dt > e_dt:
                    continue
                row_copy = dict(it)
                row_copy["customer"] = legacy_mssql.resolve_effective_customer(
                    it.get("customer"), it.get("real_cust"), fallback="본사 입고(BSK)"
                )
                comm_rows.append(row_copy)
        else:
            comm_rows = [it for it in comm_rows if legacy_mssql.normalize_sales_rep(it.get("sales_rep")) == target]
        return {
            "status": "success",
            "sales_rep": target,
            "domestic_sales": dom_sales,
            "commission_shipments": comm_rows,
        }

    # 🏢 고객사 360° 통합 브리핑 조회 (고객 마스터 + 복수 담당자 + 지정 포워더 + Domestic 매출·마진 + Commission + 미수금 + 견적 + 샘플/프로젝트)
    @app.get("/api/customers/360")
    def api_customer_360_briefing(
        customer_name: str,
        cid: Optional[int] = None,
        start_date: Optional[str] = "2024-01-01",
        end_date: Optional[str] = "2026-12-31",
        limit: int = 300
    ):
        import legacy_mssql
        c_name = (customer_name or "").strip()
        if not c_name or legacy_mssql.is_self_company_name(c_name) or c_name == "본사 입고(BSK)":
            raise HTTPException(status_code=400, detail="자사(BIGSHINE KOREA)가 아닌 실제 거래 고객사명을 선택해 주세요.")

        # 1) 고객 마스터 검색 (CID 확보)
        cust_info = list_customers_cloud(q=c_name, page=1, limit=15)
        matched_customers = cust_info.get("customers") or []
        primary_cust = None
        c_low = c_name.lower()
        for mc in matched_customers:
            kn = (mc.get("kname") or "").strip().lower()
            cn = (mc.get("cname") or "").strip().lower()
            if kn == c_low or cn == c_low or (cid and str(mc.get("cid")) == str(cid)):
                primary_cust = mc
                break
        if not primary_cust and matched_customers:
            primary_cust = matched_customers[0]

        resolved_cid = cid or (primary_cust.get("cid") if primary_cust else None)

        # 2) 복수 담당자 (ContactFile) & 지정 포워더 (CustForwarder)
        contacts = []
        if resolved_cid:
            contacts = legacy_mssql.query_customer_contacts(cid=int(resolved_cid), limit=100)
        if not contacts:
            contacts = legacy_mssql.query_customer_contacts(query=c_name, limit=50)

        forwarders = []
        if resolved_cid:
            forwarders = legacy_mssql.query_forwarders(cid=int(resolved_cid), limit=50)
        if not forwarders:
            forwarders = legacy_mssql.query_forwarders(query=c_name, limit=30)

        # 3) Domestic 매출·마진 (DReportFile) & Commission 출하 (ShippingFile)
        dom_sales = legacy_mssql.query_customer_domestic_sales(
            customer_name=c_name, start_date=start_date, end_date=end_date, limit=limit
        )
        comm_rows = legacy_mssql.query_shipped_info(
            start_date=start_date, end_date=end_date, search_query=c_name, biz_type="COMMISSION", limit=limit
        )
        if not comm_rows:
            bundle_ships = legacy_mssql._load_phase1_bundle("shipped_info.json") or []
            s_dt = (start_date or "")[:10]
            e_dt = (end_date or "")[:10]
            for it in bundle_ships:
                cust_hay = f"{it.get('customer','')} {it.get('customer_ename','')} {it.get('real_cust','')}".lower()
                if c_low not in cust_hay:
                    continue
                if (it.get("comm_amt") or 0) <= 0 and it.get("biz_type") != "COMMISSION":
                    continue
                dt = (it.get("ship_date") or "")[:10]
                if s_dt and dt and dt < s_dt:
                    continue
                if e_dt and dt and dt > e_dt:
                    continue
                row_copy = dict(it)
                row_copy["customer"] = legacy_mssql.resolve_effective_customer(
                    it.get("customer"), it.get("real_cust"), fallback=c_name
                )
                comm_rows.append(row_copy)
        else:
            comm_rows = [
                it for it in comm_rows
                if c_low in f"{it.get('customer','')} {it.get('customer_ename','')} {it.get('real_cust','')}".lower()
            ]

        # 4) 미수금 (Domestic 미수 + Commission 미입금)
        unpaid_dom = []
        try:
            unpaid_dom = legacy_mssql.query_unpaid_list(customer=c_name, limit=100) or []
        except Exception:
            pass
        if not unpaid_dom:
            try:
                r_up = requests.get(
                    _sb_url("legacy_unpaid"),
                    headers=_sb_headers(prefer=""),
                    params=[("customer_name", f"ilike.%{c_name}%"), ("limit", "100")],
                    timeout=4,
                )
                if r_up.status_code == 200:
                    for u in r_up.json() or []:
                        if u.get("pay_status") == "수금완료":
                            continue
                        unpaid_dom.append({
                            "idx": u.get("legacy_idx") or u.get("id"),
                            "cname": u.get("customer_name"),
                            "out_dt": u.get("out_date"),
                            "due_date": u.get("due_date"),
                            "po_no": u.get("po_no"),
                            "part_no": u.get("part_name"),
                            "mfg": u.get("maker"),
                            "qty": u.get("qty") or 0,
                            "amount_vat": float(u.get("amount_vat") or 0.0),
                            "overdue_days": int(u.get("overdue_days") or 0),
                            "pay_status": u.get("pay_status") or "미결제",
                            "sales": legacy_mssql.normalize_sales_rep(u.get("sales_rep")),
                        })
            except Exception:
                pass

        # 5) 최근 견적 이력 (legacy_quotations)
        quotations = []
        try:
            r_qt = requests.get(
                _sb_url("legacy_quotations"),
                headers=_sb_headers(prefer=""),
                params=[
                    ("customer_name", f"ilike.%{c_name}%"),
                    ("order", "quote_date.desc,quote_no.desc"),
                    ("limit", "80"),
                ],
                timeout=4,
            )
            if r_qt.status_code == 200:
                for q in r_qt.json() or []:
                    quotations.append({
                        "quote_dt": q.get("quote_date"),
                        "quote_no": q.get("quote_no"),
                        "cname": q.get("customer_name"),
                        "mfg": q.get("maker"),
                        "part_no": q.get("part_name"),
                        "qty": q.get("qty_int") or q.get("qty_str") or 0,
                        "qunit": q.get("currency_unit") or "US$",
                        "qp": float(q.get("quote_price") or 0.0),
                        "amount": float(q.get("amount") or 0.0),
                        "sales": legacy_mssql.normalize_sales_rep(q.get("sales_rep")),
                        "remark": q.get("remark") or "",
                    })
        except Exception:
            pass

        # 6) Design-In 샘플 프로젝트 트래킹 & 샘플 출고
        samples_tracking = legacy_mssql.query_sample_tracking(query=c_name, limit=80)
        samples_out = legacy_mssql.query_sample_outflows(query=c_name, limit=80)

        return {
            "status": "success",
            "customer_name": c_name,
            "cid": resolved_cid,
            "profile": primary_cust or {"kname": c_name, "cname": c_name},
            "contacts": contacts,
            "forwarders": forwarders,
            "domestic_sales": dom_sales,
            "commission_shipments": comm_rows,
            "unpaid_domestic": unpaid_dom,
            "quotations": quotations,
            "sample_projects": samples_tracking,
            "sample_outflows": samples_out,
        }

    # 🔔 상단 헤더 '오늘의 액션 알림 센터 (Action Inbox)' 통합 집계 API
    @app.get("/api/notifications/action-inbox")
    def api_action_inbox(sales_rep: Optional[str] = None):
        import legacy_mssql
        target_rep = legacy_mssql.normalize_sales_rep(sales_rep) if (sales_rep and sales_rep.upper() != "ALL") else ""
        today_str = datetime.date.today().isoformat()

        # 1) Domestic 연체 미수금 (30일 이상 또는 입금약속일 도래)
        overdue_dom = []
        try:
            raw_unpaid = legacy_mssql.query_unpaid_list(sales_rep=target_rep or None, limit=600) or []
        except Exception:
            raw_unpaid = []
        if not raw_unpaid:
            try:
                params = [("select", "*"), ("limit", "600")]
                if target_rep:
                    params.append(("sales_rep", f"eq.{target_rep}"))
                r_u = requests.get(_sb_url("legacy_unpaid"), headers=_sb_headers(prefer=""), params=params, timeout=4)
                if r_u.status_code == 200:
                    for u in r_u.json() or []:
                        raw_unpaid.append({
                            "idx": u.get("legacy_idx") or u.get("id"),
                            "cname": u.get("customer_name"),
                            "out_dt": u.get("out_date"),
                            "due_date": u.get("due_date"),
                            "part_no": u.get("part_name"),
                            "mfg": u.get("maker"),
                            "amount_vat": float(u.get("amount_vat") or 0.0),
                            "overdue_days": int(u.get("overdue_days") or 0),
                            "pay_status": u.get("pay_status") or "미결제",
                            "sales": legacy_mssql.normalize_sales_rep(u.get("sales_rep")),
                        })
            except Exception:
                pass

        for u in raw_unpaid:
            if u.get("pay_status") == "수금완료":
                continue
            rep = legacy_mssql.normalize_sales_rep(u.get("sales") or u.get("sales_rep"))
            if target_rep and rep != target_rep:
                continue
            ov = int(u.get("overdue_days") or 0)
            if ov >= 14:
                overdue_dom.append({
                    "customer": u.get("cname") or u.get("customer_name") or "-",
                    "part_no": u.get("part_no") or u.get("part_name") or "-",
                    "maker": u.get("mfg") or u.get("maker") or "",
                    "amount_krw": round(float(u.get("amount_vat") or 0.0)),
                    "overdue_days": ov,
                    "due_date": (u.get("due_date") or "")[:10],
                    "out_date": (u.get("out_dt") or u.get("out_date") or "")[:10],
                    "sales_rep": rep,
                })
        overdue_dom.sort(key=lambda x: (x["overdue_days"], x["amount_krw"]), reverse=True)

        # 2) 해외 Commission 미입금 (45일 이상 경과)
        overdue_comm = []
        try:
            comm_list = legacy_mssql.query_commission_unpaid(
                sales_rep=target_rep or None, status="UNPAID", min_date="2024-01-01", limit=400
            ) or []
        except Exception:
            comm_list = []
        if not comm_list:
            bundle_ships = legacy_mssql._load_phase1_bundle("shipped_info.json") or []
            for it in bundle_ships:
                if (it.get("comm_amt") or 0) <= 0:
                    continue
                if it.get("comm_status") == "정산완료" or it.get("bank_dt") or it.get("comm_dt"):
                    continue
                comm_list.append(it)

        today_dt = datetime.date.today()
        for c in comm_list:
            rep = legacy_mssql.normalize_sales_rep(c.get("sales_rep"))
            if target_rep and rep != target_rep:
                continue
            sdt = (c.get("ship_date") or "")[:10]
            elapsed = int(c.get("elapsed_days") or 0)
            if not elapsed and sdt and len(sdt) == 10:
                try:
                    elapsed = max(0, (today_dt - datetime.date.fromisoformat(sdt)).days)
                except Exception:
                    elapsed = 0
            if elapsed >= 45:
                overdue_comm.append({
                    "idx": c.get("idx"),
                    "customer": c.get("customer") or "-",
                    "part_no": c.get("part_no") or "-",
                    "maker": c.get("maker") or "OTHERS",
                    "comm_usd": round(float(c.get("comm_amt") or 0.0), 2),
                    "ship_date": sdt,
                    "elapsed_days": elapsed,
                    "sales_rep": rep,
                })
        overdue_comm.sort(key=lambda x: (x["elapsed_days"], x["comm_usd"]), reverse=True)

        # 3) 대여(Borrow) 미반납 / 반납기한 경과 건 (DBRWFile + 클라우드 대여)
        overdue_borrows = []
        try:
            cloud_brw = list_cloud_sub_ledgers("borrow", limit=150)
            legacy_brw = legacy_mssql.query_borrows(limit=250)
            all_brw = cloud_brw + legacy_brw
        except Exception:
            all_brw = []

        for b in all_brw:
            res_st = (b.get("result") or "").strip().upper()
            if res_st in ("RTN", "RETURN", "반납", "반납완료", "DONE", "IN"):
                continue
            rep = legacy_mssql.normalize_sales_rep(b.get("sales"))
            if target_rep and rep != target_rep:
                continue
            b_dt = (b.get("date") or "")[:10]
            rtn_dt = (b.get("rtn_date") or "")[:10]
            elapsed = 0
            if b_dt and len(b_dt) == 10:
                try:
                    elapsed = max(0, (today_dt - datetime.date.fromisoformat(b_dt)).days)
                except Exception:
                    elapsed = 0
            is_due_passed = bool(rtn_dt and len(rtn_dt) == 10 and rtn_dt < today_str)
            if is_due_passed or elapsed >= 21:
                overdue_borrows.append({
                    "idx": b.get("idx"),
                    "customer": b.get("customer_name") or "-",
                    "part_no": b.get("part_no") or "-",
                    "maker": b.get("maker") or "OTHERS",
                    "qty": int(b.get("qty") or 0),
                    "borrow_date": b_dt,
                    "rtn_plan_date": rtn_dt,
                    "elapsed_days": elapsed,
                    "sales_rep": rep,
                    "source": b.get("source") or "LEGACY",
                })

        # 4) 납기(ETA/CRD) 경과 미입고 발주 (DPOFile status='PO')
        delayed_pos = []
        try:
            po_sum = legacy_mssql.get_purchase_orders_summary() or {}
            pending_pos = po_sum.get("recent_pending_orders") or []
        except Exception:
            pending_pos = []
        for po in pending_pos:
            rep = legacy_mssql.normalize_sales_rep(po.get("sales_rep"))
            if target_rep and rep != target_rep:
                continue
            eta = (po.get("eta_date") or "")[:10]
            po_dt = (po.get("po_dt") or "")[:10]
            if (eta and len(eta) == 10 and eta < today_str) or (po_dt and len(po_dt) == 10 and po_dt < (today_dt - datetime.timedelta(days=45)).isoformat()):
                delayed_pos.append({
                    "po_no": po.get("po_no") or "-",
                    "part_no": po.get("part_no") or "-",
                    "maker": po.get("maker") or "OTHERS",
                    "qty": int(po.get("qty") or 0),
                    "po_dt": po_dt,
                    "eta_date": eta or "-",
                    "real_cust": po.get("real_cust") or po.get("supplier_name") or "-",
                    "sales_rep": rep,
                })

        return {
            "status": "success",
            "sales_rep": target_rep or "ALL",
            "overdue_domestic": overdue_dom[:60],
            "overdue_domestic_total_count": len(overdue_dom),
            "overdue_domestic_total_krw": sum(x["amount_krw"] for x in overdue_dom),
            "overdue_commission": overdue_comm[:60],
            "overdue_commission_total_count": len(overdue_comm),
            "overdue_commission_total_usd": round(sum(x["comm_usd"] for x in overdue_comm), 2),
            "overdue_borrows": overdue_borrows[:50],
            "overdue_borrows_total_count": len(overdue_borrows),
            "delayed_pos": delayed_pos[:50],
            "delayed_pos_total_count": len(delayed_pos),
        }

    # 8. Phase 2 확장 조회 API (수입 통관·B/L·부대비용 DchargeFile & 해외 송금 FinanceFile)
    @app.get("/api/import-charges")
    def api_list_import_charges(query: Optional[str] = None, supp: Optional[str] = None, limit: int = 300):
        import legacy_mssql
        items = legacy_mssql.query_import_charges(query=query, supp=supp, limit=limit)
        return {"status": "success", "total": len(items), "items": items}

    @app.get("/api/remittances")
    def api_list_remittances(query: Optional[str] = None, mfg: Optional[str] = None, limit: int = 300):
        import legacy_mssql
        items = legacy_mssql.query_remittances(query=query, mfg=mfg, limit=limit)
        return {"status": "success", "total": len(items), "items": items}

    # 9. Phase 3 확장 API (샘플·Design-In 프로젝트 트래킹 조회 + 클라우드 CRUD)
    @app.get("/api/samples/tracking")
    def api_list_sample_tracking(query: Optional[str] = None, sample_result: Optional[str] = None, sales_rep: Optional[str] = None, limit: int = 400):
        import legacy_mssql, json
        legacy_items = legacy_mssql.query_sample_tracking(query=query, sample_result=sample_result, sales_rep=sales_rep, limit=limit)
        cloud_items = []
        try:
            r = requests.get(
                _sb_url("inventory_audit_logs"),
                headers=_sb_headers(prefer=""),
                params=[("action_type", "eq.SAMPLE_TRACKING"), ("order", "id.desc"), ("limit", "100")],
                timeout=3.5,
            )
            if r.status_code == 200:
                sr_map = {1: "Design Win", 2: "Design Fail", 3: "Pending", 4: "Working"}
                br_map = {1: "Taking P.O", 2: "Fail", 3: "Waiting"}
                for row in r.json() or []:
                    try:
                        d = json.loads(row.get("details") or "{}")
                        sr = int(d.get("sample_result") or 4)
                        br = int(d.get("business_result") or 3)
                        item = {
                            "idx": f"CLOUD-{row.get('id')}",
                            "cloud_id": row.get("id"),
                            "customer_name": d.get("customer_name") or "-",
                            "part_no": d.get("part_no") or row.get("part_name") or "-",
                            "mfg": d.get("mfg") or "OTHERS",
                            "sales": d.get("sales") or "BSK",
                            "app": d.get("app") or "",
                            "prj_model": d.get("prj_model") or "",
                            "volume": int(d.get("volume") or 0),
                            "pp_date": d.get("pp_date") or "",
                            "mp_date": d.get("mp_date") or "",
                            "chipset_vendor": d.get("chipset_vendor") or "",
                            "chipset_partno": d.get("chipset_partno") or "",
                            "competitor": d.get("competitor") or "",
                            "sample_qty": int(d.get("sample_qty") or 0),
                            "sample_date": d.get("sample_date") or (row.get("created_at") or "")[:10],
                            "sample_result": sr,
                            "sample_result_label": sr_map.get(sr, "Working"),
                            "business_result": br,
                            "business_result_label": br_map.get(br, "Waiting"),
                            "update_dt": (row.get("created_at") or "")[:10],
                            "remark": d.get("remark") or "",
                            "source": "CLOUD",
                        }
                        if sample_result and sample_result.strip().upper() not in ("", "ALL"):
                            if str(sr) != str(sample_result).strip():
                                continue
                        if sales_rep and sales_rep.strip().upper() not in ("", "ALL"):
                            if item["sales"].upper() != sales_rep.strip().upper():
                                continue
                        if query and query.strip():
                            q_low = query.strip().lower()
                            if q_low not in f"{item['customer_name']} {item['part_no']} {item['mfg']} {item['app']} {item['prj_model']} {item['chipset_vendor']} {item['remark']}".lower():
                                continue
                        cloud_items.append(item)
                    except Exception:
                        pass
        except Exception:
            pass
        combined = (cloud_items + legacy_items)[:limit]
        return {"status": "success", "total": len(combined), "items": combined}

    @app.post("/api/samples/tracking")
    def api_create_sample_tracking(data: SampleTrackingCrudInput):
        import json
        payload = {
            "part_name": (data.part_no or "-").strip(),
            "action_type": "SAMPLE_TRACKING",
            "user_email": (data.sales or "BSK").strip().upper(),
            "details": json.dumps(data.dict(), ensure_ascii=False),
        }
        res = requests.post(_sb_url("inventory_audit_logs"), headers=_sb_headers(), json=payload, timeout=6)
        if res.status_code not in (200, 201):
            raise HTTPException(status_code=500, detail=f"프로젝트 트래킹 등록 실패: {res.text[:200]}")
        created = (res.json() or [{}])[0]
        return {"status": "success", "id": f"CLOUD-{created.get('id', '')}"}

    @app.put("/api/samples/tracking/{record_id}")
    def api_update_sample_tracking(record_id: str, data: SampleTrackingCrudInput):
        import json
        clean_id = str(record_id).replace("CLOUD-", "").strip()
        if not clean_id.isdigit():
            raise HTTPException(status_code=400, detail="웹 클라우드에서 등록된 프로젝트만 직접 수정할 수 있습니다.")
        patch_body = {
            "part_name": (data.part_no or "-").strip(),
            "user_email": (data.sales or "BSK").strip().upper(),
            "details": json.dumps(data.dict(), ensure_ascii=False),
        }
        res = requests.patch(
            f"{_sb_url('inventory_audit_logs')}?id=eq.{clean_id}&action_type=eq.SAMPLE_TRACKING",
            headers=_sb_headers(),
            json=patch_body,
            timeout=6,
        )
        if res.status_code not in (200, 204):
            raise HTTPException(status_code=500, detail=f"프로젝트 수정 실패: {res.text[:200]}")
        return {"status": "success", "id": record_id}

    @app.delete("/api/samples/tracking/{record_id}")
    def api_delete_sample_tracking(record_id: str):
        clean_id = str(record_id).replace("CLOUD-", "").strip()
        if not clean_id.isdigit():
            raise HTTPException(status_code=400, detail="웹 클라우드에서 등록된 프로젝트만 삭제할 수 있습니다.")
        res = requests.delete(
            f"{_sb_url('inventory_audit_logs')}?id=eq.{clean_id}&action_type=eq.SAMPLE_TRACKING",
            headers=_sb_headers(),
            timeout=6,
        )
        if res.status_code not in (200, 204):
            raise HTTPException(status_code=500, detail=f"프로젝트 삭제 실패: {res.text[:200]}")
        return {"status": "success", "deleted_id": record_id}

    @app.get("/api/samples/stock")
    def api_list_sample_stock(query: Optional[str] = None, only_avail: bool = True, limit: int = 400):
        import legacy_mssql
        items = legacy_mssql.query_sample_stock(query=query, only_avail=only_avail, limit=limit)
        return {"status": "success", "total": len(items), "items": items}

    @app.get("/api/samples/requests")
    def api_list_sample_requests(query: Optional[str] = None, limit: int = 300):
        import legacy_mssql
        items = legacy_mssql.query_sample_requests(query=query, limit=limit)
        return {"status": "success", "total": len(items), "items": items}

    @app.get("/api/samples/incomes")
    def api_list_sample_incomes(query: Optional[str] = None, limit: int = 300):
        import legacy_mssql
        items = legacy_mssql.query_sample_incomes(query=query, limit=limit)
        return {"status": "success", "total": len(items), "items": items}

    @app.get("/api/samples/outflows")
    def api_list_sample_outflows(query: Optional[str] = None, limit: int = 300):
        import legacy_mssql
        items = legacy_mssql.query_sample_outflows(query=query, limit=limit)
        return {"status": "success", "total": len(items), "items": items}




