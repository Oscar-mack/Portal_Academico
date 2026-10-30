-- Reversión de 004. Se bloquea si existe alguna nota publicada para no perder
-- el registro de publicación. Debe ejecutarse antes que 003.down y 002.down.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "nota" WHERE "publicadaEn" IS NOT NULL) THEN
    RAISE EXCEPTION 'Reversión bloqueada: existen notas publicadas (publicadaEn no nulo)'
      USING ERRCODE = '23514';
  END IF;
END $$;

DROP INDEX IF EXISTS "nota_publicadaEn_idx";
ALTER TABLE "nota" DROP COLUMN IF EXISTS "publicadaEn";

COMMIT;
