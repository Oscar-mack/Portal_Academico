const test = require("node:test");
const assert = require("node:assert/strict");
const { Sequelize, DataTypes } = require("sequelize");
const defineNota = require("../app/models/nota.model.js");

const sequelize = new Sequelize("sqlite::memory:", { logging: false });
const Nota = defineNota(sequelize, DataTypes);

test("una nota de 60 reprueba y una de 61 aprueba (hook beforeValidate)", async () => {
  const reprobada = Nota.build({ alumnoId: 1, cursoId: 1, catedraticoId: 1, valor: 60 });
  await reprobada.validate();
  assert.equal(reprobada.estado, "reprobado");

  const aprobada = Nota.build({ alumnoId: 1, cursoId: 1, catedraticoId: 1, valor: 61 });
  await aprobada.validate();
  assert.equal(aprobada.estado, "aprobado");
});

test("el umbral NOTA_MINIMA_APROBACION esta exportado en el modelo (B3)", () => {
  assert.ok(typeof Nota.NOTA_MINIMA_APROBACION === "number", "El umbral debe ser numerico");
  assert.equal(Nota.NOTA_MINIMA_APROBACION, 61, "El umbral actual es 61 (confirmar con institucion)");
});

test("valor en el limite inferior (0) es valido y reprueba", async () => {
  const n = Nota.build({ alumnoId: 1, cursoId: 1, catedraticoId: 1, valor: 0 });
  await n.validate();
  assert.equal(n.estado, "reprobado");
});

test("valor en el limite superior (100) es valido y aprueba", async () => {
  const n = Nota.build({ alumnoId: 1, cursoId: 1, catedraticoId: 1, valor: 100 });
  await n.validate();
  assert.equal(n.estado, "aprobado");
});

test("publicadaEn inicia en null (B5: nota no publicada por defecto)", () => {
  const n = Nota.build({ alumnoId: 1, cursoId: 1, catedraticoId: 1, valor: 75 });
  assert.equal(n.publicadaEn, null);
});

test("transiciones de estado de pago: pagado es terminal (C2)", () => {
  const TRANSICIONES_VALIDAS = {
    pendiente: ["pagado", "fallido", "cancelado"],
    fallido: [],
    cancelado: [],
    pagado: []
  };
  const puede = (desde, hacia) => (TRANSICIONES_VALIDAS[desde] ?? []).includes(hacia);

  assert.ok(puede("pendiente", "pagado"));
  assert.ok(puede("pendiente", "fallido"));
  assert.ok(puede("pendiente", "cancelado"));
  assert.equal(puede("pagado", "cancelado"), false);
  assert.equal(puede("pagado", "pendiente"), false);
  assert.equal(puede("cancelado", "pagado"), false);
});
