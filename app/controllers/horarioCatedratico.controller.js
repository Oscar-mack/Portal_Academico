const db = require("../models");
const HorarioCatedratico = db.horariosCatedratico;
const Catedratico = db.catedraticos;
const Curso = db.cursos;
const Alumno = db.alumnos;
const PadreAlumno = db.padresAlumnos;
const AsignacionCurso = db.asignacionesCurso;
const ROLES = require("../config/roles.js");
const { esHoraValida, aMinutos, seCruzan } = require("../utils/horarios.js");

async function getHorariosVisibles(req) {
	if (req.userRole === ROLES.ADMIN) return null;

	if (req.userRole === ROLES.CATEDRATICO) {
		const catedratico = await Catedratico.findOne({ where: { usuarioId: req.userId } });
		return catedratico ? { catedraticoId: catedratico.id } : { id: [] };
	}

	let alumnoIds;
	if (req.userRole === ROLES.ALUMNO) {
		const alumno = await Alumno.findOne({ where: { usuarioId: req.userId } });
		alumnoIds = alumno ? [alumno.id] : [];
	} else if (req.userRole === ROLES.PADRE) {
		if (req.query.alumnoId) {
			const vinculo = await PadreAlumno.findOne({
				where: { usuarioId: req.userId, alumnoId: req.query.alumnoId }
			});
			if (!vinculo) return { forbidden: true };
			alumnoIds = [Number(req.query.alumnoId)];
		} else {
			const vinculos = await PadreAlumno.findAll({ where: { usuarioId: req.userId } });
			alumnoIds = vinculos.map(vinculo => vinculo.alumnoId);
		}
	} else {
		return { id: [] };
	}

	if (alumnoIds.length === 0) return { id: [] };
	const asignaciones = await AsignacionCurso.findAll({
		where: {
			alumnoId: alumnoIds,
			...(req.query.periodoAcademicoId ? { periodoAcademicoId: req.query.periodoAcademicoId } : {}),
			...(req.query.periodo ? { periodo: req.query.periodo } : {})
		},
		attributes: ["cursoId", "ofertaCursoId"]
	});
	const ofertaIds = [...new Set(asignaciones.map(asignacion => asignacion.ofertaCursoId).filter(Boolean))];
	const cursosLegacyIds = [...new Set(asignaciones
		.filter(asignacion => !asignacion.ofertaCursoId)
		.map(asignacion => asignacion.cursoId))];
	const scopes = [];
	if (ofertaIds.length) scopes.push({ ofertaCursoId: ofertaIds });
	if (cursosLegacyIds.length) scopes.push({ cursoId: cursosLegacyIds, ofertaCursoId: null });
	return scopes.length ? { [db.Sequelize.Op.or]: scopes } : { id: [] };
}

async function puedeVerHorario(req, horario) {
	if (req.userRole === ROLES.ADMIN) return true;
	if (req.query.periodo && String(horario.periodo) !== String(req.query.periodo)) return false;
	if (req.userRole === ROLES.CATEDRATICO) {
		const catedratico = await Catedratico.findOne({ where: { usuarioId: req.userId } });
		return Boolean(catedratico && catedratico.id === horario.catedraticoId);
	}

	const visibles = await getHorariosVisibles(req);
	if (visibles.forbidden || visibles.id) return false;
	return Boolean(await HorarioCatedratico.count({
		where: { ...visibles, id: horario.id }
	}));
}

