#!/usr/bin/env python3
"""Run only against an explicitly created vg_bridge_qa_* empty PostgreSQL DB.

This builds synthetic fixtures from sanitized schema metadata.  It refuses the
production database name, does not copy business rows, and does not drop a DB.
"""
import argparse
import copy
import importlib.util
import json
import re
import tempfile
import uuid
from pathlib import Path


def load_bridge(filename):
    spec = importlib.util.spec_from_file_location("vg_bridge_under_test", filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fixture_sql(bridge, metadata):
    sql = ["CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);", "CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub' $$;"]
    # Correct the return cast while keeping the fixture independent of auth users.
    sql[-1] = "CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;"
    sql.append("CREATE SEQUENCE public.company_proposal_ref_seq;")
    for table in bridge.SCHEMA:
        if table in bridge.PRIVATE_TABLES:
            continue
        columns = [column for column in metadata["columns"] if column["table"] == table]
        if not columns:
            raise RuntimeError("fixture metadata missing table " + table)
        definitions = []
        for column in columns:
            typ = column["udt"]
            if typ.startswith("_"):
                typ = typ[1:] + "[]"
            if not re.fullmatch(r"[a-z0-9_]+(?:\[\])?", typ):
                raise RuntimeError("fixture invalid type")
            definition = bridge.sql_ident(column["column"]) + " " + typ
            default = column["default"]
            if column["column"] == "id" and typ == "int8":
                definition = bridge.sql_ident(column["column"]) + " bigserial"
                default = None
            if default is not None:
                definition += " DEFAULT " + default
            if column["nullable"] == "NO":
                definition += " NOT NULL"
            definitions.append(definition)
        sql.append("CREATE TABLE public." + bridge.sql_ident(table) + "(" + ",".join(definitions) + ");")
    for constraint in sorted(metadata["constraints"], key=lambda item: {"p": 0, "u": 1, "c": 2, "f": 3}.get(item["type"], 4)):
        table = constraint["table"]
        if table in bridge.SCHEMA and table not in bridge.PRIVATE_TABLES:
            sql.append("ALTER TABLE public." + bridge.sql_ident(table) + " ADD CONSTRAINT " + bridge.sql_ident(constraint["name"]) + " " + constraint["definition"] + ";")
    for trigger in metadata["triggers"]:
        if trigger["table"] in bridge.SCHEMA and trigger["table"] not in bridge.PRIVATE_TABLES:
            sql.extend([trigger["function_definition"] + ";", trigger["definition"] + ";"])
    return "\n".join(sql)


def run(config_file, schema_file, bridge_file):
    bridge = load_bridge(bridge_file)
    config = bridge.read_config(config_file)
    if not re.fullmatch(r"vg_bridge_qa_[a-z0-9_]{1,40}", config["database"] or ""):
        raise RuntimeError("fixture database prefix required; production is forbidden")
    metadata = json.loads(Path(schema_file).read_text(encoding="utf-8-sig"))
    db = bridge.Psql(config)
    try:
        empty = db.json("SELECT json_build_object('count',count(*)) FROM information_schema.tables WHERE table_schema IN ('public','auth','voltguard_site') AND table_type='BASE TABLE';")
        if empty["count"]:
            raise RuntimeError("fixture database must be empty")
        try:
            db.execute("BEGIN; " + fixture_sql(bridge, metadata) + " COMMIT;")
        except bridge.BridgeError:
            raise RuntimeError("fixture DDL SQLSTATE=" + ",".join(db.errors)) from None
        db.execute(bridge.INSTALL_SQL)
    finally:
        db.close()

    site, other_site = "a" * 32, "b" * 32
    admin = {"id": "s" + "1" * 24, "role": "admin"}
    employee = {"id": "s" + "2" * 24, "role": "employee"}
    checks = 0

    def call(op, actor=admin, namespace=site, **parts):
        db = bridge.Psql(config)
        try:
            repo = bridge.Repository(db)
            request = {"op": op, "site": namespace, "actor": actor, **parts}
            if op == "commit":
                request.setdefault("requestId", str(uuid.uuid4()))
            return repo.snapshot(request) if op == "snapshot" else repo.commit(request)
        finally:
            db.close()

    def sql(statement):
        db = bridge.Psql(config)
        try:
            return db.execute(statement)
        finally:
            db.close()

    def assert_true(condition, title):
        nonlocal checks
        if not condition:
            raise AssertionError(title)
        checks += 1

    def reject(callback, code):
        try:
            callback()
        except bridge.BridgeError as error:
            assert_true(error.code == code, "expected conflict/permission boundary")
            return
        raise AssertionError("expected rejected operation")

    def change(table, row, snapshot=None, delete=False):
        key = row["id"]
        return {"table": table, "id": key, "before": snapshot["snapshot"]["rows"].get(table, {}).get(key) if snapshot else None, "row": None if delete else row}

    product = {"id": str(uuid.uuid4()), "name": "QA '); SELECT 42; --", "category": "QA", "price": 12.34, "is_new": True, "is_active": True, "created_by": admin["id"], "updated_by": admin["id"]}
    request_id = str(uuid.uuid4())
    first = call("commit", requestId=request_id, changes=[change("products", product)])
    assert_true(first["rows"]["products"][product["id"]]["name"] == product["name"], "literal values retained safely")
    repeated = call("commit", requestId=request_id, changes=[change("products", product)])
    assert_true(repeated == first, "idempotent commit returns canonical stored response")
    reject(lambda: call("commit", requestId=request_id, changes=[change("products", {**product, "price": 13})]), "bridge_request_reused")
    before = call("snapshot")
    assert_true(before["state"]["tables"]["products"][product["id"]]["price"] == 12.34, "live PostgreSQL source read")
    sql("UPDATE public.products SET price=19.99 WHERE id=" + bridge.sql_text(product["id"]) + "::uuid;")
    desired = {**before["state"]["tables"]["products"][product["id"]], "price": 22}
    reject(lambda: call("commit", changes=[change("products", desired, before)]), "bridge_conflict")
    now = call("snapshot")
    assert_true(now["state"]["tables"]["products"][product["id"]]["price"] == 19.99, "legacy concurrent edit not overwritten")

    bad_fuel = {"id": str(uuid.uuid4()), "date": "2026-10-13", "vehicle_id": str(uuid.uuid4()), "driver_id": str(uuid.uuid4()), "liters": 1, "price_per_liter": 1, "total_amount": 1}
    good_update = {**now["state"]["tables"]["products"][product["id"]], "price": 25}
    reject(lambda: call("commit", changes=[change("products", good_update, now), change("fuel_records", bad_fuel)]), "bridge_conflict")
    assert_true(call("snapshot")["state"]["tables"]["products"][product["id"]]["price"] == 19.99, "failed multi-row commit rolled back all writes")

    task = {"id": str(uuid.uuid4()), "baslik": "QA task", "durum": "beklemede", "oncelik": "orta"}
    saved_task = call("commit", changes=[change("gorevler", task)])
    actual_task = saved_task["rows"]["gorevler"][task["id"]]
    assert_true(actual_task["id"].isdigit(), "bigint canonical ID returned as string")
    assert_true(saved_task["aliases"]["gorevler"][task["id"]] == actual_task["id"], "temporary UUID alias returned")

    document = {"id": str(uuid.uuid4()), "kind": "osos_rapor", "record_id": "qa:document", "payload": {"title": "QA"}, "revision": 1, "created_by": admin["id"], "updated_by": admin["id"]}
    doc_result = call("commit", changes=[change("company_documents", document)])
    doc = doc_result["rows"]["company_documents"][document["id"]]
    assert_true(len(doc["id"]) == 36 and doc["created_by"] == admin["id"], "document actor and synthetic key preserved")
    doc_before = call("snapshot")
    doc_next = {**doc, "revision": 2, "payload": {"title": "QA2"}, "updated_at": "2020-01-01T00:00:00Z"}
    changed_doc = call("commit", changes=[change("company_documents", doc_next, doc_before)])["rows"]["company_documents"][doc["id"]]
    assert_true(changed_doc["revision"] == 2 and changed_doc["updated_at"] != doc_next["updated_at"], "database trigger canonical timestamp returned")

    proposal = {"id": str(uuid.uuid4()), "name": "QA", "type": "yg", "reference_no": "PREVIEW", "data": {"referenceNo": "PREVIEW", "calculated": {"refNo": "PREVIEW"}, "reportHtml": '<span data-vg-reference>PREVIEW</span>'}, "created_by": admin["id"]}
    saved_proposal = call("commit", changes=[change("proposals", proposal)])["rows"]["proposals"][proposal["id"]]
    assert_true(saved_proposal["reference_no"].startswith("VG-"), "database proposal sequence authoritative")
    assert_true(saved_proposal["data"]["referenceNo"] == saved_proposal["reference_no"] and saved_proposal["data"]["calculated"]["refNo"] == saved_proposal["reference_no"], "canonical proposal nested references retained")

    employee_id, legacy_id = str(uuid.uuid4()), str(uuid.uuid4())
    sql("INSERT INTO auth.users(id) VALUES(" + bridge.sql_text(legacy_id) + "::uuid); INSERT INTO public.bordro_employees(id,name,agreed_salary,official_salary,user_id) VALUES(" + bridge.sql_text(employee_id) + "::uuid,'QA employee',1000,900," + bridge.sql_text(legacy_id) + "::uuid);")
    admin_before = call("snapshot")
    raw_employee = admin_before["state"]["tables"]["bordro_employees"][employee_id]
    assert_true(raw_employee["user_id"] is None, "old auth UUID grants no native ownership")
    reject(lambda: call("commit", actor=employee, changes=[change("bordro_employees", {**raw_employee, "user_id": employee["id"]}, admin_before)]), "bridge_payroll")
    call("commit", changes=[change("bordro_employees", {**raw_employee, "user_id": employee["id"]}, admin_before)])
    owned = call("snapshot", actor=employee)
    assert_true(employee_id in owned["state"]["tables"]["bordro_employees"], "explicit native association grants own row")
    assert_true(call("snapshot", actor=employee, namespace=other_site)["state"]["tables"]["bordro_employees"] == {}, "ownership does not cross site namespace")
    sql("UPDATE public.bordro_employees SET user_id=NULL WHERE id=" + bridge.sql_text(employee_id) + "::uuid;")
    assert_true(call("snapshot", actor=employee)["state"]["tables"]["bordro_employees"] == {}, "legacy ownership edit invalidates native binding")

    call("commit", storageChanges=[{"key": "qa.preference", "before": None, "value": "şirket"}])
    prefs = call("snapshot")
    assert_true(prefs["state"]["storage"][admin["id"]]["qa.preference"] == "şirket", "private Unicode preference persisted remotely")
    assert_true(call("snapshot", namespace=other_site)["state"]["storage"][admin["id"]] == {}, "preferences do not cross site namespace")
    call("commit", storageChanges=[{"key": "qa.preference", "before": prefs["snapshot"]["prefs"]["qa.preference"], "value": "second"}])
    reject(lambda: call("commit", storageChanges=[{"key": "qa.preference", "before": prefs["snapshot"]["prefs"]["qa.preference"], "value": "stale"}]), "bridge_conflict")

    plant = {"id": str(uuid.uuid4()), "fabrika_adi": "QA private plant", "aktif": True}
    call("commit", changes=[change("osos_fabrikalar", plant)])
    assert_true(plant["id"] in call("snapshot")["state"]["tables"]["osos_fabrikalar"], "private missing module table works")
    assert_true(call("snapshot", namespace=other_site)["state"]["tables"]["osos_fabrikalar"] == {}, "private operational rows site-scoped")

    sql("INSERT INTO public.bordro_daily_logs(employee_id,day,month,year,type,overtime_hours) VALUES(" + bridge.sql_text(employee_id) + "::uuid,1,9,2026,'Normal',0);")
    delete_before = call("snapshot")
    reject(lambda: call("commit", changes=[change("bordro_employees", delete_before["state"]["tables"]["bordro_employees"][employee_id], delete_before, delete=True)]), "bridge_relation_in_use")
    assert_true(employee_id in call("snapshot")["state"]["tables"]["bordro_employees"], "legacy cascade cannot erase referenced history")

    db = bridge.Psql(config)
    try:
        security = db.json("SELECT json_build_object('rls',bool_and(c.relrowsecurity),'anon',bool_or(has_table_privilege('anon',c.oid,'SELECT')),'authenticated',bool_or(has_table_privilege('authenticated',c.oid,'SELECT'))) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='voltguard_site' AND c.relkind='r';")
        assert_true(security == {"rls": True, "anon": False, "authenticated": False}, "private sidecars retain RLS and deny public auth roles")
    finally:
        db.close()
    print(json.dumps({"ok": True, "checks": checks, "database": "isolated_fixture", "productionWrites": False}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--schema", required=True)
    parser.add_argument("--bridge", required=True)
    args = parser.parse_args()
    run(args.config, args.schema, args.bridge)
