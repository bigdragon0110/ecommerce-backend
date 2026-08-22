import bcrypt from "bcrypt";
import db from "../config/db.js";

export const audit = async (adminId, action, entityType, entityId, oldValues = null, newValues = null, request = {}) => {
  await db.execute(`INSERT INTO admin_audit_logs(admin_id,action,entity_type,entity_id,old_values,new_values,ip_address,user_agent)
    VALUES(?,?,?,?,?,?,?,?)`, [adminId,action,entityType,String(entityId ?? ""),oldValues?JSON.stringify(oldValues):null,
    newValues?JSON.stringify(newValues):null,request.ip||null,request.userAgent||null]);
};

export const dashboard = async () => {
  const [[customers],[products],[orders],[revenue],[lowStock]] = await Promise.all([
    db.query("SELECT COUNT(*) AS count FROM users"),
    db.query("SELECT COUNT(*) AS count FROM products WHERE deleted_at IS NULL"),
    db.query("SELECT COUNT(*) AS count FROM orders"),
    db.query("SELECT COALESCE(SUM(total_yen),0) AS total FROM orders WHERE payment_status='PAID'"),
    db.query("SELECT COUNT(*) AS count FROM inventory WHERE quantity_available<=low_stock_threshold"),
  ]);
  const [recentOrders] = await db.query(`SELECT id,order_number AS orderNumber,customer_email AS customerEmail,
    total_yen AS totalYen,status,payment_status AS paymentStatus,created_at AS createdAt
    FROM orders ORDER BY created_at DESC LIMIT 10`);
  return { customers:customers[0].count,products:products[0].count,orders:orders[0].count,
    revenueYen:revenue[0].total,lowStock:lowStock[0].count,recentOrders };
};

export const listAdminProducts = async () => {
  const [rows] = await db.query(`SELECT p.id,p.category_id AS categoryId,p.sku,p.slug,p.title,
    p.short_description AS shortDescription,p.description,p.material,p.price_yen AS priceYen,p.badge,p.status,
    p.created_at AS createdAt,c.name AS categoryName,
    COALESCE(SUM(i.quantity_available),0) AS stock FROM products p LEFT JOIN categories c ON c.id=p.category_id
    LEFT JOIN product_variants v ON v.product_id=p.id LEFT JOIN inventory i ON i.variant_id=v.id
    WHERE p.deleted_at IS NULL GROUP BY p.id ORDER BY p.created_at DESC`);
  if(!rows.length)return rows;
  const [images]=await db.query(`SELECT product_id AS productId,image_url AS url,alt_text AS altText,
    sort_order AS sortOrder,is_primary AS isPrimary FROM product_images WHERE product_id IN (?)
    ORDER BY product_id,is_primary DESC,sort_order,id`,[rows.map(row=>row.id)]);
  const byProduct=new Map();
  for(const image of images){
    const list=byProduct.get(image.productId)||[];
    list.push({...image,isPrimary:Boolean(image.isPrimary)});
    byProduct.set(image.productId,list);
  }
  return rows.map(row=>({...row,images:byProduct.get(row.id)||[]}));
};

export const getAdminProduct = async (id) => {
  const [rows] = await db.execute(`SELECT id,category_id AS categoryId,sku,slug,title,
    short_description AS shortDescription,description,material,manufacturer,origin_country AS originCountry,
    price_yen AS priceYen,compare_at_price_yen AS compareAtPriceYen,cost_price_yen AS costPriceYen,
    badge,status,is_featured AS isFeatured,published_at AS publishedAt,created_at AS createdAt,
    updated_at AS updatedAt FROM products WHERE id=? AND deleted_at IS NULL`, [id]);
  if (!rows[0]) return null;
  const [images] = await db.execute(`SELECT id,product_id AS productId,image_url AS url,alt_text AS altText,
    sort_order AS sortOrder,is_primary AS isPrimary FROM product_images
    WHERE product_id=? ORDER BY is_primary DESC,sort_order,id`, [id]);
  const [variants] = await db.execute(`SELECT v.*,i.quantity_available,i.quantity_reserved,i.low_stock_threshold
    FROM product_variants v LEFT JOIN inventory i ON i.variant_id=v.id WHERE v.product_id=? ORDER BY v.id`, [id]);
  return { ...rows[0], images: images.map((image) => ({ ...image, isPrimary: Boolean(image.isPrimary) })), variants };
};

