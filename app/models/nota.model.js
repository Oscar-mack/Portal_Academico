// Umbral de aprobacion centralizado — fuente unica de verdad (B3).
// Si la institucion cambia el umbral, solo se modifica aqui.
// DECISION INSTITUCIONAL PENDIENTE: confirmar si 61 es el umbral correcto.
const NOTA_MINIMA_APROBACION = 61;

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
    },
    periodoAcademicoId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    // B5: campo para el flujo de publicacion explicita.
    // null = no publicada (solo admin y catedratico la ven).
    // fecha = publicada (alumnos y tutores pueden verla).
    // DECISION INSTITUCIONAL PENDIENTE: definir si existe ventana para publicar
    // o si el catedratico puede publicar en cualquier momento.
    publicadaEn: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null
    }
  }, {
    indexes: [
      { unique: true, fields: ["alumnoId", "cursoId", "periodo"] },
      { unique: true, fields: ["alumnoId", "cursoId", "periodoAcademicoId"] }
    ],
    hooks: {
      // El hook recalcula el estado automaticamente al guardar o actualizar.
      beforeValidate: nota => {
        if (nota.valor !== undefined && nota.valor !== null) {
          nota.estado = nota.valor >= NOTA_MINIMA_APROBACION ? "aprobado" : "reprobado";
        }
      }
    }
  });

  // Exportar el umbral para usarlo en controladores y reportes sin duplicarlo.
  Nota.NOTA_MINIMA_APROBACION = NOTA_MINIMA_APROBACION;

  return Nota;
};
