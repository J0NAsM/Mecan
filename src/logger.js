import { now, id } from './utils.js';

const redactKeys=new Set(['password','password_hash','csrf','csrf_token','token','token_hash','content','cookie','authorization']);
function sanitize(value,depth=0){
  if(depth>4)return '[truncated]';
  if(Array.isArray(value))return value.slice(0,20).map(item=>sanitize(item,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,redactKeys.has(key.toLowerCase())?'[redacted]':sanitize(item,depth+1)]));
  if(typeof value==='string'&&value.length>1000)return `${value.slice(0,1000)}…`;
  return value;
}
function write(level,event,context={}){process[level==='error'?'stderr':'stdout'].write(`${JSON.stringify({timestamp:now(),level,event,...sanitize(context)})}\n`);}
export const logger={info:(event,context)=>write('info',event,context),warn:(event,context)=>write('warn',event,context),error:(event,context)=>write('error',event,context)};
export const requestId=()=>id();
