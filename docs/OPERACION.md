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
- HTTPS/TLS lo termina el proveedor; `APP_URL`, `FRONTEND_URL` y `CORS_ORIGIN` deben corresponder a dominios HTTPS.
- Rollback: redeploy de la imagen/commit anterior. Antes de cambios de esquema, tomar backup.
- Pendiente: el esquema se crea con `sequelize.sync()`; para producción formal conviene adoptar migraciones (sequelize-cli).
- Stripe: registrar el endpoint `https://<APP_URL>/api/pagos/webhook` y los eventos `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `refund.created`, `refund.updated` y `refund.failed`. Los eventos de reembolso reconcilian el pago si Stripe completó el reembolso y la escritura local falló; el webhook debe devolver un error no-2xx ante fallos de base de datos para que Stripe reintente. Checkout devuelve al frontend en `FRONTEND_URL`; el estado solo se confirma mediante el webhook firmado y se consulta con `GET /api/pagos`.
