export class AppError extends Error {
  constructor(message,{status=400,code='BAD_REQUEST',details=null,cause=null}={}){
    super(message,{cause});this.name='AppError';this.status=status;this.code=code;this.details=details;
  }
}

export function publicError(error){
  if(error instanceof AppError||error?.status)return {status:error.status||400,message:error.message||'No se pudo completar la operación.',code:error.code||'REQUEST_FAILED'};
  const text=String(error?.message||'');
  if(text.includes('UNIQUE constraint failed'))return {status:409,message:'Ya existe un registro con esos datos. Revisa los campos únicos.',code:'DUPLICATE'};
  if(text.includes('FOREIGN KEY constraint failed'))return {status:409,message:'La operación no puede completarse porque el registro está siendo utilizado.',code:'REFERENCE_CONFLICT'};
  if(text.includes('inventory_negative'))return {status:409,message:'La operación dejaría el inventario con existencias negativas.',code:'INSUFFICIENT_STOCK'};
  if(text.includes('tenant_mismatch'))return {status:422,message:'Uno de los registros seleccionados no pertenece a este taller.',code:'TENANT_MISMATCH'};
  if(text.includes('CHECK constraint failed'))return {status:422,message:'Uno de los valores no cumple las reglas del negocio.',code:'INVALID_VALUE'};
  return {status:500,message:'Ocurrió un error inesperado. Intenta nuevamente o contacta a soporte.',code:'INTERNAL_ERROR'};
}
