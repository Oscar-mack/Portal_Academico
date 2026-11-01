-- =====================================================================
-- VERIFICACIÓN PREVIA 005 / 006  (Portal Académico)  -  SOLO LECTURA
-- Todo corre dentro de BEGIN READ ONLY ... ROLLBACK: PostgreSQL rechaza
-- cualquier escritura. Solo consulta catálogos (pg_*, information_schema)
-- y hace conteos de filas. No imprime credenciales.
-- Uso:  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f 01_pre_verificacion_005_006.sql
-- No depende de PGOPTIONS (los poolers, p. ej. Neon -pooler, pueden rechazar
-- parámetros de inicio): la protección es BEGIN READ ONLY + una comprobación
-- explícita que aborta si la transacción no quedó en solo lectura.
-- Opcional: -v umbral_huella=N (filas máximas para calcular el md5; por defecto 200000).
-- =====================================================================
\set ON_ERROR_STOP on
\pset pager off
\pset null '(null)'
\if :{?umbral_huella}
\else
  \set umbral_huella 200000
\endif
BEGIN READ ONLY;
SELECT current_setting('transaction_read_only') = 'on' AS ro \gset
\if :ro
\else
  \echo 'ABORTADO: la transacción no está en solo lectura. No se ejecutó ninguna consulta.'
  ROLLBACK;
  \quit
\endif

\echo '=== 0. Contexto (sin credenciales) ==='
SELECT current_database() AS base, current_schema() AS esquema,
       current_setting('transaction_read_only') AS solo_lectura,
       current_setting('server_version') AS version_pg;

