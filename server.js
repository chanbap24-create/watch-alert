// 로컬 웹 UI: 브라우저에서 키워드로 검색하고 매물을 카드로 본다.
// 브라우저는 한 번만 띄워 재사용(스크래핑 속도↑).
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { chromium } from "playwright";
import { scrapeJoongna } from "./scrapers/joongna.js";
import { scrapeWatchexchange } from "./scrapers/watchexchange.js";
import { scrapeBunjang } from "./scrapers/bunjang.js";
import { scrapeViver } from "./scrapers/viver.js";
import { scrapeKangkas } from "./scrapers/kangkas.js";
import { scrapeFeelway } from "./scrapers/feelway.js";
import { scrapeTimeforum } from "./scrapers/timeforum.js";
import { scrapeGugus } from "./scrapers/gugus.js";
import { scrapeHisigan } from "./scrapers/hisigan.js";
import { scrapeWatchkor } from "./scrapers/watchkor.js";

const CONFIG = new URL("./config.json", import.meta.url).pathname;
const PORT = 5178;

let browser, context;
async function ensureBrowser() {
  if (browser) return;
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    locale: "ko-KR",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  });
}

async function loadConfig() {
  return JSON.parse(await readFile(CONFIG, "utf8"));
}

function json(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const html = await readFile(new URL("./docs/index.html", import.meta.url), "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    if (url.pathname === "/snapshot.json" || url.pathname === "/snapshot.local.json") {
      try {
        const snap = await readFile(new URL("./docs" + url.pathname, import.meta.url), "utf8");
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(snap);
      } catch {
        return json(res, 404, { error: "snapshot 없음" });
      }
    }
    if (url.pathname === "/live") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(PAGE);
    }

    // 설정(검색어·검색시각) 조회/저장 — 로컬에서만 편집. 저장 시 클라우드까지 반영.
    if (url.pathname === "/api/settings") {
      const dir = new URL("./", import.meta.url).pathname;
      if (req.method === "POST") {
        const body = await readBody(req);
        const keywords = (body.keywords || []).map((k) => String(k).trim()).filter(Boolean);
        const times = (body.times || []).filter((t) => /^\d{2}:\d{2}$/.test(t)).slice(0, 6);
        const priceMin = Math.max(0, Number(body.priceMin) || 0);
        const priceMax = Math.max(0, Number(body.priceMax) || 0);
        const alertMaxAgeDays = Math.max(0, Number(body.alertMaxAgeDays) || 0);
        const resultFilter = String(body.resultFilter || "").trim();
        await writeFile(dir + "settings.json", JSON.stringify({ keywords, resultFilter, times, priceMin, priceMax, alertMaxAgeDays }, null, 2));
        // 모든 config의 keywords 동기화
        for (const f of ["config.json", "config.cloud.json", "config.local.json"]) {
          try {
            const c = JSON.parse(await readFile(dir + f, "utf8"));
            c.keywords = keywords;
            await writeFile(dir + f, JSON.stringify(c, null, 2));
          } catch {}
        }
        await regenSchedules(dir, times);
        const pushed = gitPush(dir);
        return json(res, 200, { ok: true, pushed });
      }
      try {
        return json(res, 200, JSON.parse(await readFile(dir + "settings.json", "utf8")));
      } catch {
        return json(res, 200, { keywords: [], times: ["09:00", "15:00", "21:00"] });
      }
    }

    if (url.pathname === "/api/keywords") {
      const cfg = await loadConfig();
      if (req.method === "POST") {
        const body = await readBody(req);
        const kw = (body.keyword || "").trim();
        if (kw && !cfg.keywords.includes(kw)) cfg.keywords.push(kw);
        await writeFile(CONFIG, JSON.stringify(cfg, null, 2));
      }
      if (req.method === "DELETE") {
        const kw = url.searchParams.get("keyword");
        const cfg2 = await loadConfig();
        cfg2.keywords = cfg2.keywords.filter((k) => k !== kw);
        await writeFile(CONFIG, JSON.stringify(cfg2, null, 2));
        return json(res, 200, cfg2);
      }
      return json(res, 200, await loadConfig());
    }

    if (url.pathname === "/api/search") {
      const keyword = url.searchParams.get("keyword") || "";
      if (!keyword) return json(res, 400, { error: "keyword 필요" });
      const cfg = await loadConfig();
      await ensureBrowser();
      const items = [];
      if (cfg.sites.joongna?.enabled) items.push(...(await scrapeJoongna(context, keyword)));
      if (cfg.sites.bunjang?.enabled) {
        try {
          items.push(...(await scrapeBunjang(keyword)));
        } catch (e) {
          console.warn("번개장터 검색 실패:", e.message);
        }
      }
      if (cfg.sites.viver?.enabled) {
        try {
          items.push(...(await scrapeViver(keyword)));
        } catch (e) {
          console.warn("바이버 검색 실패:", e.message);
        }
      }
      if (cfg.sites.kangkas?.enabled) {
        try {
          items.push(...(await scrapeKangkas(keyword)));
        } catch (e) {
          console.warn("캉카스 검색 실패:", e.message);
        }
      }
      if (cfg.sites.feelway?.enabled) {
        try {
          items.push(...(await scrapeFeelway(keyword)));
        } catch (e) {
          console.warn("필웨이 검색 실패:", e.message);
        }
      }
      if (cfg.sites.timeforum?.enabled) {
        try {
          items.push(...(await scrapeTimeforum([keyword])));
        } catch (e) {
          console.warn("타임포럼 검색 실패:", e.message);
        }
      }
      if (cfg.sites.gugus?.enabled) {
        try {
          items.push(...(await scrapeGugus([keyword])));
        } catch (e) {
          console.warn("구구스 검색 실패:", e.message);
        }
      }
      if (cfg.sites.hisigan?.enabled) {
        try { items.push(...(await scrapeHisigan([keyword]))); } catch (e) { console.warn("하이시간 검색 실패:", e.message); }
      }
      if (cfg.sites.watchkor?.enabled) {
        try { items.push(...(await scrapeWatchkor(keyword))); } catch (e) { console.warn("워치코리아 검색 실패:", e.message); }
      }
      if (cfg.sites.watchexchange?.enabled) {
        try {
          items.push(...(await scrapeWatchexchange([keyword])));
        } catch (e) {
          console.warn("시계거래소 검색 실패:", e.message);
        }
      }
      return json(res, 200, { keyword, count: items.length, items });
    }

    res.writeHead(404).end("not found");
  } catch (e) {
    json(res, 500, { error: String(e) });
  }
});

