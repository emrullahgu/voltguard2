#!/usr/bin/env python3
"""Exercise actual PostgreSQL source writes using strictly synthetic fixtures.

Requires an explicitly created empty vg_bridge_qa_* database. It never contacts
the production DB, copies live rows, changes auth accounts, or drops a database.
--reset-fixtures only resets a marked fixture DB created by this script.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import re
import uuid
from pathlib import Path

MARKER = "voltguard-saha-source-synthetic-only-v1"
PUBLIC_TABLES = {"saha_source_qa_fixture_marker", "profiles", "customers", "quotes", "quote_lines",
                 "work_orders", "employees", "payroll_records", "app_usage", "notification_preferences", "import_history"}
FIXTURE_SQL = """
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.saha_source_qa_fixture_marker(value text PRIMARY KEY);
INSERT INTO public.saha_source_qa_fixture_marker VALUES('voltguard-saha-source-synthetic-only-v1');
CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id),full_name text,role text);
CREATE TABLE public.customers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),short_name text NOT NULL,title text NOT NULL,
 phone text,email text,created_at timestamptz DEFAULT now(),created_by uuid REFERENCES auth.users(id));
CREATE TABLE public.quotes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),number text UNIQUE NOT NULL,
 customer_id uuid REFERENCES public.customers(id),customer_name text NOT NULL,title text NOT NULL,
 status text NOT NULL DEFAULT 'Taslak',subtotal numeric(14,2) NOT NULL DEFAULT 0,
 created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),created_by uuid REFERENCES auth.users(id));
CREATE TABLE public.quote_lines(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),quote_id uuid REFERENCES public.quotes(id) ON DELETE CASCADE,
 line_no integer NOT NULL,poz_id text NOT NULL,poz_name text NOT NULL,quantity numeric(12,2) NOT NULL DEFAULT 1,
 material_price numeric(12,2) NOT NULL DEFAULT 0,unit text NOT NULL DEFAULT 'Adet');
CREATE TABLE public.work_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),number text UNIQUE NOT NULL,
 customer_id uuid REFERENCES public.customers(id),customer_name text,title text NOT NULL,date date DEFAULT current_date,
 status text DEFAULT 'Servis Açıldı',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),created_by uuid REFERENCES auth.users(id));
CREATE TABLE public.employees(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),full_name text NOT NULL,role text,
 daily_wage numeric(10,2) NOT NULL DEFAULT 0,active boolean DEFAULT true,created_at timestamptz DEFAULT now(),
 user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,attendance_json jsonb);
CREATE TABLE public.payroll_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
 period text NOT NULL,gross numeric NOT NULL DEFAULT 0,net numeric NOT NULL DEFAULT 0,status text NOT NULL DEFAULT 'draft',
 created_by uuid,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(employee_id,period));
CREATE TABLE public.app_usage(user_id uuid NOT NULL,date date NOT NULL DEFAULT current_date,user_name text,
 screen_views integer NOT NULL DEFAULT 0,actions integer NOT NULL DEFAULT 0,sessions integer NOT NULL DEFAULT 0,
 last_active timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,date));
CREATE TABLE public.notification_preferences(user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
 channel_enabled jsonb,email text,phone text,updated_at timestamptz DEFAULT now());
CREATE TABLE public.import_history(id bigserial PRIMARY KEY,type text NOT NULL,rows_total integer NOT NULL,
 rows_imported integer NOT NULL,rows_skipped integer NOT NULL,errors jsonb,imported_at timestamptz DEFAULT now());
