# Verificación 005 / 006 (solo lectura)

Archivos (en `/root/verificacion-migraciones/`):
- `01_pre_verificacion_005_006.sql`: diagnóstico completo. Úsalo **antes** y, para confirmar, **después** de la 006.
- `02_post_verificacion_006.sql`: incluye el 01 (`\ir`) y añade comprobaciones P1–P7 de la 006. Ejecútalo **solo después** de aplicar la 006.

## Ejecución manual
Desde esa carpeta, con la cadena de conexión en una variable de entorno (no la pegues en el terminal ni en logs):

    export DATABASE_URL='...'   # no se imprime en ningún resultado
    PGOPTIONS='-c default_transaction_read_only=on' \
      psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
      -f 01_pre_verificacion_005_006.sql | tee pre_$(date +%F).txt

Doble protección: `PGOPTIONS` pone la sesión en solo lectura y cada script abre `BEGIN READ ONLY` y termina con `ROLLBACK`.
Si puedes, usa un rol con solo `SELECT` (Neon permite roles de solo lectura desde su consola; es opcional).

## Secciones y resultado esperado ANTES de la 006

| Sección | Qué comprueba | Esperado |
|---|---|---|
| 0 | Base, esquema, `solo_lectura` | `solo_lectura = on` |
| 1 detalle | Cada objeto 005 (25) y 006 (16); cualquier dependencia faltante | 005 todo `OK`; 006 todo `FALTA` |
| 2 resumen | Totales por bloque | BASE 6/6, 002 9/9, 003 4/4, 004 1/1, 005 25/25, 006 0/16 |
| 3 veredicto | Resultado global | **PENDIENTE** |
| 2. Conflictos | Objetos con nombres de la 006 ya existentes | 0 filas |
| 2. Transacciones largas | Sesiones >30 s sobre las tablas a modificar | 0 |
| 3. Conteos y huella | Filas por tabla y md5 de `asignacion_cursos`/`horario_catedraticos` sin `ofertaCursoId` | **Guarda la salida** |
| 4. Integridad | Huérfanos y tareas sin horario | 0 en cada fila |
| 5. Informativo | Filas sin período, períodos abiertos | Sin umbral (no bloquea) |

## Interpretación del veredicto
- **APROBADO**: dependencias OK, 005 25/25 y 006 16/16.
- **PENDIENTE**: dependencias OK, 005 25/25 y 006 0/16. Es el estado en que se puede aplicar la 006.
- **APLICACIÓN PARCIAL**: 006 entre 1 y 15. No ejecutes nada; revisa la sección de conflictos y el detalle. El archivo 006 es transaccional, por lo que un estado parcial indicaría cambios manuales o ejecución fuera del SQL.
- **ERROR**: falta alguna dependencia (BASE/002/003/004) o la 005 no está 25/25. No apliques la 006.

Los "25" de la 005 y los "16" de la 006 son los que define el script. Pueden agruparse distinto de tu revisión anterior (aquí: 6 tablas, 5 índices, 3 funciones, 3 triggers, 8 restricciones únicas o check; 006: 1 tabla, 2 columnas, 4 índices, 2 funciones, 2 triggers, 5 FK, 1 unique).

## DESPUÉS de aplicar la 006
Ejecuta `02_post_verificacion_006.sql` (mismo comando). Esperado:
- Veredicto **APROBADO**.
- P1: `ofertaCursoId` integer, `is_nullable = YES` en ambas tablas.
- P2: 5 FKs validadas con `RESTRICT`.
- P3: 5 índices con `valido = t`.
- P4: 2 triggers con estado `O`.
- P5: mismas `filas` y `huella` que antes; `sin_seccion = filas` si aún no hay inscripciones por sección.
- P6: 0 en todas las filas.
- P7: 0 secciones al inicio.
- Además, `/ready` debe responder 200.

## Confirmación de solo lectura
Los scripts solo usan `SELECT`, catálogos (`pg_*`, `information_schema`) y `query_to_xml` para `count(*)`. Fuera de los comentarios no contienen sentencias de escritura ni DDL (verificado con búsqueda). Probados únicamente en una base local descartable (ya eliminada), en los tres escenarios: pendiente, aplicada y parcial. Un intento de escritura dentro de `BEGIN READ ONLY` es rechazado por PostgreSQL. No se ejecutó nada contra Neon.
