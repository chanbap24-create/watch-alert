// 바이버(VIVER): 공개 JSON API로 검색(로그인·브라우저 불필요). 서버 키워드 검색은 q 파라미터.
// createdAt desc 로 최신순 → 새 매물이 앞쪽에 등장.
const API = "https://api.viver.co.kr/products";

function normalize(p) {
  const sub = p.titleSecondary ? ` (${p.titleSecondary})` : "";
  const brandKo = p.brand?.koName ? p.brand.koName + " " : "";
  return {
    site: "바이버",
    id: `viver-${p.id}`,
    title: (brandKo + (p.title || "(제목없음)") + sub).trim(),
    price: Number(p.price) || null,
    url: `https://www.viver.co.kr/products/${p.id}`,
    image: p.representativeImageUrl || p.thumbnail || undefined,
    date: p.startSaleAt || undefined,
  };
}

export async function scrapeViver(keyword, { size = 40 } = {}) {
  const url = `${API}?q=${encodeURIComponent(keyword)}&size=${size}&sort=createdAt,desc`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
  if (!res.ok) {
    console.warn(`[바이버] 검색 실패 HTTP ${res.status}`);
    return [];
  }
  const json = await res.json();
  const content = json?.content || [];
  // 판매완료 제외(새 매물 알림 목적)
  return content.filter((p) => p.status !== "판매완료").map(normalize);
}
