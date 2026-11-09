import {esc} from './corpus-data.js';
import './service-help.css';

const providers={
 ollama:{name:'Ollama',port:11434,model:'qwen3.5:4b',format:'4B · Q4',lanes:{8:2,12:4,16:6,24:8}},
 llamacpp:{name:'llama.cpp',port:8080,model:'local-model',format:'4B · Q4 GGUF',lanes:{8:2,12:4,16:6,24:8}},
 vllm:{name:'vLLM',port:8000,model:'local-model',format:'4B · BF16',lanes:{16:2,24:4,32:8}},
};
export function serviceDefaults(provider,vram=16){
 const p=providers[provider];
 if(!p)throw Error('Unknown inference service');
 return {name:`本機 ${p.name}`,base_url:`http://127.0.0.1:${p.port}/v1`,model:p.model,
  context_tokens:16384,max_output_tokens:2048,concurrency:p.lanes[vram]??p.lanes[16],
  temperature:0,reasoning_effort:'none',response_mode:'auto',output_token_parameter:'max_tokens',timeout:180};
}
export function inferProvider(url=''){
 try{return {11434:'ollama',8080:'llamacpp',8000:'vllm'}[new URL(url).port]||'custom';}catch{return 'custom';}
}
const table=(head,rows)=>`<div class="service-table-wrap"><table><thead><tr>${head.map(s=>`<th scope="col">${esc(s)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(s=>`<td>${esc(s)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const command=(title,text)=>`<div class="service-command"><div><span>${esc(title)}</span><button type="button" data-copy-command>複製</button></div><pre><code>${esc(text)}</code></pre></div>`;
const step=(number,title,content)=>`<section class="service-step"><h3><span>${number}</span>${title}</h3>${content}</section>`;
const link=(url,label)=>`<a href="${url}" target="_blank" rel="noreferrer">${label} ↗</a>`;

export function createServiceHelp({apply}){
 let provider='ollama';const memories={ollama:16,llamacpp:16,vllm:16};
 document.body.insertAdjacentHTML('beforeend',`<dialog id="service-help-dialog" aria-labelledby="service-help-title"><header class="service-help-header"><h2 id="service-help-title">本機推論服務</h2><button type="button" id="service-help-close" aria-label="關閉服務說明">✕</button></header><div class="service-tabs" role="tablist" aria-label="推論服務">${Object.entries(providers).map(([id,p])=>`<button type="button" id="service-tab-${id}" role="tab" aria-controls="service-panel" aria-selected="false" tabindex="-1" data-service="${id}">${p.name}</button>`).join('')}</div><div id="service-panel" role="tabpanel" tabindex="0"></div></dialog>`);
 const dialog=document.querySelector('#service-help-dialog'),panel=dialog.querySelector('#service-panel');
 dialog.querySelector('#service-help-close').onclick=()=>dialog.close();
 const tabs=[...dialog.querySelectorAll('[role="tab"]')];
 for(const tab of tabs){
  tab.onclick=()=>{provider=tab.dataset.service;render();};
  tab.onkeydown=e=>{
   const i=tabs.indexOf(tab);let next;
   if(e.key==='ArrowRight')next=(i+1)%tabs.length;
   if(e.key==='ArrowLeft')next=(i+tabs.length-1)%tabs.length;
   if(e.key==='Home')next=0;
   if(e.key==='End')next=tabs.length-1;
   if(next!=null){e.preventDefault();tabs[next].click();tabs[next].focus();}
  };
 }
 function render(){
  const p=providers[provider],vram=memories[provider],cfg=serviceDefaults(provider,vram),n=cfg.concurrency;
  for(const tab of tabs){const active=tab.dataset.service===provider;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}
  panel.setAttribute('aria-labelledby',`service-tab-${provider}`);
  const origin=location.origin;
  let steps='';
  if(provider==='ollama'){
   steps=step(1,'準備模型',`<p>${link('https://ollama.com/download/windows','安裝 Ollama')}。在 PowerShell 執行，將清單中的名稱填入網頁「模型名稱」。</p>${command('PowerShell','ollama list')}`)
    +step(2,'啟動服務',`<p>從系統匣退出 Ollama，再於 PowerShell 執行並保持終端開啟。</p>${command('PowerShell',`$env:OLLAMA_CONTEXT_LENGTH='16384'\n$env:OLLAMA_NUM_PARALLEL='${n}'\n$env:OLLAMA_ORIGINS='${origin.replaceAll("'","''")}'\nollama serve`)}`)
    +step(3,'填入網頁並測試',`<p>套用右側參數 → 填寫模型名稱 → 測試連線 → 儲存並使用 → 開始新分析。</p>${command('另一個 PowerShell：查看載入模型','ollama ps')}`);
  }else if(provider==='llamacpp'){
   const start=`.\\llama-server.exe -m "C:\\Models\\model.gguf" --alias local-model --host 127.0.0.1 --port 8080 -ngl 99 -fa on -c ${16384*n} -np ${n} --reasoning off`;
   steps=step(1,'準備程式與模型',`<p>下載 ${link('https://github.com/ggml-org/llama.cpp/releases','Windows CUDA 版')} 並解壓。將模型 GGUF 放進 <code>C:\\Models</code>。</p>`)
    +step(2,'啟動服務',`<p>在 llama-server.exe 所在資料夾開啟 PowerShell，將 <code>model.gguf</code> 改成檔案名稱。</p>${command('PowerShell',start)}${table(['服務參數','填法'],[['-c',`每路 16384 × ${n} 路 = ${16384*n}`],['-np',`${n} 路`],['--alias','local-model，對應網頁模型名稱'],['-ngl 99 / -fa on','GPU 載入／Flash Attention']])}`)
    +step(3,'填入網頁並測試','<p>套用右側參數 → 測試連線 → 儲存並使用 → 開始新分析。</p>');
  }else{
   const bashOrigin="'"+origin.replaceAll("'","'\"'\"'")+"'";
   const start=`HF_HUB_OFFLINE=1 vllm serve "/mnt/c/Models/Qwen3.5-4B" \\\n  --served-model-name local-model \\\n  --host 127.0.0.1 --port 8000 \\\n  --max-model-len 16384 --max-num-seqs ${n} \\\n  --gpu-memory-utilization 0.8 \\\n  --enable-prefix-caching \\\n  --allowed-origins ${bashOrigin} \\\n  --default-chat-template-kwargs '{"enable_thinking":false}'`;
   steps=step(1,'準備 Ubuntu 與 vLLM',`${command('Windows：系統管理員 PowerShell','wsl --install -d Ubuntu')}<p>開啟 Ubuntu 終端，建立 vLLM 環境。</p>${command('Ubuntu / WSL2','sudo apt update\nsudo apt install -y python3-venv\npython3 -m venv ~/.venvs/vllm\nsource ~/.venvs/vllm/bin/activate\npython -m pip install -U vllm')}`)
    +step(2,'載入模型並啟動',`<p>將完整 Hugging Face 模型目錄放進 <code>C:\\Models\\Qwen3.5-4B</code>，內含權重、config 與 tokenizer。</p>${command('Ubuntu / WSL2',start)}`)
    +step(3,'填入網頁並測試','<p>套用右側參數 → 測試連線 → 儲存並使用 → 開始新分析。</p>');
  }
  const fieldRows=[['服務',p.name],['API 位址',cfg.base_url],['模型名稱',cfg.model],['API Key','留白'],['上下文容量','16384'],['最大輸出 token','2048'],['同時請求數',String(n)],['思考模式','關閉'],['隨機程度','0'],['逾時秒數','180'],['輸出格式','自動測試相容性'],['輸出 token 參數','max_tokens']];
  const source=provider==='ollama'?['https://docs.ollama.com/faq','Ollama 參數']:provider==='llamacpp'?['https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md','llama.cpp 參數']:['https://docs.vllm.ai/en/stable/cli/serve/','vLLM 參數'];
  panel.innerHTML=`<div class="service-help-grid"><div class="service-steps">${steps}</div><aside class="service-parameters"><div class="service-parameter-heading"><h3>建議起始參數</h3><label for="service-vram">顯存<select id="service-vram">${Object.keys(p.lanes).map(gb=>`<option value="${gb}" ${Number(gb)===vram?'selected':''}>${gb} GB</option>`).join('')}</select></label></div><p class="service-model-format">${p.format} · 每路 16K 上下文</p>${table(['顯存','同時請求數'],Object.entries(p.lanes).map(([gb,lanes])=>[`${gb} GB`,String(lanes)]))}<h3>網頁欄位</h3>${table(['欄位','填入值'],fieldRows)}<button type="button" id="service-apply">填入這組參數</button><div class="service-source">${link(...source)}</div></aside></div>`;
  panel.querySelector('#service-vram').onchange=e=>{memories[provider]=Number(e.target.value);render();panel.querySelector('#service-vram').focus();};
  panel.querySelector('#service-apply').onclick=()=>{apply(provider,cfg);dialog.close();};
  for(const button of panel.querySelectorAll('[data-copy-command]'))button.onclick=async()=>{
   try{await navigator.clipboard.writeText(button.closest('.service-command').querySelector('code').textContent);button.textContent='已複製';}
   catch{button.textContent='選取命令複製';const range=document.createRange();range.selectNodeContents(button.closest('.service-command').querySelector('code'));const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);}
  };
 }
 return {open(selected){if(providers[selected])provider=selected;render();if(!dialog.open)dialog.showModal();dialog.querySelector('[aria-selected="true"]').focus();}};
}
