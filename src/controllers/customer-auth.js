import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { createUser, findById, findByLogin, findByUsernameOrEmail, updateLastLogin } from "../models/users.js";

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const safeUser = (user) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  firstName: user.first_name || null,
  lastName: user.last_name || null,
  status: user.status,
});
const tokenFor = (user) => {
  if (!process.env.CUSTOMER_JWT_SECRET) throw new Error("CUSTOMER_JWT_SECRET is not configured.");
  return jwt.sign({ sub: user.id, type: "customer" }, process.env.CUSTOMER_JWT_SECRET, {
    expiresIn: process.env.CUSTOMER_JWT_EXPIRES_IN || "7d",
  });
};

export const register = async (req, res, next) => {
  const username = String(req.body?.username || "").trim();
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  if (!username || !email || !password) return res.status(400).json({ success: false, message: "Username, email, and password are required." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: "Enter a valid email address." });
  if (password.length < 8) return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
  try {
    if (await findByUsernameOrEmail(username, email)) return res.status(409).json({ success: false, message: "Username or email is already registered." });
    const user = await createUser({ username, email, passwordHash: await bcrypt.hash(password, 12) });
    return res.status(201).json({ success: true, token: tokenFor(user), user: safeUser(user) });
  } catch (error) { return next(error); }
};

export const login = async (req, res, next) => {
  const loginValue = String(req.body?.login || req.body?.username || req.body?.email || "").trim();
  const password = String(req.body?.password || "");
  if (!loginValue || !password) return res.status(400).json({ success: false, message: "Login and password are required." });
  try {
    const user = await findByLogin(loginValue);
    if (!user || user.status !== "ACTIVE" || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ success: false, message: "Invalid login or password." });
    }
    await updateLastLogin(user.id);
    return res.json({ success: true, token: tokenFor(user), user: safeUser(user) });
  } catch (error) { return next(error); }
};

export const me = async (req, res, next) => {
  try {
    const user = await findById(req.auth.sub);
    if (!user) return res.status(404).json({ success: false, message: "Customer not found." });
    return res.json({ success: true, user: safeUser(user) });
  } catch (error) { return next(error); }
};
