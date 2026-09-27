export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "https://ezsdq65x-afk.github.io",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ message: "tare-slip-ai is ready" }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    try {
      const { image } = await request.json();
      if (!image) throw new Error("画像がありません");

      const prompt = `日本の工場で使用する伝票を読み取り、JSONだけを返してください。推測は禁止。読めない項目は空文字にしてください。
形式:
{"thickness":"","width":"","inner":"","paper":"","ring":"","core":"","tape":"","fno":""}
ルール:
厚みは製品厚み。
幅は見た数字をそのまま読み、72を172にしない。
内径は300/400/500。
紙欄が×ならpaper=なし、数字ならpaper=あり。
Pならring=P。Tならring=T。
Pでコウキョウドシカンまたは高強度紙管ならcore=硬強度。
Pでその記載がなければcore=普通紙管。
Tならcore=鉄リング。
仕上げにEを含む場合（例2E99）はtape=SPE。
SPVならSPV、SPHならSPH。
F-Noが読めればfnoへ。
不明な値を勝手に補完しない。`;

      const result = await env.AI.run(
        "@cf/meta/llama-3.2-11b-vision-instruct",
        { prompt, image, max_tokens: 700 }
      );

      let text = (result.response || "")
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

      const a = text.indexOf("{");
      const b = text.lastIndexOf("}");
      if (a < 0 || b < 0) {
        throw new Error("AIの回答をJSONに変換できませんでした");
      }

      const data = JSON.parse(text.slice(a, b + 1));

      return new Response(JSON.stringify(data), {
        headers: { ...cors, "Content-Type": "application/json" }
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }
  }
};
