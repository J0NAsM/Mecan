-- Diagnóstico visual 3D por pieza, datos del presupuesto del servicio y modelo 3D local del vehículo.
-- Solo agrega columnas opcionales y tablas nuevas: no modifica ni reinterpreta datos existentes.
-- Identificadores entre comillas para que readiness y el importador legado reconozcan cada adición.

ALTER TABLE "customers" ADD COLUMN "tax_id" TEXT;
ALTER TABLE "vehicles" ADD COLUMN "body_type" TEXT;
ALTER TABLE "vehicles" ADD COLUMN "model_3d_id" TEXT;
ALTER TABLE "vehicles" ADD COLUMN "notes" TEXT;
ALTER TABLE "estimates" ADD COLUMN "payment_terms" TEXT;
ALTER TABLE "estimates" ADD COLUMN "work_time_value" NUMERIC;
ALTER TABLE "estimates" ADD COLUMN "work_time_unit" TEXT;
ALTER TABLE "estimate_items" ADD COLUMN "vehicle_part" TEXT;
ALTER TABLE "estimate_items" ADD COLUMN "responsible_user_id" TEXT;
ALTER TABLE "estimate_items" ADD COLUMN "damage_part_id" TEXT;

ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_body_type_valid" CHECK (body_type IS NULL OR body_type IN ('HATCHBACK','COUPE','CONVERTIBLE','CROSSOVER','SUV','WAGON','MINIVAN','VAN'));
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_model_3d_id_format" CHECK (model_3d_id IS NULL OR model_3d_id ~ '^[a-z0-9][a-z0-9_.-]{0,119}$');
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_work_time_valid" CHECK ((work_time_value IS NULL AND work_time_unit IS NULL) OR (work_time_value > 0 AND work_time_value NOT IN ('NaN'::numeric,'Infinity'::numeric) AND work_time_unit IN ('HOURS','DAYS')));
ALTER TABLE "estimate_items" ADD CONSTRAINT "estimate_items_vehicle_part_valid" CHECK (vehicle_part IS NULL OR vehicle_part IN ('hood','roof','trunk','door_front_left','door_front_right','door_rear_left','door_rear_right','fender_front_left','fender_front_right','fender_rear_left','fender_rear_right','bumper_front','bumper_rear'));
ALTER TABLE "estimate_items" ADD CONSTRAINT "fk_estimate_items_responsible_user_id" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

CREATE TABLE "damage_assessments" (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, work_order_id TEXT NOT NULL, vehicle_id TEXT NOT NULL,
  body_type TEXT NOT NULL, paint_color TEXT NOT NULL, notes TEXT, revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
);

ALTER TABLE "damage_assessments" ADD CONSTRAINT "tenant_identity_damage_assessments" UNIQUE(tenant_id,id);
ALTER TABLE "damage_assessments" ADD CONSTRAINT "damage_assessments_one_per_order" UNIQUE(tenant_id,work_order_id);
ALTER TABLE "damage_assessments" ADD CONSTRAINT "damage_assessments_body_type_valid" CHECK (body_type IN ('HATCHBACK','COUPE','CONVERTIBLE','CROSSOVER','SUV','WAGON','MINIVAN','VAN'));
ALTER TABLE "damage_assessments" ADD CONSTRAINT "damage_assessments_paint_color_valid" CHECK (paint_color ~ '^#[0-9a-f]{6}$');
ALTER TABLE "damage_assessments" ADD CONSTRAINT "damage_assessments_revision_positive" CHECK (revision > 0);
ALTER TABLE "damage_assessments" ADD CONSTRAINT "damage_assessments_notes_length" CHECK (notes IS NULL OR length(notes) <= 5000);
ALTER TABLE "damage_assessments" ADD CONSTRAINT "fk_damage_assessments_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "damage_assessments" ADD CONSTRAINT "tenant_fk_damage_assessments_work_order_id" FOREIGN KEY (tenant_id,"work_order_id") REFERENCES "work_orders"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "damage_assessments" ADD CONSTRAINT "tenant_fk_damage_assessments_vehicle_id" FOREIGN KEY (tenant_id,"vehicle_id") REFERENCES "vehicles"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "damage_assessments" ADD CONSTRAINT "fk_damage_assessments_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "damage_assessments" ADD CONSTRAINT "fk_damage_assessments_updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX damage_assessments_vehicle ON "damage_assessments"(tenant_id,vehicle_id,updated_at DESC);

CREATE TABLE "damage_assessment_parts" (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, assessment_id TEXT NOT NULL, part_code TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'NONE', pressure INTEGER NOT NULL DEFAULT 0,
  affected_zone TEXT, description TEXT, notes TEXT, materials TEXT,
  repair_cost NUMERIC NOT NULL DEFAULT 0, labor_cost NUMERIC NOT NULL DEFAULT 0,
  paint_strokes TEXT NOT NULL DEFAULT '[]', diagnosed_by TEXT, diagnosed_at TEXT
);

