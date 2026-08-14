// Cargar la configuración privada y, si existe, sus valores por ambiente.
const path = require("path");
const NODE_ENV = process.env.NODE_ENV || "development";

require("dotenv").config({
  path: path.resolve(__dirname, ".env")
});
require("dotenv").config({
  path: path.resolve(__dirname, `.env.${NODE_ENV}`),
  override: true
});

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

const app = express();

console.log(`Ambiente actual: ${NODE_ENV}`);

// ==================== Middlewares globales ====================
var corsOptions = {
  origin: process.env.CORS_ORIGIN || "*"
};
app.use(cors(corsOptions));

// El webhook de Stripe (app/routes/pago.routes.js) usa su propio bodyParser.raw()
// en su ruta específica, por lo que no entra en conflicto con este parser global.
require("./app/routes/pago.routes")(app);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ==================== Base de datos ====================
const db = require("./app/models");

// En desarrollo, sync() sin force crea las tablas si no existen y las
// actualiza de forma no destructiva. Para reiniciar el esquema desde cero
// en un entorno de pruebas, se puede usar { force: true } manualmente.
db.sequelize.sync().then(() => {
  console.log("Base de datos sincronizada correctamente.");
}).catch(err => {
  console.error("Error al sincronizar la base de datos:", err.message);
});

// ==================== Ruta de prueba ====================
app.get("/", (req, res) => {
  res.json({ message: "Portal Académico API - Backend funcionando correctamente." });
});

// ==================== Rutas ====================
require("./app/routes/auth.routes")(app);
require("./app/routes/gradoCarrera.routes")(app);
require("./app/routes/catedratico.routes")(app);
require("./app/routes/alumno.routes")(app);
require("./app/routes/curso.routes")(app);
require("./app/routes/asignacionCurso.routes")(app);
require("./app/routes/horarioCatedratico.routes")(app);
require("./app/routes/nota.routes")(app);
require("./app/routes/reporte.routes")(app);

// ==================== Manejo de errores no controlados ====================
app.use((req, res) => {
  res.status(404).send({ message: "Ruta no encontrada." });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send({ message: "Ocurrió un error interno en el servidor." });
});

// ==================== Levantar el servidor ====================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}.`);
});


