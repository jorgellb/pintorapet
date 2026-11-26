const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Contact messages and commission requests with a customer's email hold their
 * email and name, and Admin has no way to delete either: this tells Meili they
 * exist and that they stay (null: nothing to say).
 */
export function guestNotice(contactMessages: number, commissionRequests: number): string | null {
  const parts = [
    contactMessages > 0 ? `${plural(contactMessages, 'mensaje', 'mensajes')} de Contacto` : null,
    commissionRequests > 0 ? plural(commissionRequests, 'encargo', 'encargos') : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return `Tiene ${parts.join(' y ')} con este email: no se borran aquí. Por ahora no se pueden borrar desde Admin; si te lo piden, avísanos.`;
}