\echo ''
\echo '=== 1. Objetos: detalle (005/006 y todo lo que falte), RESUMEN y VEREDICTO ==='
-- tipos: tabla | columna(x=columna) | indice(x=nombre) | funcion(x=nombre) |
--        trigger(x=nombre) | fk(x=columna,y=tabla referenciada) |
--        unique(x=columnas separadas por coma, orden alfabético) | check(x=fragmento)
WITH spec(mig, ord, tipo, t, x, y) AS (VALUES
 ('BASE', 1,'tabla','usuarios',NULL,NULL), ('BASE', 2,'tabla','cursos',NULL,NULL),
 ('BASE', 3,'tabla','catedraticos',NULL,NULL), ('BASE', 4,'tabla','alumnos',NULL,NULL),
 ('BASE', 5,'tabla','asignacion_cursos',NULL,NULL), ('BASE', 6,'tabla','horario_catedraticos',NULL,NULL),
 ('002', 1,'tabla','ciclos_academicos',NULL,NULL), ('002', 2,'tabla','periodos_academicos',NULL,NULL),
 ('002', 3,'tabla','evaluaciones',NULL,NULL), ('002', 4,'tabla','calificaciones_evaluacion',NULL,NULL),
 ('002', 5,'tabla','auditoria_notas',NULL,NULL),
 ('002', 6,'columna','asignacion_cursos','periodoAcademicoId',NULL),
 ('002', 7,'columna','horario_catedraticos','periodoAcademicoId',NULL),
 ('002', 8,'columna','nota','periodoAcademicoId',NULL),
 ('002', 9,'columna','periodos_academicos','estado',NULL),
 ('003', 1,'tabla','cargos',NULL,NULL), ('003', 2,'tabla','eventos_stripe',NULL,NULL),
 ('003', 3,'tabla','requisitos_solvencia_documentos',NULL,NULL),
 ('003', 4,'columna','pagos','cargoId',NULL),
 ('004', 1,'columna','nota','publicadaEn',NULL),
 ('005', 1,'tabla','tareas',NULL,NULL), ('005', 2,'tabla','archivos_academicos',NULL,NULL),
 ('005', 3,'tabla','adjuntos_tarea',NULL,NULL), ('005', 4,'tabla','materiales_curso',NULL,NULL),
 ('005', 5,'tabla','entregas_tarea',NULL,NULL), ('005', 6,'tabla','auditoria_tareas',NULL,NULL),
 ('005', 7,'indice','tareas','tareas_curso_periodo_publicacion_idx',NULL),
 ('005', 8,'indice','tareas','tareas_catedratico_periodo_idx',NULL),
 ('005', 9,'indice','materiales_curso','materiales_curso_periodo_activo_idx',NULL),
 ('005',10,'indice','entregas_tarea','entregas_tarea_tarea_alumno_fecha_idx',NULL),
 ('005',11,'indice','auditoria_tareas','auditoria_tareas_tarea_fecha_idx',NULL),
 ('005',12,'funcion',NULL,'validar_contexto_tarea',NULL),
 ('005',13,'funcion',NULL,'validar_entrega_tarea',NULL),
 ('005',14,'funcion',NULL,'auditoria_tareas_inmutable',NULL),
 ('005',15,'trigger','tareas','tareas_validar_contexto_biu',NULL),
 ('005',16,'trigger','entregas_tarea','entregas_tarea_validar_bi',NULL),
 ('005',17,'trigger','auditoria_tareas','auditoria_tareas_inmutable_bud',NULL),
 ('005',18,'check','tareas','"fechaLimite" > "fechaPublicacion"',NULL),
 ('005',19,'check','tareas','length(TRIM(BOTH FROM titulo)) > 0',NULL),
 ('005',20,'check','archivos_academicos','"sizeBytes" <= 20971520',NULL),
 ('005',21,'unique','archivos_academicos','storageKey',NULL),
 ('005',22,'unique','adjuntos_tarea','archivoId',NULL),
 ('005',23,'unique','materiales_curso','archivoId',NULL),
 ('005',24,'unique','entregas_tarea','archivoId',NULL),
 ('005',25,'unique','adjuntos_tarea','archivoId,tareaId',NULL),
 ('006', 1,'tabla','ofertas_curso',NULL,NULL),
 ('006', 2,'indice','ofertas_curso','ofertas_curso_periodo_activo_idx',NULL),
 ('006', 3,'columna','asignacion_cursos','ofertaCursoId',NULL),
 ('006', 4,'columna','horario_catedraticos','ofertaCursoId',NULL),
 ('006', 5,'indice','asignacion_cursos','asignacion_cursos_ofertaCursoId_idx',NULL),
 ('006', 6,'indice','horario_catedraticos','horario_catedraticos_ofertaCursoId_idx',NULL),
 ('006', 7,'funcion',NULL,'validar_contexto_oferta_horario',NULL),
 ('006', 8,'funcion',NULL,'validar_inscripcion_oferta',NULL),
 ('006', 9,'trigger','horario_catedraticos','horarios_validar_oferta_biu',NULL),
 ('006',10,'trigger','asignacion_cursos','asignaciones_validar_oferta_biu',NULL),
 ('006',11,'fk','ofertas_curso','cursoId','cursos'),
 ('006',12,'fk','ofertas_curso','catedraticoId','catedraticos'),
 ('006',13,'fk','ofertas_curso','periodoAcademicoId','periodos_academicos'),
 ('006',14,'fk','asignacion_cursos','ofertaCursoId','ofertas_curso'),
 ('006',15,'fk','horario_catedraticos','ofertaCursoId','ofertas_curso'),
 ('006',16,'unique','ofertas_curso','codigoSeccion,cursoId,periodoAcademicoId',NULL),
 ('007', 1,'columna','pagos','anuladoEn',NULL),
 ('007', 2,'columna','pagos','anuladoPorId',NULL),
 ('007', 3,'columna','pagos','motivoAnulacion',NULL),
 ('007', 4,'columna','pagos','stripeRefundId',NULL),
 ('007', 5,'fk','pagos','anuladoPorId','usuarios'),
 ('007', 6,'restriccion','pagos','pagos_anulacion_coherente_check',NULL),
 ('007', 7,'restriccion','pagos','pagos_estado_check','anulado')
), res AS (
 SELECT s.*,
  CASE s.tipo
   WHEN 'tabla' THEN to_regclass('public.' || quote_ident(s.t)) IS NOT NULL
   WHEN 'columna' THEN EXISTS (SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = s.t AND c.column_name = s.x)
   WHEN 'indice' THEN EXISTS (SELECT 1 FROM pg_indexes i
        WHERE i.schemaname = 'public' AND i.tablename = s.t AND i.indexname = s.x)
   WHEN 'funcion' THEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = s.x)
   WHEN 'trigger' THEN EXISTS (SELECT 1 FROM pg_trigger g
        WHERE g.tgname = s.x AND g.tgrelid = to_regclass('public.' || quote_ident(s.t))
          AND NOT g.tgisinternal AND g.tgenabled <> 'D')
   WHEN 'fk' THEN EXISTS (SELECT 1 FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
          AND c.conrelid = to_regclass('public.' || quote_ident(s.t))
          AND c.confrelid = to_regclass('public.' || quote_ident(s.y))
          AND a.attname = s.x)
   WHEN 'unique' THEN EXISTS (SELECT 1 FROM pg_constraint c
        WHERE c.contype = 'u' AND c.conrelid = to_regclass('public.' || quote_ident(s.t))
          AND (SELECT string_agg(a.attname::text, ',' ORDER BY a.attname)
               FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) = s.x)
   WHEN 'check' THEN EXISTS (SELECT 1 FROM pg_constraint c
        WHERE c.contype = 'c' AND c.conrelid = to_regclass('public.' || quote_ident(s.t))
          AND pg_get_constraintdef(c.oid) LIKE '%' || s.x || '%')
   WHEN 'restriccion' THEN EXISTS (SELECT 1 FROM pg_constraint c
        WHERE c.conname = s.x AND c.conrelid = to_regclass('public.' || quote_ident(s.t))
          AND (s.y IS NULL OR pg_get_constraintdef(c.oid) LIKE '%' || s.y || '%'))
  END AS ok
 FROM spec s
), agg AS (
 SELECT mig, count(*) AS esperados, count(*) FILTER (WHERE ok) AS encontrados FROM res GROUP BY mig
), estado AS (
 SELECT
  (SELECT bool_and(encontrados = esperados) FROM agg WHERE mig IN ('BASE','002','003','004')) AS deps_ok,
  (SELECT encontrados = esperados FROM agg WHERE mig = '005') AS m005_ok,
  (SELECT encontrados FROM agg WHERE mig = '006') AS n006,
  (SELECT encontrados FROM agg WHERE mig = '007') AS n007
)
SELECT '1-detalle' AS seccion, mig, ord, tipo,
       concat_ws('.', t, x, y) AS objeto,
       CASE WHEN ok THEN 'OK' ELSE 'FALTA' END AS resultado
