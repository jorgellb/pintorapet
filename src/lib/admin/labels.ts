export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

type Label = { text: string; tone: Tone };

const commission: Record<string, Label> = {
  received: { text: 'Nuevo', tone: 'warn' },
  reviewing: { text: 'En revisión', tone: 'info' },
  quoted: { text: 'Presupuestado', tone: 'info' },
  accepted: { text: 'Aceptado', tone: 'ok' },
  declined: { text: 'Rechazado', tone: 'neutral' },
  closed: { text: 'Cerrado', tone: 'neutral' },
};

const payment: Record<string, Label> = {
  pending_session: { text: 'Sin pagar', tone: 'neutral' },
  checkout_open: { text: 'Pagando', tone: 'info' },
  processing: { text: 'Procesando', tone: 'info' },
  paid: { text: 'Pagado', tone: 'ok' },
  expired: { text: 'Caducado', tone: 'neutral' },
  cancelled: { text: 'Cancelado', tone: 'neutral' },
  partially_refunded: { text: 'Reembolso parcial', tone: 'warn' },
  refunded: { text: 'Reembolsado', tone: 'neutral' },
  review: { text: 'Revisar', tone: 'danger' },
};

const fulfillment: Record<string, Label> = {
  unfulfilled: { text: 'Por preparar', tone: 'warn' },
  preparing: { text: 'Preparando', tone: 'info' },
  shipped: { text: 'Enviado', tone: 'ok' },
  completed: { text: 'Entregado', tone: 'ok' },
};

const inventory: Record<string, Label> = {
  unverified: { text: 'Sin verificar', tone: 'warn' },
  tracked: { text: 'Con stock', tone: 'ok' },
  made_to_order: { text: 'Bajo pedido', tone: 'ok' },
};

const productStatus: Record<string, Label> = {
  draft: { text: 'Borrador', tone: 'neutral' },
  published: { text: 'Publicado', tone: 'ok' },
  archived: { text: 'Archivado', tone: 'neutral' },
};

const workCategory: Record<string, string> = {
  dog: 'Perros',
  cat: 'Gatos',
  horse: 'Caballos',
  people: 'Personas',
  other: 'Otros',
};

const galleryGroup: Record<string, string> = {
  people: 'Personas',
  architecture: 'Arquitectura',
  illustration: 'Ilustración',
  other: 'Otros',
};

const productCategory: Record<string, string> = {
  'greeting-cards': 'Tarjetas',
  coasters: 'Posavasos',
  mugs: 'Tazas',
};

function pick(map: Record<string, Label>, key: string | null | undefined): Label {
  return (key && map[key]) || { text: key || '—', tone: 'neutral' };
}

export const commissionLabel = (key: string | null | undefined) => pick(commission, key);
export const paymentLabel = (key: string | null | undefined) => pick(payment, key);
export const fulfillmentLabel = (key: string | null | undefined) => pick(fulfillment, key);
export const inventoryLabel = (key: string | null | undefined) => pick(inventory, key);
export const productStatusLabel = (key: string | null | undefined) => pick(productStatus, key);

export const workCategoryLabel = (key: string | null | undefined) =>
  (key && workCategory[key]) || key || '—';
export const galleryGroupLabel = (key: string | null | undefined) =>
  (key && galleryGroup[key]) || key || '—';
export const productCategoryLabel = (key: string | null | undefined) =>
  (key && productCategory[key]) || key || '—';

export function chipClass(tone: Tone): string {
  return tone === 'neutral' ? 'chip' : `chip chip--${tone}`;
}

export function euros(cents: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(
    cents / 100,
  );
}

export function shortDate(value: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
  }).format(new Date(value));
}
