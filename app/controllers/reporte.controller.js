const db = require("../models");
const ROLES = require("../config/roles.js");
const { generarBoletaPDF } = require("../utils/pdfGenerator.js");
const { generarEstadoCuentaPDF } = require("../utils/estadoCuentaPdfGenerator.js");
const { incluirSaldos } = require("./cargo.controller.js");
const { Op } = require("sequelize");

const Nota = db.notas;
const Alumno = db.alumnos;
const Curso = db.cursos;
const Catedratico = db.catedraticos;
const GradoCarrera = db.gradosCarreras;
const PadreAlumno = db.padresAlumnos;
const AsignacionCurso = db.asignacionesCurso;
const HorarioCatedratico = db.horariosCatedratico;
const Cargo = db.cargos;

// B3: Umbral importado del modelo — unica fuente de verdad.
const NOTA_MINIMA_APROBACION = Nota.NOTA_MINIMA_APROBACION;

// RF-09 — Reporte de notas por catedratico (Administrador, o el propio catedratico)
exports.notasPorCatedratico = async (req, res) => {
  try {
    const catedraticoId = req.params.catedraticoId;

    if (req.userRole === ROLES.CATEDRATICO) {
      const catedratico = await Catedratico.findOne({ where: { usuarioId: req.userId } });
      if (!catedratico || String(catedratico.id) !== String(catedraticoId)) {
        return res.status(403).send({ message: "Solo puedes consultar tu propio reporte." });
      }
    }

    const catedratico = await Catedratico.findByPk(catedraticoId);
    if (!catedratico) {
      return res.status(404).send({ message: "Catedratico no encontrado." });
    }

    const where = { catedraticoId };
    if (req.query.periodo) where.periodo = req.query.periodo;
    if (req.query.periodoAcademicoId) where.periodoAcademicoId = req.query.periodoAcademicoId;

    const notas = await Nota.findAll({
      where,
      include: [
        { model: Alumno, as: "alumno" },
        { model: Curso, as: "curso" }
      ],
      order: [["cursoId", "ASC"]]
    });

    const aprobados = notas.filter(n => n.estado === "aprobado").length;
    const reprobados = notas.filter(n => n.estado === "reprobado").length;
    const promedio = notas.length > 0
      ? (notas.reduce((acc, n) => acc + n.valor, 0) / notas.length).toFixed(2)
      : 0;

    res.send({
      catedratico: { id: catedratico.id, nombre: `${catedratico.nombre} ${catedratico.apellido}` },
      totalNotas: notas.length,
      aprobados,
      reprobados,
      promedioGeneral: Number(promedio),
      notas
    });
  } catch (error) {
    res.status(500).send({ message: "Error al generar el reporte." });
  }
};

// RF-12 — Indicadores academicos: alumnos aprobados/reprobados por rango de nota (Administrador)
// B3: Se usa NOTA_MINIMA_APROBACION importada del modelo en lugar del literal 61.
exports.indicadores = async (req, res) => {
  try {
    const where = {};
    if (req.query.periodo) where.periodo = req.query.periodo;
    if (req.query.periodoAcademicoId) where.periodoAcademicoId = req.query.periodoAcademicoId;
    if (req.query.cursoId) where.cursoId = req.query.cursoId;
    if (req.query.gradoCarreraId) {
      const alumnosDelGrado = await Alumno.findAll({
        where: { gradoCarreraId: req.query.gradoCarreraId },
        attributes: ["id"]
      });
      where.alumnoId = alumnosDelGrado.map(a => a.id);
    }

    const notas = await Nota.findAll({ where });

    const totalNotas = notas.length;
    // B3: Usar el umbral del modelo en lugar de 61 literal.
    const aprobados = notas.filter(n => n.valor >= NOTA_MINIMA_APROBACION).length;
    const reprobados = notas.filter(n => n.valor < NOTA_MINIMA_APROBACION).length;

    // Distribucion por rangos — el primer rango se ajusta al umbral dinamico.
    const rangos = {
      [`0-${NOTA_MINIMA_APROBACION - 1} (Reprobado)`]: notas.filter(n => n.valor < NOTA_MINIMA_APROBACION).length,
      [`${NOTA_MINIMA_APROBACION}-70`]: notas.filter(n => n.valor >= NOTA_MINIMA_APROBACION && n.valor <= 70).length,
      "71-80": notas.filter(n => n.valor >= 71 && n.valor <= 80).length,
      "81-90": notas.filter(n => n.valor >= 81 && n.valor <= 90).length,
      "91-100": notas.filter(n => n.valor >= 91 && n.valor <= 100).length
    };

    const totalAlumnos = await Alumno.count();

    res.send({
      totalAlumnos,
      totalNotasEvaluadas: totalNotas,
      aprobados,
      reprobados,
      porcentajeAprobacion: totalNotas > 0 ? Number(((aprobados / totalNotas) * 100).toFixed(2)) : 0,
      distribucionPorRango: rangos,
      umbralAprobacion: NOTA_MINIMA_APROBACION
    });
  } catch (error) {
    res.status(500).send({ message: "Error al generar los indicadores." });
  }
};