FROM res WHERE mig IN ('005','006','007') OR NOT ok
UNION ALL
SELECT '2-resumen', mig, NULL, NULL, encontrados || '/' || esperados,
       CASE WHEN encontrados = esperados THEN 'COMPLETA' WHEN encontrados = 0 THEN 'AUSENTE' ELSE 'PARCIAL' END
FROM agg
UNION ALL
SELECT '3-veredicto', NULL, NULL, NULL,
  'Dependencias 002-004: ' || CASE WHEN deps_ok THEN 'OK' ELSE 'FALTAN' END
  || ' | 005: ' || CASE WHEN m005_ok THEN '25/25' ELSE 'INCOMPLETA' END
  || ' | 006: ' || n006 || '/16',
  CASE WHEN NOT deps_ok OR NOT m005_ok THEN 'ERROR'
       WHEN n006 = 0 THEN 'PENDIENTE'
       WHEN n006 = 16 THEN 'APROBADO'
       ELSE 'APLICACIÓN PARCIAL' END
FROM estado
UNION ALL
-- La 007 no altera el veredicto de 005/006; /ready exige 006 y 007, así que se informa aparte.
SELECT '3-veredicto-007', NULL, NULL, NULL, '007: ' || n007 || '/7',
  CASE WHEN n007 = 7 THEN 'APLICADA' WHEN n007 = 0 THEN 'AUSENTE' ELSE 'PARCIAL' END
FROM estado
ORDER BY 1, 2, 3;

