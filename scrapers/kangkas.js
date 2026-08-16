// 캉카스백화점: 고도몰 쇼핑몰 검색(goods_search.php) HTML 파싱. 로그인·브라우저 불필요.
// 가격은 목록에 노출되지 않아(별도 로딩) 생략. 제목은 이미지 alt/title에서 추출.
const BASE = "https://www.kangkas.com/goods/goods_search.php";

function decode(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function tokenMatch(text, keyword) {
  const t = text.toLowerCase();
  return keyword
    .split(/\s+/)
    .filter((x) => x.length >= 1)
    .every((tok) => t.includes(tok.toLowerCase()));
}

export async function scrapeKangkas(keyword) {
  const url = `${BASE}?keyword=${encodeURIComponent(keyword)}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" } });
  if (!res.ok) {
    console.warn(`[캉카스] 검색 실패 HTTP ${res.status}`);
    return [];
  }
  const html = await res.text();

  const out = [];
  const seen = new Set();
  // goodsNo=NNN 링크 뒤 가까운 <img ...> 태그를 통째로 잡고, 그 안에서 alt/title·src를 추출
  const re = /goodsNo=(\d+)"[\s\S]{0,250}?(<img\b[^>]*>)/g;
  let m;
  while ((m = re.exec(html))) {
    const no = m[1];
    const imgTag = m[2];
    if (seen.has(no)) continue;
    const titleM = imgTag.match(/(?:alt|title)="([^"]{3,150})"/);
    if (!titleM) continue;
    const title = decode(titleM[1]);
    if (!tokenMatch(title, keyword)) continue;
    const srcM = imgTag.match(/\bsrc="([^"]+)"/);
    seen.add(no);
    out.push({
      site: "캉카스",
      id: `kangkas-${no}`,
      title,
      price: null, // 목록에 가격 미노출
      url: `https://www.kangkas.com/goods/goods_view.php?goodsNo=${no}`,
      image: srcM ? srcM[1] : undefined,
    });
  }
  return out;
}
