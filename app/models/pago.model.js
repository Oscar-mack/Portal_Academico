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
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      validate: { min: 0.01 }
    },
    moneda: {
      type: DataTypes.STRING,
      defaultValue: "usd"
    },
    estado: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: "pendiente",
      validate: { isIn: [["pendiente", "pagado", "fallido", "cancelado"]] }
    },
    cargoId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    stripeSessionId: {
      type: DataTypes.STRING
    },
    stripePaymentIntentId: {
      type: DataTypes.STRING(255)
    },
    metodoPago: {
      type: DataTypes.STRING(40),
      allowNull: false,
      defaultValue: "stripe"
    },
    fechaPago: {
      type: DataTypes.DATE
    }
  });

  return Pago;
};
