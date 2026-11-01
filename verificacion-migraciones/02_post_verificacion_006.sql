-- =====================================================================
-- VERIFICACIÓN POSTERIOR A LA 006  -  SOLO LECTURA  (NO la ejecutes antes de aplicar la 006)
-- Ejecuta primero la verificación completa (veredicto esperado: APROBADO) y luego
-- comprobaciones específicas de ofertaCursoId, índices, FKs y datos antiguos.
-- Uso (desde esta carpeta):
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f 02_post_verificacion_006.sql
-- (sin PGOPTIONS: cada bloque abre BEGIN READ ONLY y aborta si no quedó en solo lectura)
-- =====================================================================
\ir 01_pre_verificacion_005_006.sql

\set ON_ERROR_STOP on
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

\echo ''
\echo '=== P1. Estructura de ofertaCursoId (esperado: nullable=YES, tipo integer) ==='
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND column_name = 'ofertaCursoId'
ORDER BY table_name;

\echo ''
\echo '=== P2. FKs hacia ofertas_curso (esperado: 5 FKs, todas validadas y borrado RESTRICT) ==='
SELECT c.conrelid::regclass AS tabla, c.conname,
       c.convalidated AS validada,
       CASE c.confdeltype WHEN 'r' THEN 'RESTRICT' WHEN 'a' THEN 'NO ACTION' ELSE c.confdeltype::text END AS on_delete
FROM pg_constraint c
WHERE c.contype = 'f'
  AND (c.confrelid = to_regclass('public.ofertas_curso') OR c.conrelid = to_regclass('public.ofertas_curso'))
ORDER BY 1, 2;

\echo ''
\echo '=== P3. Índices de la 006 válidos (esperado: 5 filas, valido = t) ==='
SELECT c.relname AS indice, i.indisvalid AS valido
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
WHERE c.relname IN ('ofertas_curso_periodo_activo_idx', 'asignacion_cursos_ofertaCursoId_idx',
  'horario_catedraticos_ofertaCursoId_idx', 'ofertas_curso_pkey',
  'ofertas_curso_cursoId_periodoAcademicoId_codigoSeccion_key')
ORDER BY 1;

\echo ''
\echo '=== P4. Triggers de la 006 habilitados (esperado: estado = O en ambos) ==='
SELECT tgrelid::regclass AS tabla, tgname, tgenabled AS estado
FROM pg_trigger
WHERE NOT tgisinternal AND tgname IN ('horarios_validar_oferta_biu', 'asignaciones_validar_oferta_biu')
ORDER BY 2;

\echo ''
\echo '=== P5. Datos antiguos conservados: comparar filas y huella con la salida PREVIA (deben coincidir) ==='
SELECT 'asignacion_cursos' AS tabla, count(*) AS filas,
       count(*) FILTER (WHERE "ofertaCursoId" IS NULL) AS sin_seccion, min(id) AS min_id, max(id) AS max_id,
       CASE WHEN count(*) <= :umbral_huella
            THEN (SELECT md5(coalesce(string_agg((to_jsonb(x) - 'ofertaCursoId')::text, '|' ORDER BY x.id), ''))
                  FROM asignacion_cursos x)
            ELSE 'OMITIDA (filas > umbral_huella)' END AS huella
FROM asignacion_cursos
UNION ALL
SELECT 'horario_catedraticos', count(*), count(*) FILTER (WHERE "ofertaCursoId" IS NULL), min(id), max(id),
       CASE WHEN count(*) <= :umbral_huella
            THEN (SELECT md5(coalesce(string_agg((to_jsonb(x) - 'ofertaCursoId')::text, '|' ORDER BY x.id), ''))
                  FROM horario_catedraticos x)
            ELSE 'OMITIDA (filas > umbral_huella)' END
FROM horario_catedraticos;
-- Si no se han creado secciones todavía: sin_seccion debe ser igual a filas.
-- Si ya hay inscripciones nuevas, la huella cambia solo por filas nuevas (compara por id <= máximo previo).

\echo ''
\echo '=== P6. Integridad de secciones (esperado: 0 en cada fila) ==='
SELECT 'asignaciones con sección inexistente' AS comprobacion, count(*) AS n
  FROM asignacion_cursos a WHERE a."ofertaCursoId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM ofertas_curso o WHERE o.id = a."ofertaCursoId")
UNION ALL SELECT 'asignaciones cuyo curso/período no coincide con la sección', count(*)
  FROM asignacion_cursos a JOIN ofertas_curso o ON o.id = a."ofertaCursoId"
  WHERE o."cursoId" <> a."cursoId" OR o."periodoAcademicoId" IS DISTINCT FROM a."periodoAcademicoId"
UNION ALL SELECT 'horarios cuyo curso/docente/período no coincide con la sección', count(*)
  FROM horario_catedraticos h JOIN ofertas_curso o ON o.id = h."ofertaCursoId"
  WHERE o."cursoId" <> h."cursoId" OR o."catedraticoId" <> h."catedraticoId"
     OR o."periodoAcademicoId" IS DISTINCT FROM h."periodoAcademicoId"
UNION ALL SELECT 'secciones con más inscritos que cupoMaximo', count(*)
  FROM ofertas_curso o
  WHERE (SELECT count(*) FROM asignacion_cursos a WHERE a."ofertaCursoId" = o.id) > o."cupoMaximo"
UNION ALL SELECT 'alumnos inscritos dos veces en la misma sección', count(*)
  FROM (SELECT 1 FROM asignacion_cursos WHERE "ofertaCursoId" IS NOT NULL
        GROUP BY "alumnoId", "ofertaCursoId" HAVING count(*) > 1) d;

\echo ''
\echo '=== P7. Volumen de la 006 (informativo) ==='
SELECT (SELECT count(*) FROM ofertas_curso) AS secciones,
       (SELECT count(*) FROM asignacion_cursos WHERE "ofertaCursoId" IS NOT NULL) AS inscripciones_con_seccion,
       (SELECT count(*) FROM horario_catedraticos WHERE "ofertaCursoId" IS NOT NULL) AS horarios_con_seccion;

\echo ''
\echo '=== P8. Migración 007 (necesaria para /ready junto con la 006; esperado: 7/7 en el veredicto 007) ==='
SELECT 'pagos con estado anulado sin anuladoEn o sin motivo (esperado 0)' AS comprobacion, count(*) AS n
FROM pagos WHERE estado = 'anulado' AND ("anuladoEn" IS NULL OR "motivoAnulacion" IS NULL)
UNION ALL SELECT 'pagos con anuladoPorId inexistente (esperado 0)', count(*)
FROM pagos p WHERE p."anuladoPorId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id = p."anuladoPorId");

ROLLBACK;
\echo 'Fin. Solo lectura; no se modificó nada.'
