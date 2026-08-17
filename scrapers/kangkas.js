// 캉카스백화점: 고도몰 쇼핑몰 검색(goods_search.php) HTML 파싱. 로그인·브라우저 불필요.
// 찜 버튼의 data-goods-* 속성에 상품번호·제목·가격·이미지가 모두 들어있음.
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
  // 상품 <li> 단위로 쪼개, 각 블록에서 상품번호·제목·가격(item_price)·이미지를 추출.
  // 가격이 노출된 상품만 숫자, 미노출은 가격문의(null).
  for (const li of html.split(/<li\b/)) {
    const noM = li.match(/goodsNo=(\d+)/);
    if (!noM) continue;
    const no = noM[1];
    if (seen.has(no)) continue;
    const nmM = li.match(/data-goods-nm="([^"]{2,150})"/) || li.match(/<img[^>]*\b(?:alt|title)="([^"]{3,150})"/);
    if (!nmM) continue;
    const title = decode(nmM[1]);
    if (!tokenMatch(title, keyword)) continue;
    // 표시 가격: <strong class="item_price"> … ￦42,500,000  (없으면 가격문의)
    const pM =
      li.match(/item_price[\s\S]{0,120}?([1-9][0-9]{0,2}(?:,[0-9]{3})+)/) ||
      li.match(/data-goods-price="([\d.]+)"/);
    let price = null;
    if (pM) price = Math.round(Number(pM[1].replace(/,/g, ""))) || null;
    const img = (li.match(/<img[^>]*\bsrc="([^"]+)"/) || [])[1] || (li.match(/data-goods-image-src="([^"]+)"/) || [])[1];
    seen.add(no);
    out.push({
      site: "캉카스",
      id: `kangkas-${no}`,
      title,
      price,
      url: `https://www.kangkas.com/goods/goods_view.php?goodsNo=${no}`,
      image: img || undefined,
    });
  }
  return out;
}
