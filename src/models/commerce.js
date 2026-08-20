import db from "../config/db.js";

const getOrCreateCart = async (userId) => {
  const [rows] = await db.execute("SELECT id FROM carts WHERE user_id=? AND status='ACTIVE' ORDER BY id DESC LIMIT 1", [userId]);
  if (rows[0]) return rows[0].id;
  const [result] = await db.execute("INSERT INTO carts(user_id,status) VALUES(?,'ACTIVE')", [userId]);
  return result.insertId;
};

export const getCart = async (userId) => {
  const cartId = await getOrCreateCart(userId);
  const [items] = await db.execute(`SELECT ci.id,ci.product_id AS productId,ci.variant_id AS variantId,
    ci.quantity,ci.unit_price_yen AS unitPriceYen,p.title,p.slug,
    COALESCE(v.sku,p.sku) AS sku,
    (SELECT image_url FROM product_images WHERE product_id=p.id ORDER BY is_primary DESC,sort_order,id LIMIT 1) AS imageUrl
    FROM cart_items ci JOIN products p ON p.id=ci.product_id
    LEFT JOIN product_variants v ON v.id=ci.variant_id WHERE ci.cart_id=? ORDER BY ci.created_at`, [cartId]);
  const subtotalYen = items.reduce((sum, item) => sum + Number(item.unitPriceYen) * Number(item.quantity), 0);
  return { id: cartId, items, subtotalYen, totalQuantity: items.reduce((sum, item) => sum + Number(item.quantity), 0) };
};

export const addCartItem = async (userId, productId, variantId, quantity) => {
  const cartId = await getOrCreateCart(userId);
  const [products] = await db.execute(`SELECT p.id,p.price_yen AS productPrice,v.id AS variantId,
    COALESCE(v.price_yen,p.price_yen) AS priceYen,COALESCE(i.quantity_available,999999) AS available
    FROM products p LEFT JOIN product_variants v ON v.product_id=p.id AND v.id=COALESCE(?,
      (SELECT id FROM product_variants WHERE product_id=p.id AND is_active=TRUE ORDER BY id LIMIT 1))
    LEFT JOIN inventory i ON i.variant_id=v.id
    WHERE p.id=? AND p.status='ACTIVE' AND p.deleted_at IS NULL LIMIT 1`, [variantId || null, productId]);
  const product = products[0];
  if (!product) throw Object.assign(new Error("Product or variant not found."), { status: 404 });
  if (quantity < 1 || quantity > Number(product.available)) throw Object.assign(new Error("Requested quantity is unavailable."), { status: 409 });
  const [existing] = await db.execute(`SELECT id,quantity FROM cart_items WHERE cart_id=? AND product_id=?
    AND (variant_id <=> ?) LIMIT 1`, [cartId, productId, product.variantId || null]);
  if (existing[0]) {
    const nextQuantity = Number(existing[0].quantity) + quantity;
    if (nextQuantity > Number(product.available)) throw Object.assign(new Error("Requested quantity is unavailable."), { status: 409 });
    await db.execute("UPDATE cart_items SET quantity=?,unit_price_yen=? WHERE id=?", [nextQuantity, product.priceYen, existing[0].id]);
  } else {
    await db.execute(`INSERT INTO cart_items(cart_id,product_id,variant_id,quantity,unit_price_yen)
      VALUES(?,?,?,?,?)`, [cartId, productId, product.variantId || null, quantity, product.priceYen]);
  }
  return getCart(userId);
};

export const updateCartItem = async (userId, itemId, quantity) => {
  const cartId = await getOrCreateCart(userId);
  if (quantity < 1) throw Object.assign(new Error("Quantity must be at least 1."), { status: 400 });
  const [rows] = await db.execute(`SELECT ci.id,COALESCE(i.quantity_available,999999) AS available
    FROM cart_items ci LEFT JOIN inventory i ON i.variant_id=ci.variant_id WHERE ci.id=? AND ci.cart_id=?`, [itemId, cartId]);
  if (!rows[0]) throw Object.assign(new Error("Cart item not found."), { status: 404 });
  if (quantity > Number(rows[0].available)) throw Object.assign(new Error("Requested quantity is unavailable."), { status: 409 });
  await db.execute("UPDATE cart_items SET quantity=? WHERE id=?", [quantity, itemId]);
  return getCart(userId);
};

