/**
 * GRVMAX API / Cloudflare Worker.
 * Endpoint dedicado; a interface roda no GitHub Pages (sem iframe).
 * Configure GRVMAX_SCRIPT_URL como secret/var do Worker, sem publicar senhas.
 */
const ORIGINS = new Set(["https://consultoriarf.net", "https://www.consultoriarf.net"]);
const ACTIONS = new Set(["bootstrap","setup","login","forgot","setPassword","state","save","approve","sendEmail","invite","reminders","installReminders","goDecision","logout"]);
function responseJson(value,status,origin) {
  const headers = {
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff",
    "Vary":"Origin"
  };
  if(origin && ORIGINS.has(origin)){
    headers["Access-Control-Allow-Origin"]=origin;
    headers["Access-Control-Allow-Methods"]="POST, OPTIONS";
    headers["Access-Control-Allow-Headers"]="Content-Type";
    headers["Access-Control-Max-Age"]="600";
  }
  return new Response(JSON.stringify(value),{status,headers});
}
export default {
  async fetch(request,env){
    const origin=request.headers.get("Origin")||"";
    const url=new URL(request.url);
    if(origin && !ORIGINS.has(origin)) return responseJson({ok:false,error:"Origem não autorizada."},403,"");
    if(request.method==="OPTIONS"){
      if(!origin) return responseJson({ok:false,error:"Origem obrigatória."},403,"");
      const headers=new Headers(responseJson({},200,origin).headers);
      headers.delete("Content-Type");
      return new Response(null,{status:204,headers});
    }
    if(request.method==="GET" && url.pathname==="/health")
      return responseJson({ok:true,service:"columbia-grvmax-api",configured:!!env.GRVMAX_SCRIPT_URL},200,origin);
    if(request.method!=="POST" || (url.pathname!=="/" && url.pathname!=="/api"))
      return responseJson({ok:false,error:"Rota não encontrada."},404,origin);
    if(!env.GRVMAX_SCRIPT_URL || !/^https:\/\/script\.google\.com\/macros\/s\/[^/?#]+\/exec$/.test(env.GRVMAX_SCRIPT_URL))
      return responseJson({ok:false,error:"API ainda não configurada no servidor."},503,origin);
    const length=Number(request.headers.get("Content-Length")||0);
    if(length>150000) return responseJson({ok:false,error:"Requisição muito grande."},413,origin);
    let body;
    try{
      const raw=await request.text();
      if(raw.length>150000) throw Error("Requisição muito grande.");
      body=JSON.parse(raw);
    }catch(err){return responseJson({ok:false,error:"JSON inválido ou muito grande."},400,origin);}
    if(!body || !ACTIONS.has(body.action) || !body.payload || typeof body.payload!=="object" || Array.isArray(body.payload) || (body.token && (typeof body.token!=="string"||body.token.length>512)))
      return responseJson({ok:false,error:"Chamada inválida."},400,origin);
    try{
      const res=await fetch(env.GRVMAX_SCRIPT_URL,{
        method:"POST",
        headers:{"Content-Type":"text/plain; charset=utf-8"},
        body:JSON.stringify({action:body.action,payload:body.payload,token:body.token||""}),
        redirect:"follow",
        signal:AbortSignal.timeout(60000)
      });
      const content=await res.text();
      if(!res.ok) return responseJson({ok:false,error:"Google Apps Script indisponível (HTTP "+res.status+")."},502,origin);
      if(content.length>3000000) return responseJson({ok:false,error:"Resposta excedeu o tamanho permitido."},502,origin);
      let result;
      try{result=JSON.parse(content);}catch(e){return responseJson({ok:false,error:"Backend ainda não publicado ou resposta inválida."},502,origin);}
      if(!result || typeof result!=="object" || typeof result.ok!=="boolean")
        return responseJson({ok:false,error:"Formato de resposta do backend inválido."},502,origin);
      return responseJson(result,200,origin);
    }catch(err){return responseJson({ok:false,error:"Falha de comunicação com a API. Tente novamente."},502,origin);}
  }
};
