# Verificación 005 / 006 / 007 (solo lectura)

Archivos (en `verificacion-migraciones/`):
- `01_pre_verificacion_005_006.sql`: diagnóstico completo (005, 006 y 007). Úsalo **antes** y, para confirmar, **después** de la 006.
- `02_post_verificacion_006.sql`: incluye el 01 (`\ir`) y añade las comprobaciones P1–P8. Ejecútalo **solo después** de aplicar la 006 (sobre una base sin 006 falla con `column "ofertaCursoId" does not exist`; es esperado y no escribe nada).

Complementa, no sustituye, `scripts/prechecks/prevalidacion-005-006.sql` y `docs/PREVALIDACION-MIGRACIONES-005-006.md`: aquí se añade un veredicto global, la huella de datos antiguos y las comprobaciones de integridad.

## Ejecución manual
Desde la carpeta `verificacion-migraciones/`, con la cadena de conexión en una variable de entorno (no la pegues en el terminal ni en logs):

    export DATABASE_URL='...'   # no se imprime en ningún resultado
    psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
      -f 01_pre_verificacion_005_006.sql | tee pre_$(date +%F).txt

Protección de solo lectura: cada script abre `BEGIN READ ONLY`, comprueba con `current_setting('transaction_read_only')` que quedó activa (si no, imprime `ABORTADO`, hace `ROLLBACK` y sale con `\quit`) y termina con `ROLLBACK`.
No se usa `PGOPTIONS` ni parámetros de arranque: el pooler de Neon puede rechazarlos y no se ha podido comprobar contra Neon. `BEGIN READ ONLY` equivale a `BEGIN; SET TRANSACTION READ ONLY` y funciona en modo transacción. Si puedes, usa además un rol con solo `SELECT` (opcional).

Opción `-v umbral_huella=N` (por defecto 200000): si una tabla tiene más filas que `N`, la huella md5 se omite y muestra `OMITIDA (filas > umbral_huella)`. La huella usa `string_agg` + `md5` y es O(n) en tiempo y memoria; en tablas grandes súbela con cuidado o confía en `filas`, `min_id` y `max_id`.

## Secciones y resultado esperado ANTES de la 006

| Sección | Qué comprueba | Esperado |
|---|---|---|
| 0 | Base, esquema, `solo_lectura` | `solo_lectura = on` |
| 1 detalle | Cada objeto 005 (25), 006 (16) y 007 (7); dependencias | 005 todo `OK`; 006 todo `FALTA`; 007 `OK` si ya aplicada |
| 2 resumen | Totales por bloque | BASE 6/6, 002 9/9, 003 4/4, 004 1/1, 005 25/25, 006 0/16, 007 7/7 |
| 3 veredicto | Resultado global 005/006 | **PENDIENTE** |
| 3 veredicto-007 | Estado de la 007 (independiente) | APLICADA / AUSENTE / PARCIAL |
| 2. Conflictos | Objetos con nombres de la 006 ya existentes | 0 filas |
| 2. Transacciones largas | Sesiones >30 s sobre las tablas a modificar | 0 |
| 3. Conteos y huella | Filas, `min_id`, `max_id` y md5 de `asignacion_cursos`/`horario_catedraticos` | **Guarda la salida** |
| 4. Integridad | Huérfanos y tareas sin horario (NULL si no existe la 005) | 0 en cada fila |
| 5. Informativo | Filas sin período, períodos abiertos | Sin umbral (no bloquea) |
| 6. Informativo 008 | `uq_asignacion_curso` y `uq_padre_alumno` frente a los índices del modelo | Antes de la 008 ambos redundantes presentes; no se ejecuta la 008 |

### Sección «Conflictos»
- Antes de la 006: **0 filas**.
- Con la 006 aplicada (16/16): es **normal** ver sus 11 objetos (`ofertas_curso`, su secuencia, 3 índices, 2 funciones, 2 triggers, 2 columnas); no es un error.
- Con APLICACIÓN PARCIAL: cada fila es un objeto que haría fallar la 006 con `already exists`.

