module.exports = (sequelize, DataTypes) => {
	const AsignacionCurso = sequelize.define("asignacion_curso", {
		id: {
			type: DataTypes.INTEGER,
			autoIncrement: true,
			primaryKey: true
		},
		alumnoId: {
			type: DataTypes.INTEGER,
			allowNull: false
		},
		cursoId: {
			type: DataTypes.INTEGER,
			allowNull: false
		},
		periodo: {
			type: DataTypes.STRING,
			allowNull: false,
			defaultValue: "2026"
		}
	}, {
		indexes: [
			{ unique: true, fields: ["alumnoId", "cursoId", "periodo"] }
		]
	});

	return AsignacionCurso;
};
