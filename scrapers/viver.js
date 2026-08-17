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
    currency: p.currency || "KRW", // 환산 후 제거. viver는 요청 IP 국가로 통화가 바뀜(클라우드=USD)
    url: `https://www.viver.co.kr/products/${p.id}`,
    image: p.representativeImageUrl || p.thumbnail || undefined,
    date: p.startSaleAt || undefined,
  };
}

// viver는 CloudFront가 요청 IP의 국가로 통화를 정한다(한국=KRW, GitHub Actions(미국)=USD).
// 헤더로 강제 불가 → 외화면 원화로 환산해 가격필터가 맞게 동작하도록 한다.
const FX_FALLBACK = { USD: 1350, EUR: 1450, JPY: 9, GBP: 1700, CNY: 190 };
async function toKrw(items) {
  const cur = [...new Set(items.map((i) => i.currency).filter((c) => c && c !== "KRW"))];
  if (!cur.length) return;
  const rate = {};
  for (const c of cur) {
    try {
      const j = await fetch(`https://open.er-api.com/v6/latest/${c}`).then((r) => r.json());
      rate[c] = j?.rates?.KRW || FX_FALLBACK[c];
    } catch {
      rate[c] = FX_FALLBACK[c];
    }
    console.warn(`[바이버] 통화 ${c}→KRW 환산 (rate=${rate[c]})`);
  }
  for (const i of items) {
    if (i.price && i.currency && i.currency !== "KRW" && rate[i.currency]) {
      i.price = Math.round(i.price * rate[i.currency]);
    }
  }
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
  await toKrw(out); // 외화(클라우드)면 원화로 환산
  out.forEach((i) => delete i.currency); // 스냅샷엔 불필요
  return out;
}
