import json
import os
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

def run_sync_ship_fx():
    # .env 파일에서 환경변수 로드
    env_file = ".env"
    if os.path.exists(env_file):
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                if "=" in line and not line.strip().startswith("#"):
                    k, v = line.strip().split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip())

    sb_url = os.getenv("SUPABASE_URL", "https://qheijtepveajdrqerxef.supabase.co")
    service_key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")

    if not service_key:
        print("❌ SUPABASE_SERVICE_KEY 환경변수가 설정되지 않았습니다.")
        return

    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json"
    }

    print("1. Supabase 재고 목록 전체 조회 중...")
    all_inv = []
    limit = 1000
    offset = 0
    while True:
        res = requests.get(
            f"{sb_url}/rest/v1/inventory_items?select=id,part_name,invoice_no,entry_date,stock,unit_usd,ship_fx&limit={limit}&offset={offset}",
            headers=headers
        )
        if res.status_code != 200:
            print("재고 목록 조회 에러:", res.status_code, res.text)
            break
        data = res.json()
        if not data:
            break
        all_inv.extend(data)
        if len(data) < limit:
            break
        offset += limit

    print(f"총 {len(all_inv)}건의 재고 품목 로드 완료.")

    # 2. price_history.json 로드
    ph_path = "api/data/price_history.json"
    if not os.path.exists(ph_path):
        ph_path = "data/price_history.json"
    with open(ph_path, "r", encoding="utf-8") as f:
        ph_data = json.load(f)

    incomes = ph_data.get("incomes", [])
    print(f"사내 ERP 입고 원장: {len(incomes)}건 로드 완료.")

    # 3. 매핑 맵 구축
    by_inv_part = {}
    by_part_list = {}
    for inc in incomes:
        inv = (inc.get("invoice_no") or "").strip().upper()
        part = (inc.get("part_no") or "").strip().upper()
        rate = inc.get("in_rate")
        if rate and float(rate) > 500:
            if inv and part:
                by_inv_part[(inv, part)] = inc
            if part:
                by_part_list.setdefault(part, []).append(inc)

    # 4. 대상 매칭
    updates = []
    exact_matches = 0
    part_matches = 0
    unchanged = 0

    for item in all_inv:
        inv = (item.get("invoice_no") or "").strip().upper()
        part = (item.get("part_name") or "").strip().upper()

        matched = None
        match_type = ""
        if (inv, part) in by_inv_part:
            matched = by_inv_part[(inv, part)]
            match_type = "EXACT"
            exact_matches += 1
        elif part in by_part_list:
            matched = by_part_list[part][0]
            match_type = "PART_ONLY"
            part_matches += 1
        else:
            unchanged += 1

        if matched:
            real_rate = round(float(matched["in_rate"]), 2)
            sl_up = float(matched.get("sl_up") or 0)
            w_up = float(matched.get("w_up") or 0)
            old_usd = float(item.get("unit_usd") or 0)

            real_usd = round(sl_up if sl_up > 0 else (w_up / real_rate if w_up > 0 else old_usd), 4)

            # 변경 필요 여부 확인
            if abs(float(item.get("ship_fx") or 0) - real_rate) > 0.05 or abs(old_usd - real_usd) > 0.0001:
                updates.append({
                    "id": item["id"],
                    "part": item.get("part_name"),
                    "inv": item.get("invoice_no"),
                    "match_type": match_type,
                    "old_fx": item.get("ship_fx"),
                    "new_fx": real_rate,
                    "old_usd": old_usd,
                    "new_usd": real_usd
                })

    print(f"\n[매칭 결과 요약]")
    print(f"- 송장+품번 완전 일치: {exact_matches}건")
    print(f"- 품번 기준 매칭: {part_matches}건")
    print(f"- 매칭 미대상(국내 매입/실사재고 등): {unchanged}건")
    print(f"- 실제 DB 업데이트 대상: {len(updates)}건\n")

    # 5. 병렬 PATCH 업데이트
    def update_item(u):
        patch_url = f"{sb_url}/rest/v1/inventory_items?id=eq.{u['id']}"
        payload = {
            "ship_fx": u["new_fx"],
            "unit_usd": u["new_usd"]
        }
        res = requests.patch(patch_url, headers=headers, json=payload, timeout=10)
        return res.status_code == 200 or res.status_code == 204

    success_count = 0
    fail_count = 0

    print(f"동시 스레드(15)로 {len(updates)}건 업데이트 진행 중...")
    with ThreadPoolExecutor(max_workers=15) as executor:
        futures = {executor.submit(update_item, u): u for u in updates}
        for future in as_completed(futures):
            if future.result():
                success_count += 1
            else:
                fail_count += 1

    print(f"\n✅ 업데이트 완료: 성공 {success_count}건 / 실패 {fail_count}건")

    # 통계 출력
    if updates:
        fx_rates = [u["new_fx"] for u in updates]
        print(f"- 업데이트된 환율 범위: 최저 ₩{min(fx_rates):,.2f} ~ 최고 ₩{max(fx_rates):,.2f} (평균 ₩{sum(fx_rates)/len(fx_rates):,.2f})")
        print("\n[주요 업데이트 샘플 (상위 8건)]")
        for u in updates[:8]:
            print(f"• [{u['inv'] or '-'}] {u['part'][:28]}: 선적환율 ₩{u['old_fx']} ➔ ₩{u['new_fx']:,.2f} | 매입단가 ${u['old_usd']:.4f} ➔ ${u['new_usd']:.4f}")

if __name__ == "__main__":
    run_sync_ship_fx()
