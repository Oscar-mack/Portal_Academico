const db = require("../models");
const ROLES = require("../config/roles.js");
const { generarBoletaPDF } = require("../utils/pdfGenerator.js");

const Nota = db.notas;
const Alumno = db.alumnos;
const Curso = db.cursos;
const Catedratico = db.catedraticos;
const GradoCarrera = db.gradosCarreras;
const PadreAlumno = db.padresAlumnos;

// RF-09 — Reporte de notas por catedrático (Administrador, o el propio catedrático)
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
      return res.status(404).send({ message: "Catedrático no encontrado." });
    }

    const notas = await Nota.findAll({
      where: { catedraticoId },
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

// RF-12 — Indicadores académicos: alumnos aprobados/reprobados por rango de nota (Administrador)
exports.indicadores = async (req, res) => {
  try {
    const where = {};
    if (req.query.periodo) where.periodo = req.query.periodo;
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
    const aprobados = notas.filter(n => n.estado === "aprobado").length;
    const reprobados = notas.filter(n => n.estado === "reprobado").length;

    // Distribución por rangos (RF-12 / RN-06 / RN-07)
    const rangos = {
      "0-60 (Reprobado)": notas.filter(n => n.valor <= 60).length,
      "61-70": notas.filter(n => n.valor >= 61 && n.valor <= 70).length,
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
      distribucionPorRango: rangos
    });
  } catch (error) {
    res.status(500).send({ message: "Error al generar los indicadores." });
  }
};

// RF-10 / RF-11 — Boleta de notas en PDF (Admin, catedrático del alumno, el propio alumno, o su padre/tutor)
exports.boletaPDF = async (req, res) => {
  try {
    const alumnoId = req.params.alumnoId;
    const periodo = req.query.periodo;

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
    }
    // Administrador y Catedrático (cualquiera que le imparta clase) pueden consultar

    const alumno = await Alumno.findByPk(alumnoId, {
      include: [{ model: GradoCarrera, as: "gradoCarrera" }]
    });
    if (!alumno) {
      return res.status(404).send({ message: "Alumno no encontrado." });
    }

    const where = { alumnoId };
    if (periodo) where.periodo = periodo;

    const notas = await Nota.findAll({
      where,
      include: [{ model: Curso, as: "curso" }],
      order: [["cursoId", "ASC"]]
    });

    generarBoletaPDF(res, { alumno, gradoCarrera: alumno.gradoCarrera, notas, periodo });
  } catch (error) {
    res.status(500).send({ message: "Error al generar la boleta en PDF." });
  }
};
