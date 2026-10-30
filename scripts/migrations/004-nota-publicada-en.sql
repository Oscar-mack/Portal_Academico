-- 004: columna de publicación de notas requerida por el modelo Nota.
-- Se ejecuta después de 002 y 003. Es idempotente y no modifica filas existentes:
-- las notas actuales quedan con publicadaEn = NULL (no visibles para alumnos ni padres)
-- hasta que un usuario autorizado las publique explícitamente.
BEGIN;

ALTER TABLE "nota" ADD COLUMN IF NOT EXISTS "publicadaEn" TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS "nota_publicadaEn_idx" ON "nota" ("publicadaEn");

COMMIT;
