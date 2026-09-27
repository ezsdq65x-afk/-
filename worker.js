const MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const ALLOWED_ORIGIN = "https://ezsdq65x-afk.github.io";

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type",
};

function respond(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

function cleanValue(v) {
  v = String(v ?? "").trim();
  if (/^(?:-|—|―|なし|不明|unknown|null|n\/a)$/i.test(v)) return "";
  return v;
}

function parseFields(text) {
  const raw = String(text ?? "").trim();

  // First accept JSON if the model happened to return it.
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = cleaned.indexOf("{");
  const b = cleaned.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try {
      return JSON.parse(cleaned.slice(a, b + 1));
    } catch (_) {}
  }

  // Main V7 format:
  // THICKNESS=...|WIDTH=...|INNER=...|PAPER=...|RING=...|CORE=...|TAPE=...|FNO=...
  const out = {};
  const map = {
    THICKNESS: "thickness",
    WIDTH: "width",
    INNER: "inner",
    PAPER: "paper",
    RING: "ring",
    CORE: "core",
    TAPE: "tape",
    FNO: "fno",
  };

  for (const part of cleaned.split(/\s*\|\s*/)) {
    const m = part.match(/^\s*(THICKNESS|WIDTH|INNER|PAPER|RING|CORE|TAPE|FNO)\s*[:=]\s*(.*?)\s*$/i);
    if (m) out[map[m[1].toUpperCase()]] = cleanValue(m[2]);
  }

  if (Object.keys(out).length) return out;
  throw new Error("AI output could not be parsed: " + raw.slice(0, 500));
}

function normalize(o = {}) {
  const keys = ["thickness","width","inner","paper","ring","core","tape","fno"];
  const r = Object.fromEntries(keys.map(k => [k, cleanValue(o[k])]));

  // Keep only safe/known choices for select fields.
  if (!["300","400","500"].includes(r.inner)) r.inner = "";
  if (!["あり","なし"].includes(r.paper)) r.paper = "";
  if (!["P","T","なし"].includes(r.ring)) r.ring = "";
  if (!["普通紙管","高強度紙管","鉄リング","なし"].includes(r.core)) r.core = "";
  if (!["SPE","SPV","SPH","なし"].includes(r.tape)) r.tape = "";

  // Numeric fields: remove obvious labels/spaces but never invent digits.
  r.thickness = (r.thickness.match(/[0-9]+(?:\.[0-9]+)?/) || [""])[0];
  r.width = (r.width.match(/[0-9]+(?:\.[0-9]+)?/) || [""])[0];

  return r;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    // Keep the agreement route available.
    if (request.method === "GET" && url.searchParams.get("agree") === "1") {
      try {
        const result = await env.AI.run(MODEL, { prompt: "agree" });
        return respond({
          ok: true,
          message: "Meta Llama 3.2 Vision agreement request completed.",
          result
        });
      } catch (e) {
        const msg = String(e?.message || e);
        if (/thank you for agreeing|may now use the model/i.test(msg)) {
          return respond({ ok: true, message: msg });
        }
        return respond({ ok: false, error: msg }, 500);
      }
    }

    if (request.method !== "POST") return respond({ error: "POST only" }, 405);

    try {
      const body = await request.json();
      if (typeof body.image !== "string" || !body.image.startsWith("data:image/")) {
        return respond({ error: "Image data is missing" }, 400);
      }

      const system = `You are a strict OCR/data-extraction engine for a Japanese stainless-steel coil work slip.
Read ONLY the supplied image.
Do not explain, chat, translate, summarize, or add commentary.
Never guess an unreadable value. Use a blank value after = when uncertain.
Your entire answer must be EXACTLY ONE LINE in this format:
THICKNESS=|WIDTH=|INNER=|PAPER=|RING=|CORE=|TAPE=|FNO=
Do not use markdown. Do not add any other text.`;

      const user = `Extract these fields from the whole slip, including small printed notes near P/T.

Rules:
- THICKNESS: product thickness exactly printed; number only.
- WIDTH: product width exactly printed; number only. NEVER add a leading digit. If it says 72, return 72, not 172.
- INNER: only 300, 400, or 500.
- PAPER: paper/interleaf column × means なし; numeric entry means あり.
- RING: P means P; T means T; clearly neither means なし.
- CORE: P plus コウキョウドシカン or 高強度紙管 means 高強度紙管; P otherwise means 普通紙管; T means 鉄リング; clearly none means なし.
- TAPE: explicit SPV means SPV; explicit SPH means SPH; finish containing E such as 2E99 or E6B means SPE; clearly none means なし.
- FNO: F-No/Fno exactly visible, for example 18-441-50.
- If any field is unreadable or uncertain, leave only that value blank.
Return exactly the required one-line format.`;

      // Cloudflare's documented vision pattern: messages + image data URL.
      const result = await env.AI.run(MODEL, {
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        image: body.image,
        max_tokens: 220,
        temperature: 0,
      });

      const raw = typeof result?.response === "string"
        ? result.response
        : (typeof result === "string" ? result : JSON.stringify(result));

      const parsed = normalize(parseFields(raw));
      return respond(parsed);

    } catch (e) {
      const msg = String(e?.message || e);
      return respond({
        error: "AI_READ_FAILED",
        details: msg
      }, 500);
    }
  }
};
