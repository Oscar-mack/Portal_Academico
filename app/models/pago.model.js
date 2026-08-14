module.exports = (sequelize, DataTypes) => {
  // RF-13 — Pagos de colegiatura u otros servicios mediante plataforma externa (Stripe)
  const Pago = sequelize.define("pago", {
    alumnoId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    concepto: {
      type: DataTypes.STRING, // "Colegiatura Agosto 2026", "Carnet", etc.
      allowNull: false
    },
    monto: {
      type: DataTypes.FLOAT,
      allowNull: false
    },
    moneda: {
      type: DataTypes.STRING,
      defaultValue: "usd"
    },
    estado: {
      type: DataTypes.ENUM("pendiente", "pagado", "cancelado"),
      defaultValue: "pendiente"
    },
    stripeSessionId: {
      type: DataTypes.STRING
    },
    fechaPago: {
      type: DataTypes.DATE
    }
  });

  return Pago;
};

