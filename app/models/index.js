const dbConfig = require("../config/db.config.js");
const { Sequelize } = require("sequelize");

const sequelizeOptions = {
	dialect: dbConfig.dialect,
	pool: dbConfig.pool,
	dialectOptions: dbConfig.dialectOptions
};

const hasIndividualDatabaseConfiguration = [
	dbConfig.HOST,
	dbConfig.USER,
	dbConfig.PASSWORD,
	dbConfig.DB
].every(Boolean);

let sequelize;

if (process.env.NODE_ENV === "test" && process.env.TEST_DATABASE_URL) {
	// Estas pruebas pueden borrar el esquema: exigen una base local desechable identificada como test.
	const testDatabaseUrl = new URL(process.env.TEST_DATABASE_URL);
	const host = testDatabaseUrl.hostname;
	if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
		throw new Error("TEST_DATABASE_URL solo puede apuntar a un PostgreSQL local.");
	}
	const databaseName = decodeURIComponent(testDatabaseUrl.pathname.replace(/^\/+/, ""));
	if (!/(^|[-_])(test|testing|discardable)([-_]|$)/i.test(databaseName)) {
		throw new Error("TEST_DATABASE_URL debe apuntar a una base local descartable cuyo nombre incluya test, testing o discardable.");
	}
	sequelize = new Sequelize(process.env.TEST_DATABASE_URL, { dialect: "postgres", logging: false, pool: { max: 20 } });
} else if (process.env.NODE_ENV === "test") {
	// Las pruebas de integración usan una base SQLite en memoria.
	sequelize = new Sequelize("sqlite::memory:", { logging: false });
} else if (dbConfig.DATABASE_URL) {
	sequelize = new Sequelize(dbConfig.DATABASE_URL, sequelizeOptions);
} else if (hasIndividualDatabaseConfiguration) {
	sequelize = new Sequelize(dbConfig.DB, dbConfig.USER, dbConfig.PASSWORD, {
		...sequelizeOptions,
		host: dbConfig.HOST,
		port: dbConfig.PORT
	});
} else {
	const reason = dbConfig.DATABASE_URL_CONFIGURED
		? "DATABASE_URL no es una URL PostgreSQL válida"
		: "DATABASE_URL no está configurada";

	throw new Error(
		`Configuración de PostgreSQL inválida: ${reason}. Configure DATABASE_URL o DB_HOST, DB_USER, DB_PASSWORD y DB_NAME.`
	);
}

const db = {};

db.Sequelize = Sequelize;
db.sequelize = sequelize;
db.usuarios = require("./usuario.model.js")(sequelize, Sequelize);
db.catedraticos = require("./catedratico.model.js")(sequelize, Sequelize);
db.alumnos = require("./alumno.model.js")(sequelize, Sequelize);
db.cursos = require("./curso.model.js")(sequelize, Sequelize);
db.gradosCarreras = require("./gradoCarrera.model.js")(sequelize, Sequelize);
db.asignacionesCurso = require("./asignacionCurso.model.js")(sequelize, Sequelize);
db.horariosCatedratico = require("./horarioCatedratico.model.js")(sequelize, Sequelize);
db.notas = require("./nota.model.js")(sequelize, Sequelize);
db.padresAlumnos = require("./padreAlumno.model.js")(sequelize, Sequelize);
db.pagos = require("./pago.model.js")(sequelize, Sequelize);
db.ciclosAcademicos = require("./cicloAcademico.model.js")(sequelize, Sequelize);
db.periodosAcademicos = require("./periodoAcademico.model.js")(sequelize, Sequelize);
db.evaluaciones = require("./evaluacion.model.js")(sequelize, Sequelize);
db.calificacionesEvaluacion = require("./calificacionEvaluacion.model.js")(sequelize, Sequelize);
db.auditoriaNotas = require("./auditoriaNota.model.js")(sequelize, Sequelize);
db.tareas = require("./tarea.model.js")(sequelize, Sequelize);
db.archivosAcademicos = require("./archivoAcademico.model.js")(sequelize, Sequelize);
db.adjuntosTarea = require("./adjuntoTarea.model.js")(sequelize, Sequelize);
db.materialesCurso = require("./materialCurso.model.js")(sequelize, Sequelize);
db.entregasTarea = require("./entregaTarea.model.js")(sequelize, Sequelize);
db.auditoriaTareas = require("./auditoriaTarea.model.js")(sequelize, Sequelize);
db.cargos = require("./cargo.model.js")(sequelize, Sequelize);
db.eventosStripe = require("./eventoStripe.model.js")(sequelize, Sequelize);
db.requisitosSolvenciaDocumentos = require("./requisitoSolvenciaDocumento.model.js")(sequelize, Sequelize);
db.ofertasCurso = require("./ofertaCurso.model.js")(sequelize, Sequelize);

