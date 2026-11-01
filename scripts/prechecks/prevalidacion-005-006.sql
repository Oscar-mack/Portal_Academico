-- Prevalidación de solo lectura de las migraciones 005 y 006.
-- No crea, modifica ni elimina nada: la transacción es READ ONLY y termina en ROLLBACK.
-- Uso sugerido (idealmente con un usuario de solo lectura o una réplica/branch de Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/prechecks/prevalidacion-005-006.sql
BEGIN READ ONLY;

-- Resultado 1: estado por migración (APLICADA / NO APLICADA / PARCIAL).
WITH esperado(migracion, tipo, tabla, nombre, detalle) AS (VALUES
  -- 005: tablas
  (5,'tabla','tareas','tareas',''),
  (5,'tabla','archivos_academicos','archivos_academicos',''),
  (5,'tabla','adjuntos_tarea','adjuntos_tarea',''),
  (5,'tabla','materiales_curso','materiales_curso',''),
  (5,'tabla','entregas_tarea','entregas_tarea',''),
  (5,'tabla','auditoria_tareas','auditoria_tareas',''),
  -- 005: índices
  (5,'indice','tareas','tareas_curso_periodo_publicacion_idx',''),
  (5,'indice','tareas','tareas_catedratico_periodo_idx',''),
  (5,'indice','materiales_curso','materiales_curso_periodo_activo_idx',''),
  (5,'indice','entregas_tarea','entregas_tarea_tarea_alumno_fecha_idx',''),
  (5,'indice','auditoria_tareas','auditoria_tareas_tarea_fecha_idx',''),
  -- 005: triggers y funciones
  (5,'trigger','tareas','tareas_validar_contexto_biu',''),
  (5,'trigger','entregas_tarea','entregas_tarea_validar_bi',''),
  (5,'trigger','auditoria_tareas','auditoria_tareas_inmutable_bud',''),
  (5,'funcion','','validar_contexto_tarea',''),
  (5,'funcion','','validar_entrega_tarea',''),
  (5,'funcion','','auditoria_tareas_inmutable',''),
  -- 005: columnas clave
  (5,'columna','tareas','periodoAcademicoId',''),
  (5,'columna','tareas','fechaLimite',''),
  (5,'columna','archivos_academicos','storageKey',''),
  (5,'columna','archivos_academicos','sha256',''),
  (5,'columna','entregas_tarea','entregadaEn',''),
  (5,'columna','materiales_curso','archivoId',''),
  (5,'columna','adjuntos_tarea','archivoId',''),
  (5,'columna','auditoria_tareas','accion',''),
  -- 006
  (6,'tabla','ofertas_curso','ofertas_curso',''),
  (6,'columna','ofertas_curso','codigoSeccion',''),
  (6,'columna','ofertas_curso','cupoMaximo',''),
  (6,'columna','ofertas_curso','fechaInscripcionInicio',''),
  (6,'columna','ofertas_curso','fechaInscripcionFin',''),
  (6,'columna','asignacion_cursos','ofertaCursoId',''),
  (6,'columna','horario_catedraticos','ofertaCursoId',''),
  (6,'indice','ofertas_curso','ofertas_curso_periodo_activo_idx',''),
  (6,'indice','asignacion_cursos','asignacion_cursos_ofertaCursoId_idx',''),
  (6,'indice','horario_catedraticos','horario_catedraticos_ofertaCursoId_idx',''),
  (6,'trigger','horario_catedraticos','horarios_validar_oferta_biu',''),
  (6,'trigger','asignacion_cursos','asignaciones_validar_oferta_biu',''),
  (6,'funcion','','validar_contexto_oferta_horario',''),
  (6,'funcion','','validar_inscripcion_oferta',''),
  -- 006: llaves foráneas hacia ofertas_curso
  (6,'fk_a_ofertas','asignacion_cursos','',''),
  (6,'fk_a_ofertas','horario_catedraticos','','')
),
estado AS (
  SELECT e.*,
    CASE e.tipo
      WHEN 'tabla' THEN EXISTS (SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = e.nombre)
      WHEN 'columna' THEN EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = e.tabla AND column_name = e.nombre)
      WHEN 'indice' THEN EXISTS (SELECT 1 FROM pg_indexes
        WHERE schemaname = current_schema() AND tablename = e.tabla AND indexname = e.nombre)
      WHEN 'trigger' THEN EXISTS (SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
          AND c.relname = e.tabla AND t.tgname = e.nombre
          AND c.relnamespace = current_schema()::regnamespace)
      WHEN 'funcion' THEN EXISTS (SELECT 1 FROM pg_proc p
        WHERE p.proname = e.nombre AND p.pronamespace = current_schema()::regnamespace)
      WHEN 'fk_a_ofertas' THEN EXISTS (SELECT 1 FROM pg_constraint k
        WHERE k.contype = 'f' AND k.conrelid = to_regclass(quote_ident(e.tabla))
          AND k.confrelid = to_regclass('ofertas_curso'))
    END AS existe
  FROM esperado e
)
SELECT migracion,
       count(*) FILTER (WHERE existe) AS objetos_presentes,
       count(*) AS objetos_esperados,
       CASE WHEN bool_and(existe) THEN 'APLICADA'
            WHEN NOT bool_or(existe) THEN 'NO APLICADA'
            ELSE 'PARCIAL - NO EJECUTAR; revisar faltantes' END AS estado
FROM estado GROUP BY migracion ORDER BY migracion;

