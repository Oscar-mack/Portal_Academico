const db = require("../models");
const ROLES = require("../config/roles.js");
const { incluirSaldos } = require("./cargo.controller.js");

const cents = value => Math.round(Number(value) * 100);
const fromCents = value => Number((value / 100).toFixed(2));

function resumirSaldos(cargos) {
  const porMoneda = new Map();
  for (const cargo of cargos) {
    const moneda = cargo.moneda;
    porMoneda.set(moneda, (porMoneda.get(moneda) || 0) + cents(cargo.saldoPendiente));
  }
  return Object.fromEntries([...porMoneda].map(([moneda, saldo]) => [moneda, fromCents(saldo)]));
}

async function resumenAlumno(alumno, periodoAcademicoId) {
  const periodoFiltro = periodoAcademicoId ? { periodoAcademicoId } : {};
  const [asignaciones, notas, cargos] = await Promise.all([
    db.asignacionesCurso.findAll({
      where: { alumnoId: alumno.id, ...periodoFiltro },
      include: [{ model: db.cursos, as: "curso" }],
      order: [["id", "ASC"]]
    }),
    db.notas.findAll({
      where: {
        alumnoId: alumno.id,
        publicadaEn: { [db.Sequelize.Op.ne]: null },
        ...periodoFiltro
      },
      order: [["updatedAt", "DESC"]]
    }),
    db.cargos.findAll({
      where: { alumnoId: alumno.id, anuladoEn: null, ...periodoFiltro },
      order: [["fechaVencimiento", "ASC"]]
    })
  ]);
  const cargosConSaldo = await incluirSaldos(cargos);
  const promedio = notas.length
    ? Number((notas.reduce((total, nota) => total + Number(nota.valor), 0) / notas.length).toFixed(2))
    : 0;
  return {
    alumno: {
      id: alumno.id,
      nombre: alumno.nombre,
      apellido: alumno.apellido,
      gradoCarreraId: alumno.gradoCarreraId
    },
    totalCursos: asignaciones.length,
    cursos: asignaciones.map(asignacion => asignacion.curso),
    totalNotasPublicadas: notas.length,
    promedioNotasPublicadas: promedio,
    aprobados: notas.filter(nota => nota.estado === "aprobado").length,
    reprobados: notas.filter(nota => nota.estado === "reprobado").length,
    cargosPendientes: cargosConSaldo.filter(cargo => cargo.saldoPendiente > 0),
    saldoPendientePorMoneda: resumirSaldos(cargosConSaldo)
  };
}

exports.get = async (req, res) => {
  try {
    if (req.query.periodoAcademicoId !== undefined &&
        (!Number.isInteger(Number(req.query.periodoAcademicoId)) || Number(req.query.periodoAcademicoId) <= 0)) {
      return res.status(400).send({ message: "periodoAcademicoId debe ser un identificador válido." });
    }
    const periodoAcademicoId = req.query.periodoAcademicoId
      ? Number(req.query.periodoAcademicoId)
      : undefined;

    if (req.userRole === ROLES.ADMIN) {
      const [alumnos, catedraticos, cursos, notas, cargos] = await Promise.all([
        db.alumnos.count({ where: { activo: true } }),
        db.catedraticos.count({ where: { activo: true } }),
        db.cursos.count({ where: { activo: true } }),
        db.notas.count({
          where: {
            publicadaEn: { [db.Sequelize.Op.ne]: null },
            ...(periodoAcademicoId ? { periodoAcademicoId } : {})
          }
        }),
        db.cargos.findAll({
          where: {
            anuladoEn: null,
            ...(periodoAcademicoId ? { periodoAcademicoId } : {})
          }
        })
      ]);
      const cargosConSaldo = await incluirSaldos(cargos);
      return res.send({
        rol: ROLES.ADMIN,
        resumen: {
          alumnosActivos: alumnos,
          catedraticosActivos: catedraticos,
          cursosActivos: cursos,
          notasPublicadas: notas,
          cargosPendientes: cargosConSaldo.filter(cargo => cargo.saldoPendiente > 0).length,
          saldoPendientePorMoneda: resumirSaldos(cargosConSaldo)
        }
      });
    }

    if (req.userRole === ROLES.CATEDRATICO) {
      const docente = await db.catedraticos.findOne({ where: { usuarioId: req.userId } });
      if (!docente) return res.status(403).send({ message: "No tienes un perfil de catedrático asociado." });
      const horarios = await db.horariosCatedratico.findAll({
        where: {
          catedraticoId: docente.id,
          ...(periodoAcademicoId ? { periodoAcademicoId } : {})
        },
        include: [{ model: db.cursos, as: "curso" }]
      });
      const cursoIds = [...new Set(horarios.map(horario => horario.cursoId))];
      const asignaciones = cursoIds.length
        ? await db.asignacionesCurso.findAll({
          where: {
            cursoId: cursoIds,
            ...(periodoAcademicoId ? { periodoAcademicoId } : {})
          },
          attributes: ["alumnoId"]
        })
        : [];
      const notas = await db.notas.count({
        where: {
          catedraticoId: docente.id,
          publicadaEn: { [db.Sequelize.Op.ne]: null },
          ...(periodoAcademicoId ? { periodoAcademicoId } : {})
        }
      });
      return res.send({
        rol: ROLES.CATEDRATICO,
        resumen: {
          cursosAsignados: cursoIds.length,
          alumnosInscritos: new Set(asignaciones.map(item => item.alumnoId)).size,
          notasPublicadas: notas
        },
        cursos: horarios.map(horario => ({
          id: horario.curso.id,
          nombre: horario.curso.nombre,
          dia: horario.dia,
          horaInicio: horario.horaInicio,
          horaFin: horario.horaFin,
          periodoAcademicoId: horario.periodoAcademicoId
        }))
      });
    }

    if (req.userRole === ROLES.ALUMNO) {
      const alumno = await db.alumnos.findOne({ where: { usuarioId: req.userId, activo: true } });
      if (!alumno) return res.status(403).send({ message: "No tienes un perfil de alumno activo." });
      return res.send({
        rol: ROLES.ALUMNO,
        ...(await resumenAlumno(alumno, periodoAcademicoId))
      });
    }

    if (req.userRole === ROLES.PADRE) {
      const vinculos = await db.padresAlumnos.findAll({
        where: { usuarioId: req.userId },
        include: [{ model: db.alumnos, as: "alumno", where: { activo: true } }]
      });
      const alumnos = await Promise.all(vinculos.map(vinculo =>
        resumenAlumno(vinculo.alumno, periodoAcademicoId)
      ));
      return res.send({
        rol: ROLES.PADRE,
        resumen: { alumnosVinculados: alumnos.length },
        alumnos
      });
    }

    return res.status(403).send({ message: "No tienes acceso al dashboard." });
  } catch (error) {
    return res.status(500).send({ message: error.message || "Error al generar el dashboard." });
  }
};
