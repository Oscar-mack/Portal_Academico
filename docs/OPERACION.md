# Operación: ambientes, backups, monitoreo, despliegue

## Ambientes
| Ambiente | NODE_ENV | Base de datos | Stripe | Notas |
|---|---|---|---|---|
| Desarrollo | development | PostgreSQL local | claves `sk_test_` | CORS abierto permitido |
| Pruebas (CI) | test | SQLite en memoria (automático) | simulado | `npm test` |
| Producción | production | PostgreSQL administrado | claves `sk_live_` | CORS exacto, HTTPS, secretos en el gestor del hosting |

En producción `server.js` se niega a iniciar si falta `JWT_SECRET` (>=32 caracteres), `CORS_ORIGIN` (distinto de `*`),
`APP_URL` (https), `STRIPE_SECRET_KEY` o `STRIPE_WEBHOOK_SECRET`. Nunca versionar `.env`.

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
- HTTPS/TLS lo termina el proveedor; `APP_URL` y `CORS_ORIGIN` deben ser https.
- Rollback: redeploy de la imagen/commit anterior. Antes de cambios de esquema, tomar backup.
- Pendiente: el esquema se crea con `sequelize.sync()`; para producción formal conviene adoptar migraciones (sequelize-cli).
- Stripe: registrar el endpoint `https://<APP_URL>/api/pagos/webhook` y el evento `checkout.session.completed` y `checkout.session.expired`.
