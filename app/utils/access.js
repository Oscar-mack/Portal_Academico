const db = require("../models");
const ROLES = require("../config/roles.js");

// Devuelve los ids de alumno que el usuario puede consultar.
// null significa "sin restricción" (administrador).
async function getAlumnoIdsVisibles(req) {
  if (req.userRole === ROLES.ADMIN) return null;

  if (req.userRole === ROLES.ALUMNO) {
    const alumno = await db.alumnos.findOne({ where: { usuarioId: req.userId } });
    return alumno ? [alumno.id] : [];
  }

  if (req.userRole === ROLES.PADRE) {
    const vinculos = await db.padresAlumnos.findAll({ where: { usuarioId: req.userId } });
    return vinculos.map(v => v.alumnoId);
  }

  if (req.userRole === ROLES.CATEDRATICO) {
    const catedratico = await db.catedraticos.findOne({ where: { usuarioId: req.userId } });
    if (!catedratico) return [];
    const horarios = await db.horariosCatedratico.findAll({ where: { catedraticoId: catedratico.id } });
    const cursoIds = [...new Set(horarios.map(h => h.cursoId))];
    if (cursoIds.length === 0) return [];
    const asignaciones = await db.asignacionesCurso.findAll({ where: { cursoId: cursoIds } });
    return [...new Set(asignaciones.map(a => a.alumnoId))];
  }

  return [];
}

module.exports = { getAlumnoIdsVisibles };
