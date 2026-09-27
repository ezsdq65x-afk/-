const MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const ALLOWED_ORIGIN = "https://ezsdq65x-afk.github.io";

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function respond(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

function parseJson(text) {
  const cleaned = String(text || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("AI did not return JSON");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function normalize(o = {}) {
  const keys = ["thickness","width","inner","paper","ring","core","tape","fno"];
  const r = Object.fromEntries(keys.map(k => [k, o[k] == null ? "" : String(o[k]).trim()]));

  if (!["300","400","500"].includes(r.inner)) r.inner = "";
  if (!["あり","なし"].includes(r.paper)) r.paper = "";
  if (!["P","T","なし"].includes(r.ring)) r.ring = "";
  if (!["普通紙管","高強度紙管","鉄リング","なし"].includes(r.core)) r.core = "";
  if (!["SPE","SPV","SPH","なし"].includes(r.tape)) r.tape = "";
  return r;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") return respond({ error: "POST only" }, 405);

    try {
      const body = await request.json();
      if (typeof body.image !== "string" || !body.image.startsWith("data:image/")) {
        return respond({ error: "Image data is missing" }, 400);
      }

      const prompt = `Read this Japanese stainless-steel coil work slip.
Return ONLY this JSON object:
{"thickness":"","width":"","inner":"","paper":"","ring":"","core":"","tape":"","fno":""}

Rules:
- Never guess. If unreadable or uncertain, use "".
- thickness: product thickness exactly printed, number only.
- width: product width exactly printed, number only. NEVER add a leading digit. If it says 72, return "72", not "172".
- inner: only "300", "400", or "500".
- paper/interleaf column: × => "なし"; numeric entry => "あり".
- ring: P => "P"; T => "T"; clearly neither => "なし".
- core: P plus コウキョウドシカン or 高強度紙管 => "高強度紙管"; P otherwise => "普通紙管"; T => "鉄リング"; clearly none => "なし".
- tape: explicit SPV => "SPV"; explicit SPH => "SPH"; finish containing E such as 2E99 or E6B => "SPE"; clearly none => "なし".
- fno: F-No/Fno exactly visible, e.g. 18-441-50.
- Read the whole slip including small printed notes near P/T.
- JSON only. No markdown.`;

      const result = await env.AI.run(MODEL, {
        prompt,
        image: body.image,
        max_tokens: 350,
        temperature: 0,
      });

      return respond(normalize(parseJson(result?.response || result)));
    } catch (e) {
      const msg = String(e?.message || e);
      return respond({
        error: "AI_READ_FAILED",
        details: msg,
        hint: /license|agree|5016/i.test(msg)
          ? "META_LICENSE_AGREEMENT_REQUIRED"
          : ""
      }, 500);
    }
  }
};
