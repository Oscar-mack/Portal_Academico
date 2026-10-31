-- Rollback for migration 007. Blocked while annulled payments exist so no accounting history is lost.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "pagos" WHERE "estado" = 'anulado' OR "anuladoEn" IS NOT NULL) THEN
    RAISE EXCEPTION 'Rollback blocked: annulled payments exist; export and reconcile before rollback';
  END IF;
END $$;
ALTER TABLE "pagos" DROP CONSTRAINT "pagos_anulacion_coherente_check";
ALTER TABLE "pagos" DROP COLUMN "stripeRefundId";
ALTER TABLE "pagos" DROP COLUMN "motivoAnulacion";
ALTER TABLE "pagos" DROP COLUMN "anuladoPorId";
ALTER TABLE "pagos" DROP COLUMN "anuladoEn";
ALTER TABLE "pagos" DROP CONSTRAINT "pagos_estado_check";
ALTER TABLE "pagos"
  ADD CONSTRAINT "pagos_estado_check"
  CHECK ("estado" IN ('pendiente', 'pagado', 'fallido', 'cancelado'));
COMMIT;
