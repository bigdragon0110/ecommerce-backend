import cors from "cors";
import express from "express";
import { checkDatabaseConnection } from "./config/db.js";
import customerAuthRoutes from "./routes/auth.js";
import adminAuthRoutes from "./routes/admin-auth.js";
import catalogRoutes from "./routes/catalog.js";
import commerceRoutes from "./routes/commerce.js";
import adminRoutes from "./routes/admin.js";
import accountRoutes from "./routes/account.js";

const app = express();
const allowedOrigins = new Set([
  process.env.SHOP_ORIGIN || "http://localhost:3000",
  process.env.ADMIN_ORIGIN || "http://localhost:3001",
]);

app.disable("x-powered-by");
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(Object.assign(new Error("Origin is not allowed by CORS."), { status: 403 }));
  },
}));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", async (_req, res, next) => {
  try {
    await checkDatabaseConnection();
    res.json({ success: true, status: "ok", database: "connected" });
  } catch (error) {
    next(error);
  }
});

app.use("/api/auth", customerAuthRoutes);
app.use("/api/admin/auth", adminAuthRoutes);
// Mount the specific admin namespace before the generic /api routers.
// Otherwise customer-auth middleware in commerce/account can intercept admin JWTs.
app.use("/api/admin", adminRoutes);
app.use("/api", catalogRoutes);
app.use("/api", commerceRoutes);
app.use("/api", accountRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
});
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({
    success: false,
    message: error.status ? error.message : "Internal server error.",
  });
});

export default app;
