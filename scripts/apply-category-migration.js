import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config({ path: process.env.NODE_ENV === "production" ? ".env" : ".env.local" });
const { default: db } = await import("../src/config/db.js");
const here = path.dirname(fileURLToPath(import.meta.url));
const sql = await readFile(path.join(here, "../database/patches/002-category-hierarchy.sql"), "utf8");

try {
  const statements = sql.replace(/^--.*$/gm, "").split(";").map((value) => value.trim()).filter(Boolean);
  for (const [index, statement] of statements.entries()) {
    try {
      await db.query(statement);
    } catch (error) {
      if (error.code !== "ER_DUP_FIELDNAME" && error.code !== "ER_DUP_KEYNAME") throw error;
      console.log(`Migration statement ${index + 1}/${statements.length} was already applied`);
      continue;
    }
    console.log(`Migration statement ${index + 1}/${statements.length} complete`);
  }
  console.log("Category hierarchy migration complete.");
} catch (error) {
  console.error("Category migration failed:", error);
  process.exitCode = 1;
} finally {
  await db.end();
}
