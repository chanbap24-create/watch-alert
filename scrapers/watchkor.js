// 워치코리아(watchkor.com): 공개 JSON API로 검색(로그인·브라우저 불필요).
// 브랜드는 한글명(brand=브레게)으로 검색 → 나머지 토큰으로 클라이언트 필터. status=available(판매중)만.
const API = "https://api.watchkor.com/watches";
const IMG_BASE = "https://api.watchkor.com"; // images[].file_path 앞에 붙임
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

function tokenMatch(text, keyword) {
  const t = text.toLowerCase();
  return keyword
    .split(/\s+/)
    .filter((x) => x.length >= 1)
    .every((tok) => t.includes(tok.toLowerCase()));
}

function normalize(w) {
  const primary = (w.images || []).find((i) => i.is_primary) || (w.images || [])[0];
  return {
    site: "워치코리아",
    id: `watchkor-${w.id}`,
    title: (w.title || "(제목없음)").trim(),
    price: Number(w.price) || null,
    url: `https://watchkor.com/watch/${w.public_id}`,
    image: primary?.file_path ? IMG_BASE + primary.file_path : undefined,
    date: w.created_at || undefined,
  };
}

// 브랜드명은 사이트 표기를 정확히 맞춰야 함(예: "바쉐론 콘스탄틴"→"바쉐론콘스탄틴" 붙여씀).
// /brands 목록을 받아 키워드 앞부분과 공백무시 매칭. 실패 시 첫 토큰 폴백.
let _brands = null;
async function brandList() {
  if (_brands) return _brands;
  try {
    const j = await fetch("https://api.watchkor.com/brands", { headers: { "User-Agent": UA, Origin: "https://watchkor.com" } }).then((r) => r.json());
    _brands = Object.keys(j || {});
  } catch {
    _brands = [];
  }
  return _brands;
}
function pickBrand(keyword, brands) {
  const norm = (s) => s.replace(/\s+/g, "").toLowerCase();
  const nk = norm(keyword);
  // 키워드가 어떤 브랜드명(공백무시)으로 시작하면 그 브랜드. 여러 개면 가장 긴 것.
  const hit = brands.filter((b) => nk.startsWith(norm(b))).sort((a, b) => norm(b).length - norm(a).length)[0];
  return hit || keyword.split(/\s+/)[0];
}

export async function scrapeWatchkor(keyword, { pages = 3, limit = 100 } = {}) {
  const brand = pickBrand(keyword, await brandList()); // 사이트 브랜드 표기로 정규화
  const out = [];
  const seen = new Set();
  for (let page = 1; page <= pages; page++) {
    const url = `${API}?brand=${encodeURIComponent(brand)}&status=available&page=${page}&limit=${limit}`;
    const res = await fetch(url, { headers: { "User-Agent": UA, Origin: "https://watchkor.com", Accept: "application/json" } });
    if (!res.ok) {
      console.warn(`[워치코리아] 검색 실패 HTTP ${res.status}`);
      break;
    }
    const json = await res.json();
    const items = json?.items || [];
    for (const w of items) {
      if (w.status !== "available") continue; // 판매중만
      if (!tokenMatch(`${w.title} ${w.reference_number || ""}`, keyword)) continue;
      const n = normalize(w);
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push(n);
    }
    if (items.length < limit) break; // 마지막 페이지
  }
  return out;
}