db.gradosCarreras.hasMany(db.alumnos, { foreignKey: "gradoCarreraId", as: "alumnos" });
db.alumnos.belongsTo(db.gradosCarreras, { foreignKey: "gradoCarreraId", as: "gradoCarrera" });
db.gradosCarreras.hasMany(db.cursos, { foreignKey: "gradoCarreraId", as: "cursos" });
db.cursos.belongsTo(db.gradosCarreras, { foreignKey: "gradoCarreraId", as: "gradoCarrera" });

db.usuarios.hasOne(db.catedraticos, { foreignKey: "usuarioId", as: "perfilCatedratico" });
db.catedraticos.belongsTo(db.usuarios, { foreignKey: "usuarioId", as: "usuario" });
db.usuarios.hasOne(db.alumnos, { foreignKey: "usuarioId", as: "perfilAlumno" });
db.alumnos.belongsTo(db.usuarios, { foreignKey: "usuarioId", as: "usuario" });

db.alumnos.hasMany(db.asignacionesCurso, { foreignKey: "alumnoId", as: "asignacionesCurso" });
db.asignacionesCurso.belongsTo(db.alumnos, { foreignKey: "alumnoId", as: "alumno" });
db.cursos.hasMany(db.asignacionesCurso, { foreignKey: "cursoId", as: "asignacionesCurso" });
db.asignacionesCurso.belongsTo(db.cursos, { foreignKey: "cursoId", as: "curso" });
db.alumnos.belongsToMany(db.cursos, {
	through: { model: db.asignacionesCurso, unique: false },
	foreignKey: "alumnoId",
	otherKey: "cursoId",
	as: "cursos"
});
db.cursos.belongsToMany(db.alumnos, {
	through: { model: db.asignacionesCurso, unique: false },
	foreignKey: "cursoId",
	otherKey: "alumnoId",
	as: "alumnos"
});

db.catedraticos.hasMany(db.horariosCatedratico, { foreignKey: "catedraticoId", as: "horarios" });
db.horariosCatedratico.belongsTo(db.catedraticos, { foreignKey: "catedraticoId", as: "catedratico" });
db.cursos.hasMany(db.horariosCatedratico, { foreignKey: "cursoId", as: "horarios" });
db.horariosCatedratico.belongsTo(db.cursos, { foreignKey: "cursoId", as: "curso" });

db.alumnos.hasMany(db.notas, { foreignKey: "alumnoId", as: "notas" });
db.notas.belongsTo(db.alumnos, { foreignKey: "alumnoId", as: "alumno" });
db.cursos.hasMany(db.notas, { foreignKey: "cursoId", as: "notas" });
db.notas.belongsTo(db.cursos, { foreignKey: "cursoId", as: "curso" });
db.catedraticos.hasMany(db.notas, { foreignKey: "catedraticoId", as: "notas" });
db.notas.belongsTo(db.catedraticos, { foreignKey: "catedraticoId", as: "catedratico" });

db.usuarios.hasMany(db.padresAlumnos, { foreignKey: "usuarioId", as: "hijos" });
db.padresAlumnos.belongsTo(db.usuarios, { foreignKey: "usuarioId", as: "usuario" });
db.alumnos.hasMany(db.padresAlumnos, { foreignKey: "alumnoId", as: "tutores" });
db.padresAlumnos.belongsTo(db.alumnos, { foreignKey: "alumnoId", as: "alumno" });