"""


def load_source(filename):
    spec = importlib.util.spec_from_file_location("saha_source_qa", filename)
    source = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(source)
    return source


def run(config_file, source_file, reset=False):
    source = load_source(source_file)
    b = source.b
    config = b.read_config(config_file)
    if not re.fullmatch(r"vg_bridge_qa_[a-z0-9_]{1,40}", config.get("database") or ""):
        raise RuntimeError("QA database prefix required; production database is forbidden")
    db = b.Psql(config)
    try:
        tables = db.json("SELECT coalesce(json_agg(json_build_object('schema',table_schema,'name',table_name)), '[]') FROM information_schema.tables WHERE table_schema IN ('public','auth','voltguard_site') AND table_type='BASE TABLE';")
        if tables:
            if not reset:
                raise RuntimeError("QA fixture database must be empty; explicit --reset-fixtures required for a marked synthetic rerun")
            public = {t["name"] for t in tables if t["schema"] == "public"}
            auth = {t["name"] for t in tables if t["schema"] == "auth"}
            private = {t["name"] for t in tables if t["schema"] == "voltguard_site"}
            if public != PUBLIC_TABLES or auth != {"users"} or private - {"saha_native_rows", "saha_records", "preferences", "commits", "audit"}:
                raise RuntimeError("fixture reset refuses unexpected tables")
            marker = db.json("SELECT json_agg(value) FROM public.saha_source_qa_fixture_marker;")
            if marker != [MARKER]:
                raise RuntimeError("fixture reset requires exact synthetic marker")
            names = ["public." + b.sql_ident(t) for t in sorted(PUBLIC_TABLES - {"saha_source_qa_fixture_marker"})]
            names += ["auth.users"] + ["voltguard_site." + b.sql_ident(t) for t in sorted(private)]
            db.execute("BEGIN; TRUNCATE " + ",".join(names) + " RESTART IDENTITY; COMMIT;")
        else:
            db.execute("BEGIN; " + FIXTURE_SQL + " COMMIT;")
        # The first QA run predates this optional reviewed employee field.
        # This is reached only after the empty/exact-fixture guard above.
        db.execute("ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS attendance_json jsonb;")
        db.execute(source.INSTALL_SQL)
    except b.BridgeError:
        raise RuntimeError("synthetic fixture SQL failed; SQLSTATE=" + ",".join(db.errors)) from None
    finally:
        db.close()

    site = "a" * 32
    admin = {"id": "s" + "1" * 24, "role": "admin"}
    employee = {"id": "s" + "2" * 24, "role": "employee"}
    other = {"id": "s" + "3" * 24, "role": "employee"}
    native_admin, native_employee = b.saha_staff_id(admin["id"]), b.saha_staff_id(employee["id"])
    checks = 0

    def assert_true(condition, title):
        nonlocal checks
        if not condition:
            raise AssertionError(title)
        checks += 1

    def query(sql):
        db = b.Psql(config)
        try:
            return db.json(sql)
        finally:
            db.close()

    def execute(sql):
        db = b.Psql(config)
        try:
            db.execute(sql)
        finally:
            db.close()

    def call(op, actor=admin, namespace=site, **parts):
        db = b.Psql(config)
        try:
            repo = source.Repository(db)
            request = {"op": op, "site": namespace, "actor": actor, **parts}
            if op == "commit":
                request.setdefault("requestId", str(uuid.uuid4()))
            return repo.snapshot(request) if op == "snapshot" else repo.commit(request)
        finally:
            db.close()

    def reject(callback, code):
        try:
            callback()
        except b.BridgeError as error:
            assert_true(error.code == code, "expected " + code + ", got " + error.code)
            return
        raise AssertionError("expected rejection: " + code)

    def record(collection, payload, actor=admin):
        payload = {"id": str(uuid.uuid4()), **payload}
        if collection not in {"_cache", "_files"}:
            payload.setdefault("created_by", b.saha_staff_id(actor["id"]))
            payload["updated_by"] = b.saha_staff_id(actor["id"])
        return {"id": source.key(collection, payload["id"]), "collection": collection,
                "record_id": payload["id"], "payload": payload, "revision": 1}

    def patch(row, snapshot=None, delete=False):
        return {"table": "saha_records", "id": row["id"], "before": snapshot["snapshot"]["rows"]["saha_records"].get(row["id"]) if snapshot else None,
                "row": None if delete else row}

    def revised(row, **fields):
        result = copy.deepcopy(row)
        result["revision"] += 1
        result["payload"].update(fields)
        result["payload"]["updated_by"] = native_admin
        return result

    def saved(response, row):
        return response["rows"]["saha_records"][row["id"]]

    def file_permitted(actor, bucket, path):
        db = b.Psql(config)
        try:
            repo = source.Repository(db)
            repo.site = site
            db.execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;")
            repo.read()
            visible = b.saha_snapshot_records(actor, repo.rows)
            permitted = source.file_reference_allowed(visible, repo.source, bucket, path)
            db.execute("COMMIT;")
            return permitted
        finally:
            db.close()

    # Existing source rows must be visible without an importer or data copy.
    legacy_user, legacy_employee, legacy_payroll = (str(uuid.uuid4()) for _ in range(3))
    execute("INSERT INTO auth.users(id) VALUES(" + b.sql_text(legacy_user) + "::uuid);"
            "INSERT INTO public.profiles(id,full_name,role) VALUES(" + b.sql_text(legacy_user) + "::uuid,'QA legacy','engineer');"
            "INSERT INTO public.employees(id,full_name,daily_wage,user_id) VALUES(" + b.sql_text(legacy_employee) + "::uuid,'QA Synthetic',1250," + b.sql_text(legacy_user) + "::uuid);"
            "INSERT INTO public.payroll_records(id,employee_id,period,net) VALUES(" + b.sql_text(legacy_payroll) + "::uuid," + b.sql_text(legacy_employee) + "::uuid,'2026-10',25000);"
            "INSERT INTO public.app_usage(user_id,date,actions) VALUES(" + b.sql_text(legacy_user) + "::uuid,'2026-10-27',7);"
            "INSERT INTO public.import_history(type,rows_total,rows_imported,rows_skipped) VALUES('QA',3,3,0);")
    snap = call("snapshot")
    rows = snap["state"]["tables"]["saha_records"]
    assert_true(source.key("employees", legacy_employee) in rows, "existing employee read directly from public source")
    assert_true(not any(r["collection"] == "profiles" for r in rows.values()), "legacy profiles and auth records are never exposed")
    assert_true(source.key("payroll_records", legacy_payroll) not in call("snapshot", actor=employee)["state"]["tables"]["saha_records"], "legacy payroll cannot acquire ownership by legacy UUID/name")
    public_employee = call("snapshot", actor=employee)["state"]["tables"]["saha_records"][source.key("employees", legacy_employee)]["payload"]
    assert_true("daily_wage" not in public_employee and "user_id" not in public_employee, "employee directory redacts wages and unbound identities")

    # Nullable native identity fields are anchored sidecars, while actual business writes stay public.
    customer = record("customers", {"short_name": "QA'); SELECT 42; --", "title": "QA VoltGuard", "phone": "02320000000"})
    request_id = str(uuid.uuid4())
    first = call("commit", requestId=request_id, changes=[patch(customer)])
    customer = saved(first, customer)
    assert_true(customer["payload"]["created_by"] == native_admin, "native creator binding returned to portal")
    actual = query("SELECT to_jsonb(c) FROM public.customers c WHERE id=" + b.sql_text(customer["record_id"]) + "::uuid;")
    assert_true(actual["short_name"] == customer["payload"]["short_name"] and actual["created_by"] is None, "actual public customer write retains literal text and leaves legacy FK unset")
    assert_true(query("SELECT json_build_object('n',count(*)) FROM auth.users;")["n"] == 1, "connector never manufactures legacy Auth accounts")
    # Idempotence uses the original request body, including initial revision and no server timestamps.
    original_customer = record("customers", {"id": customer["record_id"], "short_name": customer["payload"]["short_name"], "title": "QA VoltGuard", "phone": "02320000000"})
    repeated = call("commit", requestId=request_id, changes=[patch(original_customer)])
    assert_true(repeated == first, "retry returns original canonical response without duplicate write")
    reject(lambda: call("commit", requestId=request_id, changes=[patch(record("customers", {"short_name": "different", "title": "QA"}))]), "bridge_request_reused")

    # Write a related source graph in one actual PostgreSQL transaction.
    quote = record("quotes", {"number": "QA-QUOTE-1", "customer_id": customer["record_id"], "customer_name": "QA VoltGuard", "title": "Synthetic quote"})
    line = record("quote_lines", {"quote_id": quote["record_id"], "line_no": 1, "poz_id": "QA", "poz_name": "Synthetic item", "quantity": 2.5, "material_price": 123.45})
    work = record("work_orders", {"number": "QA-WO-1", "customer_id": customer["record_id"], "customer_name": "QA VoltGuard", "title": "Synthetic task"})
    graph_result = call("commit", changes=[patch(quote), patch(line), patch(work)])
    assert_true(query("SELECT json_build_object('q',(SELECT count(*) FROM public.quotes),'l',(SELECT count(*) FROM public.quote_lines),'w',(SELECT count(*) FROM public.work_orders));") == {"q": 1, "l": 1, "w": 1}, "quote, line and work-order persist in original source tables")
    assert_true(saved(graph_result, line)["payload"]["quantity"] == 2.5, "PostgreSQL numeric value is returned canonically")
    now = call("snapshot")
    customer_before = now["state"]["tables"]["saha_records"][customer["id"]]
    changed = revised(customer_before, phone="02321111111")
    call("commit", changes=[patch(changed, now)])
    assert_true(query("SELECT to_jsonb(c) FROM public.customers c WHERE id=" + b.sql_text(customer["record_id"]) + "::uuid;")["phone"] == "02321111111", "subsequent update changes original public row")

    # A legacy edit between snapshot and commit must conflict, including identity columns.
    before = call("snapshot")
    execute("UPDATE public.customers SET phone='legacy-changed' WHERE id=" + b.sql_text(customer["record_id"]) + "::uuid;")
    stale = revised(before["state"]["tables"]["saha_records"][customer["id"]], phone="stale-native")
    reject(lambda: call("commit", changes=[patch(stale, before)]), "bridge_conflict")
    assert_true(query("SELECT to_jsonb(c) FROM public.customers c WHERE id=" + b.sql_text(customer["record_id"]) + "::uuid;")["phone"] == "legacy-changed", "source concurrent edit is preserved")

    # A later invalid FK must roll back earlier source writes and sidecars together.
    before = call("snapshot")
    update = revised(before["state"]["tables"]["saha_records"][customer["id"]], phone="must-rollback")
    bad_line = record("quote_lines", {"quote_id": str(uuid.uuid4()), "line_no": 2, "poz_id": "QA", "poz_name": "Invalid parent"})
    reject(lambda: call("commit", changes=[patch(update, before), patch(bad_line)]), "bridge_conflict")
    after = call("snapshot")
    assert_true(after["state"]["tables"]["saha_records"][customer["id"]]["payload"]["phone"] == "legacy-changed", "failed graph write rolls back previous source update")
    assert_true(after["snapshot"]["rows"]["saha_records"][customer["id"]] == before["snapshot"]["rows"]["saha_records"][customer["id"]], "failed graph write also rolls back CAS sidecar")
    quote_saved = after["state"]["tables"]["saha_records"][quote["id"]]
    reject(lambda: call("commit", changes=[patch(quote_saved, after, delete=True)]), "bridge_saha_relation_in_use")
    assert_true(query("SELECT json_build_object('n',count(*)) FROM public.quote_lines;")["n"] == 1, "source cascade deletion cannot silently erase referenced lines")

    # Composite native transport IDs must still update the exact original PK row.
    before = call("snapshot")
    usage = next(r for r in before["state"]["tables"]["saha_records"].values() if r["collection"] == "app_usage")
    assert_true(bool(re.fullmatch(r"[a-f0-9-]{36}", usage["record_id"])), "composite PK has stable native UUID")
    call("commit", changes=[patch(revised(usage, actions=12), before)])
    assert_true(query("SELECT json_build_object('n',count(*),'actions',max(actions)) FROM public.app_usage;") == {"n": 1, "actions": 12}, "composite PK update changes actual public row without duplicate")
    assert_true(next(r for r in call("snapshot")["state"]["tables"]["saha_records"].values() if r["collection"] == "app_usage")["record_id"] == usage["record_id"], "composite identity survives update")
    new_usage = record("app_usage", {"user_id": native_employee, "date": "2026-10-28", "actions": 3}, actor=employee)
    call("commit", actor=employee, changes=[patch(new_usage)])
    assert_true(new_usage["id"] in call("snapshot", actor=employee)["state"]["tables"]["saha_records"], "new native composite record remains usable in private extension")
    assert_true(query("SELECT json_build_object('n',count(*)) FROM public.app_usage;")["n"] == 1, "native composite extension does not inject legacy source identity")

    # Existing bigint IDs are read/updateable; new UUID native records stay private.
    before = call("snapshot")
    history = next(r for r in before["state"]["tables"]["saha_records"].values() if r["collection"] == "import_history")
    assert_true(history["record_id"] == "1", "existing bigint source ID normalized without losing precision")
    call("commit", changes=[patch(revised(history, rows_imported=2, rows_skipped=1), before)])
    assert_true(query("SELECT json_build_object('n',rows_imported) FROM public.import_history WHERE id=1;")["n"] == 2, "bigint source row actually updated")
    native_history = record("import_history", {"type": "QA native", "rows_total": 1, "rows_imported": 1, "rows_skipped": 0})
    call("commit", changes=[patch(native_history)])
    assert_true(native_history["id"] in call("snapshot")["state"]["tables"]["saha_records"], "new native UUID on bigint source uses private extension")
    assert_true(query("SELECT json_build_object('n',count(*)) FROM public.import_history;")["n"] == 1, "bigint source has no coercion or fabricated identity")

    # Explicit native ownership may grant one employee payroll; changing legacy FK revokes the binding.
    before = call("snapshot")
    personnel = before["state"]["tables"]["saha_records"][source.key("employees", legacy_employee)]
    call("commit", changes=[patch(revised(personnel, user_id=native_employee), before)])
    own = call("snapshot", actor=employee)["state"]["tables"]["saha_records"]
    assert_true(source.key("payroll_records", legacy_payroll) in own, "admin-bound native employee can read own payroll")
    assert_true(source.key("payroll_records", legacy_payroll) not in call("snapshot", actor=other)["state"]["tables"]["saha_records"], "other employee cannot read mapped payroll")
    payroll = copy.deepcopy(own[source.key("payroll_records", legacy_payroll)])
    payroll["revision"] += 1
    payroll["payload"]["net"] = 1
    payroll["payload"]["updated_by"] = native_employee
    reject(lambda: call("commit", actor=employee, changes=[patch(payroll, call("snapshot", actor=employee))]), "bridge_saha_payroll")
    execute("UPDATE public.employees SET user_id=NULL WHERE id=" + b.sql_text(legacy_employee) + "::uuid;")
    assert_true(source.key("payroll_records", legacy_payroll) not in call("snapshot", actor=employee)["state"]["tables"]["saha_records"], "source identity change invalidates anchored native payroll binding")

    preferences = record("notification_preferences", {"user_id": native_employee, "email": "qa@example.invalid", "channel_enabled": {"email": True}}, actor=employee)
    call("commit", actor=employee, changes=[patch(preferences)])
    assert_true(preferences["id"] in call("snapshot", actor=employee)["state"]["tables"]["saha_records"], "nonnullable profiles FK remains usable through private extension")
    assert_true(query("SELECT json_build_object('auth',(SELECT count(*) FROM auth.users),'profiles',(SELECT count(*) FROM public.profiles),'prefs',(SELECT count(*) FROM public.notification_preferences));") == {"auth": 1, "profiles": 1, "prefs": 0}, "native preferences do not create Auth or profile rows")

    # Shared business cache and sensitive cache use the same central data store with distinct permissions.
    caches = []
    for name in ("tasks_v1", "payroll_runs_v1"):
        caches.append(record("_cache", {"id": hashlib.sha256(name.encode()).hexdigest(), "key": name, "value": '[{"id":"qa"}]'}))
    call("commit", changes=[patch(r) for r in caches])
    visible = call("snapshot", actor=employee)["state"]["tables"]["saha_records"]
    assert_true(caches[0]["id"] in visible and caches[1]["id"] not in visible, "shared tasks visible while managed payroll cache is hidden")
    forbidden = revised(caches[1], value="[]")
    reject(lambda: call("commit", actor=employee, changes=[patch(forbidden, call("snapshot"))]), "bridge_saha_payroll")
    private_site = call("snapshot", namespace="b" * 32)["state"]["tables"]["saha_records"]
    assert_true(caches[0]["id"] not in private_site and preferences["id"] not in private_site, "private cache/extensions are site-scoped")

    # New source text cannot be used to grant service-key access to arbitrary legacy objects.
    forged_url = "https://legacy.invalid/storage/v1/object/authenticated/chat-attachments/other-user/private.pdf"
    for field in ("short_name", "phone"):
        forged = record("customers", {"short_name": "QA poisoned", "title": "QA", field: forged_url}, actor=employee)
        reject(lambda: call("commit", actor=employee, changes=[patch(forged)]), "bridge_saha_legacy_reference")
    before = call("snapshot")
    changed = revised(before["state"]["tables"]["saha_records"][customer["id"]], phone=forged_url)
    reject(lambda: call("commit", changes=[patch(changed, before)]), "bridge_saha_legacy_reference")
    assert_true(not file_permitted(admin, "chat-attachments", "other-user/private.pdf"), "rejected forged URL never becomes file authorization")

    # Actual legacy links survive unrelated native edits; canonical responses stay protected.
    legacy_photo = "https://legacy.invalid/storage/v1/object/sign/photos/qa-existing.jpg?token=synthetic-secret"
    execute("UPDATE public.customers SET email=" + b.sql_text(legacy_photo) + " WHERE id=" + b.sql_text(customer["record_id"]) + "::uuid;")
    before = call("snapshot")
    old = before["state"]["tables"]["saha_records"][customer["id"]]
    assert_true(old["payload"]["email"] == "/api/saha-asset.php?bucket=photos&path=qa-existing.jpg", "actual source signed URL exposed only through private asset gate")
    response = call("commit", changes=[patch(revised(old, phone="02329999999"), before)])
    assert_true(saved(response, old)["payload"]["email"] == old["payload"]["email"], "unrelated source update returns protected canonical legacy URL")
    assert_true(query("SELECT to_jsonb(c) FROM public.customers c WHERE id=" + b.sql_text(customer["record_id"]) + "::uuid;")["email"] == legacy_photo, "native unrelated update does not destroy original legacy object URL")
    assert_true(file_permitted(employee, "photos", "qa-existing.jpg"), "real visible source photo can be authorized without a data copy")

    # A reference present only in a redacted HR field must not grant a file read.
    hr_url = "https://legacy.invalid/storage/v1/object/public/photos/qa-sensitive-payroll.pdf"
    execute("UPDATE public.employees SET attendance_json=" + b.sql_json({"document": hr_url}) + " WHERE id=" + b.sql_text(legacy_employee) + "::uuid;")
    assert_true(file_permitted(admin, "photos", "qa-sensitive-payroll.pdf"), "manager may resolve the reviewed source HR attachment")
    assert_true(not file_permitted(employee, "photos", "qa-sensitive-payroll.pdf"), "employee cannot read file referenced only by redacted HR metadata")
    wrong_bucket = "https://legacy.invalid/storage/v1/object/authenticated/customer-docs/qa-private.pdf"
    execute("UPDATE public.customers SET email=" + b.sql_text(wrong_bucket) + " WHERE id=" + b.sql_text(customer["record_id"]) + "::uuid;")
    assert_true(not file_permitted(employee, "customer-docs", "qa-private.pdf"), "private legacy document requires an approved document collection")

    safety = query("SELECT json_build_object('rls',bool_and(c.relrowsecurity),'anon',bool_or(has_table_privilege('anon',c.oid,'SELECT')),'authenticated',bool_or(has_table_privilege('authenticated',c.oid,'SELECT'))) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='voltguard_site' AND c.relkind='r';")
    assert_true(safety == {"rls": True, "anon": False, "authenticated": False}, "private sidecars have RLS and deny anon/authenticated")
    print(json.dumps({"ok": True, "checks": checks, "database": "isolated_synthetic_fixture", "productionWrites": False}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--source", default=str(Path(__file__).resolve().parents[1] / "ubuntu-saha-source.py"))
    parser.add_argument("--reset-fixtures", action="store_true")
    args = parser.parse_args()
    run(args.config, args.source, args.reset_fixtures)
