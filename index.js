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
import { scrapeWatchkor } from "./scrapers/watchkor.js";
import { scrapeTimeforum } from "./scrapers/timeforum.js";
import { scrapeGugus } from "./scrapers/gugus.js";
import { scrapeHisigan } from "./scrapers/hisigan.js";
import { isFresh, ageDays } from "./lib/freshness.js";

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
  // 사이트별 조사 결과(성공/실패·건수). 한 사이트가 죽어도 나머지는 진행(개별 try/catch).
  const siteStats = {}; // label -> { ok, count }
  const rec = (label, ok, count = 0) => {
    const s = siteStats[label] || (siteStats[label] = { ok: true, count: 0 });
    if (!ok) s.ok = false;
    s.count += count;
  };
  // enabled면 fn 실행 → 결과 배열 반환(실패 시 [] + 빨강 기록). 사이트 하나 죽어도 전체는 계속.
  async function runSite(enabled, label, fn) {
    if (!enabled) return [];
    try {
      const items = await fn();
      rec(label, true, items.length);
      console.log(`[${label}] ${items.length}건`);
      return items;
    } catch (e) {
      rec(label, false);
      console.warn(`[${label}] 실패: ${e.message}`);
      return [];
    }
  }

  for (const keyword of keywords) {
    const tag = (items) => items.map((i) => ((i.keyword = keyword), i));
    found.push(...tag(await runSite(config.sites.joongna?.enabled, "중고나라", () => scrapeJoongna(context, keyword))));
    found.push(...tag(await runSite(config.sites.bunjang?.enabled, "번개장터", () => scrapeBunjang(keyword))));
    found.push(...tag(await runSite(config.sites.viver?.enabled, "바이버", () => scrapeViver(keyword))));
    found.push(...tag(await runSite(config.sites.kangkas?.enabled, "캉카스", () => scrapeKangkas(keyword))));
    found.push(...tag(await runSite(config.sites.feelway?.enabled, "필웨이", () => scrapeFeelway(keyword))));
    found.push(...tag(await runSite(config.sites.watchkor?.enabled, "워치코리아", () => scrapeWatchkor(keyword))));
  }
  await browser.close();

  // 아래 4곳은 키워드 배열을 한 번에 받으므로, 결과를 제목 기준으로 키워드 태깅
  const has = keywords.length > 0;
  found.push(...(await runSite(config.sites.hisigan?.enabled && has, "하이시간", () => scrapeHisigan(keywords))).map(tagKeyword));
  found.push(...(await runSite(config.sites.watchexchange?.enabled && has, "시계거래소", () => scrapeWatchexchange(keywords))).map(tagKeyword));
  found.push(...(await runSite(config.sites.timeforum?.enabled && has, "타임포럼", () => scrapeTimeforum(keywords))).map(tagKeyword));
  found.push(...(await runSite(config.sites.gugus?.enabled && has, "구구스", () => scrapeGugus(keywords))).map(tagKeyword));

  // 오래된(사실상 죽은) 매물 제거 — maxAgeDays 이내만. 날짜 불명 사이트는 유지.
  // 단, 상태값(판매중)이 정확한 마켓(바이버)은 오래돼도 판매중이면 유효 → 나이 필터 제외.
  const AGELESS_SITES = new Set(["바이버", "시계거래소", "워치코리아"]);
  const before = found.length;
  const fresh = found.filter((i) => AGELESS_SITES.has(i.site) || isFresh(i, config.maxAgeDays));
  if (config.maxAgeDays) console.log(`최근 ${config.maxAgeDays}일 필터: ${before} → ${fresh.length}건`);
  found.length = 0;
  found.push(...fresh);

  // 이번 실행 전에 이미 본 ID 집합(신규 판별용)
  const prevSeen = new Set(seen);

  // 금액 범위(만원 단위 → 원). max=0 이면 상한 없음. 가격문의(price=null)는 통과.
  const minW = (settings.priceMin || 0) * 10000;
  const maxW = (settings.priceMax || 0) * 10000;
  const inPriceRange = (p) => p == null || (p >= minW && (maxW === 0 || p <= maxW));
  // 알림은 "등록일이 최근"일 때만(며칠 전 옛 매물이 신규로 뒤늦게 잡혀도 알림 안 감).
  // 날짜 불명 사이트는 통과. 0이면 이 조건 끔.
  const alertAge = settings.alertMaxAgeDays || 0;
  const isRecent = (item) => {
    if (!alertAge) return true;
    const a = ageDays(item.date);
    return a == null || a <= alertAge;
  };

  let newCount = 0;
  for (const item of found) {
    const firstTime = !prevSeen.has(item.id);
    // NEW 배지 = 처음 본 매물 + 등록일이 최근(옛 매물이 뒤늦게 잡혀도 NEW 안 붙음)
    item.isNew = !firstRun && firstTime && isRecent(item);
    if (!seen.has(item.id)) {
      seen.add(item.id);
      newCount++;
    }
    // 알림 = NEW(신규+최근) + 예산 범위
    if (item.isNew && inPriceRange(item.price)) await notify(item);
  }
  await saveSeen(seen);

  // 대시보드용 스냅샷 저장 — 클라우드는 snapshot.json, 맥(로그인2곳)은 snapshot.local.json.
  // 대시보드가 둘을 합쳐서 보여준다.
  {
    const snapFile = process.env.SNAPSHOT_FILE || "snapshot.json";
    const outDir = new URL("./docs/", import.meta.url).pathname;
    await mkdir(outDir, { recursive: true });
    const SITE_LABEL = {
      joongna: "중고나라", bunjang: "번개장터", viver: "바이버", kangkas: "캉카스",
      feelway: "필웨이", gugus: "구구스", watchexchange: "시계거래소", timeforum: "타임포럼",
      hisigan: "하이시간", watchkor: "워치코리아",
    };
    const checkedSites = Object.entries(config.sites)
      .filter(([, v]) => v?.enabled)
      .map(([k]) => SITE_LABEL[k] || k);
    // 사이트별 조사 상태(초록/빨강용): {site, ok, count}. enabled인데 기록 없으면 실패로 간주.
    const siteStatus = checkedSites.map((label) => ({
      site: label,
      ok: siteStats[label]?.ok ?? false,
      count: siteStats[label]?.count ?? 0,
    }));
    await writeFile(
      outDir + snapFile,
      JSON.stringify({
        updatedAt: new Date().toISOString(),
        keywords,
        times: settings.times,
        sites: checkedSites,
        siteStatus,
        priceMin: settings.priceMin || 0,
        priceMax: settings.priceMax || 0,
        alertMaxAgeDays: settings.alertMaxAgeDays || 0,
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
