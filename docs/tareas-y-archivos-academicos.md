# Fase 2: tareas académicas y gestión de archivos

## Estado de esta rama

La rama de revisión integra evaluaciones, tareas, entregas, materiales, autoinscripción y pagos. Las migraciones 001–006 se probaron en PostgreSQL local desechable; nunca se ejecutaron en Neon Production. No se cambiaron Render, variables de entorno reales, credenciales ni despliegues.

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

Crear un bucket privado y credenciales limitadas a ese bucket, guardar secretos en el gestor de secretos del despliegue, rotarlos y no compartirlos. No se añadieron valores ni se cambiaron entornos existentes. Si no se configura el almacenamiento, las cargas fallan explícitamente con HTTP 503; no hay almacenamiento simulado.

### Selección de proveedor (`STORAGE_PROVIDER`)

`app/services/r2Storage.js` mantiene el mismo contrato (`uploadObject`, `removeObject`, `createDownloadUrl`, `ensureConfigured`) para tareas, adjuntos, materiales y descargas. El proveedor se elige solo con `STORAGE_PROVIDER`; nunca se deduce de las variables presentes:

| `STORAGE_PROVIDER` | Proveedor | Variables que lee (únicamente estas) |
|---|---|---|
| vacío o ausente, `r2` | Cloudflare R2 (predeterminado) | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` |
| `s3` | Almacenamiento compatible con S3 (p. ej. Supabase Storage, entorno de ensayo) | `S3_ENDPOINT` (URL `https://`), `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` |
| `supabase` | API nativa de Supabase Storage (`@supabase/supabase-js`, solo entorno de ensayo) | `SUPABASE_URL` (`https://<ref>.supabase.co`), `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET` |
| `gdrive` | Google Drive vía OAuth 2.0 (scope `drive.file`, solo entorno de ensayo, archivos pequeños) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `GOOGLE_REFRESH_TOKEN_ENC`, `APP_URL`, `FRONTEND_URL`, `JWT_SECRET`; opcionales `GOOGLE_DRIVE_FOLDER_ID`, `GOOGLE_TOKEN_STORE_PATH`, `GOOGLE_DRIVE_MAX_FILE_BYTES` |

- Los grupos `R2_*` y `S3_*` son independientes: no hay respaldo cruzado de credenciales.
- Falta una variable del proveedor activo, `S3_ENDPOINT` no es `https` o el valor de `STORAGE_PROVIDER` es inválido: HTTP 503 controlado. El detalle (solo nombres de variables, nunca valores) se registra en el log del servidor.
- Si `S3_ENDPOINT` apunta a un host `*.supabase.co`, debe terminar en `/storage/v1/s3` (p. ej. `https://<ref>.storage.supabase.co/storage/v1/s3`); sin ese path Supabase responde JSON de su API REST y el SDK falla al interpretarlo como XML. También se rechazan endpoints con usuario/contraseña. Otros proveedores S3 no tienen esta exigencia.
- Los fallos del proveedor (respuesta no XML, credenciales o permisos rechazados, bucket inexistente, red) se devuelven al cliente como HTTP 503 con un mensaje genérico. El log del servidor registra solo `operacion`, `proveedor`, `host`, `status`, tipo de respuesta (`json`/`html`/`xml`/`texto`/`ninguna`), código seguro y `requestId`; nunca cabeceras, claves, URL firmadas ni el cuerpo de la respuesta. Los errores propios de la aplicación (413, 415, etc.) no se modifican.
- `S3_ACCESS_KEY_ID` y `S3_SECRET_ACCESS_KEY` se recortan (`trim`) y se rechazan con HTTP 503 si están vacías o contienen espacios o saltos de línea internos; el log nombra solo la variable, nunca su valor.
- Diagnóstico temporal `STORAGE_DEBUG_BODY=true` (desactivado por defecto; quitar tras diagnosticar): añade al log de fallos las longitudes (no los valores) de la clave y el secreto S3 y, solo para respuestas 4xx de texto, hasta 200 caracteres del cuerpo sin saltos de línea. Si el fragmento contiene algo que parezca JWT, firma, `Authorization`, cookie, URL, token largo o el valor de una credencial configurada, se registra `cuerpo=omitido`. Nunca se registran cuerpos de archivos ni respuestas completas.
- Con `s3` el cliente usa `forcePathStyle`, la región indicada y `requestChecksumCalculation`/`responseChecksumValidation` en `WHEN_REQUIRED`. R2 conserva su configuración original (región `auto`, endpoint derivado de `R2_ACCOUNT_ID`).
- Con `supabase` (`app/services/supabaseStorage.js`, delegado desde `r2Storage.js`): el backend usa `supabase-js` con la `service_role` (sin sesión persistente); el bucket sigue privado y las descargas siguen siendo URL firmadas de 60 s. Las claves `materials/<uuid>`, `tasks/<uuid>` y `submissions/<uuid>` se validan antes de cualquier llamada y no cambia `archivos_academicos.storageKey`. `supabase-js` no acepta un `Readable`, así que el archivo (ya limitado a 20 MiB, con 413 si se excede) se acumula en memoria con un máximo de 4 subidas simultáneas (≈80 MiB). Los errores del SDK se traducen al mismo 503 genérico; el log no incluye la `service_role`. Los archivos guardados en R2 o S3 no son legibles desde este proveedor. Ejemplo en Render de ensayo: `STORAGE_PROVIDER=supabase`, `SUPABASE_URL=https://<ref>.supabase.co`, `SUPABASE_SERVICE_ROLE_KEY=<secreto>`, `SUPABASE_BUCKET=portal-ensayo`. Nota: `supabase-js` descarta el cuerpo de errores que no son JSON y solo conserva el `statusText`.
- Al crear el cliente se registra el proveedor, el host del endpoint y el bucket (sin claves), para verificar en los logs que el servicio apunta al entorno correcto.
- Usar un proyecto y un bucket privado exclusivos de ensayo, con credenciales que no se compartan con Production. No se requieren migraciones SQL.

