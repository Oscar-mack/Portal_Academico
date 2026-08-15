const dbConfig = require("../config/db.config.js");
const { Sequelize } = require("sequelize");

const sequelizeOptions = {
	dialect: dbConfig.dialect,
	pool: dbConfig.pool,
	dialectOptions: dbConfig.dialectOptions
};

const sequelize = dbConfig.DATABASE_URL
	? new Sequelize(dbConfig.DATABASE_URL, sequelizeOptions)
	: new Sequelize(dbConfig.DB, dbConfig.USER, dbConfig.PASSWORD, {
		...sequelizeOptions,
		host: dbConfig.HOST,
		port: dbConfig.PORT
	});

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

module.exports = db;
