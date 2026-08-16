// 텔레그램으로 새 매물 알림 전송. 봇 토큰/챗ID는 환경변수로 주입.
// 환경변수가 없으면 콘솔에만 출력(로컬 테스트용).
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export async function notify(item) {
  const price = item.price ? `${item.price.toLocaleString("ko-KR")}원` : "가격미상";
  const text = `🕐 새 매물 (${item.site})\n${item.title}\n${price}\n${item.url}`;

  if (!TOKEN || !CHAT_ID) {
    console.log("[알림-미설정]\n" + text + "\n");
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text, disable_web_page_preview: false }),
  });
  if (!res.ok) console.error("텔레그램 전송 실패:", res.status, await res.text());
}