-- Resultado 2: objetos que faltan (vacío si todo está presente).
-- Se repite la lógica para poder listar cada faltante.
WITH esperado(migracion, tipo, tabla, nombre) AS (VALUES
  (5,'tabla','tareas','tareas'),(5,'tabla','archivos_academicos','archivos_academicos'),
  (5,'tabla','adjuntos_tarea','adjuntos_tarea'),(5,'tabla','materiales_curso','materiales_curso'),
  (5,'tabla','entregas_tarea','entregas_tarea'),(5,'tabla','auditoria_tareas','auditoria_tareas'),
  (5,'indice','tareas','tareas_curso_periodo_publicacion_idx'),
  (5,'indice','tareas','tareas_catedratico_periodo_idx'),
  (5,'indice','materiales_curso','materiales_curso_periodo_activo_idx'),
  (5,'indice','entregas_tarea','entregas_tarea_tarea_alumno_fecha_idx'),
  (5,'indice','auditoria_tareas','auditoria_tareas_tarea_fecha_idx'),
  (5,'trigger','tareas','tareas_validar_contexto_biu'),
  (5,'trigger','entregas_tarea','entregas_tarea_validar_bi'),
  (5,'trigger','auditoria_tareas','auditoria_tareas_inmutable_bud'),
  (5,'funcion','','validar_contexto_tarea'),(5,'funcion','','validar_entrega_tarea'),
  (5,'funcion','','auditoria_tareas_inmutable'),
  (6,'tabla','ofertas_curso','ofertas_curso'),
  (6,'columna','asignacion_cursos','ofertaCursoId'),(6,'columna','horario_catedraticos','ofertaCursoId'),
  (6,'indice','ofertas_curso','ofertas_curso_periodo_activo_idx'),
  (6,'indice','asignacion_cursos','asignacion_cursos_ofertaCursoId_idx'),
  (6,'indice','horario_catedraticos','horario_catedraticos_ofertaCursoId_idx'),
  (6,'trigger','horario_catedraticos','horarios_validar_oferta_biu'),
  (6,'trigger','asignacion_cursos','asignaciones_validar_oferta_biu'),
  (6,'funcion','','validar_contexto_oferta_horario'),(6,'funcion','','validar_inscripcion_oferta')
)
SELECT e.migracion, e.tipo, e.tabla, e.nombre AS falta
FROM esperado e
WHERE NOT CASE e.tipo
  WHEN 'tabla' THEN EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = e.nombre)
  WHEN 'columna' THEN EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = e.tabla AND column_name = e.nombre)
  WHEN 'indice' THEN EXISTS (SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND tablename = e.tabla AND indexname = e.nombre)
  WHEN 'trigger' THEN EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE NOT t.tgisinternal AND t.tgenabled = 'O' AND c.relname = e.tabla AND t.tgname = e.nombre
      AND c.relnamespace = current_schema()::regnamespace)
  WHEN 'funcion' THEN EXISTS (SELECT 1 FROM pg_proc p
    WHERE p.proname = e.nombre AND p.pronamespace = current_schema()::regnamespace)
END
ORDER BY e.migracion, e.tipo, e.nombre;

-- Resultado 3: restricciones por tabla (esperado: p=PK, f=FK, u=UNIQUE, c=CHECK).
-- Esperado 005: tareas p1 f3 c2 | archivos_academicos p1 f1 u1 c1 | adjuntos_tarea p1 f2 u2
--   materiales_curso p1 f4 u1 c1 | entregas_tarea p1 f3 u1 | auditoria_tareas p1 f3
-- Esperado 006: ofertas_curso p1 f3 u1 c2
SELECT c.relname AS tabla,
       count(*) FILTER (WHERE k.contype = 'p') AS p,
       count(*) FILTER (WHERE k.contype = 'f') AS f,
       count(*) FILTER (WHERE k.contype = 'u') AS u,
       count(*) FILTER (WHERE k.contype = 'c') AS c
FROM pg_class c
LEFT JOIN pg_constraint k ON k.conrelid = c.oid AND k.contype IN ('p','f','u','c')
WHERE c.relkind = 'r' AND c.relnamespace = current_schema()::regnamespace
  AND c.relname IN ('tareas','archivos_academicos','adjuntos_tarea','materiales_curso',
                    'entregas_tarea','auditoria_tareas','ofertas_curso')
GROUP BY c.relname ORDER BY c.relname;

-- Resultado 4: ¿existe una tabla de control de migraciones? (el repositorio no usa ninguna;
-- si no aparece nada, el estado solo se puede inferir de los objetos anteriores).
SELECT table_name FROM information_schema.tables
WHERE table_schema = current_schema()
  AND table_name IN ('schema_migrations','SequelizeMeta','migrations','_prisma_migrations');

-- Resultado 5: prerrequisitos de 002-004 (deben existir antes de 005/006).
SELECT 'periodos_academicos' AS tabla, to_regclass('periodos_academicos') IS NOT NULL AS existe
UNION ALL SELECT 'horario_catedraticos.periodoAcademicoId',
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
    AND table_name = 'horario_catedraticos' AND column_name = 'periodoAcademicoId')
UNION ALL SELECT 'asignacion_cursos.periodoAcademicoId',
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
    AND table_name = 'asignacion_cursos' AND column_name = 'periodoAcademicoId')
UNION ALL SELECT 'nota.publicadaEn (004)',
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
    AND table_name = 'nota' AND column_name = 'publicadaEn');

ROLLBACK;