### Google Drive (`STORAGE_PROVIDER=gdrive`)

Implementado en `app/services/googleDriveStorage.js` (sin dependencias nuevas: usa `fetch`), `googleTokenStore.js`, `app/controllers/googleDrive.controller.js` y `app/routes/googleDrive.routes.js`. Es independiente de Supabase, R2 y S3; `r2Storage.js` solo delega según `STORAGE_PROVIDER`.

Rutas:

| Ruta | Acceso | Función |
|---|---|---|
| `POST /api/auth/google/iniciar` | Administrador (JWT) | Devuelve `authorizationUrl` (acceso `offline`, `prompt=consent`, scope `drive.file`, PKCE y `state` aleatorio de un solo uso, 10 min). |
| `GET /api/auth/google/callback` | Público (redirección de Google; protegido por `state`) | Canjea el código, guarda el refresh token cifrado y vuelve al portal administrativo con un resultado fijo (`authorized`, `cancelled`, `expired` o `error`), nunca con código ni detalle de Google. |
| `GET /api/auth/google/estado` | Administrador | Indica si hay autorización y si la carpeta es accesible. |
| `POST /api/auth/google/carpeta` | Administrador | Crea una carpeta propiedad de la app (`{"nombre"}` opcional) y la guarda como destino. |
| `GET /api/archivos-academicos/drive/:token` | Token firmado de 60 s | Descarga en streaming; el token lo emite `createDownloadUrl`. |

Configuración de ensayo que debe verificarse manualmente en Render (no usar dominios de producción):

- `CORS_ORIGIN`: origen HTTPS exacto del frontend de ensayo, sin ruta ni barra final. Al estar definido, sustituye la lista de desarrollo; no se añaden dominios de producción.
- `FRONTEND_URL`: la misma URL HTTPS de origen del frontend de ensayo, sin ruta ni barra final; el callback vuelve a `/portal`.
- `APP_URL`: `https://portal-academico-backend-ensayo.onrender.com` (dominio del backend de ensayo, usado para enlaces de descarga).
- `GOOGLE_REDIRECT_URI`: `https://portal-academico-backend-ensayo.onrender.com/api/auth/google/callback`.

El hostname concreto del frontend de ensayo depende del servicio estático existente y debe copiarse de su URL real en Render; no está fijado aquí. Para preparar el token localmente se requiere agregar temporalmente `http://localhost:8080/api/auth/google/callback` como URI adicional autorizada del mismo cliente OAuth en Google Cloud; luego se puede retirar.

En producción, configurar también explícitamente `CORS_ORIGIN` con el origen de producción necesario; no existe un allowlist de producción implícito. En desarrollo, solo si `CORS_ORIGIN` está ausente se usan los dos orígenes localhost. Los patrones específicos de Figma se rechazan por defecto y solo se aceptan al configurar `CORS_ALLOW_FIGMA_PREVIEWS=true`; para ensayo dejarlo ausente o `false`. Nunca se refleja `*`, incluso con credenciales habilitadas.

