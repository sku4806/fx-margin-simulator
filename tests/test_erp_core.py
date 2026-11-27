import json
import os
import sys
import unittest

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

import legacy_mssql
import erp_crud
import run_sync


class TestErpCore(unittest.TestCase):
    def test_normalize_sales_rep_aliases_and_typos(self):
        self.assertEqual(legacy_mssql.normalize_sales_rep("고기봉"), "WILLIAM")
        self.assertEqual(legacy_mssql.normalize_sales_rep("willam"), "WILLIAM")
        self.assertEqual(legacy_mssql.normalize_sales_rep("조지윤"), "JOEY")
        self.assertEqual(legacy_mssql.normalize_sales_rep("김경래"), "KELLY")
        self.assertEqual(legacy_mssql.normalize_sales_rep(""), "")

    def test_self_company_detection_and_realcust_fallback(self):
        self.assertTrue(legacy_mssql.is_self_company_name("BIGSHINE KOREA CO., LTD"))
        self.assertTrue(legacy_mssql.is_self_company_name("빅샤인코리아(주)"))
        self.assertFalse(legacy_mssql.is_self_company_name("Seronics"))

        self.assertEqual(
            legacy_mssql.resolve_effective_customer("BIGSHINE KOREA CO., LTD", "유라(주)"),
            "유라(주)",
        )
        self.assertEqual(
            legacy_mssql.resolve_effective_customer("BIGSHINE KOREA CO., LTD", ""),
            "본사 입고(BSK)",
        )
        self.assertEqual(
            legacy_mssql.resolve_effective_customer("LG이노텍", "LG이노텍 평택"),
            "LG이노텍",
        )

    def test_encode_shipment_status_with_file_no(self):
        encoded = erp_crud._encode_shipment_status(
            "SHIPPED",
            "Seronics",
            "Seronics",
            "AUDIO",
            biz_type="COMMISSION",
            comm_rate=5.5,
            comm_amt=123.45,
            sales_rep="kelly",
            awb_no="AWB-1234",
            file_no="IS2611-01",
        )
        parts = encoded.split("||")
        self.assertEqual(parts[0], "SHIPPED")
        self.assertEqual(parts[4], "COMMISSION")
        self.assertEqual(parts[5], "5.5")
        self.assertEqual(parts[7], "KELLY")
        self.assertEqual(parts[8], "AWB-1234")
        self.assertEqual(parts[9], "IS2611-01")

    def test_run_sync_clean_val(self):
        self.assertEqual(run_sync.clean_val(None), "")
        self.assertEqual(run_sync.clean_val(b"  TEST  "), "TEST")
        self.assertEqual(run_sync.clean_val("  XU316  "), "XU316")

    def test_bundle_json_files_valid(self):
        data_dir = os.path.join(ROOT_DIR, "data")
        required = [
            "purchase_orders.json",
            "shipped_info.json",
            "samples_bundle.json",
            "import_charges.json",
            "remittances.json",
        ]
        for fname in required:
            fpath = os.path.join(data_dir, fname)
            self.assertTrue(os.path.exists(fpath), f"Missing bundle: {fname}")
            with open(fpath, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            self.assertTrue(len(loaded) > 0, f"Empty bundle: {fname}")


if __name__ == "__main__":
    unittest.main()
