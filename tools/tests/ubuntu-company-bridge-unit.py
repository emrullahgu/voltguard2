"""Security/compatibility checks without contacting the Ubuntu database."""
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "ubuntu-company-bridge.py"
spec = importlib.util.spec_from_file_location("ubuntu_company_bridge", SOURCE)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
STAFF = "s" + "a" * 24
OTHER = "s" + "b" * 24
SITE = "1" * 32
LEGACY = "98dba43d-8f56-4d02-8b3b-06a5874b0edb"
ID = "77770d7a-56d4-4666-af31-a6270c4c89ad"
ADMIN = {"id": STAFF, "role": "admin"}


class FakeDB:
    def __init__(self, actual):
        self.actual = actual
        self.statements = []

    def execute(self, sql):
        self.statements.append(sql)
        return []

    def json(self, sql):
        self.statements.append(sql)
        return [self.actual]


class BridgeTests(unittest.TestCase):
    def reject(self, callback, code):
        with self.assertRaises(bridge.BridgeError) as error:
            callback()
        self.assertEqual(error.exception.code, code)

    def patch(self, table="products", row=None):
        return {"changes": [{"table": table, "id": ID, "before": None, "row": row or {"id": ID, "name": "Test"}}]}

    def test_no_account_or_arbitrary_table_surface(self):
        for table in ("users", "user_credentials", "auth.users", "products; DROP TABLE users", "pg_authid"):
            self.reject(lambda: bridge.validate_commit(self.patch(table), ADMIN), "bridge_table")

    def test_payroll_roles_checked_for_every_table(self):
        employee = {"id": STAFF, "role": "employee"}
        for table in bridge.SCHEMA:
            if bridge.sensitive(table):
                self.reject(lambda: bridge.validate_commit(self.patch(table, {"id": ID}), employee), "bridge_payroll")
                self.assertTrue(bridge.validate_commit(self.patch(table, {"id": ID}), {"id": STAFF, "role": "payroll"}))

    def test_native_owner_never_inferred_from_legacy_uuid_or_name(self):
        raw = {"id": ID, "name": "A", "user_id": LEGACY}
        self.assertIsNone(bridge.normalize("bordro_employees", raw)["user_id"])
        side = {"fields": {"user_id": {"value": STAFF, "anchor": LEGACY}}}
        self.assertEqual(bridge.normalize("bordro_employees", raw, side)["user_id"], STAFF)
        self.assertIsNone(bridge.normalize("bordro_employees", {**raw, "user_id": str(uuid.uuid4())}, side)["user_id"])

    def test_compare_token_covers_hidden_legacy_relationship_and_sidecar(self):
        raw = {"id": ID, "user_id": LEGACY}
        first = bridge.row_token(raw, None)
        self.assertNotEqual(first, bridge.row_token({**raw, "user_id": None}, None))
        self.assertNotEqual(first, bridge.row_token(raw, {"fields": {"user_id": {"value": STAFF, "anchor": LEGACY}}}))
        self.assertEqual(first, bridge.row_token({"user_id": LEGACY, "id": ID}, None))

    def test_bigint_ids_remain_strings_in_native_api(self):
        self.assertEqual(bridge.normalize("gorevler", {"id": 12, "baslik": "Test"})["id"], "12")
        self.assertEqual(bridge.normalize("osos_olcumler", {"id": 19})["id"], "19")

    def test_document_key_is_stable_bounded_and_unambiguous(self):
        a = bridge.row_key("company_documents", {"kind": "osos_rapor", "record_id": "a" * 128})
        self.assertEqual(len(a), 36)
        self.assertEqual(a, bridge.row_key("company_documents", {"kind": "osos_rapor", "record_id": "a" * 128}))
        self.assertNotEqual(a, bridge.row_key("company_documents", {"kind": "teklif", "record_id": "a" * 128}))

    def test_actor_uuid_does_not_reuse_or_reset_any_auth_account(self):
        value = bridge.actor_id(STAFF, SITE)
        self.assertRegex(value, bridge.UUID)
        self.assertEqual(value, bridge.actor_id(STAFF, SITE))
        self.assertNotEqual(value, bridge.actor_id(STAFF, "2" * 32))
        self.assertNotEqual(value, bridge.actor_id(OTHER, SITE))

    def test_owner_write_preserves_original_auth_users_foreign_key(self):
        raw = {"id": ID, "name": "Test", "user_id": LEGACY}
        db = FakeDB(raw)
        repo = bridge.Repository(db)
        repo.site = SITE
        repo.columns = {"bordro_employees": {"id": {"type": "uuid"}, "name": {"type": "text"}, "user_id": {"type": "uuid"}}}
        result = repo._write("bordro_employees", {"id": ID, "name": "Test", "user_id": OTHER}, raw, None, ADMIN)
        self.assertEqual(result["user_id"], OTHER)
        self.assertEqual(raw["user_id"], LEGACY)
        self.assertFalse(any("UPDATE public" in statement for statement in db.statements))
        self.assertTrue(any("voltguard_site.rows" in statement and SITE in statement for statement in db.statements))

    def test_native_actor_foreign_key_stays_null(self):
        raw = {"id": ID, "user_id": None, "action_type": "save"}
        db = FakeDB(raw)
        repo = bridge.Repository(db)
        repo.site = SITE
        repo.columns = {"activity_logs": {"id": {"type": "uuid"}, "user_id": {"type": "uuid"}, "action_type": {"type": "text"}}}
        result = repo._write("activity_logs", {"id": ID, "user_id": STAFF, "action_type": "save"}, None, None, ADMIN)
        self.assertEqual(result["user_id"], STAFF)
        self.assertIn('"user_id":null', db.statements[0])

    def test_material_delete_checks_history_arrays_inside_transaction(self):
        history = {"id": LEGACY, "kullanilan_malzemeler": [ID]}
        db = FakeDB(history)
        repo = bridge.Repository(db)
        repo.site = SITE
        # No scalar FK column: material history must still be queried and locked.
        repo.columns = {"is_takip_kayitlar": {"id": {"type": "uuid"}, "kullanilan_malzemeler": {"type": "ARRAY"}}}
        self.reject(lambda: repo._check_delete_relations("is_takip_malzemeler", {"id": ID}, []), "bridge_relation_in_use")
        self.assertIn('to_jsonb("kullanilan_malzemeler")', db.statements[0])
        self.assertIn(bridge.sql_text(ID), db.statements[0])
        self.assertIn("FOR UPDATE", db.statements[0])

    def test_material_history_guard_honors_only_replacements_removing_reference(self):
        history = {"id": LEGACY, "kullanilan_malzemeler": [ID]}
        repo = bridge.Repository(FakeDB(history))
        repo.site = SITE
        repo.columns = {"is_takip_kayitlar": {"id": {"type": "uuid"}, "kullanilan_malzemeler": {"type": "jsonb"}}}
        change = {"table": "is_takip_kayitlar", "id": LEGACY, "row": {**history, "notlar": "Edited only"}}
        self.reject(lambda: repo._check_delete_relations("is_takip_malzemeler", {"id": ID}, [change]), "bridge_relation_in_use")
        for replacement in (None, {**history, "kullanilan_malzemeler": []}, {**history, "kullanilan_malzemeler": [OTHER]}):
            repo._check_delete_relations("is_takip_malzemeler", {"id": ID}, [{**change, "row": replacement}])

    def test_material_array_guard_is_scoped_to_material_deletion(self):
        db = FakeDB({"id": LEGACY, "kullanilan_malzemeler": [ID]})
        repo = bridge.Repository(db)
        repo.site = SITE
        repo.columns = {"is_takip_kayitlar": {"id": {"type": "uuid"}, "kullanilan_malzemeler": {"type": "ARRAY"}}}
        repo._check_delete_relations("products", {"id": ID}, [])
        self.assertEqual(db.statements, [])

    def test_scalar_history_guard_still_rejects_numeric_foreign_keys(self):
        history = {"id": LEGACY, "vehicle_id": 12}
        repo = bridge.Repository(FakeDB(history))
        repo.site = SITE
        repo.columns = {"fuel_records": {"id": {"type": "uuid"}, "vehicle_id": {"type": "bigint"}}}
        self.reject(lambda: repo._check_delete_relations("vehicles", {"id": 12}, []), "bridge_relation_in_use")
        change = {"table": "fuel_records", "id": LEGACY, "row": {**history, "vehicle_id": 13}}
        repo._check_delete_relations("vehicles", {"id": 12}, [change])

    def test_storage_is_versioned_and_byte_bounded(self):
        bridge.validate_commit({"storageChanges": [{"key": "theme", "before": None, "value": "ş"}]}, ADMIN)
        self.reject(lambda: bridge.validate_commit({"storageChanges": [{"key": "theme", "before": "bad", "value": "x"}]}, ADMIN), "bridge_storage")
        self.reject(lambda: bridge.validate_commit({"storageChanges": [{"key": "theme", "before": None, "value": "ş" * (1024 * 1024 + 1)}]}, ADMIN), "bridge_storage")

    def test_unknown_field_actor_forgery_and_duplicate_patch_rejected(self):
        self.reject(lambda: bridge.validate_commit(self.patch(row={"id": ID, "password": "x"}), ADMIN), "bridge_row")
        request = self.patch()
        request["changes"].append(request["changes"][0])
        self.reject(lambda: bridge.validate_commit(request, ADMIN), "bridge_duplicate")
        self.reject(lambda: bridge.validate_commit({"audit": [{"at": "2026-10-13T12:00:00Z", "actor": OTHER, "event": "save", "target": ID}]}, ADMIN), "bridge_audit")

    def test_invalid_actor_and_site_denied(self):
        for actor in ({"id": LEGACY, "role": "admin"}, {"id": STAFF, "role": "superadmin"}, None):
            self.reject(lambda: bridge.validate_actor(actor), "bridge_actor")
        for site in ("../data", "", "1" * 31, "1" * 65, None):
            self.reject(lambda: bridge.validate_site(site), "bridge_site")

    def test_health_rejects_invalid_identity_before_connecting(self):
        for payload, code in (({"op": "health", "actor": {"id": LEGACY, "role": "admin"}, "site": SITE}, "bridge_actor"), ({"op": "health", "actor": ADMIN, "site": "../private"}, "bridge_site")):
            result = subprocess.run([sys.executable, "-B", str(SOURCE), "--config", str(SOURCE.parent / "does-not-exist.json")], input=json.dumps(payload), text=True, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0)
            response = json.loads(result.stdout)
            self.assertFalse(response["ok"])
            self.assertEqual(response["code"], code)
            self.assertEqual(response["status"], 403)

    def test_sql_values_are_literal_and_identifiers_are_allowlisted(self):
        text = "x'); DROP TABLE users; --\\path"
        self.assertEqual(bridge.sql_text(text), "'x''); DROP TABLE users; --\\path'")
        self.reject(lambda: bridge.sql_ident("products; SELECT"), "bridge_identifier")
        self.reject(lambda: bridge.sql_text("x\0y"), "bridge_value")

    def test_install_changes_only_private_namespace_and_keeps_rls_enabled(self):
        self.assertNotIn("DISABLE ROW LEVEL SECURITY", bridge.INSTALL_SQL)
        self.assertNotIn("ALTER TABLE public", bridge.INSTALL_SQL)
        self.assertNotIn("CREATE OR REPLACE FUNCTION public", bridge.INSTALL_SQL)
        self.assertEqual(bridge.INSTALL_SQL.count("ENABLE ROW LEVEL SECURITY"), 7)
        self.assertIn("REVOKE ALL ON SCHEMA voltguard_site FROM PUBLIC,anon,authenticated", bridge.INSTALL_SQL)

    def test_private_catalog_requires_complete_bounded_typed_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            sources = {}
            for key, value in {"historicalInvoice1": [], "historicalInvoice2": [], "cablePrices": {}, "packages": {"paketler": []}}.items():
                filename = Path(directory) / (key + ".json")
                filename.write_text(json.dumps(value), encoding="utf-8")
                sources[key] = str(filename)
            self.assertEqual(len(bridge.read_catalog(sources)), 4)
            self.reject(lambda: bridge.read_catalog({"historicalInvoice1": sources["historicalInvoice1"]}), "bridge_catalog_config")
            Path(sources["historicalInvoice1"]).write_text("{}", encoding="utf-8")
            self.reject(lambda: bridge.read_catalog(sources), "bridge_catalog")


if __name__ == "__main__":
    unittest.main()
