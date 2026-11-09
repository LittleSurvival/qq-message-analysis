let worker,next=0;const requests=new Map();
function connect(){if(worker)return worker;worker=new Worker(new URL('./corpus-worker.js',import.meta.url),{type:'module'});
 worker.onmessage=({data})=>{if(data.event){window.dispatchEvent(new CustomEvent('corpus-event',{detail:data.event}));return;}const pending=requests.get(data.id);if(!pending)return;requests.delete(data.id);data.error?pending.reject(Object.assign(new Error(data.error.message||data.error),{usage:data.error.usage,diagnostics:data.error.diagnostics})):pending.resolve(data.value);};
 worker.onerror=()=>{for(const p of requests.values())p.reject(new Error('瀏覽器分析工作器無法執行，請重新整理；已儲存結果仍保留'));requests.clear();worker.terminate();worker=null;};return worker;
}
export function browserAPI(path,options={}){const body=options.body instanceof FormData?{file:options.body.get('file')}:options.body;return new Promise((resolve,reject)=>{const id=++next;requests.set(id,{resolve,reject});try{connect().postMessage({id,path,options:{...options,body}});}catch(e){requests.delete(id);reject(e);}});}
