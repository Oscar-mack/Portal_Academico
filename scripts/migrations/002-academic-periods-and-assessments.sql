-- PostgreSQL migration 002. Additive only; historical `periodo` values remain untouched.
BEGIN;

CREATE TABLE "ciclos_academicos" (
  "id" SERIAL PRIMARY KEY,
  "nombre" VARCHAR(80) NOT NULL UNIQUE,
  "fechaInicio" DATE NOT NULL,
  "fechaFin" DATE NOT NULL,
  "estado" VARCHAR(12) NOT NULL DEFAULT 'abierto'
    CHECK ("estado" IN ('abierto', 'cerrado')),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ("fechaInicio" <= "fechaFin")
);

CREATE TABLE "periodos_academicos" (
  "id" SERIAL PRIMARY KEY,
  "cicloAcademicoId" INTEGER NOT NULL
    REFERENCES "ciclos_academicos"("id") ON DELETE RESTRICT,
  "nombre" VARCHAR(80) NOT NULL,
  "tipo" VARCHAR(12) NOT NULL
    CHECK ("tipo" IN ('bimestre', 'trimestre', 'semestre')),
  "fechaInicio" DATE NOT NULL,
  "fechaFin" DATE NOT NULL,
  "estado" VARCHAR(12) NOT NULL DEFAULT 'abierto'
    CHECK ("estado" IN ('abierto', 'cerrado')),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ("fechaInicio" <= "fechaFin"),
  UNIQUE ("cicloAcademicoId", "nombre")
);

ALTER TABLE "asignacion_cursos"
  ADD COLUMN "periodoAcademicoId" INTEGER NULL
  REFERENCES "periodos_academicos"("id") ON DELETE RESTRICT;
ALTER TABLE "horario_catedraticos"
  ADD COLUMN "periodoAcademicoId" INTEGER NULL
  REFERENCES "periodos_academicos"("id") ON DELETE RESTRICT;
ALTER TABLE "nota"
  ADD COLUMN "periodoAcademicoId" INTEGER NULL
  REFERENCES "periodos_academicos"("id") ON DELETE RESTRICT;

CREATE INDEX "asignacion_cursos_periodoAcademicoId_idx"
  ON "asignacion_cursos" ("periodoAcademicoId");
CREATE INDEX "horario_catedraticos_periodoAcademicoId_idx"
  ON "horario_catedraticos" ("periodoAcademicoId");
CREATE UNIQUE INDEX "nota_periodoAcademico_unique"
  ON "nota" ("alumnoId", "cursoId", "periodoAcademicoId")
  WHERE "periodoAcademicoId" IS NOT NULL;

CREATE TABLE "evaluaciones" (
  "id" SERIAL PRIMARY KEY,
  "cursoId" INTEGER NOT NULL REFERENCES "cursos"("id") ON DELETE RESTRICT,
  "catedraticoId" INTEGER NOT NULL REFERENCES "catedraticos"("id") ON DELETE RESTRICT,
  "periodoAcademicoId" INTEGER NOT NULL
    REFERENCES "periodos_academicos"("id") ON DELETE RESTRICT,
  "nombre" VARCHAR(120) NOT NULL,
  "puntajeMaximo" NUMERIC(5,2) NOT NULL
    CHECK ("puntajeMaximo" > 0 AND "puntajeMaximo" <= 100),
  "activo" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("cursoId", "periodoAcademicoId", "nombre")
);

CREATE TABLE "calificaciones_evaluacion" (
  "id" SERIAL PRIMARY KEY,
  "evaluacionId" INTEGER NOT NULL REFERENCES "evaluaciones"("id") ON DELETE RESTRICT,
  "alumnoId" INTEGER NOT NULL REFERENCES "alumnos"("id") ON DELETE RESTRICT,
  "valor" NUMERIC(5,2) NOT NULL CHECK ("valor" >= 0),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("evaluacionId", "alumnoId")
);

