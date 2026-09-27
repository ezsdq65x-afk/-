const MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const ALLOWED_ORIGIN = "https://ezsdq65x-afk.github.io";

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type",
};
function respond(data, status = 200) {
  return new Response(JSON.stringify(data), {status, headers:{...cors,"Content-Type":"application/json; charset=utf-8"}});
}
function clean(v){
  v=String(v??"").trim();
  return /^(?:-|—|―|不明|unknown|null|n\/a)$/i.test(v)?"":v;
}
function numberOnly(v){ return (clean(v).match(/[0-9]+(?:\.[0-9]+)?/)||[""])[0]; }
function splitSize(size){
  const s=clean(size).replace(/[×✕＊*]/g,"x");
  const m=s.match(/([0-9]+(?:\.[0-9]+)?)\s*[xX]\s*([0-9]+(?:\.[0-9]+)?)/);
  if(!m) return {thickness:"",width:""};
  let thickness=m[1], width=m[2];
  const t=Number(thickness), w=Number(width);
  if(!(t>0 && t<10 && w>=10)) return {thickness:"",width:""};
  const nearest=Math.round(w);
  if(Math.abs(w-nearest)<=0.25) width=String(nearest);
  return {thickness,width};
}
function normalizeFno(v){
  const s=clean(v).replace(/[‐‑‒–—―ー]/g,"-").replace(/\s+/g,"");
  const m=s.match(/(?:^|\D)(\d{2})-(\d{3})-(\d{2})(?:\D|$)/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}
function paperFromMark(v){
  const s=clean(v);
  if(!s) return "";
  if(/[×✕xX]/.test(s) || /なし/.test(s)) return "なし";
  if(/\d/.test(s) || /あり/.test(s)) return "あり";
  return "";
}
function ringFromMark(v){
  const s=clean(v).toUpperCase();
  if(!s) return "";
  if(/(^|[^A-Z])P([^A-Z]|$)/.test(s) || s==="P") return "P";
  if(/(^|[^A-Z])T([^A-Z]|$)/.test(s) || s==="T") return "T";
  if(/[×✕]/.test(s) || /なし/.test(s)) return "なし";
  return "";
}
function tapeFromFinish(v){
  const s=clean(v).toUpperCase().replace(/\s+/g,"");
  if(!s) return "";
  if(s.includes("SPV")) return "SPV";
  if(s.includes("SPH")) return "SPH";
  if(s.includes("SPE")) return "SPE";
  // User rule: an E in the finish code (e.g. 2E99 / E6B) means SPE.
  if(/[A-Z0-9]*E[A-Z0-9]*/.test(s)) return "SPE";
  if(/[×✕]/.test(s) || /なし/.test(s)) return "なし";
  return "";
}
function coreFrom(ring,note){
  if(ring==="T") return "鉄リング";
  if(ring==="なし") return "なし";
  if(ring!=="P") return "";
  const s=clean(note);
  if(/高強度|硬強度|コウキョウド|ｺｳｷｮｳﾄﾞ/.test(s)) return "硬強度";
  return "普通紙管";
}
function normalize(o={}){
  const sz=splitSize(o.size);
  let thickness=sz.thickness || numberOnly(o.thickness);
  let width=sz.width || numberOnly(o.width);
  if(Number(thickness)>=10){ if(!width) width=thickness; thickness=""; }
  if(width){ const n=Number(width), near=Math.round(n); if(Math.abs(n-near)<=0.25) width=String(near); }
  let inner=clean(o.inner); if(!['300','400','500'].includes(inner)) inner="";
  const paper=paperFromMark(o.paper_mark || o.paper);
  const ring=ringFromMark(o.ring_mark || o.ring);
  const core=coreFrom(ring,o.core_note || o.core);
  const tape=tapeFromFinish(o.finish || o.tape);
  const fno=normalizeFno(o.fno);
  return {row:Number(o.row)||0, thickness, width, inner, paper, ring, core, tape, fno};
}
function parseRows(text,wantedRows){
  const raw=String(text??"").replace(/```/g,"").trim();
  const out=[];
  for(const line of raw.split(/\r?\n/)){
    const obj={};
    for(const part of line.split(/\s*\|\s*/)){
      const m=part.match(/^\s*(ROW|SIZE|THICKNESS|WIDTH|INNER|PAPER_MARK|PAPER|RING_MARK|RING|CORE_NOTE|CORE|FINISH|TAPE|FNO)\s*[:=]\s*(.*?)\s*$/i);
      if(m) obj[m[1].toLowerCase()]=clean(m[2]);
    }
    if(obj.row) out.push(normalize(obj));
  }
  if(!out.length) throw new Error("AI output could not be parsed: "+raw.slice(0,600));
  return wantedRows.map(n=>out.find(x=>x.row===n)||normalize({row:n}));
}
export default {
  async fetch(request,env){
    if(request.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
    const url=new URL(request.url);
    if(request.method==="GET" && url.searchParams.get("agree")==="1"){
      try{ const result=await env.AI.run(MODEL,{prompt:"agree"}); return respond({ok:true,message:"Agreement request completed.",result}); }
      catch(e){ const msg=String(e?.message||e); if(/thank you for agreeing|may now use the model/i.test(msg)) return respond({ok:true,message:msg}); return respond({ok:false,error:msg},500); }
    }
    if(request.method!=="POST") return respond({error:"POST only"},405);
    try{
      const body=await request.json();
      if(typeof body.image!=="string" || !body.image.startsWith("data:image/")) return respond({error:"Image data is missing"},400);
      let rows=Array.isArray(body.rows)?body.rows.map(Number).filter(n=>n>=1&&n<=5):[1];
      rows=[...new Set(rows)].slice(0,2); if(!rows.length) rows=[1];
      const requested=rows.join(",");

      const system=`You are a strict visual transcription engine for one fixed Japanese stainless-steel coil work slip.
Read ONLY the supplied image. Never guess. If uncertain, leave the value blank.

ROW LOCATION:
Product rows are counted FROM THE BOTTOM of the product-detail table: bottom product row=1, row immediately above=2, then 3,4,5.
Do not count headers, blank rows, notes, totals, or the FNo/header area as product rows.
After locating a requested row, TRACE THAT SAME PHYSICAL GRID ROW across the table. Never borrow a mark from the row above or below.

SIZE:
The size is printed as THICKNESS × WIDTH in one cell/expression. Transcribe the whole pair from the SAME row.
Example 0.5 × 303 => SIZE=0.5x303. Before × is thickness; after × is width. INNER 300/400/500 is a separate column and is never width.

RAW MARKS — TRANSCRIBE, DO NOT INTERPRET:
PAPER_MARK = only the exact mark/value in the interleaf-paper column on that same row (often × or a number).
RING_MARK = only the exact P, T, or × mark in the ring/paper-core column on that same row.
CORE_NOTE = only nearby printed note belonging to that same row/core, such as コウキョウドシカン / 高強度紙管.
FINISH = the finish/tape code belonging to that same product row. Preserve codes such as 2E99, E6B, SPV, SPH.

FNO IS NOT A ROW CELL:
FNo is the single shared slip/order number printed in the F-No/FNo header area. Read that header value once and repeat the SAME FNO for every requested row.
A valid FNo has the form two digits-three digits-two digits, e.g. 18-441-50 or 60-407-51.
Never use a coil number, barcode digits, finish code, SPV/SPH/SPE, or another five-digit number as FNO.
If you cannot clearly read a value in the F-No header area in that exact pattern, leave FNO blank.

Return exactly ONE line per requested row and no other text:
ROW=n|SIZE=|INNER=|PAPER_MARK=|RING_MARK=|CORE_NOTE=|FINISH=|FNO=`;

      const user=`Requested rows from the bottom: ${requested}
For each requested row do this in order:
1) Locate the exact product row by counting from the bottom.
2) Read SIZE from that row as the complete thickness x width pair.
3) Staying on that exact horizontal grid row, read INNER, PAPER_MARK, RING_MARK, CORE_NOTE and FINISH separately. Do not shift vertically into a neighboring row.
4) Separately inspect the slip's F-No/FNo HEADER area, read the one shared FNo, and repeat that same FNo on every output line.
5) Final visual check: compare the two requested rows. Their row-specific marks may differ, but FNO must be identical because it comes from the shared header.`;

      const result=await env.AI.run(MODEL,{messages:[{role:"system",content:system},{role:"user",content:user}],image:body.image,max_tokens:380,temperature:0});
      const raw=typeof result?.response==="string"?result.response:(typeof result==="string"?result:JSON.stringify(result));
      return respond({rows:parseRows(raw,rows)});
    }catch(e){ return respond({error:"AI_READ_FAILED",details:String(e?.message||e)},500); }
  }
};
