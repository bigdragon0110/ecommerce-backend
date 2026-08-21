import db from "../config/db.js";

export const findAdminByLogin = async (login) => {
  const [rows] = await db.execute(
    "SELECT * FROM admins WHERE username = ? LIMIT 1",
    [login],
  );
  return rows[0] || null;
};

export const findAdminById = async (id) => {
  const [rows] = await db.execute("SELECT * FROM admins WHERE id = ? LIMIT 1", [id]);
  return rows[0] || null;
};

export const updateAdminLastLogin = async (id) => {
  await db.execute("UPDATE admins SET last_login_at = NOW() WHERE id = ?", [id]);
};