ALTER TABLE "damage_assessment_parts" ADD CONSTRAINT "tenant_identity_damage_assessment_parts" UNIQUE(tenant_id,id);
ALTER TABLE "damage_assessment_parts" ADD CONSTRAINT "damage_parts_one_per_code" UNIQUE(assessment_id,part_code);
ALTER TABLE "damage_assessment_parts" ADD CONSTRAINT "damage_parts_code_valid" CHECK (part_code IN ('hood','roof','trunk','door_front_left','door_front_right','door_rear_left','door_rear_right','fender_front_left','fender_front_right','fender_rear_left','fender_rear_right','bumper_front','bumper_rear'));
ALTER TABLE "damage_assessment_parts" ADD CONSTRAINT "damage_parts_severity_valid" CHECK (severity IN ('NONE','LIGHT','MODERATE','SEVERE','CRITICAL'));
ALTER TABLE "damage_assessment_parts" ADD CONSTRAINT "damage_parts_pressure_range" CHECK (pressure >= 0 AND pressure <= 100);
ALTER TABLE "damage_assessment_parts" ADD CONSTRAINT "damage_parts_costs_valid" CHECK (repair_cost >= 0 AND labor_cost >= 0 AND repair_cost NOT IN ('NaN'::numeric,'Infinity'::numeric) AND labor_cost NOT IN ('NaN'::numeric,'Infinity'::numeric));
ALTER TABLE "damage_assessment_parts" ADD CONSTRAINT "damage_parts_text_length" CHECK (length(coalesce(affected_zone,'')) <= 500 AND length(coalesce(description,'')) <= 3000 AND length(coalesce(notes,'')) <= 3000 AND length(coalesce(materials,'')) <= 2000);
ALTER TABLE "damage_assessment_parts" ADD CONSTRAINT "damage_parts_strokes_bounded" CHECK (length(paint_strokes) <= 400000);
ALTER TABLE "damage_assessment_parts" ADD CONSTRAINT "fk_damage_assessment_parts_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "damage_assessment_parts" ADD CONSTRAINT "tenant_fk_damage_assessment_parts_assessment_id" FOREIGN KEY (tenant_id,"assessment_id") REFERENCES "damage_assessments"(tenant_id,"id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "damage_assessment_parts" ADD CONSTRAINT "fk_damage_assessment_parts_diagnosed_by" FOREIGN KEY ("diagnosed_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "estimate_items" ADD CONSTRAINT "tenant_fk_estimate_items_damage_part_id" FOREIGN KEY (tenant_id,"damage_part_id") REFERENCES "damage_assessment_parts"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX estimate_items_damage_part ON "estimate_items"(tenant_id,damage_part_id) WHERE damage_part_id IS NOT NULL;

-- El diagnóstico pertenece a la orden y al vehículo de esa orden; quien lo registra es miembro del taller.
CREATE FUNCTION "guard_damage_assessment_owner"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM work_orders o WHERE o.id=NEW.work_order_id AND o.tenant_id=NEW.tenant_id AND o.vehicle_id=NEW.vehicle_id)
    OR (TG_OP='UPDATE' AND (NEW.work_order_id IS DISTINCT FROM OLD.work_order_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at))
    OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.created_by AND ((u.kind='PLATFORM' AND u.platform_role='SUPER_ADMIN') OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.tenant_id=NEW.tenant_id)))
    OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.updated_by AND ((u.kind='PLATFORM' AND u.platform_role='SUPER_ADMIN') OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.tenant_id=NEW.tenant_id))) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='damage_assessment_owner';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "damage_assessment_owner_insert" BEFORE INSERT ON "damage_assessments" FOR EACH ROW EXECUTE FUNCTION "guard_damage_assessment_owner"();
CREATE TRIGGER "damage_assessment_owner_update" BEFORE UPDATE ON "damage_assessments" FOR EACH ROW EXECUTE FUNCTION "guard_damage_assessment_owner"();

CREATE FUNCTION "guard_damage_part_owner"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (TG_OP='UPDATE' AND (NEW.assessment_id IS DISTINCT FROM OLD.assessment_id OR NEW.part_code IS DISTINCT FROM OLD.part_code))
    OR (NEW.diagnosed_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.diagnosed_by AND ((u.kind='PLATFORM' AND u.platform_role='SUPER_ADMIN') OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.tenant_id=NEW.tenant_id)))) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='damage_part_owner';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "damage_part_owner_insert" BEFORE INSERT ON "damage_assessment_parts" FOR EACH ROW EXECUTE FUNCTION "guard_damage_part_owner"();
CREATE TRIGGER "damage_part_owner_update" BEFORE UPDATE ON "damage_assessment_parts" FOR EACH ROW EXECUTE FUNCTION "guard_damage_part_owner"();

-- Un concepto solo puede referirse al diagnóstico de su propia orden y a un responsable del taller.
CREATE FUNCTION "guard_estimate_item_diagnosis_links"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW.responsible_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=NEW.responsible_user_id AND m.tenant_id=NEW.tenant_id))
    OR (NEW.damage_part_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM damage_assessment_parts p JOIN damage_assessments a ON a.id=p.assessment_id AND a.tenant_id=p.tenant_id
      JOIN estimates e ON e.work_order_id=a.work_order_id AND e.tenant_id=a.tenant_id
      WHERE p.id=NEW.damage_part_id AND p.tenant_id=NEW.tenant_id AND e.id=NEW.estimate_id AND (NEW.vehicle_part IS NULL OR NEW.vehicle_part=p.part_code))) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='estimate_item_diagnosis_links';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "estimate_item_diagnosis_links_insert" BEFORE INSERT ON "estimate_items" FOR EACH ROW EXECUTE FUNCTION "guard_estimate_item_diagnosis_links"();
CREATE TRIGGER "estimate_item_diagnosis_links_update" BEFORE UPDATE ON "estimate_items" FOR EACH ROW EXECUTE FUNCTION "guard_estimate_item_diagnosis_links"();

CREATE FUNCTION "guard_damage_tenant_immutable"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_damage';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_damage_assessments" BEFORE UPDATE OF tenant_id ON "damage_assessments" FOR EACH ROW EXECUTE FUNCTION "guard_damage_tenant_immutable"();
CREATE TRIGGER "immutable_tenant_damage_assessment_parts" BEFORE UPDATE OF tenant_id ON "damage_assessment_parts" FOR EACH ROW EXECUTE FUNCTION "guard_damage_tenant_immutable"();
