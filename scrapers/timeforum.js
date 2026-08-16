// 타임포럼 회원장터(BuyMarket): 로그인 상태에서만 검색이 필터링된다.
// 로그인 프로필(data/tf-chrome-profile)로 검색 페이지를 열어 결과 테이블을 파싱.
// 각 행: 브랜드 / 상태(진행·완료) / 유형(판매·구매) / 제목+링크. 가격은 목록에 없음.
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const PROFILE = new URL("../data/tf-chrome-profile", import.meta.url).pathname;
const BASE = "https://www.timeforum.co.kr/BuyMarket?search_target=title_content";

function decode(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function tokenMatch(text, keyword) {
  const t = text.toLowerCase();
  return keyword
    .split(/\s+/)
    .filter((x) => x.length >= 1)
    .every((tok) => t.includes(tok.toLowerCase()));
}

function parseRows(html, keyword, out, seen) {
  const rows = html.split(/<tr[\s>]/i);
  for (const row of rows) {
    const a = row.match(/class="title">\s*<a href="([^"]*document_srl=(\d+)[^"]*)">([^<]{2,120})<\/a>/);
    if (!a) continue;
    const srl = a[2];
    const title = decode(a[3]);
    if (seen.has(srl)) continue;
    const text = row.replace(/<[^>]+>/g, " ");
    if (!/판매/.test(text) || /구매|교환|삽니다|구합/.test(title)) continue; // 판매글만
    if (/완료/.test(text)) continue; // 거래완료 제외
    if (!tokenMatch(`${title} ${text}`, keyword)) continue;
    seen.add(srl);
    // 목록 행의 가격(예: 19,000,000원) 추출
    const priceM = text.match(/([0-9]{1,3}(?:,[0-9]{3})+)\s*원/);
    out.push({
      site: "타임포럼",
      id: `timeforum-${srl}`,
      title,
      price: priceM ? Number(priceM[1].replace(/,/g, "")) : null,
      url: `https://www.timeforum.co.kr/BuyMarket/${srl}`,
      image: undefined,
    });
  }
}

export async function scrapeTimeforum(keywords) {
  if (!existsSync(PROFILE)) {
    console.warn("[타임포럼] 로그인 필요 — `npm run login:timeforum` 먼저 실행");
    return [];
  }
  const list = Array.isArray(keywords) ? keywords : [keywords];
  const ctx = await chromium.launchPersistentContext(PROFILE, { channel: "chrome", headless: true, locale: "ko-KR" });
  const out = [];
  const seen = new Set();
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());

    // 로그인 상태 확인 — 로그아웃 시 검색이 필터되지 않으므로 중단(잘못된 결과 방지)
    await page.goto("https://www.timeforum.co.kr/", { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
    const loggedIn = await page.evaluate(() => (document.body?.innerText || "").includes("로그아웃"));
    if (!loggedIn) {
      console.warn("[타임포럼] 로그인 만료 — `npm run login:timeforum` 로 재로그인 필요(로그인 상태 유지 체크)");
      return out;
    }

    for (const kw of list) {
      // 여러 페이지를 훑어 오래된 매물도 포함(판매중만 남음)
      for (let p = 1; p <= 3; p++) {
        const url = `${BASE}&search_keyword=${encodeURIComponent(kw)}&page=${p}`;
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(600);
        const beforeCount = out.length;
        parseRows(await page.content(), kw, out, seen);
        if (out.length === beforeCount && p > 1) break; // 더 안 늘면 중단
      }
    }
  } finally {
    await ctx.close();
  }
  return out;
}