\echo ''
\echo '=== 2. Conflictos que bloquearían la 006 ==='
\echo 'Esperado: 0 filas si la 006 está PENDIENTE. Si la 006 ya está aplicada (16/16), es NORMAL que aparezcan'
\echo 'sus 11 objetos (ofertas_curso, ofertas_curso_id_seq, 3 índices, 2 funciones, 2 triggers, 2 columnas); no es un error.'
\echo 'Con APLICACIÓN PARCIAL, cada fila es un objeto que haría fallar la 006 con "already exists".'
SELECT x.nombre, x.tipo
FROM (
  SELECT c.relname::text AS nombre, 'relación' AS tipo FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname IN ('ofertas_curso','ofertas_curso_periodo_activo_idx',
     'asignacion_cursos_ofertaCursoId_idx','horario_catedraticos_ofertaCursoId_idx','ofertas_curso_id_seq')
  UNION ALL SELECT p.proname::text, 'función' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('validar_contexto_oferta_horario','validar_inscripcion_oferta')
  UNION ALL SELECT g.tgname::text, 'trigger' FROM pg_trigger g WHERE NOT g.tgisinternal
   AND g.tgname IN ('horarios_validar_oferta_biu','asignaciones_validar_oferta_biu')
  UNION ALL SELECT (table_name || '.' || column_name)::text, 'columna' FROM information_schema.columns
   WHERE table_schema = 'public' AND column_name = 'ofertaCursoId'
) x
ORDER BY 1;

