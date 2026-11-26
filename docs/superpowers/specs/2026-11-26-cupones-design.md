# Cupones de descuento — diseño

Fecha: 2026-11-26 · Estado: para aprobar (revisado por un constructor)

## Para qué

Descuentos ocasionales que Meili publica en Instagram (y comparte como quiera).
Solo en la **tienda online**. Admin necesita un apartado **Cupones** con muchas
opciones, para crear cupones con cualquier combinación de reglas.

## Objetivos

- Crear, editar, pausar, duplicar y archivar cupones desde Admin › Cupones.
- Reglas combinables (todas opcionales salvo código y tipo) — ver «Reglas».
- El cliente lo escribe en la caja, o llega con un enlace `?cupon=CODIGO` que lo deja puesto.
- El descuento es el de verdad en todas partes: total cobrado, pedido, correo, factura, devoluciones.
- Funciona con tarjeta (Stripe), PayPal y recogida en mercado.
- Estadísticas por cupón: usos, € descontados, ventas con el cupón, lista de pedidos.

## No objetivos

- Tarjetas regalo, saldos, monederos: descartado por Jorge.
- Cupones en **encargos** (página de pago del presupuesto): no llevan cupón.
- Cupones en pedidos por teléfono (Bizum/transferencia manuales) y en ventas del puesto del mercado.
- Más de un cupón por pedido; cupones que se acumulan entre sí.
- Precios rebajados de catálogo («antes/ahora») sin código.

## Anti-objetivos (sería un fracaso aunque funcione)

- Que el navegador pueda decidir o alterar el descuento: el cálculo es del servidor (base de datos), como el resto del precio.
- Que una factura no cuadre con lo cobrado, o que una devolución devuelva más de lo pagado.
- Que un cupón con límite de usos se pueda gastar muchas veces a la vez abriendo varias pestañas.
- Que un pedido pagado quede bloqueado o se pierda por un problema del cupón: si el cliente ya pagó, el pedido sigue.

## Decisiones de Jorge

- Solo tienda; los encargos no tienen cupón.
- **Envío gratis después del descuento**: el umbral de envío gratis de la zona (p. ej. 60 €) se compara con el subtotal ya descontado.
- Uso: descuentos ocasionales para Instagram; configurables por usos, por cliente, etc.; «todas las opciones posibles».

## Enfoque

Considerados:

1. **En la base de datos, dentro del cálculo del precio (elegido).** `create_checkout_quote` recibe el código, valida las reglas y reparte el descuento por las líneas; el presupuesto guarda el cupón y el descuento; `reserve_checkout` aparta un uso; `apply_payment` lo confirma. Es donde ya vive todo el precio (huella de precio, IVA por régimen, envío por zona), así que vale para Stripe, PayPal y recogida sin tocar cada pasarela, y la factura sale sola con el precio rebajado.
2. **Cupones/códigos promocionales de Stripe.** No sirven con PayPal ni con recogida, y el importe del pedido y la factura dejarían de coincidir con lo cobrado. Descartado.
3. **Calcular el descuento en el servidor TypeScript y pasarlo a la base de datos.** Parte la verdad del precio en dos sitios y obliga a confiar en un número que la base de datos no comprueba. Descartado.

## Reglas de un cupón

Identidad
- **Código**: 3–30 caracteres `A–Z 0–9 - _`, único sin distinguir mayúsculas; se guarda en mayúsculas.
- **Nombre interno / nota** (solo Admin).
- **Estado**: activo, pausado, archivado (los archivados no se pueden usar ni aparecen por defecto).

Tipo de descuento (uno)
- **Porcentaje** (1–100 %) con **tope opcional** en €.
- **Importe fijo** en €.
- **Envío gratis** (el envío de la zona pasa a 0; con tope opcional en € de envío cubierto).
- **Compra X, llévate Y** (p. ej. 2x1, 3x2): de cada grupo de X+Y piezas que cumplan, las Y más baratas salen gratis.
- **Unidad N al Z %** (p. ej. segunda unidad al 50 %): en cada grupo de N piezas, la más barata con Z % de descuento.

A qué se aplica (las piezas «que cumplen»)
- Toda la tienda, o una selección de: **tipos de producto** (`categories`: tazas, posavasos, tarjetas…), **categorías de la tienda** (`shop_collections`), **productos concretos**.
- **Productos excluidos** (siempre ganan).
- El descuento solo afecta a las piezas que cumplen; el resto del carrito paga precio normal.

