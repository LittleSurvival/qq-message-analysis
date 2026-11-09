// QCE embeds raster avatars as data URLs. Never resolve remote or relative sources.
const MAX_AVATAR_LENGTH=2*1024*1024;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function avatarDataURL(value){
 if(typeof value!=='string'||value.length>MAX_AVATAR_LENGTH)return null;
 const match=value.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/i);
 if(!match||match[2].length%4!==0)return null;
 // A valid prefix avoids accepting HTML or SVG disguised as a raster image.
 let bytes;try{bytes=atob(match[2].slice(0,32));}catch{return null;}
 const mime=bytes.startsWith('\x89PNG\r\n\x1a\n')?'png':bytes.startsWith('\xff\xd8\xff')?'jpeg':/^GIF8[79]a/.test(bytes)?'gif':bytes.startsWith('RIFF')&&bytes.slice(8,12)==='WEBP'?'webp':null;
 return mime?`data:image/${mime};base64,${match[2]}`:null;
}
export function avatarMarkup(member,name,{anonymous=false,className='avatar'}={}){
 const source=anonymous?null:avatarDataURL(member.avatar);
 return `<span class="${escape(className)} member-avatar"><span aria-hidden="true">${escape([...String(name||'?')][0])}</span>${source?`<img data-avatar src="${source}" alt="" decoding="async">`:''}</span>`;
}
export function installAvatarFallback(root){
 root.addEventListener('error',event=>{if(event.target.matches?.('img[data-avatar]'))event.target.remove();},true);
}
export function anonymousMember(member,name){const {avatar,...rest}=member;return {...rest,id:name,name};}
