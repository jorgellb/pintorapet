# Facturas — diseño

Fecha: 2026-10-23 · Estado: aprobado por el usuario, pendiente de plan

## Objetivo

La web emite automáticamente una factura por cada pedido pagado, conforme a la normativa española de facturación (RD 1619/2012), con IVA desglosado por tipo, y queda preparada para Veri\*factu (huella encadenada y QR). El envío de registros a la AEAT es una fase posterior.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Quién emite | La propia web |
| IVA por producto | Tipo editable por producto (21, 10, 4, 0 %); por defecto 21 %; 10 % para una futura categoría `originals` |
| Destinos sin IVA español | Canarias, Ceuta, Melilla y fuera de la UE: se descuenta el IVA del precio (piezas y envío) |
| Factura completa | Casilla en el pago «Necesito factura con NIF» |
| Entrega a la clienta | Enlace de descarga en la página de estado del pedido; sin email |
| Fuera de alcance | Rectificativas, libro trimestral, envío a AEAT, OSS |

## 1. IVA en el cálculo del pedido

- `products.vat_rate numeric(4,2) NOT NULL DEFAULT 21 CHECK (vat_rate IN (0, 4, 10, 21))`. Variantes heredan el tipo del padre (mismo patrón que `weight_grams`). Trigger de alta: categoría `originals` → 10, resto → 21.
- `shop_settings.invoice_config jsonb` incluye `shippingVatRate` (por defecto 21).
- Régimen fiscal del destino, calculado en SQL por `vat_regime(country, postal_code)`:
  - `es_vat`: España peninsular y Baleares, y países de la UE (IVA español; umbral OSS de 10.000 €/año fuera de alcance).
  - `no_vat`: códigos postales 35, 38 (Canarias), 51 (Ceuta), 52 (Melilla), y países fuera de la UE.
- Los precios de catálogo y de las zonas de envío siguen siendo IVA incluido.
- `create_checkout_quote`:
  - Para cada línea guarda en el JSON `vat_rate`, `unit_gross_cents` (precio catálogo), `unit_net_cents = round(gross / (1 + rate/100))`.
  - Con `es_vat`: el importe cobrado por línea es el bruto. Con `no_vat`: el neto.
  - El envío se trata igual con `shippingVatRate`.
  - Nuevas columnas en `checkout_quotes`: `vat_regime`, `vat_discount_cents` (diferencia descontada; 0 con `es_vat`).
  - `subtotal_cents` y `shipping_cents` reflejan lo cobrado; `tax_cents` sigue en 0 (el IVA va incluido), manteniendo la restricción `total = subtotal + shipping + tax`.
- `shipping_quote` y `/api/shipping/estimate` devuelven `vatRegime` y el importe descontado para que el carrito muestre «IVA no aplicable a tu destino: −X €» y los totales correctos.
- El trigger AFTER INSERT de `checkout_attempts` copia `vat_regime` al pedido (`orders.vat_regime`).

## 2. Datos fiscales del emisor

`shop_settings.invoice_config` (jsonb), editable en «Ajustes › Datos fiscales»:

```json
{
  "issuerName": "", "issuerNif": "", "issuerAddress": "", "issuerPostalCode": "",
  "issuerCity": "", "issuerKind": "autonomo|sociedad",
  "simplifiedPrefix": "S", "fullPrefix": "F",
  "shippingVatRate": 21, "verifactuEnabled": false
}
```

El NIF del emisor se valida (NIF/NIE/CIF con dígito de control) en el endpoint y en SQL. `invoice_config_complete()` devuelve si hay nombre, NIF válido y dirección.

## 3. Factura completa a petición

- En la tarjeta «1 Envío a» del checkout: casilla «Necesito factura con NIF» que despliega NIF/CIF, nombre o razón social, dirección, CP, ciudad, país.
- Validación: NIF/NIE/CIF español con dígito de control si el país es ES; en otro caso, 4–20 caracteres alfanuméricos.
- Se envía en el presupuesto (`invoiceRequest`) y se guarda en `checkout_quotes.invoice_customer jsonb`; el trigger lo copia a `orders.invoice_customer`.

## 4. Emisión

Tablas:

- `invoice_series (code text PK, year int, next_number int)`; fila por prefijo y año.
- `invoices`:
  - `id`, `order_id` (unique), `kind` (`simplified` | `full`; Veri\*factu F2 / F1), `series`, `number`, `full_number` (`S2026-0001`), `issued_at timestamptz`, `operation_date date`.
  - Copias fijas: `issuer jsonb`, `customer jsonb` (solo `full`), `lines jsonb` (descripción, cantidad, precio unitario neto, tipo, base, cuota, total), `breakdown jsonb` (por tipo: base, cuota), `base_cents`, `vat_cents`, `total_cents`, `vat_regime`, `exemption_note`, `locale`.
  - Veri\*factu: `prev_hash`, `hash`, `record_generated_at` (con huso), `qr_url`, `aeat_status` (`not_sent` | `pending` | `accepted` | `rejected`), `aeat_response jsonb`.
- Inmutabilidad: trigger BEFORE UPDATE rechaza cambios salvo `aeat_status` y `aeat_response`; BEFORE DELETE siempre rechaza. RLS: lectura solo admin; escritura solo por funciones SECURITY DEFINER.

