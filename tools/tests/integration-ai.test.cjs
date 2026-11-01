'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),fs=require('node:fs'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const php=process.env.VG_TEST_PHP || (fs.existsSync(path.join(root,'.qa/php/runtime/php.exe')) ? path.join(root,'.qa/php/runtime/php.exe') : 'php');
const fixture=path.join(__dirname,'integration-ai-fixture.php');
const secrets={VG_GEMINI_API_KEY:'fixture-gemini',VG_GROQ_API_KEY:'fixture-groq',VG_OPENROUTER_API_KEY:'fixture-openrouter',VG_CLOUDFLARE_API_TOKEN:'fixture-cloudflare',VG_CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32)};
function run(overrides={}) {
  const input={secrets,input:{provider:'groq',prompt:'Sentetik teknik açıklama'},...overrides};
  const child=spawnSync(php,[fixture],{input:JSON.stringify(input),encoding:'utf8',windowsHide:true});
  assert.equal(child.status,0,child.stderr);assert.equal(child.stderr,'');return JSON.parse(child.stdout);
}
function chat(provider,json,extra={}) { return run({input:{provider,prompt:'Yalnızca sentetik deneme',history:[{role:'user',content:'Önceki soru'},{role:'assistant',content:'Önceki yanıt'}],...extra},response:{status:200,json}}); }
function reject(input,code='invalid_ai_input') { const result=run({input});assert.equal(result.ok,false);assert.equal(result.status,400);assert.equal(result.code,code);assert.equal(result.requests.length,0); }

