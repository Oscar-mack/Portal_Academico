# Propuesta para tareas y archivos académicos

## Estado actual

El proyecto tiene evaluaciones con puntajes y calificaciones individuales, pero no tiene un modelo de tareas, fechas de publicación o vencimiento, instrucciones, entregas, ni filtros por vencimiento. `AsignacionCurso` representa la inscripción de un alumno a un curso/período; no representa una actividad.

El centro de documentos existente genera PDFs académicos/financieros. No tiene un selector de archivos ni rutas multipart, servicio de almacenamiento, metadatos de archivos compartidos o entregados, ni descargas de entregas. No se debe presentar ese centro como un sistema de carga documental.

## Modelo y rutas propuestos

| Recurso | Modelo sugerido | Rutas sugeridas |
|---|---|---|
| Tarea | `Tarea`: curso, período, catedrático responsable, título, descripción, instrucciones, `publicadaEn`, `fechaLimite`, estado y auditoría | `POST /api/cursos/:cursoId/tareas`, `GET /api/tareas`, `GET /api/tareas/:id`, `PUT /api/tareas/:id`, `DELETE /api/tareas/:id` |
| Destinatarios | `TareaAlumno`: tarea e inscripción (`asignacionCursoId`), con índice único | El servidor crea los destinatarios desde las inscripciones del mismo curso/período al publicar; no acepta una lista arbitraria de IDs del cliente |
| Entrega | `EntregaTarea`: destinatario, alumno, recurso almacenado y fecha de entrega; conserva versiones si se permiten reenvíos | `POST /api/tareas/:id/entregas`, `GET /api/tareas/:id/entregas` para el docente autorizado, `GET /api/tareas/:id/mi-entrega` para el alumno |
| Material de curso | `MaterialCurso`: curso, período, docente, título, descripción y recurso almacenado | `POST /api/cursos/:cursoId/materiales`, `GET /api/cursos/:cursoId/materiales`, `DELETE /api/materiales/:id` |
| Archivo | `Archivo`: clave privada del objeto, nombre original saneado, MIME, tamaño, hash, propietario y relación de dominio | `POST /api/archivos/subidas`, `POST /api/archivos/:id/confirmar`, `GET /api/archivos/:id/descarga` |

Las rutas no deben permitir que un cliente elija `alumnoId`, `catedraticoId` o una inscripción ajena. El servidor obtiene la identidad del JWT y verifica la inscripción exacta al curso/período. Para docentes, exige que el horario/asignación del docente coincida con el curso y período. Los cambios requieren período abierto; al cerrar el período se conservan tareas, entregas y materiales históricos.

## Validaciones y autorización

- Título e instrucciones con límites de longitud; fecha límite posterior a publicación; destinatarios solo con inscripción del mismo curso y período. Si se requiere distinguir inscripciones activas de históricas, primero habrá que definir ese estado porque el modelo actual no lo contiene.
- Estado del alumno calculado en servidor: pendiente, entregada o vencida según entrega y fechas. Las notas de una evaluación y las notas finales publicadas siguen siendo recursos separados.
- Allowlist de extensiones y MIME, comprobación de firma del contenido, tamaño máximo configurable y nombres de objeto generados por el servidor. Rechazar contenido ejecutable y no confiar en el MIME declarado por el navegador.
- Acceso de alumnos limitado a sus propias tareas, materiales y entregas; docentes solo acceden a cursos/períodos que tienen asignados; padres no reciben acceso hasta que exista una política explícita para las tareas.
- Descargas privadas mediante autorización de API y URL firmada de vida corta. Registrar actor, recurso y operaciones de carga/descarga en auditoría.

## Almacenamiento y despliegue

Usar almacenamiento de objetos persistente compatible con el despliegue (por ejemplo, S3/R2 o un servicio equivalente), no memoria del proceso, disco efímero de Render ni base64 en tablas. Guardar solo metadatos y una clave privada en PostgreSQL. Las credenciales y límites se configurarían mediante secretos de despliegue autorizados; esta propuesta no cambia Render, Neon ni variables de entorno.

Antes de habilitar cargas se debe elegir el proveedor, definir límites institucionales, retención y política de antivirus, crear migraciones reversibles e integrar pruebas del servicio. No se ejecutó ni se debe ejecutar ninguna migración de producción como parte de esta revisión.

## Reutilización existente

`GET /api/evaluaciones` ya existe y ahora admite acceso de alumno restringido a sus inscripciones de curso/período, incluyendo solo su propio puntaje individual. `POST /api/evaluaciones`, `PUT /api/evaluaciones/:id`, `GET/POST /api/evaluaciones/:id/calificaciones`, `GET /api/notas` y `GET /api/dashboard` se mantienen para sus funciones actuales. Ninguna ruta actual cubre tareas, entregas de archivos o materiales compartidos.
