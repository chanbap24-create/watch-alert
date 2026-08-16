// 시계거래소 최초 1회 로그인용. 실제 Chrome + 자동화 탐지 우회로 구글 로그인 차단을 회피.
// 로그인 성공(토큰 저장)을 자동 감지해 상태를 저장한다.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const STATE = new URL("../data/watchexchange.state.json", import.meta.url).pathname;
const PROFILE = new URL("../data/wx-chrome-profile", import.meta.url).pathname;
await mkdir(PROFILE, { recursive: true });

// 전용 프로필 + 실제 Chrome + 자동화 흔적 제거
const context = await chromium.launchPersistentContext(PROFILE, {
  channel: "chrome",
  headless: false,
  locale: "ko-KR",
  viewport: null,
  args: ["--disable-blink-features=AutomationControlled"],
  ignoreDefaultArgs: ["--enable-automation"],
});
// navigator.webdriver 흔적 제거
await context.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
});

const page = context.pages()[0] || (await context.newPage());
await page.goto("https://pc.watchexchange.co.kr/");

console.log("\n창에서 로그인하세요. 로그인되면 자동 저장됩니다. (창은 닫지 마세요)\n");

let saved = false;
for (let i = 0; !saved; i++) {
  await page.waitForTimeout(2500);
  if (page.isClosed()) break;
  let hasToken = false;
  try {
    hasToken = await page.evaluate(() => {
      const hit = (s) => /token|auth|firebase|accessToken|jwt/i.test(s || "");
      for (let k = 0; k < localStorage.length; k++) {
        const key = localStorage.key(k);
        const val = localStorage.getItem(key);
        if ((hit(key) || hit(val)) && (val || "").length > 20) return true;
      }
      return false;
    });
  } catch {}
  if (hasToken) {
    await page.waitForTimeout(1500);
    await context.storageState({ path: STATE });
    console.log(`\n✅ 로그인 저장 완료 → ${STATE}`);
    console.log("이제 config.json 의 watchexchange.enabled 를 true 로 바꾸면 됩니다.");
    saved = true;
  } else if (i > 0 && i % 24 === 0) {
    console.log("…아직 로그인 대기 중");
  }
}

await context.close().catch(() => {});
process.exit(saved ? 0 : 1);
