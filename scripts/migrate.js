const fs = require("fs");
const path = require("path");

const nodeEnv = process.env.NODE_ENV || "development";
require("dotenv").config({ path: path.resolve(__dirname, "..", `.env.${nodeEnv}`), quiet: true });
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });

const db = require("../app/models");

// Uso: node scripts/migrate.js  (aplica todos los .sql de scripts/migrations en orden)
async function main() {
  const dir = path.join(__dirname, "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await db.sequelize.query(fs.readFileSync(path.join(dir, file), "utf8"));
    console.log(`Migración aplicada: ${file}`);
  }
  const [columns] = await db.sequelize.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'usuarios' ORDER BY ordinal_position"
  );
  console.log("Columnas de usuarios:", columns.map((c) => c.column_name).join(", "));
}

main()
  .catch((error) => {
    console.error("Error en la migración:", error.message);
    process.exitCode = 1;
  })
  .finally(() => db.sequelize.close());
