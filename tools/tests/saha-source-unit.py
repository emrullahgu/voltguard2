"""Source connector security/identity regression checks without database access."""
import importlib.util
import unittest
import uuid
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "ubuntu-saha-source.py"
spec = importlib.util.spec_from_file_location("saha_source_under_test", SOURCE)
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)
b = source.b
ACTOR = {"id": "s" + "a" * 24, "role": "admin"}
SITE = "1" * 32
ID = "77770d7a-56d4-4666-af31-a6270c4c89ad"
LEGACY = "98dba43d-8f56-4d02-8b3b-06a5874b0edb"


def row(collection, payload, revision=1):
    identifier = payload["id"]
    return {"id": source.key(collection, identifier), "collection": collection,
            "record_id": identifier, "payload": payload, "revision": revision}


class FakeDB:
    def __init__(self, answers=()):
        self.answers = list(answers)
        self.statements = []

    def execute(self, sql):
        self.statements.append(sql)
        return []

    def json(self, sql):
        self.statements.append(sql)
        if not self.answers:
            raise AssertionError("Unexpected SQL: " + sql)
        return self.answers.pop(0)


class SourceTests(unittest.TestCase):
    def reject(self, callback, code):
        with self.assertRaises(b.BridgeError) as caught:
            callback()
        self.assertEqual(caught.exception.code, code)

    def repo(self, db=None):
        repo = source.Repository(db or FakeDB())
        repo.site = SITE
        return repo

    def test_reviewed_collections_never_include_authentication_or_secrets(self):
        for name in ("profiles", "two_factor", "security_policies", "kvkk_consents",
                     "api_keys", "app_settings", "pending_user_approvals", "push_tokens"):
            self.assertNotIn(name, source.ALLOWED)
        self.assertIn("customers", source.ALLOWED)
        self.assertIn("app_usage", source.ALLOWED)

    def test_composite_key_is_stable_and_covers_every_part(self):
        repo = self.repo()
        repo.pks = {"app_usage": ["user_id", "date"]}
        raw = {"user_id": LEGACY, "date": "2026-10-27", "actions": 10}
        first = repo.identifier("app_usage", raw)
        self.assertEqual(first, repo.identifier("app_usage", {**raw, "actions": 11}))
        self.assertNotEqual(first, repo.identifier("app_usage", {**raw, "date": "2026-10-28"}))
        self.assertNotEqual(first, repo.identifier("app_usage", {**raw, "user_id": ID}))
        uuid.UUID(first)
        self.assertEqual(repo.where("app_usage", raw), '"user_id"::text=\'' + LEGACY + '\' AND "date"::text=\'2026-10-27\'')

    def test_empty_primary_key_is_not_a_mass_update_predicate(self):
        repo = self.repo()
        self.reject(lambda: repo.where("customers", {"short_name": "QA"}), "bridge_saha_primary_key")
        self.reject(lambda: repo.identifier("customers", {"short_name": "QA"}), "bridge_saha_primary_key")

    def test_nonnullable_native_owner_goes_private_without_creating_auth_user(self):
        db = FakeDB([{"exists": False}, {"id": source.key("locations", ID), "collection": "locations"}])
        repo = self.repo(db)
        repo.columns = {"locations": {name: {"generated": False, "nullable": name != "user_id", "type": "uuid" if name in {"id", "user_id"} else "numeric"}
                                       for name in ("id", "user_id", "lat", "lng")}}
        repo.kinds = {"locations": "r"}
        repo.fks = [{"table": "locations", "column": "user_id", "targetSchema": "public",
                     "target": "profiles", "targetColumn": "id"}]
        repo.write(row("locations", {"id": ID, "user_id": b.saha_staff_id(ACTOR["id"]),
                                     "lat": 38.4, "lng": 27.1}), None, ACTOR)
        joined = "\n".join(db.statements)
        self.assertIn("INSERT INTO voltguard_site.saha_records", joined)
        self.assertNotIn('INSERT INTO public."locations"', joined)
        self.assertNotIn("INSERT INTO auth", joined)
        self.assertNotIn('INSERT INTO "auth"', joined)
        self.assertNotIn('INSERT INTO "public"."profiles"', joined)

    def test_nullable_native_fk_uses_anchored_sidecar_and_typed_insert(self):
        actor = b.saha_staff_id(ACTOR["id"])
        actual = {"id": ID, "short_name": "QA", "title": "QA", "created_by": None}
        db = FakeDB([{"exists": False}, [actual]])
        repo = self.repo(db)
        repo.columns = {"customers": {name: {"generated": False, "nullable": True, "type": "uuid" if name in {"id", "created_by"} else "text"} for name in actual}}
        repo.kinds = {"customers": "r"}
        repo.pks = {"customers": ["id"]}
        repo.fks = [{"table": "customers", "column": "created_by", "targetSchema": "auth",
                     "target": "users", "targetColumn": "id"}]
        result = repo.write(row("customers", {**actual, "created_by": actor, "updated_by": actor}), None, ACTOR)
        self.assertEqual(result["payload"]["created_by"], actor)
        self.assertEqual(result["payload"]["updated_by"], actor)
        insert = next(sql for sql in db.statements if "INSERT INTO public." in sql)
        self.assertIn('jsonb_populate_record(NULL::public."customers"', insert)
        sidecar = next(sql for sql in db.statements if "INSERT INTO voltguard_site.saha_native_rows" in sql)
        self.assertIn('"anchor":null,"value":"' + actor + '"', sidecar)

    def test_source_and_native_bindings_both_change_cas_hash(self):
        repo = self.repo()
        key = source.key("employees", ID)
        repo.source[key] = {"raw": {"id": ID, "user_id": LEGACY}, "side": None, "native": True}
        initial = repo.hash(key)
        repo.source[key]["raw"]["user_id"] = None
        self.assertNotEqual(initial, repo.hash(key))
        repo.source[key]["raw"]["user_id"] = LEGACY
        repo.source[key]["side"] = {"fields": {"user_id": {"anchor": LEGACY, "value": b.saha_staff_id(ACTOR["id"])}}}
        self.assertNotEqual(initial, repo.hash(key))

    def test_view_and_secret_writes_fail_before_sql(self):
        db = FakeDB()
        repo = self.repo(db)
        repo.columns = {"customers": {"id": {"type": "uuid"}}}
        repo.kinds = {"customers": "v"}
        self.reject(lambda: repo.write(row("customers", {"id": ID}), None, ACTOR), "bridge_saha_readonly")
        self.reject(lambda: repo.write(row("profiles", {"id": ID}), None, ACTOR), "bridge_saha_collection")
        self.assertEqual(db.statements, [])

    def test_legacy_payroll_is_hidden_until_explicit_native_binding(self):
        employee = {"id": "s" + "b" * 24, "role": "employee"}
        me = b.saha_staff_id(employee["id"])
        personnel = row("employees", {"id": ID, "full_name": "QA", "user_id": LEGACY, "daily_wage": 1000})
        payroll = row("payroll_records", {"id": LEGACY, "employee_id": ID, "period": "2026-10", "net": 25000})
        records = {personnel["id"]: personnel, payroll["id"]: payroll}
        visible = b.saha_snapshot_records(employee, records)
        self.assertNotIn(payroll["id"], visible)
        self.assertNotIn("daily_wage", visible[personnel["id"]]["payload"])
        records[personnel["id"]]["payload"]["user_id"] = me
        self.assertIn(payroll["id"], b.saha_snapshot_records(employee, records))
        records[personnel["id"]]["payload"]["user_id"] = str(uuid.uuid4())
        self.assertNotIn(payroll["id"], b.saha_snapshot_records(employee, records))

    def test_managed_cache_stays_private_but_business_cache_is_shared(self):
        employee = {"id": "s" + "b" * 24, "role": "employee"}
        records = {}
        for cache in ("tasks_v1", "payroll_runs_v1"):
            rid = b.hashlib.sha256(cache.encode()).hexdigest()
            entry = row("_cache", {"id": rid, "key": cache, "value": "[]"})
            records[entry["id"]] = entry
        visible = b.saha_snapshot_records(employee, records)
        self.assertEqual([r["payload"]["key"] for r in visible.values()], ["tasks_v1"])
        self.assertEqual(len(b.saha_snapshot_records(ACTOR, records)), 2)

    def test_legacy_storage_urls_are_rewritten_recursively_without_signed_token(self):
        raw = {"photos": [{"url": "https://legacy.invalid/storage/v1/object/sign/photos/QA%20file.jpg?token=private-token"}],
               "unrelated": "https://example.invalid/catalog"}
        normalized = source.protected_urls(raw)
        self.assertEqual(normalized["photos"][0]["url"], "/api/saha-asset.php?bucket=photos&path=QA+file.jpg")
        self.assertNotIn("private-token", b.encode(normalized))
        self.assertEqual(normalized["unrelated"], raw["unrelated"])
        self.assertTrue(source.has_reference(raw, "photos", "QA file.jpg"))
        self.assertFalse(source.has_reference(raw, "photos", "different.jpg"))

    def test_legacy_storage_path_traversal_is_never_accepted(self):
        for name in ("../secret", "a/../secret", "%2e%2e/secret", "%252e%252e/secret",
                     "a//secret", "a/./secret", "a%5csecret", "a%00secret"):
            self.assertIsNone(source.storage_reference("https://legacy.invalid/storage/v1/object/public/photos/" + name))

    def test_no_file_service_is_contacted_before_visible_reference_check(self):
        # An empty visible source graph cannot cause even a Docker or network lookup.
        db = FakeDB()
        repo = self.repo(db)
        repo.read = lambda: None
        self.reject(lambda: repo.file({"site": SITE, "actor": ACTOR, "bucket": "photos", "path": "unguessable.jpg"}), "bridge_saha_file_scope")
        for bad in ("../secret", "a/../secret", "a//secret", "a\\secret", "a\x00secret"):
            self.reject(lambda: repo.file({"site": SITE, "actor": ACTOR, "bucket": "photos", "path": bad}), "bridge_saha_file_path")

    def test_new_legacy_references_cannot_poison_file_authorization_in_any_field(self):
        url = "https://legacy.invalid/storage/v1/object/authenticated/chat-attachments/other-user/private.pdf"
        repo = self.repo()
        for payload in ({"id": ID, "short_name": url, "title": "QA"},
                        {"id": ID, "short_name": "QA", "title": "QA", "phone": url},
                        {"id": ID, "short_name": "QA", "title": "QA", "unrecognized": {"nested": [url]}}):
            self.reject(lambda: repo.write(row("customers", payload), None, ACTOR), "bridge_saha_legacy_reference")
        self.assertEqual(repo.db.statements, [])

    def test_hr_redaction_also_removes_legacy_file_authorization(self):
        employee = {"id": "s" + "b" * 24, "role": "employee"}
        url = "https://legacy.invalid/storage/v1/object/public/photos/qa-payroll.pdf"
        raw = {"id": ID, "full_name": "QA", "attendance_json": {"document": url}}
        personnel = row("employees", source.protected_urls(raw))
        records = {personnel["id"]: personnel}
        origins = {personnel["id"]: {"native": True, "raw": raw}}
        self.assertTrue(source.file_reference_allowed(b.saha_snapshot_records(ACTOR, records), origins, "photos", "qa-payroll.pdf"))
        masked = b.saha_snapshot_records(employee, records)
        self.assertNotIn("attendance_json", masked[personnel["id"]]["payload"])
        self.assertFalse(source.file_reference_allowed(masked, origins, "photos", "qa-payroll.pdf"))

    def test_private_legacy_bucket_requires_correct_collection_and_owner_prefix(self):
        path = LEGACY + "/qa.pdf"
        url = "https://legacy.invalid/storage/v1/object/authenticated/chat-attachments/" + path
        raw = {"id": ID, "attachment_url": url, "sender_id": LEGACY}
        message = row("messages", source.protected_urls(raw))
        records = {message["id"]: message}
        origins = {message["id"]: {"native": True, "raw": raw}}
        self.assertTrue(source.file_reference_allowed(records, origins, "chat-attachments", path))
        message["collection"] = "customers"
        self.assertFalse(source.file_reference_allowed(records, origins, "chat-attachments", path))
        message["collection"] = "messages"
        origins[message["id"]]["raw"]["sender_id"] = str(uuid.uuid4())
        self.assertFalse(source.file_reference_allowed(records, origins, "chat-attachments", path))
        message["collection"] = "quotes"
        raw["attachment_url"] = "https://legacy.invalid/storage/v1/object/authenticated/customer-docs/qa.pdf"
        message["payload"] = source.protected_urls(raw)
        self.assertTrue(source.file_reference_allowed(records, origins, "customer-docs", "qa.pdf"))
        message["collection"] = "employees"
        self.assertFalse(source.file_reference_allowed(records, origins, "customer-docs", "qa.pdf"))


if __name__ == "__main__":
    unittest.main()