db.alumnos.hasMany(db.pagos, { foreignKey: "alumnoId", as: "pagos" });
db.pagos.belongsTo(db.alumnos, { foreignKey: "alumnoId", as: "alumno" });

db.ciclosAcademicos.hasMany(db.periodosAcademicos, { foreignKey: "cicloAcademicoId", as: "periodos" });
db.periodosAcademicos.belongsTo(db.ciclosAcademicos, { foreignKey: "cicloAcademicoId", as: "cicloAcademico" });
db.asignacionesCurso.belongsTo(db.periodosAcademicos, { foreignKey: "periodoAcademicoId", as: "periodoAcademico" });
db.periodosAcademicos.hasMany(db.asignacionesCurso, { foreignKey: "periodoAcademicoId", as: "asignacionesCurso" });
db.horariosCatedratico.belongsTo(db.periodosAcademicos, { foreignKey: "periodoAcademicoId", as: "periodoAcademico" });
db.periodosAcademicos.hasMany(db.horariosCatedratico, { foreignKey: "periodoAcademicoId", as: "horarios" });
db.ofertasCurso.belongsTo(db.cursos, { foreignKey: "cursoId", as: "curso" });
db.cursos.hasMany(db.ofertasCurso, { foreignKey: "cursoId", as: "ofertas" });
db.ofertasCurso.belongsTo(db.catedraticos, { foreignKey: "catedraticoId", as: "catedratico" });
db.catedraticos.hasMany(db.ofertasCurso, { foreignKey: "catedraticoId", as: "ofertasCurso" });
db.ofertasCurso.belongsTo(db.periodosAcademicos, { foreignKey: "periodoAcademicoId", as: "periodoAcademico" });
db.periodosAcademicos.hasMany(db.ofertasCurso, { foreignKey: "periodoAcademicoId", as: "ofertasCurso" });
db.ofertasCurso.hasMany(db.asignacionesCurso, { foreignKey: "ofertaCursoId", as: "inscripciones" });
db.asignacionesCurso.belongsTo(db.ofertasCurso, { foreignKey: "ofertaCursoId", as: "ofertaCurso" });
db.ofertasCurso.hasMany(db.horariosCatedratico, { foreignKey: "ofertaCursoId", as: "horarios" });
db.horariosCatedratico.belongsTo(db.ofertasCurso, { foreignKey: "ofertaCursoId", as: "ofertaCurso" });
db.notas.belongsTo(db.periodosAcademicos, { foreignKey: "periodoAcademicoId", as: "periodoAcademico" });
db.periodosAcademicos.hasMany(db.notas, { foreignKey: "periodoAcademicoId", as: "notas" });

db.cursos.hasMany(db.evaluaciones, { foreignKey: "cursoId", as: "evaluaciones" });
db.evaluaciones.belongsTo(db.cursos, { foreignKey: "cursoId", as: "curso" });
db.catedraticos.hasMany(db.evaluaciones, { foreignKey: "catedraticoId", as: "evaluaciones" });
db.evaluaciones.belongsTo(db.catedraticos, { foreignKey: "catedraticoId", as: "catedratico" });
db.periodosAcademicos.hasMany(db.evaluaciones, { foreignKey: "periodoAcademicoId", as: "evaluaciones" });
db.evaluaciones.belongsTo(db.periodosAcademicos, { foreignKey: "periodoAcademicoId", as: "periodoAcademico" });
db.evaluaciones.hasMany(db.calificacionesEvaluacion, { foreignKey: "evaluacionId", as: "calificaciones" });
db.calificacionesEvaluacion.belongsTo(db.evaluaciones, { foreignKey: "evaluacionId", as: "evaluacion" });
db.alumnos.hasMany(db.calificacionesEvaluacion, { foreignKey: "alumnoId", as: "calificacionesEvaluacion" });
db.calificacionesEvaluacion.belongsTo(db.alumnos, { foreignKey: "alumnoId", as: "alumno" });

