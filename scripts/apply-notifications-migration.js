import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import dotenv from "dotenv";
dotenv.config({path:process.env.NODE_ENV==="production"?".env":".env.local"});
const{default:db}=await import("../src/config/db.js");
const here=path.dirname(fileURLToPath(import.meta.url));
try{
  const sql=await readFile(path.join(here,"../database/patches/004-user-notifications.sql"),"utf8");
  const statements=sql.replace(/^--.*$/gm,"").split(";").map(value=>value.trim()).filter(Boolean);
  for(const[index,statement]of statements.entries()){await db.query(statement);console.log(`Migration statement ${index+1}/${statements.length} complete`);}
  console.log("User notification migration complete.");
}catch(error){console.error("Notification migration failed:",error);process.exitCode=1;}finally{await db.end();}