El panel `Google Drive` solo aparece al administrador. Inicia el flujo con `POST /api/auth/google/iniciar` usando `credentials: "include"` para guardar las cookies HttpOnly de `state`; el callback valida el estado, la cookie ligada al administrador y PKCE, y redirige a `${FRONTEND_URL}/portal?googleDrive=<resultado-fijo>`. El state/verificador vence a los 10 minutos; las cookies firmadas duran hasta 30 minutos únicamente para poder identificar y comunicar una autorización que ya expiró (no extienden la validez del state). Éxito, cancelación, expiración y error regresan sin código OAuth ni detalles de Google. Para el éxito, el frontend consulta `GET /api/auth/google/estado`; no considera el query string como prueba suficiente de autorización. Un state sin cookies/prueba válida se rechaza y no se marca como cancelación o éxito.

Al crear una carpeta, `persisted: true` significa que el identificador quedó guardado en el almacén local cifrado, pero la interfaz aún comprueba que el estado confirme que está accesible. Con `GOOGLE_REFRESH_TOKEN_ENC`, el almacén es de solo lectura y `persisted: false`: la interfaz muestra el ID de la carpeta creada y solicita configurar manualmente `GOOGLE_DRIVE_FOLDER_ID` en Render. Hasta que `GET /api/auth/google/estado` confirme la carpeta como accesible, no se presenta como lista para cargas.

Preparación de token cifrado para Render Free (el backend no escribe variables del proveedor):

1. En un entorno local protegido, configurar `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI=http://localhost:8080/api/auth/google/callback`, una clave aleatoria de cifrado de al menos 32 caracteres, `APP_URL=http://localhost:8080` y el resto de variables locales necesarias. No copiar los secretos al repositorio ni al chat.
2. Autorizar localmente como administrador mediante `POST /api/auth/google/iniciar`, enviar la solicitud desde el mismo navegador con `credentials: "include"`, abrir la URL devuelta en ese navegador y aceptar con la cuenta propietaria. El `state` queda ligado a cookies por flujo `HttpOnly`, `SameSite=Lax`, una de ellas firmada para el administrador iniciador, además de PKCE. El callback verifica el administrador, consume el estado una vez y rechaza el estado de otra sesión. CORS permite credenciales solo para los orígenes previamente permitidos. Si el servicio se reinicia, iniciar de nuevo.
3. Crear y probar una carpeta local con `POST /api/auth/google/carpeta`. Si se usa un almacén local, el ID queda cifrado con el token; con blob cifrado de entorno, la respuesta devuelve el ID y `persisted: false`, por lo que debe configurarse manualmente en `GOOGLE_DRIVE_FOLDER_ID`.
4. Conservar localmente `.secrets/google-drive-token.enc`, que está ignorado por Git y cifrado con AES-256-GCM. Para crear el valor de entorno, ejecutar `node scripts/export-google-refresh-token.js > .secrets/google-refresh-token.env`; el archivo resultante contiene solo `GOOGLE_REFRESH_TOKEN_ENC=<blob cifrado>`. Copiar el valor cifrado directamente desde ese archivo a la configuración privada del servicio Render, sin imprimirlo en logs, mensajes o tickets. El backend no puede actualizar variables de Render.
5. Configurar en el servicio de ensayo `GOOGLE_REFRESH_TOKEN_ENC` y la misma `GOOGLE_TOKEN_ENCRYPTION_KEY` usada para cifrarlo, junto con `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` del backend, `APP_URL`, `JWT_SECRET` y `STORAGE_PROVIDER=gdrive`. La clave y el blob son secretos distintos, aunque ambos se guardan en la configuración privada de Render. Configura `GOOGLE_DRIVE_FOLDER_ID` si el folder ID no está dentro del blob; esta variable explícita tiene prioridad.
6. La variable cifrada es de solo lectura y tiene prioridad sobre el archivo local. Para renovar el token, completar OAuth localmente, exportar un nuevo blob y reemplazar manualmente `GOOGLE_REFRESH_TOKEN_ENC` en Render. No configurar `GOOGLE_REFRESH_TOKEN` en texto plano; el backend lo rechaza.
7. Con `drive.file`, conocer el Folder ID de una carpeta creada manualmente no concede acceso. `POST /api/auth/google/carpeta` crea una carpeta bajo la cuenta autorizada por OAuth, no bajo una cuenta de servicio. Si se usa el blob de entorno de solo lectura, la respuesta devuelve el nuevo ID con `persisted: false`; configura ese ID en `GOOGLE_DRIVE_FOLDER_ID`. Para usar la carpeta existente se necesitaría Google Picker, no incluido.

