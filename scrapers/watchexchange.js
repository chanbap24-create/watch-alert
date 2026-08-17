// 시계거래소 개인매물(라운지 아님) 검색.
// 로그인 프로필(data/wx-chrome-profile)로 앱을 잠깐 열어 토큰을 자동 갱신·추출한 뒤,
// 개인매물 검색 API를 키워드별로 직접 호출한다.
// 핵심: 검색어 필드는 searchKeyword. 판매완료(SELL_COMPLETED)는 제외.
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const PROFILE = new URL("../data/wx-chrome-profile", import.meta.url).pathname;
const API = "https://api.watchexchange.co.kr/api/v1/public/sell-info/search";
const S3 = "https://watchexchange.s3.ap-northeast-2.amazonaws.com";

// 개인매물 + 판매중 계열만(판매완료 제외 → 새 매물 알림 목적)
const BASE = {
  saleStatuses: ["CAFE_INBOUND", "SELLING", "MATCHING_IN_PROGRESS", "EXCLUSIVE_OCCUPIED"],
  sellTypes: ["DIRECT_SALE"],
  hasFullSet: false,
  hasReceipt: false,
  hasWarranty: false,
  sortBy: "신규입고",
};

// 브랜드는 레코드에 영문("Breguet")으로만 있는 경우가 있어 한글→영문 별칭 보강.
const BRAND_ALIAS = {
  브레게: "breguet",
  롤렉스: "rolex",
  오메가: "omega",
  파텍: "patek",
  파텍필립: "patek",
  바쉐론: "vacheron",
  예거: "jaeger",
  세이코: "seiko",
  튜더: "tudor",
  까르띠에: "cartier",
  파네라이: "panerai",
  브라이틀링: "breitling",
  위블로: "hublot",
  제니스: "zenith",
};

// 서버 searchKeyword가 이미 걸러주지만, 안전망으로 토큰이 모두(원문 또는 영문별칭) 있는지 확인.
function matches(item, keyword) {
  // 원본 카페 제목(watchUserSellPost.title)엔 브랜드가 살아있음(앱 productName은 "마린"처럼 생략).
  const w = item.watchSpecificationInfo || {};
  const text = [
    item.productName,
    item.model,
    item.modelNum,
    item.watchUserSellPost?.title,
    w.brandCategory?.name,
    w.family,
    w.name,
    w.langNames?.en,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return keyword
    .split(/\s+/)
    .filter((t) => t.length >= 1)
    .every((t) => {
      const lt = t.toLowerCase();
      const alias = (BRAND_ALIAS[t] || BRAND_ALIAS[lt] || "").toLowerCase();
      return text.includes(lt) || (alias && text.includes(alias));
    });
}

function normalize(item) {
  return {
    site: "시계거래소",
    id: `wx-${item.id}`,
    // 원본 카페 제목이 더 상세(브랜드 포함). 없으면 productName으로.
    title: (item.watchUserSellPost?.title || item.productName || item.model || "(제목없음)").trim(),
    price: Number(item.sellPrice) || null,
    // 로그인 없이 보이는 자체 상세페이지로 링크(공개 API 사용). 원본 앱/웹 링크는 그 안에 있음.
    url: `https://chanbap24-create.github.io/watch-alert/wx.html?id=${item.id}`,
    image: item.mainImage?.filePath ? S3 + item.mainImage.filePath : undefined,
    date: item.createdAt || item.inBoundDate || undefined,
  };
}

// 로그인 프로필로 앱을 열어 최신 토큰과 device-id를 얻는다.
async function getAuth() {
  const ctx = await chromium.launchPersistentContext(PROFILE, { channel: "chrome", headless: true, locale: "ko-KR" });
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto("https://pc.watchexchange.co.kr/", { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
    return await page.evaluate(() => {
      const g = (k) => {
        try {
          return JSON.parse(localStorage.getItem(k));
        } catch {
          return null;
        }
      };
      return { at: g("flutter.access_token"), dev: g("flutter.stable_device_id") };
    });
  } finally {
    await ctx.close();
  }
}

async function searchKeyword(headers, keyword, pages, size) {
  const items = [];
  for (let p = 1; p <= pages; p++) {
    const body = JSON.stringify({ ...BASE, searchKeyword: keyword, page: p, size });
    const res = await fetch(API, { method: "POST", headers, body });
    if (!res.ok) {
      console.warn(`[시계거래소] 검색 실패 HTTP ${res.status} (토큰 만료 시 재로그인)`);
      break;
    }
    const content = (await res.json())?.page?.content || [];
    items.push(...content);
    if (content.length < size) break;
  }
  return items;
}

// pages: 키워드당 훑을 최신 페이지 수(신규순 → 새 매물은 앞쪽). 알림 목적이라 소수로 충분.
export async function scrapeWatchexchange(keywords, { pages = 2, size = 100 } = {}) {
  if (!existsSync(PROFILE)) {
    console.warn("[시계거래소] 로그인 필요 — `npm run login:watchexchange` 먼저 실행");
    return [];
  }
  const { at, dev } = await getAuth();
  if (!at || !dev) {
    console.warn("[시계거래소] 토큰 없음 — 재로그인 필요");
    return [];
  }
  const headers = {
    Authorization: "Bearer " + at,
    "x-device-id": dev,
    "Content-Type": "application/json",
    Accept: "application/json",
    Origin: "https://pc.watchexchange.co.kr",
  };

  const seen = new Set();
  const out = [];
  for (const kw of keywords) {
    // 앱은 제목을 브랜드 없이("마린") 저장하는 경우가 많아, 전체 문구로 검색하면 최근 매물을 놓친다.
    // → 키워드의 각 토큰(+브랜드 영문 별칭)으로 따로 검색해 합친 뒤, 구조화 정보로 정밀 필터.
    const tokens = kw.split(/\s+/).filter((t) => t.length >= 1);
    const terms = new Set();
    for (const t of tokens) {
      terms.add(t);
      const alias = BRAND_ALIAS[t] || BRAND_ALIAS[t.toLowerCase()];
      if (alias) terms.add(alias); // 예: 브레게 → breguet 로도 검색
    }
    const rawById = new Map();
    for (const term of terms) {
      const raw = await searchKeyword(headers, term, pages, size);
      for (const item of raw) rawById.set(item.id, item);
    }
    for (const item of rawById.values()) {
      if (!matches(item, kw)) continue; // 모든 토큰이 제목/모델/브랜드(별칭)/패밀리에 있어야
      const n = normalize(item);
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push(n);
    }
  }
  return out;
}
