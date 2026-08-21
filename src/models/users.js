import db from "../config/db.js";

export const findByUsernameOrEmail = async (username, email) => {
  const [rows] = await db.execute(
    "SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1",
    [username, email],
  );
  return rows[0] || null;
};

export const isRegistrationValueAvailable = async ({ username, email, nickname }) => {
  const clauses = []; const values = [];
  if (username) { clauses.push("username = ?"); values.push(username); }
  if (email) { clauses.push("email = ?"); values.push(email.toLowerCase()); }
  if (nickname) { clauses.push("nickname = ?"); values.push(nickname); }
  if (!clauses.length) return false;
  const [rows] = await db.execute(`SELECT id FROM users WHERE ${clauses.join(" OR ")} LIMIT 1`, values);
  return rows.length === 0;
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

export const createUser = async ({ username, email, passwordHash, firstName, lastName, nickname, marketingConsent, profilePublic, referralCode, consentAcceptedAt }) => {
  const [result] = await db.execute(
    `INSERT INTO users (username, email, password_hash, first_name, last_name, nickname, marketing_consent, profile_public, referral_code, terms_accepted_at, privacy_accepted_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
    [username, email, passwordHash, firstName, lastName, nickname || null, Boolean(marketingConsent), Boolean(profilePublic), referralCode || null, consentAcceptedAt, consentAcceptedAt],
  );
  return { id: result.insertId, username, email, first_name: firstName, last_name: lastName, status: "ACTIVE" };
};

export const updateLastLogin = async (id) => {
  await db.execute("UPDATE users SET last_login_at = NOW() WHERE id = ?", [id]);
};
