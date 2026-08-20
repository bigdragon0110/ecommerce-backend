import db from "../config/db.js";

export const findByUsernameOrEmail = async (username, email) => {
  const [rows] = await db.execute(
    "SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1",
    [username, email],
  );
  return rows[0] || null;
};

export const findByLogin = async (login) => {
  const [rows] = await db.execute(
    "SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1",
    [login, login.toLowerCase()],
  );
  return rows[0] || null;
};

export const findById = async (id) => {
  const [rows] = await db.execute("SELECT * FROM users WHERE id = ? LIMIT 1", [id]);
  return rows[0] || null;
};

export const createUser = async ({ username, email, passwordHash }) => {
  const [result] = await db.execute(
    "INSERT INTO users (username, email, password_hash, status) VALUES (?, ?, ?, 'ACTIVE')",
    [username, email, passwordHash],
  );
  return { id: result.insertId, username, email, status: "ACTIVE" };
};

export const updateLastLogin = async (id) => {
  await db.execute("UPDATE users SET last_login_at = NOW() WHERE id = ?", [id]);
};
