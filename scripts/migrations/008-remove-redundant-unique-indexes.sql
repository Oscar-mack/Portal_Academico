-- Migration 008: retira las restricciones UNIQUE redundantes creadas fuera del repositorio.
--   asignacion_cursos: se elimina uq_asignacion_curso (se conserva asignacion_cursos_alumno_id_curso_id_periodo, declarado en el modelo).
--   padre_alumnos:     se elimina uq_padre_alumno (se conserva padre_alumnos_usuario_id_alumno_id, declarado en el modelo).
-- No modifica filas, columnas ni otras restricciones. Es independiente de 006 y 007.
-- Aplicar solo este archivo (no scripts/migrate.js). Aborta sin cambios si algo no coincide.
BEGIN;

-- Evita esperar indefinidamente el bloqueo ACCESS EXCLUSIVE de ALTER TABLE.
SET LOCAL lock_timeout = '10s';

DO $$
DECLARE
  item record;
  tabla_oid regclass;
  uq_index oid;
  modelo_index oid;
  actual text;
  esperado text;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('asignacion_cursos', 'uq_asignacion_curso', 'asignacion_cursos_alumno_id_curso_id_periodo', '("alumnoId", "cursoId", periodo)'),
      ('padre_alumnos', 'uq_padre_alumno', 'padre_alumnos_usuario_id_alumno_id', '("usuarioId", "alumnoId")')
    ) AS t(tabla, uq_nombre, modelo_nombre, columnas)
  LOOP
    tabla_oid := to_regclass(format('public.%I', item.tabla));
    IF tabla_oid IS NULL THEN
      RAISE EXCEPTION 'Migration 008 blocked: la tabla public.% no existe', item.tabla;
    END IF;

    -- La restricción a retirar debe existir y ser de tipo UNIQUE.
    SELECT c.conindid INTO uq_index
    FROM pg_constraint c
    WHERE c.conrelid = tabla_oid AND c.conname = item.uq_nombre AND c.contype = 'u';
    IF uq_index IS NULL THEN
      RAISE EXCEPTION 'Migration 008 blocked: no existe la restriccion UNIQUE % en public.%', item.uq_nombre, item.tabla;
    END IF;

    -- Su índice debe ser exactamente el esperado: método, columnas, orden, sin predicado ni expresiones.
    esperado := format('CREATE UNIQUE INDEX %I ON public.%I USING btree %s', item.uq_nombre, item.tabla, item.columnas);
    actual := pg_get_indexdef(uq_index);
    IF actual <> esperado THEN
      RAISE EXCEPTION 'Migration 008 blocked: % no coincide. Esperado: [%] Actual: [%]', item.uq_nombre, esperado, actual;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = uq_index AND indisvalid AND indisready) THEN
      RAISE EXCEPTION 'Migration 008 blocked: el indice % no esta valido y listo', item.uq_nombre;
    END IF;

    -- Ninguna FK puede depender del índice que se va a retirar.
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE contype = 'f' AND conindid = uq_index) THEN
      RAISE EXCEPTION 'Migration 008 blocked: una clave foranea depende de %', item.uq_nombre;
    END IF;

    -- El índice del modelo debe existir, ser idéntico y estar válido: es el que garantiza la unicidad tras el retiro.
    SELECT i.indexrelid INTO modelo_index
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    WHERE i.indrelid = tabla_oid
      AND ic.relname = item.modelo_nombre
      AND ic.relnamespace = 'public'::regnamespace;
    IF modelo_index IS NULL THEN
      RAISE EXCEPTION 'Migration 008 blocked: no existe el indice del modelo % en public.%', item.modelo_nombre, item.tabla;
    END IF;

    esperado := format('CREATE UNIQUE INDEX %I ON public.%I USING btree %s', item.modelo_nombre, item.tabla, item.columnas);
    actual := pg_get_indexdef(modelo_index);
    IF actual <> esperado THEN
      RAISE EXCEPTION 'Migration 008 blocked: % no coincide. Esperado: [%] Actual: [%]', item.modelo_nombre, esperado, actual;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = modelo_index AND indisunique AND indisvalid AND indisready) THEN
      RAISE EXCEPTION 'Migration 008 blocked: el indice % no es unico, valido y listo', item.modelo_nombre;
    END IF;
  END LOOP;
END $$;

-- Sin CASCADE: si algo dependiera de la restricción, la sentencia falla y la transacción revierte.
ALTER TABLE "asignacion_cursos" DROP CONSTRAINT "uq_asignacion_curso";
ALTER TABLE "padre_alumnos" DROP CONSTRAINT "uq_padre_alumno";

-- Verificación final dentro de la transacción: los uq_* ya no existen y los índices del modelo permanecen.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN ('uq_asignacion_curso', 'uq_padre_alumno')) THEN
    RAISE EXCEPTION 'Migration 008 failed: algun indice uq_* sigue existiendo';
  END IF;
  IF (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'
        AND indexname IN ('asignacion_cursos_alumno_id_curso_id_periodo', 'padre_alumnos_usuario_id_alumno_id')) <> 2 THEN
    RAISE EXCEPTION 'Migration 008 failed: falta un indice del modelo';
  END IF;
END $$;

COMMIT;
