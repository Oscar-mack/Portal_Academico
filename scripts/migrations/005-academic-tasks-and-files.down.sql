-- Reversión de 005. Se bloquea si existe algún dato académico de tareas/archivos
-- para no perder entregas, materiales ni auditoría. Solo elimina objetos creados por 005.
-- Debe ejecutarse antes que 004.down, 003.down y 002.down.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "tareas")
    OR EXISTS (SELECT 1 FROM "archivos_academicos")
    OR EXISTS (SELECT 1 FROM "adjuntos_tarea")
    OR EXISTS (SELECT 1 FROM "materiales_curso")
    OR EXISTS (SELECT 1 FROM "entregas_tarea")
    OR EXISTS (SELECT 1 FROM "auditoria_tareas") THEN
    RAISE EXCEPTION 'Reversión bloqueada: existen datos de tareas, archivos o auditoría'
      USING ERRCODE = '23514';
  END IF;
END $$;

DROP TRIGGER IF EXISTS "auditoria_tareas_inmutable_bud" ON "auditoria_tareas";
DROP TRIGGER IF EXISTS "entregas_tarea_validar_bi" ON "entregas_tarea";
DROP TRIGGER IF EXISTS "tareas_validar_contexto_biu" ON "tareas";

DROP TABLE IF EXISTS "auditoria_tareas";
DROP TABLE IF EXISTS "entregas_tarea";
DROP TABLE IF EXISTS "materiales_curso";
DROP TABLE IF EXISTS "adjuntos_tarea";
DROP TABLE IF EXISTS "archivos_academicos";
DROP TABLE IF EXISTS "tareas";

DROP FUNCTION IF EXISTS "auditoria_tareas_inmutable"();
DROP FUNCTION IF EXISTS "validar_entrega_tarea"();
DROP FUNCTION IF EXISTS "validar_contexto_tarea"();

COMMIT;
