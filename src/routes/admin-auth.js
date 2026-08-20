import { Router } from "express";
import { login, me } from "../controllers/admin-auth.js";
import { adminAuth } from "../middleware/auth.js";

const router = Router();
router.post("/login", login);
router.get("/me", adminAuth, me);
export default router;