Comportamiento y límites:

- El refresh token se mantiene cifrado (AES-256-GCM) tanto en el archivo local de permisos 0600 como en `GOOGLE_REFRESH_TOKEN_ENC`. El archivo es compatible con el flujo anterior y sirve como fuente local; en Render Free se usa el blob cifrado de entorno porque el sistema de archivos local es efímero. El código nunca intenta modificar Render.
- El `state` y el verificador PKCE viven en memoria por 10 minutos; el callback requiere la cookie `HttpOnly` del mismo navegador y consume el estado una sola vez. Reiniciar invalida flujos pendientes.
- La variable `GOOGLE_REFRESH_TOKEN` en texto plano está deshabilitada. El blob de entorno cifrado tiene prioridad sobre el archivo y es inmutable desde la aplicación; si existe, el flujo OAuth se debe completar localmente y luego exportar y actualizar el blob de forma manual. `GOOGLE_DRIVE_FOLDER_ID` explícita tiene prioridad sobre la carpeta dentro del almacén.
- Los objetos se nombran con la clave existente (`materials|tasks|submissions/<uuid>`) dentro de la carpeta; no cambia `archivos_academicos.storageKey`.
- Se aceptan solo los MIME de `FILE_TYPES`, máximo `GOOGLE_DRIVE_MAX_FILE_BYTES` (10 MiB por defecto; 413 si se excede). Para acotar memoria en Render Free, solo se permite una subida Google Drive simultánea **por proceso**; las demás reciben HTTP 429 y pueden reintentarse. El límite no es global entre varias instancias. Para esta práctica temporal, de bajo volumen y con archivos pequeños, una carga por proceso limita el consumo de memoria sin añadir Redis u otro servicio; no ofrece control distribuido si se ejecutan varias instancias. No bloquea operaciones de R2, S3 ni Supabase. La respuesta multipart de Google se consume antes de liberar el espacio de concurrencia.
- Las descargas usan un timeout para establecer conexión/recibir cabeceras; después no hay límite total, pero se corta si no llega ningún fragmento durante 20 segundos. Se aborta la petición a Google si el cliente cierra la conexión.
- `invalid_grant` al renovar responde que el administrador debe volver a autorizar. Datos cifrados corruptos o una clave incorrecta fallan cerrados; el endpoint de estado no devuelve tokens ni ciphertext. Si la carpeta no es accesible, el estado indica `accessible: false`. Si falla guardar el ID después de crearla, se informa que hay que configurar `GOOGLE_DRIVE_FOLDER_ID`.
- Los fallos de Google se registran con proveedor, host, estado, código seguro y origen; nunca tokens, cabeceras, URLs con credenciales ni cuerpos de respuesta.
- La pantalla OAuth está configurada como External/Testing: Google puede expirar los refresh tokens después de siete días mientras permanezca en Testing. Esta caducidad es aceptable para la práctica; no se cambia el estado de publicación.
- Las cuentas de Drive tienen cuota y límites de API propios; no es un almacenamiento para producción.

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

La migración 005 se aplicó y revirtió en una base PostgreSQL local desechable, no en producción. Antes de aprobarla todavía debe compararse con el esquema real de Neon; los triggers no reemplazan las validaciones del controlador.

## Evaluaciones y límites conocidos

`GET /api/evaluaciones` para alumnos se limita a las combinaciones curso/período de sus inscripciones y devuelve solo su calificación. Las pantallas existentes muestran curso, evaluación y puntaje máximo y distinguen la evaluación individual de la nota final publicada (`GET /api/notas`). Docente/admin conservan sus rutas de creación y calificación bajo autorización. La suite contiene pruebas de alumno inscrito, no inscrito y rol no autorizado; no se agregaron permisos generales.

Las limitaciones de esta fase son: no se probaron credenciales ni operaciones reales de R2; no se desplegó el esquema; no hay antivirus; no existe acceso de padres; el roster se basa en las inscripciones almacenadas (el modelo actual no expone estado de inscripción); el cliente no ofrece reenvío visible tras una primera entrega aunque el backend conserva versiones; y se debe revisar si la fecha límite inclusive y la configuración horaria coinciden con la política institucional.

## Pruebas locales

La prueba de integración añade cobertura del flujo docente-alumno, filtros de estado, curso/período, autorización, archivos falsos con MIME permitido, descarga firmada y aislamiento de entregas. El servicio R2 se sustituye por un stub local en esa prueba; no valida conectividad con proveedor real.

