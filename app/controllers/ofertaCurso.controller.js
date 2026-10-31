const db = require("../models");

const Offer = db.ofertasCurso;
const Student = db.alumnos;
const Assignment = db.asignacionesCurso;

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function currentDate() {
  return new Date().toISOString().slice(0, 10);
}

function registrationState(offer, occupied, today = currentDate()) {
  const seatsAvailable = Math.max(0, offer.cupoMaximo - occupied);
  let reason = null;
  if (!offer.activo) reason = "La sección está desactivada.";
  else if (offer.periodoAcademico?.estado !== "abierto") reason = "El período académico está cerrado.";
  else if (today < offer.fechaInscripcionInicio) reason = `La inscripción abre el ${offer.fechaInscripcionInicio}.`;
  else if (today > offer.fechaInscripcionFin) reason = `La inscripción cerró el ${offer.fechaInscripcionFin}.`;
  else if (seatsAvailable === 0) reason = "La sección ya no tiene cupos disponibles.";
  else if (!offer.horarios?.length) reason = "La sección aún no tiene horario configurado.";
  return { seatsAvailable, registrationOpen: reason === null, registrationReason: reason };
}

function offerIncludes() {
  return [
    { model: db.cursos, as: "curso", include: [{ model: db.gradosCarreras, as: "gradoCarrera" }] },
    { model: db.catedraticos, as: "catedratico" },
    { model: db.periodosAcademicos, as: "periodoAcademico" },
    { model: db.horariosCatedratico, as: "horarios" }
  ];
}

exports.findAll = async (req, res) => {
  try {
    const where = {};
    if (req.query.periodoAcademicoId) where.periodoAcademicoId = req.query.periodoAcademicoId;
    if (req.query.cursoId) where.cursoId = req.query.cursoId;
    const offers = await Offer.findAll({
      where,
      include: offerIncludes(),
      order: [["periodoAcademicoId", "ASC"], ["cursoId", "ASC"], ["codigoSeccion", "ASC"]]
    });
    const results = await Promise.all(offers.map(async offer => {
      const inscritos = await Assignment.count({ where: { ofertaCursoId: offer.id } });
      return { ...offer.toJSON(), inscritos, ...registrationState(offer, inscritos) };
    }));
    return res.send(results);
  } catch (error) {
    return res.status(500).send({ message: error.message || "No fue posible consultar las secciones." });
  }
};

exports.disponibles = async (req, res) => {
  try {
    const periodoAcademicoId = Number(req.query.periodoAcademicoId);
    if (!Number.isInteger(periodoAcademicoId) || periodoAcademicoId <= 0) {
      return res.status(400).send({ message: "Selecciona un período académico válido." });
    }
    const alumno = await Student.findOne({
      where: { usuarioId: req.userId, activo: true }
    });
    if (!alumno) return res.status(404).send({ message: "La cuenta no tiene un perfil de alumno activo." });
    const periodo = await db.periodosAcademicos.findByPk(periodoAcademicoId);
    if (!periodo) return res.status(404).send({ message: "El período académico no existe." });
    if (periodo.estado !== "abierto") {
      return res.status(409).send({ message: "No se puede consultar inscripción en un período académico cerrado." });
    }

    const offers = await Offer.findAll({
      where: { periodoAcademicoId, activo: true },
      include: offerIncludes(),
      order: [["cursoId", "ASC"], ["codigoSeccion", "ASC"]]
    });
    const programOffers = offers.filter(offer =>
      offer.curso?.activo &&
      offer.curso.gradoCarreraId === alumno.gradoCarreraId &&
      offer.periodoAcademico?.estado === "abierto"
    );
    const assignedCourseIds = await Assignment.findAll({
      where: { alumnoId: alumno.id, periodoAcademicoId },
      attributes: ["cursoId"]
    });
    const enrolledCourses = new Set(assignedCourseIds.map(item => item.cursoId));

    const results = await Promise.all(programOffers.map(async offer => {
      const inscritos = await Assignment.count({ where: { ofertaCursoId: offer.id } });
      const state = registrationState(offer, inscritos);
      if (enrolledCourses.has(offer.cursoId)) {
        state.registrationOpen = false;
        state.registrationReason = "Ya estás inscrito en este curso durante el período seleccionado.";
      }
      return { ...offer.toJSON(), inscritos, ...state };
    }));
    return res.send(results);
  } catch (error) {
    return res.status(500).send({ message: error.message || "No fue posible consultar las secciones disponibles." });
  }
};

