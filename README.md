# Portal Académico — Backend

API REST para la gestión académica de un colegio o universidad: catedráticos,
alumnos, cursos, grados/carreras, asignaciones, notas, reportes (PDF e
indicadores) y pagos en línea.

**Stack:** Node.js · Express 5 · Sequelize · PostgreSQL (Neon) · JWT · bcryptjs
· PDFKit · Stripe

## Estructura del proyecto

```
portal-academico-backend/
├── app/
│   ├── config/
│   │   ├── auth.config.js        # Secreto y expiración de JWT
│   │   ├── db.config.js          # Conexión a PostgreSQL (Neon)
│   │   └── roles.js              # Constantes de roles: admin, catedratico, alumno, padre
│   │
│   ├── models/
│   │   ├── index.js              # Instancia de Sequelize + todas las asociaciones
│   │   ├── usuario.model.js      # Cuentas de acceso (login), con rol
│   │   ├── catedratico.model.js
│   │   ├── alumno.model.js
│   │   ├── gradoCarrera.model.js
│   │   ├── curso.model.js
│   │   ├── asignacionCurso.model.js     # Inscripción alumno <-> curso
│   │   ├── horarioCatedratico.model.js  # Asignación catedrático <-> curso + horario
│   │   ├── nota.model.js         # Calificaciones (calcula Aprobado/Reprobado automáticamente)
│   │   ├── padreAlumno.model.js  # Relación padre/tutor <-> alumno(s)
│   │   └── pago.model.js         # Pagos de colegiatura / servicios
│   │
│   ├── controllers/
│   │   ├── auth.controller.js        # signup, signin, perfil
│   │   ├── catedratico.controller.js # CRUD
│   │   ├── alumno.controller.js      # CRUD
│   │   ├── gradoCarrera.controller.js# CRUD
│   │   ├── curso.controller.js       # CRUD
│   │   ├── asignacionCurso.controller.js    # Asignar cursos a alumnos
│   │   ├── horarioCatedratico.controller.js # Asignar cursos/horarios a catedráticos
│   │   ├── nota.controller.js        # Registro/consulta de notas con reglas de negocio
│   │   ├── reporte.controller.js     # Reporte por catedrático, indicadores, boleta PDF
│   │   └── pago.controller.js        # Sesión de pago y webhook de Stripe
│   │
│   ├── routes/                   # Un archivo de rutas por recurso, con sus middlewares de rol
│   │
│   ├── middlewares/
│   │   ├── authJwt.js            # verifyToken + verificación de roles (isAdmin, isCatedratico, ...)
│   │   ├── verifySignup.js       # Evita usuarios/emails duplicados y roles inválidos
│   │   └── index.js
│   │
│   └── utils/
│       └── pdfGenerator.js       # Generación de la boleta de notas en PDF (PDFKit)
│
├── server.js                     # Punto de entrada: carga .env, registra rutas, sync BD
├── package.json
├── .env.example                  # Plantilla de variables — copiar a .env.development / .env.production
└── .gitignore
```

## Modelo de datos (resumen)

- Un **Alumno** pertenece a un **GradoCarrera** (RN-01).
- Un **Curso** pertenece a un **GradoCarrera** (RN-02).
- **Alumno ↔ Curso**: N:M a través de `AsignacionCurso` (inscripción).
- **Catedratico ↔ Curso**: N:M a través de `HorarioCatedratico` (día/hora/periodo).
- **Nota**: pertenece a Alumno + Curso + Catedrático; su campo `estado`
  (Aprobado/Reprobado) se calcula automáticamente según `valor`
  (0–60 reprobado, 61–100 aprobado — RN-06/RN-07).
- **Usuario**: cuenta de acceso con `rol` (admin/catedratico/alumno/padre);
  se vincula opcionalmente a un Catedrático o Alumno, o a varios Alumnos si
  el rol es `padre` (tabla `PadreAlumno`).
- **Pago**: pertenece a un Alumno y puede relacionarse con un Cargo; guarda el
  `stripeSessionId` y su `estado`.
- **Ciclo/Período académico**: agrupa horarios, asignaciones y evaluaciones sin
  reemplazar el texto histórico `periodo`.
