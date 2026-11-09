import {esc, number as num} from './corpus-data.js';
import {createServiceHelp,serviceDefaults,inferProvider} from './service-help.js';
const input=(label,name,value='',type='text',extra='')=>`<label for="setting-${name}">${label}<input id="setting-${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
export function createModelSettings({state,api,post,reloadData,persist,updateModel,toast,action}) {
 const $=s=>document.querySelector(s); let editingId=null,drafts=new Map(),settingsStatus='';
 const updateRun=()=>{};
 document.body.insertAdjacentHTML('beforeend',`<dialog id="settings-dialog" aria-labelledby="settings-title"><div class="dialog-header"><h2 id="settings-title">模型設定</h2><div class="settings-header-actions"><button type="button" id="service-help-open">服務啟動說明</button><button id="settings-close" aria-label="關閉模型設定">✕</button></div></div><div id="settings-content"></div></dialog>`);
 $('#settings-close').onclick=()=>$('#settings-dialog').close();
 $('#settings-dialog').addEventListener('close',captureDraft);
  let settingsOpened = false, saving = false;
  const tests = new Map();
  const phases={connecting:'連接服務，等待模型載入或回應',waiting_first_output:'已連線，等待模型輸出',thinking:'模型思考中',generating:'正在接收評分',validating:'驗證評分格式與證據'};
  window.addEventListener('corpus-event',({detail:e})=>{if(e.type!=='connection-progress')return;const test=[...tests.values()].find(t=>t.id===e.test_id);if(test?.running)test.progress={...test.progress,...e};});
  setInterval(()=>{if(tests.get(draftKey())?.running&&$('#settings-dialog').open)renderTest();},250);
  function failureDetails(test){
    const d=test.diagnostics;if(!d)return '';
    return `<dl><dt>輸入／輸出 token</dt><dd>${test.usage?.measured?num(test.usage.input)+' / '+num(test.usage.output):'服務未回報'}</dd><dt>思考／評分字數</dt><dd>${num(d.reasoning_chars)} / ${num(d.answer_chars)}</dd><dt>設定的輸出上限</dt><dd>${num(d.output_limit)} tokens</dd></dl><p>輸入、思考和答案都受服務實際上下文容量限制；單純提高網頁上的數字不會擴大 Ollama 容量。</p>${$('#preset').value==='ollama'?'<p>Ollama 重測會關閉思考，並將隨機程度設為 0。</p>':''}${d.code==='output_truncated'&&d.reasoning_chars>0&&test.effort!=='none'?'<button type="button" id="test-without-thinking">關閉思考並重測</button>':''}`;
  }
  function applyService(provider,values){
    const form=$('#profile-form');
    if(!form||saving)return;
    const previous=inferProvider(form.elements.base_url.value);
    const name=form.elements.name.value,model=form.elements.model.value;
    for(const [key,value] of Object.entries(values))if(form.elements.namedItem(key))form.elements.namedItem(key).value=value;
    if(name&&!/^本機 (Ollama|llama\.cpp|vLLM)$/.test(name))form.elements.name.value=name;
    if(previous===provider&&model)form.elements.model.value=model;
    form.elements.api_key.value='';
    $('#preset').value=provider;
    captureDraft();refreshEditorState();renderTest();
  }
  const serviceHelp=createServiceHelp({apply:applyService});
  $('#service-help-open').onclick=()=>serviceHelp.open($('#preset')?.value);
  const draftKey = () => editingId ?? 'new';
  function captureDraft() {
    const form=$('#profile-form');
    if(form&&!saving) drafts.set(draftKey(), Object.fromEntries(new FormData(form)));
  }
  function bodyFromForm() {
    const body=Object.fromEntries(new FormData($('#profile-form')));
    for(const k of ['context_tokens','max_output_tokens','concurrency','timeout'])body[k]=Number(body[k]);
    for(const k of ['input_price','output_price','budget','temperature'])body[k]=body[k]===''?null:Number(body[k]);
    return body;
  }
  function isDirty() {
    const saved=state.profiles.find(p=>p.id===editingId), form=$('#profile-form');
    if(!saved||!form)return true;
    return [...new FormData(form)].some(([key,value])=>key==='api_key'?!!value:String(saved[key]??'')!==value);
  }
  function openSettings() {
    if(!settingsOpened){editingId=state.profileId;settingsOpened=true;}
    renderSettings();
    if(!$('#settings-dialog').open)$('#settings-dialog').showModal();
  }
  function renderSaved() {
    $('#saved-profiles').innerHTML=state.profiles.length?state.profiles.map(p=>`<button type="button" class="saved-profile ${p.id===editingId?'selected':''}" data-load-profile="${p.id}" aria-label="載入 ${esc(p.name)}" aria-pressed="${p.id===editingId}"><span class="saved-name">${esc(p.name)}</span><small>${esc(p.model)}</small><small class="saved-address">${esc(p.base_url)}</small><span class="saved-bottom">${p.id===state.profileId?'<span class="badge done">目前使用</span>':'<span></span>'}<span>${p.id===editingId?'已載入':'載入 →'}</span></span></button>`).join(''):'<p class="small">尚無已儲存設定</p>';
    document.querySelectorAll('[data-load-profile]').forEach(button=>{button.disabled=saving;button.onclick=()=>{
      captureDraft();editingId=Number(button.dataset.loadProfile);settingsStatus='';renderSettings();
    };});
  }
  function refreshEditorState() {
    $('#editor-state').textContent=editingId?(isDirty()?'有未儲存變更':'已儲存'):'未儲存';
    $('#save-profile').disabled=saving||!!tests.get(draftKey())?.running;
    $('#new-profile').disabled=saving;
    const test=tests.get(draftKey());
    $('#test-profile').disabled=saving||!!test?.running;
  }
  function renderSettings() {
    $('#settings-content').innerHTML=`<div class="settings-layout"><aside class="saved-panel"><div class="section-bar"><h3>已儲存設定</h3><span class="small">${state.profiles.length} 組</span></div><button id="new-profile" class="new-profile">＋ 新增設定</button><div id="saved-profiles"></div></aside><section class="editor-panel"><div class="section-bar"><h3>${editingId?'編輯設定':'新增設定'}</h3><span class="badge" id="editor-state"></span></div><form id="profile-form"><label for="preset">服務<select id="preset"><option value="custom">自訂相容 API</option><option value="ollama">Ollama</option><option value="llamacpp">llama.cpp</option><option value="vllm">vLLM</option></select></label>${input('設定名稱','name','','text','required')}${input('API 位址','base_url','http://127.0.0.1:11434/v1','url','required')}${input('模型名稱','model','','text','required')}${input('API Key','api_key','','password','autocomplete="off" placeholder="僅存於此分頁記憶體；重新整理後需重填"')}<details class="advanced-settings"><summary>進階設定</summary><p class="small">依「服務啟動說明」填入上下文容量、輸出上限與同時請求數。</p><div class="form-grid">${input('上下文容量','context_tokens',32768,'number','min="4096" required')}${input('最大輸出 token','max_output_tokens',8192,'number','min="256" required')}${input('隨機程度（留白沿用服務）','temperature','','number','min="0" max="2" step="0.1"')}${input('同時請求數','concurrency',1,'number','min="1" max="8" required')}${input('逾時秒數','timeout',180,'number','min="5" required')}${input('輸入單價／百萬 token','input_price','','number','min="0" step="any"')}${input('輸出單價／百萬 token','output_price','','number','min="0" step="any"')}${input('批次費用上限','budget','','number','min="0.000001" step="any"')}</div><label for="reasoning-effort">思考模式<select name="reasoning_effort" id="reasoning-effort"><option value="default">服務預設</option><option value="none">關閉</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label><label for="response-mode">輸出格式<select name="response_mode" id="response-mode"><option value="auto">自動測試相容性</option><option value="json_schema">JSON Schema</option><option value="json_object">JSON Object</option><option value="prompt">提示詞 JSON＋本機驗證</option></select></label><label for="token-parameter">輸出 token 參數<select name="output_token_parameter" id="token-parameter"><option value="max_tokens">max_tokens</option><option value="max_completion_tokens">max_completion_tokens</option></select></label></details><div class="settings-footer"><button class="primary" type="submit" id="save-profile">儲存並使用</button><span id="profile-status" class="small" role="status"></span></div></form></section><section class="connection-panel" aria-labelledby="connection-title"><h3 id="connection-title">連線測試</h3><p class="small">使用目前編輯中的設定測試，不必先儲存。</p><div class="test-target" id="test-target"></div><button id="test-profile">測試連線</button><div id="test-result" role="status" aria-live="polite"></div></section></div>`;
    const saved=state.profiles.find(p=>p.id===editingId);
    const values=drafts.get(draftKey())||saved||{};
    const form=$('#profile-form');
    for(const [key,value] of Object.entries(values))if(form.elements.namedItem(key))form.elements.namedItem(key).value=value??'';
    $('#preset').value=inferProvider(values.base_url||form.elements.base_url.value);
    if(saved?.has_key&&!form.elements.api_key.value)form.elements.api_key.placeholder='金鑰已可用；留白沿用目前位址的金鑰';
    $('#profile-status').textContent=settingsStatus;
    form.oninput=()=>{captureDraft();refreshEditorState();renderTest();};
    $('#preset').onchange=e=>{if(e.target.value!=='custom')applyService(e.target.value,serviceDefaults(e.target.value));};
    $('#new-profile').onclick=()=>{captureDraft();editingId=null;settingsStatus='';renderSettings();$('#setting-name').focus();};
    form.onsubmit=e=>{e.preventDefault();action(saveProfile);};
    $('#test-profile').onclick=()=>{
      const name=form.elements.name;
      // A label is required to save a profile, but not to check a connection.
      name.required=false;const valid=form.reportValidity();name.required=true;
      if(valid)testConnection();
    };
    renderSaved();refreshEditorState();renderTest();
  }
  function renderTest() {
    const form=$('#profile-form');if(!form)return;
    const body=bodyFromForm(),test=tests.get(draftKey());
    $('#test-target').innerHTML=`<span>${esc(body.model||'尚未填寫模型')}</span><small>${esc(body.base_url||'尚未填寫 API 位址')}</small>`;
    const stale=test&&test.fingerprint!==JSON.stringify(body);
    $('#test-profile').disabled=saving||!!test?.running;
    $('#test-profile').textContent=test?.running?'測試中…':'測試連線';
    $('#test-result').innerHTML=!test?'<p class="test-idle">尚未測試</p>':`<div class="test-outcome ${test.running?'testing':test.error?'test-error':'test-success'}"><strong>${test.running?(phases[test.progress?.phase]||'準備測試'):test.error?(test.diagnostics?.code==='output_truncated'?'已連線，但輸出被截斷':'測試失敗'):'測試通過'}</strong>${stale?'<p class="test-stale">設定已變更，此結果對應變更前的設定。</p>':''}${test.running?`<p>${((performance.now()-test.started)/1000).toFixed(1)} 秒 · 思考 ${num(test.progress?.reasoning_chars||0)} 字 / 評分 ${num(test.progress?.answer_chars||0)} 字</p>`:test.error?`<p>${esc(test.error)}</p>${failureDetails(test)}`:`<dl><dt>連線與格式</dt><dd>${test.result.needs_review?'格式通過；測試結果待覆核':'八維 JSON、ID、逐維證據通過'}</dd><dt>輸出格式</dt><dd>${esc(test.result.response_mode)}</dd><dt>耗時</dt><dd>${test.seconds.toFixed(1)} 秒</dd><dt>輸入／輸出 token</dt><dd>${test.result.usage.measured===false?'服務未回報':num(test.result.usage.input)+' / '+num(test.result.usage.output)}</dd></dl><details><summary>查看測試回覆</summary><pre>${esc(JSON.stringify(test.result.sample,null,2))}</pre></details>`}</div>`;
    const retry=$('#test-without-thinking');if(retry)retry.onclick=()=>{form.elements.reasoning_effort.value='none';if($('#preset').value==='ollama')form.elements.temperature.value='0';captureDraft();refreshEditorState();testConnection();};
  }
  async function testConnection() {
    const key=draftKey();if(tests.get(key)?.running)return;
    const body=bodyFromForm();if(!body.name.trim())body.name='未儲存測試';
    const test={id:crypto.randomUUID(),started:performance.now(),effort:body.reasoning_effort,running:true,fingerprint:JSON.stringify(bodyFromForm())};tests.set(key,test);renderTest();
    refreshEditorState();const started=performance.now();
    try {test.result=await post('/profiles/test',{...body,saved_profile_id:editingId,test_id:test.id});}
    catch(error){test.error=error.message;test.usage=error.usage;test.diagnostics=error.diagnostics;}
    finally{test.running=false;test.seconds=(performance.now()-started)/1000;if(draftKey()===key&&$('#test-result')){renderTest();refreshEditorState();}}
  }
  async function saveProfile() {
    if(saving)return;
    const body=bodyFromForm(),key=draftKey(),id=editingId;
    saving=true;refreshEditorState();renderSaved();
    $('#profile-form').querySelectorAll('input,select').forEach(el=>el.disabled=true);
    try {
      const saved=await api('/profiles'+(id?'/'+id:''),{method:id?'PUT':'POST',body:JSON.stringify(body)});
      drafts.delete(key);if(tests.has(key)){tests.set(saved.id,tests.get(key));if(key!==saved.id)tests.delete(key);}
      editingId=saved.id;state.profileId=saved.id;
      await reloadData();persist();updateModel();updateRun();settingsStatus='已儲存，新的分析將使用這組設定';
      toast('設定已儲存並選用');
    } catch(error){settingsStatus=error.message;throw error;}
    finally{saving=false;renderSettings();}
  }


 return {openSettings};
}
