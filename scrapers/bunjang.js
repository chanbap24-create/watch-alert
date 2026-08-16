// 번개장터: 공개 JSON API로 검색(로그인·브라우저 불필요, 서버 키워드 검색 지원).
// order=date 로 최신순 정렬 → 새 매물이 앞쪽에 등장.
const API = "https://api.bunjang.co.kr/api/1/find_v2.json";

function normalize(p) {
  return {
    site: "번개장터",
    id: `bunjang-${p.pid}`,
    title: (p.name || "(제목없음)").trim(),
    price: Number(p.price) || null,
    url: `https://m.bunjang.co.kr/products/${p.pid}`,
    image: p.product_image ? p.product_image.replace("{res}", "300") : undefined,
    location: p.location || undefined,
    date: p.update_time || undefined, // 유닉스초
  };
}

export async function scrapeBunjang(keyword, { n = 30 } = {}) {
  const url = `${API}?q=${encodeURIComponent(keyword)}&order=date&page=0&n=${n}&stat_device=w`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
  if (!res.ok) {
    console.warn(`[번개장터] 검색 실패 HTTP ${res.status}`);
    return [];
  }
  const json = await res.json();
  const list = json?.list || [];
  // status "0" = 판매중. 판매완료 등 제외하고 싶으면 여기서 필터 가능.
  return list.map(normalize);
}