Condiciones del pedido
- **Compra mínima** en € (sobre las piezas que cumplen, antes del descuento).
- **Mínimo de piezas** que cumplen.
- **Zonas de envío** permitidas (lista de `shipping_zones`) y/o **recogida en mercado** sí/no.

Quién
- **Solo primera compra**: ningún pedido pagado antes con ese email ni con esa cuenta, sea de la web, por teléfono, recogida o encargo, aunque se devolviera después (*decisión del diseñador*).
- **Solo clientes con cuenta** (sesión iniciada).
- **Lista de emails** permitidos (cupones personales), con una casilla **«exigir cuenta»** por cupón (decisión de Jorge): marcada, solo vale si se ha iniciado sesión con uno de esos emails; sin marcar, basta con el email escrito en la caja (se puede usar con el email de otro).

Cuándo
- **Desde / hasta** (fecha y hora, Europe/Madrid). Sin fecha = siempre.
- **Días de la semana** permitidos (p. ej. solo sábado y domingo). Vacío = todos.

Límites
- **Usos totales** (máximo de pedidos con el cupón).
- **Usos por cliente** (por email normalizado y por cuenta).

Escaparate
- **Anunciar en la web**: franja discreta en la tienda con el código y el descuento mientras el cupón esté vigente. Solo un cupón anunciado a la vez (el último marcado sustituye al anterior).

## Cómo se comporta

### Cálculo (base de datos)

- Todos los importes del cupón (importe fijo, tope, compra mínima) y el umbral de envío gratis se miden en **precio de catálogo con IVA**, el que el cliente ve en la tienda. El descuento se calcula sobre esos precios y, para quien compra sin IVA (Canarias, Ceuta, Melilla, fuera de la UE), después se quita el IVA de cada línea ya rebajada, igual que hoy. Así un cliente de Canarias recibe el mismo descuento proporcional y el umbral se juzga como hoy («v_subtotal stays catalog-gross»), pero restando el descuento (*decisión del diseñador*). `shipping_quote` necesita recibir el subtotal descontado o el descuento.
- Orden: piezas que cumplen → condiciones → descuento → **envío** (umbral de envío gratis con el subtotal ya descontado) → total.
- Importe fijo mayor que las piezas que cumplen: el descuento se limita a su importe (nunca total negativo; el envío no se descuenta salvo en el tipo «envío gratis»).
- El descuento de las piezas se **reparte entre las líneas** que cumplen en proporción a su importe, en céntimos enteros, y el céntimo sobrante va a la línea mayor.
- En **«Compra X, llévate Y»** y **«Unidad N al Z %»** el importe se calcula con las unidades más baratas de cada grupo, pero se **reparte entre todas las unidades del grupo**, no se deja una unidad a 0 € (*decisión del diseñador*). Así una devolución de cualquier pieza devuelve lo que de verdad costó de media (2x1 de dos tazas de 10 €: cada una queda a 5 €), y nadie devuelve la pagada y se queda la gratis.
- Dentro de una línea, el descuento se reparte por unidades para que **cada unidad tenga un precio entero** (Stripe y PayPal cobran precio unitario × cantidad). Si no divide exacto, el redondeo va a favor del cliente: como mucho unos céntimos más de descuento (*decisión del diseñador*, en lugar de partir la línea en dos filas: así no cambian ni la reserva de stock ni las pasarelas). `unit_price_cents × quantity = line_subtotal_cents` sigue siendo cierto y **factura y devoluciones no cambian**: devuelven lo que de verdad se pagó por esa unidad.
- El descuento nunca deja el pedido por debajo de **0,50 €** (mínimo de Stripe) ni una unidad por debajo de 0 €.
- El presupuesto (`checkout_quotes`) guarda: cupón, código, descuento total, y en cada línea `catalog_price_cents`, precio antes y después del cupón. El cupón entra en la **huella de precio**: si el cupón cambia o deja de valer entre presupuesto y pago, el presupuesto caduca como cuando cambia un precio.
- El pedido (`orders`) guarda una **foto** del cupón: id, código y descuento en céntimos, para que editar o borrar un cupón no cambie pedidos pasados.

### Usos (sin gastarlo de más con varias pestañas)

