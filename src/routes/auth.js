import { Router } from "express";
import { login, me, register } from "../controllers/customer-auth.js";
import { customerAuth } from "../middleware/auth.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.get("/me", customerAuth, me);

export default router;
