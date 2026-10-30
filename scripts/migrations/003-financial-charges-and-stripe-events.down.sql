-- Rollback for migration 003. Reverses schema only when no new finance data exists.
-- Converting numeric payments back to DOUBLE PRECISION is not lossless.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "pagos" WHERE "estado" = 'fallido')
    OR EXISTS (SELECT 1 FROM "pagos" WHERE "cargoId" IS NOT NULL)
    OR EXISTS (SELECT 1 FROM "cargos")
    OR EXISTS (SELECT 1 FROM "eventos_stripe")
    OR EXISTS (SELECT 1 FROM "requisitos_solvencia_documentos") THEN
    RAISE EXCEPTION 'Rollback blocked: finance data or failed payments exist; export and reconcile before rollback';
  END IF;
END $$;

DROP TRIGGER "cargos_no_delete_con_historial_bd" ON "cargos";
DROP FUNCTION "cargo_no_eliminar_con_historial"();
DROP TRIGGER "cargos_proteger_pagos_bu" ON "cargos";
DROP FUNCTION "proteger_cargo_con_pagos"();
DROP TRIGGER "pagos_validar_cargo_biu" ON "pagos";
DROP FUNCTION "validar_pago_cargo"();
DROP TABLE "requisitos_solvencia_documentos";
DROP TABLE "eventos_stripe";
DROP INDEX "pagos_un_checkout_pendiente_por_cargo";
DROP INDEX "pagos_stripePaymentIntentId_unique";
DROP INDEX "pagos_stripeSessionId_unique";
DROP INDEX "pagos_cargo_estado_idx";
DROP INDEX "cargos_alumno_vencimiento_idx";
ALTER TABLE "pagos" DROP CONSTRAINT "pagos_cargoId_fkey";
ALTER TABLE "pagos" DROP COLUMN "metodoPago";
ALTER TABLE "pagos" DROP COLUMN "stripePaymentIntentId";
ALTER TABLE "pagos" DROP COLUMN "cargoId";
ALTER TABLE "pagos" DROP CONSTRAINT "pagos_monto_positivo_check";
ALTER TABLE "pagos" DROP CONSTRAINT "pagos_estado_check";
ALTER TABLE "pagos" ALTER COLUMN "estado" TYPE "enum_pagos_estado" USING "estado"::"enum_pagos_estado";
ALTER TABLE "pagos" ALTER COLUMN "monto" TYPE DOUBLE PRECISION USING "monto"::double precision;
DROP TABLE "cargos";
COMMIT;