Comandos de validación desde esta rama:

```bash
cd frontend && npm run typecheck
cd frontend && npm run build
cd .. && npx --yes --package=node@22 --call 'npm test'
git diff --check
```

Resultado final: backend **50/50**, typecheck, build y `git diff --check` correctos. No ejecutar migraciones 005 ni 006 en Neon Production hasta aprobación expresa.

## Validación de la migración 005 (PostgreSQL 16 local desechable)

Se probó en un contenedor Docker descartable (nunca contra Neon). Esquema base: `sequelize.sync()` con los modelos anteriores a la migración 002, seguido de la secuencia 001→006.

- Verificado: creación de 6 tablas, 16 FK (`ON DELETE RESTRICT`), índices, CHECK (`fechaLimite > fechaPublicacion`, título no vacío, tamaño 1..20 MiB) y UNIQUE (`storageKey`, `archivoId`).
- Triggers: rechazan tarea sin horario docente/curso/período, tarea en período cerrado, entrega de alumno no inscrito, fuera de plazo o a tarea inactiva; aceptan los casos válidos; la auditoría rechaza UPDATE/DELETE.
- Los modelos Sequelize consultan correctamente las tablas migradas.
- `005-...down.sql`: se bloqueó al existir una tarea; sin datos eliminó solo los objetos de 005 y la migración se reaplicó correctamente.
- `006-...down.sql`: se bloqueó al existir una oferta; sin datos eliminó solo los objetos de 006 y la migración se reaplicó correctamente.
- Los tres triggers de 005 y los dos de 006 aceptaron los casos válidos y rechazaron los contextos incoherentes, la falta de inscripción/cupo y la modificación de auditoría.

No verificado: ejecución contra una copia real de Neon (puede diferir del esquema base reconstruido), pruebas de carga/concurrencia ni R2 real.

## Inscripción de cursos y pagos (cambios de revisión posteriores)

La inscripción anterior solo permitía POST administrativo y almacenaba alumno/curso/período; no existían secciones, cupos ni fechas de matrícula. Por eso se agregó una oferta de sección explícita en la migración aditiva `scripts/migrations/006-course-offerings-and-self-enrollment.sql`:

- `ofertas_curso` relaciona curso, catedrático y período; define código de sección, cupo máximo, intervalo de inscripción y estado.
- Los bloques de `horario_catedraticos` y las inscripciones de `asignacion_cursos` pueden relacionarse con `ofertaCursoId`; filas históricas quedan `NULL` y no se reclasifican.
- `GET /api/ofertas-curso/disponibles?periodoAcademicoId=` lista solo secciones del programa del alumno autenticado y comunica cupos, horario y motivos de no disponibilidad.
- `POST /api/asignaciones-curso` acepta autoinscripción de alumno únicamente con `{ ofertaCursoId }`. El servidor resuelve su alumno desde JWT y valida curso/programa, estado y fechas del período/sección, curso duplicado, cupos, horario configurado y cruces. La reserva bloquea la fila de oferta dentro de una transacción; un trigger PostgreSQL vuelve a proteger la capacidad.
- Admin crea/actualiza ofertas desde la interfaz, configura bloques de sección en Horarios docentes y conserva el flujo administrativo histórico de asignaciones. Los horarios de una sección no pueden cambiarse luego de que existan inscripciones.
- El `.down.sql` de 006 se bloquea si existen ofertas o asociaciones; no elimina filas históricas ni columnas previas. Se verificó localmente la secuencia 001→006, el bloqueo de la reversión con una oferta, la reversión sin ofertas y la reaplicación.

Pagos ya tenían rutas reales: `GET /api/cargos`, `GET /api/pagos` y `POST /api/pagos/checkout` permiten admin/alumno/padre según corresponda. Alumno se restringe a su perfil; el padre a alumnos vinculados. El concepto y monto provienen de cargos emitidos por administración (no existe catálogo de conceptos); el frontend muestra concepto, monto y moneda. Se mejoró el estado sin Stripe configurado a HTTP 503 con mensaje explícito, y la pantalla de retorno sigue consultando `GET /api/pagos`; solo el webhook firmado confirma pagos.

Las pruebas nuevas usan una fábrica Stripe stub local (no se genera ningún pago real) y cubren autoinscripción por sección, identidad desde JWT, cupo, fecha de apertura, duplicados, programa, cruce de horario, consulta de pagos por alumno/padre y proveedor no configurado.
