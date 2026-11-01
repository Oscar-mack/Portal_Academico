# Operación: ambientes, backups, monitoreo, despliegue

## Ambientes
| Ambiente | NODE_ENV | Base de datos | Stripe | Notas |
|---|---|---|---|---|
| Desarrollo | development | PostgreSQL local | claves `sk_test_` | CORS abierto permitido |
| Pruebas (CI) | test | SQLite en memoria (automático) | simulado | `npm test` |
| Producción | production | PostgreSQL administrado | claves `sk_live_` | CORS exacto, HTTPS, secretos en el gestor del hosting |

En producción `server.js` se niega a iniciar si falta `JWT_SECRET` (>=32 caracteres) o
`CORS_ORIGIN` (distinto de `*`). Stripe es opcional para que la API académica siga
disponible: mientras falte `STRIPE_SECRET_KEY` o `STRIPE_WEBHOOK_SECRET`, Checkout
responde `503` con las variables faltantes. Para habilitar pagos también configura
`FRONTEND_URL` (URL HTTPS de la aplicación web, usada en los retornos de Checkout;
sin ella Checkout responde `503`). `APP_URL` es informativa: el backend no la usa para
crear sesiones y el webhook solo requiere `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET`.
Nunca versionar `.env`.

Pagos: nunca se eliminan (`DELETE /api/pagos/:id` responde `405`). Un administrador usa
`PATCH /api/pagos/:id/anular` con `motivo`: un pago `pendiente` pasa a `cancelado` (se
expira la sesión de Stripe) y un pago `pagado` pasa a `anulado` (reversión contable; con
`reembolsar: true` además se crea un Refund en Stripe). Requiere la migración 007, que
debe aplicarse antes del despliegue (`/ready` responde `503` mientras falte).

## Backups y restauración (PostgreSQL)
- Backup diario automático del proveedor (retención mínima 7 días) + `pg_dump` semanal guardado fuera del proveedor (retención 30 días):
  `pg_dump --format=custom --no-owner "$DATABASE_URL" -f portal_$(date +%F).dump`
- Prueba de restauración mensual en una base vacía:
  `pg_restore --no-owner -d "$DATABASE_URL_RESTORE" portal_YYYY-MM-DD.dump` y validar conteos de `usuarios`, `alumnos`, `notas`, `pagos`.
- Registrar fecha y resultado de cada prueba.

## Monitoreo y logs
- `GET /health` (liveness) y `GET /ready` (readiness con BD): configurar monitor externo cada 1 min y alerta por correo/chat tras 3 fallos.
- Alertas sugeridas: 5xx > 1 % en 5 min, latencia p95 > 2 s, uso de BD > 80 %, fallos de webhook en el dashboard de Stripe.
- Los logs no incluyen contraseñas, tokens ni cuerpos de petición (cubierto por prueba automática). Retención de logs: 30 días.

## Respuesta ante incidentes
1. Detectar (alerta) y asignar responsable. 2. Contener (rotar `JWT_SECRET`/claves Stripe si hay sospecha de filtración; invalida sesiones).
3. Restaurar desde backup si hay pérdida de datos. 4. Comunicar a la institución. 5. Registrar causa raíz y acciones.

