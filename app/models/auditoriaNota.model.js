module.exports = (sequelize, DataTypes) => sequelize.define("auditoria_nota", {
  notaId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  usuarioId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  valorAnterior: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true
  },
  valorNuevo: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false
  },
  motivo: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, { tableName: "auditoria_notas" });
