import { Router } from "express";
import { getCategories, getCategoryProducts, getCategoryTree, getCollection, getCollections, getProduct, getProducts } from "../models/catalog.js";

const router = Router();
router.get("/products", async (req, res, next) => {
  try { res.json({ success: true, ...await getProducts(req.query) }); } catch (error) { next(error); }
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
router.get("/categories/tree", async (_req, res, next) => {
  try { res.json({ success: true, categories: await getCategoryTree() }); } catch (error) { next(error); }
});
router.get("/categories/:slug/products", async (req, res, next) => {
  try {
    const result = await getCategoryProducts(req.params.slug, req.query);
    if (!result) return res.status(404).json({ success: false, message: "Category not found." });
    return res.json({ success: true, ...result });
  } catch (error) { return next(error); }
});
router.get("/collections", async (_req, res, next) => {
  try { res.json({ success: true, collections: await getCollections() }); } catch (error) { next(error); }
});
router.get("/collections/:slug/products", async (req, res, next) => {
  try {
    const collection = await getCollection(req.params.slug, req.query);
    if (!collection) return res.status(404).json({ success: false, message: "Collection not found." });
    return res.json({ success: true, collection, products: collection.products, pagination: collection.pagination });
  } catch (error) { return next(error); }
});
export default router;
