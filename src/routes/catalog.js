import { Router } from "express";
import { getCategories, getCollection, getCollections, getProduct, getProducts } from "../models/catalog.js";

const router = Router();
router.get("/products", async (req, res, next) => {
  try { res.json({ success: true, products: await getProducts(req.query) }); } catch (error) { next(error); }
});
router.get("/products/:identifier", async (req, res, next) => {
  try {
    const product = await getProduct(req.params.identifier);
    if (!product) return res.status(404).json({ success: false, message: "Product not found." });
    return res.json({ success: true, product });
  } catch (error) { return next(error); }
});
router.get("/categories", async (_req, res, next) => {
  try { res.json({ success: true, categories: await getCategories() }); } catch (error) { next(error); }
});
router.get("/collections", async (_req, res, next) => {
  try { res.json({ success: true, collections: await getCollections() }); } catch (error) { next(error); }
});
router.get("/collections/:slug/products", async (req, res, next) => {
  try {
    const collection = await getCollection(req.params.slug);
    if (!collection) return res.status(404).json({ success: false, message: "Collection not found." });
    return res.json({ success: true, collection, products: collection.products });
  } catch (error) { return next(error); }
});
export default router;
