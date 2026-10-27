#!/usr/bin/env python3
"""Private SSH-only PostgreSQL repository for the native VoltGuard staff API.

No HTTP listener, Supabase credentials, authentication migration, or RLS change.
The caller must already have passed the native staff/MFA/CSRF checks.  This helper
adds a second table/role boundary and commits only an explicitly versioned diff.
Install is an explicit operator operation, never a side effect of a data request.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import uuid
from pathlib import Path

PROTOCOL = "vg-ubuntu-company/1"
MAX_INPUT = 32 * 1024 * 1024
MAX_OUTPUT = 128 * 1024 * 1024
STAFF_ID = re.compile(r"^s[a-f0-9]{24}$")
ROW_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,180}$")
KEY = re.compile(r"^[A-Za-z0-9_.:-]{1,160}$")
HASH = re.compile(r"^[a-f0-9]{64}$")
UUID = re.compile(r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$", re.I)
SITE = re.compile(r"^(?:[a-f0-9]{32,64}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$")
ACTOR_NAMESPACE = uuid.UUID("ca7024d7-29bd-5a83-9a88-8a277c94031b")
FIELDS = {
    "proposals": "type name data reference_no",
    "company_documents": "kind record_id payload revision",
    "saha_records": "collection record_id payload revision",
    "products": "name category price original_name is_new is_active",
    "urun_takip": "urun_adi kategori marka model miktar birim lokasyon aciklama seri_no tarih user_email",
    "gorevler": "baslik aciklama durum oncelik atanan_kisi baslangic_tarihi bitis_tarihi notlar",
    "is_takip_calisanlar": "ad_soyad telefon email pozisyon aktif user_id",
    "is_takip_lokasyonlar": "ad adres koordinat aktif",
    "is_takip_malzemeler": "ad kategori birim stok_durumu aktif",
    "is_takip_kayitlar": "tarih calisan_id lokasyon_id baslangic_saat bitis_saat toplam_sure yapilan_is kullanilan_malzemeler notlar",
    "vehicles": "plate brand model year color active",
    "drivers": "full_name phone tc_no license_no active",
    "fuel_records": "date vehicle_id driver_id liters price_per_liter total_amount km station fuel_type payment_method description",
    "haftalik_raporlar": "fabrika_adi hafta_baslangic hafta_bitis guc_faktoru onceki_hafta_guc_faktoru hedef_guc_faktoru reaktif_guc aktif_guc kompanzasyon_durumu enerji_tuketimi maliyet notlar gorsel_url rapor_hazirlayan onaylayan excel_data_aktif excel_data_enduktif excel_data_kapasitif osos_ozet_tablo",
    "osos_fabrikalar": "firma_adi fabrika_adi vergi_no adres il ilce posta_kodu yetkili_adi yetkili_unvan telefon email tesis_gucu_kw calisan_sayisi faaliyet_alani dagitim_sirketi sayac_no musteri_no abone_no notlar aktif",
    "osos_olcumler": "fabrika_adi sayac_no aktif_guc reaktif_guc kapasitif_guc gorunen_guc gerilim_l1 gerilim_l2 gerilim_l3 akim_l1 akim_l2 akim_l3 guc_faktoru frekans toplam_enerji olcum_zamani",
    "bordro_employees": "name tc_no agreed_salary official_salary active user_id",
    "bordro_daily_logs": "employee_id day month year type start_time end_time overtime_hours description last_modified_by last_modified_at restored_at",
    "bordro_expenses": "employee_id month year type amount description date installment_total installment_current",
    "monthly_payroll_summary": "employee_id month year employee_name agreed_salary official_salary days_worked sunday_days overtime_hours advances expenses bonuses net_payable hand_pay closed_at user_id",
    "bordro_payment_records": "employee_id month year calculated_amount paid_amount balance payment_date payment_note",
    "beyaz_yaka_employees": "name tc_no email phone position department start_date monthly_salary gross_salary sgk_base active bank_name iban user_id",
    "beyaz_yaka_monthly_payroll": "employee_id month year base_salary overtime_pay bonus meal_allowance transport_allowance other_earnings advance_deduction sgk_employee unemployment_employee income_tax stamp_tax other_deductions net_payment sgk_employer unemployment_employer total_employer_cost worked_days total_days paid_leave_days unpaid_leave_days sick_leave_days payment_date payment_method is_paid notes logs expenses",
    "beyaz_yaka_advances": "employee_id amount advance_date description installment_count remaining_installments monthly_deduction is_fully_paid",
    "beyaz_yaka_leaves": "employee_id leave_type start_date end_date total_days is_paid description status",
    "beyaz_yaka_bonuses": "employee_id bonus_type amount bonus_date month year description is_applied",
    "activity_logs": "user_id user_email action_type action_description module related_id ip_address user_agent",
}
COMMON = "id created_at updated_at created_by updated_by".split()
SCHEMA = {table: set(COMMON + fields.split()) for table, fields in FIELDS.items()}
OWNERSHIP = {"bordro_employees", "beyaz_yaka_employees", "is_takip_calisanlar"}
ACTOR_FIELDS = {"created_by", "updated_by", "last_modified_by"}
FK_NATIVE = OWNERSHIP | {"activity_logs", "monthly_payroll_summary"}
PRIVATE_TABLES = {"osos_fabrikalar", "beyaz_yaka_leaves", "beyaz_yaka_bonuses", "saha_records"}
EXTRA_FIELDS = {"bordro_expenses": {"installment_total", "installment_current"}}


class BridgeError(Exception):
    def __init__(self, code: str, status: int = 422):
        super().__init__(code)
        self.code, self.status = code, status


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def token(value):
    return hashlib.sha256(encode(value).encode("utf-8")).hexdigest()


def sql_text(value: str):
    if not isinstance(value, str) or "\x00" in value:
        raise BridgeError("bridge_value")
    return "'" + value.replace("'", "''") + "'"


def sql_json(value):
    return sql_text(encode(value)) + "::jsonb"


def sql_ident(value):
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,79}", value):
        raise BridgeError("bridge_identifier")
    return '"' + value + '"'


def sensitive(table):
    return table.startswith(("bordro_", "beyaz_yaka_")) or table == "monthly_payroll_summary"


SAHA_HR = {"employees", "attendance", "payroll_records", "bordro_aylik", "leave_requests"}
SAHA_PERSONAL = {"locations", "location_checkins", "shifts", "geofence_events", "vehicle_route_points", "notification_preferences", "notifications", "app_usage", "ai_chat_sessions", "ai_chat_messages", "email_schedules", "email_dispatch_log", "sales_visits", "visits"}
SAHA_DENIED = {"api_keys", "app_settings", "einvoice_config", "webhooks", "pending_user_approvals", "push_tokens", "ai_ingest_queue", "erp_adapters"}
SAHA_SHARED_CACHE = set("tasks_v1 product_items_v1 task_comments_v1 task_attachments_v1 transformer_quotes_v1 osos_readings_v1 weekly_reports_v1 osos_alarms_v1 osos_alarm_rules_v1 osos_auto_report_v1 osos_daily_summary_v1 @SahaTakip:recurring_templates office_pages_v1 office_boards_v1 office_meetings_v1 @SahaTakip:import_history ges_quotes_v1 calendar_events_v1 @SahaTakip:maintenance_plans eq_assets_v1 eq_maint_v1 eq_fault_v1 eq_plans_v1 fo_jobs_v1 fo_check_v1 fo_qc_v1 fo_perf_v1 fo_zones_v1 fo_plan_v1 fo_emerg_v1 feedback_entries_v1 gov_departments_v1 gov_regions_v1 gov_approvals_v1 cx_quote_approvals_v1 cx_customer_comments_v1 cx_satisfaction_surveys_v1 cx_auto_reports_v1".split())
SAHA_MANAGED_CACHE = {"timesheet_v1", "payroll_runs_v1", "bordro_v1", "@SahaTakip:cash_entries"}
SAHA_SHARED_CACHE.update({"@SahaTakip:customer_documents", "lo_heat_v1", "lo_personnel_v1", "lo_routes_v1", "lo_eta_v1", "lo_perf_v1"})
SAHA_ADMIN_CACHE = {"lo_entities_v1", "lo_devs_v1", "lo_events_v1", "lo_replay_v1"}


def saha_staff_id(staff):
    value = list(hashlib.sha256(("voltguard-sahatakip-staff:" + staff).encode()).hexdigest())
    value[12], value[16] = "5", format((int(value[16], 16) & 3) | 8, "x")
    value = "".join(value)
    return value[:8] + "-" + value[8:12] + "-" + value[12:16] + "-" + value[16:20] + "-" + value[20:32]


def saha_members(records, conversation):
    return {row.get("payload", {}).get("user_id") for row in records.values() if row.get("collection") == "conversation_participants" and row.get("payload", {}).get("conversation_id") == conversation}


def saha_find(records, collection, identifier):
    return next((row for row in records.values() if row.get("collection") == collection and row.get("record_id") == identifier), None)


def saha_visible(actor, row, records):
    collection, payload, me = row.get("collection"), row.get("payload", {}), saha_staff_id(actor["id"])
    if collection in SAHA_DENIED:
        return False
    if collection == "_cache":
        key = payload.get("key")
        return isinstance(key, str) and (key in SAHA_SHARED_CACHE or key in SAHA_MANAGED_CACHE and actor["role"] != "employee" or key in SAHA_ADMIN_CACHE and actor["role"] == "admin")
    if collection in SAHA_HR:
        if actor["role"] != "employee" or collection == "employees":
            return True
        employee = saha_find(records, "employees", payload.get("employee_id"))
        return payload.get("user_id") == me or bool(employee and employee.get("payload", {}).get("user_id") == me)
    if collection in SAHA_PERSONAL:
        return actor["role"] == "admin" or payload.get("user_id", payload.get("created_by")) == me
    if collection in {"conversations", "conversation_participants", "messages"}:
        conversation = payload.get("id") if collection == "conversations" else payload.get("conversation_id")
        parent = row if collection == "conversations" else saha_find(records, "conversations", conversation)
        return me in saha_members(records, conversation) or bool(parent and parent.get("payload", {}).get("created_by") == me)
    if collection == "audit_log":
        return actor["role"] == "admin" or payload.get("user_id") == me
    if collection == "_files" and payload.get("bucket") == "chat-attachments" and row.get("created_by") != actor["id"]:
        return any(other.get("collection") == "messages" and other.get("payload", {}).get("attachment_url") == payload.get("path") and saha_visible(actor, other, records) for other in records.values())
    return True


def saha_snapshot_records(actor, records):
    # Decide every row's visibility against the original ownership graph.
    # Redacting employee payloads during that pass can hide a later payroll
    # row belonging to this same employee (and makes results order-dependent).
    visible = {key: dict(row) for key, row in records.items() if saha_visible(actor, row, records)}
    if actor["role"] == "employee":
        me = saha_staff_id(actor["id"])
        for row in visible.values():
            if row.get("collection") == "employees":
                payload = row.get("payload", {})
                safe = {"id", "full_name", "role", "active", "created_at", "updated_at"}
                # PHP still needs this employee's own identity link to apply
                # HR row checks. Its public directory projection removes it.
                if payload.get("user_id") == me:
                    safe.add("user_id")
                row["payload"] = {field: value for field, value in payload.items() if field in safe}
    return visible


def saha_validate_change(actor, old, desired, records):
    row = desired or old
    if not isinstance(row, dict) or not isinstance(row.get("payload"), dict):
        raise BridgeError("bridge_saha_record")
    collection, identifier, payload = row.get("collection"), row.get("record_id"), row["payload"]
    if not isinstance(collection, str) or not re.fullmatch(r"_files|_cache|[a-z][a-z0-9_]{0,63}", collection) or collection in SAHA_DENIED or collection in {"profiles", "latest_locations"}:
        raise BridgeError("bridge_saha_collection", 403)
    if not isinstance(identifier, str) or row.get("id") != hashlib.sha256((collection + ":" + identifier).encode()).hexdigest() or payload.get("id") != identifier:
        raise BridgeError("bridge_saha_record")
    if old and any(old.get(field) != row.get(field) for field in ("id", "collection", "record_id")):
        raise BridgeError("bridge_saha_immutable", 403)
    if desired and (not isinstance(desired.get("revision"), int) or desired["revision"] != (old.get("revision", 0) + 1 if old else 1)):
        raise BridgeError("bridge_saha_revision", 409)
    if len(encode(payload).encode()) > 2 * 1024 * 1024:
        raise BridgeError("bridge_saha_capacity", 413)
    me = saha_staff_id(actor["id"])
    if collection == "_cache":
        key, value = payload.get("key"), payload.get("value")
        if not isinstance(key, str) or key not in SAHA_SHARED_CACHE | SAHA_MANAGED_CACHE | SAHA_ADMIN_CACHE or identifier != hashlib.sha256(key.encode()).hexdigest():
            raise BridgeError("bridge_saha_cache", 403)
        if key in SAHA_MANAGED_CACHE and actor["role"] == "employee":
            raise BridgeError("bridge_saha_payroll", 403)
        if key in SAHA_ADMIN_CACHE and actor["role"] != "admin":
            raise BridgeError("bridge_saha_scope", 403)
        if desired is None or value is not None and (not isinstance(value, str) or "\x00" in value or len(value.encode()) > 2 * 1024 * 1024):
            raise BridgeError("bridge_saha_cache", 403)
    if collection in SAHA_HR and actor["role"] == "employee":
        raise BridgeError("bridge_saha_payroll", 403)
    if old and not saha_visible(actor, old, records):
        raise BridgeError("bridge_saha_scope", 403)
    if desired and collection not in {"_files", "_cache"}:
        for field in ("created_by", "updated_by", "sender_id", "uploaded_by", "actor_id"):
            if field in payload and payload[field] != (old or {}).get("payload", {}).get(field, me) and field != "updated_by":
                raise BridgeError("bridge_saha_actor", 403)
        if payload.get("updated_by") != me:
            raise BridgeError("bridge_saha_actor", 403)
    if collection in SAHA_PERSONAL and actor["role"] != "admin" and payload.get("user_id", payload.get("created_by")) != me:
        raise BridgeError("bridge_saha_owner", 403)
    if collection == "conversation_participants":
        parent = saha_find(records, "conversations", payload.get("conversation_id"))
        old_payload = (old or {}).get("payload", {})
        changed = {key for key in set(old_payload) | set(payload) if old_payload.get(key) != payload.get(key)}
        self_read = old and desired and old_payload.get("user_id") == me and changed <= {"last_read_at", "updated_at", "updated_by"}
        if not self_read and (not parent or parent.get("payload", {}).get("created_by") != me):
            raise BridgeError("bridge_saha_participant", 403)
    elif collection == "messages":
        if not saha_visible(actor, row, records) or payload.get("sender_id") != me:
            raise BridgeError("bridge_saha_participant", 403)
    elif collection == "_files":
        if old and old.get("created_by") != actor["id"] and actor["role"] != "admin":
            raise BridgeError("bridge_saha_owner", 403)
    elif old and collection != "_cache" and actor["role"] == "employee" and old.get("payload", {}).get("created_by") != me:
        assigned = old.get("payload", {}).get("assigned_to_id")
        employee = saha_find(records, "employees", assigned)
        if assigned != me and not (employee and employee.get("payload", {}).get("user_id") == me) and collection not in SAHA_PERSONAL | {"stock_balances", "stock_movements", "form_responses", "employees"}:
            raise BridgeError("bridge_saha_owner", 403)


def actor_id(staff_id, site):
    return str(uuid.uuid5(ACTOR_NAMESPACE, "voltguard-native-staff:" + site + ":" + staff_id))


def validate_site(value):
    if not isinstance(value, str) or not SITE.fullmatch(value):
        raise BridgeError("bridge_site", 403)
    return value


def table_target(table):
    return ("voltguard_site." if table in PRIVATE_TABLES else "public.") + sql_ident(table)


def validate_actor(value):
    if not isinstance(value, dict) or not STAFF_ID.fullmatch(str(value.get("id", ""))) or value.get("role") not in {"employee", "payroll", "admin"}:
        raise BridgeError("bridge_actor", 403)
    return {"id": value["id"], "role": value["role"]}


def normalize(table, raw, sidecar=None):
    row = {k: v for k, v in raw.items() if k in SCHEMA[table]}
    row["id"] = row_key(table, raw)
    fields = (sidecar or {}).get("fields", {})
    for field, binding in fields.items():
        if field in SCHEMA[table] and isinstance(binding, dict) and binding.get("anchor") == raw.get(field):
            row[field] = binding.get("value")
    # Old UUID/email/name relationships do not confer native account ownership.
    if table in FK_NATIVE and not STAFF_ID.fullmatch(str(row.get("user_id", ""))):
        row["user_id"] = None
    return row


def row_key(table, row):
    if table == "company_documents":
        return str(uuid.uuid5(ACTOR_NAMESPACE, "voltguard-document:" + str(row["kind"]) + ":" + str(row["record_id"])))
    return str(row["id"])


def row_token(raw, sidecar):
    return token({"db": raw, "sidecar": sidecar or None})


class Psql:
    """One persistent psql session keeps CAS reads, writes and triggers atomic."""
    def __init__(self, config):
        for key in ("container", "database", "user"):
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}", str(config.get(key, ""))):
                raise BridgeError("bridge_config", 503)
        command = ["docker", "exec", "-i", config["container"], "psql", "-U", config["user"], "-d", config["database"], "-X", "-q", "-t", "-A", "-P", "pager=off", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate"]
        self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", bufsize=1)
        self.errors = []
        self.reader = threading.Thread(target=self._errors, daemon=True)
        self.reader.start()
        self.execute("SET standard_conforming_strings=on; SET statement_timeout='25s'; SET lock_timeout='5s'; SET TIME ZONE 'UTC';")

    def _errors(self):
        for line in self.process.stderr:
            code = re.search(r"(?:ERROR|FATAL):\s+([0-9A-Z]{5})", line)
            if code:
                self.errors.append(code.group(1))

    def execute(self, sql):
        sentinel = "vg_bridge_end_" + uuid.uuid4().hex
        try:
            self.process.stdin.write(sql + "\nSELECT '" + sentinel + "';\n")
            self.process.stdin.flush()
        except (BrokenPipeError, OSError):
            raise BridgeError("bridge_database", 503) from None
        lines, size = [], 0
        for line in self.process.stdout:
            line = line.rstrip("\r\n")
            if line == sentinel:
                return lines
            if line:
                size += len(line.encode("utf-8"))
                if size > MAX_OUTPUT:
                    self.close()
                    raise BridgeError("bridge_capacity", 503)
                lines.append(line)
        self.reader.join(timeout=1)
        state = self.errors[-1] if self.errors else None
        if state in {"40001", "40P01", "23505", "23503", "PT409"}:
            raise BridgeError("bridge_conflict", 409)
        if state and (state.startswith("22") or state.startswith("23")):
            raise BridgeError("bridge_record", 422)
        raise BridgeError("bridge_database", 503)

    def json(self, sql):
        lines = self.execute(sql)
        if len(lines) != 1:
            raise BridgeError("bridge_database", 503)
        try:
            return json.loads(lines[0])
        except ValueError:
            raise BridgeError("bridge_database", 503) from None

    def close(self):
        if self.process.poll() is None:
            try:
                self.process.stdin.close()
                self.process.wait(timeout=2)
            except (OSError, subprocess.TimeoutExpired):
                self.process.kill()
                self.process.wait(timeout=2)


class Repository:
    def __init__(self, db, catalog_sources=None):
        self.db = db
        self.columns = {}
        self.site = None
        self.catalog_sources = catalog_sources

    def metadata(self):
        names = ",".join(sql_text(x) for x in SCHEMA)
        private_names = ",".join(sql_text(x) for x in PRIVATE_TABLES)
        columns = self.db.json("SELECT coalesce(json_agg(json_build_object('table',table_name,'name',column_name,'type',udt_name,'nullable',is_nullable,'default',column_default)), '[]'::json) FROM information_schema.columns WHERE (table_schema='public' AND table_name IN (" + names + ") AND table_name NOT IN (" + private_names + ")) OR (table_schema='voltguard_site' AND table_name IN (" + private_names + "));")
        for column in columns:
            self.columns.setdefault(column["table"], {})[column["name"]] = column
        return self.columns

    def sidecars(self):
        rows = self.db.json("SELECT coalesce(json_agg(json_build_object('table',table_name,'id',row_key,'fields',fields)), '[]'::json) FROM voltguard_site.rows WHERE site=" + sql_text(self.site) + ";")
        return {(row["table"], row["id"]): {"fields": row["fields"]} for row in rows}

    def read_tables(self, tables, lock=False):
        result = {}
        for table in tables:
            if table not in self.columns:
                raise BridgeError("bridge_schema_missing", 503)
            target = table_target(table)
            where = " WHERE site=" + sql_text(self.site) if table in PRIVATE_TABLES else ""
            suffix = " FOR UPDATE" if lock else ""
            result[table] = self.db.json("SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM (SELECT * FROM " + target + where + suffix + ") t;")
        return result

    def prefs(self, actor, lock=False):
        suffix = " FOR UPDATE" if lock else ""
        items = self.db.json("SELECT coalesce(json_agg(to_jsonb(p)), '[]'::json) FROM (SELECT key,value FROM voltguard_site.preferences WHERE site=" + sql_text(self.site) + " AND staff_id=" + sql_text(actor["id"]) + suffix + ") p;")
        return {item["key"]: item["value"] for item in items}

    def sequence(self):
        return self.db.json("SELECT json_build_object('value',last_value) FROM public.company_proposal_ref_seq;")["value"]

    def snapshot(self, request):
        actor = validate_actor(request.get("actor"))
        self.site = validate_site(request.get("site"))
        tables = request.get("tables", list(SCHEMA))
        if not isinstance(tables, list) or len(tables) != len(set(tables)) or any(table not in SCHEMA for table in tables):
            raise BridgeError("bridge_table", 403)
        self.db.execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;")
        self.metadata()
        raw_tables, sides = self.read_tables(tables), self.sidecars()
        normalized, hashes = {}, {}
        for table, rows in raw_tables.items():
            normalized[table], hashes[table] = {}, {}
            for raw in rows:
                key = row_key(table, raw)
                side = sides.get((table, key))
                normalized[table][key] = normalize(table, raw, side)
                hashes[table][key] = row_token(raw, side)
        if "saha_records" in normalized:
            records = normalized["saha_records"]
            normalized["saha_records"] = saha_snapshot_records(actor, records)
            hashes["saha_records"] = {key: value for key, value in hashes["saha_records"].items() if key in normalized["saha_records"]}
        if actor["role"] == "employee":
            for table in tables:
                if table == "activity_logs":
                    for key, row in list(normalized[table].items()):
                        if row.get("user_id") != actor["id"]:
                            del normalized[table][key]
                            del hashes[table][key]
                if not sensitive(table):
                    continue
                employee_table = "beyaz_yaka_employees" if table.startswith("beyaz_yaka_") else "bordro_employees"
                for key, row in list(normalized[table].items()):
                    employee = row if table == employee_table else normalized.get(employee_table, {}).get(str(row.get("employee_id")), {})
                    if employee.get("user_id") != actor["id"]:
                        del normalized[table][key]
                        del hashes[table][key]
        prefs = self.prefs(actor)
        sequence = self.sequence()
        self.db.execute("COMMIT;")
        result = {"state": {"version": 1, "tables": normalized, "storage": {actor["id"]: prefs}, "sequence": sequence, "audit": []}, "snapshot": {"rows": hashes, "prefs": {key: token(value) for key, value in prefs.items()}}}
        if self.catalog_sources is not None:
            result["catalog"] = read_catalog(self.catalog_sources)
        return result

    def _where(self, table, raw, alias=""):
        fields = ["kind", "record_id"] if table == "company_documents" else ["id"]
        prefix = alias + "." if alias else ""
        where = " AND ".join(prefix + sql_ident(field) + "=" + sql_text(str(raw[field])) for field in fields)
        if table in PRIVATE_TABLES:
            where += " AND " + prefix + "site=" + sql_text(self.site)
        return where

    def _write(self, table, desired, old_raw, old_side, actor):
        columns = self.columns[table]
        old = normalize(table, old_raw, old_side) if old_raw else {}
        db_values = {}
        virtual = {field: dict(binding) for field, binding in (old_side or {}).get("fields", {}).items() if isinstance(binding, dict) and binding.get("anchor") == (old_raw or {}).get(field)}
        for field, value in desired.items():
            if field not in SCHEMA[table]:
                raise BridgeError("bridge_field")
            if table == "company_documents" and field == "id":
                continue
            if old_raw and field in {"id", "created_at", "created_by"}:
                if value != old.get(field):
                    raise BridgeError("bridge_immutable")
                continue
            is_owner = table in OWNERSHIP and field == "user_id"
            is_actor = field in ACTOR_FIELDS or (table in {"activity_logs", "monthly_payroll_summary"} and field == "user_id")
            if is_owner:
                if value is not None and not STAFF_ID.fullmatch(str(value)):
                    raise BridgeError("bridge_owner")
                virtual[field] = {"value": value, "anchor": old_raw.get(field) if old_raw else None}
                # Preserve the legacy auth.users UUID without creating or stealing a login.
                if not old_raw and field in columns:
                    db_values[field] = None
                continue
            if is_actor and isinstance(value, str) and STAFF_ID.fullmatch(value):
                if value != actor["id"] and (not old_raw or value != old.get(field)):
                    raise BridgeError("bridge_actor_field", 403)
                if field not in columns:
                    virtual[field] = {"value": value, "anchor": None}
                    continue
                typ = columns[field]["type"]
                if typ == "uuid":
                    if field == "user_id" and table in FK_NATIVE:
                        db_values[field] = old_raw.get(field) if old_raw else None
                    else:
                        db_values[field] = actor_id(value, self.site)
                else:
                    db_values[field] = value
                virtual[field] = {"value": value, "anchor": db_values[field]}
                continue
            if field not in columns:
                # Reviewed API audit/restoration metadata may not exist in old DB columns.
                if field in COMMON or field == "restored_at" or field in EXTRA_FIELDS.get(table, set()):
                    virtual[field] = {"value": value, "anchor": None}
                    continue
                raise BridgeError("bridge_schema_field", 503)
            if old_raw and value == old.get(field):
                continue
            if field == "id" and not old_raw and columns[field]["type"] in {"int2", "int4", "int8"}:
                if not columns[field]["default"]:
                    raise BridgeError("bridge_schema_id", 503)
                continue
            db_values[field] = value
        # Trigger actor attribution remains valid without changing existing auth helpers.
        if table in {"company_documents", "proposals"}:
            for field in ("created_by", "updated_by"):
                if field in columns and (not old_raw or field == "updated_by"):
                    virtual[field] = {"value": actor["id"], "anchor": actor_id(actor["id"], self.site)}
        if table == "bordro_daily_logs":
            virtual["last_modified_by"] = {"value": actor["id"], "anchor": actor_id(actor["id"], self.site)}
        if table in PRIVATE_TABLES and not old_raw:
            db_values["site"] = self.site
        target = table_target(table)
        values = sql_json(db_values)
        if old_raw:
            assignments = ",".join(sql_ident(field) + "=v." + sql_ident(field) for field in db_values)
            if not assignments:
                actual = old_raw
            else:
                rows = self.db.json("WITH changed AS (UPDATE " + target + " t SET " + assignments + " FROM jsonb_populate_record(NULL::" + target + "," + values + ") v WHERE " + self._where(table, old_raw, "t") + " RETURNING t.*) SELECT coalesce(json_agg(to_jsonb(changed)), '[]'::json) FROM changed;")
                if len(rows) != 1:
                    raise BridgeError("bridge_conflict", 409)
                actual = rows[0]
        else:
            names = ",".join(sql_ident(field) for field in db_values)
            select = ",".join("v." + sql_ident(field) for field in db_values)
            rows = self.db.json("WITH changed AS (INSERT INTO " + target + " (" + names + ") SELECT " + select + " FROM jsonb_populate_record(NULL::" + target + "," + values + ") v RETURNING *) SELECT json_agg(to_jsonb(changed)) FROM changed;")
            actual = rows[0]
        key = row_key(table, actual)
        # Store actual anchors after triggers, including columns a trigger rewrote.
        for field, binding in virtual.items():
            binding["anchor"] = actual.get(field)
        self.db.execute("INSERT INTO voltguard_site.rows(site,table_name,row_key,fields) VALUES(" + sql_text(self.site) + "," + sql_text(table) + "," + sql_text(key) + "," + sql_json(virtual) + ") ON CONFLICT(site,table_name,row_key) DO UPDATE SET fields=EXCLUDED.fields;")
        return normalize(table, actual, {"fields": virtual})

    def _check_delete_relations(self, deleted_table, old_raw, changes):
        identifier = str(old_raw.get("id", ""))
        if not identifier:
            return
        planned = {(change["table"], change["id"]): change["row"] for change in changes}
        for table, columns in self.columns.items():
            relations = set(columns) & {"employee_id", "vehicle_id", "driver_id", "calisan_id", "lokasyon_id"}
            materials = deleted_table == "is_takip_malzemeler" and table == "is_takip_kayitlar" and "kullanilan_malzemeler" in columns
            if not relations and not materials:
                continue
            conditions = [sql_ident(field) + "::text=" + sql_text(identifier) for field in relations]
            if materials:
                # to_jsonb supports legacy PostgreSQL arrays as well as JSON/JSONB arrays.
                conditions.append('to_jsonb("kullanilan_malzemeler") ? ' + sql_text(identifier))
            predicates = " OR ".join(conditions)
            if table in PRIVATE_TABLES:
                predicates = "site=" + sql_text(self.site) + " AND (" + predicates + ")"
            records = self.db.json("SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM (SELECT * FROM " + table_target(table) + " WHERE " + predicates + " FOR UPDATE) t;")
            for row in records:
                marker = (table, row_key(table, row))
                if marker in planned:
                    replacement = planned[marker]
                    if replacement is None:
                        continue
                    scalar_reference = any(str(replacement.get(field, "")) == identifier for field in relations)
                    material_ids = replacement.get("kullanilan_malzemeler")
                    material_reference = materials and isinstance(material_ids, list) and identifier in material_ids
                    if not scalar_reference and not material_reference:
                        continue
                # Even legacy ON DELETE CASCADE must not silently erase history.
                raise BridgeError("bridge_relation_in_use", 409)

    def commit(self, request):
        actor = validate_actor(request.get("actor"))
        self.site = validate_site(request.get("site"))
        request_id = request.get("requestId", "")
        if not isinstance(request_id, str) or not UUID.fullmatch(request_id):
            raise BridgeError("bridge_request_id")
        changes, preferences, audit = validate_commit(request, actor)
        fingerprint = token(request)
        self.db.execute("BEGIN ISOLATION LEVEL SERIALIZABLE; SELECT pg_advisory_xact_lock(867138121741); SELECT set_config('request.jwt.claims'," + sql_text(encode({"sub": actor_id(actor["id"], self.site), "role": "authenticated"})) + ",true);")
        saved = self.db.json("SELECT coalesce(json_agg(json_build_object('actor',staff_id,'hash',input_hash,'response',response)), '[]'::json) FROM voltguard_site.commits WHERE site=" + sql_text(self.site) + " AND request_id=" + sql_text(request_id) + "::uuid;")
        if saved:
            if saved[0]["actor"] != actor["id"] or saved[0]["hash"] != fingerprint:
                raise BridgeError("bridge_request_reused", 409)
            self.db.execute("COMMIT;")
            return saved[0]["response"]
        self.metadata()
        tables = list(dict.fromkeys(change["table"] for change in changes))
        raw_tables, sides = self.read_tables(tables, lock=True), self.sidecars()
        indexed = {table: {row_key(table, row): row for row in rows} for table, rows in raw_tables.items()}
        saha_records = {key: normalize("saha_records", raw, sides.get(("saha_records", key))) for key, raw in indexed.get("saha_records", {}).items()}
        resolved = []
        for change in changes:
            table, key, desired = change["table"], change["id"], change["row"]
            actual_key = row_key(table, desired) if table == "company_documents" and desired else key
            old_raw = indexed[table].get(actual_key)
            old_side = sides.get((table, actual_key))
            actual_token = row_token(old_raw, old_side) if old_raw else None
            if actual_token != change["before"]:
                raise BridgeError("bridge_conflict", 409)
            if old_raw and desired and table != "company_documents" and str(desired.get("id")) != actual_key:
                raise BridgeError("bridge_immutable")
            if table == "saha_records":
                old = normalize(table, old_raw, old_side) if old_raw else None
                saha_validate_change(actor, old, desired, saha_records)
            resolved.append((change, old_raw, old_side))
        prefs = self.prefs(actor, lock=True)
        for change in preferences:
            actual_token = token(prefs[change["key"]]) if change["key"] in prefs else None
            if actual_token != change["before"]:
                raise BridgeError("bridge_conflict", 409)
        rows, aliases = {}, {}
        for change, old_raw, old_side in resolved:
            table, key, desired = change["table"], change["id"], change["row"]
            rows.setdefault(table, {})
            if desired is None:
                if old_raw:
                    self._check_delete_relations(table, old_raw, changes)
                    self.db.execute("DELETE FROM " + table_target(table) + " WHERE " + self._where(table, old_raw) + "; DELETE FROM voltguard_site.rows WHERE site=" + sql_text(self.site) + " AND table_name=" + sql_text(table) + " AND row_key=" + sql_text(row_key(table, old_raw)) + ";")
                rows[table][key] = None
            else:
                actual = self._write(table, desired, old_raw, old_side, actor)
                rows[table][key] = actual
                if actual["id"] != key:
                    aliases.setdefault(table, {})[key] = actual["id"]
        for change in preferences:
            key, value = change["key"], change["value"]
            if value is None:
                self.db.execute("DELETE FROM voltguard_site.preferences WHERE site=" + sql_text(self.site) + " AND staff_id=" + sql_text(actor["id"]) + " AND key=" + sql_text(key) + ";")
                prefs.pop(key, None)
            else:
                prefs[key] = value
                self.db.execute("INSERT INTO voltguard_site.preferences(site,staff_id,key,value) VALUES(" + sql_text(self.site) + "," + sql_text(actor["id"]) + "," + sql_text(key) + "," + sql_text(value) + ") ON CONFLICT(site,staff_id,key) DO UPDATE SET value=EXCLUDED.value;")
        if len(prefs) > 2000 or len(encode(prefs).encode("utf-8")) > 16 * 1024 * 1024:
            raise BridgeError("bridge_storage_capacity", 409)
        for event in audit:
            self.db.execute("INSERT INTO voltguard_site.audit(site,request_id,staff_id,event,target,occurred_at) VALUES(" + sql_text(self.site) + "," + sql_text(request_id) + "::uuid," + sql_text(actor["id"]) + "," + sql_text(event["event"]) + "," + sql_text(event["target"]) + "," + sql_text(event["at"]) + "::timestamptz);")
        response = {"rows": rows, "aliases": aliases, "sequence": self.sequence(), "requestId": request_id}
        self.db.execute("INSERT INTO voltguard_site.commits(site,request_id,staff_id,input_hash,response) VALUES(" + sql_text(self.site) + "," + sql_text(request_id) + "::uuid," + sql_text(actor["id"]) + "," + sql_text(fingerprint) + "," + sql_json(response) + "); COMMIT;")
        return response


def validate_commit(request, actor):
    changes, preferences, audit = request.get("changes", []), request.get("storageChanges", []), request.get("audit", [])
    if not isinstance(changes, list) or len(changes) > 5000 or not isinstance(preferences, list) or len(preferences) > 2000 or not isinstance(audit, list) or len(audit) > 5000:
        raise BridgeError("bridge_patch")
    seen = set()
    for change in changes:
        if not isinstance(change, dict) or set(change) != {"table", "id", "before", "row"}:
            raise BridgeError("bridge_patch")
        table, key, before, row = change["table"], change["id"], change["before"], change["row"]
        if table not in SCHEMA or not isinstance(key, str) or not ROW_ID.fullmatch(key):
            raise BridgeError("bridge_table", 403)
        if sensitive(table) and actor["role"] == "employee":
            raise BridgeError("bridge_payroll", 403)
        if before is not None and (not isinstance(before, str) or not HASH.fullmatch(before)):
            raise BridgeError("bridge_version")
        if row is not None and (not isinstance(row, dict) or set(row) - SCHEMA[table] or str(row.get("id")) != key):
            raise BridgeError("bridge_row")
        if (table, key) in seen:
            raise BridgeError("bridge_duplicate")
        seen.add((table, key))
        if table == "proposals" and before is not None and row is not None:
            raise BridgeError("bridge_immutable", 403)
    seen = set()
    for change in preferences:
        if not isinstance(change, dict) or set(change) != {"key", "before", "value"}:
            raise BridgeError("bridge_storage")
        key, before, value = change["key"], change["before"], change["value"]
        if not isinstance(key, str) or not KEY.fullmatch(key) or key in seen or (before is not None and (not isinstance(before, str) or not HASH.fullmatch(before))) or (value is not None and (not isinstance(value, str) or "\x00" in value or len(value.encode("utf-8")) > 2 * 1024 * 1024)):
            raise BridgeError("bridge_storage")
        seen.add(key)
    for event in audit:
        if not isinstance(event, dict) or set(event) != {"at", "actor", "event", "target"} or event["actor"] != actor["id"] or not isinstance(event["event"], str) or not re.fullmatch(r"[A-Za-z0-9_:.-]{1,100}", event["event"]) or not isinstance(event["target"], str) or len(event["target"]) > 180 or not isinstance(event["at"], str) or not re.fullmatch(r"[0-9TZ:.+\-]{20,40}", event["at"]):
            raise BridgeError("bridge_audit")
    return changes, preferences, audit


INSTALL_SQL = """
BEGIN;
CREATE SCHEMA IF NOT EXISTS voltguard_site;
REVOKE ALL ON SCHEMA voltguard_site FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS voltguard_site.rows(site text NOT NULL,table_name text NOT NULL,row_key text NOT NULL,fields jsonb NOT NULL DEFAULT '{}'::jsonb,PRIMARY KEY(site,table_name,row_key));
CREATE TABLE IF NOT EXISTS voltguard_site.preferences(site text NOT NULL,staff_id text NOT NULL,key text NOT NULL,value text NOT NULL,PRIMARY KEY(site,staff_id,key));
CREATE TABLE IF NOT EXISTS voltguard_site.audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,site text NOT NULL,request_id uuid NOT NULL,staff_id text NOT NULL,event text NOT NULL,target text NOT NULL,occurred_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS voltguard_site.commits(site text NOT NULL,request_id uuid NOT NULL,staff_id text NOT NULL,input_hash text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(site,request_id));
CREATE TABLE IF NOT EXISTS voltguard_site.osos_fabrikalar(
 site text NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),firma_adi text,fabrika_adi text,vergi_no text,adres text,il text,ilce text,posta_kodu text,yetkili_adi text,yetkili_unvan text,telefon text,email text,
 tesis_gucu_kw numeric,calisan_sayisi integer,faaliyet_alani text,dagitim_sirketi text,sayac_no text,musteri_no text,abone_no text,notlar text,aktif boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),created_by text,updated_by text,PRIMARY KEY(site,id));
