import { Router } from "express";
import { customerAuth } from "../middleware/auth.js";
import * as account from "../models/account.js";

const router = Router();
router.use(customerAuth);
const wrap = handler => (req,res,next) => Promise.resolve(handler(req,res)).catch(next);
const requireAddress = body => {
  for (const field of ["recipientName","postalCode","prefecture","city","addressLine1"]) {
    if (!body[field]) throw Object.assign(new Error(`${field} is required.`), { status: 400 });
  }
};

router.get("/account", wrap(async(req,res)=>res.json({success:true,profile:await account.getProfile(req.auth.sub)})));
router.patch("/account", wrap(async(req,res)=>res.json({success:true,profile:await account.updateProfile(req.auth.sub,req.body)})));
router.patch("/account/password", wrap(async(req,res)=>{
  if(!req.body.currentPassword||String(req.body.newPassword||"").length<10) throw Object.assign(new Error("currentPassword and a newPassword of at least 10 characters are required."),{status:400});
  res.json({success:true,...await account.changePassword(req.auth.sub,req.body.currentPassword,req.body.newPassword)});
}));
router.get("/account/addresses", wrap(async(req,res)=>res.json({success:true,addresses:await account.listAddresses(req.auth.sub)})));
router.post("/account/addresses", wrap(async(req,res)=>{requireAddress(req.body);res.status(201).json({success:true,address:await account.createAddress(req.auth.sub,req.body)});}));
router.patch("/account/addresses/:id", wrap(async(req,res)=>res.json({success:true,address:await account.updateAddress(req.auth.sub,req.params.id,req.body)})));
router.delete("/account/addresses/:id", wrap(async(req,res)=>res.json({success:true,...await account.deleteAddress(req.auth.sub,req.params.id)})));

export default router;
