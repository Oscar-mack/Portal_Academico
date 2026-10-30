module.exports = (sequelize, DataTypes) => sequelize.define("evento_stripe", {
  stripeEventId: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true
  },
  tipo: {
    type: DataTypes.STRING(120),
    allowNull: false
  },
  pagoId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  procesadoEn: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, { tableName: "eventos_stripe" });
