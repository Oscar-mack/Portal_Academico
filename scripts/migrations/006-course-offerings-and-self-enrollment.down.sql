-- Reversión de 006. No elimina secciones ni asociaciones de inscripción/horario.
-- Debe ejecutarse antes de revertir las migraciones académicas anteriores.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ofertas_curso")
    OR EXISTS (SELECT 1 FROM "asignacion_cursos" WHERE "ofertaCursoId" IS NOT NULL)
    OR EXISTS (SELECT 1 FROM "horario_catedraticos" WHERE "ofertaCursoId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Reversión bloqueada: existen ofertas, inscripciones o horarios asociados a secciones'
      USING ERRCODE = '23514';
  END IF;
END $$;

DROP TRIGGER IF EXISTS "asignaciones_validar_oferta_biu" ON "asignacion_cursos";
DROP TRIGGER IF EXISTS "horarios_validar_oferta_biu" ON "horario_catedraticos";
ALTER TABLE "asignacion_cursos" DROP COLUMN IF EXISTS "ofertaCursoId";
ALTER TABLE "horario_catedraticos" DROP COLUMN IF EXISTS "ofertaCursoId";
DROP TABLE IF EXISTS "ofertas_curso";
DROP FUNCTION IF EXISTS "validar_inscripcion_oferta"();
DROP FUNCTION IF EXISTS "validar_contexto_oferta_horario"();

COMMIT;
