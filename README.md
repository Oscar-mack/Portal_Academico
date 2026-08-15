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
- **Pago**: pertenece a un Alumno; guarda el `stripeSessionId` y su `estado`.

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
`sequelize.sync()`. Si falla, Render mostrará el nombre, mensaje, código y detalle
del error en sus logs, sin imprimir la contraseña.

## Scripts disponibles

```
npm run dev    # levanta el servidor con .env.development
npm run prod   # levanta el servidor con .env.production
npm start      # equivalente a npm run dev (NODE_ENV por defecto: development)
```


