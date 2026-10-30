-- PostgreSQL migration 003. Review the preflight query below before running.
-- It rejects amounts that are not representable in cents; no payment is rounded silently.
-- Preflight:
-- SELECT "id", "monto"
-- FROM "pagos"
-- WHERE ABS("monto"::numeric - ROUND("monto"::numeric, 2)) > 0.000001;
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "pagos"
    WHERE "monto" IS NULL OR "monto" <= 0
      OR ABS("monto"::numeric - ROUND("monto"::numeric, 2)) > 0.000001
  ) THEN
    RAISE EXCEPTION 'Migration 003 blocked: inspect invalid or sub-cent payment amounts before converting pagos.monto';
  END IF;
END $$;

ALTER TABLE "pagos"
  ALTER COLUMN "monto" TYPE NUMERIC(12,2)
  USING ROUND("monto"::numeric, 2);
ALTER TABLE "pagos"
  ALTER COLUMN "estado" TYPE VARCHAR(16)
  USING "estado"::text;
ALTER TABLE "pagos"
  ADD CONSTRAINT "pagos_estado_check"
  CHECK ("estado" IN ('pendiente', 'pagado', 'fallido', 'cancelado'));
ALTER TABLE "pagos"
  ADD CONSTRAINT "pagos_monto_positivo_check" CHECK ("monto" > 0);
ALTER TABLE "pagos"
  ADD COLUMN "cargoId" INTEGER NULL;
ALTER TABLE "pagos"
  ADD COLUMN "stripePaymentIntentId" VARCHAR(255) NULL;
ALTER TABLE "pagos"
  ADD COLUMN "metodoPago" VARCHAR(40) NOT NULL DEFAULT 'stripe';

CREATE TABLE "cargos" (
  "id" SERIAL PRIMARY KEY,
  "alumnoId" INTEGER NOT NULL REFERENCES "alumnos"("id") ON DELETE RESTRICT,
  "concepto" VARCHAR(160) NOT NULL,
  "descripcion" TEXT,
  "montoOriginal" NUMERIC(12,2) NOT NULL CHECK ("montoOriginal" > 0),
  "moneda" VARCHAR(3) NOT NULL DEFAULT 'GTQ' CHECK ("moneda" IN ('GTQ', 'USD')),
  "fechaEmision" DATE NOT NULL DEFAULT CURRENT_DATE,
  "fechaVencimiento" DATE,
  "cicloAcademicoId" INTEGER REFERENCES "ciclos_academicos"("id") ON DELETE RESTRICT,
  "periodoAcademicoId" INTEGER REFERENCES "periodos_academicos"("id") ON DELETE RESTRICT,
  "anuladoEn" TIMESTAMPTZ,
  "anuladoPorId" INTEGER REFERENCES "usuarios"("id") ON DELETE RESTRICT,
  "motivoAnulacion" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ("fechaVencimiento" IS NULL OR "fechaVencimiento" >= "fechaEmision"),
  CHECK (("anuladoEn" IS NULL AND "motivoAnulacion" IS NULL) OR
         ("anuladoEn" IS NOT NULL AND "anuladoPorId" IS NOT NULL AND "motivoAnulacion" IS NOT NULL))
);

-- Payments are attached after cargos exist; this statement is intentionally placed here.
ALTER TABLE "pagos"
  ADD CONSTRAINT "pagos_cargoId_fkey"
  FOREIGN KEY ("cargoId") REFERENCES "cargos"("id") ON DELETE RESTRICT;

CREATE INDEX "cargos_alumno_vencimiento_idx"
  ON "cargos" ("alumnoId", "fechaVencimiento");
CREATE INDEX "pagos_cargo_estado_idx"
  ON "pagos" ("cargoId", "estado");
CREATE UNIQUE INDEX "pagos_stripeSessionId_unique"
  ON "pagos" ("stripeSessionId") WHERE "stripeSessionId" IS NOT NULL;
CREATE UNIQUE INDEX "pagos_stripePaymentIntentId_unique"
  ON "pagos" ("stripePaymentIntentId") WHERE "stripePaymentIntentId" IS NOT NULL;
CREATE UNIQUE INDEX "pagos_un_checkout_pendiente_por_cargo"
  ON "pagos" ("cargoId") WHERE "cargoId" IS NOT NULL AND "estado" = 'pendiente';

