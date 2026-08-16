// 중고나라: 브라우저로 검색 페이지를 열고, 페이지가 받아오는 검색 API 응답(JSON)을
// 그대로 가로채서 매물을 추출한다. WAF/서명 문제를 브라우저가 대신 처리해줌.
const SEARCH_HOST = "search-api.joongna.com";

// 다양한 응답 스키마를 견디기 위해 여러 후보 필드명을 시도한다.
function pick(obj, keys) {
  for (const k of keys) if (obj?.[k] != null) return obj[k];
  return undefined;
}

function normalize(raw) {
  const id = pick(raw, ["seq", "productSeq", "id", "articleId"]);
  if (id == null) return null;
  const title = pick(raw, ["title", "productTitle", "name"]) ?? "(제목없음)";
  const priceRaw = pick(raw, ["price", "productPrice", "sellPrice"]);
  const price = typeof priceRaw === "string" ? Number(priceRaw.replace(/[^\d]/g, "")) : priceRaw;
  const img = pick(raw, ["url", "imageUrl", "thumbnail", "image"]);
  return {
    site: "중고나라",
    id: `joongna-${id}`,
    title: String(title).trim(),
    price: Number.isFinite(price) ? price : null,
    url: `https://web.joongna.com/product/${id}`,
    image: img,
  };
}

// 응답 JSON 어딘가에 있는 매물 배열을 찾아낸다(스키마가 바뀌어도 견디도록).
function findProductArray(json) {
  const stack = [json];
  while (stack.length) {
    const cur = stack.pop();
    if (Array.isArray(cur)) {
      const items = cur.map(normalize).filter(Boolean);
      if (items.length) return items;
    } else if (cur && typeof cur === "object") {
      for (const v of Object.values(cur)) stack.push(v);
    }
  }
  return [];
}

export async function scrapeJoongna(context, keyword) {
  const page = await context.newPage();
  const collected = [];
  let sawApi = false;
  const pending = []; // 응답 본문 파싱 프로미스들 — 페이지 닫기 전에 모두 기다림

  page.on("response", (res) => {
    if (!res.url().includes(SEARCH_HOST)) return;
    sawApi = true;
    pending.push(
      res
        .json()
        .then((json) => {
          const items = findProductArray(json);
          if (items.length && collected.length === 0) collected.push(...items);
        })
        .catch(() => {})
    );
  });

  const url = `https://web.joongna.com/search/${encodeURIComponent(keyword)}?sort=RECENT_SORT`;
  // networkidle까지 기다려 여러 검색 API(인기어/연관어/매물) 응답을 모두 받는다.
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await Promise.all(pending); // 본문 파싱 완료 보장
  await page.close();

  if (!sawApi) console.warn(`[중고나라] '${keyword}' 검색 API 응답을 못 잡음 — 페이지 구조 변경 가능성`);
  return collected;
}
