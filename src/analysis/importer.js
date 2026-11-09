import { JSONParser } from '@streamparser/json';
import { avatarDataURL } from '../shared/avatars.js';
import { createAnalyzer } from './analysis.js';

export async function analyzeFile(file, filters = {}, progress = () => {}) {
  const analyzer = createAnalyzer(filters);
  const avatars = new Map(), memberUins = new Map();
  const jsonl = /\.(jsonl|ndjson)$/i.test(file.name || '');
  let info = {}, expected = null, hasMessages = false, read = 0;
  const parser = new JSONParser({
    paths: jsonl ? ['$'] : ['$.messages', '$.messages.*', '$.chatInfo', '$.statistics.totalMessages', '$.avatars.*'],
    keepStack: false,
    ...(jsonl ? { separator: '' } : {}),
  });
  parser.onValue = ({ value, key, stack, parent }) => {
    if (jsonl || stack.length === 2 && stack[1].key === 'messages') {
      if (!jsonl && !Array.isArray(parent)) throw new Error('messages 必須是陣列。');
      analyzer.add(value);
      const sender=value?.sender;
      if(sender?.uid && sender.uin && String(sender.uin)!=='0'){
        const id=String(sender.uid);if(!memberUins.has(id))memberUins.set(id,new Set());
        memberUins.get(id).add(String(sender.uin));
      }
      // The array selector validates empty arrays; explicitly release each child.
      if (!jsonl) delete parent[key];
    }
    else if (key === 'messages') {
      if (!Array.isArray(value)) throw new Error('messages 必須是陣列。');
      hasMessages = true;
    } else if (key === 'chatInfo') info = { name: String(value?.name || '未命名聊天'), type: value?.type };
    else if (stack.length===2 && stack[1].key==='avatars') {
      const avatar=avatarDataURL(value);if(avatar)avatars.set(String(key),avatar);
      delete parent[key];
    }
    else if (key === 'totalMessages') expected = value;
  };
  const reader = file.stream().getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let last = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      read += value.byteLength;
      parser.write(decoder.decode(value, { stream: true }));
      if (performance.now() - last > 100) {
        progress({ bytes: read, size: file.size, messages: analyzer.quality.read });
        last = performance.now();
      }
    }
    const tail = decoder.decode();
    if (tail) parser.write(tail);
    if (!parser.isEnded) parser.end();
  } finally { reader.releaseLock(); }
  if (!jsonl && !hasMessages) throw new Error('找不到 messages 陣列。請選擇 QCE 單檔 JSON；manifest.json 不含聊天內容，請改選 chunks 內的 JSONL。');
  if (jsonl && !analyzer.quality.read) throw new Error('JSONL 內沒有訊息。');
  progress({ bytes: read, size: file.size, messages: analyzer.quality.read });
  const report=analyzer.finish();
  for(const member of report.members){
    const uins=memberUins.get(member.id);
    const avatar=avatars.get(member.id)||(uins?.size===1?avatars.get([...uins][0]):null);
    if(avatar)member.avatar=avatar;
  }
  return { ...report, chat: info, expected, source: file.name, mode: jsonl ? 'JSONL 分塊' : 'QCE JSON' };
}
