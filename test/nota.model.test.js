const test = require("node:test");
const assert = require("node:assert/strict");
const { Sequelize, DataTypes } = require("sequelize");
const defineNota = require("../app/models/nota.model.js");

const sequelize = new Sequelize("postgres://usuario:clave@localhost:5432/pruebas", {
  logging: false
});
const Nota = defineNota(sequelize, DataTypes);

test("una nota de 60 reprueba y una de 61 aprueba", async () => {
  const reprobada = Nota.build({
    alumnoId: 1,
    cursoId: 1,
    catedraticoId: 1,
    valor: 60
  });
  await reprobada.validate();
  assert.equal(reprobada.estado, "reprobado");

  const aprobada = Nota.build({
    alumnoId: 1,
    cursoId: 1,
    catedraticoId: 1,
    valor: 61
  });
  await aprobada.validate();
  assert.equal(aprobada.estado, "aprobado");
});