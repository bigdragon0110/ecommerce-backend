import { Router } from "express";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adminAuth } from "../middleware/auth.js";
import * as admin from "../models/admin.js";
import * as notifications from "../models/notifications.js";

const router=Router();router.use(adminAuth);
const here=path.dirname(fileURLToPath(import.meta.url));
const backendRoot=path.resolve(here,"../..");
const configuredUploadRoot=process.env.UPLOAD_ROOT||"../shared-storage/images";
const uploadRoot=path.isAbsolute(configuredUploadRoot)?configuredUploadRoot:path.resolve(backendRoot,configuredUploadRoot);
const productUploadDir=path.join(uploadRoot,"products");
const imageTypes=new Map([
  ["image/jpeg",".jpg"],["image/png",".png"],["image/webp",".webp"],
  ["image/gif",".gif"],["image/avif",".avif"],
]);
const wrap=(handler)=>(req,res,next)=>Promise.resolve(handler(req,res)).catch(next);
const context=(req)=>({ip:req.ip,userAgent:req.get("user-agent")});
const logged=(action,type,handler)=>wrap(async(req,res)=>{const result=await handler(req);await admin.audit(req.auth.sub,action,type,req.params.id||result?.id,null,result,context(req));res.json({success:true,data:result});});

router.get("/dashboard",wrap(async(_req,res)=>res.json({success:true,dashboard:await admin.dashboard()})));
router.post("/uploads/products",wrap(async(req,res)=>{
  const files=Array.isArray(req.body?.files)?req.body.files:[];
  if(!files.length||files.length>10)throw Object.assign(new Error("Select between 1 and 10 product images."),{status:400});
  await mkdir(productUploadDir,{recursive:true});
  const images=[];
  for(const file of files){
    const extension=imageTypes.get(file?.type);
    if(!extension)throw Object.assign(new Error("Only JPEG, PNG, WebP, GIF, and AVIF images are allowed."),{status:400});
    const encoded=String(file?.data||"").replace(/^data:[^;]+;base64,/,"");
    const buffer=Buffer.from(encoded,"base64");
    if(!buffer.length||buffer.length>10*1024*1024)throw Object.assign(new Error("Each image must be no larger than 10 MB."),{status:400});
    const filename=`${Date.now()}-${randomUUID()}${extension}`;
    await writeFile(path.join(productUploadDir,filename),buffer,{flag:"wx"});
    images.push({url:`/uploads/products/${filename}`,altText:String(file?.name||"").replace(/\.[^.]+$/,"")});
  }
  res.status(201).json({success:true,images});
}));
router.get("/products",wrap(async(_req,res)=>res.json({success:true,products:await admin.listAdminProducts()})));
router.get("/products/:id",wrap(async(req,res)=>{const p=await admin.getAdminProduct(req.params.id);if(!p)return res.status(404).json({success:false,message:"Product not found."});return res.json({success:true,product:p});}));
router.post("/products",logged("PRODUCT_CREATE","product",async req=>{if(!req.body.sku||!req.body.slug||!req.body.title||!Number.isInteger(Number(req.body.priceYen)))throw Object.assign(new Error("sku, slug, title, and integer priceYen are required."),{status:400});return admin.createProduct(req.body);}));
router.patch("/products/:id",logged("PRODUCT_UPDATE","product",req=>admin.updateProduct(req.params.id,req.body)));
router.delete("/products/:id",logged("PRODUCT_ARCHIVE","product",req=>admin.archiveProduct(req.params.id)));
router.get("/categories",wrap(async(_req,res)=>res.json({success:true,categories:await admin.listCategoriesAdmin()})));
router.post("/categories",logged("CATEGORY_CREATE","category",req=>admin.createCategory(req.body)));
router.patch("/categories/:id",logged("CATEGORY_UPDATE","category",req=>admin.updateCategory(req.params.id,req.body)));
router.delete("/categories/:id",logged("CATEGORY_DELETE","category",async req=>({id:req.params.id,deleted:Boolean(await admin.deleteCategory(req.params.id))})));
router.get("/collections",wrap(async(_req,res)=>res.json({success:true,collections:await admin.listCollectionsAdmin()})));
router.post("/collections",logged("COLLECTION_CREATE","collection",req=>admin.createCollection(req.body)));
router.patch("/collections/:id",logged("COLLECTION_UPDATE","collection",req=>admin.updateCollection(req.params.id,req.body)));
router.delete("/collections/:id",logged("COLLECTION_DELETE","collection",async req=>({id:req.params.id,deleted:Boolean(await admin.deleteCollection(req.params.id))})));
router.get("/inventory",wrap(async(_req,res)=>res.json({success:true,inventory:await admin.listInventory()})));
router.patch("/inventory/:id",logged("INVENTORY_UPDATE","inventory",req=>admin.updateInventory(req.params.id,req.body)));
router.get("/customers",wrap(async(_req,res)=>res.json({success:true,customers:await admin.listCustomers()})));
router.get("/customers/:id",wrap(async(req,res)=>{const customer=await admin.getCustomer(req.params.id);if(!customer)return res.status(404).json({success:false,message:"Customer not found."});return res.json({success:true,customer});}));
router.post("/customers",logged("CUSTOMER_CREATE","customer",req=>admin.createCustomer(req.body)));
router.patch("/customers/:id",logged("CUSTOMER_UPDATE","customer",req=>admin.updateCustomer(req.params.id,req.body)));
router.patch("/customers/:id/status",logged("CUSTOMER_STATUS_UPDATE","customer",req=>admin.updateCustomerStatus(req.params.id,req.body.status)));
router.patch("/customers/:id/password",logged("CUSTOMER_PASSWORD_UPDATE","customer",req=>admin.updateCustomerPassword(req.params.id,req.body.password)));
router.post("/customers/:id/points",logged("CUSTOMER_POINTS_ADJUST","customer",req=>admin.adjustCustomerPoints(req.params.id,req.body,req.auth.sub)));
router.delete("/customers/:id",logged("CUSTOMER_DEACTIVATE","customer",req=>admin.deactivateCustomer(req.params.id)));
router.get("/notifications",wrap(async(_req,res)=>res.json({success:true,notifications:await notifications.listAdminNotifications()})));
router.post("/notifications",logged("NOTIFICATION_CREATE","notification",req=>notifications.createNotification(req.auth.sub,req.body)));
router.delete("/notifications/:id",logged("NOTIFICATION_DELETE","notification",async req=>({id:req.params.id,deleted:Boolean(await notifications.deleteNotification(req.params.id))})));
router.get("/orders",wrap(async(_req,res)=>res.json({success:true,orders:await admin.listOrdersAdmin()})));
router.get("/orders/:id",wrap(async(req,res)=>{const o=await admin.getOrderAdmin(req.params.id);if(!o)return res.status(404).json({success:false,message:"Order not found."});return res.json({success:true,order:o});}));
router.patch("/orders/:id",logged("ORDER_UPDATE","order",req=>admin.updateOrder(req.params.id,req.body)));
router.post("/orders/:id/payments",logged("PAYMENT_CREATE","payment",req=>admin.createPayment(req.params.id,req.body)));
router.post("/orders/:id/shipments",logged("SHIPMENT_CREATE","shipment",req=>admin.createShipment(req.params.id,req.body)));
router.get("/reviews",wrap(async(_req,res)=>res.json({success:true,reviews:await admin.listReviewsAdmin()})));
router.patch("/reviews/:id/status",logged("REVIEW_MODERATE","review",req=>admin.moderateReview(req.params.id,req.body.status)));
router.get("/audit-logs",wrap(async(_req,res)=>res.json({success:true,logs:await admin.listAudit()})));
export default router;
