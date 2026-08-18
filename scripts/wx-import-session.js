// 시계거래소: 진짜 크롬(사용자 로그인 완료)에서 세션을 읽어 스크레이퍼 프로필로 이식.
// 자동화 브라우저는 구글/네이버 OAuth·App Check 마지막 토큰교환이 막히므로,
// 신뢰되는 실제 크롬에서 로그인 → CDP로 localStorage(토큰·device_id)·쿠키를 읽어 프로필에 주입.
//
// 사용법:
//  1) 크롬 완전 종료 후, 원격 디버깅으로 재실행:
//     "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222
//  2) 그 크롬에서 https://pc.watchexchange.co.kr 접속 후 로그인(네이버/구글 등). 로그인 완료 화면까지.
//  3) node scripts/wx-import-session.js
import { chromium } from "playwright";
import { rm } from "node:fs/promises";

const PROFILE = new URL("../data/wx-chrome-profile", import.meta.url).pathname;
const APP = "https://pc.watchexchange.co.kr/";

// 1) 실제 크롬(CDP)에서 세션 추출
const browser = await chromium.connectOverCDP("http://localhost:9222").catch((e) => {
  console.error("❌ 크롬(9222)에 연결 실패. 위 사용법 1)로 크롬을 원격 디버깅 모드로 켰는지 확인하세요.\n  " + e.message);
  process.exit(1);
});
const contexts = browser.contexts();
let src = null;
for (const c of contexts) {
  for (const p of c.pages()) {
    if (p.url().includes("watchexchange.co.kr")) src = p;
  }
}
if (!src) {
  console.error("❌ 열린 탭 중 watchexchange.co.kr 페이지를 못 찾음. 진짜 크롬에서 pc.watchexchange.co.kr 로그인 후 그 탭을 열어두세요.");
  process.exit(1);
}

const ls = await src.evaluate(() => {
  const o = {};
  for (let i = 0; i < localStorage.length; i++) o[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
  return o;
});
const cookies = await src.context().cookies();
const wxCookies = cookies.filter((c) => /watchexchange\.co\.kr/.test(c.domain));
await browser.close();

const hasToken = ls["flutter.access_token"] || ls["flutter.refresh_token"];
console.log(`추출: localStorage ${Object.keys(ls).length}개, watchexchange 쿠키 ${wxCookies.length}개, 토큰 ${hasToken ? "있음" : "없음"}`);
if (!hasToken) {
  console.error("❌ 진짜 크롬에도 flutter.access_token/refresh_token 이 없습니다 = 로그인이 완료 안 됨. 크롬에서 로그인 상태(내 프로필 보임)를 확인 후 다시 실행하세요.");
  process.exit(1);
}

// 2) 스크레이퍼 프로필 초기화 후 세션 주입
await rm(PROFILE, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(PROFILE, { channel: "chrome", headless: true, locale: "ko-KR" });
try {
  if (wxCookies.length) await ctx.addCookies(wxCookies);
  const page = ctx.pages()[0] || (await ctx.newPage());
  // localStorage 는 origin 로드 후에만 주입 가능 → 앱을 먼저 연다(로그인 전이라도 로드됨)
  await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.evaluate((data) => {
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
  }, ls);
  // 주입한 세션으로 재로드해 앱이 인식하는지 확인
  await page.reload({ waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const ok = await page.evaluate(() => {
    try { return !!JSON.parse(localStorage.getItem("flutter.access_token")); } catch { return false; }
  });
  console.log(ok ? "✅ 프로필에 세션 이식 완료 — 스크레이퍼가 사용할 수 있습니다." : "⚠️ 주입은 했으나 access_token 확인 실패(리프레시 대기 중일 수 있음). 스크레이퍼로 검증하세요.");
} finally {
  await ctx.close();
}
process.exit(0);
