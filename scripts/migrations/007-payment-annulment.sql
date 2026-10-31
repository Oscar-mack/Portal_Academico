-- Migration 007: anulación contable de pagos (nunca se eliminan).
-- Debe aplicarse ANTES de desplegar el código que lee las columnas nuevas de "pagos".
-- Es aditiva: no modifica ni elimina filas existentes.
BEGIN;

ALTER TABLE "pagos" DROP CONSTRAINT "pagos_estado_check";
ALTER TABLE "pagos"
  ADD CONSTRAINT "pagos_estado_check"
  CHECK ("estado" IN ('pendiente', 'pagado', 'fallido', 'cancelado', 'anulado'));

ALTER TABLE "pagos" ADD COLUMN "anuladoEn" TIMESTAMPTZ NULL;
ALTER TABLE "pagos" ADD COLUMN "anuladoPorId" INTEGER NULL REFERENCES "usuarios"("id") ON DELETE RESTRICT;
ALTER TABLE "pagos" ADD COLUMN "motivoAnulacion" TEXT NULL;
ALTER TABLE "pagos" ADD COLUMN "stripeRefundId" VARCHAR(255) NULL;

ALTER TABLE "pagos"
  ADD CONSTRAINT "pagos_anulacion_coherente_check"
  CHECK (
    ("estado" = 'anulado' AND "anuladoEn" IS NOT NULL AND "motivoAnulacion" IS NOT NULL)
    OR "estado" <> 'anulado'
  );

COMMIT;
