import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "../src/config/db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(process.argv[2] || path.join(here, "../../ecommerce-shop/frontend/src/data/products.json"));
const slugify = (value) => String(value).trim().toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

const run = async () => {
  const catalog = JSON.parse(await readFile(source, "utf8"));
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const categoryIds = new Map();
    const categoryNames = [...new Set(catalog.products.map((item) => item.category))];
    for (const [index, name] of categoryNames.entries()) {
      const slug = slugify(name) || `category-${index + 1}`;
      await connection.query(`INSERT INTO categories(name,slug,sort_order,is_active) VALUES(?,?,?,TRUE)
        ON DUPLICATE KEY UPDATE name=VALUES(name),sort_order=VALUES(sort_order),is_active=TRUE`, [name, slug, index + 1]);
      const [rows] = await connection.query("SELECT id FROM categories WHERE slug=?", [slug]);
      categoryIds.set(name, rows[0].id);
    }
    for (const item of catalog.products) {
      const sku = `PRODUCT-${item.id}`;
      const priceYen = Math.round(Number(item.price) * 1000);
      await connection.query(`INSERT INTO products(id,category_id,sku,slug,title,short_description,material,
        price_yen,badge,status,published_at) VALUES(?,?,?,?,?,?,?,?,?,'ACTIVE',NOW())
        ON DUPLICATE KEY UPDATE category_id=VALUES(category_id),title=VALUES(title),
        short_description=VALUES(short_description),material=VALUES(material),price_yen=VALUES(price_yen),
        badge=VALUES(badge),status='ACTIVE'`, [item.id, categoryIds.get(item.category), sku,
        `product-${item.id}`, item.title, item.description || null, item.material || null, priceYen, item.badge || "NONE"]);
      await connection.query("DELETE FROM product_images WHERE product_id=?", [item.id]);
      const gallery = item.gallery?.length ? item.gallery : [item.image];
      for (const [index, url] of gallery.entries()) {
        await connection.query(`INSERT INTO product_images(product_id,image_url,alt_text,sort_order,is_primary)
          VALUES(?,?,?,?,?)`, [item.id, url, item.title, index, index === 0]);
      }
      const [variants] = await connection.query("SELECT id FROM product_variants WHERE product_id=? LIMIT 1", [item.id]);
      let variantId = variants[0]?.id;
      if (!variantId) {
        const [result] = await connection.query(`INSERT INTO product_variants(product_id,sku,title,price_yen,is_active)
          VALUES(?,?,'Default',?,TRUE)`, [item.id, `${sku}-DEFAULT`, priceYen]);
        variantId = result.insertId;
      } else {
        await connection.query("UPDATE product_variants SET price_yen=?,is_active=TRUE WHERE id=?", [priceYen, variantId]);
      }
      await connection.query(`INSERT INTO inventory(variant_id,quantity_available,quantity_reserved) VALUES(?,100,0)
        ON DUPLICATE KEY UPDATE variant_id=VALUES(variant_id)`, [variantId]);
    }
    for (const [order, [slug, productIds]] of Object.entries(catalog.sections).entries()) {
      await connection.query(`INSERT INTO collections(name,slug,sort_order,is_active) VALUES(?,?,?,TRUE)
        ON DUPLICATE KEY UPDATE sort_order=VALUES(sort_order),is_active=TRUE`,
        [`${slug[0].toUpperCase()}${slug.slice(1)} Products`, slug, order + 1]);
      const [rows] = await connection.query("SELECT id FROM collections WHERE slug=?", [slug]);
      await connection.query("DELETE FROM collection_products WHERE collection_id=?", [rows[0].id]);
      for (const [index, productId] of productIds.entries()) {
        await connection.query("INSERT INTO collection_products(collection_id,product_id,sort_order) VALUES(?,?,?)",
          [rows[0].id, productId, index]);
      }
    }
    await connection.commit();
    console.log(`Imported ${catalog.products.length} products from ${source}`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await db.end();
  }
};

run().catch((error) => { console.error("Product import failed:", error); process.exit(1); });