Función `issue_invoice(p_order_id uuid) RETURNS uuid` (SECURITY DEFINER, `search_path = pg_catalog, public, extensions`):

1. Bloquea el pedido; si ya tiene factura, la devuelve (idempotente).
2. Exige pedido `paid` e `invoice_config_complete()`; si no, lanza `INVOICE_CONFIG_INCOMPLETE` / `INVOICE_ORDER_NOT_PAID`.
3. Elige serie (`full` si `orders.invoice_customer` existe), bloquea la fila de `invoice_series` del año con `FOR UPDATE` y toma el número (sin huecos).
4. Construye líneas desde `order_items` + JSON del presupuesto (tipo de IVA por línea) más la línea de envío. Base = round(total / (1 + tipo)), cuota = total − base, sumadas por tipo. Con `no_vat`: tipo 0 y nota de exención.
5. Huella: `prev_hash` = huella de la última factura (cualquier serie, orden por `record_generated_at, id`, bajo un `pg_advisory_xact_lock`). Cadena según la especificación AEAT de registro de alta: `IDEmisorFactura=…&NumSerieFactura=…&FechaExpedicionFactura=dd-mm-aaaa&TipoFactura=F1|F2&CuotaTotal=…&ImporteTotal=…&Huella=…&FechaHoraHusoGenRegistro=aaaa-mm-ddThh:mm:ss+hh:mm`, SHA-256 en hexadecimal mayúsculas. El formato exacto se valida contra la documentación oficial durante la implementación, con un test de vector conocido.
6. `qr_url`: URL de cotejo de la AEAT con `nif`, `numserie`, `fecha`, `importe`.

Disparo: trigger AFTER UPDATE en `orders` cuando `payment_status` pasa a `paid`; llama a `issue_invoice` dentro de un bloque `EXCEPTION` que, si falla (p. ej. datos fiscales incompletos), deja el pedido pagado sin factura. Nunca bloquea el cobro.

`admin_issue_pending_invoices()` emite todas las pendientes en orden de `paid_at`.

## 5. PDF

- Ruta del servidor que genera el PDF al vuelo desde la fila de `invoices` (nunca desde el pedido actual). Librería: `pdf-lib` con la fuente de la web incrustada si su licencia lo permite; si no, Helvetica.
- Contenido: título («Factura simplificada» / «Factura»), número, fecha de expedición y de operación, emisor, cliente (completa), líneas, desglose por tipo, total, nota de exención si procede. Con `verifactuEnabled`: QR (generado en servidor) y leyenda «Factura verificable en la sede electrónica de la AEAT» / «VERI\*FACTU».
- Idioma: el del pedido (ES/EN).

Rutas:

- Admin: `GET /api/admin/orders/[id]/invoice` (PDF), `POST /api/admin/orders/[id]/invoice` (emitir), `POST /api/admin/invoices/issue-pending`.
- Clienta: `GET /api/orders/invoice?ref=…&token=…` — mismo control de acceso que `/api/orders/lookup` (hash del token); 404 si no hay factura.

## 6. Panel y web pública

- Producto: campo «IVA» (select) en el fieldset Venta.
- Ajustes: sección «Datos fiscales» con el formulario anterior y el interruptor Veri\*factu (desactivado, con texto explicativo). Aviso si hay pedidos con factura pendiente y botón «Emitir pendientes».
- Ficha de pedido: bloque «Factura» con número, tipo, fecha, descarga, o «Factura pendiente» con botón «Emitir».
- Listado de pedidos: número de factura bajo la referencia.
- Carrito/checkout: línea «IVA no aplicable a tu destino» y casilla de factura completa.
- Estado del pedido: enlace «Descargar factura» cuando existe.

## 7. Errores

Nuevos códigos en `pgErrors.ts`: `INVOICE_CONFIG_INCOMPLETE` (409), `INVOICE_ORDER_NOT_PAID` (409), `INVOICE_IMMUTABLE` (409), `INVALID_TAX_ID` (400). Mensajes en español en el panel.

## 8. Pruebas

- Unitarias (vitest): validación NIF/NIE/CIF; cálculo base/cuota y redondeo; huella con vector conocido; formato de número.
- SQL dentro de transacción revertida: régimen por destino, presupuesto con descuento de IVA, emisión idempotente, numeración sin huecos con dos pedidos, rechazo de UPDATE/DELETE, encadenado de huellas.
- Navegador: carrito a Canarias muestra el descuento; checkout con NIF; ficha de pedido con factura y PDF; estado del pedido con enlace.
- e2e existentes siguen pasando.

## Riesgos y límites

- Sin rectificativas: una cancelación o devolución tras emitir requiere corrección manual por la gestoría.
- El conector de envío a la AEAT (certificado electrónico, SOAP) es la siguiente fase; obligatorio antes del 1-1-2027 (sociedades) o 1-7-2027 (autónomos) según el calendario vigente.
- Ventas a particulares de la UE por encima de 10.000 €/año requieren OSS.
- Tipos de IVA y régimen de destino deben confirmarse con la gestoría.
