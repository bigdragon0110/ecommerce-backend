import { Router } from "express";
import { customerAuth } from "../middleware/auth.js";
import * as commerce from "../models/commerce.js";

const router = Router();
const integer = (value, name) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw Object.assign(new Error(`${name} must be a positive integer.`), { status: 400 });
  return parsed;
};

router.get("/products/:productId/reviews", async (req,res,next) => {
  try { res.json({ success:true,reviews:await commerce.getProductReviews(req.params.productId) }); } catch(error){ next(error); }
});
router.use(customerAuth);
router.get("/cart", async (req,res,next) => { try { res.json({success:true,cart:await commerce.getCart(req.auth.sub)}); } catch(error){next(error);} });
router.post("/cart/items", async (req,res,next) => { try { res.status(201).json({success:true,cart:await commerce.addCartItem(req.auth.sub,integer(req.body.productId,"productId"),req.body.variantId?integer(req.body.variantId,"variantId"):null,integer(req.body.quantity||1,"quantity"))}); } catch(error){next(error);} });
router.patch("/cart/items/:itemId", async (req,res,next) => { try { res.json({success:true,cart:await commerce.updateCartItem(req.auth.sub,integer(req.params.itemId,"itemId"),integer(req.body.quantity,"quantity"))}); } catch(error){next(error);} });
router.delete("/cart/items/:itemId", async (req,res,next) => { try { res.json({success:true,cart:await commerce.deleteCartItem(req.auth.sub,integer(req.params.itemId,"itemId"))}); } catch(error){next(error);} });
router.get("/wishlist", async (req,res,next) => { try { res.json({success:true,products:await commerce.getWishlist(req.auth.sub)}); } catch(error){next(error);} });
router.post("/wishlist/:productId", async (req,res,next) => { try { res.status(201).json({success:true,products:await commerce.addWishlist(req.auth.sub,integer(req.params.productId,"productId"))}); } catch(error){next(error);} });
router.delete("/wishlist/:productId", async (req,res,next) => { try { res.json({success:true,products:await commerce.deleteWishlist(req.auth.sub,integer(req.params.productId,"productId"))}); } catch(error){next(error);} });
router.get("/orders", async (req,res,next) => { try { res.json({success:true,orders:await commerce.getOrders(req.auth.sub)}); } catch(error){next(error);} });
router.post("/orders", async (req,res,next) => { try { if(!req.body.customerEmail||!req.body.shippingAddress) throw Object.assign(new Error("customerEmail and shippingAddress are required."),{status:400}); res.status(201).json({success:true,order:await commerce.createOrder(req.auth.sub,req.body)}); } catch(error){next(error);} });
router.get("/orders/:identifier", async (req,res,next) => { try { const order=await commerce.getOrder(req.auth.sub,req.params.identifier); if(!order)return res.status(404).json({success:false,message:"Order not found."}); return res.json({success:true,order}); } catch(error){return next(error);} });
router.post("/orders/:identifier/cancel", async (req,res,next) => { try { res.json({success:true,order:await commerce.cancelOrder(req.auth.sub,req.params.identifier)}); } catch(error){next(error);} });
router.post("/products/:productId/reviews", async (req,res,next) => { try { const rating=integer(req.body.rating,"rating"); if(rating>5)throw Object.assign(new Error("rating must be between 1 and 5."),{status:400}); res.status(201).json({success:true,review:await commerce.createReview(req.auth.sub,integer(req.params.productId,"productId"),{...req.body,rating})}); } catch(error){next(error);} });
export default router;