export const deleteCartItem = async (userId, itemId) => {
  const cartId = await getOrCreateCart(userId);
  const [result] = await db.execute("DELETE FROM cart_items WHERE id=? AND cart_id=?", [itemId, cartId]);
  if (!result.affectedRows) throw Object.assign(new Error("Cart item not found."), { status: 404 });
  return getCart(userId);
};

export const getWishlist = async (userId) => {
  const [rows] = await db.execute(`SELECT p.id,p.title,p.slug,p.price_yen AS priceYen,p.badge,
    (SELECT image_url FROM product_images WHERE product_id=p.id ORDER BY is_primary DESC,sort_order,id LIMIT 1) AS imageUrl,
    wi.created_at AS createdAt FROM wishlist_items wi JOIN products p ON p.id=wi.product_id
    WHERE wi.user_id=? ORDER BY wi.created_at DESC`, [userId]);
  return rows;
};

export const addWishlist = async (userId, productId) => {
  const [products] = await db.execute("SELECT id FROM products WHERE id=? AND status='ACTIVE' AND deleted_at IS NULL", [productId]);
  if (!products[0]) throw Object.assign(new Error("Product not found."), { status: 404 });
  await db.execute("INSERT IGNORE INTO wishlist_items(user_id,product_id) VALUES(?,?)", [userId, productId]);
  return getWishlist(userId);
};

export const deleteWishlist = async (userId, productId) => {
  await db.execute("DELETE FROM wishlist_items WHERE user_id=? AND product_id=?", [userId, productId]);
  return getWishlist(userId);
};

const orderNumber = () => `TK${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;

export const createOrder = async (userId, payload) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [carts] = await connection.execute("SELECT id FROM carts WHERE user_id=? AND status='ACTIVE' ORDER BY id DESC LIMIT 1 FOR UPDATE", [userId]);
    if (!carts[0]) throw Object.assign(new Error("Cart is empty."), { status: 400 });
    const [items] = await connection.execute(`SELECT ci.product_id AS productId,ci.variant_id AS variantId,ci.quantity,
      p.title,p.sku AS productSku,COALESCE(v.sku,p.sku) AS sku,COALESCE(v.title,'Default') AS variantTitle,
      COALESCE(v.price_yen,p.price_yen) AS unitPriceYen,
      (SELECT image_url FROM product_images WHERE product_id=p.id ORDER BY is_primary DESC,sort_order,id LIMIT 1) AS imageUrl,
      i.quantity_available AS available FROM cart_items ci JOIN products p ON p.id=ci.product_id
      LEFT JOIN product_variants v ON v.id=ci.variant_id LEFT JOIN inventory i ON i.variant_id=ci.variant_id
      WHERE ci.cart_id=? FOR UPDATE`, [carts[0].id]);
    if (!items.length) throw Object.assign(new Error("Cart is empty."), { status: 400 });
    for (const item of items) if (item.variantId && Number(item.available) < Number(item.quantity)) {
      throw Object.assign(new Error(`${item.title} does not have enough stock.`), { status: 409 });
    }
    const subtotalYen = items.reduce((sum, item) => sum + Number(item.unitPriceYen) * Number(item.quantity), 0);
    const shippingYen = Number(payload.shippingYen || 0);
    const taxYen = Number(payload.taxYen || 0);
    const number = orderNumber();
    const [order] = await connection.execute(`INSERT INTO orders(order_number,user_id,status,payment_status,
      fulfillment_status,customer_email,customer_phone,subtotal_yen,shipping_yen,tax_yen,total_yen,
      shipping_address,billing_address,customer_note,placed_at) VALUES(?,?,'PENDING','UNPAID','UNFULFILLED',
      ?,?,?,?,?,?,?,?, ?,NOW())`, [number, userId, payload.customerEmail, payload.customerPhone || null,
      subtotalYen, shippingYen, taxYen, subtotalYen + shippingYen + taxYen,
      JSON.stringify(payload.shippingAddress), JSON.stringify(payload.billingAddress || payload.shippingAddress), payload.customerNote || null]);
    for (const item of items) {
      await connection.execute(`INSERT INTO order_items(order_id,product_id,variant_id,sku,product_title,
        variant_title,image_url,unit_price_yen,quantity,line_total_yen) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [order.insertId,item.productId,item.variantId,item.sku,item.title,item.variantTitle,item.imageUrl,
          item.unitPriceYen,item.quantity,Number(item.unitPriceYen) * Number(item.quantity)]);
      if (item.variantId) await connection.execute(`UPDATE inventory SET quantity_available=quantity_available-?,
        quantity_reserved=quantity_reserved+? WHERE variant_id=?`, [item.quantity,item.quantity,item.variantId]);
    }
    await connection.execute("UPDATE carts SET status='CONVERTED' WHERE id=?", [carts[0].id]);
    await connection.commit();
    return getOrder(userId, number);
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
};