-- pg_stat_activity solo muestra consulta y xact_start de otras sesiones si el rol es superusuario o
-- miembro de pg_read_all_stats; si visibilidad_completa = false, un 0 NO descarta transacciones ajenas.
SELECT 'transacciones >30s activas sobre asignacion_cursos/horario_catedraticos (esperado 0)' AS comprobacion,
       count(*) AS n,
       (pg_has_role(current_user, 'pg_read_all_stats', 'member')
         OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS visibilidad_completa
FROM pg_stat_activity
WHERE state <> 'idle' AND pid <> pg_backend_pid() AND xact_start < now() - interval '30 seconds'
  AND (query ILIKE '%asignacion_cursos%' OR query ILIKE '%horario_catedraticos%');

\echo ''
\echo '=== 3. Conteos y huella de datos antiguos (GUARDAR esta salida para comparar después) ==='
SELECT t AS tabla,
  CASE WHEN to_regclass('public.' || quote_ident(t)) IS NULL THEN NULL
       ELSE (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', t), false, true, '')))[1]::text::bigint
  END AS filas
FROM unnest(ARRAY['usuarios','alumnos','catedraticos','cursos','ciclos_academicos','periodos_academicos',
  'asignacion_cursos','horario_catedraticos','nota','evaluaciones','calificaciones_evaluacion',
  'tareas','archivos_academicos','adjuntos_tarea','materiales_curso','entregas_tarea','auditoria_tareas',
  'ofertas_curso']) AS t
ORDER BY 1;

-- Huella md5 sin la columna ofertaCursoId: debe ser idéntica antes y después de la 006.
-- Recorre y serializa cada fila (O(n) en CPU y memoria). Solo se calcula si filas <= :umbral_huella
-- (por defecto 200000); por encima se omite y quedan filas, max_id y min_id como comprobación ligera.
SELECT 'asignacion_cursos' AS tabla, c.filas, c.min_id, c.max_id,
       CASE WHEN c.filas <= :umbral_huella
            THEN (SELECT md5(coalesce(string_agg((to_jsonb(a) - 'ofertaCursoId')::text, '|' ORDER BY a.id), ''))
                  FROM asignacion_cursos a)
            ELSE 'OMITIDA (filas > umbral_huella)' END AS huella
FROM (SELECT count(*) AS filas, min(id) AS min_id, max(id) AS max_id FROM asignacion_cursos) c
UNION ALL
SELECT 'horario_catedraticos', c.filas, c.min_id, c.max_id,
       CASE WHEN c.filas <= :umbral_huella
            THEN (SELECT md5(coalesce(string_agg((to_jsonb(h) - 'ofertaCursoId')::text, '|' ORDER BY h.id), ''))
                  FROM horario_catedraticos h)
            ELSE 'OMITIDA (filas > umbral_huella)' END
FROM (SELECT count(*) AS filas, min(id) AS min_id, max(id) AS max_id FROM horario_catedraticos) c;

\echo ''
\echo '=== 4. Integridad referencial de registros antiguos (esperado: 0 en cada fila) ==='
SELECT 'asignacion_cursos sin alumno' AS comprobacion, count(*) AS huerfanos
  FROM asignacion_cursos a WHERE NOT EXISTS (SELECT 1 FROM alumnos x WHERE x.id = a."alumnoId")
UNION ALL SELECT 'asignacion_cursos sin curso', count(*)
  FROM asignacion_cursos a WHERE NOT EXISTS (SELECT 1 FROM cursos x WHERE x.id = a."cursoId")
UNION ALL SELECT 'asignacion_cursos con periodo inexistente', count(*)
  FROM asignacion_cursos a WHERE a."periodoAcademicoId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM periodos_academicos x WHERE x.id = a."periodoAcademicoId")
UNION ALL SELECT 'horario_catedraticos sin catedrático', count(*)
  FROM horario_catedraticos h WHERE NOT EXISTS (SELECT 1 FROM catedraticos x WHERE x.id = h."catedraticoId")
UNION ALL SELECT 'horario_catedraticos sin curso', count(*)
  FROM horario_catedraticos h WHERE NOT EXISTS (SELECT 1 FROM cursos x WHERE x.id = h."cursoId")
UNION ALL SELECT 'horario_catedraticos con periodo inexistente', count(*)
  FROM horario_catedraticos h WHERE h."periodoAcademicoId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM periodos_academicos x WHERE x.id = h."periodoAcademicoId")
UNION ALL SELECT 'tareas sin horario del docente (contexto inválido; NULL si la 005 no existe)',
  CASE WHEN to_regclass('public.tareas') IS NULL THEN NULL
       ELSE (xpath('/row/c/text()', query_to_xml($q$
         SELECT count(*) AS c FROM public.tareas t WHERE NOT EXISTS (SELECT 1 FROM public.horario_catedraticos h
           WHERE h."catedraticoId" = t."catedraticoId" AND h."cursoId" = t."cursoId"
             AND h."periodoAcademicoId" = t."periodoAcademicoId")$q$, false, true, '')))[1]::text::bigint
  END;

\echo ''
\echo '=== 5. Informativo (no bloquea la 006) ==='
SELECT 'asignacion_cursos con periodoAcademicoId NULL' AS dato, count(*) AS filas
  FROM asignacion_cursos WHERE "periodoAcademicoId" IS NULL
UNION ALL SELECT 'horario_catedraticos con periodoAcademicoId NULL', count(*)
  FROM horario_catedraticos WHERE "periodoAcademicoId" IS NULL
UNION ALL SELECT 'periodos abiertos', count(*) FROM periodos_academicos WHERE estado = 'abierto';

\echo ''
\echo '=== 6. Migración 008 (independiente; NO se ejecuta aquí): restricciones UNIQUE redundantes ==='
\echo 'Antes de la 008: uq_asignacion_curso y uq_padre_alumno existen (presentes = true).'
\echo 'Después de la 008: ausentes (false), y se conservan los índices del modelo (presentes = true).'
\echo 'No afecta a /ready ni a la 005/006/007; es una limpieza opcional.'
SELECT x.tabla, x.nombre, x.rol, EXISTS (
         SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = x.nombre) AS presente
FROM (VALUES
  ('asignacion_cursos', 'uq_asignacion_curso', 'redundante (la 008 la elimina)'),
  ('asignacion_cursos', 'asignacion_cursos_alumno_id_curso_id_periodo', 'índice del modelo (se conserva)'),
  ('padre_alumnos', 'uq_padre_alumno', 'redundante (la 008 la elimina)'),
  ('padre_alumnos', 'padre_alumnos_usuario_id_alumno_id', 'índice del modelo (se conserva)')
) AS x(tabla, nombre, rol)
ORDER BY 1, 2;

ROLLBACK;
\echo ''
\echo 'Fin. Transacción de solo lectura revertida; no se modificó nada.'
