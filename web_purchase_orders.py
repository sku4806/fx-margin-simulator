"""
web_purchase_orders.py
웹 ERP 전자결재(구매 품의서) 승인 건과 레거시 매입 발주(DPOFile) 통합 연동 모듈
"""

import os
import json
import re
import requests
from typing import List, Dict, Any, Optional

PAYMENT_SB_URL = "https://omtcanlmnpbiqoiakylp.supabase.co"
PAYMENT_SB_KEY = "sb_publishable_80MMaw7IKefD7v2lx8PgeA_eWuX2Yeq"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATHS = [
    os.path.join(BASE_DIR, "data", "web_purchase_orders.json"),
    os.path.join(BASE_DIR, "api", "data", "web_purchase_orders.json")
]

def _ensure_dir(p):
    d = os.path.dirname(p)
    if d and not os.path.exists(d):
        os.makedirs(d, exist_ok=True)

def load_local_web_orders() -> List[Dict[str, Any]]:
    for p in DATA_PATHS:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        return data
            except Exception as e:
                print(f"[WARN] Failed to read {p}: {e}")
    return []

def save_local_web_order(order_dict: Dict[str, Any]) -> bool:
    orders = load_local_web_orders()
    # 중복 체크 (po_no + part_no 기준)
    exists = any(
        o.get("po_no") == order_dict.get("po_no") and o.get("part_no") == order_dict.get("part_no")
        for o in orders
    )
    if not exists:
        orders.insert(0, order_dict)
        for p in DATA_PATHS:
            try:
                _ensure_dir(p)
                with open(p, "w", encoding="utf-8") as f:
                    json.dump(orders, f, ensure_ascii=False, indent=2)
            except Exception as e:
                print(f"[WARN] Failed to write {p}: {e}")
        return True
    return False

def fetch_supabase_approved_purchases() -> List[Dict[str, Any]]:
    """전자결재(approval_requests)에서 승인된 구매품의서 조회 및 표준 변환"""
    try:
        headers = {
            "apikey": PAYMENT_SB_KEY,
            "Authorization": f"Bearer {PAYMENT_SB_KEY}"
        }
        url = f"{PAYMENT_SB_URL}/rest/v1/approval_requests?status=eq.APPROVED&select=*&order=created_at.desc"
        res = requests.get(url, headers=headers, timeout=4)
        if res.status_code != 200:
            return []

        rows = res.json()
        converted = []
        for r in rows:
            doc_type = (r.get("doc_type") or "").lower()
            title = r.get("title") or ""
            # 구매 품의서 여부 확인 (한글/영문 doc_type 및 제목 검사)
            is_purchase_doc = (
                "purchase" in doc_type or
                "구매" in doc_type or
                "발주" in doc_type or
                "구매" in title or
                "발주" in title
            )
            if not is_purchase_doc:
                continue

            doc_no = r.get("doc_no") or "PO-WEB"
            po_dt = (r.get("created_at") or "")[:10]
            eta_date = r.get("target_date") or "-"
            drafter = r.get("drafter_name") or "기안자"
            content = r.get("content") or ""
            items = r.get("items") or []
            meta = r.get("meta") or {}

            # 본문 내 HTML 주석 메타데이터 역직렬화 (ERP_META 및 DRAFT_DATA)
            if not meta and content:
                meta_match = re.search(r"<!-- ERP_META:\s*([\s\S]*?)\s*-->", content)
                if meta_match:
                    try:
                        meta = json.loads(meta_match.group(1))
                    except Exception:
                        pass
            if not items and content:
                draft_match = re.search(r"<!-- DRAFT_DATA:\s*([\s\S]*?)\s*-->", content)
                if draft_match:
                    try:
                        draft_data = json.loads(draft_match.group(1))
                        items = draft_data.get("items") or []
                        if not meta.get("vendor"):
                            meta["vendor"] = draft_data.get("vendor")
                        if not meta.get("customer"):
                            meta["customer"] = draft_data.get("customer")
                    except Exception:
                        pass
                if not items and meta and meta.get("items"):
                    items = meta.get("items")

            if items and isinstance(items, list) and len(items) > 0:
                for idx, itm in enumerate(items, 1):
                    sub_po = f"{doc_no}-{idx}" if len(items) > 1 else doc_no
                    part_no = (itm.get("part_no") or itm.get("part_name") or "미지정 부품").strip()
                    maker = (itm.get("maker") or "기타").strip()
                    qty = int(itm.get("qty") or 1)
                    curr = (itm.get("currency") or "USD").upper().strip()
                    uprice = float(itm.get("unit_price") or 0.0)
                    vendor = itm.get("vendor") or meta.get("vendor") or "공급사 미지정"
                    cust = itm.get("customer") or meta.get("customer") or "실수요처 미지정"
                    memo = itm.get("memo") or r.get("memo") or ""

                    is_usd = curr == "USD"
                    up_krw = round(uprice * 1350) if is_usd else uprice
                    amt_krw = up_krw * qty
                    foreign_up = uprice if is_usd else round(uprice / 1350, 4)
                    foreign_amt = foreign_up * qty

                    converted.append({
                        "idx": f"WEB-{doc_no}-{idx}",
                        "po_dt": po_dt,
                        "po_no": sub_po,
                        "part_no": part_no,
                        "maker": maker,
                        "qty": qty,
                        "unit_price": up_krw,
                        "amount": amt_krw,
                        "currency": curr,
                        "foreign_up": foreign_up,
                        "foreign_amount": foreign_amt,
                        "eta_date": eta_date,
                        "status": "PO",
                        "status_label": "입고대기(전자결재)",
                        "sales_rep": drafter,
                        "supplier_name": vendor,
                        "real_cust": cust,
                        "remark": f"[전자결재 승인 발주] {memo}".strip(),
                        "source": "WEB_APPROVAL"
                    })
            else:
                part_no = meta.get("part_name") or title
                maker = meta.get("maker") or "기타"
                qty = int(meta.get("qty") or 1)
                curr = (meta.get("currency") or "USD").upper().strip()
                uprice = float(meta.get("unit_price") or 0.0)
                vendor = meta.get("vendor") or "공급사 미지정"
                cust = meta.get("customer") or "실수요처 미지정"
                memo = meta.get("memo") or r.get("memo") or ""

                is_usd = curr == "USD"
                up_krw = round(uprice * 1350) if is_usd else uprice
                amt_krw = up_krw * qty
                foreign_up = uprice if is_usd else round(uprice / 1350, 4)
                foreign_amt = foreign_up * qty

                converted.append({
                    "idx": f"WEB-{doc_no}",
                    "po_dt": po_dt,
                    "po_no": doc_no,
                    "part_no": part_no,
                    "maker": maker,
                    "qty": qty,
                    "unit_price": up_krw,
                    "amount": amt_krw,
                    "currency": curr,
                    "foreign_up": foreign_up,
                    "foreign_amount": foreign_amt,
                    "eta_date": eta_date,
                    "status": "PO",
                    "status_label": "입고대기(전자결재)",
                    "sales_rep": drafter,
                    "supplier_name": vendor,
                    "real_cust": cust,
                    "remark": f"[전자결재 승인 발주] {memo}".strip(),
                    "source": "WEB_APPROVAL"
                })
        return converted
    except Exception as e:
        print(f"[WARN] fetch_supabase_approved_purchases error: {e}")
        return []

