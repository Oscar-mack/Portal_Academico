-- Agrega las columnas de control de intentos de login a una tabla "usuarios" existente.
-- Idempotente y sin pérdida de datos: las filas actuales quedan con intentosFallidos = 0.
-- sequelize.sync() no altera tablas ya creadas, por eso estas columnas pueden faltar en Neon.
BEGIN;

ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "intentosFallidos" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "bloqueadoHasta" TIMESTAMP WITH TIME ZONE NULL;
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "ultimoLogin" TIMESTAMP WITH TIME ZONE NULL;
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "activo" BOOLEAN DEFAULT TRUE;

COMMIT;
