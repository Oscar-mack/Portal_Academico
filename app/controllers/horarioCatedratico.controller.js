const db = require("../models");
const HorarioCatedratico = db.horariosCatedratico;
const Catedratico = db.catedraticos;
const Curso = db.cursos;

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
		const horario = await HorarioCatedratico.create({ catedraticoId, cursoId, dia, horaInicio, horaFin, periodo });
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
