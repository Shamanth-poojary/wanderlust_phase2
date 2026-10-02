const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "wanderlust",
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true,   // DECIMAL columns come back as Numbers
  dateStrings: false,     // TIMESTAMP columns come back as Date objects
});

module.exports = pool;
