import bcrypt from "bcrypt";
import db from "../config/db.js";

export const getProfile = async (userId) => {
  const [rows] = await db.execute(`SELECT id,email,username,first_name AS firstName,last_name AS lastName,
    phone,status,last_login_at AS lastLoginAt,created_at AS createdAt FROM users WHERE id=? LIMIT 1`, [userId]);
  return rows[0] || null;
};

export const updateProfile = async (userId, payload) => {
  const fields = { firstName: "first_name", lastName: "last_name", phone: "phone" };
  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(fields)) {
    if (Object.hasOwn(payload, key)) {
      sets.push(`${column}=?`);
      values.push(payload[key] || null);
    }
  }
  if (sets.length) {
    values.push(userId);
    await db.execute(`UPDATE users SET ${sets.join(",")} WHERE id=?`, values);
  }
  return getProfile(userId);
};

export const changePassword = async (userId, currentPassword, nextPassword) => {
  const [rows] = await db.execute("SELECT password_hash FROM users WHERE id=? LIMIT 1", [userId]);
  if (!rows[0] || !await bcrypt.compare(currentPassword, rows[0].password_hash)) {
    throw Object.assign(new Error("Current password is incorrect."), { status: 401 });
  }
  await db.execute("UPDATE users SET password_hash=? WHERE id=?", [await bcrypt.hash(nextPassword, 12), userId]);
  return { changed: true };
};

export const listAddresses = async (userId) => {
  const [rows] = await db.execute(`SELECT id,label,recipient_name AS recipientName,phone,postal_code AS postalCode,
    prefecture,city,address_line1 AS addressLine1,address_line2 AS addressLine2,is_default AS isDefault,
    created_at AS createdAt FROM user_addresses WHERE user_id=? ORDER BY is_default DESC,id DESC`, [userId]);
  return rows;
};

const addressValues = (payload) => [payload.label || null, payload.recipientName, payload.phone || null,
  payload.postalCode, payload.prefecture, payload.city, payload.addressLine1, payload.addressLine2 || null,
  Boolean(payload.isDefault)];

export const createAddress = async (userId, payload) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    if (payload.isDefault) await connection.execute("UPDATE user_addresses SET is_default=FALSE WHERE user_id=?", [userId]);
    const [result] = await connection.execute(`INSERT INTO user_addresses(user_id,label,recipient_name,phone,postal_code,
      prefecture,city,address_line1,address_line2,is_default) VALUES(?,?,?,?,?,?,?,?,?,?)`, [userId, ...addressValues(payload)]);
    await connection.commit();
    return { id: result.insertId, ...payload };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
};

export const updateAddress = async (userId, id, payload) => {
  const fields = { label:"label",recipientName:"recipient_name",phone:"phone",postalCode:"postal_code",
    prefecture:"prefecture",city:"city",addressLine1:"address_line1",addressLine2:"address_line2",isDefault:"is_default" };
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [owned] = await connection.execute("SELECT id FROM user_addresses WHERE id=? AND user_id=?", [id,userId]);
    if (!owned[0]) throw Object.assign(new Error("Address not found."), { status: 404 });
    if (payload.isDefault) await connection.execute("UPDATE user_addresses SET is_default=FALSE WHERE user_id=?", [userId]);
    const sets=[];const values=[];
    for(const [key,column] of Object.entries(fields)) if(Object.hasOwn(payload,key)){sets.push(`${column}=?`);values.push(payload[key]);}
    if(sets.length){values.push(id,userId);await connection.execute(`UPDATE user_addresses SET ${sets.join(",")} WHERE id=? AND user_id=?`,values);}
    const [rows] = await connection.execute(`SELECT id,label,recipient_name AS recipientName,phone,postal_code AS postalCode,
      prefecture,city,address_line1 AS addressLine1,address_line2 AS addressLine2,is_default AS isDefault,
      created_at AS createdAt FROM user_addresses WHERE id=? AND user_id=?`, [id,userId]);
    await connection.commit();
    return rows[0];
  } catch(error){await connection.rollback();throw error;} finally{connection.release();}
};

export const deleteAddress = async (userId, id) => {
  const [result] = await db.execute("DELETE FROM user_addresses WHERE id=? AND user_id=?", [id,userId]);
  if (!result.affectedRows) throw Object.assign(new Error("Address not found."), { status: 404 });
  return { deleted: true };
};
