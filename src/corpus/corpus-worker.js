import {BrowserCorpus} from './corpus-engine.js';
const engine=new BrowserCorpus({onEvent:event=>self.postMessage({event})});
self.onmessage=async({data})=>{try{const value=await engine.request(data.path,data.options);self.postMessage({id:data.id,value});}catch(error){self.postMessage({id:data.id,error:{message:error.name==='QuotaExceededError'?'瀏覽器儲存空間不足，請匯出報告並釋放空間':error.message||'瀏覽器分析失敗',usage:error.usage,diagnostics:error.diagnostics}});}};
