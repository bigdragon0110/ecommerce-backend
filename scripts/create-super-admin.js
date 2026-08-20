import bcrypt from "bcrypt";
import dotenv from "dotenv";

dotenv.config({ path: process.env.NODE_ENV === "production" ? ".env" : ".env.local" });

const { default: db } = await import("../src/config/db.js");

const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const username = String(process.env.ADMIN_USERNAME || "").trim();
const password = String(process.env.ADMIN_PASSWORD || "");

if (!email || !username || password.length < 10) {
  console.error("Set ADMIN_EMAIL, ADMIN_USERNAME, and ADMIN_PASSWORD (at least 10 characters) before running this command.");
  process.exitCode = 1;
} else {
  try {
    const [existing] = await db.execute("SELECT id FROM admins WHERE email=? OR username=? LIMIT 1", [email, username]);
    if (existing[0]) throw new Error("An administrator with that email or username already exists.");
    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await db.execute(
      "INSERT INTO admins(email,username,password_hash,display_name,role,status) VALUES(?,?,?,?,\"SUPER_ADMIN\",\"ACTIVE\")",
      [email, username, passwordHash, process.env.ADMIN_DISPLAY_NAME || username],
    );
    console.log(`Created super administrator #${result.insertId}: ${username}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}