exports.create = async (req, res) => {
	try {
		const { catedraticoId, cursoId, dia, horaInicio, horaFin, periodo, periodoAcademicoId } = req.body;
		const ofertaCursoId = req.body.ofertaCursoId === undefined ||
			req.body.ofertaCursoId === null || req.body.ofertaCursoId === ""
			? null
			: Number(req.body.ofertaCursoId);
		if (!catedraticoId || !cursoId || !dia || !horaInicio || !horaFin) {
			return res.status(400).send({ message: "catedraticoId, cursoId, dia, horaInicio y horaFin son requeridos." });
		}
		const [catedratico, curso] = await Promise.all([
			Catedratico.findByPk(catedraticoId),
			Curso.findByPk(cursoId)
		]);
		if (!catedratico || !curso) {
			return res.status(404).send({ message: "El catedrático o curso indicado no existe." });
		}
		if (!esHoraValida(horaInicio) || !esHoraValida(horaFin)) {
			return res.status(400).send({ message: "horaInicio y horaFin deben tener formato HH:MM (24 horas)." });
		}
		if (aMinutos(horaInicio) >= aMinutos(horaFin)) {
			return res.status(400).send({ message: "horaInicio debe ser menor que horaFin." });
		}

		// Un catedrático no puede tener dos clases que se crucen en el mismo periodo.
		let periodoAcademico = null;
		if (periodoAcademicoId) {
			periodoAcademico = await db.periodosAcademicos.findByPk(periodoAcademicoId);
			if (!periodoAcademico) {
				return res.status(404).send({ message: "El período académico indicado no existe." });
			}
			if (periodoAcademico.estado !== "abierto") {
				return res.status(409).send({ message: "No se puede asignar un horario a un período cerrado." });
			}
		}
		const periodoEfectivo = periodoAcademico ? `academico:${periodoAcademico.id}` : (periodo || "2026");
		const filtroPeriodo = periodoAcademico
			? { periodoAcademicoId: periodoAcademico.id }
			: { periodo: periodoEfectivo };
		let ofertaCurso = null;
		if (ofertaCursoId !== null) {
			if (!Number.isInteger(ofertaCursoId) || ofertaCursoId <= 0) {
				return res.status(400).send({ message: "ofertaCursoId debe ser un identificador válido." });
			}
			ofertaCurso = await db.ofertasCurso.findByPk(ofertaCursoId);
			if (!ofertaCurso || ofertaCurso.cursoId !== Number(cursoId) ||
				ofertaCurso.catedraticoId !== Number(catedraticoId) ||
				ofertaCurso.periodoAcademicoId !== Number(periodoAcademicoId)) {
				return res.status(400).send({ message: "El horario debe coincidir con el curso, catedrático y período de la sección." });
			}
			if (!ofertaCurso.activo) {
				return res.status(409).send({ message: "No se puede agregar horario a una sección desactivada." });
			}
			if (await AsignacionCurso.count({ where: { ofertaCursoId: ofertaCurso.id } })) {
				return res.status(409).send({ message: "No se puede agregar horario después de que alumnos se inscribieron en la sección." });
			}
		}
		const delCatedratico = await HorarioCatedratico.findAll({
			where: { catedraticoId, dia, ...filtroPeriodo }
		});
		if (delCatedratico.some(h => seCruzan(h, { dia, horaInicio, horaFin }))) {
			return res.status(409).send({ message: "El horario se cruza con otro horario del catedrático." });
		}

		const horario = await HorarioCatedratico.create({
			catedraticoId, cursoId, dia, horaInicio, horaFin, periodo: periodoEfectivo,
			...(periodoAcademico ? { periodoAcademicoId: periodoAcademico.id } : {}),
			...(ofertaCurso ? { ofertaCursoId: ofertaCurso.id } : {})
		});
		res.status(201).send(horario);
	} catch (error) {
		res.status(500).send({ message: error.message || "Error al crear el horario." });
	}
};

exports.findAll = async (req, res) => {
	try {
		const where = (await getHorariosVisibles(req)) || {};
		if (where.forbidden) {
			return res.status(403).send({ message: "No tienes acceso a los horarios de este alumno." });
		}
		if (req.userRole === ROLES.ADMIN && req.query.catedraticoId) where.catedraticoId = req.query.catedraticoId;
		if (req.query.cursoId) {
			if (Array.isArray(where.cursoId)) {
				where.cursoId = where.cursoId.filter(id => id === Number(req.query.cursoId));
			} else {
				where.cursoId = req.query.cursoId;
			}
		}
		if (req.query.periodoAcademicoId) where.periodoAcademicoId = req.query.periodoAcademicoId;
		if (req.query.periodo) where.periodo = req.query.periodo;
		const horarios = await HorarioCatedratico.findAll({
			where,
			include: [{ model: Catedratico, as: "catedratico" }, { model: Curso, as: "curso" }]
		});
		res.send(horarios);
	} catch (error) {
		console.error("Error al obtener los horarios:", error.message);
		res.status(500).send({ message: "Error al obtener los horarios." });
	}
};

exports.findOne = async (req, res) => {
	try {
		const horario = await HorarioCatedratico.findByPk(req.params.id, {
			include: [{ model: Catedratico, as: "catedratico" }, { model: Curso, as: "curso" }]
		});
		if (!horario) return res.status(404).send({ message: `No se encontró el horario con id=${req.params.id}.` });
		if (!(await puedeVerHorario(req, horario))) {
			return res.status(403).send({ message: "No tienes acceso a este horario." });
		}
		res.send(horario);
	} catch (error) {
		console.error("Error al obtener el horario:", error.message);
		res.status(500).send({ message: "Error al obtener el horario." });
	}
};

