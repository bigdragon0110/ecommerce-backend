import db from "../config/db.js";

const allowedTypes = new Set(["INFO", "SUCCESS", "WARNING", "PROMOTION"]);

export const listAdminNotifications = async () => (await db.query(`
  SELECT n.id,n.title,n.message,n.type,n.link_url AS linkUrl,n.created_at AS createdAt,
    COUNT(unx.id) AS recipientCount,
    SUM(CASE WHEN unx.is_read=1 THEN 1 ELSE 0 END) AS readCount
  FROM notifications n
  LEFT JOIN user_notifications unx ON unx.notification_id=n.id
  GROUP BY n.id
  ORDER BY n.created_at DESC
  LIMIT 200`))[0];

export const createNotification = async (adminId, payload) => {
  const title=String(payload.title||"").trim();
  const message=String(payload.message||"").trim();
  const type=String(payload.type||"INFO").toUpperCase();
  const linkUrl=String(payload.linkUrl||"").trim()||null;
  const recipientType=payload.recipientType==="selected"?"selected":"all";
  const userIds=[...new Set((Array.isArray(payload.userIds)?payload.userIds:[]).map(Number).filter(Number.isInteger))];
  if(!title||!message)throw Object.assign(new Error("title and message are required."),{status:400});
  if(!allowedTypes.has(type))throw Object.assign(new Error("Invalid notification type."),{status:400});
  if(recipientType==="selected"&&!userIds.length)throw Object.assign(new Error("Select at least one recipient."),{status:400});
  const connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const[result]=await connection.execute(`INSERT INTO notifications(created_by_admin_id,title,message,type,link_url)
      VALUES(?,?,?,?,?)`,[adminId,title,message,type,linkUrl]);
    if(recipientType==="all"){
      await connection.execute(`INSERT INTO user_notifications(notification_id,user_id)
        SELECT ?,id FROM users WHERE UPPER(COALESCE(status,'ACTIVE'))='ACTIVE'`,[result.insertId]);
    }else{
      const placeholders=userIds.map(()=>"?").join(",");
      await connection.execute(`INSERT INTO user_notifications(notification_id,user_id)
        SELECT ?,id FROM users WHERE id IN (${placeholders})`,[result.insertId,...userIds]);
    }
    const[[count]]=await connection.execute("SELECT COUNT(*) AS recipientCount FROM user_notifications WHERE notification_id=?",[result.insertId]);
    if(!Number(count.recipientCount))throw Object.assign(new Error("No eligible recipients were found."),{status:400});
    await connection.commit();
    return{id:result.insertId,title,message,type,linkUrl,recipientCount:Number(count.recipientCount)};
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
};

export const deleteNotification = async id => {
  const connection=await db.getConnection();
  try{await connection.beginTransaction();await connection.execute("DELETE FROM user_notifications WHERE notification_id=?",[id]);const[result]=await connection.execute("DELETE FROM notifications WHERE id=?",[id]);await connection.commit();return result.affectedRows;}
  catch(error){await connection.rollback();throw error;}finally{connection.release();}
};

export const listUserNotifications = async (userId, limit=30) => (await db.execute(`
  SELECT unx.id,n.id AS notificationId,n.title,n.message,n.type,n.link_url AS linkUrl,
    unx.is_read AS isRead,unx.read_at AS readAt,unx.created_at AS createdAt
  FROM user_notifications unx JOIN notifications n ON n.id=unx.notification_id
  WHERE unx.user_id=? AND unx.hidden_at IS NULL
  ORDER BY unx.created_at DESC LIMIT ?`,[userId,Math.min(Math.max(Number(limit)||30,1),100)]))[0];

export const unreadCount = async userId => Number((await db.execute(`SELECT COUNT(*) AS total FROM user_notifications
  WHERE user_id=? AND is_read=0 AND hidden_at IS NULL`,[userId]))[0][0].total);

export const markRead = async (userId,id) => (await db.execute(`UPDATE user_notifications SET is_read=1,read_at=COALESCE(read_at,NOW())
  WHERE id=? AND user_id=? AND hidden_at IS NULL`,[id,userId])).affectedRows;
export const markAllRead = async userId => (await db.execute(`UPDATE user_notifications SET is_read=1,read_at=COALESCE(read_at,NOW())
  WHERE user_id=? AND hidden_at IS NULL AND is_read=0`,[userId])).affectedRows;
export const hideNotification = async (userId,id) => (await db.execute(`UPDATE user_notifications SET hidden_at=NOW()
  WHERE id=? AND user_id=? AND hidden_at IS NULL`,[id,userId])).affectedRows;
