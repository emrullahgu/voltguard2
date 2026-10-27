<?php
/** Reviewed SahaTakip column declarations; contains no source records or credentials. */
if (!defined('VG_API')) { http_response_code(404); exit; }
function vg_saha_schema(): array {
 static $schema;
 if ($schema === null) $schema = json_decode(<<<'SCHEMA'
{
  "profiles": {
    "id": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "full_name": {
      "type": "text"
    },
    "role": {
      "type": "text"
    },
    "phone": {
      "type": "text"
    },
    "avatar_url": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    },
    "updated_at": {
      "type": "timestamptz"
    },
    "approval_status": {
      "type": "text"
    },
    "approved_at": {
      "type": "timestamptz"
    },
    "approved_by": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "rejection_reason": {
      "type": "text"
    }
  },
  "customers": {
    "id": {
      "type": "uuid"
    },
    "short_name": {
      "type": "text",
      "required": true
    },
    "title": {
      "type": "text",
      "required": true
    },
    "tax_number": {
      "type": "text"
    },
    "tax_office": {
      "type": "text"
    },
    "phone": {
      "type": "text"
    },
    "email": {
      "type": "text"
    },
    "address": {
      "type": "text"
    },
    "city": {
      "type": "text"
    },
    "contact_person": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    },
    "created_by": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "deleted_at": {
      "type": "timestamptz"
    }
  },
  "quotes": {
    "id": {
      "type": "uuid"
    },
    "number": {
      "type": "text",
      "required": true
    },
    "customer_id": {
      "type": "uuid",
      "references": [
        "customers",
        "id"
      ]
    },
    "customer_name": {
      "type": "text",
      "required": true
    },
    "customer_title": {
      "type": "text"
    },
    "title": {
      "type": "text",
      "required": true
    },
    "date": {
      "type": "date"
    },
    "valid_until": {
      "type": "date"
    },
    "engineer": {
      "type": "text"
    },
    "status": {
      "type": "text"
    },
    "notes": {
      "type": "text"
    },
    "subtotal": {
      "type": "numeric"
    },
    "vat_total": {
      "type": "numeric"
    },
    "grand_total": {
      "type": "numeric"
    },
    "created_at": {
      "type": "timestamptz"
    },
    "updated_at": {
      "type": "timestamptz"
    },
    "created_by": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "revision": {
      "type": "int"
    },
    "accepted_at": {
      "type": "timestamptz"
    },
    "accepted_by": {
      "type": "text"
    },
    "accept_signature": {
      "type": "text"
    },
    "generated_work_order_id": {
      "type": "text"
    },
    "template_id": {
      "type": "text"
    },
    "share_token": {
      "type": "text"
    },
    "images": {
      "type": "jsonb"
    },
    "deleted_at": {
      "type": "timestamptz"
    }
  },
  "quote_lines": {
    "id": {
      "type": "uuid"
    },
    "quote_id": {
      "type": "uuid",
      "references": [
        "quotes",
        "id"
      ]
    },
    "line_no": {
      "type": "int",
      "required": true
    },
    "poz_id": {
      "type": "text",
      "required": true
    },
    "poz_name": {
      "type": "text",
      "required": true
    },
    "unit": {
      "type": "text"
    },
    "quantity": {
      "type": "numeric"
    },
    "material_price": {
      "type": "numeric"
    },
    "install_price": {
      "type": "numeric"
    },
    "dismantle_price": {
      "type": "numeric"
    },
    "with_dismantle": {
      "type": "boolean"
    },
    "overhead_pct": {
      "type": "numeric"
    },
    "profit_pct": {
      "type": "numeric"
    },
    "vat_pct": {
      "type": "numeric"
    },
    "discount_pct": {
      "type": "numeric"
    },
    "notes": {
      "type": "text"
    }
  },
  "work_orders": {
    "id": {
      "type": "uuid"
    },
    "number": {
      "type": "text",
      "required": true
    },
    "customer_id": {
      "type": "uuid",
      "references": [
        "customers",
        "id"
      ]
    },
    "customer_name": {
      "type": "text"
    },
    "title": {
      "type": "text",
      "required": true
    },
    "description": {
      "type": "text"
    },
    "date": {
      "type": "date"
    },
    "status": {
      "type": "text"
    },
    "engineer": {
      "type": "text"
    },
    "start_lat": {
      "type": "numeric"
    },
    "start_lng": {
      "type": "numeric"
    },
    "end_lat": {
      "type": "numeric"
    },
    "end_lng": {
      "type": "numeric"
    },
    "started_at": {
      "type": "timestamptz"
    },
    "finished_at": {
      "type": "timestamptz"
    },
    "client_signature_url": {
      "type": "text"
    },
    "client_accepted_at": {
      "type": "timestamptz"
    },
    "notes": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    },
    "updated_at": {
      "type": "timestamptz"
    },
    "created_by": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "service_name": {
      "type": "text"
    },
    "materials_json": {
      "type": "jsonb"
    },
    "other_cost": {
      "type": "numeric"
    },
    "labor_cost": {
      "type": "numeric"
    },
    "material_cost": {
      "type": "numeric"
    },
    "quote_amount": {
      "type": "numeric"
    },
    "profit": {
      "type": "numeric"
    },
    "before_photo": {
      "type": "text"
    },
    "after_photo": {
      "type": "text"
    },
    "priority": {
      "type": "text"
    },
    "planned_start": {
      "type": "timestamptz"
    },
    "planned_end": {
      "type": "timestamptz"
    },
    "sla_hours": {
      "type": "int"
    },
    "assigned_to_id": {
      "type": "uuid"
    },
    "assigned_to_name": {
      "type": "text"
    },
    "assignment_status": {
      "type": "text"
    },
    "reject_reason": {
      "type": "text"
    },
    "time_logs_json": {
      "type": "jsonb"
    },
    "actual_labor_minutes": {
      "type": "int"
    },
    "video_uri": {
      "type": "text"
    },
    "audio_uri": {
      "type": "text"
    },
    "signature_uri": {
      "type": "text"
    },
    "template_id": {
      "type": "text"
    },
    "source_quote_id": {
      "type": "text"
    },
    "deleted_at": {
      "type": "timestamptz"
    },
    "job_type": {
      "type": "text"
    },
    "before_photos": {
      "type": "jsonb"
    },
    "after_photos": {
      "type": "jsonb"
    },
    "form_photo": {
      "type": "text"
    }
  },
  "work_order_materials": {
    "id": {
      "type": "uuid"
    },
    "work_order_id": {
      "type": "uuid",
      "references": [
        "work_orders",
        "id"
      ]
    },
    "name": {
      "type": "text",
      "required": true
    },
    "quantity": {
      "type": "numeric"
    },
    "unit": {
      "type": "text"
    },
    "unit_price": {
      "type": "numeric"
    },
    "total": {
      "type": "numeric"
    }
  },
  "work_order_photos": {
    "id": {
      "type": "uuid"
    },
    "work_order_id": {
      "type": "uuid",
      "references": [
        "work_orders",
        "id"
      ]
    },
    "url": {
      "type": "text",
      "required": true
    },
    "caption": {
      "type": "text"
    },
    "taken_at": {
      "type": "timestamptz"
    },
    "uploaded_by": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    }
  },
  "employees": {
    "id": {
      "type": "uuid"
    },
    "full_name": {
      "type": "text",
      "required": true
    },
    "role": {
      "type": "text"
    },
    "daily_wage": {
      "type": "numeric"
    },
    "active": {
      "type": "boolean"
    },
    "created_at": {
      "type": "timestamptz"
    },
    "monthly_wage": {
      "type": "numeric"
    },
    "attendance_json": {
      "type": "jsonb"
    },
    "user_id": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    }
  },
  "attendance": {
    "id": {
      "type": "uuid"
    },
    "employee_id": {
      "type": "uuid",
      "references": [
        "employees",
        "id"
      ]
    },
    "date": {
      "type": "date",
      "required": true
    },
    "present": {
      "type": "boolean"
    },
    "notes": {
      "type": "text"
    }
  },
  "expenses": {
    "id": {
      "type": "uuid"
    },
    "date": {
      "type": "date"
    },
    "category": {
      "type": "text",
      "required": true
    },
    "description": {
      "type": "text"
    },
    "amount": {
      "type": "numeric",
      "required": true
    },
    "receipt_url": {
      "type": "text"
    },
    "work_order_id": {
      "type": "uuid",
      "references": [
        "work_orders",
        "id"
      ]
    },
    "created_by": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "locations": {
    "id": {
      "type": "uuid"
    },
    "user_id": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "employee_id": {
      "type": "uuid",
      "references": [
        "employees",
        "id"
      ]
    },
    "lat": {
      "type": "numeric",
      "required": true
    },
    "lng": {
      "type": "numeric",
      "required": true
    },
    "accuracy": {
      "type": "numeric"
    },
    "speed": {
      "type": "numeric"
    },
    "heading": {
      "type": "numeric"
    },
    "is_mock": {
      "type": "boolean"
    },
    "battery": {
      "type": "numeric"
    },
    "recorded_at": {
      "type": "timestamptz"
    }
  },
  "shifts": {
    "id": {
      "type": "uuid"
    },
    "user_id": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "employee_id": {
      "type": "uuid",
      "references": [
        "employees",
        "id"
      ]
    },
    "start_at": {
      "type": "timestamptz"
    },
    "end_at": {
      "type": "timestamptz"
    },
    "start_lat": {
      "type": "numeric"
    },
    "start_lng": {
      "type": "numeric"
    },
    "end_lat": {
      "type": "numeric"
    },
    "end_lng": {
      "type": "numeric"
    },
    "break_minutes": {
      "type": "int"
    },
    "notes": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "geofences": {
    "id": {
      "type": "uuid"
    },
    "name": {
      "type": "text",
      "required": true
    },
    "customer_id": {
      "type": "uuid",
      "references": [
        "customers",
        "id"
      ]
    },
    "center_lat": {
      "type": "numeric",
      "required": true
    },
    "center_lng": {
      "type": "numeric",
      "required": true
    },
    "radius_m": {
      "type": "int"
    },
    "notes": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "geofence_events": {
    "id": {
      "type": "uuid"
    },
    "geofence_id": {
      "type": "uuid",
      "references": [
        "geofences",
        "id"
      ]
    },
    "user_id": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "event": {
      "type": "text",
      "required": true
    },
    "recorded_at": {
      "type": "timestamptz"
    }
  },
  "location_checkins": {
    "id": {
      "type": "uuid"
    },
    "user_id": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "customer_id": {
      "type": "uuid",
      "references": [
        "customers",
        "id"
      ]
    },
    "site_code": {
      "type": "text",
      "required": true
    },
    "method": {
      "type": "text",
      "required": true
    },
    "lat": {
      "type": "numeric"
    },
    "lng": {
      "type": "numeric"
    },
    "work_order_id": {
      "type": "text"
    },
    "recorded_at": {
      "type": "timestamptz"
    }
  },
  "audit_log": {
    "id": {
      "type": "uuid"
    },
    "user_id": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "action": {
      "type": "text",
      "required": true
    },
    "table_name": {
      "type": "text"
    },
    "ref_id": {
      "type": "text"
    },
    "meta": {
      "type": "jsonb"
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "recurring_templates": {
    "id": {
      "type": "text"
    },
    "title": {
      "type": "text",
      "required": true
    },
    "service_name": {
      "type": "text",
      "required": true
    },
    "client": {
      "type": "text",
      "required": true
    },
    "priority": {
      "type": "text"
    },
    "interval_days": {
      "type": "int"
    },
    "next_run_date": {
      "type": "date",
      "required": true
    },
    "default_engineer": {
      "type": "text"
    },
    "active": {
      "type": "boolean"
    },
    "notes": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "quote_revisions": {
    "id": {
      "type": "uuid"
    },
    "quote_id": {
      "type": "uuid",
      "references": [
        "quotes",
        "id"
      ]
    },
    "revision": {
      "type": "int",
      "required": true
    },
    "snapshot": {
      "type": "jsonb",
      "required": true
    },
    "reason": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "customer_sites": {
    "id": {
      "type": "uuid"
    },
    "customer_id": {
      "type": "uuid",
      "references": [
        "customers",
        "id"
      ]
    },
    "name": {
      "type": "text",
      "required": true
    },
    "address": {
      "type": "text"
    },
    "city": {
      "type": "text"
    },
    "lat": {
      "type": "double precision"
    },
    "lng": {
      "type": "double precision"
    },
    "contact_person": {
      "type": "text"
    },
    "contact_phone": {
      "type": "text"
    },
    "notes": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "customer_documents": {
    "id": {
      "type": "uuid"
    },
    "customer_id": {
      "type": "uuid",
      "references": [
        "customers",
        "id"
      ]
    },
    "name": {
      "type": "text",
      "required": true
    },
    "category": {
      "type": "text"
    },
    "uri": {
      "type": "text",
      "required": true
    },
    "storage_path": {
      "type": "text"
    },
    "size_bytes": {
      "type": "int"
    },
    "mime_type": {
      "type": "text"
    },
    "uploaded_at": {
      "type": "timestamptz"
    },
    "uploaded_by": {
      "type": "text"
    },
    "notes": {
      "type": "text"
    }
  },
  "customer_ratings": {
    "id": {
      "type": "uuid"
    },
    "customer_id": {
      "type": "uuid",
      "references": [
        "customers",
        "id"
      ]
    },
    "work_order_id": {
      "type": "text"
    },
    "score": {
      "type": "int",
      "required": true
    },
    "comment": {
      "type": "text"
    },
    "rated_by": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "form_templates": {
    "id": {
      "type": "uuid"
    },
    "name": {
      "type": "text",
      "required": true
    },
    "category": {
      "type": "text"
    },
    "description": {
      "type": "text"
    },
    "fields": {
      "type": "jsonb"
    },
    "is_seed": {
      "type": "boolean"
    },
    "created_at": {
      "type": "timestamptz"
    },
    "updated_at": {
      "type": "timestamptz"
    }
  },
  "form_responses": {
    "id": {
      "type": "uuid"
    },
    "template_id": {
      "type": "uuid",
      "references": [
        "form_templates",
        "id"
      ]
    },
    "template_name": {
      "type": "text",
      "required": true
    },
    "work_order_id": {
      "type": "text"
    },
    "customer_id": {
      "type": "uuid",
      "references": [
        "customers",
        "id"
      ]
    },
    "filled_by": {
      "type": "text"
    },
    "values": {
      "type": "jsonb"
    },
    "revision": {
      "type": "int"
    },
    "created_at": {
      "type": "timestamptz"
    },
    "updated_at": {
      "type": "timestamptz"
    }
  },
  "form_response_revisions": {
    "id": {
      "type": "uuid"
    },
    "response_id": {
      "type": "uuid",
      "references": [
        "form_responses",
        "id"
      ]
    },
    "revision": {
      "type": "int",
      "required": true
    },
    "edited_at": {
      "type": "timestamptz"
    },
    "edited_by": {
      "type": "text"
    },
    "reason": {
      "type": "text"
    },
    "values": {
      "type": "jsonb"
    }
  },
  "warehouses": {
    "id": {
      "type": "uuid"
    },
    "name": {
      "type": "text",
      "required": true
    },
    "kind": {
      "type": "text",
      "required": true
    },
    "responsible_id": {
      "type": "uuid"
    },
    "responsible_name": {
      "type": "text"
    },
    "code": {
      "type": "text"
    },
    "notes": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "materials": {
    "id": {
      "type": "uuid"
    },
    "code": {
      "type": "text",
      "required": true
    },
    "name": {
      "type": "text",
      "required": true
    },
    "unit": {
      "type": "text"
    },
    "price": {
      "type": "numeric"
    },
    "min_stock": {
      "type": "numeric"
    },
    "category": {
      "type": "text"
    },
    "barcode": {
      "type": "text"
    },
    "notes": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "stock_balances": {
    "material_id": {
      "type": "uuid",
      "references": [
        "materials",
        "id"
      ],
      "required": true
    },
    "warehouse_id": {
      "type": "uuid",
      "references": [
        "warehouses",
        "id"
      ],
      "required": true
    },
    "qty": {
      "type": "numeric"
    }
  },
  "stock_movements": {
    "id": {
      "type": "uuid"
    },
    "kind": {
      "type": "text",
      "required": true
    },
    "material_id": {
      "type": "uuid",
      "references": [
        "materials",
        "id"
      ],
      "required": true
    },
    "material_name": {
      "type": "text",
      "required": true
    },
    "material_unit": {
      "type": "text",
      "required": true
    },
    "from_warehouse_id": {
      "type": "uuid",
      "references": [
        "warehouses",
        "id"
      ]
    },
    "to_warehouse_id": {
      "type": "uuid",
      "references": [
        "warehouses",
        "id"
      ]
    },
    "qty": {
      "type": "numeric",
      "required": true
    },
    "unit_price": {
      "type": "numeric"
    },
    "work_order_id": {
      "type": "uuid"
    },
    "user_id": {
      "type": "uuid"
    },
    "user_name": {
      "type": "text"
    },
    "note": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "vehicles": {
    "id": {
      "type": "uuid"
    },
    "plate": {
      "type": "text",
      "required": true
    },
    "brand": {
      "type": "text"
    },
    "model": {
      "type": "text"
    },
    "year": {
      "type": "int"
    },
    "color": {
      "type": "text"
    },
    "driver_id": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "driver_name": {
      "type": "text"
    },
    "km_total": {
      "type": "numeric"
    },
    "fuel_type": {
      "type": "text"
    },
    "inspection_due_at": {
      "type": "date"
    },
    "insurance_due_at": {
      "type": "date"
    },
    "notes": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    },
    "kasko_due_at": {
      "type": "date"
    },
    "last_service_at": {
      "type": "date"
    },
    "last_service_km": {
      "type": "numeric"
    },
    "last_service_note": {
      "type": "text"
    },
    "last_service_cost": {
      "type": "numeric"
    }
  },
  "vehicle_logs": {
    "id": {
      "type": "uuid"
    },
    "vehicle_id": {
      "type": "uuid",
      "references": [
        "vehicles",
        "id"
      ],
      "required": true
    },
    "kind": {
      "type": "text",
      "required": true
    },
    "km": {
      "type": "numeric"
    },
    "liters": {
      "type": "numeric"
    },
    "unit_price": {
      "type": "numeric"
    },
    "total_cost": {
      "type": "numeric"
    },
    "service_type": {
      "type": "text"
    },
    "due_at": {
      "type": "date"
    },
    "note": {
      "type": "text"
    },
    "performed_by": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    },
    "receipt_uri": {
      "type": "text"
    }
  },
  "vehicle_damages": {
    "id": {
      "type": "uuid"
    },
    "vehicle_id": {
      "type": "uuid",
      "references": [
        "vehicles",
        "id"
      ],
      "required": true
    },
    "description": {
      "type": "text",
      "required": true
    },
    "severity": {
      "type": "text",
      "required": true
    },
    "status": {
      "type": "text"
    },
    "photos": {
      "type": "jsonb"
    },
    "km_at": {
      "type": "numeric"
    },
    "reported_by": {
      "type": "text"
    },
    "reported_at": {
      "type": "timestamptz"
    },
    "repaired_at": {
      "type": "timestamptz"
    },
    "repair_cost": {
      "type": "numeric"
    },
    "notes": {
      "type": "text"
    }
  },
  "vehicle_route_points": {
    "id": {
      "type": "uuid"
    },
    "vehicle_id": {
      "type": "uuid",
      "references": [
        "vehicles",
        "id"
      ],
      "required": true
    },
    "lat": {
      "type": "numeric",
      "required": true
    },
    "lng": {
      "type": "numeric",
      "required": true
    },
    "speed": {
      "type": "numeric"
    },
    "recorded_at": {
      "type": "timestamptz"
    },
    "work_order_id": {
      "type": "uuid",
      "references": [
        "work_orders",
        "id"
      ]
    },
    "user_id": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "user_name": {
      "type": "text"
    }
  },
  "notifications": {
    "id": {
      "type": "uuid"
    },
    "user_id": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "type": {
      "type": "text",
      "required": true
    },
    "title": {
      "type": "text",
      "required": true
    },
    "message": {
      "type": "text",
      "required": true
    },
    "channels": {
      "type": "text[]"
    },
    "related_id": {
      "type": "text"
    },
    "recipient": {
      "type": "text"
    },
    "read": {
      "type": "boolean"
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "notification_preferences": {
    "user_id": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "channel_enabled": {
      "type": "jsonb"
    },
    "event_channels": {
      "type": "jsonb"
    },
    "push_token": {
      "type": "text"
    },
    "email": {
      "type": "text"
    },
    "phone": {
      "type": "text"
    },
    "whatsapp": {
      "type": "text"
    },
    "quiet_hours_start": {
      "type": "text"
    },
    "quiet_hours_end": {
      "type": "text"
    },
    "updated_at": {
      "type": "timestamptz"
    }
  },
  "push_tokens": {
    "id": {
      "type": "uuid"
    },
    "user_id": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "token": {
      "type": "text",
      "required": true
    },
    "platform": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    },
    "last_seen_at": {
      "type": "timestamptz"
    }
  },
  "payments": {
    "id": {
      "type": "uuid"
    },
    "customer_id": {
      "type": "uuid",
      "references": [
        "customers",
        "id"
      ]
    },
    "customer_name": {
      "type": "text",
      "required": true
    },
    "work_order_id": {
      "type": "uuid",
      "references": [
        "work_orders",
        "id"
      ]
    },
    "quote_id": {
      "type": "uuid",
      "references": [
        "quotes",
        "id"
      ]
    },
    "amount": {
      "type": "numeric",
      "required": true
    },
    "currency": {
      "type": "text"
    },
    "method": {
      "type": "text",
      "required": true
    },
    "status": {
      "type": "text"
    },
    "received_at": {
      "type": "timestamptz"
    },
    "received_by": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "received_by_name": {
      "type": "text"
    },
    "receipt_no": {
      "type": "text"
    },
    "vat_rate": {
      "type": "numeric"
    },
    "note": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "cash_entries": {
    "id": {
      "type": "uuid"
    },
    "employee_id": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "employee_name": {
      "type": "text",
      "required": true
    },
    "kind": {
      "type": "text",
      "required": true
    },
    "amount": {
      "type": "numeric",
      "required": true
    },
    "date": {
      "type": "timestamptz"
    },
    "payment_id": {
      "type": "uuid",
      "references": [
        "payments",
        "id"
      ]
    },
    "work_order_id": {
      "type": "uuid",
      "references": [
        "work_orders",
        "id"
      ]
    },
    "note": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "einvoice_config": {
    "user_id": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "provider": {
      "type": "text",
      "required": true
    },
    "enabled": {
      "type": "boolean"
    },
    "test_mode": {
      "type": "boolean"
    },
    "api_url": {
      "type": "text"
    },
    "username": {
      "type": "text"
    },
    "vkn_tckn": {
      "type": "text"
    },
    "company_title": {
      "type": "text"
    },
    "prefix": {
      "type": "text"
    },
    "updated_at": {
      "type": "timestamptz"
    }
  },
  "einvoice_records": {
    "id": {
      "type": "uuid"
    },
    "payment_id": {
      "type": "uuid",
      "references": [
        "payments",
        "id"
      ]
    },
    "work_order_id": {
      "type": "uuid",
      "references": [
        "work_orders",
        "id"
      ]
    },
    "customer_id": {
      "type": "uuid",
      "references": [
        "customers",
        "id"
      ]
    },
    "customer_name": {
      "type": "text",
      "required": true
    },
    "customer_vkn": {
      "type": "text"
    },
    "total": {
      "type": "numeric",
      "required": true
    },
    "vat": {
      "type": "numeric"
    },
    "status": {
      "type": "text"
    },
    "external_id": {
      "type": "text"
    },
    "error_message": {
      "type": "text"
    },
    "pdf_uri": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    },
    "sent_at": {
      "type": "timestamptz"
    }
  },
  "assets": {
    "id": {
      "type": "uuid"
    },
    "code": {
      "type": "text"
    },
    "name": {
      "type": "text",
      "required": true
    },
    "type": {
      "type": "text",
      "required": true
    },
    "customer_id": {
      "type": "uuid",
      "references": [
        "customers",
        "id"
      ]
    },
    "site_id": {
      "type": "uuid",
      "references": [
        "customer_sites",
        "id"
      ]
    },
    "serial_no": {
      "type": "text"
    },
    "manufacturer": {
      "type": "text"
    },
    "model": {
      "type": "text"
    },
    "power": {
      "type": "text"
    },
    "install_date": {
      "type": "date"
    },
    "warranty_end": {
      "type": "date"
    },
    "location": {
      "type": "text"
    },
    "notes": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "energy_readings": {
    "id": {
      "type": "uuid"
    },
    "kind": {
      "type": "text",
      "required": true
    },
    "asset_id": {
      "type": "uuid",
      "references": [
        "assets",
        "id"
      ]
    },
    "customer_id": {
      "type": "uuid",
      "references": [
        "customers",
        "id"
      ]
    },
    "work_order_id": {
      "type": "uuid",
      "references": [
        "work_orders",
        "id"
      ]
    },
    "date": {
      "type": "timestamptz"
    },
    "inspector_id": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "meter_active_kwh": {
      "type": "numeric"
    },
    "meter_reactive_kvarh": {
      "type": "numeric"
    },
    "meter_demand_kw": {
      "type": "numeric"
    },
    "panel_voltage_l1": {
      "type": "numeric"
    },
    "panel_voltage_l2": {
      "type": "numeric"
    },
    "panel_voltage_l3": {
      "type": "numeric"
    },
    "panel_current_l1": {
      "type": "numeric"
    },
    "panel_current_l2": {
      "type": "numeric"
    },
    "panel_current_l3": {
      "type": "numeric"
    },
    "panel_power_factor": {
      "type": "numeric"
    },
    "panel_temp_c": {
      "type": "numeric"
    },
    "trafo_oil_temp_c": {
      "type": "numeric"
    },
    "trafo_winding_temp_c": {
      "type": "numeric"
    },
    "trafo_oil_level": {
      "type": "text"
    },
    "trafo_silica_gel": {
      "type": "text"
    },
    "trafo_buchholz_ok": {
      "type": "boolean"
    },
    "trafo_grounding_ok": {
      "type": "boolean"
    },
    "ges_dc_voltage": {
      "type": "numeric"
    },
    "ges_ac_voltage": {
      "type": "numeric"
    },
    "ges_power_kw": {
      "type": "numeric"
    },
    "ges_energy_total_kwh": {
      "type": "numeric"
    },
    "ges_irradiance": {
      "type": "numeric"
    },
    "ges_panel_temp_c": {
      "type": "numeric"
    },
    "notes": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "maintenance_plans": {
    "id": {
      "type": "uuid"
    },
    "name": {
      "type": "text",
      "required": true
    },
    "kind": {
      "type": "text",
      "required": true
    },
    "asset_id": {
      "type": "uuid",
      "references": [
        "assets",
        "id"
      ]
    },
    "customer_id": {
      "type": "uuid",
      "references": [
        "customers",
        "id"
      ]
    },
    "frequency_days": {
      "type": "int",
      "required": true
    },
    "last_done_at": {
      "type": "timestamptz"
    },
    "next_due_at": {
      "type": "timestamptz",
      "required": true
    },
    "assigned_to": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "active": {
      "type": "boolean"
    },
    "notes": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "inspections": {
    "id": {
      "type": "uuid"
    },
    "type": {
      "type": "text",
      "required": true
    },
    "title": {
      "type": "text",
      "required": true
    },
    "asset_id": {
      "type": "uuid",
      "references": [
        "assets",
        "id"
      ]
    },
    "customer_id": {
      "type": "uuid",
      "references": [
        "customers",
        "id"
      ]
    },
    "work_order_id": {
      "type": "uuid",
      "references": [
        "work_orders",
        "id"
      ]
    },
    "inspector_id": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "date": {
      "type": "timestamptz"
    },
    "items": {
      "type": "jsonb"
    },
    "score": {
      "type": "int"
    },
    "status": {
      "type": "text"
    },
    "notes": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "nonconformities": {
    "id": {
      "type": "uuid"
    },
    "inspection_id": {
      "type": "uuid",
      "references": [
        "inspections",
        "id"
      ]
    },
    "asset_id": {
      "type": "uuid",
      "references": [
        "assets",
        "id"
      ]
    },
    "customer_id": {
      "type": "uuid",
      "references": [
        "customers",
        "id"
      ]
    },
    "description": {
      "type": "text",
      "required": true
    },
    "severity": {
      "type": "text",
      "required": true
    },
    "status": {
      "type": "text"
    },
    "assigned_to": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "due_date": {
      "type": "date"
    },
    "corrective_action": {
      "type": "text"
    },
    "root_cause": {
      "type": "text"
    },
    "closed_at": {
      "type": "timestamptz"
    },
    "closed_by": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "sales_visits": {
    "id": {
      "type": "uuid"
    },
    "customer_id": {
      "type": "uuid",
      "references": [
        "customers",
        "id"
      ],
      "required": true
    },
    "visit_date": {
      "type": "timestamptz"
    },
    "salesperson_id": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "purpose": {
      "type": "text"
    },
    "summary": {
      "type": "text"
    },
    "next_step": {
      "type": "text"
    },
    "next_step_date": {
      "type": "date"
    },
    "outcome": {
      "type": "text",
      "required": true
    },
    "estimated_amount": {
      "type": "numeric"
    },
    "competitor": {
      "type": "jsonb"
    },
    "photos": {
      "type": "text[]"
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "voice_reports": {
    "id": {
      "type": "uuid"
    },
    "transcript": {
      "type": "text",
      "required": true
    },
    "summary": {
      "type": "text"
    },
    "action_items": {
      "type": "jsonb"
    },
    "customer_id": {
      "type": "uuid",
      "references": [
        "customers",
        "id"
      ]
    },
    "work_order_id": {
      "type": "uuid",
      "references": [
        "work_orders",
        "id"
      ]
    },
    "created_by": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "api_keys": {
    "id": {
      "type": "text"
    },
    "label": {
      "type": "text",
      "required": true
    },
    "key": {
      "type": "text",
      "required": true
    },
    "scopes": {
      "type": "text[]",
      "required": true
    },
    "active": {
      "type": "boolean"
    },
    "created_at": {
      "type": "timestamptz"
    },
    "last_used_at": {
      "type": "timestamptz"
    },
    "expires_at": {
      "type": "timestamptz"
    }
  },
  "webhooks": {
    "id": {
      "type": "text"
    },
    "label": {
      "type": "text",
      "required": true
    },
    "url": {
      "type": "text",
      "required": true
    },
    "events": {
      "type": "text[]",
      "required": true
    },
    "secret": {
      "type": "text"
    },
    "active": {
      "type": "boolean"
    },
    "created_at": {
      "type": "timestamptz"
    },
    "last_delivery_at": {
      "type": "timestamptz"
    },
    "last_status": {
      "type": "text"
    },
    "last_error": {
      "type": "text"
    }
  },
  "import_history": {
    "id": {
      "type": "bigserial"
    },
    "type": {
      "type": "text",
      "required": true
    },
    "rows_total": {
      "type": "int",
      "required": true
    },
    "rows_imported": {
      "type": "int",
      "required": true
    },
    "rows_skipped": {
      "type": "int",
      "required": true
    },
    "errors": {
      "type": "jsonb"
    },
    "imported_at": {
      "type": "timestamptz"
    }
  },
  "erp_adapters": {
    "id": {
      "type": "text"
    },
    "provider": {
      "type": "text",
      "required": true
    },
    "label": {
      "type": "text",
      "required": true
    },
    "base_url": {
      "type": "text"
    },
    "api_key": {
      "type": "text"
    },
    "username": {
      "type": "text"
    },
    "active": {
      "type": "boolean"
    },
    "sync_customers": {
      "type": "boolean"
    },
    "sync_invoices": {
      "type": "boolean"
    },
    "sync_products": {
      "type": "boolean"
    },
    "created_at": {
      "type": "timestamptz"
    },
    "last_sync_at": {
      "type": "timestamptz"
    },
    "last_sync_status": {
      "type": "text"
    }
  },
  "email_schedules": {
    "id": {
      "type": "uuid"
    },
    "name": {
      "type": "text",
      "required": true
    },
    "kind": {
      "type": "text",
      "required": true
    },
    "report_type": {
      "type": "text"
    },
    "recipients": {
      "type": "text[]"
    },
    "role_filter": {
      "type": "text[]"
    },
    "subject_template": {
      "type": "text"
    },
    "body_template": {
      "type": "text"
    },
    "hour_utc": {
      "type": "int"
    },
    "day_of_week": {
      "type": "int"
    },
    "day_of_month": {
      "type": "int"
    },
    "month_of_year": {
      "type": "int"
    },
    "active": {
      "type": "boolean"
    },
    "last_run_at": {
      "type": "timestamptz"
    },
    "last_status": {
      "type": "text"
    },
    "last_error": {
      "type": "text"
    },
    "next_run_at": {
      "type": "timestamptz"
    },
    "created_by": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "created_at": {
      "type": "timestamptz"
    },
    "updated_at": {
      "type": "timestamptz"
    }
  },
  "email_dispatch_log": {
    "id": {
      "type": "uuid"
    },
    "schedule_id": {
      "type": "uuid",
      "references": [
        "email_schedules",
        "id"
      ]
    },
    "recipients": {
      "type": "text[]",
      "required": true
    },
    "subject": {
      "type": "text"
    },
    "status": {
      "type": "text",
      "required": true
    },
    "error": {
      "type": "text"
    },
    "sent_at": {
      "type": "timestamptz"
    }
  },
  "app_settings": {
    "key": {
      "type": "text"
    },
    "value": {
      "type": "jsonb",
      "required": true
    },
    "updated_at": {
      "type": "timestamptz"
    },
    "updated_by": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    }
  },
  "inbox_messages": {
    "id": {
      "type": "uuid"
    },
    "source": {
      "type": "text",
      "required": true
    },
    "external_id": {
      "type": "text"
    },
    "sender": {
      "type": "text"
    },
    "subject": {
      "type": "text"
    },
    "body": {
      "type": "text"
    },
    "received_at": {
      "type": "timestamptz"
    },
    "processed": {
      "type": "boolean"
    },
    "processed_at": {
      "type": "timestamptz"
    },
    "user_id": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "metadata": {
      "type": "jsonb"
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "ai_ingest_queue": {
    "id": {
      "type": "bigserial"
    },
    "entity_type": {
      "type": "text",
      "required": true
    },
    "entity_id": {
      "type": "text",
      "required": true
    },
    "op": {
      "type": "text",
      "required": true
    },
    "payload": {
      "type": "jsonb"
    },
    "attempts": {
      "type": "int"
    },
    "last_error": {
      "type": "text"
    },
    "enqueued_at": {
      "type": "timestamptz"
    },
    "processed_at": {
      "type": "timestamptz"
    }
  },
  "ai_chat_sessions": {
    "id": {
      "type": "uuid"
    },
    "user_id": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "title": {
      "type": "text"
    },
    "pinned": {
      "type": "boolean"
    },
    "message_count": {
      "type": "int"
    },
    "last_message_at": {
      "type": "timestamptz"
    },
    "created_at": {
      "type": "timestamptz"
    },
    "updated_at": {
      "type": "timestamptz"
    }
  },
  "ai_chat_messages": {
    "id": {
      "type": "bigserial"
    },
    "session_id": {
      "type": "uuid",
      "references": [
        "ai_chat_sessions",
        "id"
      ],
      "required": true
    },
    "role": {
      "type": "text",
      "required": true
    },
    "content": {
      "type": "text",
      "required": true
    },
    "meta": {
      "type": "jsonb"
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "payroll_records": {
    "id": {
      "type": "uuid"
    },
    "employee_id": {
      "type": "uuid",
      "references": [
        "employees",
        "id"
      ],
      "required": true
    },
    "period": {
      "type": "text",
      "required": true
    },
    "gross": {
      "type": "numeric"
    },
    "deductions": {
      "type": "numeric"
    },
    "advances": {
      "type": "numeric"
    },
    "net": {
      "type": "numeric"
    },
    "status": {
      "type": "text"
    },
    "paid_at": {
      "type": "timestamptz"
    },
    "notes": {
      "type": "text"
    },
    "created_by": {
      "type": "uuid"
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "leave_requests": {
    "id": {
      "type": "uuid"
    },
    "employee_id": {
      "type": "uuid",
      "references": [
        "employees",
        "id"
      ],
      "required": true
    },
    "start_date": {
      "type": "date",
      "required": true
    },
    "end_date": {
      "type": "date",
      "required": true
    },
    "leave_type": {
      "type": "text"
    },
    "reason": {
      "type": "text"
    },
    "status": {
      "type": "text"
    },
    "approved_by": {
      "type": "uuid"
    },
    "decided_at": {
      "type": "timestamptz"
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "conversations": {
    "id": {
      "type": "uuid"
    },
    "title": {
      "type": "text"
    },
    "is_group": {
      "type": "boolean"
    },
    "created_by": {
      "type": "uuid"
    },
    "created_at": {
      "type": "timestamptz"
    },
    "last_message_at": {
      "type": "timestamptz"
    }
  },
  "conversation_participants": {
    "conversation_id": {
      "type": "uuid",
      "references": [
        "conversations",
        "id"
      ],
      "required": true
    },
    "user_id": {
      "type": "uuid",
      "required": true
    },
    "added_at": {
      "type": "timestamptz"
    },
    "last_read_at": {
      "type": "timestamptz"
    }
  },
  "messages": {
    "id": {
      "type": "uuid"
    },
    "conversation_id": {
      "type": "uuid",
      "references": [
        "conversations",
        "id"
      ],
      "required": true
    },
    "sender_id": {
      "type": "uuid"
    },
    "body": {
      "type": "text"
    },
    "attachment_url": {
      "type": "text"
    },
    "attachment_type": {
      "type": "text"
    },
    "attachment_name": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    },
    "deleted_at": {
      "type": "timestamptz"
    }
  },
  "catalog_overrides": {
    "product_id": {
      "type": "text"
    },
    "price": {
      "type": "numeric"
    },
    "deleted": {
      "type": "boolean"
    },
    "updated_by": {
      "type": "uuid"
    },
    "updated_at": {
      "type": "timestamptz"
    },
    "name": {
      "type": "text"
    }
  },
  "catalog_custom_products": {
    "id": {
      "type": "text"
    },
    "name": {
      "type": "text",
      "required": true
    },
    "price": {
      "type": "numeric"
    },
    "category": {
      "type": "text"
    },
    "brand": {
      "type": "text"
    },
    "code": {
      "type": "text"
    },
    "unit": {
      "type": "text"
    },
    "deleted": {
      "type": "boolean"
    },
    "created_by": {
      "type": "uuid"
    },
    "created_at": {
      "type": "timestamptz"
    }
  },
  "approvals": {
    "id": {
      "type": "uuid"
    },
    "kind": {
      "type": "text",
      "required": true
    },
    "title": {
      "type": "text",
      "required": true
    },
    "description": {
      "type": "text"
    },
    "requested_by": {
      "type": "uuid"
    },
    "requested_by_name": {
      "type": "text"
    },
    "resource": {
      "type": "text"
    },
    "resource_id": {
      "type": "text"
    },
    "payload": {
      "type": "jsonb"
    },
    "status": {
      "type": "text"
    },
    "decided_by": {
      "type": "uuid"
    },
    "decided_by_name": {
      "type": "text"
    },
    "decision_note": {
      "type": "text"
    },
    "required_approvals": {
      "type": "int"
    },
    "created_at": {
      "type": "timestamptz"
    },
    "decided_at": {
      "type": "timestamptz"
    }
  },
  "office_pages": {
    "id": {
      "type": "uuid"
    },
    "parent_id": {
      "type": "uuid",
      "references": [
        "office_pages",
        "id"
      ]
    },
    "title": {
      "type": "text"
    },
    "icon": {
      "type": "text"
    },
    "blocks": {
      "type": "jsonb"
    },
    "is_favorite": {
      "type": "boolean"
    },
    "archived": {
      "type": "boolean"
    },
    "order_index": {
      "type": "bigint"
    },
    "created_by": {
      "type": "uuid"
    },
    "created_by_name": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    },
    "updated_at": {
      "type": "timestamptz"
    }
  },
  "office_boards": {
    "id": {
      "type": "uuid"
    },
    "title": {
      "type": "text"
    },
    "icon": {
      "type": "text"
    },
    "description": {
      "type": "text"
    },
    "columns": {
      "type": "jsonb"
    },
    "archived": {
      "type": "boolean"
    },
    "created_by": {
      "type": "uuid"
    },
    "created_by_name": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    },
    "updated_at": {
      "type": "timestamptz"
    }
  },
  "office_meetings": {
    "id": {
      "type": "uuid"
    },
    "title": {
      "type": "text"
    },
    "date": {
      "type": "date"
    },
    "time": {
      "type": "text"
    },
    "attendees": {
      "type": "jsonb"
    },
    "notes": {
      "type": "text"
    },
    "action_items": {
      "type": "jsonb"
    },
    "created_by": {
      "type": "uuid"
    },
    "created_by_name": {
      "type": "text"
    },
    "created_at": {
      "type": "timestamptz"
    },
    "updated_at": {
      "type": "timestamptz"
    }
  },
  "bordro_aylik": {
    "id": {
      "type": "uuid"
    },
    "employee_id": {
      "type": "uuid",
      "references": [
        "employees",
        "id"
      ]
    },
    "period": {
      "type": "text",
      "required": true
    },
    "full_name": {
      "type": "text"
    },
    "national_id": {
      "type": "text"
    },
    "agreed_net": {
      "type": "numeric"
    },
    "worked_days": {
      "type": "numeric"
    },
    "overtime_hours": {
      "type": "numeric"
    },
    "sunday_holiday_days": {
      "type": "numeric"
    },
    "absent_days": {
      "type": "numeric"
    },
    "advance": {
      "type": "numeric"
    },
    "expense": {
      "type": "numeric"
    },
    "bonus": {
      "type": "numeric"
    },
    "official_salary": {
      "type": "numeric"
    },
    "extra_payment": {
      "type": "numeric"
    },
    "status": {
      "type": "text"
    },
    "created_by": {
      "type": "uuid"
    },
    "created_at": {
      "type": "timestamptz"
    },
    "updated_at": {
      "type": "timestamptz"
    }
  },
  "app_usage": {
    "user_id": {
      "type": "uuid",
      "required": true
    },
    "date": {
      "type": "date"
    },
    "user_name": {
      "type": "text"
    },
    "screen_views": {
      "type": "integer"
    },
    "actions": {
      "type": "integer"
    },
    "sessions": {
      "type": "integer"
    },
    "last_active": {
      "type": "timestamptz"
    }
  },
  "latest_locations": {
    "id": {
      "type": "uuid"
    },
    "user_id": {
      "type": "uuid",
      "references": [
        "profiles",
        "id"
      ]
    },
    "employee_id": {
      "type": "uuid",
      "references": [
        "employees",
        "id"
      ]
    },
    "lat": {
      "type": "numeric",
      "required": true
    },
    "lng": {
      "type": "numeric",
      "required": true
    },
    "accuracy": {
      "type": "numeric"
    },
    "speed": {
      "type": "numeric"
    },
    "heading": {
      "type": "numeric"
    },
    "is_mock": {
      "type": "boolean"
    },
    "battery": {
      "type": "numeric"
    },
    "recorded_at": {
      "type": "timestamptz"
    }
  }
}
SCHEMA, true, 64, JSON_THROW_ON_ERROR);
 return $schema;
}