- **Evaluación/Calificación**: soporta varias evaluaciones por curso y período,
  limita la suma a 100 y consolida la nota final al completar todas las
  evaluaciones activas.
- **Cargo/Pago**: separa la obligación del abono; el saldo se deriva de pagos
  confirmados. Los eventos Stripe se guardan para procesar webhooks de forma
  idempotente.
- **Auditoría de notas**: conserva cambios de notas finales calculadas y los
  deja como borrador cuando una calificación individual cambia.
- **Requisito de solvencia documental**: permite configurar los tipos de
  documento que requieren solvencia; aún no administra archivos cargados.

## Seguridad (JWT + Roles)

Todas las rutas, salvo `signup`/`signin`, requieren un token JWT válido
(`Authorization: Bearer <token>`). Cada ruta además exige uno o varios roles
específicos mediante los middlewares de `app/middlewares/authJwt.js`:

- `isAdmin` — solo Administrador (gestión de catálogos: catedráticos, alumnos,
  cursos, grados/carreras, asignaciones).
- `isAdminOrCatedratico` — registro/edición de notas.
- `isAnyRole` — cualquier usuario autenticado; la visibilidad exacta de los
  datos (por ejemplo, qué notas puede ver cada quien) se filtra dentro de
  cada controlador según `req.userRole` y `req.userId` (RN-05, RN-08).

## Endpoints principales

| Recurso | Base | Roles con acceso de escritura |
|---|---|---|
| Autenticación | `/api/auth` | público (signup/signin) |
| Grados/Carreras | `/api/grados-carreras` | admin |
| Catedráticos | `/api/catedraticos` | admin |
| Alumnos | `/api/alumnos` | admin |
| Cursos | `/api/cursos` | admin |
| Asignación curso→alumno | `/api/asignaciones-curso` | admin |
| Asignación curso→catedrático | `/api/horarios-catedratico` | admin |
| Notas | `/api/notas` | admin, catedrático (solo su curso) |
| Reportes | `/api/reportes/...` | admin, catedrático, alumno, padre (según reporte) |
| Pagos (Stripe) | `/api/pagos` | alumno, padre (de sus propios hijos) |
| Ciclos y períodos | `/api/ciclos`, `/api/periodos` | admin |
| Evaluaciones y calificaciones | `/api/evaluaciones` | admin, catedrático asignado |
| Cargos y solvencia | `/api/cargos` | admin (escritura), alumno o padre autorizado (consulta/pago) |
| Dashboard | `/api/dashboard` | todos los roles autenticados, con datos filtrados por rol |
| Estado de cuenta | `/api/reportes/estado-cuenta-pdf/:alumnoId` | admin, alumno propio, padre autorizado |
| Alumnos vinculados | `/api/padres-alumnos/mis-alumnos` | padre/tutor autenticado |
| Requisitos de solvencia documental | `/api/requisitos-solvencia` | consulta autenticada; administración de requisitos por admin |

### Visibilidad de horarios, notas y boletas

- `GET /api/horarios-catedratico` limita los resultados al docente autenticado o
  a los cursos inscritos del alumno. Un padre puede filtrar por `alumnoId`
  únicamente si ese alumno está vinculado a su cuenta. `periodo` es opcional.
- `GET /api/notas` permite que alumnos y padres consulten solo calificaciones
  publicadas. Si un padre solicita explícitamente un alumno no vinculado, recibe
  `403`.
- `GET /api/reportes/boleta-pdf/:alumnoId` incluye solo notas publicadas para
  alumnos y padres. Para catedráticos, limita la boleta a sus cursos asignados
  en los que está inscrito el alumno.
- `GET /api/dashboard` devuelve indicadores según el rol: administración,
  cursos del catedrático, datos propios del alumno o resúmenes únicamente de
  los alumnos vinculados al padre/tutor.
- `GET /api/reportes/estado-cuenta-pdf/:alumnoId` genera el estado de cuenta
  con cargos, pagos, saldo y moneda; no permite a un catedrático consultar
  información financiera.

### Ciclos, evaluaciones y pagos

