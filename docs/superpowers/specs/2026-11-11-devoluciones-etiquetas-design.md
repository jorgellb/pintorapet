# Devoluciones, facturas rectificativas, etiqueta y albarán

Fecha: 2026-11-11. Admin › Pedidos › un pedido.

## Qué resuelve

Hasta ahora, si Meili devolvía dinero desde Stripe o PayPal la web no se enteraba: el
pedido seguía «Pagado», el stock no volvía y no había factura rectificativa (obligatoria
cuando se devuelve una venta ya facturada). Tampoco había forma de imprimir nada para el
paquete sin Correos conectado.

## Devoluciones

- **Por piezas.** Meili elige cuántas unidades de cada línea devuelve y si devuelve el
  envío. El importe es la suma de lo cobrado por esas unidades (precio unitario × cantidad)
  más el envío. Así la rectificativa reparte el IVA exactamente igual que la factura. No hay
  importe libre: no se podría repartir por tipos de IVA.
- **Por Stripe o PayPal**, según cómo pagó la clienta, con clave de idempotencia = id de la
  devolución (si algo falla a medias, «Reintentar» no devuelve dos veces).
- **«Ya lo devolví fuera»**: registra una devolución hecha desde el panel de Stripe/PayPal
  sin volver a llamarles.
- **Stock**: casilla «Volver a poner en stock» (marcada si el pedido no se ha enviado). Solo
  afecta a productos con stock controlado; deja un movimiento `return_restock`.
- **Estado del pago**: `partially_refunded` o `refunded` cuando lo devuelto llega al total.
- **Email a la clienta** con el importe devuelto.
- **Una devolución en curso por pedido** (índice único parcial); no se puede devolver más
  de lo que queda por devolver, ni dos veces la misma unidad o el envío.
- **Cancelar pedido** = devolver todo lo que queda y reponer stock, antes de enviarlo.

Flujo: `admin_begin_refund` valida y guarda la devolución `pending` → el servidor llama a
Stripe/PayPal → `admin_complete_refund` (o `admin_fail_refund`). Una devolución que quedó
`pending` (fallo de red) se reintenta con la misma clave.

### Devoluciones hechas desde Stripe/PayPal (webhooks)

Stripe `refund.created` / `refund.updated` y PayPal `PAYMENT.CAPTURE.REFUNDED`:

- Si la devolución ya está registrada (mismo id del proveedor), se completa si estaba
  pendiente; si no, se ignora.
- Si cubre todo lo que queda, se registra como devolución total (sin reponer stock).
- Si es parcial, queda «sin asignar»: el pedido avisa del importe y Meili indica qué piezas
  con «Ya lo devolví fuera»; el importe tiene que coincidir.

## Factura rectificativa (Veri*factu)

- **Por diferencias** (importes en negativo), una por devolución.
- **Tipo R5** si rectifica una simplificada; **R1** si rectifica una completa (art. 80.Dos
  LIVA: devolución).
- **Serie propia**: prefijo `R` (`invoice_config.rectifyingPrefix`), numeración por año.
- Encadenada en la misma huella que el resto de facturas.
- Líneas: las piezas devueltas con el tipo de IVA de la línea correspondiente de la factura
  original (mismo orden que `issue_invoice`), más el envío si se devuelve.
- Si aún no hay datos fiscales, la devolución se hace igual y la rectificativa queda
  pendiente: «Emitir pendientes» (y `admin_issue_pending_invoices`) emite primero la factura
  original y luego sus rectificativas, por orden.
- Tras una rectificativa ya no se puede pedir la factura completa en lugar de la
  simplificada.

## Etiqueta y albarán (sin Correos)

- **Etiqueta de dirección**: PDF A6 con remitente (Envíos › remitente) y destinataria,
  referencia del pedido y peso. Para pegar en el paquete y franquear en la oficina.
- **Albarán**: PDF A4 con las piezas y cantidades (sin precios, por si es un regalo), la
  nota de la clienta y un agradecimiento.
