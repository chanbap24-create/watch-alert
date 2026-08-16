// 구구스: 실제 Chrome로 검색(gugusSearch.viewSearchList)을 실행하면 상품목록 HTML 안에
// `var products = [...]` JSON이 들어온다. 이걸 파싱해 시계 카테고리 + 키워드로 필터.
// 구구스 검색은 '브랜드 단위'라 키워드의 첫 토큰(브랜드)으로 검색 후 나머지 토큰으로 정밀 필터.
import { chromium } from "playwright";

const IMG_BASE = "https://image.gugus.co.kr";

function tokenMatch(text, keyword) {
  const t = text.toLowerCase();
  return keyword
    .split(/\s+/)
    .filter((x) => x.length >= 1)
    .every((tok) => t.includes(tok.toLowerCase()));
}

function extractProducts(html) {
  const m = html.match(/var products\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) return [];
  const decoded = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  try {
    return JSON.parse(decoded);
  } catch {
    return [];
  }
}

function isWatch(p) {
  return /시계/.test(`${p.oprtCtgrNm1 || ""} ${p.oprtCtgrNm2 || ""} ${p.oprtCtgrNm3 || ""}`);
}

function normalize(p) {
  return {
    site: "구구스",
    id: `gugus-${p.gdsNo}`,
    title: (p.gdsNm || "(제목없음)").trim(),
    price: Number(p.dcSalePrc || p.prstSalePrc) || null,
    url: `https://www.gugus.co.kr/goods/viewGoods?goodsNo=${p.gdsNo}`,
    image: p.gdsImgUrl ? IMG_BASE + p.gdsImgUrl : undefined,
    date: p.ltlyRegDtm || p.regDtm || undefined,
  };
}

export async function scrapeGugus(keywords) {
  const list = Array.isArray(keywords) ? keywords : [keywords];
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  const ctx = await browser.newContext({ locale: "ko-KR", viewport: { width: 1280, height: 1400 } });
  await ctx.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => undefined }));
  const page = await ctx.newPage();

  const out = [];
  const seen = new Set();
  try {
    for (const kw of list) {
      const brand = kw.split(/\s+/)[0]; // 첫 토큰(브랜드)로 검색
      const products = [];
      const onResp = async (r) => {
        if (/selectListGoodsBase/.test(r.url())) {
          try {
            products.push(...extractProducts(await r.text()));
          } catch {}
        }
      };
      page.on("response", onResp);
      await page.goto("https://www.gugus.co.kr/", { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await page.evaluate((b) => {
        try {
          // eslint-disable-next-line no-undef
          gugusSearch.viewSearchList(b);
        } catch {}
      }, brand);
      await page.waitForTimeout(4000);
      // 스크롤로 다음 페이지들 로드(최대 5페이지 분량)
      for (let i = 0; i < 5; i++) {
        await page.mouse.wheel(0, 2000);
        await page.waitForTimeout(1200);
      }
      page.off("response", onResp);

      if (!products.length) {
        console.warn(`[구구스] '${brand}' 상품목록을 못 받음(브랜드 미해석 가능성)`);
        continue;
      }
      for (const p of products) {
        if (!isWatch(p)) continue; // 시계만
        if (!tokenMatch(p.gdsNm, kw)) continue;
        const n = normalize(p);
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        out.push(n);
      }
    }
  } finally {
    await browser.close();
  }
  return out;
}
