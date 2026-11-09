const result = request => new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
export async function openStore(name='qq-corpus-browser-v1'){
 const request=indexedDB.open(name,2);
 request.onupgradeneeded=event=>{
  const db=request.result;
  if(event.oldVersion<1){
  db.createObjectStore('datasets',{keyPath:'id'}).createIndex('fingerprint','fingerprint',{unique:true});
  db.createObjectStore('blocks',{keyPath:['dataset_id','index']}).createIndex('dataset','dataset_id');
  db.createObjectStore('profiles',{keyPath:'id'});
  db.createObjectStore('runs',{keyPath:'id'});
  db.createObjectStore('results',{keyPath:['run_id','message_id']}).createIndex('run','run_id');
  db.createObjectStore('events',{keyPath:'id',autoIncrement:true}).createIndex('run','run_id');
  }
  if(event.oldVersion<2)db.createObjectStore('batches',{keyPath:['run_id','id']});
 };
 const db=await result(request);
 db.onversionchange=()=>db.close();
 const read=(store,method,...args)=>result(db.transaction(store).objectStore(store)[method](...args));
 return {
  get:(store,key)=>read(store,'get',key),all:store=>read(store,'getAll'),
  index:(store,index,key)=>result(db.transaction(store).objectStore(store).index(index).getAll(key)),
  async write(entries){
   if(!entries.length)return;
   const tx=db.transaction([...new Set(entries.map(e=>e[0]))],'readwrite');
   const done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error('瀏覽器儲存交易中斷'));tx.onerror=()=>{};});
   try{for(const [store,value] of entries)tx.objectStore(store).put(value);}catch(e){tx.abort();await done.catch(()=>{});throw e;}
   await done;
  },
  async put(store,value){await this.write([[store,value]]);return value;},
  close:()=>db.close(),
 };
}