// 검색 시각(KST)으로 GitHub Actions cron과 맥 launchd를 다시 생성.
async function regenSchedules(dir, times) {
  if (!times.length) return;
  // GitHub Actions cron (UTC = KST - 9). GitHub 스케줄은 누락이 잦아 시각마다 13분 뒤 백업을 하나 더 건다.
  // (cancel-in-progress:false라 백업은 큐잉되고, 변경 없으면 no-op이라 무해)
  const crons = times
    .flatMap((t) => {
      const [h, m] = t.split(":").map(Number);
      const uh = (h - 9 + 24) % 24;
      const line = (min) => `    - cron: "${min % 60} ${(uh + Math.floor(min / 60)) % 24} * * *"`;
      return [line(m), line(m + 13)];
    })
    .join("\n");
  try {
    const wf = dir + ".github/workflows/check.yml";
    let y = await readFile(wf, "utf8");
    y = y.replace(/  schedule:\n(?:    - cron: "[^"]*"\n)+/, `  schedule:\n${crons}\n`);
    await writeFile(wf, y);
  } catch (e) {
    console.warn("workflow cron 갱신 실패:", e.message);
  }
  // 맥 launchd plist StartCalendarInterval
  const intervals = times
    .map((t) => {
      const [h, m] = t.split(":").map(Number);
      return `        <dict><key>Hour</key><integer>${h}</integer><key>Minute</key><integer>${m}</integer></dict>`;
    })
    .join("\n");
  try {
    const plist = process.env.HOME + "/Library/LaunchAgents/com.watchalert.check.plist";
    let p = await readFile(plist, "utf8");
    p = p.replace(/    <array>\n(?:        <dict><key>Hour<\/key>[\s\S]*?<\/dict>\n)+    <\/array>/, `    <array>\n${intervals}\n    </array>`);
    await writeFile(plist, p);
    execSync(`launchctl unload "${plist}" 2>/dev/null; launchctl load "${plist}"`, { shell: "/bin/zsh" });
  } catch (e) {
    console.warn("launchd 갱신 실패:", e.message);
  }
}

// 변경사항을 GitHub에 push(클라우드 반영). 성공 여부 반환.
function gitPush(dir) {
  try {
    execSync(
      `cd "${dir}" && git add settings.json config*.json .github/workflows/check.yml && ` +
        `git commit -m "chore: 검색어/시각 편집" && git push`,
      { shell: "/bin/zsh", stdio: "ignore" }
    );
    return true;
  } catch {
    return false;
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(d || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

server.listen(PORT, () => console.log(`\n▶ http://localhost:${PORT} 에서 열어보세요\n`));

const PAGE = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>watch-alert</title>
<style>
:root{--bg:#fff;--fg:#111;--sub:#888;--line:#ececec;--action:#111}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;color:var(--fg);background:var(--bg);word-break:keep-all}
header{padding:22px 20px 14px;border-bottom:1px solid var(--line)}
h1{margin:0;font-size:1.4rem;font-weight:600}
.sub{color:var(--sub);font-size:.8rem;margin-top:4px}
.wrap{max-width:860px;margin:0 auto;padding:0 20px}
.kw{display:flex;gap:8px;flex-wrap:wrap;padding:14px 0;align-items:center}
.chip{border:1px solid var(--line);border-radius:999px;padding:6px 12px;font-size:.85rem;cursor:pointer;background:#fafafa}
.chip.on{background:var(--action);color:#fff;border-color:var(--action)}
.chip .x{color:var(--sub);margin-left:6px}
.chip.on .x{color:#bbb}
form.add{display:flex;gap:8px;margin-left:auto}
input{font-size:16px;border:1px solid var(--line);border-radius:8px;padding:8px 10px;min-width:150px}
button{font-size:.9rem;border:none;background:var(--action);color:#fff;border-radius:8px;padding:9px 14px;cursor:pointer}
.status{color:var(--sub);font-size:.85rem;padding:6px 0 12px}
.item{display:flex;gap:14px;padding:14px 0;border-bottom:1px solid var(--line);text-decoration:none;color:inherit}
.item img{width:88px;height:88px;object-fit:cover;border-radius:10px;background:#f2f2f2;flex:none}
.title{font-size:.98rem;line-height:1.4}
.price{font-weight:700;margin-top:6px;font-variant-numeric:tabular-nums}
.badge{font-size:.72rem;color:var(--sub);margin-top:4px}
</style></head><body>
<header><div class="wrap"><h1>watch-alert</h1><div class="sub">중고나라 실시간 검색 · 하루 3회 자동 알림은 별도 실행</div></div></header>
<div class="wrap">
  <div class="kw" id="kw"></div>
  <div class="status" id="status">키워드를 선택하세요</div>
  <div id="list"></div>
</div>
<script>
let keywords=[], active=null;
const won=n=>n?n.toLocaleString("ko-KR")+"원":"가격문의";
async function loadKw(){const r=await fetch("/api/keywords");const c=await r.json();keywords=c.keywords;render();}
function render(){
  const el=document.getElementById("kw");el.innerHTML="";
  keywords.forEach(k=>{
    const c=document.createElement("span");c.className="chip"+(k===active?" on":"");
    c.innerHTML=k+' <span class="x">✕</span>';
    c.onclick=e=>{if(e.target.classList.contains("x")){delKw(k);}else{search(k);}};
    el.appendChild(c);
  });
  const f=document.createElement("form");f.className="add";
  f.innerHTML='<input placeholder="키워드 추가 (예: 브레게 마린)"><button>추가</button>';
  f.onsubmit=async e=>{e.preventDefault();const v=f.querySelector("input").value.trim();if(!v)return;
    await fetch("/api/keywords",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({keyword:v})});await loadKw();search(v);};
  el.appendChild(f);
}
async function delKw(k){await fetch("/api/keywords?keyword="+encodeURIComponent(k),{method:"DELETE"});if(active===k){active=null;document.getElementById("list").innerHTML="";document.getElementById("status").textContent="키워드를 선택하세요";}await loadKw();}
async function search(k){
  active=k;render();
  document.getElementById("status").textContent="'"+k+"' 검색 중…(수 초 소요)";
  document.getElementById("list").innerHTML="";
  const r=await fetch("/api/search?keyword="+encodeURIComponent(k));const d=await r.json();
  document.getElementById("status").textContent="'"+k+"' · "+(d.count||0)+"건";
  document.getElementById("list").innerHTML=(d.items||[]).map(it=>
    '<a class="item" href="'+it.url+'" target="_blank">'+
    (it.image?'<img src="'+it.image+'">':'<div class="item-img" style="width:88px;height:88px;border-radius:10px;background:#f2f2f2"></div>')+
    '<div><div class="title">'+it.title+'</div><div class="price">'+won(it.price)+'</div><div class="badge">'+it.site+'</div></div></a>'
  ).join("")||"<div class='status'>매물 없음</div>";
}
loadKw();
</script></body></html>`;
