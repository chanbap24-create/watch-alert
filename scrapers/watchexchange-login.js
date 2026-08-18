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

console.log("\n▶ 창에서 로그인하세요(네이버 권장 — 구글은 자동화 차단됨).");
console.log("  '✅ 로그인 저장 완료' 가 뜰 때까지 창을 닫지 마세요. (최대 5분 대기)\n");

// flutter.access_token 이 실제로 저장돼야 성공. 로그인 후 앱이 토큰을 넣기까지 몇 초 걸릴 수 있음.
const MAX = 120; // 2.5s * 120 = 5분
let saved = false;
for (let i = 0; i < MAX && !saved; i++) {
  await page.waitForTimeout(2500);
  if (page.isClosed()) {
    console.log("창이 닫혔습니다. 토큰 저장 전이면 다시 실행하세요.");
    break;
  }
  let state = null;
  try {
    state = await page.evaluate(() => {
      const g = (k) => {
        try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
      };
      return { url: location.href, at: !!g("flutter.access_token"), rt: !!g("flutter.refresh_token") };
    });
  } catch {}
  if (state?.at) {
    await page.waitForTimeout(1500);
    await context.storageState({ path: STATE });
    console.log(`\n✅ 로그인 저장 완료 → ${STATE}`);
    saved = true;
  } else if (i % 8 === 0) {
    // 20초마다 진행상황(현재 URL·토큰 유무)
    const loc = (state?.url || "").replace(/^https?:\/\//, "").slice(0, 45);
    console.log(`…대기 중 [${loc}] access_token:${state?.at ? "O" : "X"}`);
  }
}

await context.close().catch(() => {});
if (!saved) console.log("\n❌ 토큰 저장 실패. 로그인이 끝까지 완료됐는지(내 프로필 화면) 확인 후 재시도하세요.");
process.exit(saved ? 0 : 1);
