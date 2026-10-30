-- Rollback for migration 002. Refuses to drop academic history after it is used.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "calificaciones_evaluacion")
    OR EXISTS (SELECT 1 FROM "evaluaciones")
    OR EXISTS (SELECT 1 FROM "auditoria_notas")
    OR EXISTS (SELECT 1 FROM "periodos_academicos")
    OR EXISTS (SELECT 1 FROM "ciclos_academicos")
    OR EXISTS (SELECT 1 FROM "nota" WHERE "periodoAcademicoId" IS NOT NULL)
    OR EXISTS (SELECT 1 FROM "asignacion_cursos" WHERE "periodoAcademicoId" IS NOT NULL)
    OR EXISTS (SELECT 1 FROM "horario_catedraticos" WHERE "periodoAcademicoId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Rollback bloqueado: existen datos académicos nuevos que deben preservarse';
  END IF;
END $$;

DROP TRIGGER "auditoria_notas_inmutable_bud" ON "auditoria_notas";
DROP FUNCTION "auditoria_notas_inmutable"();
DROP TRIGGER "evaluaciones_maximo_calificaciones_bu" ON "evaluaciones";
DROP FUNCTION "validar_cambio_maximo_evaluacion"();
DROP TRIGGER "calificaciones_evaluacion_validar_biu" ON "calificaciones_evaluacion";
DROP FUNCTION "validar_puntaje_calificacion"();
DROP TRIGGER "evaluaciones_maximo_biu" ON "evaluaciones";
DROP FUNCTION "validar_maximo_evaluaciones"();
DROP TABLE "auditoria_notas";
DROP TABLE "calificaciones_evaluacion";
DROP TABLE "evaluaciones";
DROP INDEX "nota_periodoAcademico_unique";
DROP INDEX "horario_catedraticos_periodoAcademicoId_idx";
DROP INDEX "asignacion_cursos_periodoAcademicoId_idx";
ALTER TABLE "nota" DROP COLUMN "periodoAcademicoId";
ALTER TABLE "horario_catedraticos" DROP COLUMN "periodoAcademicoId";
ALTER TABLE "asignacion_cursos" DROP COLUMN "periodoAcademicoId";
DROP TABLE "periodos_academicos";
DROP TABLE "ciclos_academicos";
COMMIT;