export const createProduct = async (payload) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(`INSERT INTO products(category_id,sku,slug,title,short_description,
      description,material,manufacturer,origin_country,price_yen,compare_at_price_yen,cost_price_yen,badge,status,
      is_featured,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [payload.categoryId||null,payload.sku,payload.slug,
      payload.title,payload.shortDescription||null,payload.description||null,payload.material||null,payload.manufacturer||null,
      payload.originCountry||null,payload.priceYen,payload.compareAtPriceYen||null,payload.costPriceYen||null,payload.badge||"NONE",
      payload.status||"DRAFT",Boolean(payload.isFeatured),payload.status==="ACTIVE"?new Date():null]);
    const productId = result.insertId;
    for (const [index,image] of (payload.images||[]).entries()) await connection.execute(`INSERT INTO product_images
      (product_id,image_url,alt_text,sort_order,is_primary) VALUES(?,?,?,?,?)`, [productId,image.url,image.altText||payload.title,
      image.sortOrder??index,Boolean(image.isPrimary??index===0)]);
    const [variant] = await connection.execute(`INSERT INTO product_variants(product_id,sku,title,price_yen,is_active)
      VALUES(?,?,?, ?,TRUE)`, [productId,payload.variantSku||`${payload.sku}-DEFAULT`,payload.variantTitle||"Default",payload.priceYen]);
    await connection.execute(`INSERT INTO inventory(variant_id,quantity_available,quantity_reserved,low_stock_threshold)
      VALUES(?,?,0,?)`, [variant.insertId,Number(payload.quantityAvailable||0),Number(payload.lowStockThreshold||5)]);
    await connection.commit();
    return getAdminProduct(productId);
  } catch(error){await connection.rollback();throw error;} finally{connection.release();}
};

const productFields = {categoryId:"category_id",sku:"sku",slug:"slug",title:"title",shortDescription:"short_description",
  description:"description",material:"material",manufacturer:"manufacturer",originCountry:"origin_country",priceYen:"price_yen",
  compareAtPriceYen:"compare_at_price_yen",costPriceYen:"cost_price_yen",badge:"badge",status:"status",isFeatured:"is_featured"};
export const updateProduct = async (id, payload) => {
  const sets=[];const values=[];
  for(const [key,column] of Object.entries(productFields)) if(Object.hasOwn(payload,key)){sets.push(`${column}=?`);values.push(payload[key]);}
  if(payload.status==="ACTIVE"){sets.push("published_at=COALESCE(published_at,NOW())");}
  if(sets.length){values.push(id);await db.execute(`UPDATE products SET ${sets.join(",")} WHERE id=? AND deleted_at IS NULL`,values);}
  if(Array.isArray(payload.images)){
    await db.execute("DELETE FROM product_images WHERE product_id=?",[id]);
    for(const [index,image] of payload.images.entries()) await db.execute(`INSERT INTO product_images
      (product_id,image_url,alt_text,sort_order,is_primary) VALUES(?,?,?,?,?)`,[id,image.url,image.altText||null,image.sortOrder??index,Boolean(image.isPrimary??index===0)]);
  }
  return getAdminProduct(id);
};

export const archiveProduct = async (id) => {
  const old = await getAdminProduct(id);
  if(!old)return null;
  await db.execute("UPDATE products SET status='ARCHIVED',deleted_at=NOW() WHERE id=?",[id]);
  return old;
};

export const listCategoriesAdmin = async () => (await db.query("SELECT * FROM categories ORDER BY sort_order,name"))[0];
export const createCategory = async (p) => {const [r]=await db.execute(`INSERT INTO categories(parent_id,name,slug,description,image_url,sort_order,is_active)
  VALUES(?,?,?,?,?,?,?)`,[p.parentId||null,p.name,p.slug,p.description||null,p.imageUrl||null,p.sortOrder||0,p.isActive!==false]);return {id:r.insertId,...p};};
export const updateCategory = async (id,p) => {const map={parentId:"parent_id",name:"name",slug:"slug",description:"description",imageUrl:"image_url",sortOrder:"sort_order",isActive:"is_active"};const s=[],v=[];for(const[k,c]of Object.entries(map))if(Object.hasOwn(p,k)){s.push(`${c}=?`);v.push(p[k]);}if(s.length){v.push(id);await db.execute(`UPDATE categories SET ${s.join(",")} WHERE id=?`,v);}return (await db.execute("SELECT * FROM categories WHERE id=?",[id]))[0][0]||null;};
export const deleteCategory = async (id) => (await db.execute("DELETE FROM categories WHERE id=?",[id])).affectedRows;

export const listCollectionsAdmin = async () => (await db.query("SELECT * FROM collections ORDER BY sort_order,name"))[0];
export const createCollection = async(p)=>{const[r]=await db.execute(`INSERT INTO collections(name,slug,description,promo_image_url,is_active,sort_order)
  VALUES(?,?,?,?,?,?)`,[p.name,p.slug,p.description||null,p.promoImageUrl||null,p.isActive!==false,p.sortOrder||0]);return{id:r.insertId,...p};};
export const updateCollection = async(id,p)=>{const map={name:"name",slug:"slug",description:"description",promoImageUrl:"promo_image_url",isActive:"is_active",sortOrder:"sort_order"};const s=[],v=[];for(const[k,c]of Object.entries(map))if(Object.hasOwn(p,k)){s.push(`${c}=?`);v.push(p[k]);}if(s.length){v.push(id);await db.execute(`UPDATE collections SET ${s.join(",")} WHERE id=?`,v);}if(Array.isArray(p.productIds)){await db.execute("DELETE FROM collection_products WHERE collection_id=?",[id]);for(const[index,pid]of p.productIds.entries())await db.execute("INSERT INTO collection_products(collection_id,product_id,sort_order) VALUES(?,?,?)",[id,pid,index]);}return(await db.execute("SELECT * FROM collections WHERE id=?",[id]))[0][0]||null;};
export const deleteCollection = async(id)=>(await db.execute("DELETE FROM collections WHERE id=?",[id])).affectedRows;

export const listInventory = async () => (await db.query(`SELECT i.variant_id AS variantId,v.product_id AS productId,p.title,v.sku,
 i.quantity_available AS quantityAvailable,i.quantity_reserved AS quantityReserved,i.low_stock_threshold AS lowStockThreshold
 FROM inventory i JOIN product_variants v ON v.id=i.variant_id JOIN products p ON p.id=v.product_id ORDER BY p.title`))[0];
export const updateInventory = async(id,p)=>{await db.execute(`UPDATE inventory SET quantity_available=COALESCE(?,quantity_available),
 quantity_reserved=COALESCE(?,quantity_reserved),low_stock_threshold=COALESCE(?,low_stock_threshold) WHERE variant_id=?`,
 [p.quantityAvailable??null,p.quantityReserved??null,p.lowStockThreshold??null,id]);return(await db.execute("SELECT * FROM inventory WHERE variant_id=?",[id]))[0][0]||null;};

const customerSelect = `SELECT id,email,username,first_name AS firstName,last_name AS lastName,
 phone,status,COALESCE(balance,0) AS balance,last_login_at AS lastLoginAt,created_at AS createdAt FROM users`;
const customerError = (message, status = 400) => Object.assign(new Error(message), { status });
const normalizeCustomerStatus = (status) => {
  const value = String(status || "").trim().toUpperCase();
  if (!['ACTIVE', 'INACTIVE'].includes(value)) throw customerError("Status must be ACTIVE or INACTIVE.");
  return value;
};
const customerById = async (id, connection = db) => (await connection.execute(`${customerSelect} WHERE id=? LIMIT 1`, [id]))[0][0] || null;
const ensureUniqueCustomer = async ({ username, email }, excludeId = 0, connection = db) => {
  const [rows] = await connection.execute(
    "SELECT id FROM users WHERE (username=? OR email=?) AND id<>? LIMIT 1",
    [username, email, Number(excludeId || 0)],
  );
  if (rows.length) throw customerError("Username or email is already registered.", 409);
};

export const listCustomers = async () => (await db.query(`${customerSelect} ORDER BY created_at DESC`))[0];
export const getCustomer = async (id) => customerById(id);
export const createCustomer = async (payload) => {
  const username = String(payload.username || "").trim();
  const email = String(payload.email || "").trim().toLowerCase();
  const password = String(payload.password || "");
  const firstName = String(payload.firstName || "").trim();
  const lastName = String(payload.lastName || "").trim();
  if (!username || !email || !firstName || !lastName) throw customerError("Username, email, first name, and last name are required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw customerError("Enter a valid email address.");
  if (password.length < 8) throw customerError("Password must be at least 8 characters.");
  await ensureUniqueCustomer({ username, email });
  const [result] = await db.execute(`INSERT INTO users(username,email,password_hash,first_name,last_name,phone,status,balance)
    VALUES(?,?,?,?,?,?,?,?)`, [username,email,await bcrypt.hash(password,12),firstName,lastName,String(payload.phone||"").trim()||null,
    normalizeCustomerStatus(payload.status || "ACTIVE"),Math.max(0,Math.trunc(Number(payload.balance || 0)))]);
  return customerById(result.insertId);
};
export const updateCustomer = async (id, payload) => {
  const existing = await customerById(id);
  if (!existing) throw customerError("Customer not found.", 404);
  const next = {
    username: Object.hasOwn(payload,"username") ? String(payload.username||"").trim() : existing.username,
    email: Object.hasOwn(payload,"email") ? String(payload.email||"").trim().toLowerCase() : existing.email,
  };
  if (!next.username || !next.email) throw customerError("Username and email are required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) throw customerError("Enter a valid email address.");
  await ensureUniqueCustomer(next,id);
  const fields={username:"username",email:"email",firstName:"first_name",lastName:"last_name",phone:"phone",status:"status"};
  const sets=[];const values=[];
  for(const [key,column] of Object.entries(fields)) if(Object.hasOwn(payload,key)){
    let value=key==="status"?normalizeCustomerStatus(payload[key]):String(payload[key]??"").trim();
    if(["firstName","lastName"].includes(key)&&!value)throw customerError(`${key} is required.`);
    sets.push(`${column}=?`);values.push(value||null);
  }
  if(sets.length){values.push(id);await db.execute(`UPDATE users SET ${sets.join(",")} WHERE id=?`,values);}
  return customerById(id);
};
export const updateCustomerStatus = async(id,status)=>updateCustomer(id,{status});
export const updateCustomerPassword = async(id,password)=>{
  if(!(await customerById(id)))throw customerError("Customer not found.",404);
  if(String(password||"").length<8)throw customerError("Password must be at least 8 characters.");
  await db.execute("UPDATE users SET password_hash=? WHERE id=?",[await bcrypt.hash(String(password),12),id]);
  return {id:Number(id),passwordUpdated:true};
};
export const adjustCustomerPoints = async(id,payload,adminId)=>{
  const amount=Math.trunc(Number(payload.amount));
  const reason=String(payload.reason||"").trim();
  if(!Number.isSafeInteger(amount)||amount===0)throw customerError("A non-zero integer point amount is required.");
  if(!reason)throw customerError("A reason is required for point adjustments.");
  const connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [[user]]=await connection.execute("SELECT id,balance FROM users WHERE id=? FOR UPDATE",[id]);
    if(!user)throw customerError("Customer not found.",404);
    const before=Number(user.balance||0),after=before+amount;
    if(after<0)throw customerError("This adjustment would make the point balance negative.");
    await connection.execute("UPDATE users SET balance=? WHERE id=?",[after,id]);
    await connection.execute(`INSERT INTO user_point_transactions(user_id,admin_id,amount,balance_before,balance_after,reason)
      VALUES(?,?,?,?,?,?)`,[id,adminId,amount,before,after,reason]);
    await connection.commit();
    return {id:Number(id),amount,balance:after,reason};
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
};
export const deactivateCustomer = async(id)=>{
  const existing=await customerById(id);
  if(!existing)throw customerError("Customer not found.",404);
  await db.execute("UPDATE users SET status='INACTIVE' WHERE id=?",[id]);
  return {...existing,status:"INACTIVE",deactivated:true};
};

export const listOrdersAdmin = async()=> (await db.query(`SELECT id,order_number AS orderNumber,user_id AS userId,customer_email AS customerEmail,
 status,payment_status AS paymentStatus,fulfillment_status AS fulfillmentStatus,total_yen AS totalYen,created_at AS createdAt
 FROM orders ORDER BY created_at DESC`))[0];
export const getOrderAdmin = async(id)=>{const[o]=await db.execute("SELECT * FROM orders WHERE id=? OR order_number=? LIMIT 1",[/^\d+$/.test(String(id))?id:0,id]);if(!o[0])return null;const[i]=await db.execute("SELECT * FROM order_items WHERE order_id=?",[o[0].id]);const[p]=await db.execute("SELECT * FROM payments WHERE order_id=? ORDER BY id",[o[0].id]);const[s]=await db.execute("SELECT * FROM shipments WHERE order_id=? ORDER BY id",[o[0].id]);return{...o[0],items:i,payments:p,shipments:s};};
export const updateOrder = async(id,p)=>{const map={status:"status",paymentStatus:"payment_status",fulfillmentStatus:"fulfillment_status"};const s=[],v=[];for(const[k,c]of Object.entries(map))if(Object.hasOwn(p,k)){s.push(`${c}=?`);v.push(p[k]);}if(s.length){v.push(id);await db.execute(`UPDATE orders SET ${s.join(",")} WHERE id=?`,v);}return getOrderAdmin(id);};
export const createPayment = async(orderId,p)=>{const[r]=await db.execute(`INSERT INTO payments(order_id,provider,provider_transaction_id,amount_yen,status,paid_at,provider_payload)
 VALUES(?,?,?,?,?,?,?)`,[orderId,p.provider,p.providerTransactionId||null,p.amountYen,p.status||"PENDING",p.status==="SUCCEEDED"?new Date():null,p.providerPayload?JSON.stringify(p.providerPayload):null]);return{id:r.insertId};};
export const createShipment = async(orderId,p)=>{const[r]=await db.execute(`INSERT INTO shipments(order_id,carrier,tracking_number,status,shipped_at)
 VALUES(?,?,?,?,?)`,[orderId,p.carrier||null,p.trackingNumber||null,p.status||"PENDING",p.status==="SHIPPED"?new Date():null]);return{id:r.insertId};};
export const listReviewsAdmin = async()=> (await db.query(`SELECT r.*,p.title AS productTitle,u.email AS customerEmail FROM reviews r
 JOIN products p ON p.id=r.product_id JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC`))[0];
export const moderateReview = async(id,status)=>{await db.execute("UPDATE reviews SET status=? WHERE id=?",[status,id]);return(await db.execute("SELECT * FROM reviews WHERE id=?",[id]))[0][0]||null;};
export const listAudit = async()=> (await db.query("SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT 500"))[0];
