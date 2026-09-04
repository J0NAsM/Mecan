import { AppError } from './errors.js';

export function required(value,label,{min=1,max=255}={}){
  const text=String(value??'').trim();
  if(text.length<min)throw new AppError(`${label} es obligatorio.`,{status:422,code:'VALIDATION_ERROR'});
  if(text.length>max)throw new AppError(`${label} no puede superar ${max} caracteres.`,{status:422,code:'VALIDATION_ERROR'});
  return text;
}
export function optional(value,{max=1000}={}){const text=String(value??'').trim();if(text.length>max)throw new AppError(`El texto no puede superar ${max} caracteres.`,{status:422});return text||null;}
export function email(value){const text=required(value,'El email',{max:254}).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text))throw new AppError('Ingresa un email válido.',{status:422});return text;}
export function positive(value,label='El importe',{allowZero=false,max=1_000_000_000_000}={}){const number=Number(value);if(!Number.isFinite(number)||(allowZero?number<0:number<=0)||number>max)throw new AppError(`${label} debe ser ${allowZero?'cero o ':''}mayor que cero.`,{status:422});return number;}
export function integer(value,label,{min=0,max=10_000_000}={}){const number=Number(value);if(!Number.isInteger(number)||number<min||number>max)throw new AppError(`${label} no es válido.`,{status:422});return number;}
export function oneOf(value,allowed,label='El valor'){if(!allowed.includes(value))throw new AppError(`${label} no es válido.`,{status:422});return value;}
export function isoDate(value,label='La fecha'){const date=new Date(value);if(!value||Number.isNaN(date.getTime()))throw new AppError(`${label} no es válida.`,{status:422});return date.toISOString();}
export function password(value){const text=String(value||'');if(text.length<10||!/[a-z]/.test(text)||!/[A-Z]/.test(text)||!/[0-9]/.test(text))throw new AppError('La contraseña debe tener al menos 10 caracteres, mayúscula, minúscula y número.',{status:422});return text;}
