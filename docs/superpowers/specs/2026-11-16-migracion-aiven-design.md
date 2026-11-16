# Base de datos y login fuera de Supabase: Aiven + Better Auth

Fecha: 2026-11-16. Toda la web.

## Qué resuelve

Supabase restringió el proyecto al agotar el cupo de tráfico del plan gratuito
(`exceed_cached_egress_quota`): su API REST, su login y Storage responden 402. Las imágenes
ya salen de Cloudinary (commit `d7402ca`), pero carrito, pago, cuenta de clienta y admin
siguen caídos porque hablan con la base de datos a través de la API de Supabase
(`supabase-js` → PostgREST) y se identifican con Supabase Auth. La conexión directa a
PostgreSQL de Supabase sigue funcionando: es por donde se copian los datos.

Destino: PostgreSQL 18 en Aiven (plan gratuito, DigitalOcean Ámsterdam) y Better Auth para
el login. Sin tarjeta.

## Lo que no cambia

- **El esquema y su lógica.** Las 32 migraciones siguen siendo la fuente de verdad: tablas,
  funciones (`admin_*`, checkout, facturas Verifactu, devoluciones…), triggers y políticas
  RLS se crean en Aiven reproduciéndolas en orden.
- **El modelo de permisos.** Las funciones y políticas usan `auth.uid()` y los roles
  `anon` / `authenticated` / `service_role`. Se reproducen igual que en Supabase (ver
  abajo), así que una consulta pública sigue sin poder ver un producto no publicado aunque
  al reescribirla se olvide un filtro.
- **Los ids.** Usuarios, pedidos, facturas… conservan su uuid.

## Base de datos en Aiven

### Preludio «como Supabase» (`supabase/aiven/00_prelude.sql`)

Antes de las migraciones, para que se apliquen sin tocarlas:

- Roles `anon`, `authenticated`, `service_role` (NOLOGIN), concedidos a `avnadmin`, y los
  privilegios por defecto de Supabase sobre `public` (tablas, secuencias y funciones para
  los tres). Las migraciones luego revocan lo que revocaban.
- Esquema `auth`: `auth.users` (la tabla de usuarios de Better Auth, ver Login) y
  `auth.uid()`, `auth.role()`, `auth.jwt()` leyendo `request.jwt.claims`, que es
  exactamente como lo hace Supabase/PostgREST.
- Esquema `storage` con `buckets` y `objects` mínimos: dos migraciones antiguas crean
  buckets y políticas. Quedan sin uso (las imágenes están en Cloudinary).
- Esquema `vault` (`secrets`, `create_secret`, `update_secret`, `decrypted_secrets`) para
  los secretos de Stripe, PayPal y Correos, cifrados con `pgcrypto`
  (`pgp_sym_encrypt`). La clave **no está en la base de datos**: la pone la app en cada
  conexión (`app.vault_key`, desde la variable `VAULT_KEY` de Vercel). Sin la clave no se
  puede leer ningún secreto.

Se valida primero en un PostgreSQL 18 local (Docker) con los `scripts/sql-check-*.py`
existentes, y después se aplica en Aiven.

### Datos

Se copian desde Supabase por la conexión directa, tabla a tabla, con los triggers de
usuario desactivados durante la carga (para que, p. ej., la numeración de facturas o el
bloqueo de facturas emitidas no reescriban ni rechacen filas históricas) y las secuencias
ajustadas al final. Comprobación: recuento de filas y suma de control por tabla en origen
y destino. Los secretos del vault se descifran en Supabase y se cifran con `VAULT_KEY` en
Aiven, sin imprimirse.

No hace falta congelar la tienda: con la API de Supabase bloqueada no entra ningún cambio.

### Conexiones

Aiven gratis admite 20 conexiones (17 útiles). Cada instancia de función usa un pool `pg`
de máximo 3 conexiones que se cierran a los 10 s sin uso. Las funciones de Vercel pasan
de `iad1` (Washington) a `fra1` (Fráncfort, a pocos ms de Ámsterdam) con `"regions"` en
`vercel.json`.

