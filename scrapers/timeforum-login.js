// 타임포럼 최초 1회 로그인용(구글 로그인). 실제 Chrome + 자동화 탐지 우회.
// 로그인 성공(로그아웃 링크 노출)을 자동 감지해 프로필에 세션을 남긴다.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const PROFILE = new URL("../data/tf-chrome-profile", import.meta.url).pathname;
await mkdir(PROFILE, { recursive: true });

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: "chrome",
  headless: false,
  locale: "ko-KR",
  viewport: null,
  args: ["--disable-blink-features=AutomationControlled"],
  ignoreDefaultArgs: ["--enable-automation"],
});
await context.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
});

const page = context.pages()[0] || (await context.newPage());
await page.goto("https://www.timeforum.co.kr/");

console.log("\n창에서 로그인(구글)하세요. 로그인되면 자동 저장됩니다. (창은 닫지 마세요)\n");

// 로그인 판별: '화면에 보이는' 텍스트 기준(innerText는 숨김요소 제외).
// 비회원=로그인 링크 노출 / 회원=로그아웃 노출 & 로그인 사라짐. 연속 2회 확인해야 확정.
let saved = false;
let streak = 0;
for (let i = 0; !saved; i++) {
  await page.waitForTimeout(2500);
  if (page.isClosed()) break;
  let ok = false;
  try {
    // 화면에 보이는 '로그아웃'이 있으면 로그인 상태(로그아웃 상태 홈엔 '로그인'만 보임)
    ok = await page.evaluate(() => (document.body?.innerText || "").includes("로그아웃"));
  } catch {}
  streak = ok ? streak + 1 : 0;
  if (streak >= 2) {
    await page.waitForTimeout(800);
    console.log("\n✅ 로그인 감지 — 세션이 프로필에 저장되었습니다.");
    console.log("이제 config.json 의 timeforum.enabled 를 true 로 바꾸면 됩니다.");
    saved = true;
  } else if (i > 0 && i % 24 === 0) {
    console.log("…아직 로그인 대기 중(구글 로그인 완료해 주세요)");
  }
}

await context.close().catch(() => {});
process.exit(saved ? 0 : 1);
