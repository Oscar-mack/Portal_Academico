// La carga del archivo .env correcto (.env.development / .env.production)
// se realiza en server.js ANTES de requerir este archivo, por lo que aquí
// solo leemos las variables ya presentes en process.env.
const databaseUrl = process.env.DATABASE_URL;

module.exports = {
  DATABASE_URL: databaseUrl,
  HOST: process.env.DB_HOST || process.env.PGHOST,
  USER: process.env.DB_USER || process.env.PGUSER,
  PASSWORD: process.env.DB_PASSWORD || process.env.PGPASSWORD,
  DB: process.env.DB_NAME || process.env.PGDATABASE,
  PORT: process.env.DB_PORT || process.env.PGPORT || 5432,
  dialect: "postgres",
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  },
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  }
};