exports.update = async (req, res) => {
	const transaction = await db.sequelize.transaction();
	try {
		const horario = await HorarioCatedratico.findByPk(req.params.id, {
			transaction,
			lock: transaction.LOCK.UPDATE
		});
		if (!horario) {
			await transaction.rollback();
			return res.status(404).send({ message: `No se pudo actualizar el horario con id=${req.params.id}.` });
		}
		const camposPermitidos = ["dia", "horaInicio", "horaFin"];
		if (Object.keys(req.body).some(campo => !camposPermitidos.includes(campo)) ||
			!Object.keys(req.body).some(campo => camposPermitidos.includes(campo))) {
			await transaction.rollback();
			return res.status(400).send({ message: "Solo se permite editar día y horas; los vínculos del horario son inmutables." });
		}
		if (horario.periodoAcademicoId) {
			const periodo = await db.periodosAcademicos.findByPk(horario.periodoAcademicoId, {
				transaction,
				lock: transaction.LOCK.UPDATE
			});
			if (periodo?.estado !== "abierto") {
				await transaction.rollback();
				return res.status(409).send({ message: "No se puede modificar un horario de un período cerrado." });
			}
			const evaluaciones = await db.evaluaciones.count({
				where: {
					cursoId: horario.cursoId,
					catedraticoId: horario.catedraticoId,
					periodoAcademicoId: horario.periodoAcademicoId
				},
				transaction
			});
			if (evaluaciones > 0) {
				await transaction.rollback();
				return res.status(409).send({ message: "No se puede cambiar el horario después de crear evaluaciones para ese curso y período." });
			}
		}
		if (horario.ofertaCursoId && await AsignacionCurso.count({
			where: { ofertaCursoId: horario.ofertaCursoId },
			transaction
		})) {
			await transaction.rollback();
			return res.status(409).send({ message: "No se puede modificar un horario con alumnos inscritos en la sección." });
		}
		const dia = req.body.dia === undefined ? horario.dia : req.body.dia;
		const horaInicio = req.body.horaInicio === undefined ? horario.horaInicio : req.body.horaInicio;
		const horaFin = req.body.horaFin === undefined ? horario.horaFin : req.body.horaFin;
		if (!esHoraValida(horaInicio) || !esHoraValida(horaFin) || aMinutos(horaInicio) >= aMinutos(horaFin)) {
			await transaction.rollback();
			return res.status(400).send({ message: "El horario requiere horas válidas y horaInicio menor que horaFin." });
		}
		const existentes = await HorarioCatedratico.findAll({
			where: {
				catedraticoId: horario.catedraticoId,
				dia,
				...(horario.periodoAcademicoId
					? { periodoAcademicoId: horario.periodoAcademicoId }
					: { periodo: horario.periodo }),
				id: { [db.Sequelize.Op.ne]: horario.id }
			},
			transaction
		});
		if (existentes.some(existente => seCruzan(existente, { dia, horaInicio, horaFin }))) {
			await transaction.rollback();
			return res.status(409).send({ message: "El horario se cruza con otro horario del catedrático." });
		}
		await horario.update({ dia, horaInicio, horaFin }, { transaction });
		await transaction.commit();
		return res.send(horario);
	} catch (error) {
		await transaction.rollback();
		return res.status(500).send({ message: error.message || "Error al actualizar el horario." });
	}
};

exports.delete = async (req, res) => {
	const transaction = await db.sequelize.transaction();
	try {
		const horario = await HorarioCatedratico.findByPk(req.params.id, {
			transaction,
			lock: transaction.LOCK.UPDATE
		});
		if (!horario) {
			await transaction.rollback();
			return res.status(404).send({ message: `No se pudo eliminar el horario con id=${req.params.id}.` });
		}
		if (horario.periodoAcademicoId) {
			const evaluaciones = await db.evaluaciones.count({
				where: {
					cursoId: horario.cursoId,
					catedraticoId: horario.catedraticoId,
					periodoAcademicoId: horario.periodoAcademicoId
				},
				transaction
			});
			if (evaluaciones > 0) {
				await transaction.rollback();
				return res.status(409).send({ message: "No se puede eliminar un horario relacionado con evaluaciones existentes." });
			}
		}
		if (horario.ofertaCursoId && await AsignacionCurso.count({
			where: { ofertaCursoId: horario.ofertaCursoId },
			transaction
		})) {
			await transaction.rollback();
			return res.status(409).send({ message: "No se puede eliminar un horario con alumnos inscritos en la sección." });
		}
		await horario.destroy({ transaction });
		await transaction.commit();
		return res.send({ message: "Horario eliminado exitosamente." });
	} catch (error) {
		await transaction.rollback();
		res.status(500).send({ message: error.message || "Error al eliminar el horario." });
	}
};
