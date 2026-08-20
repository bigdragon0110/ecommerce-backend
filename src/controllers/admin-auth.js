import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { findAdminById, findAdminByLogin, updateAdminLastLogin } from "../models/admins.js";

const safeAdmin = (admin) => ({
  id: admin.id,
  username: admin.username,
  email: admin.email,
  firstName: admin.first_name || null,
  lastName: admin.last_name || null,
  avatarUrl: admin.avatar_url || null,
  role: admin.role,
  status: admin.status,
});
const tokenFor = (admin) => {
  if (!process.env.ADMIN_JWT_SECRET) throw new Error("ADMIN_JWT_SECRET is not configured.");
  return jwt.sign({ sub: admin.id, type: "admin", role: admin.role }, process.env.ADMIN_JWT_SECRET, {
    expiresIn: process.env.ADMIN_JWT_EXPIRES_IN || "8h",
  });
};

export const login = async (req, res, next) => {
  const loginValue = String(req.body?.login || req.body?.username || req.body?.email || "").trim();
  const password = String(req.body?.password || "");
  if (!loginValue || !password) return res.status(400).json({ success: false, message: "Login and password are required." });
  try {
    const admin = await findAdminByLogin(loginValue);
    if (!admin || admin.status !== "ACTIVE" || !(await bcrypt.compare(password, admin.password_hash))) {
      return res.status(401).json({ success: false, message: "Invalid admin login or password." });
    }
    await updateAdminLastLogin(admin.id);
    return res.json({ success: true, token: tokenFor(admin), admin: safeAdmin(admin) });
  } catch (error) { return next(error); }
};

export const me = async (req, res, next) => {
  try {
    const admin = await findAdminById(req.auth.sub);
    if (!admin || admin.status !== "ACTIVE") return res.status(404).json({ success: false, message: "Admin not found." });
    return res.json({ success: true, admin: safeAdmin(admin) });
  } catch (error) { return next(error); }
};
