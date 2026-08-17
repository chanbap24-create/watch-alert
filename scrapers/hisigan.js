// 하이시간(한국시계거래소): 자체 판매 재고를 브랜드별로 판매. 로그인 불필요(세션 쿠키만).
// 검색은 브랜드 단위(brands 파라미터) → 나머지 토큰으로 클라이언트 필터.
const BASE = "https://www.hisigan.co.kr";
const CDN = "https://d1dgsdfp663hfv.cloudfront.net";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

// 상품 API가 세션 쿠키를 요구 → 판매 페이지 방문해 JSESSIONID 획득
async function getSession(brand) {
  const r = await fetch(`${BASE}/user/main/getSale.do?brand=${encodeURIComponent(brand)}`, { headers: { "User-Agent": UA } });
  const sc = r.headers.get("set-cookie") || "";
  const m = sc.match(/JSESSIONID=[^;]+/);
  return m ? m[0] : "";
}

function tokenMatch(text, keyword) {
  const t = text.toLowerCase();
  return keyword
    .split(/\s+/)
    .filter((x) => x.length >= 1)
    .every((tok) => t.includes(tok.toLowerCase()));
}

function normalize(p) {
  // 특가(specialFlag=Y)면 특가, 아니면 판매가
  const price = Number(p.specialFlag === "Y" && p.specialPrice ? p.specialPrice : p.salePrice) || null;
  const title = `${p.brand || ""} ${p.modelDetail || p.model || ""}`.replace(/\s+/g, " ").trim();
  return {
    site: "하이시간",
    id: `hisigan-${p.saleCd}`,
    title: title || "(제목없음)",
    price,
    url: `${BASE}/user/product/getSaleInfo.do?saleCd=${p.saleCd}`,
    image: p.saveName ? `${CDN}/upload${p.filePath || ""}${p.saveName}` : undefined,
    // 딜러 상시 재고라 등록일 오래돼도 판매중 → 날짜 필터에서 제외(날짜 미설정)
  };
}

export async function scrapeHisigan(keywords, { pages = 2, limit = 100 } = {}) {
  const list = Array.isArray(keywords) ? keywords : [keywords];
  const out = [];
  const seen = new Set();
  for (const kw of list) {
    const brand = kw.split(/\s+/)[0]; // 첫 토큰 = 브랜드
    const cookie = await getSession(brand);
    if (!cookie) {
      console.warn("[하이시간] 세션 획득 실패");
      continue;
    }
    const headers = {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${BASE}/user/main/getSale.do?brand=${encodeURIComponent(brand)}`,
      Cookie: cookie,
      "User-Agent": UA,
    };
    for (let page = 1; page <= pages; page++) {
      const body = `brands=${encodeURIComponent(brand)}&searchSort=newPage&filterCheck=N&page=${page}&limitCnt=${limit}`;
      const r = await fetch(`${BASE}/user/product/getSaleProductList.do`, { method: "POST", headers, body });
      if (!r.ok) break;
      let j;
      try {
        j = await r.json();
      } catch {
        break;
      }
      const arr = j.list || [];
      for (const p of arr) {
        if (!tokenMatch(`${p.brand} ${p.brandEn} ${p.modelDetail} ${p.model} ${p.reference}`, kw)) continue;
        const n = normalize(p);
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        out.push(n);
      }
      if (arr.length < limit) break;
    }
  }
  return out;
}
