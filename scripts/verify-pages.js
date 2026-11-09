import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import {join} from 'node:path';

// Validate the exact directory uploaded by the Pages workflow.
const walk=async dir=>(await Promise.all((await readdir(dir)).map(async name=>{
 const path=join(dir,name);return (await stat(path)).isDirectory()?walk(path):[path];
}))).flat();
const files=await walk('dist');
assert.ok(files.every(path=>!/(?:\.sqlite\w*|\.jsonl|\.env|\.py|\.map)$/i.test(path)),'Private/runtime files must not be published');
assert.ok(files.some(path=>/corpus-worker-.*\.js$/.test(path)),'Browser corpus worker missing');
const html=await readFile('dist/index.html','utf8');
const assets=[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m=>m[1]);
for(const asset of assets){assert.ok(asset.startsWith('./'),'Asset must work under a repository subpath: '+asset);await stat(join('dist',asset));}
for(const path of files.filter(path=>path.endsWith('.js'))){const source=await readFile(path,'utf8');assert.ok(!/127\.0\.0\.1:8765|localhost:8765|fetch\(["'`]\/api\//.test(source),'Legacy Python dependency in '+path);}
console.log(`Pages artifact verified: ${files.length} static files, relative assets and browser analysis worker.`);