- Los ciclos agrupan períodos con fechas no traslapadas; asignaciones y
  horarios conservan el campo histórico `periodo` y aceptan el nuevo
  `periodoAcademicoId` nullable. Las notas históricas no se reescriben; las
  notas finales consolidadas desde evaluaciones quedan asociadas al período
  académico y la captura manual existente sigue usando `periodo`.
- Las calificaciones individuales se validan contra el máximo de su evaluación
  y contra la inscripción del alumno. La nota final se consolida al completar
  las evaluaciones activas (máximo acumulado de 100) y se mantiene como borrador
  hasta su publicación.
- Los cargos son independientes de los pagos. El saldo se calcula desde los
  pagos confirmados; Checkout usa `cargoId` y el servidor valida cualquier
  abono. La moneda de cargos está limitada a `GTQ` y `USD` para conservar la
  precisión de dos decimales.
- Los pagos históricos sin `cargoId` se conservan sin asignarles cargos
  ficticios. Se muestran como pagos pendientes de conciliación, no reducen los
  saldos de cargos nuevos y bloquean la declaración de solvencia hasta que se
  revisen y concilien manualmente.
- La configuración en `/api/requisitos-solvencia` indica qué tipos de documento
  requieren solvencia. El portal todavía no registra ni valida documentos
  cargados, por lo que esa configuración no sustituye un flujo de documentos.

### Migraciones de base de datos

Las migraciones 002 y 003 están preparadas en
[`scripts/migrations/`](./scripts/migrations/), junto con sus scripts de
reversión. **No se han ejecutado en Neon ni en producción.** Antes de aplicarlas,
revisa los SQL completos y la consulta de preflight de montos en la migración
003; respalda la base y prueba primero en una copia PostgreSQL. La reversión
003 bloquea si ya existen cargos, eventos, pagos asociados o pagos fallidos;
además, devolver `NUMERIC(12,2)` a `DOUBLE PRECISION` no es una conversión sin
pérdida. La migración 002 valida la inscripción y el máximo de cada
calificación mediante triggers PostgreSQL; estas restricciones no se ejercitan
con la suite SQLite y deben verificarse en una instancia PostgreSQL aislada.

`GET /health` comprueba que el proceso responde. `GET /ready` valida la conexión
y el esquema requerido por las migraciones 002 y 003, incluidos sus triggers;
responde `503` si faltan tablas, columnas o triggers. En Render, configura un
health check en `/ready` para que una instancia con una migración incompleta no
reciba tráfico.

## Variables de entorno

Para desarrollo local, copia `.env.example` como `.env.development` y completa
tus propias credenciales. Esos archivos están excluidos del control de versiones
en `.gitignore`.

En Render no se usa ninguna carpeta ni archivo `.env`: configura los secretos en
**Render → tu servicio → Environment**. Para Neon, la opción recomendada es crear
`DATABASE_URL` y pegar la cadena de conexión completa que entrega Neon con SSL.
Como alternativa, puedes crear las variables que muestra el panel de Neon:
`PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGPORT` y `PGSSLMODE=require`.
También se mantienen compatibles `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
y `DB_PORT`.

Debes añadir además todas las variables usadas por la aplicación, especialmente
`JWT_SECRET`, `JWT_EXPIRES_IN`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`CORS_ORIGIN` y `APP_URL` cuando correspondan. Nunca subas contraseñas ni
credenciales al repositorio.

Al iniciar, la API autentica Sequelize, ejecuta `SELECT 1` y sólo después usa
`sequelize.sync()` solo en desarrollo. En producción no se altera automáticamente
el esquema: las migraciones SQL versionadas de `scripts/migrations/` deben revisarse,
respaldarse y aplicarse explícitamente antes de desplegar código que dependa de ellas.
Si falla la conexión, Render mostrará el nombre, mensaje, código y detalle del error
en sus logs, sin imprimir la contraseña.

## Scripts disponibles

```
npm run dev    # levanta el servidor con .env.development
npm run prod   # levanta el servidor con .env.production
npm start      # equivalente a npm run dev (NODE_ENV por defecto: development)
```

En Render, el comando de inicio debe ser `npm start`.
