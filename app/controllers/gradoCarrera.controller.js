const db = require("../models");
const GradoCarrera = db.gradosCarreras;

exports.create = async (req, res) => {
	try {
		if (!req.body.nombre) {
			return res.status(400).send({ message: "nombre es requerido." });
		}
		const gradoCarrera = await GradoCarrera.create({
			nombre: req.body.nombre,
			nivel: req.body.nivel,
			descripcion: req.body.descripcion
		});
		res.status(201).send(gradoCarrera);
	} catch (error) {
		res.status(500).send({ message: error.message || "Error al crear el grado o carrera." });
	}
};

exports.findAll = async (req, res) => {
	try {
		const gradosCarreras = await GradoCarrera.findAll();
		res.send(gradosCarreras);
	} catch (error) {
		res.status(500).send({ message: "Error al obtener los grados y carreras." });
	}
};

exports.findOne = async (req, res) => {
	try {
		const gradoCarrera = await GradoCarrera.findByPk(req.params.id);
		if (!gradoCarrera) {
			return res.status(404).send({ message: `No se encontró el grado o carrera con id=${req.params.id}.` });
		}
		res.send(gradoCarrera);
	} catch (error) {
		res.status(500).send({ message: "Error al obtener el grado o carrera." });
	}
};

exports.update = async (req, res) => {
	try {
		const [updated] = await GradoCarrera.update(req.body, { where: { id: req.params.id } });
		if (updated !== 1) {
			return res.status(404).send({ message: `No se pudo actualizar el grado o carrera con id=${req.params.id}.` });
		}
		res.send({ message: "Grado o carrera actualizado exitosamente." });
	} catch (error) {
		res.status(500).send({ message: "Error al actualizar el grado o carrera." });
	}
};

exports.delete = async (req, res) => {
	try {
		const deleted = await GradoCarrera.destroy({ where: { id: req.params.id } });
		if (deleted !== 1) {
			return res.status(404).send({ message: `No se pudo eliminar el grado o carrera con id=${req.params.id}.` });
		}
		res.send({ message: "Grado o carrera eliminado exitosamente." });
	} catch (error) {
		res.status(500).send({ message: "Error al eliminar el grado o carrera." });
	}
};
