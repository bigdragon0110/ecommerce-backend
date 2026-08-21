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
  const [imageRows] = await db.query(`SELECT id,product_id AS productId,image_url AS url,alt_text AS altText,
    sort_order AS sortOrder,is_primary AS isPrimary FROM product_images
    WHERE product_id IN (${ids.map(() => "?").join(",")}) ORDER BY product_id,is_primary DESC,sort_order,id`, ids);
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

const pageValues = ({ page, pageSize, limit, offset }) => {
  const size = Math.min(Math.max(Number(pageSize || limit) || 12, 1), 100);
  const current = Math.max(Number(page) || (offset ? Math.floor(Number(offset) / size) + 1 : 1), 1);
  return { page: current, pageSize: size, offset: (current - 1) * size };
};

const sortSql = (sort) => ({
  "best-selling": `(SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi WHERE oi.product_id=p.id) DESC,p.id DESC`,
  "price-asc": "p.price_yen ASC,p.id DESC",
  "price-desc": "p.price_yen DESC,p.id DESC",
  rating: "p.rating_average DESC,p.review_count DESC,p.id DESC",
  reviews: "p.review_count DESC,p.rating_average DESC,p.id DESC",
}[sort] || "p.published_at DESC,p.created_at DESC,p.id DESC");

const pagination = (total, page, pageSize) => ({ page, pageSize, total: Number(total), pageCount: Math.max(1, Math.ceil(Number(total) / pageSize)) });

export const getProducts = async (query = {}) => {
  const conditions = ["p.status='ACTIVE'", "p.deleted_at IS NULL"];
  const params = [];
  if (query.category) { conditions.push("c.slug=?"); params.push(query.category); }
  if (query.search) {
    const term = `%${query.search}%`;
    conditions.push("(p.title LIKE ? OR p.short_description LIKE ? OR p.sku LIKE ?)");
    params.push(term, term, term);
  }
  const { page, pageSize, offset } = pageValues(query);
  const where = conditions.join(" AND ");
  const [[count]] = await db.query(`SELECT COUNT(*) AS total FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE ${where}`, params);
  const [rows] = await db.query(`${select} WHERE ${where} ORDER BY ${sortSql(query.sort)} LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return { products: await hydrate(rows), pagination: pagination(count.total, page, pageSize) };
};

export const getProduct = async (identifier) => {
  const field = /^\d+$/.test(String(identifier)) ? "p.id" : "p.slug";
  const [rows] = await db.query(`${select} WHERE ${field}=? AND p.status='ACTIVE' AND p.deleted_at IS NULL LIMIT 1`, [identifier]);
  return (await hydrate(rows))[0] || null;
};

export const getCategories = async () => {
  const [rows] = await db.query(`SELECT id,source_category_id AS sourceCategoryId,parent_id AS parentId,name,slug,description,
    image_url AS imageUrl,sort_order AS sortOrder FROM categories WHERE is_active=TRUE ORDER BY sort_order,name`);
  return rows;
};

export const getCategoryTree = async () => {
  const categories = await getCategories();
  const byParent = new Map();
  for (const category of categories) {
    const list = byParent.get(category.parentId || null) || [];
    list.push(category);
    byParent.set(category.parentId || null, list);
  }
  const attach = (category) => ({ ...category, children: (byParent.get(category.id) || []).map(attach) });
  return (byParent.get(null) || []).map(attach);
};

export const getCategoryProducts = async (slug, query = {}) => {
  const [categories] = await db.query(`SELECT c.id,c.parent_id AS parentId,c.name,c.slug,c.description,
    parent.name AS parentName,parent.slug AS parentSlug FROM categories c LEFT JOIN categories parent ON parent.id=c.parent_id
    WHERE c.slug=? AND c.is_active=TRUE LIMIT 1`, [slug]);
  const category = categories[0];
  if (!category) return null;
  const { page, pageSize, offset } = pageValues(query);
  const membership = `EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id=p.id AND pc.category_id=?)`;
  let count;
  let rows;
  try {
    [[count]] = await db.query(`SELECT COUNT(*) AS total FROM products p WHERE p.status='ACTIVE' AND p.deleted_at IS NULL AND ${membership}`, [category.id]);
    [rows] = await db.query(`${select} WHERE p.status='ACTIVE' AND p.deleted_at IS NULL AND ${membership}
      ORDER BY ${sortSql(query.sort)} LIMIT ? OFFSET ?`, [category.id, pageSize, offset]);
  } catch (error) {
    if (error.code !== "ER_NO_SUCH_TABLE") throw error;
    [[count]] = await db.query(`SELECT COUNT(*) AS total FROM products p WHERE p.status='ACTIVE' AND p.deleted_at IS NULL AND p.category_id=?`, [category.id]);
    [rows] = await db.query(`${select} WHERE p.status='ACTIVE' AND p.deleted_at IS NULL AND p.category_id=?
      ORDER BY ${sortSql(query.sort)} LIMIT ? OFFSET ?`, [category.id, pageSize, offset]);
  }
  const breadcrumbs = [...(category.parentId ? [{ name: category.parentName, slug: category.parentSlug }] : []), { name: category.name, slug: category.slug }];
  return { category, breadcrumbs, products: await hydrate(rows), pagination: pagination(count.total, page, pageSize) };
};

export const getCollections = async () => {
  const [rows] = await db.query(`SELECT id,name,slug,description,promo_image_url AS promoImageUrl,
    sort_order AS sortOrder FROM collections WHERE is_active=TRUE ORDER BY sort_order,name`);
  return rows;
};

export const getCollection = async (slug, query = {}) => {
  const [collections] = await db.query(`SELECT id,name,slug,description,promo_image_url AS promoImageUrl FROM collections WHERE slug=? AND is_active=TRUE LIMIT 1`, [slug]);
  if (!collections[0]) return null;
  const { page, pageSize, offset } = pageValues(query);
  const [[count]] = await db.query(`SELECT COUNT(*) AS total FROM collection_products cp JOIN products p ON p.id=cp.product_id
    WHERE cp.collection_id=? AND p.status='ACTIVE' AND p.deleted_at IS NULL`, [collections[0].id]);
  const [rows] = await db.query(`${select} INNER JOIN collection_products cp ON cp.product_id=p.id
    WHERE cp.collection_id=? AND p.status='ACTIVE' AND p.deleted_at IS NULL
    ORDER BY ${query.sort ? sortSql(query.sort) : "cp.sort_order,p.id"} LIMIT ? OFFSET ?`, [collections[0].id, pageSize, offset]);
  return { ...collections[0], products: await hydrate(rows), pagination: pagination(count.total, page, pageSize) };
};
