-- Migration 006. Course sections/offers enable controlled student self-enrollment.
-- Legacy assignments and schedules remain valid with ofertaCursoId = NULL.
BEGIN;

CREATE TABLE "ofertas_curso" (
  "id" SERIAL PRIMARY KEY,
  "cursoId" INTEGER NOT NULL REFERENCES "cursos"("id") ON DELETE RESTRICT,
  "catedraticoId" INTEGER NOT NULL REFERENCES "catedraticos"("id") ON DELETE RESTRICT,
  "periodoAcademicoId" INTEGER NOT NULL REFERENCES "periodos_academicos"("id") ON DELETE RESTRICT,
  "codigoSeccion" VARCHAR(30) NOT NULL,
  "cupoMaximo" INTEGER NOT NULL CHECK ("cupoMaximo" > 0),
  "fechaInscripcionInicio" DATE NOT NULL,
  "fechaInscripcionFin" DATE NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ("fechaInscripcionInicio" <= "fechaInscripcionFin"),
  UNIQUE ("cursoId", "periodoAcademicoId", "codigoSeccion")
);
CREATE INDEX "ofertas_curso_periodo_activo_idx"
  ON "ofertas_curso" ("periodoAcademicoId", "activo");

ALTER TABLE "asignacion_cursos"
  ADD COLUMN "ofertaCursoId" INTEGER NULL
  REFERENCES "ofertas_curso"("id") ON DELETE RESTRICT;
CREATE INDEX "asignacion_cursos_ofertaCursoId_idx"
  ON "asignacion_cursos" ("ofertaCursoId");

ALTER TABLE "horario_catedraticos"
  ADD COLUMN "ofertaCursoId" INTEGER NULL
  REFERENCES "ofertas_curso"("id") ON DELETE RESTRICT;
CREATE INDEX "horario_catedraticos_ofertaCursoId_idx"
  ON "horario_catedraticos" ("ofertaCursoId");

CREATE FUNCTION "validar_contexto_oferta_horario"() RETURNS TRIGGER AS $$
DECLARE oferta RECORD;
BEGIN
  IF NEW."ofertaCursoId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO oferta FROM "ofertas_curso"
  WHERE "id" = NEW."ofertaCursoId";
  IF NOT FOUND
    OR oferta."cursoId" <> NEW."cursoId"
    OR oferta."catedraticoId" <> NEW."catedraticoId"
    OR oferta."periodoAcademicoId" <> NEW."periodoAcademicoId" THEN
    RAISE EXCEPTION 'El horario no coincide con la sección seleccionada'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "horarios_validar_oferta_biu"
  BEFORE INSERT OR UPDATE OF "cursoId", "catedraticoId", "periodoAcademicoId", "ofertaCursoId"
  ON "horario_catedraticos" FOR EACH ROW EXECUTE FUNCTION "validar_contexto_oferta_horario"();

CREATE FUNCTION "validar_inscripcion_oferta"() RETURNS TRIGGER AS $$
DECLARE
  oferta RECORD;
  inscritos INTEGER;
BEGIN
  IF NEW."ofertaCursoId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO oferta FROM "ofertas_curso"
  WHERE "id" = NEW."ofertaCursoId" FOR UPDATE;
  IF NOT FOUND
    OR oferta."cursoId" <> NEW."cursoId"
    OR oferta."periodoAcademicoId" <> NEW."periodoAcademicoId" THEN
    RAISE EXCEPTION 'La inscripción no coincide con la sección seleccionada'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT oferta."activo"
    OR CURRENT_DATE < oferta."fechaInscripcionInicio"
    OR CURRENT_DATE > oferta."fechaInscripcionFin" THEN
    RAISE EXCEPTION 'La sección no está abierta para inscripción'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "periodos_academicos"
    WHERE "id" = oferta."periodoAcademicoId" AND "estado" = 'abierto'
  ) THEN
    RAISE EXCEPTION 'El período académico de la sección está cerrado'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO inscritos FROM "asignacion_cursos"
  WHERE "ofertaCursoId" = NEW."ofertaCursoId"
    AND ("id" IS DISTINCT FROM NEW."id");
  IF inscritos >= oferta."cupoMaximo" THEN
    RAISE EXCEPTION 'La sección ya no tiene cupos disponibles'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "asignaciones_validar_oferta_biu"
  BEFORE INSERT OR UPDATE OF "cursoId", "periodoAcademicoId", "ofertaCursoId"
  ON "asignacion_cursos" FOR EACH ROW EXECUTE FUNCTION "validar_inscripcion_oferta"();

COMMIT;
