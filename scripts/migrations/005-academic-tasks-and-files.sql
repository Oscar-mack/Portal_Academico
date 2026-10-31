-- Migration 005. Additive only; do not run against production without review and approval.
BEGIN;

CREATE TABLE "tareas" (
  "id" SERIAL PRIMARY KEY,
  "cursoId" INTEGER NOT NULL REFERENCES "cursos"("id") ON DELETE RESTRICT,
  "catedraticoId" INTEGER NOT NULL REFERENCES "catedraticos"("id") ON DELETE RESTRICT,
  "periodoAcademicoId" INTEGER NOT NULL REFERENCES "periodos_academicos"("id") ON DELETE RESTRICT,
  "titulo" VARCHAR(150) NOT NULL,
  "descripcion" TEXT NOT NULL,
  "instrucciones" TEXT NOT NULL,
  "fechaPublicacion" TIMESTAMPTZ NOT NULL,
  "fechaLimite" TIMESTAMPTZ NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (length(trim("titulo")) > 0),
  CHECK ("fechaLimite" > "fechaPublicacion")
);
CREATE INDEX "tareas_curso_periodo_publicacion_idx"
  ON "tareas" ("cursoId", "periodoAcademicoId", "activo", "fechaPublicacion");
CREATE INDEX "tareas_catedratico_periodo_idx"
  ON "tareas" ("catedraticoId", "periodoAcademicoId");

CREATE TABLE "archivos_academicos" (
  "id" SERIAL PRIMARY KEY,
  "storageKey" VARCHAR(500) NOT NULL UNIQUE,
  "nombreOriginal" VARCHAR(255) NOT NULL,
  "mimeType" VARCHAR(120) NOT NULL,
  "sizeBytes" INTEGER NOT NULL CHECK ("sizeBytes" BETWEEN 1 AND 20971520),
  "sha256" CHAR(64) NOT NULL,
  "subidoPorUsuarioId" INTEGER NOT NULL REFERENCES "usuarios"("id") ON DELETE RESTRICT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "adjuntos_tarea" (
  "id" SERIAL PRIMARY KEY,
  "tareaId" INTEGER NOT NULL REFERENCES "tareas"("id") ON DELETE RESTRICT,
  "archivoId" INTEGER NOT NULL UNIQUE REFERENCES "archivos_academicos"("id") ON DELETE RESTRICT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("tareaId", "archivoId")
);

CREATE TABLE "materiales_curso" (
  "id" SERIAL PRIMARY KEY,
  "cursoId" INTEGER NOT NULL REFERENCES "cursos"("id") ON DELETE RESTRICT,
  "catedraticoId" INTEGER NOT NULL REFERENCES "catedraticos"("id") ON DELETE RESTRICT,
  "periodoAcademicoId" INTEGER NOT NULL REFERENCES "periodos_academicos"("id") ON DELETE RESTRICT,
  "archivoId" INTEGER NOT NULL UNIQUE REFERENCES "archivos_academicos"("id") ON DELETE RESTRICT,
  "titulo" VARCHAR(150) NOT NULL,
  "descripcion" TEXT NOT NULL DEFAULT '',
  "activo" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (length(trim("titulo")) > 0)
);
CREATE INDEX "materiales_curso_periodo_activo_idx"
  ON "materiales_curso" ("cursoId", "periodoAcademicoId", "activo");

CREATE TABLE "entregas_tarea" (
  "id" SERIAL PRIMARY KEY,
  "tareaId" INTEGER NOT NULL REFERENCES "tareas"("id") ON DELETE RESTRICT,
  "alumnoId" INTEGER NOT NULL REFERENCES "alumnos"("id") ON DELETE RESTRICT,
  "archivoId" INTEGER NOT NULL UNIQUE REFERENCES "archivos_academicos"("id") ON DELETE RESTRICT,
  "entregadaEn" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "entregas_tarea_tarea_alumno_fecha_idx"
  ON "entregas_tarea" ("tareaId", "alumnoId", "entregadaEn");

CREATE TABLE "auditoria_tareas" (
  "id" SERIAL PRIMARY KEY,
  "tareaId" INTEGER REFERENCES "tareas"("id") ON DELETE RESTRICT,
  "archivoId" INTEGER REFERENCES "archivos_academicos"("id") ON DELETE RESTRICT,
  "usuarioId" INTEGER NOT NULL REFERENCES "usuarios"("id") ON DELETE RESTRICT,
  "accion" VARCHAR(40) NOT NULL,
  "detalle" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "auditoria_tareas_tarea_fecha_idx"
  ON "auditoria_tareas" ("tareaId", "createdAt");

CREATE FUNCTION "validar_contexto_tarea"() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "horario_catedraticos"
    WHERE "catedraticoId" = NEW."catedraticoId"
      AND "cursoId" = NEW."cursoId"
      AND "periodoAcademicoId" = NEW."periodoAcademicoId"
  ) THEN
    RAISE EXCEPTION 'El docente no tiene asignado el curso y período de la tarea'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "periodos_academicos"
    WHERE "id" = NEW."periodoAcademicoId" AND "estado" = 'abierto'
  ) THEN
    RAISE EXCEPTION 'El período de la tarea debe estar abierto'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "tareas_validar_contexto_biu"
  BEFORE INSERT OR UPDATE OF "cursoId", "catedraticoId", "periodoAcademicoId"
  ON "tareas" FOR EACH ROW EXECUTE FUNCTION "validar_contexto_tarea"();

CREATE FUNCTION "validar_entrega_tarea"() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "tareas" t
    JOIN "asignacion_cursos" ac
      ON ac."cursoId" = t."cursoId"
      AND ac."periodoAcademicoId" = t."periodoAcademicoId"
      AND ac."alumnoId" = NEW."alumnoId"
    WHERE t."id" = NEW."tareaId"
      AND t."activo" = TRUE
      AND t."fechaPublicacion" <= NEW."entregadaEn"
      AND t."fechaLimite" >= NEW."entregadaEn"
      AND EXISTS (
        SELECT 1 FROM "periodos_academicos" p
        WHERE p."id" = t."periodoAcademicoId" AND p."estado" = 'abierto'
      )
  ) THEN
    RAISE EXCEPTION 'El alumno no puede entregar esta tarea o el plazo venció'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "entregas_tarea_validar_bi"
  BEFORE INSERT ON "entregas_tarea"
  FOR EACH ROW EXECUTE FUNCTION "validar_entrega_tarea"();

CREATE FUNCTION "auditoria_tareas_inmutable"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'La auditoría académica es inmutable'
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "auditoria_tareas_inmutable_bud"
  BEFORE UPDATE OR DELETE ON "auditoria_tareas"
  FOR EACH ROW EXECUTE FUNCTION "auditoria_tareas_inmutable"();

COMMIT;