### Transacciones largas
`pg_stat_activity` oculta `query` y `xact_start` de otras sesiones si el rol no es superusuario ni tiene `pg_read_all_stats`. La columna `visibilidad_completa` indica si la comprobación es fiable: si es `f`, un 0 no garantiza que no haya transacciones largas; revísalo desde la consola de Neon.

## Interpretación del veredicto
- **APROBADO**: dependencias OK, 005 25/25 y 006 16/16.
- **PENDIENTE**: dependencias OK, 005 25/25 y 006 0/16. Es el estado en que se puede aplicar la 006.
- **APLICACIÓN PARCIAL**: 006 entre 1 y 15. No ejecutes nada; revisa conflictos y detalle. La 006 es transaccional, por lo que un estado parcial indicaría cambios manuales.
- **ERROR**: falta alguna dependencia (BASE/002/003/004) o la 005 no está 25/25. No apliques la 006.

Los «25» de la 005 y los «16» de la 006 son los que define el script (005: 6 tablas, 5 índices, 3 funciones, 3 triggers, 8 restricciones; 006: 1 tabla, 2 columnas, 4 índices, 2 funciones, 2 triggers, 5 FK, 1 unique). Los CHECK de la 005 se comprueban por fragmentos específicos de su definición (`length(TRIM(BOTH FROM titulo)) > 0`, `"sizeBytes" <= 20971520`).

## Migración 007 (reembolsos / anulación de pagos)
Se verifica en 7 objetos: columnas `anuladoEn`, `anuladoPorId`, `motivoAnulacion`, `stripeRefundId` de `pagos`, el FK `anuladoPorId → usuarios` y las restricciones `pagos_anulacion_coherente_check` y `pagos_estado_check` (con el estado `anulado`). Su veredicto es independiente del de 005/006.

## Migración 008 (solo documentada)
`scripts/migrations/008*.sql` elimina los índices redundantes `uq_asignacion_curso` y `uq_padre_alumno`, que duplican los índices del modelo Sequelize. No afecta a 005, 006 ni 007. **Estos scripts no la ejecutan**; la sección 6 solo informa de qué índices existen.

## DESPUÉS de aplicar la 006
Ejecuta `02_post_verificacion_006.sql` (mismo comando). Esperado:
- Veredicto **APROBADO**.
- P1: `ofertaCursoId` integer, `is_nullable = YES` en ambas tablas.
- P2: 5 FKs validadas con `RESTRICT`.
- P3: 5 índices con `valido = t`.
- P4: 2 triggers con estado `O`.
- P5: mismas `filas` y `huella` que antes (o `OMITIDA` en ambas); `sin_seccion = filas` si aún no hay inscripciones por sección.
- P6: 0 en todas las filas.
- P7: 0 secciones al inicio.
- P8: 0 pagos anulados sin `anuladoEn` o sin motivo, y 0 `anuladoPorId` inexistentes.
- Además, `/ready` debe responder 200.

## Confirmación de solo lectura y pruebas realizadas
Los scripts solo usan `SELECT`, catálogos (`pg_*`, `information_schema`) y `query_to_xml` para `count(*)`. Una búsqueda de `INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE|COPY|VACUUM|COMMIT` fuera de comentarios no encuentra coincidencias, y PostgreSQL rechaza escrituras dentro de `BEGIN READ ONLY` (`cannot execute CREATE TABLE in a read-only transaction`).

Probados solo en PostgreSQL 16 local, con un esquema base mínimo (no el esquema completo de Production) y bases nuevas y descartables:

| Escenario | Resultado |
|---|---|
| 001–005 y 007, 006 sin aplicar | PENDIENTE (005 25/25, 006 0/16) |
| 001–007 | APROBADO (006 16/16, 007 APLICADA) |
| 001–005 más tabla `ofertas_curso` suelta | APLICACIÓN PARCIAL (006 1/16) |
| Solo 001–004 | ERROR (005 incompleta), sin abortar |
| 02 tras aplicar la 006 sobre datos de prueba | APROBADO; P1–P8 esperados; la huella previa y posterior coinciden |
| `-v umbral_huella=1` con tablas de 2 filas | Huella `OMITIDA` |

No probado: Neon (incluido su pooler) ni datos reales de Production.
