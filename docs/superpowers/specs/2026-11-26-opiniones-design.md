# Opiniones de clientes con foto — diseño

Fecha: 2026-11-26 · Estado: para aprobar (revisado por un constructor)

## Para qué

Que quien llega a la web vea a otros clientes contentos con su retrato o su pieza, **con foto en casa**, y se anime a comprar o encargar. Hoy solo hay tres capturas de mensajes en Contacto («Palabras amables»).

## Decisiones de Jorge

- **Dos vías**:
  - Meili añade opiniones desde Admin, con los mensajes que ya le llegan por Instagram o WhatsApp.
  - El cliente escribe la suya desde un enlace personal; Meili la aprueba antes de publicarla.
- **Estrellas de 1 a 5, opcionales.**
- **Dónde se ven**:
  - portada;
  - ficha de producto (las de ese producto);
  - página de Encargos (las de encargos);
  - Contacto («Palabras amables» pasa a mostrar estas opiniones en lugar de las capturas).

## Objetivos

- Admin › Opiniones: lista por estado (Pendientes, Publicadas, Ocultas), crear, publicar, ocultar, destacar en portada, borrar.
- Formulario público para el cliente con su enlace: texto, estrellas opcionales, hasta 3 fotos, nombre como quiere que salga, ciudad y nombre de la mascota (opcionales), y consentimiento para publicar.
- Un enlace por pedido, que llega:
  - en el correo de «tu pedido está en camino»;
  - en «Mi cuenta» (ficha del pedido);
  - en Admin › Pedidos, con un botón «Copiar enlace de opinión» para mandarlo por WhatsApp (sirve también para recogidas y encargos).
- Aviso por correo a Meili cuando llega una opinión nueva.
- Las opiniones se muestran con sus fotos ampliables (visor como el de Mercados), en ES y EN.
- SEO: valoración media y opiniones en el JSON-LD de la ficha de producto, solo con opiniones de compradores reales de ese producto que tengan estrellas.

## No objetivos

- Respuestas públicas de Meili a una opinión.
- Recordatorio automático por correo días después de la entrega (no hay estado «entregado» fiable).
- Premiar la opinión con un cupón (se podría añadir después con los cupones).
- Traducir opiniones: se muestran en el idioma en que se escribieron.
- Importar automáticamente desde Instagram o Google.

## Anti-objetivos

- Que cualquiera publique sin moderación, o que la web acepte spam o fotos que no son imágenes.
- Publicar el nombre completo, el email o la cara de alguien sin su consentimiento.
- Presentar como «compra verificada» una opinión que no viene de un pedido.
- Estrellas en Google basadas en opiniones inventadas o de la propia Meili.

## Enfoque

Una sola forma sensata: reutilizar las piezas que ya funcionan en el proyecto.

- **Enlace personal con clave guardada como hash**, como el enlace de pago de encargos (`pay_token_hash`).
- **Fotos del cliente en Cloudinary privado** mientras están pendientes, como las fotos de encargos (`commissionPhotos.ts`). Comprobación por bytes del tipo de imagen y tamaño máximo.
- **Al aprobar**, la foto se copia a una carpeta pública de opiniones en Cloudinary (ver «Fotos»). Las opiniones de Admin eligen directamente fotos de Medios (selector `pickMedia`).
- Se descartaron:
  - un servicio externo de reseñas (Trustpilot, Google), que sale de la marca y de la web, y no permite fotos del retrato en casa con este control;
  - publicar sin moderar.

## Cómo se comporta

### Datos

- `reviews`:
  - `source`: `customer` o `admin`;
  - `status`: `pending`, `published`, `hidden`;
  - `kind`: `product`, `commission` o `general`;
  - `order_id` (si viene de un pedido), `product_id` (si es de un producto), `commission_request_id`;
  - `author_name` (como quiere salir), `city`, `pet_name`;
  - `body` (texto, hasta 1500 caracteres) y `locale` (idioma en que se escribió);
  - `rating` (1–5 o vacío);
  - `featured` (portada), `verified` (viene de un pedido pagado);
  - `consent_at`, `created_at`, `published_at`.
- Fotos: hasta 3 por opinión, con orden, con texto alternativo «Retrato de {mascota} en casa de {nombre}» (*decisión del diseñador* en todo este punto):
  - Las del cliente se guardan privadas.
  - Al **publicar**, se crea una copia pública en una carpeta propia de opiniones en Cloudinary. No aparece en Medios, para que nadie la borre sin querer.
  - Al **ocultar**, se borra la copia pública y se conserva la privada; si vuelve a publicarse, se copia otra vez.
  - Al **borrar** la opinión, se borran todas.
  - Las fotos de opiniones de Admin se eligen de Medios; si Meili borra esa imagen en Medios, desaparece de la opinión.
