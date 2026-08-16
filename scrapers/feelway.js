// 필웨이: 공개 JSON API로 검색(로그인·브라우저 불필요). 검색어 파라미터는 q.
// 패션 위주 사이트라 시계 매물은 상대적으로 적음. 키워드 토큰으로 정밀 필터.
const API = "https://www.feelway.com/api/search";
const IMG_BASE = "https://www.feelway.com/";

function tokenMatch(text, keyword) {
  const t = text.toLowerCase();
  return keyword
    .split(/\s+/)
    .filter((x) => x.length >= 1)
    .every((tok) => t.includes(tok.toLowerCase()));
}

function normalize(p) {
  const brand = (p.brand_name || "").trim();
  return {
    site: "필웨이",
    id: `feelway-${p.g_no}`,
    title: (p.g_name || "(제목없음)").trim(),
    price: Number(p.g_price) || null,
    url: `https://www.feelway.com/gv_${brand.replace(/\s+/g, "%20")}_${p.g_no}.html`,
    image: p.g_photo1 ? IMG_BASE + p.g_photo1 : p.g_photo ? IMG_BASE + p.g_photo : undefined,
  };
}

export async function scrapeFeelway(keyword) {
  const res = await fetch(`${API}?q=${encodeURIComponent(keyword)}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", Accept: "application/json" },
  });
  if (!res.ok) {
    console.warn(`[필웨이] 검색 실패 HTTP ${res.status}`);
    return [];
  }
  const json = await res.json();
  const items = json?.data?.items || [];
  return items
    .filter((p) => tokenMatch(`${p.g_name} ${p.brand_name}`, keyword))
    .map(normalize);
}
