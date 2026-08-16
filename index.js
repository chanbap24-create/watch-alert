// 진입점: 설정된 키워드로 각 사이트를 검색 → 처음 보는 매물만 알림.
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";

// .env 자동 로드(텔레그램 토큰 등) — Node 20.6+ 내장
const envPath = new URL("./.env", import.meta.url).pathname;
if (existsSync(envPath)) process.loadEnvFile(envPath);

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
import { scrapeGugus } from "./scrapers/gugus.js";
import { isFresh } from "./lib/freshness.js";

// CONFIG 환경변수로 설정파일 선택(클라우드=config.cloud.json / 맥=config.local.json)
const config = JSON.parse(await readFile(new URL(`./${process.env.CONFIG || "config.json"}`, import.meta.url), "utf8"));

// 검색어·검색시각은 settings.json에서 중앙 관리(대시보드에서 편집). 없으면 config로 폴백.
let settings = { keywords: config.keywords, times: ["09:00", "15:00", "21:00"] };
try {
  settings = { ...settings, ...JSON.parse(await readFile(new URL("./settings.json", import.meta.url), "utf8")) };
} catch {}
const keywords = settings.keywords?.length ? settings.keywords : config.keywords;

// 매물 제목에 모든 토큰이 들어있는 첫 키워드를 태그(어떤 검색어로 걸렸는지)
function tagKeyword(item) {
  const t = (item.title || "").toLowerCase();
  item.keyword =
    keywords.find((k) => k.split(/\s+/).every((tok) => t.includes(tok.toLowerCase()))) || keywords[0];
  return item;
}

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
  for (const keyword of keywords) {
    // 중고나라: 브라우저로 검색 응답 가로채기
    if (config.sites.joongna?.enabled) {
      const items = await scrapeJoongna(context, keyword);
      console.log(`[중고나라] '${keyword}': ${items.length}건`);
      found.push(...items.map((i) => ((i.keyword = keyword), i)));
    }
    // 번개장터: 공개 API 직접 검색(브라우저 불필요)
    if (config.sites.bunjang?.enabled) {
      const items = await scrapeBunjang(keyword);
      console.log(`[번개장터] '${keyword}': ${items.length}건`);
      found.push(...items.map((i) => ((i.keyword = keyword), i)));
    }
    // 바이버: 공개 API 직접 검색(브라우저 불필요)
    if (config.sites.viver?.enabled) {
      const items = await scrapeViver(keyword);
      console.log(`[바이버] '${keyword}': ${items.length}건`);
      found.push(...items.map((i) => ((i.keyword = keyword), i)));
    }
    // 캉카스: 쇼핑몰 검색 HTML 파싱(브라우저 불필요)
    if (config.sites.kangkas?.enabled) {
      const items = await scrapeKangkas(keyword);
      console.log(`[캉카스] '${keyword}': ${items.length}건`);
      found.push(...items.map((i) => ((i.keyword = keyword), i)));
    }
    // 필웨이: 공개 API 직접 검색(브라우저 불필요)
    if (config.sites.feelway?.enabled) {
      const items = await scrapeFeelway(keyword);
      console.log(`[필웨이] '${keyword}': ${items.length}건`);
      found.push(...items.map((i) => ((i.keyword = keyword), i)));
    }
  }
  await browser.close();

  // 아래 3곳은 키워드 배열을 한 번에 받으므로, 결과를 제목 기준으로 키워드 태깅
  // 시계거래소: 개인매물 목록을 받아 키워드로 필터(별도 로그인 프로필 사용)
  if (config.sites.watchexchange?.enabled && keywords.length) {
    const items = await scrapeWatchexchange(keywords);
    console.log(`[시계거래소] 개인매물 매칭: ${items.length}건`);
    found.push(...items.map(tagKeyword));
  }
  // 타임포럼: 로그인 프로필로 회원장터 검색
  if (config.sites.timeforum?.enabled && keywords.length) {
    const items = await scrapeTimeforum(keywords);
    console.log(`[타임포럼] 매칭: ${items.length}건`);
    found.push(...items.map(tagKeyword));
  }
  // 구구스: 브라우저로 브랜드 검색 → 시계 필터
  if (config.sites.gugus?.enabled && keywords.length) {
    const items = await scrapeGugus(keywords);
    console.log(`[구구스] 매칭: ${items.length}건`);
    found.push(...items.map(tagKeyword));
  }

  // 오래된(사실상 죽은) 매물 제거 — maxAgeDays 이내만. 날짜 불명 사이트는 유지.
  const before = found.length;
  const fresh = found.filter((i) => isFresh(i, config.maxAgeDays));
  if (config.maxAgeDays) console.log(`최근 ${config.maxAgeDays}일 필터: ${before} → ${fresh.length}건`);
  found.length = 0;
  found.push(...fresh);

  // 이번 실행 전에 이미 본 ID 집합(신규 판별용)
  const prevSeen = new Set(seen);

  let newCount = 0;
  for (const item of found) {
    // 최초 실행이 아니고, 이전에 못 본 매물이면 '신규'
    item.isNew = !firstRun && !prevSeen.has(item.id);
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    newCount++;
    if (!firstRun) await notify(item);
  }
  await saveSeen(seen);

  // 대시보드용 스냅샷 저장(현재 매물 전체) — 웹에서 이 파일을 읽어 보여준다.
  // NO_SNAPSHOT=1 이면 건너뜀(맥 로그인전용 실행이 클라우드 스냅샷을 덮어쓰지 않도록)
  if (!process.env.NO_SNAPSHOT) {
    const outDir = new URL("./docs/", import.meta.url).pathname;
    await mkdir(outDir, { recursive: true });
    const SITE_LABEL = {
      joongna: "중고나라", bunjang: "번개장터", viver: "바이버", kangkas: "캉카스",
      feelway: "필웨이", gugus: "구구스", watchexchange: "시계거래소", timeforum: "타임포럼",
    };
    const checkedSites = Object.entries(config.sites)
      .filter(([, v]) => v?.enabled)
      .map(([k]) => SITE_LABEL[k] || k);
    await writeFile(
      outDir + "snapshot.json",
      JSON.stringify({
        updatedAt: new Date().toISOString(),
        keywords,
        times: settings.times,
        sites: checkedSites,
        count: found.length,
        items: found,
      }),
      "utf8"
    );
  }

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