- Tabla de usos del cupón, como las reservas de stock: al reservar (`reserve_checkout`) se aparta un uso **bloqueando la fila del cupón** y comprobando límites (totales y por cliente) contra usos apartados + confirmados.
- El uso apartado se libera cuando el intento de pago caduca o se cancela (mismo camino que libera el stock).
- Al pagar (`apply_payment`), el uso pasa a confirmado. Si el uso apartado ya había caducado y el límite está lleno, **el pedido se acepta igual** (el cliente pagó de buena fe) y se marca la incidencia en el pedido para que Admin la vea; no se manda a revisión.
- Una devolución total no devuelve el uso (el cupón se usó).
- Las reglas de «quién» (primera compra, con cuenta, lista de emails, usos por cliente) se comprueban al reservar, que es cuando se conoce el email del formulario de la caja.

### En la caja (web)

- Enlace «¿Tienes un cupón?» que abre un campo; «Aplicar» vuelve a pedir el presupuesto con el código.
- Bien: línea «Cupón NAVIDAD10 −5,00 €» en el resumen, precios de las piezas afectadas tachados con el nuevo debajo, botón para quitarlo.
- Mal: mensaje claro en ES/EN según el motivo: no existe, caducado, aún no empieza, hoy no vale (día de la semana), mínimo de compra (con lo que falta), ninguna pieza del carrito cumple, no vale para esa zona o para recogida, solo primera compra, solo con cuenta, ya usado, agotado.
- `?cupon=CODIGO` en cualquier página pública guarda el código en el navegador (no es sensible) y avisa con una nota pequeña; la caja lo aplica sola. Si no vale, la caja lo dice y no impide comprar.
- La pista de «te faltan X € para el envío gratis» de la caja usa el subtotal descontado. Las pistas del carrito y de la tienda (antes de la caja) no saben del cupón y siguen como están.
- Un código pausado, archivado o inexistente da el mismo mensaje («no existe o no vale»). Sin límite de intentos (*decisión del diseñador*: el antibot existente es para formularios; los códigos de Instagram son públicos y los personales con «exigir cuenta» no sirven a otros).

### Donde se ve después

- Página del pedido en «Mi cuenta» y Admin › Pedidos: línea del cupón y descuento. (Los correos de confirmación no muestran importes hoy; no cambian.)
- Admin › Pedidos: el cupón en la ficha del pedido.
- Factura: líneas con el precio ya rebajado (el descuento va incluido en el precio unitario, válido para Hacienda). Sin nota aparte (*decisión del diseñador*: añadirla obligaría a tocar la emisión encadenada de Verifactu sin necesidad legal).

### Admin › Cupones

- Lista: código, tipo y valor, a qué se aplica, vigencia, usos / límite, estado, anunciado; filtro activos / pausados / archivados.
- Formulario con secciones plegables en el orden de «Reglas»; resumen en lenguaje natural arriba que se actualiza al cambiar opciones («−10 % en tazas y posavasos, del 1 al 24 de diciembre, una vez por cliente, máx. 100 usos»).
- Acciones: guardar, pausar/activar, duplicar, archivar. Borrar solo si nunca se ha usado.
- Ficha con estadísticas y la lista de pedidos que lo usaron.
- Cambiar reglas de un cupón ya usado está permitido; afecta solo a pedidos nuevos (los presupuestos abiertos caducan por la huella).

## Restricciones

- Mismo stack: Astro SSR, Aiven PostgreSQL con funciones `SECURITY DEFINER` y RLS emulada; migraciones nuevas, nunca editar las aplicadas.
- Comprobar antes de modificar `create_checkout_quote`, `create_pickup_quote`, `shipping_quote`, `reserve_checkout`, `apply_payment` y la liberación de reservas que el cuerpo en producción coincide con la última migración.
- Pruebas: script SQL `scripts/sql-check-coupons.py` (transacción revertida) y comprobación de que los checks existentes siguen pasando; vitest; Playwright local con capturas; nada de correos reales ni facturas reales.
- Textos de la web en ES y EN.

## Lo que queda para quien construya

- Esquema exacto de tablas (cupón con sus listas de productos/tipos/categorías/zonas/emails, usos) y nombres de columnas.
- Cómo se pasa el código por `quotes.ts` y la API de presupuesto; validación con zod.
- Detalle de la UI de Admin y de la caja siguiendo los estilos existentes.
- Cálculo exacto de «Compra X lleva Y» y «Unidad N al Z %» cuando hay varias piezas de distinto precio (las más baratas son las rebajadas).
