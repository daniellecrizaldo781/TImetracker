
const fs=require("fs");const vm=require("vm");
global.globalThis=global;
global.window=global;
global.fetch=require("node-fetch")??global.fetch;
// minimal shims
const sbcode=fs.readFileSync("assets/supabase.js","utf8");
vm.runInThisContext(sbcode);
const cfg={supabaseUrl:"https://cnzsfbxixcfzaegayvpp.supabase.co",supabaseAnonKey:"sb_publishable_T3hjuLN4UceFON0E7KO4Ig_-PWi6iXb"};
(async()=>{
  const sb=global.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
  const {data:emps,error:e1}=await sb.from("employees").select("id,email,full_name,role,is_active");
  console.log("EMP:",e1?("ERR "+e1.message):JSON.stringify(emps));
  const {data:projs,error:e2}=await sb.from("projects").select("id,name");
  console.log("PROJ:",e2?("ERR "+e2.message+" (anon, no session -> expected if RLS auth-only)"):JSON.stringify(projs));
  const {data:teams,error:e3}=await sb.from("teams").select("id,name");
  console.log("TEAMS:",e3?("ERR "+e3.message):JSON.stringify(teams));
})().catch(e=>console.log("FATAL",e.message));
