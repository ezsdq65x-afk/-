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
function clean(v) {
  v = String(v ?? "").trim();
  return /^(?:-|—|―|不明|unknown|null|n\/a)$/i.test(v) ? "" : v;
}
function normalize(o = {}) {
  const r = {
    row: Number(o.row) || 0,
    thickness: clean(o.thickness),
    width: clean(o.width),
    inner: clean(o.inner),
    paper: clean(o.paper),
    ring: clean(o.ring),
    core: clean(o.core),
    tape: clean(o.tape),
    fno: clean(o.fno)
  };
  if (!["300","400","500"].includes(r.inner)) r.inner="";
  if (!["あり","なし"].includes(r.paper)) r.paper="";
  if (!["P","T","なし"].includes(r.ring)) r.ring="";
  if (r.core === "高強度紙管") r.core = "硬強度";
  if (!["普通紙管","硬強度","鉄リング","なし"].includes(r.core)) r.core="";
  if (!["SPE","SPV","SPH","なし"].includes(r.tape)) r.tape="";
  r.thickness=(r.thickness.match(/[0-9]+(?:\.[0-9]+)?/)||[""])[0];
  r.width=(r.width.match(/[0-9]+(?:\.[0-9]+)?/)||[""])[0];
  return r;
}
function parseRows(text, wantedRows) {
  const raw=String(text??"").replace(/```/g,"").trim();
  const out=[];
  for (const line of raw.split(/\r?\n/)) {
    const obj={};
    for (const part of line.split(/\s*\|\s*/)) {
      const m=part.match(/^\s*(ROW|THICKNESS|WIDTH|INNER|PAPER|RING|CORE|TAPE|FNO)\s*[:=]\s*(.*?)\s*$/i);
      if(m) obj[m[1].toLowerCase()]=clean(m[2]);
    }
    if(obj.row) out.push(normalize(obj));
  }
  if(!out.length) throw new Error("AI output could not be parsed: "+raw.slice(0,600));
  return wantedRows.map(n => out.find(x=>x.row===n) || normalize({row:n}));
}
export default {
  async fetch(request, env) {
    if(request.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
    const url=new URL(request.url);
    if(request.method==="GET" && url.searchParams.get("agree")==="1"){
      try{
        const result=await env.AI.run(MODEL,{prompt:"agree"});
        return respond({ok:true,message:"Agreement request completed.",result});
      }catch(e){
        const msg=String(e?.message||e);
        if(/thank you for agreeing|may now use the model/i.test(msg)) return respond({ok:true,message:msg});
        return respond({ok:false,error:msg},500);
      }
    }
    if(request.method!=="POST") return respond({error:"POST only"},405);
    try{
      const body=await request.json();
      if(typeof body.image!=="string" || !body.image.startsWith("data:image/"))
        return respond({error:"Image data is missing"},400);

      let rows=Array.isArray(body.rows) ? body.rows.map(Number).filter(n=>n>=1&&n<=5) : [1];
      rows=[...new Set(rows)].slice(0,2);
      if(!rows.length) rows=[1];

      const requested=rows.join(",");
      const system=`You are a strict OCR/data-extraction engine for a Japanese stainless-steel coil work slip.
Read ONLY the supplied image. Never guess.
The user specifies detail rows by counting FROM THE BOTTOM of the product-detail table:
bottom product/detail row = 1, the row immediately above it = 2, then 3, 4, 5.
Do NOT count headers, totals, blank rows, footnotes, or explanatory text as product/detail rows.
Extract ONLY the requested row numbers.

CRITICAL COLUMN RULES:
- THICKNESS and WIDTH belong to the product SIZE/specification cells of the SAME requested row. Treat them as a pair.
- WIDTH is NOT the inner diameter. Never copy a value from the INNER/内径 column into WIDTH.
- INNER is a separate field/column and can only be 300, 400, or 500.
- A number 300/400/500 seen in the INNER/内径 area is evidence for INNER only, never evidence for WIDTH.
- Before returning WIDTH, visually confirm it is in the width/size area aligned with that row's THICKNESS. If you cannot independently see the width there, leave WIDTH blank.
- If WIDTH and INNER happen to be the same number, return both only when you can clearly see that same number independently in BOTH separate cells/areas. Otherwise leave WIDTH blank rather than copying INNER.
- Keep every row-specific value horizontally aligned to the SAME requested product row.

For every requested row output exactly ONE line, and no other text:
ROW=n|THICKNESS=|WIDTH=|INNER=|PAPER=|RING=|CORE=|TAPE=|FNO=
If a value is unreadable or uncertain, leave that value blank.`;
      const user=`Requested rows from the bottom: ${requested}
For EACH requested row:
- THICKNESS: product thickness from the size/specification area for that row; number only.
- WIDTH: product width from the width/size area for that SAME row; number only. It is normally associated with the thickness in the product size specification. DO NOT use the 300/400/500 value from the separate inner-diameter field. Never add a leading digit.
- INNER: read only from the inner-diameter/内径 field; only 300, 400, or 500.
- PAPER: × in the paper/interleaf column => なし; numeric entry => あり.
- RING: P => P; T => T; clearly neither => なし.
- CORE: P plus コウキョウドシカン or 高強度紙管 => 硬強度; P otherwise => 普通紙管; T => 鉄リング; clearly none => なし.
- TAPE: explicit SPV => SPV; explicit SPH => SPH; finish containing E such as 2E99 or E6B => SPE; clearly none => なし.
- FNO: read only the value immediately associated with the slip's F-No/Fno label. Never use SPV, SPH, SPE, finish text, or another column as FNO.
Final self-check before answering: WIDTH came from the product width/size cell, while INNER came from the separate inner-diameter cell. If that distinction is not visually certain, leave the uncertain field blank.`;
      const result=await env.AI.run(MODEL,{
        messages:[
          {role:"system",content:system},
          {role:"user",content:user}
        ],
        image:body.image,
        max_tokens:320,
        temperature:0
      });
      const raw=typeof result?.response==="string" ? result.response :
                (typeof result==="string" ? result : JSON.stringify(result));
      return respond({rows:parseRows(raw,rows)});
    }catch(e){
      return respond({error:"AI_READ_FAILED",details:String(e?.message||e)},500);
    }
  }
};
