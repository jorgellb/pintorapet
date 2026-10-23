# Guía del panel (ES)

## Acceso

1. Invita el email de la artista en Supabase Auth (sin contraseña por defecto en este repo).
2. Define `ADMIN_BOOTSTRAP_EMAIL` y ejecuta `pnpm admin:bootstrap` con la service role.
3. Abre `/admin/login/` y pide un magic link.
4. No hay registro público de administración.

## Productos

- Edita título, resumen y descripción en **inglés y español**.
- Añade imágenes del catálogo; la primera es la portada.
- El precio se guarda en céntimos EUR.
- Guarda borradores incompletos; la publicación exige textos e imágenes suficientes.

## Inventario

- Los productos migrados llegan con disponibilidad **por confirmar** y venta desactivada.
- Introduce el stock real o confirma fabricación bajo pedido.
- Solo entonces activa la venta.

## Pedidos y encargos

- Los pedidos de la tienda aparecen tras el pago confirmado (webhook Stripe).
- Las solicitudes de retrato llegan a Encargos con archivos privados.
