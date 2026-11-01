-- Rollback for migration 008: restaura las restricciones UNIQUE uq_asignacion_curso y uq_padre_alumno.
-- No modifica datos. Aborta si existen duplicados o si los nombres ya están ocupados.
-- Solo es necesario si se requiere recuperar exactamente el estado previo; el modelo ya garantiza la unicidad.
BEGIN;

SET LOCAL lock_timeout = '10s';

DO $$
BEGIN
  IF to_regclass('public.asignacion_cursos') IS NULL OR to_regclass('public.padre_alumnos') IS NULL THEN
    RAISE EXCEPTION 'Rollback 008 blocked: faltan las tablas asignacion_cursos o padre_alumnos';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN ('uq_asignacion_curso', 'uq_padre_alumno')) THEN
    RAISE EXCEPTION 'Rollback 008 blocked: ya existe un objeto llamado uq_asignacion_curso o uq_padre_alumno';
  END IF;

  -- UNIQUE trata los NULL como distintos: solo cuentan como duplicados las filas sin NULL en ninguna columna de la clave.
  IF EXISTS (
    SELECT 1 FROM "asignacion_cursos"
    WHERE "alumnoId" IS NOT NULL AND "cursoId" IS NOT NULL AND "periodo" IS NOT NULL
    GROUP BY "alumnoId", "cursoId", "periodo" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Rollback 008 blocked: hay registros duplicados en asignacion_cursos (alumnoId, cursoId, periodo); reconciliar antes de restaurar';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "padre_alumnos"
    WHERE "usuarioId" IS NOT NULL AND "alumnoId" IS NOT NULL
    GROUP BY "usuarioId", "alumnoId" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Rollback 008 blocked: hay registros duplicados en padre_alumnos (usuarioId, alumnoId); reconciliar antes de restaurar';
  END IF;
END $$;

ALTER TABLE "asignacion_cursos"
  ADD CONSTRAINT "uq_asignacion_curso" UNIQUE ("alumnoId", "cursoId", "periodo");
ALTER TABLE "padre_alumnos"
  ADD CONSTRAINT "uq_padre_alumno" UNIQUE ("usuarioId", "alumnoId");

COMMIT;
