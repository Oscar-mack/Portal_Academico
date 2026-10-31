# Prevalidación de solo lectura de las migraciones 005 y 006

Objetivo: saber si 005 y 006 ya están aplicadas en una base PostgreSQL (p. ej. Neon) **sin modificar nada**. El script `scripts/prechecks/prevalidacion-005-006.sql` usa `BEGIN READ ONLY` y termina en `ROLLBACK`: PostgreSQL rechaza cualquier escritura dentro de esa transacción.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/prechecks/prevalidacion-005-006.sql
```

Recomendado: usar un rol de solo lectura o una rama/réplica de Neon, y no pegar la cadena de conexión en chats ni en commits. El script **no** forma parte de `scripts/migrations/` para que ningún proceso lo ejecute como migración.

## 1. Cómo saber si cada migración está aplicada
El proyecto no tiene tabla de control de migraciones (el script lo comprueba en el Resultado 4), por lo que el estado se infiere de los objetos. El Resultado 1 devuelve por migración `APLICADA`, `NO APLICADA` o `PARCIAL`:

| Migración | Objetos verificados | Condición |
|---|---|---|
| 005 | 25 | 25/25 = aplicada, 0/25 = no aplicada |
| 006 | 16 | 16/16 = aplicada, 0/16 = no aplicada |

## 2. Objetos que deben existir
**005** (todo en una transacción):
- Tablas: `tareas`, `archivos_academicos`, `adjuntos_tarea`, `materiales_curso`, `entregas_tarea`, `auditoria_tareas`.
- Índices: `tareas_curso_periodo_publicacion_idx`, `tareas_catedratico_periodo_idx`, `materiales_curso_periodo_activo_idx`, `entregas_tarea_tarea_alumno_fecha_idx`, `auditoria_tareas_tarea_fecha_idx`.
- Triggers (habilitados): `tareas_validar_contexto_biu`, `entregas_tarea_validar_bi`, `auditoria_tareas_inmutable_bud`; funciones `validar_contexto_tarea`, `validar_entrega_tarea`, `auditoria_tareas_inmutable`.
- Restricciones (Resultado 3, p=PK, f=FK, u=UNIQUE, c=CHECK): `tareas` p1 f3 c2; `archivos_academicos` p1 f1 u1 c1; `adjuntos_tarea` p1 f2 u2; `materiales_curso` p1 f4 u1 c1; `entregas_tarea` p1 f3 u1; `auditoria_tareas` p1 f3.

**006**:
- Tabla `ofertas_curso` (columnas `codigoSeccion`, `cupoMaximo`, `fechaInscripcionInicio`, `fechaInscripcionFin`); restricciones p1 f3 u1 c2.
- Columna nullable `ofertaCursoId` en `asignacion_cursos` y `horario_catedraticos`, cada una con FK hacia `ofertas_curso`.
- Índices: `ofertas_curso_periodo_activo_idx`, `asignacion_cursos_ofertaCursoId_idx`, `horario_catedraticos_ofertaCursoId_idx`.
- Triggers: `horarios_validar_oferta_biu`, `asignaciones_validar_oferta_biu`; funciones `validar_contexto_oferta_horario`, `validar_inscripcion_oferta`.

Prerrequisitos (Resultado 5): `periodos_academicos`, `periodoAcademicoId` en `horario_catedraticos` y `asignacion_cursos`, y `nota.publicadaEn` (004).

## 3. Migración parcial
Cada archivo envuelve todo en `BEGIN…COMMIT`, así que PostgreSQL no deja una migración a medias salvo que alguien ejecutara sentencias sueltas, la editara o eliminara objetos a mano (en producción `server.js` omite `sequelize.sync()`, por lo que no crea tablas por su cuenta). Un resultado `PARCIAL` lista en el Resultado 2 cada objeto faltante. **Con `PARCIAL` no se debe ejecutar la migración completa** (fallaría por `already exists`): se debe revisar caso por caso y completar solo lo faltante con un script revisado aparte.

## 4. Que no se ejecuten dos veces
- Ninguna de las dos es idempotente (usa `CREATE TABLE` sin `IF NOT EXISTS`): al repetirla, falla con `relation "…" already exists` y el `ROLLBACK` implícito de la transacción no deja cambios. Esto se comprobó en una base PostgreSQL 16 desechable.
- Regla operativa: ejecutar una migración **solo** si el Resultado 1 indica `NO APLICADA`. Con `APLICADA`, no hacer nada. Con `PARCIAL`, detenerse.
- Usar `psql -v ON_ERROR_STOP=1` y, preferiblemente, `--single-transaction` en el momento (futuro, autorizado) de aplicar.

## 5. Respaldo previo
Antes de cualquier cambio de esquema:
1. Punto de restauración/rama de Neon creada inmediatamente antes (anotar fecha y hora UTC).
2. `pg_dump --format=custom --no-owner "$DATABASE_URL" -f portal_AAAA-MM-DD.dump`, guardado fuera del proveedor.
3. Verificar el respaldo: `pg_restore --list portal_AAAA-MM-DD.dump` y, idealmente, restaurarlo en una base vacía y comparar conteos de `usuarios`, `alumnos`, `nota`, `pagos`, `horario_catedraticos` y `asignacion_cursos`.
4. Guardar el resultado de esta prevalidación como evidencia.

## 6. Resultado esperado de `/ready`
- **Antes** del despliegue del backend con 005/006 ya incluidas, sobre una base **sin** 005/006: el backend nuevo responde `503` con `"schema":"incomplete"` y `missingSchema` (p. ej. `table:tareas`, `table:ofertas_curso`, `column:asignacion_cursos.ofertaCursoId`), y Render conserva la versión anterior. El backend anterior seguirá respondiendo `200` porque no exige esos objetos.
- **Con** 005/006 aplicadas y el backend nuevo desplegado: `200` con `{"status":"ready","checks":{"database":"ok","schema":"ok"}}`.
- `503` con `"database":"unavailable"` indica problema de conexión/credenciales, no de esquema.
- Después del despliegue, confirmar además que `GET /api/ofertas-curso/disponibles` sin token responde `403` ("No se proporcionó ningún token."), y no `404` ("Ruta no encontrada").

## Verificación del propio script
Probado únicamente en una base PostgreSQL 16 desechable local (Docker, esquema mínimo de las tablas base): estado sin migraciones → `NO APLICADA`/`NO APLICADA`; solo 005 → `APLICADA`/`NO APLICADA`; 005+006 → `APLICADA`/`APLICADA`; con un trigger y un índice eliminados → `PARCIAL` con los faltantes listados; reejecutar 005 → `relation "tareas" already exists`. **No se ejecutó contra Neon.** Neon usa PostgreSQL estándar, pero conviene correrlo primero en una rama de Neon.
