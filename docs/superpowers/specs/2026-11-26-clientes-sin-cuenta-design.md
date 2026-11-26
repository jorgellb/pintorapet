# Clientes sin cuenta: editar y borrar datos — diseño

Fecha: 2026-11-26 · Estado: aprobado por Jorge

## Para qué

En Admin › Clientes, los clientes sin cuenta (compraron como invitados) no se pueden editar ni borrar: no tienen ficha, sus datos viven dentro de sus pedidos. Jorge quiere las dos cosas. Borrar tiene que respetar la ley: los pedidos y las facturas se conservan; se anonimizan los datos personales (derecho de supresión del RGPD).

## Decisiones de Jorge

- Editar el contacto de un cliente sin cuenta **y** borrar (anonimizar) sus datos.
- Aprobó el diseño propuesto (abajo), incluida la casilla al borrar un cliente con cuenta.

## Comportamiento

### Quién es «un cliente sin cuenta»
Pedidos con `customer_id is null` que comparten el mismo email (sin distinguir mayúsculas). La ficha se identifica con una clave opaca: sha256 hex de `lower(trim(email))` (el email no va en la URL).

### Ficha
`/admin/customers/guest/<clave>/`: nombre, email, teléfono (de su pedido más reciente), pedidos (enlace a cada uno), total gastado. En Admin › Clientes el nombre de un cliente sin cuenta enlaza aquí (se mantiene «Crear cuenta →»). Si hay mensajes de Contacto o solicitudes de encargo con ese email: aviso con enlace a esas pantallas (no se tocan aquí).

### Editar contacto
Nombre, email y teléfono. Se aplican a **todos** sus pedidos sin cuenta: `customer_name`, `customer_email`, y `shipping_address.phone` (y `shipping_address.name` si coincidía con el nombre anterior). La dirección de envío no se edita aquí (cada pedido puede tener otra). Las facturas ya emitidas no cambian (son inmutables por ley). Si el email nuevo ya es de otro cliente sin cuenta, sus pedidos pasan a formar una sola ficha (se avisa antes). Si el email nuevo es el de una cuenta existente, se rechaza con «Ese email es de un cliente con cuenta: usa su ficha».

### Borrar datos (anonimizar)
Tras confirmarlo en un diálogo que explica lo que se borra y lo que se conserva:
- **Se rechaza** si alguno de sus pedidos está pendiente: por cobrar (`pending_session`, `checkout_open`, `processing`, `awaiting_transfer`, `review`) o pagado y sin enviar ni entregar (fulfillment no `shipped`/`delivered`/`completed`/`cancelled`). Mensaje con las referencias.
- En cada pedido: `customer_name = 'Cliente borrado'`, `customer_email = null`, `shipping_address` → solo `{country, postal_code}`, `gift_message = null`, `is_gift = false`. `invoice_customer` se conserva **solo** si el pedido tiene factura completa emitida (la factura es el registro legal); si no, `null`.
- `checkout_attempts.stripe_payload` de esos pedidos → `null` (contiene email y nombre de Stripe).
- `notification_outbox`: se borran las filas de ese destinatario (ya enviadas o pendientes).
- `coupon_redemptions`: `email` y `payer_email` de esos pedidos (y de ese email) → `null`.
- Opiniones de esos pedidos: se borran con sus fotos (privadas y públicas) mediante el borrado existente de opiniones.
- Facturas: no se tocan. La pantalla lo dice: «Las facturas ya emitidas se guardan con sus datos porque la ley obliga a conservarlas».
- Registro de Admin (`audit`): «Datos de cliente borrados», con el número de pedidos; **sin** el email ni el nombre.
- Atómico: todo lo de base de datos en una transacción; las fotos de Cloudinary después (si fallan, la opinión ya está oculta/borrada de la web y se avisa).

### Cliente con cuenta
En «Borrar cliente», casilla «Borrar también sus datos de los pedidos» (desmarcada por defecto). Marcada: antes de borrar la cuenta se comprueba la misma regla de pedidos pendientes; tras borrarla, se anonimizan sus pedidos (los de su cuenta y los sin cuenta con su email) igual que arriba.

## No objetivos
- Mensajes de Contacto y solicitudes de encargo (tienen su pantalla).
- Editar la dirección de envío desde la ficha.
- Deshacer un borrado.
- Tocar facturas emitidas.

## Restricciones
- Migración nueva `supabase/migrations/20261126000012_guest_customers.sql`; funciones `SECURITY DEFINER` con comprobación `is_admin()` (o llamadas solo con el rol de servicio desde rutas con `requireAdmin`), sin editar migraciones aplicadas; comparar con producción el cuerpo de cualquier función existente que se reemplace.
- Pruebas: `scripts/sql-check-guest-customers.py` (transacción revertida), vitest, Playwright local; sin correos reales.
- Admin en español.