CREATE TABLE "eventos_stripe" (
  "id" SERIAL PRIMARY KEY,
  "stripeEventId" VARCHAR(255) NOT NULL UNIQUE,
  "tipo" VARCHAR(120) NOT NULL,
  "pagoId" INTEGER REFERENCES "pagos"("id") ON DELETE RESTRICT,
  "procesadoEn" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "requisitos_solvencia_documentos" (
  "id" SERIAL PRIMARY KEY,
  "tipoDocumento" VARCHAR(80) NOT NULL UNIQUE,
  "requiere_solvencia" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE FUNCTION "validar_pago_cargo"() RETURNS TRIGGER AS $$
DECLARE
  "cargoAlumnoId" INTEGER;
  "cargoMoneda" VARCHAR(3);
  "cargoMonto" NUMERIC(12,2);
  "cargoAnuladoEn" TIMESTAMPTZ;
  "pagadoExistente" NUMERIC(12,2);
BEGIN
  IF NEW."cargoId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "alumnoId", "moneda", "montoOriginal", "anuladoEn"
    INTO "cargoAlumnoId", "cargoMoneda", "cargoMonto", "cargoAnuladoEn"
    FROM "cargos" WHERE "id" = NEW."cargoId" FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El cargo relacionado no existe' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW."alumnoId" <> "cargoAlumnoId" OR LOWER(NEW."moneda") <> LOWER("cargoMoneda") THEN
    RAISE EXCEPTION 'El alumno y moneda del pago deben coincidir con el cargo'
      USING ERRCODE = 'check_violation';
  END IF;
  IF "cargoAnuladoEn" IS NOT NULL AND NEW."estado" IN ('pendiente', 'pagado') THEN
    RAISE EXCEPTION 'No se permiten pagos pendientes o confirmados en un cargo anulado'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."estado" IN ('pendiente', 'pagado') THEN
    SELECT COALESCE(SUM("monto"), 0) INTO "pagadoExistente"
      FROM "pagos"
      WHERE "cargoId" = NEW."cargoId" AND "estado" IN ('pendiente', 'pagado')
        AND ("id" IS DISTINCT FROM NEW."id");
    IF "pagadoExistente" + NEW."monto" > "cargoMonto" THEN
      RAISE EXCEPTION 'El pago supera el saldo pendiente del cargo'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "pagos_validar_cargo_biu"
  BEFORE INSERT OR UPDATE OF "cargoId", "alumnoId", "moneda", "monto", "estado"
  ON "pagos"
  FOR EACH ROW EXECUTE FUNCTION "validar_pago_cargo"();

CREATE FUNCTION "proteger_cargo_con_pagos"() RETURNS TRIGGER AS $$
BEGIN
  IF (
    NEW."alumnoId" IS DISTINCT FROM OLD."alumnoId"
    OR NEW."moneda" IS DISTINCT FROM OLD."moneda"
    OR NEW."montoOriginal" IS DISTINCT FROM OLD."montoOriginal"
  ) AND EXISTS (
    SELECT 1 FROM "pagos"
    WHERE "cargoId" = OLD."id" AND "estado" IN ('pendiente', 'pagado')
  ) THEN
    RAISE EXCEPTION 'No se puede cambiar alumno, moneda o monto de un cargo con pagos pendientes o confirmados'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."anuladoEn" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "pagos"
    WHERE "cargoId" = OLD."id" AND "estado" IN ('pendiente', 'pagado')
  ) THEN
    RAISE EXCEPTION 'No se puede anular un cargo con pagos pendientes o confirmados'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "cargos_proteger_pagos_bu"
  BEFORE UPDATE OF "alumnoId", "moneda", "montoOriginal", "anuladoEn"
  ON "cargos"
  FOR EACH ROW EXECUTE FUNCTION "proteger_cargo_con_pagos"();

CREATE FUNCTION "cargo_no_eliminar_con_historial"() RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "pagos" WHERE "cargoId" = OLD."id") THEN
    RAISE EXCEPTION 'No se puede eliminar un cargo con historial de pagos'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "cargos_no_delete_con_historial_bd"
  BEFORE DELETE ON "cargos"
  FOR EACH ROW EXECUTE FUNCTION "cargo_no_eliminar_con_historial"();

COMMIT;
