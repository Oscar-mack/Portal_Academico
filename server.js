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

async function startServer() {
  try {
    await db.sequelize.authenticate();
    console.log("Conexion con PostgreSQL verificada correctamente.");

    await db.sequelize.query("SELECT 1 AS database_connection_check");
    console.log("Consulta de prueba a PostgreSQL realizada correctamente.");

    await db.sequelize.sync();
    console.log("Base de datos sincronizada correctamente.");

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}.`);
    });
  } catch (error) {
    console.error("Error al conectar o sincronizar la base de datos:", {
      name: error.name,
      message: error.message,
      code: error.parent?.code || error.original?.code || error.code,
      detail: error.parent?.detail || error.original?.detail,
      host: process.env.DB_HOST || process.env.PGHOST || "DATABASE_URL configurada"
    });
    console.error(error);
    process.exit(1);
  }
}

startServer();


//Cambios nnecesarios 



