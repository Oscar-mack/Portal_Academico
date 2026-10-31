# Fase 2: tareas académicas y gestión de archivos

## Estado de esta rama

La implementación local integra tareas, entregas de alumnos y materiales de curso con las asociaciones académicas existentes. El código y la migración son una propuesta de revisión: **no se ejecutó SQL ni se cambió Neon Production, Render, variables de entorno, credenciales, despliegues, pagos, commits ni push**. La rama debe seguir sin integrar hasta que se revisen y aprueben el esquema, proveedor y configuración.

El cambio de evaluaciones de la fase anterior se mantiene separado: una evaluación es un componente de calificación; una tarea es una actividad con instrucciones, fechas y entrega de archivo; una nota final publicada es un tercer recurso distinto.

## Arquitectura implementada

- `Tarea` se relaciona con un curso, período y docente responsable. Los destinatarios no se guardan en una lista manipulable por el cliente: se derivan de `asignaciones_cursos` al consultar y mostrar el roster.
- `EntregaTarea` vincula alumno, tarea, archivo y fecha de entrega. Las versiones se conservan; el último envío determina el estado visible.
- `MaterialCurso` vincula el archivo compartido al curso y período, con docente y estado activo.
- `AdjuntoTarea` vincula archivos de instrucciones a la tarea.
- `ArchivoAcademico` conserva metadatos y una clave privada de almacenamiento. `AuditoriaTarea` registra operaciones de carga y cambios.
- Las asociaciones Sequelize se registran en `app/models/index.js`; los controladores y las rutas están en `app/controllers` y `app/routes`.
- En el frontend se integró `AcademicWorkPage` al menú y al servicio compartido `academicWorkService`. El docente puede crear/editar/desactivar tareas, adjuntar documentos, publicar materiales y revisar estado/entregas de alumnos. El alumno ve tareas y materiales de sus inscripciones/períodos, filtra sus estados y entrega archivos. El administrador tiene consulta institucional de solo lectura.

## Endpoints implementados

| Método y ruta | Acceso | Comportamiento |
|---|---|---|
| `GET /api/tareas?cursoId=&periodoAcademicoId=&estado=` | admin, docente, alumno | Alumno: tareas publicadas para sus inscripciones exactas y estado de su propia entrega. Docente: tareas de sus horarios; admin: consulta institucional. |
| `POST /api/tareas` | docente; admin con `catedraticoId` | Crear con curso, período, título, descripción, instrucciones y fechas. Curso/período y horario docente se validan en backend. |
| `GET /api/tareas/:id` | admin, docente, alumno inscrito | Detalle seguro, incluyendo adjuntos; al alumno solo se devuelve su propia entrega. |
| `PUT /api/tareas/:id` | docente responsable; admin | Editar texto/fechas mientras el período está abierto y todavía no hay entregas. |
| `DELETE /api/tareas/:id` | docente responsable; admin | Desactivación lógica. No se permite si existen entregas. |
| `POST /api/tareas/:id/adjuntos` | docente responsable | Carga de un adjunto privado para la tarea. |
| `GET /api/tareas/:id/entregas` | docente responsable; admin | Lista inscritos del curso/período y estado; expone archivos de entrega solo a personal autorizado. |
| `POST /api/tareas/:id/entregas` | alumno inscrito | Carga entrega con plazo y período abierto; el servidor obtiene la identidad del JWT. |
| `GET /api/tareas/:id/mi-entrega` | alumno | Devuelve la entrega propia o `null`; otras inscripciones reciben 403. |
| `GET /api/materiales?cursoId=&periodoAcademicoId=` | admin, docente, alumno inscrito | Lista materiales activos en sus cursos/períodos autorizados. |
| `POST /api/materiales/cursos/:cursoId?periodoAcademicoId=` | docente responsable | Publica un material con título, descripción y archivo. |
| `DELETE /api/materiales/:id` | docente propietario | Desactivación lógica en período abierto. |
| `GET /api/archivos-academicos/:id/descarga` | admin, docente autorizado, alumno autorizado | Autoriza el recurso y genera URL privada firmada con vencimiento de 60 segundos. |

No se agregó acceso de padre/tutor a tareas ni archivos. Tampoco se agregaron endpoints ficticios ni se reutilizaron endpoints de asignación de cursos como si fueran tareas.

## Permisos y reglas

- JWT y middleware por rol siguen siendo obligatorios. El backend resuelve el perfil activo desde el usuario autenticado; no confía en un `alumnoId` enviado por el alumno.
- Inscripciones, tareas, horarios y materiales deben coincidir en curso y período. Los docentes solo gestionan tareas de su perfil y horario; la creación exige horario exacto.
- Las escrituras requieren período abierto. Las fechas deben estar dentro del período y el límite debe ser posterior a la publicación.
- Solo se publican tareas activas cuando llega la fecha de publicación. La entrega requiere inscripción exacta, plazo vigente y período abierto.
- El estado de tarea para el alumno se calcula en servidor (`pendiente`, `entregada`, `vencida`). Las entregas pertenecen únicamente al alumno autenticado. La descarga de archivos también revalida el contexto.
- El cambio de inscripciones relacionadas con tareas conserva historial; la migración usa claves foráneas restrictivas y trigger de validación.
- Las cargas aceptan PDF, DOCX, XLSX, PPTX, TXT, JPG/JPEG y PNG; se valida extensión, MIME declarado y firma inicial, con límite de 20 MiB por archivo y hash SHA-256. El cliente no puede escoger la clave de almacenamiento.
- **Limitación de seguridad pendiente:** validar firmas iniciales no inspecciona el contenido interno de archivos Office/ZIP ni detecta malware. Antes de operación institucional se recomienda integrar antivirus/escaneo y política de cuarentena/retención; no se afirma que exista antivirus en esta implementación.

