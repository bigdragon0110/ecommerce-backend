import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.replace(/^--/, "").split("=");
  return [key, rest.join("=")];
}));

const sourceUrl = args.url || process.env.SOURCE_CATEGORY_URL || "https://houshoshop.jp/shop/list.php?ca_id=50&sort=&sortodr=&page=1";
const output = path.resolve(args.output || path.join(here, "../data/theme-jewelry.json"));
const collectionSlug = args.collection || "theme-jewelry";
const categoryName = args.category || "テーマジュエリー";
const categorySlug = args["category-slug"] || collectionSlug;
const sourceCategoryId = Number(args["source-category-id"] || new URL(sourceUrl).searchParams.get("ca_id")) || null;
const parentSourceCategoryId = Number(args["parent-source-category-id"]) || null;
const parentName = args["parent-name"] || null;
const parentSlug = args["parent-slug"] || null;
const MAX_PAGES = 100;
const FETCH_TIMEOUT_MS = Number(process.env.SOURCE_FETCH_TIMEOUT_MS || 60_000);
const FETCH_ATTEMPTS = Math.max(1, Number(process.env.SOURCE_FETCH_ATTEMPTS || 3));
const requestedPageCount = Number(args.pages || process.env.SOURCE_CATEGORY_PAGES || 0);
const allowEmpty = Object.hasOwn(args, "allow-empty");

const decode = (value = "") => value
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&#039;|&apos;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&nbsp;/g, " ");

const text = (value = "") => decode(value.replace(/<[^>]*>/g, " "))
  .replace(/\s+/g, " ")
  .trim();

const badgeFrom = (value) => {
  const normalized = text(value).toLowerCase();
  if (/ヒート|hit/.test(normalized)) return "HIT";
  if (/人気|popular/.test(normalized)) return "POPULAR";
  if (/推薦|推奨|recommended/.test(normalized)) return "RECOMMENDED";
  if (/最新|new/.test(normalized)) return "NEW";
  if (/割引|sale/.test(normalized)) return "SALE";
  return "NONE";
};

const parsePageCount = (html) => {
  const pages = [...html.matchAll(/[?&](?:amp;)?page=(\d+)/gi)].map((match) => Number(match[1]));
  return Math.max(1, ...pages.filter(Number.isFinite));
};

const parseProducts = (html) => html
  .split(/<div class="item-list-wrap">/i)
  .slice(1)
  .map((block) => {
    const id = Number(block.match(/item\.php\?it_id=(\d+)/i)?.[1]);
    const title = text(block.match(/<h5 class="product-name">([\s\S]*?)<\/h5>/i)?.[1]);
    const priceYen = Number((block.match(/class="title-price"[^>]*>[^0-9]*([\d,]+)/i)?.[1] || "0").replaceAll(",", ""));
    const description = text(block.match(/<div class="product-info"[^>]*>([\s\S]*?)<\/div>/i)?.[1]);
    const imageUrls = [...block.matchAll(/<img\s+[^>]*src="([^"]+)"/gi)]
      .map((match) => decode(match[1]))
      .filter((url) => /\/data\/item\//.test(url))
      .slice(0, 2);
    const badgeMarkup = block.match(/rgba-banner[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "";

    if (!id || !title || !priceYen || !imageUrls[0]) return null;
    return {
      id,
      title: title.replace(/\s*要約情報及び購入\s*$/, ""),
      price: priceYen / 1000,
      category: categoryName,
      badge: badgeFrom(badgeMarkup),
      description: description || "商品情報をご確認ください。",
      material: "Gold",
      image: imageUrls[0],
      gallery: imageUrls,
      sourceImage: imageUrls[0],
    };
  })
  .filter(Boolean);

const fetchPage = async (page) => {
  const url = new URL(sourceUrl);
  url.searchParams.set("page", String(page));
  let lastError;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "TakoyakiCatalogSync/1.0 (+product catalog migration)",
          accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Source returned HTTP ${response.status} for page ${page}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt >= FETCH_ATTEMPTS) break;
      const waitMs = attempt * 2_000;
      console.warn(`Page ${page} attempt ${attempt}/${FETCH_ATTEMPTS} failed: ${error.message}. Retrying in ${waitMs / 1000}s...`);
      await delay(waitMs);
    }
  }
  throw new Error(`Page ${page} failed after ${FETCH_ATTEMPTS} attempts: ${lastError?.message || "unknown error"}`);
};

const run = async () => {
  const firstHtml = await fetchPage(1);
  const discoveredPageCount = parsePageCount(firstHtml);
  const pageLimit = Math.min(requestedPageCount > 0 ? requestedPageCount : MAX_PAGES, MAX_PAGES);
  const products = new Map();
  let scrapedPageCount = 0;

  for (let page = 1; page <= pageLimit; page += 1) {
    const html = page === 1 ? firstHtml : await fetchPage(page);
    const pageProducts = parseProducts(html);
    const before = products.size;
    for (const product of pageProducts) products.set(product.id, product);
    const newProducts = products.size - before;
    if (pageProducts.length === 0 || (page > 1 && newProducts === 0)) {
      console.log(`Stopped at page ${page}: no new products found`);
      break;
    }
    scrapedPageCount = page;
    console.log(`Scraped page ${page}/${requestedPageCount || "auto"}: ${pageProducts.length} products (${newProducts} new)`);
  }

  if (!products.size && !allowEmpty) throw new Error("No products were found; the category may be empty or the source markup may have changed.");
  if (!products.size) console.log(`Category ${categoryName} contains no products; saving an empty catalog so synchronization can continue.`);
  const ids = [...products.keys()];
  const catalog = {
    source: { url: sourceUrl, scrapedAt: new Date().toISOString(), pageCount: scrapedPageCount, discoveredPageCount },
    category: { sourceCategoryId, name: categoryName, slug: categorySlug, parentSourceCategoryId, parentName, parentSlug },
    products: [...products.values()],
    sections: { [collectionSlug]: ids },
  };

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  console.log(`Saved ${ids.length} unique products to ${output}`);
};

run().catch((error) => {
  console.error(`Category scrape failed: ${error.message}`);
  process.exitCode = 1;
});
