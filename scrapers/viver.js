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

// 판매중만 남긴다(상태값이 "판매중"/"판매 완료"/"결제 완료" 등). 완료·예약 제외.
const ON_SALE = "판매중";

export async function scrapeViver(keyword, { pages = 3, size = 100 } = {}) {
  const out = [];
  const seen = new Set();
  for (let p = 0; p < pages; p++) {
    const url = `${API}?q=${encodeURIComponent(keyword)}&size=${size}&page=${p}&sort=createdAt,desc`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
    if (!res.ok) {
      console.warn(`[바이버] 검색 실패 HTTP ${res.status}`);
      break;
    }
    const json = await res.json();
    const content = json?.content || [];
    for (const item of content) {
      if (item.status !== ON_SALE) continue; // 판매중만
      const n = normalize(item);
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push(n);
    }
    if (content.length < size) break; // 마지막 페이지
  }
  return out;
}
