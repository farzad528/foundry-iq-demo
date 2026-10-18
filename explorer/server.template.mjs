const scenarios = __DATA__;
const page = __PAGE__;
const sourceArchive = '__ARCHIVE__';
const samples = __SAMPLES__;
const json = (body,status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const parseMap = env => {try{return JSON.parse(env.FOUNDRY_IQ_KB_MAP||'{}')}catch{return {}}};
export default {
 async fetch(request,env={}) {
  const url=new URL(request.url);
  if(request.method==='GET'&&url.pathname==='/') return new Response(page,{headers:{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
  if(request.method==='GET'&&url.pathname==='/download')return new Response(Uint8Array.from(atob(sourceArchive),c=>c.charCodeAt(0)),{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="foundry-iq-explorer.zip"'}});
  if(request.method==='GET'&&samples[url.pathname])return new Response(samples[url.pathname],{headers:{'Content-Type':'text/plain; charset=utf-8','X-Content-Type-Options':'nosniff'}});
  if(request.method==='GET'&&url.pathname==='/api/config')return json({configured:!!(env.AZURE_SEARCH_ENDPOINT&&env.AZURE_SEARCH_API_KEY),available:Object.keys(parseMap(env)),repository:env.GITHUB_REPOSITORY_URL||'https://github.com/farzad528/foundry-iq-demo'});
  if(url.pathname!=='/api/retrieve')return json({error:'Not found'},404);
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  if(Number(request.headers.get('content-length'))>65536)return json({error:'Request too large'},413);
  const origin=request.headers.get('origin');if(origin&&origin!==url.origin)return json({error:'Cross-origin requests are not accepted'},403);
  try {
   const text=await request.text();if(text.length>65536)return json({error:'Request too large'},413);
   const body=JSON.parse(text);const scenario=scenarios.find(s=>s.id===body.scenarioId);if(!scenario)return json({error:'Unknown knowledge base'},400);
   const r=body.request||{};const effort=r.retrievalReasoningEffort?.kind;
   const question=r.messages?.[0]?.content?.[0]?.text||r.intents?.[0]?.search;
   if(typeof question!=='string'||!question.trim()||question.length>8000)return json({error:'Enter a question between 1 and 8,000 characters'},400);
   if(!['minimal','low','medium','auto'].includes(effort)||!['extractiveData','answerSynthesis'].includes(r.outputMode))return json({error:'Invalid retrieval settings'},400);
   if(effort==='minimal'&&r.outputMode!=='extractiveData')return json({error:'Minimal reasoning requires extractive data'},400);
   if(!Number.isInteger(r.maxRuntimeInSeconds)||r.maxRuntimeInSeconds<10||r.maxRuntimeInSeconds>600||!Number.isInteger(r.maxOutputSizeInTokens)||r.maxOutputSizeInTokens<100||r.maxOutputSizeInTokens>10000)return json({error:'Invalid request limits'},400);
   if(body.mode==='sample') {
    if(question.trim()!==scenario.question)return json({error:'Sample replay supports the curated example question only. Connect a live knowledge base to ask your own questions.'},400);
    const data=structuredClone(scenario.fixture);
    if(r.outputMode==='extractiveData')data.response=[{role:'assistant',content:[{type:'text',text:JSON.stringify(data.references.map(x=>x.sourceData),null,2)}]}];
    return json({sample:true,data});
   }
   if(body.mode!=='live')return json({error:'Unknown execution mode'},400);
   if(scenario.requiresIdentity)return json({error:'This scenario requires end-user authorization for live Fabric or remote SharePoint. Use sample replay or an indexed-source scenario.'},400);
   const kb=parseMap(env)[scenario.id];if(!env.AZURE_SEARCH_ENDPOINT||!env.AZURE_SEARCH_API_KEY||!kb)return json({error:'Live retrieval is not configured. Set server environment variables and map this scenario to a deployed knowledge base.'},503);
   const endpoint=new URL(env.AZURE_SEARCH_ENDPOINT);if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.search.windows.net')||endpoint.username||endpoint.password)throw Error('Invalid configured endpoint');
   const params=r.knowledgeSourceParams;
   if(!Array.isArray(params)||params.length!==scenario.sources.length)return json({error:'Invalid knowledge source parameters'},400);
   const normalized=params.map(p=>{const source=scenario.sources.find(s=>s.name===p.knowledgeSourceName&&s.kind===p.kind);if(!source)throw Error('Unknown source');return {kind:source.kind,knowledgeSourceName:source.name,includeReferences:true,includeReferenceSourceData:p.includeReferenceSourceData===true,alwaysQuerySource:p.alwaysQuerySource===true};});
   const outbound={...(effort==='minimal'?{intents:[{type:'semantic',search:question}]}:{messages:[{role:'user',content:[{type:'text',text:question}]}]}),retrievalReasoningEffort:{kind:effort},outputMode:r.outputMode,includeActivity:true,maxRuntimeInSeconds:r.maxRuntimeInSeconds,maxOutputSizeInTokens:r.maxOutputSizeInTokens,knowledgeSourceParams:normalized};
   const target=new URL('/knowledgebases/'+encodeURIComponent(kb)+'/retrieve',endpoint);target.searchParams.set('api-version','2026-08-01-preview');
   const response=await fetch(target,{method:'POST',headers:{'Content-Type':'application/json','api-key':env.AZURE_SEARCH_API_KEY},body:JSON.stringify(outbound),signal:AbortSignal.timeout(Math.min(600000,r.maxRuntimeInSeconds*1000+5000)),redirect:'error'});
   if(!response.ok)return json({error:'Azure retrieval returned HTTP '+response.status+'. Check knowledge base names, source configuration, model access, and API-key permissions.'},502);
   return json({sample:false,data:await response.json()});
  } catch(e){return json({error:e instanceof SyntaxError?'Invalid request JSON':e.name==='TimeoutError'?'Retrieval timed out. Reduce the question scope or adjust the runtime limit.':'Retrieval could not complete. Check the server configuration and request.'},400)}
 }
};