- Un enlace por pedido; vale 120 días desde el pago (`paid_at`, también cuando se marca pagado a mano). Una opinión por pedido.
- **La clave del enlace se calcula, no se guarda** (*decisión del diseñador*): HMAC del id del pedido con un secreto del servidor (`REVIEW_LINK_SECRET`, con respaldo en `BETTER_AUTH_SECRET` separado por prefijo). El correo, «Mi cuenta» y el botón de Admin dan siempre el mismo enlace, y copiarlo no rompe el que ya se envió. No hace falta revocarlo: sirve para una sola opinión y caduca.
- **Qué pedidos tienen enlace y cuentan como «Compra verificada»** (*decisión del diseñador*): los que tienen `paid_at` y están `paid` o `partially_refunded` (tarjeta, PayPal, Bizum, transferencia, teléfono, recogidas y encargos pagados). Un pedido devuelto entero o cancelado no tiene enlace; si se devuelve después de opinar, la opinión deja de contar como verificada y sale del JSON-LD.
  - Si el pedido tiene varios productos, el cliente elige de cuál habla o «del pedido en general».
  - En un pedido de encargo es una opinión de encargo.

### El cliente

- Página `/es/opinion/?r=REF&k=CLAVE` (y EN), sin cuenta.
- Muestra qué pidió (miniaturas) y luego:
  - estrellas opcionales (cinco botones accesibles);
  - el texto;
  - las fotos (hasta 3, que el móvil reduce antes de subir, como en encargos);
  - «Cómo quieres que aparezca tu nombre» (por defecto el nombre e inicial del apellido: «Ana G.»);
  - ciudad y nombre de la mascota (opcionales);
  - casilla de consentimiento obligatoria: «Acepto que Pets Drawings publique mi opinión, el nombre que he indicado y las fotos en su web».
- Tras enviar: «Gracias. Meili la leerá antes de publicarla.».
- Si vuelve con el enlace, ve su opinión enviada (no puede enviar otra). Puede cambiarla mientras esté pendiente **y Meili no la haya tocado**; después queda cerrada. Cambiarla no manda otro aviso a Meili (*decisión del diseñador*).
- Protección:
  - la clave del enlace;
  - el control antibot ya existente de los formularios;
  - tamaño y tipo de foto comprobados;
  - un límite de fotos por opinión, con bloqueo para subidas simultáneas, como en encargos.

### Meili (Admin › Opiniones)

- Pestañas Pendientes (con número), Publicadas y Ocultas.
- Cada opinión muestra estrellas, texto, fotos, nombre, ciudad, mascota, y de qué pedido o producto viene (con «Compra verificada» si `verified`).
- Acciones: Publicar, Ocultar, Destacar en portada, Borrar.
  - Al publicar, las fotos se hacen públicas (ver «Fotos»).
  - Borrar quita también sus fotos privadas.
- Meili puede corregir el nombre visible, la ciudad y la mascota, y cambiar a qué producto se asocia **solo entre los productos de ese pedido** o «en general» (*decisión del diseñador*: una compra verificada nunca da estrellas a un producto que no se compró). **No** puede cambiar el texto ni las estrellas de una opinión de cliente. Las opiniones de Admin sí son editables enteras.
- «Nueva opinión»: el mismo formulario, con fotos elegidas de Medios. Puede asociarse a un producto o encargo. Nunca sale como «Compra verificada».
- Correo a Meili cuando llega una pendiente (`review_admin`, como los avisos de encargos), con enlace a Admin.

### En la web

- **Portada**: sección «Lo que dicen» con hasta 6 opiniones **con foto**: primero las destacadas y, si faltan, las más recientes con foto (*decisión del diseñador*: el objetivo es la foto en casa). Sin ninguna con foto, la sección no aparece. Cada tarjeta lleva foto principal, estrellas, un extracto, nombre, ciudad y mascota. Enlace «Ver más» a Contacto.
- **Ficha de producto**: «Opiniones» con las publicadas de ese producto, valoración media si hay estrellas, y fotos ampliables. Si no hay ninguna, la sección no aparece.
- **Encargos**: las publicadas de tipo encargo **con foto**, con la foto del retrato en casa en grande. La ficha de producto y Contacto muestran también las que no tienen foto.
- **Contacto**: «Palabras amables» muestra todas las publicadas (paginadas, 12 por página) en lugar de las capturas. Las capturas antiguas se pueden convertir en opiniones de Admin a mano.
- Textos en el idioma original, con su atributo `lang`. Las etiquetas de la interfaz van en ES/EN.
- Visor de fotos: el de Mercados, sacado a un componente común.

### SEO

- Ficha de producto: `aggregateRating` y hasta 10 `review` en el JSON-LD de `Product`, solo con opiniones publicadas, `verified`, de ese producto y con estrellas.
- Nada de valoraciones en la organización (Google no las acepta de la propia web).

## Restricciones

- Mismo stack: Astro SSR, Aiven PostgreSQL (RLS emulada, funciones `SECURITY DEFINER`), Cloudinary, outbox de correos con Resend.
- Migraciones nuevas, nunca editar las aplicadas. Antes de cambiar una función existente, comprobar que su cuerpo en producción coincide con la última migración.
- Pruebas:
  - script SQL `scripts/sql-check-reviews.py` (transacción revertida);
  - vitest;
  - Playwright en local con capturas;
  - sin correos reales (`delivered@resend.dev`);
  - borrar las subidas de prueba de Cloudinary.
- Textos públicos en ES y EN; Admin en español.

## Lo que queda para quien construya

- Nombres exactos de tablas y columnas, y de las funciones SQL.
- Detalle visual de las tarjetas siguiendo el estilo de cada página.
- Cómo se genera el extracto y la paginación.
