// 매물의 등록/갱신 날짜로 "오래된 매물"을 걸러낸다.
// 날짜를 모르는 사이트(캉카스·타임포럼)는 유지(숨기지 않음).

// 다양한 날짜 표현을 밀리초로: ISO, "YYYY-MM-DD HH:MM:SS", 유닉스초(number)
function toMs(v) {
  if (v == null) return null;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v; // 초→밀리초
  const ms = Date.parse(String(v).replace(" ", "T"));
  return Number.isNaN(ms) ? null : ms;
}

export function ageDays(dateVal, now = Date.now()) {
  const ms = toMs(dateVal);
  return ms == null ? null : (now - ms) / 86400000;
}

// maxAgeDays 이내면 통과. 날짜 불명이면 통과(유지).
export function isFresh(item, maxAgeDays) {
  if (!maxAgeDays || maxAgeDays <= 0) return true;
  const a = ageDays(item.date);
  return a == null ? true : a <= maxAgeDays;
}
