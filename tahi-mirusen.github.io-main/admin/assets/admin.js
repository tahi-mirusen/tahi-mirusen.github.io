(() => {
const $=id=>document.getElementById(id);
const API=(window.ADMIN_API_URL||"").replace(/\/$/,"");
let sessionToken=null, siteData=null, user=null;
const views=["dashboard","content","analytics","settings"];
function msg(id,text){$(id).textContent=text||""}
async function api(path,opts={}) {
  if(!API) throw new Error("管理APIのURLが未設定です。READMEの設定手順を先に実施してください。");
  const headers={"Content-Type":"application/json",...(opts.headers||{})};
  if(sessionToken) headers.Authorization="Bearer "+sessionToken;
  const r=await fetch(API+path,{...opts,headers});
  const j=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(j.error||("APIエラー "+r.status));
  return j;
}
function showView(name){
  views.forEach(v=>$(v).hidden=v!==name);
  document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
  $("page-title").textContent=({dashboard:"ダッシュボード",content:"コンテンツ管理",analytics:"アクセス解析",settings:"設定・バックアップ"})[name]||"管理";
}
function validData(v){
  if(!v||typeof v!=="object"||Array.isArray(v)||!Array.isArray(v.works)||!Array.isArray(v.posts)) throw new Error("JSON形式が正しくありません。works と posts は配列である必要があります。");
  return v;
}
function paintData(){
  $("json-editor").value=JSON.stringify(siteData,null,2);
  $("work-count").textContent=siteData.works.length;
  $("post-count").textContent=siteData.posts.length;
  $("data-status").textContent="読み込み済み";
}
async function loadData(){
  const r=await api("/api/site-data");
  siteData=validData(r.data); paintData();
}
async function loadAnalytics(){
  try{
    const a=await api("/api/analytics/summary");
    $("today-pv").textContent=a.today||0;$("total-pv").textContent=a.total||0;
    $("a-today").textContent=a.today||0;$("a-week").textContent=a.week||0;$("a-total").textContent=a.total||0;
    const list=$("analytics-list");list.replaceChildren();
    const days=a.days||[];const max=Math.max(1,...days.map(x=>x.count));
    days.forEach(d=>{const row=document.createElement("div");row.className="barrow";
      const label=document.createElement("span");label.textContent=d.date.slice(5);
      const track=document.createElement("div");track.className="bartrack";
      const fill=document.createElement("div");fill.className="barfill";fill.style.width=(d.count/max*100)+"%";track.append(fill);
      const count=document.createElement("b");count.textContent=d.count;row.append(label,track,count);list.append(row);
    });
    msg("analytics-message","");
  }catch(e){msg("analytics-message",e.message);}
}
async function enterApp(){
  const me=await api("/api/me");user=me.user;
  $("whoami").textContent="@"+user.login;$("logout").hidden=false;
  $("login-panel").hidden=true;$("app").hidden=false;
  $("github-status").textContent="接続済み";
  await loadData();await loadAnalytics();showView("dashboard");
}
$("login").addEventListener("click",async()=>{
  try{msg("login-message","GitHubへ移動します…");const r=await api("/auth/start");location.href=r.url;}
  catch(e){msg("login-message",e.message);}
});
$("logout").addEventListener("click",async()=>{
  try{await api("/auth/logout");}catch{}
  sessionToken=null;sessionStorage.removeItem("tahi_admin_session");location.reload();
});
document.querySelectorAll(".nav").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.go)));
$("reload-data").addEventListener("click",async()=>{try{await loadData();msg("content-message","最新データを読み込みました。");}catch(e){msg("content-message",e.message);}});
$("format-json").addEventListener("click",()=>{try{$("json-editor").value=JSON.stringify(JSON.parse($("json-editor").value),null,2);msg("content-message","JSONを整形しました。");}catch(e){msg("content-message","JSONエラー: "+e.message);}});
$("save-data").addEventListener("click",async()=>{
  try{const parsed=validData(JSON.parse($("json-editor").value));await api("/api/site-data",{method:"PUT",body:JSON.stringify({data:parsed})});siteData=parsed;paintData();msg("content-message","保存しました。GitHub Pagesへの反映には少し時間がかかります。");}
  catch(e){msg("content-message","保存できません: "+e.message);}
});
$("add-work").addEventListener("click",()=>{
  try{siteData=validData(JSON.parse($("json-editor").value));siteData.works.push({title:$("new-work-title").value.trim(),category:$("new-work-category").value.trim(),description:"",file:""});paintData();msg("content-message","作品の雛形を追加しました。保存ボタンで反映してください。");}
  catch(e){msg("content-message",e.message);}
});
$("add-post").addEventListener("click",()=>{
  try{siteData=validData(JSON.parse($("json-editor").value));siteData.posts.unshift({title:$("new-post-title").value.trim(),date:new Date().toISOString().slice(0,10),category:$("new-post-category").value.trim(),body:""});paintData();msg("content-message","記事の雛形を追加しました。保存ボタンで反映してください。");}
  catch(e){msg("content-message",e.message);}
});
$("refresh-analytics").addEventListener("click",loadAnalytics);
$("backup").addEventListener("click",()=>{
  try{const v=validData(JSON.parse($("json-editor").value));const blob=new Blob([JSON.stringify(v,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="site-backup.json";a.click();URL.revokeObjectURL(a.href);msg("settings-message","バックアップをダウンロードしました。");}
  catch(e){msg("settings-message",e.message);}
});
$("restore").addEventListener("change",async ev=>{
  const f=ev.target.files[0];if(!f)return;
  try{const v=validData(JSON.parse(await f.text()));siteData=v;paintData();$("json-editor").value=JSON.stringify(v,null,2);msg("settings-message","復元データを読み込みました。コンテンツ管理から保存してください。");}
  catch(e){msg("settings-message","復元できません: "+e.message);}
});
async function init(){
  const params=new URLSearchParams(location.search);const code=params.get("code");
  if(code){
    history.replaceState(null,"",location.pathname);
    try{const r=await api("/auth/exchange",{method:"POST",body:JSON.stringify({code})});sessionToken=r.token;sessionStorage.setItem("tahi_admin_session",sessionToken);}
    catch(e){msg("login-message",e.message);return;}
  }else{sessionToken=sessionStorage.getItem("tahi_admin_session");}
  if(sessionToken){try{await enterApp();}catch(e){sessionToken=null;sessionStorage.removeItem("tahi_admin_session");msg("login-message","ログイン状態を確認できませんでした。再度ログインしてください。");}}
}
init();
})();
