module.exports = (sequelize, DataTypes) => {
	const Nota = sequelize.define("nota", {
		alumnoId: {
			type: DataTypes.INTEGER,
			allowNull: false
		},
		cursoId: {
			type: DataTypes.INTEGER,
			allowNull: false
		},
		catedraticoId: {
			type: DataTypes.INTEGER,
			allowNull: false
		},
		valor: {
			type: DataTypes.FLOAT,
			allowNull: false,
			validate: {
				min: 0,
				max: 100
			}
		},
		estado: {
			type: DataTypes.ENUM("aprobado", "reprobado"),
			allowNull: false,
			defaultValue: "reprobado"
		},
		periodo: {
			type: DataTypes.STRING,
			allowNull: false,
			defaultValue: "2026"
		}
	}, {
		indexes: [
			{ unique: true, fields: ["alumnoId", "cursoId", "periodo"] }
		],
		hooks: {
			beforeValidate: nota => {
				if (nota.valor !== undefined && nota.valor !== null) {
					nota.estado = nota.valor >= 61 ? "aprobado" : "reprobado";
				}
			}
		}
	});

	return Nota;
};
