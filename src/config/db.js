import mysql from "mysql2/promise";

const db = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "ecommerce",
  charset: "utf8mb4",
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true,
});

export const checkDatabaseConnection = async () => {
  await db.query("SELECT 1");
};

export default db;
