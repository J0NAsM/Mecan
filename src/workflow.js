import { AppError } from './errors.js';

export const ORDER_STATUS = {
  RECEIVED: 'RECEIVED',
  INSPECTION: 'INSPECTION',
  DIAGNOSIS: 'DIAGNOSIS',
  ESTIMATE: 'ESTIMATE',
  AWAITING_APPROVAL: 'AWAITING_APPROVAL',
  AUTHORIZED: 'AUTHORIZED',
  IN_PROGRESS: 'IN_PROGRESS',
  WAITING_PARTS: 'WAITING_PARTS',
  QUALITY_CONTROL: 'QUALITY_CONTROL',
  READY: 'READY',
  INVOICED: 'INVOICED',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
  DELIVERED: 'DELIVERED',
  CLOSED: 'CLOSED',
  CANCELED: 'CANCELED',
};
export const ORDER_LABELS = {
  RECEIVED: 'Recibida',
  INSPECTION: 'En inspección',
  DIAGNOSIS: 'En diagnóstico',
  ESTIMATE: 'Presupuesto en preparación',
  AWAITING_APPROVAL: 'Esperando autorización',
  AUTHORIZED: 'Autorizada',
  IN_PROGRESS: 'En reparación',
  WAITING_PARTS: 'Esperando repuestos',
  QUALITY_CONTROL: 'Control de calidad',
  READY: 'Lista para entregar',
  INVOICED: 'Facturada',
  PARTIALLY_PAID: 'Pago parcial',
  PAID: 'Pagada',
  DELIVERED: 'Entregada',
  CLOSED: 'Cerrada',
  CANCELED: 'Cancelada',
};
export const allowedTransitions = {
  RECEIVED: ['INSPECTION', 'DIAGNOSIS', 'CANCELED'],
  INSPECTION: ['DIAGNOSIS', 'CANCELED'],
  DIAGNOSIS: ['ESTIMATE', 'CANCELED'],
  ESTIMATE: ['AWAITING_APPROVAL', 'CANCELED'],
  AWAITING_APPROVAL: ['AUTHORIZED', 'ESTIMATE', 'CANCELED'],
  AUTHORIZED: ['IN_PROGRESS', 'WAITING_PARTS', 'CANCELED'],
  IN_PROGRESS: ['WAITING_PARTS', 'QUALITY_CONTROL'],
  WAITING_PARTS: ['IN_PROGRESS', 'CANCELED'],
  QUALITY_CONTROL: ['IN_PROGRESS', 'READY'],
  READY: ['INVOICED'],
  INVOICED: ['PARTIALLY_PAID', 'PAID', 'READY'],
  PARTIALLY_PAID: ['PAID', 'INVOICED'],
  PAID: ['DELIVERED', 'READY', 'INVOICED', 'PARTIALLY_PAID'],
  DELIVERED: ['CLOSED'],
  CLOSED: [],
  CANCELED: [],
};
export function assertTransition(from, to, { action, total } = {}) {
  if (
    !allowedTransitions[from]?.includes(to) ||
    (from === 'PAID' && to === 'READY' && (action !== 'INVOICE_VOIDED' || Number(total) !== 0)) ||
    (['PAID', 'PARTIALLY_PAID'].includes(from) &&
      ['INVOICED', 'PARTIALLY_PAID'].includes(to) &&
      action !== 'CUSTOMER_PAYMENT_REVERSED')
  )
    throw new AppError(
      `No se puede pasar de “${ORDER_LABELS[from] || from}” a “${ORDER_LABELS[to] || to}”.`,
      { status: 409, code: 'INVALID_TRANSITION' },
    );
}
export function assertOrderState(order, allowed, action) {
  if (!allowed.includes(order.status))
    throw new AppError(
      `No se puede ${action} mientras la orden está “${ORDER_LABELS[order.status] || order.status}”.`,
      { status: 409, code: 'INVALID_ORDER_STATE' },
    );
}
