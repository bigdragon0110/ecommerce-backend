import "dotenv/config";
import { execFileSync } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.resolve(here, "../data/source-categories");
const shouldImport = process.argv.includes("--import");
const onlyMissing = process.argv.includes("--missing");

const groups = [
  { id: 10, name: "テーマジュエリー", slug: "theme-jewelry", pages: 10 },
  { id: 20, name: "GOLD BAR", slug: "gold-bar", children: [
    [2010, "自社ゴールドバー", "company-gold-bar"], [2020, "LS-NIKKO ゴールドバー", "ls-nikko-gold-bar"],
    [2030, "十二支の神ゴールドバー", "zodiac-gold-bar"], [2040, "手紙ゴールドバー", "letter-gold-bar"],
  ] },
  { id: 30, name: "SILVER BAR", slug: "silver-bar", children: [
    [3010, "高級型シルバーバー", "premium-silver-bar"], [3020, "投資型シルバーバー", "investment-silver-bar"],
  ] },
  { id: 40, name: "初誕生", slug: "first-birthday", children: [
    [4010, "ベビーリング", "baby-ring"], [4020, "アンクレット", "anklet"], [4030, "ベビーネックレス", "baby-necklace"], [4040, "ゴールドスプーン", "gold-spoon"],
  ] },
  { id: 50, name: "女性 純金", slug: "women-pure-gold", children: [
    [5010, "ネックレス", "women-necklaces"], [5020, "ブレスレット", "women-bracelets"], [5030, "イヤリング", "women-earrings"],
    [5040, "リング", "women-rings"], [5050, "カップリング", "women-couple-rings"], [5060, "2連風レディース指輪", "women-double-rings"], [5070, "ペンダント", "women-pendants"],
  ] },
  { id: 60, name: "男性 純金", slug: "men-pure-gold", children: [
    [6010, "男性ネックレス", "men-necklaces"], [6020, "男性ブレスレット", "men-bracelets"], [6030, "男性リング", "men-rings"], [6040, "男性ペンダント", "men-pendants"],
  ] },
  { id: 70, name: "カップル", slug: "couples", children: [
    [7010, "シルバージュエリー", "couple-silver-jewelry"], [7020, "ビスポーク·リング", "bespoke-rings"], [7030, "カップリング", "couple-rings"],
  ] },
  { id: 80, name: "企業&GIFT プレゼント", slug: "corporate-gifts", children: [
    [8010, "所蔵品(動物)", "corporate-animal-collection"], [8020, "GOLF", "corporate-golf"], [8030, "所蔵品(模型)", "corporate-model-collection"],
  ] },
  { id: 90, name: "ウエディング", slug: "wedding", children: [
    [9010, "コニャックダイヤモンド", "cognac-diamond"], [9020, "ラップダイヤモンド", "lab-diamond"], [9030, "モアッサナイト", "moissanite"], [9040, "ジルコニア", "zirconia"],
  ] },
];

const allCategories = groups.flatMap((parent) => [parent, ...(parent.children || []).map(([id, name, slug]) => ({ id, name, slug, parent }))]);
const fromArgument = process.argv.find((value) => value.startsWith("--from="));
const fromId = Number(fromArgument?.split("=")[1]) || null;
const startIndex = fromId ? allCategories.findIndex((category) => category.id === fromId) : 0;
if (fromId && startIndex < 0) throw new Error(`Unknown source category id: ${fromId}`);
const categories = allCategories.slice(Math.max(0, startIndex));
const runNode = (script, args) => execFileSync(process.execPath, [script, ...args], { cwd: path.resolve(here, ".."), env: process.env, stdio: "inherit" });

const run = async () => {
  await mkdir(dataDirectory, { recursive: true });
  let processedCount = 0;
  let skippedCount = 0;
  const failedCategories = [];
  for (const category of categories) {
    const output = path.join(dataDirectory, `${category.id}-${category.slug}.json`);
    if (onlyMissing) {
      try {
        await access(output);
        console.log(`Skipping ${category.name} (ca_id=${category.id}): ${path.basename(output)} already exists`);
        skippedCount += 1;
        continue;
      } catch {
        // A missing output file means this category still needs to be scraped.
      }
    }
    const args = [
      `--url=https://houshoshop.jp/shop/list.php?ca_id=${category.id}&sort=&sortodr=&page=1`,
      `--category=${category.name}`, `--category-slug=${category.slug}`, `--source-category-id=${category.id}`,
      `--collection=${category.slug}`, `--output=${output}`,
      "--allow-empty",
    ];
    if (category.pages) args.push(`--pages=${category.pages}`);
    if (category.parent) args.push(`--parent-source-category-id=${category.parent.id}`, `--parent-name=${category.parent.name}`, `--parent-slug=${category.parent.slug}`);
    console.log(`\n=== ${category.name} (ca_id=${category.id}) ===`);
    try {
      runNode(path.join(here, "scrape-source-category.js"), args);
      if (shouldImport) runNode(path.join(here, "import-products.js"), [output]);
      processedCount += 1;
    } catch (error) {
      failedCategories.push({ id: category.id, name: category.name, message: error.message });
      console.error(`Continuing after category ${category.id} failed.`);
    }
  }
  console.log(`\nCompleted ${processedCount} categories${shouldImport ? " and imported them into MySQL" : ""}.`);
  if (onlyMissing) console.log(`Skipped ${skippedCount} categories with existing scrape files.`);
  if (failedCategories.length) {
    console.error(`Failed categories (${failedCategories.length}):`);
    for (const failure of failedCategories) console.error(`- ${failure.id} ${failure.name}: ${failure.message}`);
    process.exitCode = 1;
  }
};

run().catch((error) => { console.error(`Category synchronization failed: ${error.message}`); process.exitCode = 1; });