CREATE TABLE "auditoria_notas" (
  "id" SERIAL PRIMARY KEY,
  "notaId" INTEGER NOT NULL REFERENCES "nota"("id") ON DELETE RESTRICT,
  "usuarioId" INTEGER NOT NULL REFERENCES "usuarios"("id") ON DELETE RESTRICT,
  "valorAnterior" NUMERIC(5,2),
  "valorNuevo" NUMERIC(5,2) NOT NULL,
  "motivo" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "auditoria_notas_notaId_createdAt_idx"
  ON "auditoria_notas" ("notaId", "createdAt");

CREATE FUNCTION "validar_maximo_evaluaciones"() RETURNS TRIGGER AS $$
DECLARE
  "sumaExistente" NUMERIC(7,2);
BEGIN
  IF NOT NEW."activo" THEN
    IF EXISTS (
      SELECT 1 FROM "calificaciones_evaluacion"
      WHERE "evaluacionId" = NEW."id"
    ) THEN
      RAISE EXCEPTION 'No se puede desactivar una evaluación con calificaciones registradas'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM 1 FROM "cursos" WHERE "id" = NEW."cursoId" FOR UPDATE;
  SELECT COALESCE(SUM("puntajeMaximo"), 0)
    INTO "sumaExistente"
    FROM "evaluaciones"
    WHERE "cursoId" = NEW."cursoId"
      AND "periodoAcademicoId" = NEW."periodoAcademicoId"
      AND "activo" = TRUE
      AND ("id" IS DISTINCT FROM NEW."id");
  IF "sumaExistente" + NEW."puntajeMaximo" > 100 THEN
    RAISE EXCEPTION 'La suma de puntajes máximos por curso y período no puede superar 100'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "evaluaciones_maximo_biu"
  BEFORE INSERT OR UPDATE OF "cursoId", "periodoAcademicoId", "puntajeMaximo", "activo"
  ON "evaluaciones"
  FOR EACH ROW EXECUTE FUNCTION "validar_maximo_evaluaciones"();

CREATE FUNCTION "validar_puntaje_calificacion"() RETURNS TRIGGER AS $$
DECLARE
  "puntaje_maximo" NUMERIC(5,2);
  "curso_id" INTEGER;
  "periodo_academico_id" INTEGER;
BEGIN
  SELECT e."puntajeMaximo", e."cursoId", e."periodoAcademicoId"
    INTO "puntaje_maximo", "curso_id", "periodo_academico_id"
    FROM "evaluaciones" AS e
    WHERE e."id" = NEW."evaluacionId"
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La evaluación no existe' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW."valor" > "puntaje_maximo" THEN
    RAISE EXCEPTION 'La calificación no puede superar el puntaje máximo de la evaluación'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "asignacion_cursos" AS ac
    WHERE ac."alumnoId" = NEW."alumnoId"
      AND ac."cursoId" = "curso_id"
      AND ac."periodoAcademicoId" = "periodo_academico_id"
  ) THEN
    RAISE EXCEPTION 'El alumno no está inscrito en el curso y período de la evaluación'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "calificaciones_evaluacion_validar_biu"
  BEFORE INSERT OR UPDATE OF "evaluacionId", "alumnoId", "valor"
  ON "calificaciones_evaluacion"
  FOR EACH ROW EXECUTE FUNCTION "validar_puntaje_calificacion"();

CREATE FUNCTION "validar_cambio_maximo_evaluacion"() RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "calificaciones_evaluacion"
    WHERE "evaluacionId" = OLD."id" AND "valor" > NEW."puntajeMaximo"
  ) THEN
    RAISE EXCEPTION 'No se puede reducir el máximo por debajo de una calificación existente'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "evaluaciones_maximo_calificaciones_bu"
  BEFORE UPDATE OF "puntajeMaximo" ON "evaluaciones"
  FOR EACH ROW EXECUTE FUNCTION "validar_cambio_maximo_evaluacion"();

CREATE FUNCTION "auditoria_notas_inmutable"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'El historial de notas es inmutable'
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "auditoria_notas_inmutable_bud"
  BEFORE UPDATE OR DELETE ON "auditoria_notas"
  FOR EACH ROW EXECUTE FUNCTION "auditoria_notas_inmutable"();

COMMIT;
