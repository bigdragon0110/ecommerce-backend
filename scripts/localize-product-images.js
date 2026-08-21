import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config({ path: process.env.NODE_ENV === "production" ? ".env" : ".env.local" });
const { default: db } = await import("../src/config/db.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const uploadRoot = path.resolve(process.env.UPLOAD_ROOT || path.join(here, "../../shared-storage/images"));
const productDirectory = path.join(uploadRoot, "products");
const maxBytes = Number(process.env.IMAGE_DOWNLOAD_MAX_BYTES || 15 * 1024 * 1024);
const timeoutMs = Number(process.env.IMAGE_DOWNLOAD_TIMEOUT_MS || 30000);
const limitArgument = process.argv.find((value) => value.startsWith("--limit="));
const limit = limitArgument ? Math.max(1, Number(limitArgument.split("=")[1]) || 1) : null;

const extensions = new Map([
  ["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"],
  ["image/gif", ".gif"], ["image/avif", ".avif"],
]);

const download = async (row) => {
  const response = await fetch(row.image_url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "TakoyakiEcommerceImageMigration/1.0" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = String(response.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (!contentType.startsWith("image/")) throw new Error(`Unexpected content type: ${contentType || "unknown"}`);
  const extension = extensions.get(contentType) || ".jpg";
  const filename = `product-${row.product_id}-image-${row.id}${extension}`;
  const destination = path.join(productDirectory, filename);
  const temporary = `${destination}.part`;
  const data = Buffer.from(await response.arrayBuffer());
  if (!data.length) throw new Error("Downloaded file is empty");
  if (data.length > maxBytes) throw new Error(`Image exceeds ${maxBytes} bytes`);
  try {
    await writeFile(temporary, data);
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return { publicPath: `/uploads/products/${filename}`, size: data.length };
};

const run = async () => {
  await mkdir(productDirectory, { recursive: true });
  const sql = `SELECT id, product_id, image_url FROM product_images
    WHERE image_url LIKE 'http://%' OR image_url LIKE 'https://%'
    ORDER BY id${limit ? " LIMIT ?" : ""}`;
  const [rows] = await db.query(sql, limit ? [limit] : []);
  console.log(`Found ${rows.length} remote product images. Destination: ${productDirectory}`);
  let completed = 0; let failed = 0;
  for (const row of rows) {
    try {
      const result = await download(row);
      await db.execute("UPDATE product_images SET image_url=? WHERE id=? AND image_url=?", [result.publicPath, row.id, row.image_url]);
      completed += 1;
      console.log(`[${completed + failed}/${rows.length}] Saved ${result.publicPath} (${result.size} bytes)`);
    } catch (error) {
      failed += 1;
      console.error(`[${completed + failed}/${rows.length}] Failed image ${row.id}: ${error.message}`);
    }
  }
  console.log(`Image localization finished. Updated: ${completed}; Failed: ${failed}`);
  await db.end();
  if (failed) process.exitCode = 1;
};

run().catch(async (error) => { console.error("Image localization failed:", error); await db.end(); process.exit(1); });
