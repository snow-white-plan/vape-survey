const url = process.argv[2];
const count = Number(process.argv[3] || 100);

if (!url) {
  console.log("用法: node tools/stress-test.js <Apps Script Web App 網址> [筆數]");
  process.exit(1);
}

function payload(i) {
  return {
    submission_id: crypto.randomUUID(),
    pair_id: crypto.randomUUID(),
    stage: "pre",
    session: "stress-test",
    session_raw: "stress-test",
    lang: "zh",
    questions_version: "stress-test",
    client_time: new Date().toISOString(),
    user_agent: "stress-test",
    website: "",
    data: { consent: "1", A1: "1", A2: "1", A3: String(10 + (i % 60)), K1_pre: "F", H1_pre: "3", pre_duration: 12.3 }
  };
}

async function send(i) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload(i))
    });
    const json = await res.json();
    return { ok: res.ok && json.ok, ms: Date.now() - started, error: json.error };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, error: e.message };
  }
}

(async () => {
  console.log(`同時送出 ${count} 筆…`);
  const t0 = Date.now();
  const results = await Promise.all(Array.from({ length: count }, (_, i) => send(i)));
  const ok = results.filter((r) => r.ok).length;
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`成功 ${ok} / ${count}，總耗時 ${Date.now() - t0} ms`);
  console.log(`回應時間 中位數 ${ms[Math.floor(ms.length / 2)]} ms，最慢 ${ms[ms.length - 1]} ms`);
  const errors = results.filter((r) => !r.ok).map((r) => r.error);
  if (errors.length) console.log("失敗原因:", [...new Set(errors)].join(", "));
  console.log("測試資料的 session 為 stress-test，可在 raw 分頁篩選後刪除。");
})();
