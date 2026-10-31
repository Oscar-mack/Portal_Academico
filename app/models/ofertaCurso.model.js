module.exports = (sequelize, DataTypes) => sequelize.define("oferta_curso", {
  cursoId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  catedraticoId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  periodoAcademicoId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  codigoSeccion: {
    type: DataTypes.STRING(30),
    allowNull: false
  },
  cupoMaximo: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1 }
  },
  fechaInscripcionInicio: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  fechaInscripcionFin: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  activo: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  }
}, {
  tableName: "ofertas_curso",
  indexes: [
    { unique: true, fields: ["cursoId", "periodoAcademicoId", "codigoSeccion"] },
    { fields: ["periodoAcademicoId", "activo"] }
  ],
  validate: {
    fechasInscripcionCoherentes() {
      if (this.fechaInscripcionInicio && this.fechaInscripcionFin &&
          this.fechaInscripcionInicio > this.fechaInscripcionFin) {
        throw new Error("La fecha final de inscripción no puede ser anterior a la fecha inicial.");
      }
    }
  }
});