test('AI status describes configuration only and never returns credentials or account IDs',()=>{
  const configured=run({action:'status'});assert.equal(configured.requests.length,0);
  assert.deepEqual(Object.keys(configured.result),['gemini','groq','openrouter','cloudflare']);
  for(const item of Object.values(configured.result)) {assert.equal(item.configured,true);assert.match(item.privacyUrl,/^https:\/\//);}
  for(const secret of Object.values(secrets))assert.equal(JSON.stringify(configured).includes(secret),false);
  const missing=run({action:'status',secrets:{}});for(const item of Object.values(missing.result))assert.equal(item.configured,false);
});
test('Missing, multiline and invalid Cloudflare credentials fail before any outbound request',()=>{
  for(const replacement of [{},{...secrets,VG_GROQ_API_KEY:'header\r\ninjected'},{...secrets,VG_CLOUDFLARE_ACCOUNT_ID:'../other-account'}]){
    const provider='VG_CLOUDFLARE_ACCOUNT_ID' in replacement&&replacement.VG_CLOUDFLARE_ACCOUNT_ID.startsWith('..')?'cloudflare':'groq';
    const r=run({secrets:replacement,input:{provider,prompt:'deneme'}});assert.equal(r.code,'ai_not_configured');assert.equal(r.requests.length,0);
  }
});
test('One provider configuration failure does not disable another configured provider',()=>{
  const scopedSecrets={...secrets,VG_GROQ_API_KEY:'__invalid__'};
  const state=run({secrets:scopedSecrets,action:'status'});assert.equal(state.result.groq.configured,false);assert.equal(state.result.gemini.configured,true);
  const r=run({secrets:scopedSecrets,input:{provider:'gemini',prompt:'x'},response:{status:200,json:{candidates:[{content:{parts:[{text:'Bağımsız yanıt'}]}}]}}});
  assert.equal(r.ok,true);assert.equal(r.requests.length,1);assert.equal(r.result.provider,'gemini');
});
test('Only named providers and the bounded server request contract are accepted',()=>{
  reject({provider:'https://attacker.invalid',prompt:'x'},'invalid_ai_provider');
  for(const field of ['model','url','tools','system','headers','apiKey'])reject({provider:'groq',prompt:'x',[field]:'injected'});
  for(const prompt of ['',null,{},'\0bad','x'.repeat(12001),'ğ'.repeat(12001)])reject({provider:'groq',prompt},typeof prompt==='string'&&prompt.length>12000?'ai_input_too_long':'invalid_ai_input');
  for(const maxOutputTokens of [0,63,1025,'1024',1.5])reject({provider:'groq',prompt:'x',maxOutputTokens});
});
test('History cannot inject a system role, extra fields or exceed twelve messages/combined length',()=>{
  for(const history of [{unexpected:{role:'user',content:'x'}},Array.from({length:13},()=>({role:'user',content:'x'})),[{role:'system',content:'x'}],[{role:'user',content:'x',tool:'call'}],[{role:'assistant',content:[]}]] )reject({provider:'groq',prompt:'x',history});
  reject({provider:'groq',prompt:'x',history:[{role:'user',content:'ğ'.repeat(12000)}]},'ai_input_too_long');
});
test('Groq sends fixed server instructions, text-only bounded history and a completion limit',()=>{
  const r=chat('groq',{choices:[{message:{content:'Teknik yanıt'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:8,total_tokens:28}});
  assert.equal(r.ok,true);assert.equal(r.requests.length,1);
  const request=r.requests[0],body=JSON.parse(request.options.body);
  assert.equal(request.url,'https://api.groq.com/openai/v1/chat/completions');assert.equal(request.method,'POST');
  assert.equal(request.options.headers.Authorization,'Bearer fixture-groq');assert.equal(body.model,'openai/gpt-oss-20b');assert.equal(body.max_completion_tokens,1024);
  assert.deepEqual(body.messages.map(item=>item.role),['system','user','assistant','user']);assert.match(body.messages[0].content,/Şirket kayıtlarına/);
  assert.equal(body.stream,false);assert.equal(body.include_reasoning,false);assert.equal(body.reasoning_effort,'low');assert.equal('tools' in body,false);assert.ok(request.options.timeout<=25);assert.equal(request.options.maxBytes,262144);
  assert.deepEqual(r.result.usage,{inputTokens:20,outputTokens:8,totalTokens:28});assert.equal(r.result.text,'Teknik yanıt');assert.equal(r.result.provider,'groq');assert.match(r.result.generatedAt,/Z$/);
});
test('Gemini keeps API keys out of URL and omits hidden thought parts',()=>{
  const r=chat('gemini',{candidates:[{content:{parts:[{thought:true,text:'Gizli düşünce'},{text:'Açık yanıt'}]},finishReason:'MAX_TOKENS'}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:5,totalTokenCount:15}});
  const request=r.requests[0],body=JSON.parse(request.options.body);
  assert.match(request.url,/\/gemini-3\.8-flash:generateContent$/);assert.equal(request.url.includes('fixture-gemini'),false);assert.equal(request.options.headers['x-goog-api-key'],'fixture-gemini');
  assert.equal(body.systemInstruction.parts.length,1);assert.deepEqual(body.contents.map(item=>item.role),['user','model','user']);assert.equal(body.generationConfig.maxOutputTokens,1024);
  assert.equal(r.result.text,'Açık yanıt');assert.equal(r.result.truncated,true);
});
test('Gemini blocked content is a clear failure and never an empty success',()=>{
  for(const json of [{promptFeedback:{blockReason:'SAFETY'}},{candidates:[{finishReason:'SAFETY',content:{parts:[{text:'not exposed'}]}}]}]){
    const r=chat('gemini',json);assert.equal(r.ok,false);assert.equal(r.status,422);assert.equal(r.code,'ai_content_blocked');assert.equal(r.requests.length,1);
  }
});
test('OpenRouter is restricted to free model IDs and requests data collection denial without fallback',()=>{
  for(const model of ['openai/gpt-paid','openrouter/auto','https://evil.invalid/:free']){
    const r=run({secrets:{...secrets,VG_OPENROUTER_MODEL:model},input:{provider:'openrouter',prompt:'x'}});assert.equal(r.code,'ai_not_configured');assert.equal(r.requests.length,0);
  }
  const r=chat('openrouter',{model:'meta-llama/example:free',choices:[{message:{content:'Ücretsiz yanıt'},finish_reason:'stop'}]});
  const body=JSON.parse(r.requests[0].options.body);assert.equal(body.model,'openrouter/free');assert.deepEqual(body.provider,{data_collection:'deny',allow_fallbacks:false});assert.equal(body.max_tokens,1024);
  assert.equal(r.result.model,'meta-llama/example:free');assert.equal(r.result.provider,'openrouter');
});
test('Cloudflare uses a validated account ID and native model endpoint with no model in body',()=>{
  const r=chat('cloudflare',{success:true,result:{response:'Workers AI yanıtı',usage:{prompt_tokens:5,completion_tokens:3,total_tokens:8}},errors:[]});
  assert.equal(r.ok,true);assert.equal(r.requests[0].url,`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/run/@cf/openai/gpt-oss-20b`);
  const body=JSON.parse(r.requests[0].options.body);assert.equal(body.max_tokens,1024);assert.equal('model' in body,false);assert.equal(r.result.text,'Workers AI yanıtı');
});
test('Quota, access and upstream failures make one request and never expose provider error bodies',()=>{
  for(const [status,code] of [[429,'ai_quota_exceeded'],[401,'ai_provider_access'],[402,'ai_provider_access'],[403,'ai_provider_access'],[500,'ai_provider_unavailable']]){
    const r=run({response:{status,body:'fixture-secret-provider-error'}});assert.equal(r.code,code);assert.equal(r.requests.length,1);assert.equal(JSON.stringify({...r,requests:[]}).includes('fixture-secret-provider-error'),false);
  }
});
test('Malformed, empty, tool-only and oversized responses fail closed',()=>{
  for(const response of [{status:200,body:'not JSON'},{status:200,json:{choices:[{message:{tool_calls:[{name:'write'}]}}]}},{status:200,json:{error:{message:'secret'}}},{status:200,json:{choices:[{message:{content:'x'.repeat(131073)}}]}}]){
    const r=run({response});assert.equal(r.ok,false);assert.equal(r.code,'invalid_ai_response');assert.equal(r.requests.length,1);
  }
  for(const json of [{candidates:['bad']},{candidates:[{content:{parts:'bad'}}]}]){const r=chat('gemini',json);assert.equal(r.code,'invalid_ai_response');}
  const cf=chat('cloudflare',{success:false,errors:[{message:'secret'}]});assert.equal(cf.code,'invalid_ai_response');
});
test('Provider usage is normalized to nonnegative integers without leaking response fields',()=>{
  const r=chat('groq',{choices:[{message:{content:'x'},finish_reason:'stop'}],usage:{prompt_tokens:-1,completion_tokens:'4',total_tokens:8,secret:'hidden'},secret:'hidden'});
  assert.deepEqual(r.result.usage,{inputTokens:null,outputTokens:null,totalTokens:8});assert.equal(JSON.stringify(r.result).includes('hidden'),false);
});