## Despliegue y rollback
- Contenedor: `docker build -t portal-api .` (ver `Dockerfile`); alternativa Render con `render.yaml`.
- CI en `.github/workflows/ci.yml` ejecuta `npm test` en cada push/PR; desplegar solo con CI en verde.
- HTTPS/TLS lo termina el proveedor; `FRONTEND_URL` y `CORS_ORIGIN` deben corresponder a dominios HTTPS. `APP_URL`, si está configurada, debe usar HTTPS.
- Rollback: redeploy de la imagen/commit anterior. Antes de cambios de esquema, tomar backup.
- Pendiente: el esquema se crea con `sequelize.sync()`; para producción formal conviene adoptar migraciones (sequelize-cli).
- Stripe: registrar el endpoint `https://<APP_URL>/api/pagos/webhook` y los eventos `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `refund.created`, `refund.updated` y `refund.failed`. Los eventos de reembolso reconcilian el pago si Stripe completó el reembolso y la escritura local falló; el webhook debe devolver un error no-2xx ante fallos de base de datos para que Stripe reintente. Checkout devuelve al frontend en `FRONTEND_URL`; el estado solo se confirma mediante el webhook firmado y se consulta con `GET /api/pagos`.

## Pagos con Stripe: verificación de despliegue
- Variables a verificar (solo existencia y formato, nunca valores): `STRIPE_SECRET_KEY` (`sk_test_`/`sk_live_`), `STRIPE_WEBHOOK_SECRET` (`whsec_…` del endpoint registrado, distinto al de `stripe listen`), `FRONTEND_URL` (necesaria para Checkout; HTTPS, sin ruta) y `CORS_ORIGIN`. `APP_URL` es informativa y solo debe comprobarse si está configurada.
- El frontend es una SPA con `createBrowserRouter`: el hosting debe reescribir `/*` a `/index.html`. `public/_redirects` solo lo respeta Netlify; Render lo ignora. En el Static Site de Render: Dashboard → servicio del frontend → Redirects/Rewrites → Source `/*`, Destination `/index.html`, Action **Rewrite** (no Redirect). Equivalente en Blueprint de un servicio estático: `routes: [{ type: rewrite, source: /*, destination: /index.html }]`. Sin esa regla, abrir directamente `/pago-exitoso` o `/pago-cancelado` (como hace Stripe) responde 404. Comprobación: `curl -s -o /dev/null -w '%{http_code}' https://<FRONTEND_URL>/pago-cancelado` debe dar 200.
- Las URLs de retorno incluyen `pago_id`; el estado mostrado proviene siempre de `GET /api/pagos` (actualizado solo por el webhook firmado). Si el usuario abandona Checkout, `POST /api/pagos/:id/cancelar` expira la sesión y libera el cargo.

## Orden de despliegue y diagnóstico de versiones desfasadas
`render.yaml` define `healthCheckPath: /ready`, y `/ready` responde `503` con `missingSchema` si la base no tiene las tablas, columnas o triggers que exige el código (`REQUIRED_SCHEMA` y `REQUIRED_TRIGGERS` en `app.js`). Consecuencia: si se despliega un commit que exige las migraciones 005, 006 y 007 antes de aplicarlas en la base (`/ready` verifica los objetos de las tres), Render marca el despliegue como fallido y **mantiene en ejecución la versión anterior**, mientras el frontend estático (otro servicio) sí publica la versión nueva. Síntomas típicos: `403 ... admin, catedratico` en evaluaciones del alumno y `Ruta no encontrada` en `/api/tareas`, `/api/materiales` y `/api/ofertas-curso/disponibles`.

Orden correcto (migraciones y despliegues los ejecuta una persona autorizada; nunca el pipeline de pruebas):
1. Respaldo de la base (`pg_dump`).
2. Aplicar en orden las migraciones que falten (`scripts/migrations/00N-*.sql`; cada una corre en una transacción y **no es idempotente**: no repetir las ya aplicadas). Las migraciones 006 y 007 son necesarias para que `/ready` responda `ready`. La 008 (`008-remove-redundant-unique-indexes.sql`, con rollback `.down.sql`) es independiente: solo retira restricciones UNIQUE duplicadas, `/ready` no la exige y puede aplicarse antes o después del despliegue. No ejecutar `scripts/migrate.js` con los `.down.sql` presentes; aplicar los archivos uno a uno.
3. Desplegar el backend y confirmar `GET /ready` → `{"status":"ready"}`. Si responde `503`, `missingSchema` indica exactamente qué falta.
4. Desplegar el frontend (`VITE_API_URL` apunta al backend; se resuelve al compilar, así que cambiarla exige un nuevo build).

Cómo identificar qué corre en cada servicio sin adivinar:
- Backend: `GET /ready` (200/503 y `missingSchema`); y `GET /api/ofertas-curso/disponibles` sin token debe dar `403` con el mensaje "No se proporcionó ningún token." (y `401` con token inválido), no `404` "Ruta no encontrada" (un `404` indica backend anterior al PR #5).
- Frontend: en el panel de Render, el commit de cada despliegue; en el navegador, Network: el host de las solicitudes es el de `VITE_API_URL`.
- Un error "No fue posible conectar" significa que no hubo respuesta HTTP (proceso reiniciando o arranque en frío con 502 sin cabeceras CORS, DNS/URL incorrecta o CORS). Si otras pantallas del mismo origen reciben 401/403/404 legibles, la URL y CORS son correctas y el fallo es puntual (502/503, timeout o proceso caído).

Variables del backend en producción: `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`, `FRONTEND_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`; `APP_URL` es informativa (ver arriba). `render.yaml` solo declara algunas; `FRONTEND_URL` y las `R2_*` deben existir en el panel de Render. Frontend: `VITE_API_URL`.