db.cursos.hasMany(db.tareas, { foreignKey: "cursoId", as: "tareas" });
db.tareas.belongsTo(db.cursos, { foreignKey: "cursoId", as: "curso" });
db.catedraticos.hasMany(db.tareas, { foreignKey: "catedraticoId", as: "tareas" });
db.tareas.belongsTo(db.catedraticos, { foreignKey: "catedraticoId", as: "catedratico" });
db.periodosAcademicos.hasMany(db.tareas, { foreignKey: "periodoAcademicoId", as: "tareas" });
db.tareas.belongsTo(db.periodosAcademicos, { foreignKey: "periodoAcademicoId", as: "periodoAcademico" });
db.tareas.hasMany(db.adjuntosTarea, { foreignKey: "tareaId", as: "adjuntos" });
db.adjuntosTarea.belongsTo(db.tareas, { foreignKey: "tareaId", as: "tarea" });
db.adjuntosTarea.belongsTo(db.archivosAcademicos, { foreignKey: "archivoId", as: "archivo" });
db.archivosAcademicos.hasOne(db.adjuntosTarea, { foreignKey: "archivoId", as: "adjuntoTarea" });
db.cursos.hasMany(db.materialesCurso, { foreignKey: "cursoId", as: "materiales" });
db.materialesCurso.belongsTo(db.cursos, { foreignKey: "cursoId", as: "curso" });
db.materialesCurso.belongsTo(db.periodosAcademicos, { foreignKey: "periodoAcademicoId", as: "periodoAcademico" });
db.materialesCurso.belongsTo(db.catedraticos, { foreignKey: "catedraticoId", as: "catedratico" });
db.materialesCurso.belongsTo(db.archivosAcademicos, { foreignKey: "archivoId", as: "archivo" });
db.archivosAcademicos.hasOne(db.materialesCurso, { foreignKey: "archivoId", as: "materialCurso" });
db.tareas.hasMany(db.entregasTarea, { foreignKey: "tareaId", as: "entregas" });
db.entregasTarea.belongsTo(db.tareas, { foreignKey: "tareaId", as: "tarea" });
db.entregasTarea.belongsTo(db.alumnos, { foreignKey: "alumnoId", as: "alumno" });
db.entregasTarea.belongsTo(db.archivosAcademicos, { foreignKey: "archivoId", as: "archivo" });
db.archivosAcademicos.hasOne(db.entregasTarea, { foreignKey: "archivoId", as: "entrega" });
db.auditoriaTareas.belongsTo(db.tareas, { foreignKey: "tareaId", as: "tarea" });
db.auditoriaTareas.belongsTo(db.archivosAcademicos, { foreignKey: "archivoId", as: "archivo" });
db.auditoriaTareas.belongsTo(db.usuarios, { foreignKey: "usuarioId", as: "usuario" });

db.notas.hasMany(db.auditoriaNotas, { foreignKey: "notaId", as: "historial" });
db.auditoriaNotas.belongsTo(db.notas, { foreignKey: "notaId", as: "nota" });
db.usuarios.hasMany(db.auditoriaNotas, { foreignKey: "usuarioId", as: "modificacionesNotas" });
db.auditoriaNotas.belongsTo(db.usuarios, { foreignKey: "usuarioId", as: "usuario" });

db.alumnos.hasMany(db.cargos, { foreignKey: "alumnoId", as: "cargos" });
db.cargos.belongsTo(db.alumnos, { foreignKey: "alumnoId", as: "alumno" });
db.cargos.belongsTo(db.ciclosAcademicos, { foreignKey: "cicloAcademicoId", as: "cicloAcademico" });
db.cargos.belongsTo(db.periodosAcademicos, { foreignKey: "periodoAcademicoId", as: "periodoAcademico" });
db.usuarios.hasMany(db.cargos, { foreignKey: "anuladoPorId", as: "cargosAnulados" });
db.cargos.belongsTo(db.usuarios, { foreignKey: "anuladoPorId", as: "anuladoPor" });
db.cargos.hasMany(db.pagos, { foreignKey: "cargoId", as: "pagos" });
db.pagos.belongsTo(db.cargos, { foreignKey: "cargoId", as: "cargo" });
db.pagos.hasMany(db.eventosStripe, { foreignKey: "pagoId", as: "eventosStripe" });
db.eventosStripe.belongsTo(db.pagos, { foreignKey: "pagoId", as: "pago" });

module.exports = db;
