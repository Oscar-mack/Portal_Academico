module.exports = (sequelize, DataTypes) => {
  // RF-02 — Asignación de cursos y horarios a catedráticos (tabla intermedia catedratico <-> curso)
  const HorarioCatedratico = sequelize.define("horario_catedratico", {
    catedraticoId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    cursoId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    dia: {
      type: DataTypes.ENUM("Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"),
      allowNull: false
    },
    horaInicio: {
      type: DataTypes.STRING, // "08:00"
      allowNull: false
    },
    horaFin: {
      type: DataTypes.STRING, // "10:00"
      allowNull: false
    },
    periodo: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "2026"
    }
  });

  return HorarioCatedratico;
};