### Copias de seguridad

El plan gratuito de Aiven no hace copias. Un workflow diario de GitHub Actions hace
`pg_dump`, lo cifra con una contraseña (secreto del repositorio) y lo guarda como artefacto
(90 días). Las facturas hay que conservarlas años: además, cada mes se guarda una copia que
no caduca (release privada del repositorio).

## Acceso a datos en el código

`src/lib/server/db.ts`:

- Un pool `pg` (SSL verificado con el certificado de Aiven, `AIVEN_CA_CERT`).
- `sql` como plantilla etiquetada → consulta parametrizada (nunca concatenar valores).
- Tres contextos, cada uno en una transacción:
  - `asService(tx => …)`: el usuario dueño, como hoy el cliente con service role.
  - `asAnon(tx => …)`: `SET LOCAL ROLE anon`; para las lecturas públicas.
  - `asUser(userId, tx => …)`: `SET LOCAL ROLE authenticated` + `request.jwt.claims` con
    `sub = userId`, para que RLS y `auth.uid()` funcionen como con Supabase.

Cada `.from(...)`/`.rpc(...)` se reescribe 1:1 en SQL con los mismos filtros, orden y forma
del resultado; las relaciones anidadas (`media_translations(locale, alt_text)`) pasan a
subconsultas `json_agg`; los `.rpc('fn', { p_x })` a `select fn(p_x => $1)`. Los errores de
PostgreSQL mantienen el formato que ya interpreta `mapPgError`.

Los tests unitarios que simulan el cliente de Supabase se adaptan; las consultas se prueban
contra el PostgreSQL local con el esquema real.

## Login con Better Auth

Tablas en el esquema `auth`: `users` (uuid, email, nombre, verificado, fechas),
`session`, `account` (contraseña), `verification`. `customers.id`, `orders.customer_id` y
`site_home_*.updated_by` siguen apuntando a `auth.users(id)`.

| Hoy (Supabase) | Con Better Auth |
|---|---|
| Entrar con email y contraseña | `signInEmail` |
| Registrarse (email de confirmación) | `signUpEmail` con verificación por email |
| Olvidé la contraseña → enlace → nueva | `requestPasswordReset` → enlace → `resetPassword` |
| Admin: enlace mágico | plugin `magicLink` |
| Admin › Clientes: crear, borrar, cambiar email, enlace de contraseña | API de servidor de Better Auth sobre las mismas tablas |
| Cerrar sesión | `signOut` |

- Los correos salen por Resend, con las plantillas actuales.
- Las rutas propias (`/api/auth/login`, `/register`…) se mantienen; el manejador de Better
  Auth vive en `/api/session/*` (verificación de email y enlaces).
- **La única cuenta** (la admin, también clienta con 4 pedidos de prueba) conserva su id.
  Su contraseña de Supabase está en bcrypt; si coincide con `ADMIN_PASSWORD` se guarda con
  el formato de Better Auth y entra igual que antes; si no, entra con enlace mágico y la
  cambia.
- Sesión: cookie de Better Auth; el middleware la lee como hoy lee la de Supabase.

## Corte

1. Esquema + datos en Aiven; comprobación de recuentos.
2. Variables en Vercel: `DATABASE_URL`, `AIVEN_CA_CERT`, `VAULT_KEY`, `BETTER_AUTH_SECRET`.
3. Desplegar. Probar en producción: tienda, carrito, pago (Stripe/PayPal en modo real, sin
   completar), cuenta, admin.
4. Supabase queda como copia de solo lectura hasta comprobar todo; luego se quitan sus
   variables y `@supabase/*`.

## Riesgos

- **Reescribir ~200 consultas.** Un filtro olvidado: lo frena RLS en lo público y lo de
  clienta; en el admin, los tests y la prueba manual.
- **Aiven gratis:** 20 conexiones, sin copias (las hacemos nosotros), para instancias sin
  uso (con tráfico, no aplica).
- **Better Auth** es una dependencia nueva (revisada con npmscan: sin vulnerabilidades ni
  scripts de instalación; se fija una versión con semanas de rodaje).