// RF-10 / RF-11 — Boleta de notas en PDF (Admin, catedratico del alumno, el propio alumno, o su padre/tutor)
exports.boletaPDF = async (req, res) => {
  try {
    const alumnoId = req.params.alumnoId;
    const periodo = req.query.periodo;
    const periodoAcademicoId = req.query.periodoAcademicoId
      ? Number(req.query.periodoAcademicoId)
      : undefined;
    if (req.query.periodoAcademicoId &&
        (!Number.isInteger(periodoAcademicoId) || periodoAcademicoId <= 0)) {
      return res.status(400).send({ message: "periodoAcademicoId debe ser un identificador válido." });
    }
    const filtroPeriodo = periodoAcademicoId
      ? { periodoAcademicoId }
      : (periodo ? { periodo } : {});
    const periodoEtiqueta = periodoAcademicoId
      ? `academico:${periodoAcademicoId}`
      : periodo;

    if (req.userRole === ROLES.ALUMNO) {
      const alumno = await Alumno.findOne({ where: { usuarioId: req.userId } });
      if (!alumno || String(alumno.id) !== String(alumnoId)) {
        return res.status(403).send({ message: "Solo puedes consultar tu propia boleta." });
      }
    } else if (req.userRole === ROLES.PADRE) {
      const vinculo = await PadreAlumno.findOne({ where: { usuarioId: req.userId, alumnoId } });
      if (!vinculo) {
        return res.status(403).send({ message: "No tienes acceso a la boleta de este alumno." });
      }
    } else if (req.userRole === ROLES.CATEDRATICO) {
      const catedratico = await Catedratico.findOne({ where: { usuarioId: req.userId } });
      if (!catedratico) {
        return res.status(403).send({ message: "No tienes un perfil de catedratico asociado." });
      }
      const horarios = await HorarioCatedratico.findAll({
        where: {
          catedraticoId: catedratico.id,
          ...filtroPeriodo
        },
        attributes: ["cursoId"]
      });
      const cursosImpartidos = horarios.map(h => h.cursoId);
      const imparteAlAlumno = cursosImpartidos.length > 0 && await AsignacionCurso.findOne({
        where: {
          alumnoId,
          cursoId: cursosImpartidos,
          ...filtroPeriodo
        }
      });
      if (!imparteAlAlumno) {
        return res.status(403).send({ message: "Solo puedes consultar boletas de alumnos inscritos en tus cursos." });
      }
    }

    const alumno = await Alumno.findByPk(alumnoId, {
      include: [{ model: GradoCarrera, as: "gradoCarrera" }]
    });
    if (!alumno) {
      return res.status(404).send({ message: "Alumno no encontrado." });
    }

    const filtro = { alumnoId };
    Object.assign(filtro, filtroPeriodo);
    if (req.userRole === ROLES.ALUMNO || req.userRole === ROLES.PADRE) {
      filtro.publicadaEn = { [Op.ne]: null };
    } else if (req.userRole === ROLES.CATEDRATICO) {
      const catedratico = await Catedratico.findOne({ where: { usuarioId: req.userId } });
      const horarios = await HorarioCatedratico.findAll({
        where: {
          catedraticoId: catedratico.id,
          ...filtroPeriodo
        },
        attributes: ["cursoId"]
      });
      filtro.cursoId = [...new Set(horarios.map(horario => horario.cursoId))];
      filtro.catedraticoId = catedratico.id;
      if (filtro.cursoId.length === 0) {
        return res.status(403).send({ message: "No tienes cursos asignados en este periodo." });
      }
    }

    const notas = await Nota.findAll({
      where: filtro,
      include: [{ model: Curso, as: "curso" }],
      order: [["cursoId", "ASC"]]
    });

    generarBoletaPDF(res, { alumno, gradoCarrera: alumno.gradoCarrera, notas, periodo: periodoEtiqueta });
  } catch (error) {
    res.status(500).send({ message: "Error al generar la boleta en PDF." });
  }
};

exports.estadoCuentaPDF = async (req, res) => {
  try {
    const { alumnoId } = req.params;
    if (!Number.isInteger(Number(alumnoId)) || Number(alumnoId) <= 0) {
      return res.status(400).send({ message: "alumnoId debe ser un identificador válido." });
    }
    if (req.userRole === ROLES.ALUMNO) {
      const alumnoAutenticado = await Alumno.findOne({ where: { usuarioId: req.userId } });
      if (!alumnoAutenticado || alumnoAutenticado.id !== Number(alumnoId)) {
        return res.status(403).send({ message: "Solo puedes consultar tu propio estado de cuenta." });
      }
    } else if (req.userRole === ROLES.PADRE) {
      const vinculo = await PadreAlumno.findOne({
        where: { usuarioId: req.userId, alumnoId: Number(alumnoId) }
      });
      if (!vinculo) return res.status(403).send({ message: "No tienes acceso al estado de cuenta de este alumno." });
    } else if (req.userRole !== ROLES.ADMIN) {
      return res.status(403).send({ message: "No tienes acceso a estados de cuenta." });
    }

    const alumno = await Alumno.findByPk(alumnoId);
    if (!alumno) return res.status(404).send({ message: "Alumno no encontrado." });
    const where = { alumnoId: alumno.id };
    if (req.query.cicloAcademicoId) where.cicloAcademicoId = req.query.cicloAcademicoId;
    if (req.query.periodoAcademicoId) where.periodoAcademicoId = req.query.periodoAcademicoId;
    const cargos = await Cargo.findAll({
      where,
      order: [["fechaEmision", "ASC"], ["id", "ASC"]]
    });
    const cargosConSaldo = await incluirSaldos(cargos);
    const pagosHistoricos = await db.pagos.findAll({
      where: {
        alumnoId: alumno.id,
        cargoId: null,
        estado: ["pendiente", "pagado"]
      },
      attributes: ["id", "concepto", "monto", "moneda", "estado", "fechaPago", "createdAt"],
      order: [["createdAt", "ASC"]]
    });
    return generarEstadoCuentaPDF(res, { alumno, cargos: cargosConSaldo, pagosHistoricos });
  } catch (error) {
    return res.status(500).send({ message: error.message || "Error al generar el estado de cuenta." });
  }
};
