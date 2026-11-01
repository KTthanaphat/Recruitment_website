const fs=require('fs');
const {createClient}=require('@supabase/supabase-js');
async function main(){
 const env=fs.readFileSync('.env.local','utf8');
 const value=name=>process.env[name]??env.match(new RegExp('^'+name+'=(.+)$','m'))?.[1]?.trim().replace(/^["']|["']$/g,'');
 const url=value('NEXT_PUBLIC_SUPABASE_URL'), key=value('NEXT_PUBLIC_SUPABASE_ANON_KEY');
 if(new URL(url).hostname!=='mppnlkldlctvketcsald.supabase.co')throw Error('Unexpected backend project');
 const settings=await fetch(url+'/auth/v1/settings',{headers:{apikey:key}});
 if(!settings.ok)throw Error('Backend auth connectivity failed: '+settings.status);
 const client=createClient(url,key,{auth:{persistSession:false}});
 const {data,error}=await client.from('candidate_applications').select('application_id').limit(1);
 if(error&&error.code!=='42501')throw Error('Unexpected backend schema response: '+error.code);
 if(data?.length)throw Error('Anonymous application visibility');
 for(const route of ['/login','/candidates','/workspace']){
  const response=await fetch('http://localhost:3000'+route);
  if(!response.ok)throw Error(route+' returned '+response.status);
  console.log(route+': HTTP '+response.status);
 }
 console.log('Requested backend auth reachable; anonymous application access denied.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
