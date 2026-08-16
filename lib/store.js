// 이미 알림 보낸 매물 ID를 파일에 기록해 중복 알림을 막는다.
// (나중에 Supabase로 바꿔도 이 인터페이스만 맞추면 됨)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const SEEN_PATH = new URL("../data/seen.json", import.meta.url).pathname;

export async function loadSeen() {
  try {
    const raw = await readFile(SEEN_PATH, "utf8");
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

export async function saveSeen(seen) {
  await mkdir(dirname(SEEN_PATH), { recursive: true });
  await writeFile(SEEN_PATH, JSON.stringify([...seen], null, 0), "utf8");
}
