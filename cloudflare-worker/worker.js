const corsHeaders = {
  "Access-Control-Allow-Origin": "https://tahi-mirusen.github.io",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Vary": "Origin"
};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json",...corsHeaders}});
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
async function gh(env,path,opts={}) {
  const r=await fetch("https://api.github.com"+path,{...opts,headers:{
    "Accept":"application/vnd.github+json","Authorization":"Bearer "+opts.token,
    "X-GitHub-Api-Version":"2022-11-28","User-Agent":"Tahi-Admin-Portal",
    ...(opts.body?{"Content-Type":"application/json"}:{})
  }});
  const body=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(body.message||"GitHub API error "+r.status);
  return body;
}
async function session(env,req){
  const h=req.headers.get("Authorization")||"";
  const token=h.startsWith("Bearer ")?h.slice(7):"";
  if(!token) return null;
  const raw=await env.SESSIONS.get("session:"+token);
  if(!raw) return null;
  const s=JSON.parse(raw);
  if(s.expires<Date.now()){await env.SESSIONS.delete("session:"+token);return null;}
  return s;
}
async function admin(env,req){
  const s=await session(env,req);
  if(!s) throw new Response(JSON.stringify({error:"ログインが必要です"}),{status:401,headers:{"Content-Type":"application/json",...corsHeaders}});
  return s;
}
export default {
 async fetch(req,env){
  if(req.method==="OPTIONS") return new Response(null,{headers:corsHeaders});
  const u=new URL(req.url),p=u.pathname;
  try{
   if(p==="/auth/start"&&req.method==="GET"){
    const state=randomToken();await env.SESSIONS.put("state:"+state,"1",{expirationTtl:600});
    const redirect=env.GITHUB_CALLBACK_URL;
    const url=new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id",env.GITHUB_CLIENT_ID);
    url.searchParams.set("redirect_uri",redirect);
    url.searchParams.set("scope","public_repo read:user");
    url.searchParams.set("state",state);
    return json({url:url.toString()});
   }
   if(p==="/auth/callback"&&req.method==="GET"){
    const code=u.searchParams.get("code"),state=u.searchParams.get("state");
    if(!code||!state||!await env.SESSIONS.get("state:"+state)) return new Response("Invalid OAuth state",{status:400});
    await env.SESSIONS.delete("state:"+state);
    const tokenRes=await fetch("https://github.com/login/oauth/access_token",{method:"POST",headers:{"Accept":"application/json","Content-Type":"application/json"},body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code})});
    const tokenData=await tokenRes.json();
    if(!tokenData.access_token) return new Response("GitHub OAuth failed",{status:401});
    const ghUser=await gh(env,"/user",{token:tokenData.access_token});
    const allowed=(env.ALLOWED_GITHUB_LOGINS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
    if(!allowed.includes(String(ghUser.login).toLowerCase())) return new Response("管理者として許可されていません。",{status:403});
    const oneTime=randomToken();
    await env.SESSIONS.put("exchange:"+oneTime,JSON.stringify({token:tokenData.access_token,user:{login:ghUser.login,id:ghUser.id}}),{expirationTtl:90});
    return Response.redirect("https://tahi-mirusen.github.io/admin/?code="+oneTime,302);
   }
   if(p==="/auth/exchange"&&req.method==="POST"){
    const b=await req.json(),key="exchange:"+String(b.code||"");
    const raw=await env.SESSIONS.get(key);if(!raw)return json({error:"認証コードの期限切れです。再ログインしてください。"},401);
    await env.SESSIONS.delete(key);
    const payload=JSON.parse(raw),id=randomToken();
    await env.SESSIONS.put("session:"+id,JSON.stringify({...payload,expires:Date.now()+8*60*60*1000}),{expirationTtl:28800});
    return json({token:id});
   }
   if(p==="/api/analytics/event"&&req.method==="POST"){
    const b=await req.json().catch(()=>({}));const path=String(b.path||"/").slice(0,180);
    const date=new Date().toISOString().slice(0,10);const key="pv:"+date;
    const raw=await env.SESSIONS.get(key);const stats=raw?JSON.parse(raw):{count:0,pages:{}};
    stats.count++;stats.pages[path]=(stats.pages[path]||0)+1;
    await env.SESSIONS.put(key,JSON.stringify(stats),{expirationTtl:60*60*24*400});
    return json({ok:true});
   }
   if(p==="/auth/logout"&&req.method==="POST"){
    const bearer=(req.headers.get("Authorization")||"").replace(/^Bearer /,"");
    if(bearer) await env.SESSIONS.delete("session:"+bearer);
    return json({ok:true});
   }
   if(p.startsWith("/api/")){
    const s=await admin(env,req);
    if(p==="/api/me") return json({user:s.user});
    if(p==="/api/site-data"&&req.method==="GET"){
      const path=`/repos/${env.REPO_OWNER}/${env.REPO_NAME}/contents/site-data.json?ref=${env.REPO_BRANCH||"main"}`;
      const file=await gh(env,path,{token:s.token});
      const decoded=atob(file.content.replace(/\n/g,""));
      const bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));
      return json({data:JSON.parse(new TextDecoder().decode(bytes)),sha:file.sha});
    }
    if(p==="/api/site-data"&&req.method==="PUT"){
      const b=await req.json();if(!b.data||!Array.isArray(b.data.works)||!Array.isArray(b.data.posts))return json({error:"データ形式が正しくありません"},400);
      const path=`/repos/${env.REPO_OWNER}/${env.REPO_NAME}/contents/site-data.json`;
      let current=null;try{current=await gh(env,path+"?ref="+(env.REPO_BRANCH||"main"),{token:s.token});}catch{}
      const content=btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(b.data,null,2))));
      const result=await gh(env,path,{token:s.token,method:"PUT",body:JSON.stringify({message:"サイトデータを管理画面から更新",content,branch:env.REPO_BRANCH||"main",...(current?.sha?{sha:current.sha}:{})})});
      return json({ok:true,sha:result.content?.sha});
    }
    if(p==="/api/analytics/summary"&&req.method==="GET"){
      const now=new Date(),days=[];let total=0,week=0,today=0;
      for(let i=0;i<30;i++){const d=new Date(now);d.setUTCDate(d.getUTCDate()-i);const date=d.toISOString().slice(0,10);const raw=await env.SESSIONS.get("pv:"+date);const count=raw?JSON.parse(raw).count:0;days.unshift({date,count});total+=count;if(i<7)week+=count;if(i===0)today=count;}
      return json({today,week,total,days});
    }
    return json({error:"Not found"},404);
   }
   return json({error:"Not found"},404);
  }catch(e){if(e instanceof Response)return e;return json({error:e.message||"Internal error"},500);}
 }
};