CREATE TABLE IF NOT EXISTS voltguard_site.beyaz_yaka_leaves(
 site text NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),employee_id uuid NOT NULL REFERENCES public.beyaz_yaka_employees(id) ON DELETE RESTRICT,
 leave_type text,start_date date,end_date date,total_days integer,is_paid boolean DEFAULT true,description text,status text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),created_by text,updated_by text,PRIMARY KEY(site,id));
CREATE TABLE IF NOT EXISTS voltguard_site.beyaz_yaka_bonuses(
 site text NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),employee_id uuid NOT NULL REFERENCES public.beyaz_yaka_employees(id) ON DELETE RESTRICT,
 bonus_type text,amount numeric,bonus_date date,month integer,year integer,description text,is_applied boolean DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),created_by text,updated_by text,PRIMARY KEY(site,id));
CREATE TABLE IF NOT EXISTS voltguard_site.saha_records(
 site text NOT NULL,id text NOT NULL,collection text NOT NULL,record_id text NOT NULL,payload jsonb NOT NULL,revision integer NOT NULL CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),created_by text,updated_by text,PRIMARY KEY(site,id),UNIQUE(site,collection,record_id));
REVOKE ALL ON ALL TABLES IN SCHEMA voltguard_site FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA voltguard_site FROM PUBLIC,anon,authenticated;
ALTER TABLE voltguard_site.rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE voltguard_site.preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE voltguard_site.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE voltguard_site.commits ENABLE ROW LEVEL SECURITY;
ALTER TABLE voltguard_site.osos_fabrikalar ENABLE ROW LEVEL SECURITY;
ALTER TABLE voltguard_site.beyaz_yaka_leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE voltguard_site.beyaz_yaka_bonuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE voltguard_site.saha_records ENABLE ROW LEVEL SECURITY;
COMMIT;
"""


def read_config(filename):
    path = Path(filename)
    if not path.is_absolute() or not path.is_file() or path.is_symlink():
        raise BridgeError("bridge_config", 503)
    if os.name != "nt" and path.stat().st_mode & 0o077:
        raise BridgeError("bridge_config_permissions", 503)
    data = json.loads(path.read_text(encoding="utf-8"))
    return {key: data.get(key) for key in ("container", "database", "user", "catalogSources")}


def read_catalog(sources):
    keys = {"historicalInvoice1", "historicalInvoice2", "cablePrices", "packages"}
    if not isinstance(sources, dict) or set(sources) != keys:
        raise BridgeError("bridge_catalog_config", 503)
    catalog, total = {}, 0
    for key, filename in sources.items():
        path = Path(filename)
        if not path.is_absolute() or not path.is_file() or path.is_symlink():
            raise BridgeError("bridge_catalog_config", 503)
        size = path.stat().st_size
        total += size
        if size > 16 * 1024 * 1024 or total > 16 * 1024 * 1024:
            raise BridgeError("bridge_catalog_capacity", 503)
        try:
            value = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError, UnicodeError):
            raise BridgeError("bridge_catalog", 503) from None
        if (key.startswith("historicalInvoice") and not isinstance(value, list)) or (key in {"cablePrices", "packages"} and not isinstance(value, dict)):
            raise BridgeError("bridge_catalog", 503)
        catalog[key] = value
    return catalog


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="/home/emrullah/voltguard-site-bridge/config.json")
    parser.add_argument("--install", action="store_true")
    args = parser.parse_args()
    db = None
    try:
        raw = sys.stdin.buffer.read(MAX_INPUT + 1)
        if len(raw) > MAX_INPUT:
            raise BridgeError("bridge_input_capacity", 413)
        try:
            request = json.loads(raw)
        except (ValueError, UnicodeError):
            raise BridgeError("bridge_input") from None
        if not isinstance(request, dict):
            raise BridgeError("bridge_input")
        if args.install:
            if request != {"op": "install"}:
                raise BridgeError("bridge_operation")
        elif request.get("op") not in {"snapshot", "commit", "health"}:
            raise BridgeError("bridge_operation", 403)
        else:
            validate_actor(request.get("actor"))
            validate_site(request.get("site"))
        config = read_config(args.config)
        db = Psql(config)
        repo = Repository(db, config.get("catalogSources"))
        if args.install:
            db.execute(INSTALL_SQL)
            result = {"installed": True}
        elif request["op"] == "health":
            result = {"healthy": db.json("SELECT json_build_object('healthy',true);")["healthy"]}
        else:
            result = repo.snapshot(request) if request["op"] == "snapshot" else repo.commit(request)
        output = encode({"protocol": PROTOCOL, "ok": True, **result})
        if len(output.encode("utf-8")) > MAX_OUTPUT:
            raise BridgeError("bridge_capacity", 503)
        print(output)
    except BridgeError as error:
        print(encode({"protocol": PROTOCOL, "ok": False, "code": error.code, "error": error.code, "status": error.status}))
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        # Do not echo SQL, personal rows, passwords or connection details.
        print(encode({"protocol": PROTOCOL, "ok": False, "code": "bridge_unavailable", "error": "bridge_unavailable", "status": 503}))
    finally:
        if db:
            db.close()


if __name__ == "__main__":
    main()
