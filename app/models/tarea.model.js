module.exports = (sequelize, DataTypes) => sequelize.define("tarea", {
  cursoId: { type: DataTypes.INTEGER, allowNull: false },
  catedraticoId: { type: DataTypes.INTEGER, allowNull: false },
  periodoAcademicoId: { type: DataTypes.INTEGER, allowNull: false },
  titulo: { type: DataTypes.STRING(150), allowNull: false },
  descripcion: { type: DataTypes.TEXT, allowNull: false },
  instrucciones: { type: DataTypes.TEXT, allowNull: false },
  fechaPublicacion: { type: DataTypes.DATE, allowNull: false },
  fechaLimite: { type: DataTypes.DATE, allowNull: false },
  activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
}, {
  tableName: "tareas",
  indexes: [
    { fields: ["cursoId", "periodoAcademicoId", "activo", "fechaPublicacion"] },
    { fields: ["catedraticoId", "periodoAcademicoId"] }
  ],
  validate: {
    fechasCoherentes() {
      if (this.fechaPublicacion && this.fechaLimite &&
          this.fechaLimite <= this.fechaPublicacion) {
        throw new Error("fechaLimite debe ser posterior a fechaPublicacion.");
      }
    }
  }
});
