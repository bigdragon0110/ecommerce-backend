import jwt from "jsonwebtoken";

export const authenticate = (type) => (req, res, next) => {
  const value = req.get("authorization") || "";
  const token = value.startsWith("Bearer ") ? value.slice(7) : "";
  if (!token) return res.status(401).json({ message: "Authentication required." });

  try {
    const secret = type === "admin" ? process.env.ADMIN_JWT_SECRET : process.env.CUSTOMER_JWT_SECRET;
    if (!secret) throw new Error(`${type.toUpperCase()}_JWT_SECRET is not configured.`);
    const payload = jwt.verify(token, secret);
    if (payload.type !== type) return res.status(403).json({ message: "Invalid account type." });
    req.auth = payload;
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
};

export const customerAuth = authenticate("customer");
export const adminAuth = authenticate("admin");
