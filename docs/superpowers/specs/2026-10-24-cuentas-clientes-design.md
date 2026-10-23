# Cuentas de clientes — diseño

Fecha: 2026-10-24 · Estado: decisiones aprobadas por el usuario

## Decisiones

| Tema | Decisión |
|---|---|
| Acceso | Email y contraseña (Supabase Auth), con recuperación por email |
| Compra sin cuenta | Sigue existiendo; la cuenta es opcional |
| Pedidos visibles | Los enlazados a la cuenta y todos los hechos con su email confirmado |
| Facturas | Descarga de la factura de cada pedido y petición de factura completa con NIF para pedidos ya pagados |

## Fases

1. **Cuentas**: registro, entrar, salir, recuperar contraseña, confirmación de email, ficha de cliente, panel con pedidos y detalle, checkout relleno y enlazado.
2. **Facturas descargables**: «Datos fiscales» en el admin, PDF (`pdf-lib`), descarga en panel de cliente y admin.
3. **Factura con NIF a petición**: factura completa que sustituye a la simplificada (Veri\*factu `F3`).

## Fase 1 · Cuentas

### Datos

- `customers` (`id` = `auth.users.id`): `full_name`, `phone`, `address jsonb` (`line1, line2, city, state, postal_code, country`), `billing jsonb` (forma `InvoiceCustomer`), `created_at`, `updated_at`. RLS: cada usuario lee, crea y edita solo su fila.
- `orders.customer_id uuid` (FK `auth.users`, `ON DELETE SET NULL`) + índices en `customer_id` y `lower(customer_email)`.
- Funciones `SECURITY DEFINER` para `authenticated`:
  - `customer_orders()`: pedidos del usuario (por `customer_id`, o por email si está confirmado). Oculta intentos abandonados (`pending_session`, `checkout_open`, `expired`, `cancelled`).
  - `customer_order(p_reference)`: detalle con piezas, dirección, envío y facturas. `ORDER_NOT_FOUND` si no es suyo.

### Web

Rutas (ES/EN): `cuenta` / `account`, `cuenta/entrar`, `cuenta/registro`, `cuenta/recuperar`, `cuenta/nueva-contrasena`, `cuenta/datos`, `cuenta/pedidos/<referencia>`.

- Formularios del servidor (funcionan sin JavaScript); sesión con cookies de `@supabase/ssr` (PKCE).
- `/api/auth/callback/`: canjea `code` (o `token_hash`) por sesión y redirige a `next` (solo rutas locales).
- `/api/auth/logout/`: cierra sesión.
- Registro con aceptación de la política de privacidad. Si Supabase exige confirmar el email, se muestra «revisa tu correo».
- Recuperar contraseña responde siempre lo mismo, exista o no la cuenta.
- Cabecera: enlace «Cuenta» a la zona de cliente.
- Checkout: con sesión, el formulario se rellena con la ficha y el pedido queda con `customer_id`; casilla «Guardar estos datos en mi cuenta».

### Requisitos de despliegue (Supabase, a mano)

- SMTP propio (p. ej. Resend) en Auth: el SMTP por defecto solo envía a miembros del equipo y con límite por hora.
- URL del sitio y `https://<dominio>/api/auth/callback/` en la lista de redirecciones permitidas.

## Fase 2 · Facturas descargables

Completa el plan de facturas (`2026-10-23-facturas.md`): ajustes fiscales del emisor en el admin, PDF desde la fila de `invoices`, descarga para el cliente (`/api/account/invoices/<id>`) y el admin.

## Fase 3 · Factura con NIF a petición

- `invoices.replaces_invoice_id` (único); el único por pedido pasa a índice parcial sobre facturas que no sustituyen a otra.
- `request_full_invoice(p_reference, p_customer jsonb)` para el cliente: valida NIF; si el pedido aún no tiene factura, guarda los datos y emite la completa; si tiene simplificada, emite una completa `F3` con las mismas líneas e importes que la sustituye. Idempotente.
- Las lecturas que esperaban una factura por pedido toman la vigente.

## Fuera de alcance

Login con Google, borrado de cuenta desde el panel, rectificativas por devolución, envío a la AEAT.
