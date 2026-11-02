# Migraciones pendientes en Neon (006 y 007)

## Síntoma
`/ready` responde 503 y el log de Render muestra `Readiness: esquema incompleto` con:

- columnas `asignacion_cursos.ofertaCursoId`, `horario_catedraticos.ofertaCursoId`
- tabla `ofertas_curso`
- triggers `horarios_validar_oferta_biu`, `asignaciones_validar_oferta_biu`
- columnas `pagos.anuladoEn`, `pagos.anuladoPorId`, `pagos.motivoAnulacion`, `pagos.stripeRefundId`

La respuesta de `/ready` incluye ahora `pendingMigrations`, que indica los archivos de `scripts/migrations/` a aplicar.

## Causa
Estos objetos los crean exclusivamente:

| Migración | Objetos |
|---|---|
| `006-course-offerings-and-self-enrollment.sql` | `ofertas_curso`, `ofertaCursoId` en asignaciones y horarios, 2 triggers + funciones |
| `007-payment-annulment.sql` | `pagos.anuladoEn/anuladoPorId/motivoAnulacion/stripeRefundId`, ampliación de `pagos_estado_check` |

Modelos (`ofertaCurso`, `asignacionCurso`, `horarioCatedratico`, `pago`) y asociaciones en `app/models/index.js` ya coinciden con ellas. El código está correcto; la base de Neon va por detrás. En producción no se ejecuta `sync()` ni migraciones al arrancar, por diseño.

## Procedimiento (lo ejecuta una persona, no el despliegue)
1. Respaldo verificable: rama de Neon o `pg_dump` de la conexión directa (sin pooler).
2. Comprobación de solo lectura: `verificacion-migraciones/01_pre_verificacion_005_006.sql`. Debe indicar 006 y 007 como pendientes y no parciales.
3. Aplicar en este orden, un archivo por vez y en una sola transacción cada uno (los archivos ya traen `BEGIN`/`COMMIT`):
   `psql -X -v ON_ERROR_STOP=1 -f scripts/migrations/006-course-offerings-and-self-enrollment.sql`
   `psql -X -v ON_ERROR_STOP=1 -f scripts/migrations/007-payment-annulment.sql`
4. No usar `scripts/migrate.js` (ejecuta también los `.down.sql`) ni los `.down.sql`.
5. Repetir la verificación y redesplegar; `/ready` debe devolver 200.

Si 005 o anteriores también faltan (`pendingMigrations` los lista), aplicarlas antes en orden numérico. Las migraciones no son idempotentes: no repetir una ya aplicada.
