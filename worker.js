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
function numberOnly(v){
  return (clean(v).match(/[0-9]+(?:\.[0-9]+)?/)||[""])[0];
}
function splitSize(size){
  const s=clean(size).replace(/[×✕＊*]/g,"x");
  const m=s.match(/([0-9]+(?:\.[0-9]+)?)\s*[xX]\s*([0-9]+(?:\.[0-9]+)?)/);
  if(!m) return {thickness:"",width:""};
  let thickness=m[1], width=m[2];
  const t=Number(thickness), w=Number(width);
  // Stainless strip thickness is the small value and width is the large value.
  // Do not silently reverse an invalid pair; leave it blank for manual confirmation.
  if(!(t>0 && t<10 && w>=10)) return {thickness:"",width:""};
  // Width on this slip is nominally an integer. Correct tiny vision/OCR drift only.
  const nearest=Math.round(w);
  if(Math.abs(w-nearest)<=0.25) width=String(nearest);
  return {thickness,width};
}
function normalize(o = {}) {
  const sz=splitSize(o.size);
  const r = {
    row: Number(o.row) || 0,
    thickness: sz.thickness || numberOnly(o.thickness),
    width: sz.width || numberOnly(o.width),
    inner: clean(o.inner),
    paper: clean(o.paper),
    ring: clean(o.ring),
    core: clean(o.core),
    tape: clean(o.tape),
    fno: clean(o.fno)
  };
  // Guard against the exact V9 failure: a width-like number must never appear as thickness.
  if(Number(r.thickness)>=10){
    if(!r.width){
      const n=Number(r.thickness), nearest=Math.round(n);
      r.width=(Math.abs(n-nearest)<=0.25)?String(nearest):r.thickness;
    }
    r.thickness="";
  }
  if (!['300','400','500'].includes(r.inner)) r.inner="";
  if (!['あり','なし'].includes(r.paper)) r.paper="";
  if (!['P','T','なし'].includes(r.ring)) r.ring="";
  if (r.core === '高強度紙管') r.core = '硬強度';
  if (!['普通紙管','硬強度','鉄リング','なし'].includes(r.core)) r.core="";
  if (!['SPE','SPV','SPH','なし'].includes(r.tape)) r.tape="";
  return r;
}
function parseRows(text, wantedRows) {
  const raw=String(text??"").replace(/```/g,"").trim();
  const out=[];
  for (const line of raw.split(/\r?\n/)) {
    const obj={};
    for (const part of line.split(/\s*\|\s*/)) {
      const m=part.match(/^\s*(ROW|SIZE|THICKNESS|WIDTH|INNER|PAPER|RING|CORE|TAPE|FNO)\s*[:=]\s*(.*?)\s*$/i);
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
The requested product rows are counted FROM THE BOTTOM of the product-detail table: bottom row=1, row above=2, then 3,4,5. Do not count headers, totals, blank rows, or notes.

MOST IMPORTANT SIZE RULE:
The product size is printed as one expression: THICKNESS × WIDTH.
Example: "0.5 × 303" means thickness=0.5 and width=303.
You MUST read this entire expression as ONE SIZE string before separating anything.
The value BEFORE/LEFT of × is THICKNESS. The value AFTER/RIGHT of × is WIDTH.
Never put the value after × into thickness.
Never use INNER/内径 (300/400/500) as width.
If the photo is rotated, LEFT/RIGHT means logical order in the printed size expression, not screen direction.
For this slip, a valid thickness is a small decimal value below 10, while width is the larger value after ×. If you think THICKNESS is 190, 303, 500, etc., you have read the wrong side/column: re-check the size expression.

Return exactly ONE line per requested row and no other text:
ROW=n|SIZE=thicknessxwidth|INNER=|PAPER=|RING=|CORE=|TAPE=|FNO=
Example format only: ROW=1|SIZE=0.5x303|INNER=500|PAPER=なし|RING=P|CORE=硬強度|TAPE=SPE|FNO=18-441-50
If SIZE cannot be read as a complete thickness×width pair, leave SIZE blank. Do not output a partial pair.`;

      const user=`Requested rows from the bottom: ${requested}
For EACH requested row, first locate that exact row, then:
1. SIZE: transcribe the complete product size expression in its printed order, e.g. 0.5x303. Read BOTH sides of the × from the SAME row. Do not round or swap them.
2. INNER: only from the separate 内径 field; only 300, 400, or 500.
3. PAPER: × in paper/interleaf column => なし; numeric entry => あり.
4. RING: P => P; T => T; clearly neither => なし.
5. CORE: P plus コウキョウドシカン/高強度紙管 => 硬強度; P otherwise => 普通紙管; T => 鉄リング; clearly none => なし.
6. TAPE: explicit SPV => SPV; explicit SPH => SPH; finish containing E such as 2E99 or E6B => SPE; clearly none => なし.
7. FNO: only the value next to F-No/Fno. Never use SPV/SPH/SPE or finish text as FNO.

Final check: every SIZE must look like a small thickness before x and a larger width after x. If not, re-read that row or leave SIZE blank.`;

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
