const db = require("../models");
const HorarioCatedratico = db.horariosCatedratico;
const Catedratico = db.catedraticos;
const Curso = db.cursos;
const { esHoraValida, aMinutos, seCruzan } = require("../utils/horarios.js");

exports.create = async (req, res) => {
	try {
		const { catedraticoId, cursoId, dia, horaInicio, horaFin, periodo } = req.body;
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
		const periodoEfectivo = periodo || "2026";
		const delCatedratico = await HorarioCatedratico.findAll({
			where: { catedraticoId, dia, periodo: periodoEfectivo }
		});
		if (delCatedratico.some(h => seCruzan(h, { dia, horaInicio, horaFin }))) {
			return res.status(409).send({ message: "El horario se cruza con otro horario del catedrático." });
		}

		const horario = await HorarioCatedratico.create({
			catedraticoId, cursoId, dia, horaInicio, horaFin, periodo: periodoEfectivo
		});
		res.status(201).send(horario);
	} catch (error) {
		res.status(500).send({ message: error.message || "Error al crear el horario." });
	}
};

exports.findAll = async (req, res) => {
	try {
		const where = {};
		if (req.query.catedraticoId) where.catedraticoId = req.query.catedraticoId;
		if (req.query.cursoId) where.cursoId = req.query.cursoId;
		const horarios = await HorarioCatedratico.findAll({
			where,
			include: [{ model: Catedratico, as: "catedratico" }, { model: Curso, as: "curso" }]
		});
		res.send(horarios);
	} catch (error) {
		res.status(500).send({ message: "Error al obtener los horarios." });
	}
};

exports.findOne = async (req, res) => {
	try {
		const horario = await HorarioCatedratico.findByPk(req.params.id, {
			include: [{ model: Catedratico, as: "catedratico" }, { model: Curso, as: "curso" }]
		});
		if (!horario) return res.status(404).send({ message: `No se encontró el horario con id=${req.params.id}.` });
		res.send(horario);
	} catch (error) {
		res.status(500).send({ message: "Error al obtener el horario." });
	}
};

exports.update = async (req, res) => {
	try {
		const [updated] = await HorarioCatedratico.update(req.body, { where: { id: req.params.id } });
		if (updated !== 1) return res.status(404).send({ message: `No se pudo actualizar el horario con id=${req.params.id}.` });
		res.send({ message: "Horario actualizado exitosamente." });
	} catch (error) {
		res.status(500).send({ message: "Error al actualizar el horario." });
	}
};

exports.delete = async (req, res) => {
	try {
		const deleted = await HorarioCatedratico.destroy({ where: { id: req.params.id } });
		if (deleted !== 1) return res.status(404).send({ message: `No se pudo eliminar el horario con id=${req.params.id}.` });
		res.send({ message: "Horario eliminado exitosamente." });
	} catch (error) {
		res.status(500).send({ message: "Error al eliminar el horario." });
	}
};
