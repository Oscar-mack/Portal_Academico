const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const aMinutos = hora => {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
};

const esHoraValida = hora => typeof hora === "string" && HORA_REGEX.test(hora);

// Dos intervalos se cruzan si cada uno empieza antes de que el otro termine.
const seCruzan = (a, b) =>
  a.dia === b.dia && aMinutos(a.horaInicio) < aMinutos(b.horaFin) && aMinutos(b.horaInicio) < aMinutos(a.horaFin);

module.exports = { esHoraValida, aMinutos, seCruzan };