export const getOrders = async (userId) => {
  const [rows] = await db.execute(`SELECT id,order_number AS orderNumber,status,payment_status AS paymentStatus,
    fulfillment_status AS fulfillmentStatus,total_yen AS totalYen,placed_at AS placedAt,created_at AS createdAt
    FROM orders WHERE user_id=? ORDER BY created_at DESC`, [userId]);
  return rows;
};

export const getOrder = async (userId, identifier) => {
  const [rows] = await db.execute(`SELECT * FROM orders WHERE user_id=? AND (order_number=? OR id=?) LIMIT 1`,
    [userId, identifier, /^\d+$/.test(String(identifier)) ? identifier : 0]);
  if (!rows[0]) return null;
  const [items] = await db.execute(`SELECT id,product_id AS productId,variant_id AS variantId,sku,
    product_title AS productTitle,variant_title AS variantTitle,image_url AS imageUrl,
    unit_price_yen AS unitPriceYen,quantity,line_total_yen AS lineTotalYen FROM order_items WHERE order_id=?`, [rows[0].id]);
  return { ...rows[0], items };
};

export const cancelOrder = async (userId, identifier) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [orders] = await connection.execute(`SELECT * FROM orders WHERE user_id=? AND (order_number=? OR id=?) LIMIT 1 FOR UPDATE`,
      [userId,identifier,/^\d+$/.test(String(identifier))?identifier:0]);
    const order=orders[0];
    if (!order) throw Object.assign(new Error("Order not found."), { status: 404 });
    if (!["PENDING", "CONFIRMED"].includes(order.status)) throw Object.assign(new Error("This order can no longer be cancelled."), { status: 409 });
    const [items]=await connection.execute("SELECT variant_id,quantity FROM order_items WHERE order_id=?",[order.id]);
    for(const item of items) if(item.variant_id) await connection.execute(`UPDATE inventory SET
      quantity_available=quantity_available+?,quantity_reserved=GREATEST(0,quantity_reserved-?) WHERE variant_id=?`,
      [item.quantity,item.quantity,item.variant_id]);
    await connection.execute("UPDATE orders SET status='CANCELLED',cancelled_at=NOW() WHERE id=?", [order.id]);
    await connection.commit();
    return getOrder(userId, identifier);
  } catch(error){await connection.rollback();throw error;} finally{connection.release();}
};

export const getProductReviews = async (productId) => {
  const [rows] = await db.execute(`SELECT r.id,r.rating,r.title,r.body,r.created_at AS createdAt,
    u.username FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.product_id=? AND r.status='APPROVED'
    ORDER BY r.created_at DESC`, [productId]);
  return rows;
};

export const createReview = async (userId, productId, payload) => {
  const [result] = await db.execute(`INSERT INTO reviews(product_id,user_id,order_item_id,rating,title,body,status)
    VALUES(?,?,?,?,?,?,'PENDING')`, [productId,userId,payload.orderItemId || null,payload.rating,payload.title || null,payload.body || null]);
  return { id: result.insertId, status: "PENDING" };
};