## Almacenamiento y operación

La integración usa Cloudflare R2 mediante la API S3 compatible de AWS SDK. Los objetos son privados; la API retransmite la carga mediante streaming, por lo que puede aplicar el límite antes de finalizar la persistencia. No se usa memoria completa del archivo ni disco local de Render. En PostgreSQL quedan metadatos y la clave privada; el cliente solo recibe una URL firmada breve después de una autorización.

Variables requeridas **solo para configurar posteriormente el backend**, nunca en el frontend ni en Git:

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
```

Crear un bucket privado y credenciales limitadas a ese bucket, guardar secretos en el gestor de secretos del despliegue, rotarlos y no compartirlos. No se añadieron valores ni se cambiaron entornos existentes. Si no se configura R2, las cargas fallan explícitamente con HTTP 503; no hay almacenamiento simulado.

Precios consultados para la propuesta, sujetos a región/tarifa vigente, impuestos y cambios del proveedor: R2 Standard publica aproximadamente US$0.015/GB-mes, operaciones Clase A US$4.50 por millón y Clase B US$0.36 por millón, con 10 GB-mes, 1 millón A y 10 millones B de nivel gratuito mensual y egreso a Internet sin cargo. AWS S3 Standard publica aproximadamente US$0.023/GB-mes en regiones de referencia y puede cobrar transferencia de salida. Confirmar cotización y tier en el momento de adoptar.

Fuentes oficiales:

- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [R2 límites](https://developers.cloudflare.com/r2/platform/limits/)
- [URLs prefirmadas R2](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [S3 pricing](https://aws.amazon.com/s3/pricing/)

## Esquema propuesto

La migración aditiva `scripts/migrations/005-academic-tasks-and-files.sql` crea:

- `tareas`: curso, período, docente, contenido, fechas y estado.
- `archivos_academicos`: clave del objeto, nombre, MIME, tamaño, SHA-256 y usuario que cargó.
- `adjuntos_tarea`: relación tarea-archivo.
- `materiales_curso`: archivo compartido asociado a curso/período/docente.
- `entregas_tarea`: tarea, alumno, archivo y fecha; conserva múltiples envíos.
- `auditoria_tareas`: actor, acción, recurso y detalle; trigger impide actualizar o borrar auditoría.
- Índices de consulta y triggers para validar horario/período y entrega/inscripción/plazo.

La migración no se ejecutó en ninguna base de datos. Debe revisarse con el esquema real antes de aprobar: nombres plurales de tablas existentes, claves foráneas, índices, semántica de períodos, consistencia de triggers y estrategia de reversión. Los triggers no reemplazan las validaciones del controlador.

## Evaluaciones y límites conocidos

`GET /api/evaluaciones` para alumnos se limita a las combinaciones curso/período de sus inscripciones y devuelve solo su calificación. Las pantallas existentes muestran curso, evaluación y puntaje máximo y distinguen la evaluación individual de la nota final publicada (`GET /api/notas`). Docente/admin conservan sus rutas de creación y calificación bajo autorización. La suite contiene pruebas de alumno inscrito, no inscrito y rol no autorizado; no se agregaron permisos generales.

Las limitaciones de esta fase son: no se probaron credenciales ni operaciones reales de R2; no se desplegó el esquema; no hay antivirus; no existe acceso de padres; el roster se basa en las inscripciones almacenadas (el modelo actual no expone estado de inscripción); el cliente no ofrece reenvío visible tras una primera entrega aunque el backend conserva versiones; y se debe revisar si la fecha límite inclusive y la configuración horaria coinciden con la política institucional.

## Pruebas locales

La prueba de integración añade cobertura del flujo docente-alumno, filtros de estado, curso/período, autorización, archivos falsos con MIME permitido, descarga firmada y aislamiento de entregas. El servicio R2 se sustituye por un stub local en esa prueba; no valida conectividad con proveedor real.

Comandos de validación desde esta rama:

```bash
cd frontend && npm run typecheck
cd frontend && npm run build
cd .. && npx --yes node@22 --test test/integracion.test.js
```

No ejecutar `scripts/migrations/005-academic-tasks-and-files.sql` hasta aprobación expresa.

## Validación de la migración 005 (PostgreSQL 16 local desechable)

Se probó en un contenedor Docker descartable (nunca contra Neon). Esquema base: `sequelize.sync()` con los modelos previos a la migración 002, seguido de 001→005.

- Verificado: creación de 6 tablas, 16 FK (`ON DELETE RESTRICT`), índices, CHECK (`fechaLimite > fechaPublicacion`, título no vacío, tamaño 1..20 MiB) y UNIQUE (`storageKey`, `archivoId`).
- Triggers: rechazan tarea sin horario docente/curso/período, tarea en período cerrado, entrega de alumno no inscrito, fuera de plazo o a tarea inactiva; aceptan los casos válidos; la auditoría rechaza UPDATE/DELETE.
- Los modelos Sequelize consultan correctamente las tablas migradas.
- `005-...down.sql`: se bloquea si hay datos; sin datos elimina solo los objetos de 005 y deja intactas 002–004; la migración se puede reaplicar.

No verificado: ejecución contra una copia real de Neon (puede diferir del esquema base reconstruido), pruebas de carga/concurrencia, ni R2 real.