exports.create = async (req, res) => {
  try {
    const cursoId = Number(req.body.cursoId);
    const catedraticoId = Number(req.body.catedraticoId);
    const periodoAcademicoId = Number(req.body.periodoAcademicoId);
    const cupoMaximo = Number(req.body.cupoMaximo);
    const codigoSeccion = typeof req.body.codigoSeccion === "string" ? req.body.codigoSeccion.trim() : "";
    const fechaInscripcionInicio = req.body.fechaInscripcionInicio;
    const fechaInscripcionFin = req.body.fechaInscripcionFin;
    if (![cursoId, catedraticoId, periodoAcademicoId].every(value => Number.isInteger(value) && value > 0) ||
        !Number.isInteger(cupoMaximo) || cupoMaximo < 1 ||
        !codigoSeccion || codigoSeccion.length > 30 ||
        !isValidDate(fechaInscripcionInicio) || !isValidDate(fechaInscripcionFin)) {
      return res.status(400).send({
        message: "Curso, catedrático, período, código de sección, cupo entero positivo y fechas válidas son requeridos."
      });
    }
    if (fechaInscripcionInicio > fechaInscripcionFin) {
      return res.status(400).send({ message: "La fecha final de inscripción no puede ser anterior a la fecha inicial." });
    }
    const [curso, catedratico, periodo] = await Promise.all([
      db.cursos.findByPk(cursoId),
      db.catedraticos.findByPk(catedraticoId),
      db.periodosAcademicos.findByPk(periodoAcademicoId, {
        include: [{ model: db.ciclosAcademicos, as: "cicloAcademico" }]
      })
    ]);
    if (!curso || !curso.activo) return res.status(404).send({ message: "El curso no existe o está inactivo." });
    if (!catedratico || !catedratico.activo) return res.status(404).send({ message: "El catedrático no existe o está inactivo." });
    if (!periodo) return res.status(404).send({ message: "El período académico no existe." });
    if (periodo.estado !== "abierto" || periodo.cicloAcademico?.estado !== "abierto") {
      return res.status(409).send({ message: "Solo se pueden ofrecer secciones en períodos y ciclos abiertos." });
    }
    if (fechaInscripcionInicio < periodo.fechaInicio || fechaInscripcionFin > periodo.fechaFin) {
      return res.status(400).send({ message: "Las fechas de inscripción deben estar dentro del período académico." });
    }
    const offer = await Offer.create({
      cursoId,
      catedraticoId,
      periodoAcademicoId,
      codigoSeccion,
      cupoMaximo,
      fechaInscripcionInicio,
      fechaInscripcionFin
    });
    return res.status(201).send(offer);
  } catch (error) {
    const status = error.name === "SequelizeUniqueConstraintError" ? 409 : 400;
    return res.status(status).send({ message: error.name === "SequelizeUniqueConstraintError"
      ? "Ya existe ese código de sección para el curso y período."
      : error.message || "No fue posible crear la sección." });
  }
};

exports.update = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const offer = await Offer.findByPk(req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
      include: offerIncludes()
    });
    if (!offer) {
      await transaction.rollback();
      return res.status(404).send({ message: "La sección no existe." });
    }
    const allowed = ["cupoMaximo", "fechaInscripcionInicio", "fechaInscripcionFin", "activo"];
    if (!Object.keys(req.body).length || Object.keys(req.body).some(field => !allowed.includes(field))) {
      await transaction.rollback();
      return res.status(400).send({ message: "Solo se permite editar cupo, fechas de inscripción o estado de la sección." });
    }
    if (req.body.activo !== undefined && typeof req.body.activo !== "boolean") {
      await transaction.rollback();
      return res.status(400).send({ message: "activo debe ser un valor booleano." });
    }
    const cupoMaximo = req.body.cupoMaximo === undefined ? offer.cupoMaximo : Number(req.body.cupoMaximo);
    const fechaInscripcionInicio = req.body.fechaInscripcionInicio ?? offer.fechaInscripcionInicio;
    const fechaInscripcionFin = req.body.fechaInscripcionFin ?? offer.fechaInscripcionFin;
    if (!Number.isInteger(cupoMaximo) || cupoMaximo < 1 ||
        !isValidDate(fechaInscripcionInicio) || !isValidDate(fechaInscripcionFin)) {
      await transaction.rollback();
      return res.status(400).send({ message: "El cupo debe ser un entero positivo y las fechas deben ser válidas." });
    }
    if (fechaInscripcionInicio > fechaInscripcionFin) {
      await transaction.rollback();
      return res.status(400).send({ message: "La fecha final de inscripción no puede ser anterior a la fecha inicial." });
    }
    const inscritos = await Assignment.count({
      where: { ofertaCursoId: offer.id },
      transaction
    });
    if (cupoMaximo < inscritos) {
      await transaction.rollback();
      return res.status(409).send({ message: `El cupo no puede ser menor que las ${inscritos} inscripciones existentes.` });
    }
    if (fechaInscripcionInicio < offer.periodoAcademico.fechaInicio ||
        fechaInscripcionFin > offer.periodoAcademico.fechaFin) {
      await transaction.rollback();
      return res.status(400).send({ message: "Las fechas de inscripción deben estar dentro del período académico." });
    }
    await offer.update({
      cupoMaximo,
      fechaInscripcionInicio,
      fechaInscripcionFin,
      ...(req.body.activo !== undefined ? { activo: Boolean(req.body.activo) } : {})
    }, { transaction });
    await transaction.commit();
    return res.send(offer);
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    return res.status(400).send({ message: error.message || "No fue posible actualizar la sección." });
  }
};
