import db from "../config/db.js";

const select = `SELECT p.id,p.sku,p.slug,p.title,p.short_description AS shortDescription,
 p.description,p.material,p.manufacturer,p.origin_country AS originCountry,
 p.price_yen AS priceYen,p.compare_at_price_yen AS compareAtPriceYen,p.badge,
 p.rating_average AS ratingAverage,p.review_count AS reviewCount,
 c.id AS categoryId,c.name AS categoryName,c.slug AS categorySlug
 FROM products p LEFT JOIN categories c ON c.id=p.category_id`;

const hydrate = async (rows) => {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const [imageRows] = await db.query(
    `SELECT id,product_id AS productId,image_url AS url,alt_text AS altText,
     sort_order AS sortOrder,is_primary AS isPrimary FROM product_images
     WHERE product_id IN (${ids.map(() => "?").join(",")})
     ORDER BY product_id,is_primary DESC,sort_order,id`, ids,
  );
  const byProduct = new Map();
  for (const image of imageRows) {
    const list = byProduct.get(image.productId) || [];
    list.push({ ...image, isPrimary: Boolean(image.isPrimary) });
    byProduct.set(image.productId, list);
  }
  return rows.map((row) => ({
    id: row.id, sku: row.sku, slug: row.slug, title: row.title,
    shortDescription: row.shortDescription, description: row.description,
    material: row.material, manufacturer: row.manufacturer, originCountry: row.originCountry,
    priceYen: row.priceYen, compareAtPriceYen: row.compareAtPriceYen,
    badge: row.badge, ratingAverage: Number(row.ratingAverage || 0), reviewCount: row.reviewCount,
    category: row.categoryId ? { id: row.categoryId, name: row.categoryName, slug: row.categorySlug } : null,
    images: byProduct.get(row.id) || [],
  }));
};

export const getProducts = async ({ category, search, limit = 50, offset = 0 }) => {
  const conditions = ["p.status='ACTIVE'", "p.deleted_at IS NULL"];
  const params = [];
  if (category) { conditions.push("c.slug=?"); params.push(category); }
  if (search) {
    const term = `%${search}%`;
    conditions.push("(p.title LIKE ? OR p.short_description LIKE ? OR p.sku LIKE ?)");
    params.push(term, term, term);
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const [rows] = await db.query(`${select} WHERE ${conditions.join(" AND ")}
    ORDER BY p.published_at DESC,p.created_at DESC LIMIT ? OFFSET ?`, [...params, safeLimit, safeOffset]);
  return hydrate(rows);
};

export const getProduct = async (identifier) => {
  const field = /^\d+$/.test(String(identifier)) ? "p.id" : "p.slug";
  const [rows] = await db.query(`${select} WHERE ${field}=? AND p.status='ACTIVE'
    AND p.deleted_at IS NULL LIMIT 1`, [identifier]);
  return (await hydrate(rows))[0] || null;
};

export const getCategories = async () => {
  const [rows] = await db.query(`SELECT id,parent_id AS parentId,name,slug,description,
    image_url AS imageUrl,sort_order AS sortOrder FROM categories
    WHERE is_active=TRUE ORDER BY sort_order,name`);
  return rows;
};

export const getCollections = async () => {
  const [rows] = await db.query(`SELECT id,name,slug,description,promo_image_url AS promoImageUrl,
    sort_order AS sortOrder FROM collections WHERE is_active=TRUE ORDER BY sort_order,name`);
  return rows;
};

export const getCollection = async (slug) => {
  const [collections] = await db.query(`SELECT id,name,slug,description,promo_image_url AS promoImageUrl
    FROM collections WHERE slug=? AND is_active=TRUE LIMIT 1`, [slug]);
  if (!collections[0]) return null;
  const [rows] = await db.query(`${select} INNER JOIN collection_products cp ON cp.product_id=p.id
    INNER JOIN collections cl ON cl.id=cp.collection_id WHERE cl.slug=? AND cl.is_active=TRUE
    AND p.status='ACTIVE' AND p.deleted_at IS NULL ORDER BY cp.sort_order,p.id`, [slug]);
  return { ...collections[0], products: await hydrate(rows) };
};
