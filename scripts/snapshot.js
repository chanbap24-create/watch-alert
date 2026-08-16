// 모든 사이트를 검색해 현재 매물 전체를 public/snapshot.json 으로 저장.
// 웹 대시보드(정적 호스팅)가 이 파일을 읽어 보여준다.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { scrapeJoongna } from "../scrapers/joongna.js";
import { scrapeBunjang } from "../scrapers/bunjang.js";
import { scrapeViver } from "../scrapers/viver.js";
import { scrapeKangkas } from "../scrapers/kangkas.js";
import { scrapeFeelway } from "../scrapers/feelway.js";
import { scrapeTimeforum } from "../scrapers/timeforum.js";
import { scrapeWatchexchange } from "../scrapers/watchexchange.js";
import { isFresh } from "../lib/freshness.js";

const config = JSON.parse(await readFile(new URL("../config.json", import.meta.url), "utf8"));

const items = [];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: "ko-KR",
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
});

for (const kw of config.keywords) {
  if (config.sites.joongna?.enabled) items.push(...(await scrapeJoongna(context, kw)));
  if (config.sites.bunjang?.enabled) items.push(...(await scrapeBunjang(kw)));
  if (config.sites.viver?.enabled) items.push(...(await scrapeViver(kw)));
  if (config.sites.kangkas?.enabled) items.push(...(await scrapeKangkas(kw)));
  if (config.sites.feelway?.enabled) items.push(...(await scrapeFeelway(kw)));
}
await browser.close();

if (config.sites.watchexchange?.enabled) items.push(...(await scrapeWatchexchange(config.keywords)));
if (config.sites.timeforum?.enabled) items.push(...(await scrapeTimeforum(config.keywords)));

const fresh = items.filter((i) => isFresh(i, config.maxAgeDays));
console.log(`최근 ${config.maxAgeDays || "∞"}일 필터: ${items.length} → ${fresh.length}건`);

const outDir = new URL("../docs/", import.meta.url).pathname;
await mkdir(outDir, { recursive: true });
const snapshot = {
  updatedAt: new Date().toISOString(),
  keywords: config.keywords,
  count: fresh.length,
  items: fresh,
};
await writeFile(outDir + "snapshot.json", JSON.stringify(snapshot, null, 0), "utf8");
console.log(`snapshot 저장: ${fresh.length}건 → docs/snapshot.json`);
