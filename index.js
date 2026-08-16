// 진입점: 설정된 키워드로 각 사이트를 검색 → 처음 보는 매물만 알림.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { loadSeen, saveSeen } from "./lib/store.js";
import { notify } from "./lib/notify.js";
import { scrapeJoongna } from "./scrapers/joongna.js";
import { scrapeWatchexchange } from "./scrapers/watchexchange.js";
import { scrapeBunjang } from "./scrapers/bunjang.js";
import { scrapeViver } from "./scrapers/viver.js";
import { scrapeKangkas } from "./scrapers/kangkas.js";
import { scrapeFeelway } from "./scrapers/feelway.js";
import { scrapeTimeforum } from "./scrapers/timeforum.js";

const config = JSON.parse(await readFile(new URL("./config.json", import.meta.url), "utf8"));

async function main() {
  const seen = await loadSeen();
  const firstRun = seen.size === 0; // 최초 실행은 알림 폭탄 방지: 기록만 하고 조용히 넘어감
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    locale: "ko-KR",
  });

  const found = [];
  for (const keyword of config.keywords) {
    // 중고나라: 브라우저로 검색 응답 가로채기
    if (config.sites.joongna?.enabled) {
      const items = await scrapeJoongna(context, keyword);
      console.log(`[중고나라] '${keyword}': ${items.length}건`);
      found.push(...items);
    }
    // 번개장터: 공개 API 직접 검색(브라우저 불필요)
    if (config.sites.bunjang?.enabled) {
      const items = await scrapeBunjang(keyword);
      console.log(`[번개장터] '${keyword}': ${items.length}건`);
      found.push(...items);
    }
    // 바이버: 공개 API 직접 검색(브라우저 불필요)
    if (config.sites.viver?.enabled) {
      const items = await scrapeViver(keyword);
      console.log(`[바이버] '${keyword}': ${items.length}건`);
      found.push(...items);
    }
    // 캉카스: 쇼핑몰 검색 HTML 파싱(브라우저 불필요)
    if (config.sites.kangkas?.enabled) {
      const items = await scrapeKangkas(keyword);
      console.log(`[캉카스] '${keyword}': ${items.length}건`);
      found.push(...items);
    }
    // 필웨이: 공개 API 직접 검색(브라우저 불필요)
    if (config.sites.feelway?.enabled) {
      const items = await scrapeFeelway(keyword);
      console.log(`[필웨이] '${keyword}': ${items.length}건`);
      found.push(...items);
    }
  }
  await browser.close();

  // 시계거래소: 개인매물 목록을 받아 키워드로 필터(별도 로그인 프로필 사용)
  if (config.sites.watchexchange?.enabled && config.keywords.length) {
    const items = await scrapeWatchexchange(config.keywords);
    console.log(`[시계거래소] 개인매물 매칭: ${items.length}건`);
    found.push(...items);
  }
  // 타임포럼: 로그인 프로필로 회원장터 검색
  if (config.sites.timeforum?.enabled && config.keywords.length) {
    const items = await scrapeTimeforum(config.keywords);
    console.log(`[타임포럼] 매칭: ${items.length}건`);
    found.push(...items);
  }

  let newCount = 0;
  for (const item of found) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    newCount++;
    if (!firstRun) await notify(item);
  }
  await saveSeen(seen);

  // 대시보드용 스냅샷 저장(현재 매물 전체) — 웹에서 이 파일을 읽어 보여준다.
  const outDir = new URL("./public/", import.meta.url).pathname;
  await mkdir(outDir, { recursive: true });
  await writeFile(
    outDir + "snapshot.json",
    JSON.stringify({ updatedAt: new Date().toISOString(), keywords: config.keywords, count: found.length, items: found }),
    "utf8"
  );

  console.log(
    firstRun
      ? `최초 실행: ${newCount}건 기록(알림 생략). 스냅샷 ${found.length}건 저장.`
      : `새 매물 ${newCount}건 알림 완료. 스냅샷 ${found.length}건 저장.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