def get_all_web_purchase_orders() -> List[Dict[str, Any]]:
    """로컬 캐시와 Supabase 승인 건을 통합하여 최신 웹 발주 리스트 반환"""
    local_orders = load_local_web_orders()
    sb_orders = fetch_supabase_approved_purchases()

    # 중복 제거 (po_no + part_no 기준)
    seen = set()
    combined = []

    for o in sb_orders + local_orders:
        key = (o.get("po_no"), o.get("part_no"))
        if key not in seen:
            seen.add(key)
            combined.append(o)

    # 발주일자 최신순 정렬
    combined.sort(key=lambda x: str(x.get("po_dt") or ""), reverse=True)
    return combined

def filter_web_orders(
    orders: List[Dict[str, Any]],
    status: Optional[str] = None,
    q: Optional[str] = None,
    sales_rep: Optional[str] = None,
    part_no: Optional[str] = None,
    po_no: Optional[str] = None,
    maker: Optional[str] = None
) -> List[Dict[str, Any]]:
    filtered = []
    q_lower = q.lower().strip() if q else None

    for o in orders:
        if status and status != "ALL" and o.get("status") != status:
            continue
        if sales_rep and sales_rep != "ALL" and sales_rep.lower() not in (o.get("sales_rep") or "").lower():
            continue
        if part_no and part_no.lower() not in (o.get("part_no") or "").lower():
            continue
        if po_no and po_no.lower() not in (o.get("po_no") or "").lower():
            continue
        if maker and maker.lower() not in (o.get("maker") or "").lower():
            continue

        if q_lower:
            match = (
                q_lower in (o.get("part_no") or "").lower() or
                q_lower in (o.get("po_no") or "").lower() or
                q_lower in (o.get("maker") or "").lower() or
                q_lower in (o.get("supplier_name") or "").lower() or
                q_lower in (o.get("real_cust") or "").lower() or
                q_lower in (o.get("sales_rep") or "").lower() or
                q_lower in (o.get("remark") or "").lower()
            )
            if not match:
                continue

        filtered.append(o)

    return filtered
