# Prompt maestro para Cursor · Pets Drawings

Auditoría de referencia: 21 de octubre de 2026. Sitio original: https://petsdrawings.com/.

Este documento es el encargo completo. Léelo íntegramente antes de implementar. Las decisiones de diseño y arquitectura son requisitos del nuevo proyecto; los datos identificados como observados proceden del sitio y de su API pública. Revalida los datos al ejecutar la migración y documenta cualquier cambio posterior a la auditoría.

---

## 0. Tu misión y tu manera de trabajar

Actúa como responsable técnico y director de diseño de un estudio especializado en webs de artistas y comercio electrónico. Debes diseñar e implementar una web completa para **Pets Drawings by Meili Stringfellow**, rehaciendo el sitio en **Astro 7**, con **Supabase**, **Stripe Checkout** y despliegue preparado para **Vercel**.

El resultado debe sentirse como la web de una artista con una identidad propia: una galería contemporánea, íntima y editorial, con una tienda integrada con naturalidad. La calidad visual tiene que proceder de la composición, las imágenes reales, la tipografía, el ritmo y el detalle. El sistema de venta debe funcionar de verdad.

### Objetivos obligatorios

1. Conservar todas las secciones y el contenido relevante de la web actual en inglés y español.
2. Migrar las imágenes existentes y mantener la relación de cada fotografía con su dibujo, su proyecto y su producto.
3. Integrar los **18 productos existentes y sus 47 imágenes distintas**, con sus precios verificados en EUR.
4. Crear tienda, ficha de producto, carrito y compra como invitado con Stripe Checkout.
5. Crear un panel privado para que la artista gestione productos, traducciones, imágenes, disponibilidad, inventario y pedidos.
6. Entregar una implementación que compile, se pueda probar, tenga migraciones reproducibles y esté preparada para Vercel.
7. Cuidar cada pantalla y cada estado: escritorio, móvil, carga, error, vacío, agotado, pago pendiente y confirmación.

### Instrucciones de ejecución

- Implementa el proyecto; un documento de planificación por sí solo no completa este encargo.
- Inspecciona primero el repositorio y sus instrucciones. Si está vacío, inicializa el proyecto. Si contiene trabajo, conserva lo que sea útil y evita sobrescribir cambios ajenos.
- Crea un plan breve y un registro de tareas persistente. Continúa con la implementación sin pedir confirmación para cada decisión reversible.
- Usa los valores y la arquitectura de este documento como decisiones por defecto.
- Consulta documentación oficial para las APIs que vayas a utilizar. Verifica versiones y compatibilidades antes de instalar.
- Fija versiones efectivas en el lockfile. No actualices la versión mayor de Astro fuera de la 7 para seguir una etiqueta `latest`.
- Si faltan credenciales, termina el código, las migraciones, las pantallas y las pruebas que puedas realizar. Deja la integración preparada y especifica exactamente qué configuración externa falta.
- No declares que un pago, un email, una subida o un despliegue funcionan si no se han comprobado.
- No simules autenticación en producción, no uses un carrito como fuente de precios y no publiques datos ficticios para completar huecos.
- No reduzcas el alcance a una landing page. No sustituyas productos, fotografías o proyectos reales por contenido de demostración.
- Deja constancia de los bloqueos reales y continúa con el trabajo independiente de ellos.
- Si la instalación permite agentes paralelos, aplica la organización del apartado 21. Si no, ejecuta los mismos paquetes secuencialmente.

## 1. Lo que ya sabemos de la web original

### 1.1 Identidad y actividad

- Marca: **Pets Drawings**.
- Artista: **Meili Stringfellow**.
- Actividad principal: retratos personalizados de mascotas a lápiz realizados a partir de fotografías.
- También hay retratos de personas, otras ilustraciones y trabajos relacionados con negocios y publicaciones.
- La biografía describe su trabajo desde un estudio en España y su participación en mercados locales.
- La tienda existente incluye diseños que sus descripciones atribuyen a Procreate y su aplicación a productos. Diferencia correctamente esa producción de los retratos tradicionales a lápiz.
- Email público: **info@petsdrawings.com**.
- Teléfono público: **+34 636386531**.
- Instagram observado: https://www.instagram.com/petsdrawings_meili/.
- Facebook observado: https://www.facebook.com/people/Pets-Drawings-by-Meili/100089998232163/.

No inventes premios, estudios, años de experiencia, número de clientes, materiales, disponibilidad, tiempos de entrega, ubicaciones más precisas ni testimonios.

### 1.2 Secciones actuales que hay que preservar

| Sección original | URL de origen en inglés | Función que debe mantener |
| --- | --- | --- |
| Home | `https://petsdrawings.com/` | Presentación artística, acceso al trabajo y últimos dibujos |
| About Me | `https://petsdrawings.com/about-me/` | Biografía, imágenes de la artista y su actividad |
| Work | `https://petsdrawings.com/work/` | Portfolio de mascotas con historias, dibujos y fotos de referencia |
| Extra gallery | `https://petsdrawings.com/gallery/` | Personas, arquitectura y otras ilustraciones |
| Order | `https://petsdrawings.com/order/` | Encargos, requisitos de fotografía, precios y ejemplos |
| Contact | `https://petsdrawings.com/contact/` | Email, teléfono, WhatsApp y Feedbacks |
| Privacy Policy | `https://petsdrawings.com/privacy-policy/` | Información sobre privacidad |
| Cookie Policy | `https://petsdrawings.com/cookie-policy/` | Información sobre cookies |

Las versiones actuales en español utilizan `/es/` y, en varias páginas, mantienen los slugs ingleses. Debes leerlas también: no asumas que el HTML inglés contiene las traducciones españolas.

También existen rutas de WooCommerce para `/shop/`, `/basket/`, `/checkout/`, `/my-account/`, productos y categorías. En la auditoría, la tienda y las fichas públicas muestran una pantalla de próxima apertura, aunque la API pública sí devuelve el catálogo. Por tanto, no concluyas que no existen productos al ver esa pantalla.

La portada contiene un anuncio de próxima tienda. Sustitúyelo por acceso real a la nueva tienda cuando esté configurada para vender. Conserva la función de las secciones; elimina los mensajes que hayan quedado obsoletos al implementar la nueva funcionalidad.

### 1.3 Hallazgos importantes

- El sitio procede de WordPress/WooCommerce y utiliza el tema Brooklyn. Su HTML incluye componentes y recursos que no deben arrastrarse al nuevo código.
- Hay carga diferida, imágenes dentro de sliders, atributos `data-*`, miniaturas, enlaces de lightbox y fondos CSS. Descargar solamente los `img[src]` perdería contenido.
- Hay archivos HEIC enlazados directamente y previsualizaciones JPEG derivadas de PDF.
- La API puede devolver USD por geolocalización. Añadir `currency=EUR` ha devuelto EUR y los importes indicados en este documento.
- La versión española también puede recibir el aviso de conversión a USD. El idioma no determina la moneda en la implementación actual.
- Las 47 imágenes del catálogo son recursos distintos, comprobados también mediante SHA-256 durante la auditoría. Las asociaciones originales contienen cuatro repeticiones de imágenes.
- Algunas etiquetas actuales son nombres de archivo, signos `+` o variantes ortográficas. No conviertas esos elementos técnicos en títulos editoriales sin revisar su contexto.
- La ficha de medios con ID `1813` declara `image/heic`, pero su `source_url` termina en `IMG_2523.jpg`. Trata esto como una inconsistencia que exige inspeccionar el archivo real.

## 2. Catálogo real: datos que debes respetar

### 2.1 Precios y categorías

Hay seis motivos de perros y tres categorías comerciales:

| Categoría | Nombre en español | Precio unitario observado en EUR | Importe para la aplicación |
| --- | --- | --- | --- |
| Greeting Cards | Tarjetas de felicitación | 3,49 € | `349` céntimos |
| Coasters | Posavasos | 4,99 € | `499` céntimos |
| Mugs | Tazas | 9,99 € | `999` céntimos |

Los motivos son Jack Russell Terrier, Border Collie, Dachshund, Golden Retriever, Labrador Retriever Black y Springer Spaniel. Mantén los **18 productos independientes**. No los reduzcas a tres productos con variantes porque eso cambiaría las fichas y la trazabilidad de la migración.

No deduzcas de una fotografía que se vende un pack de varios posavasos. No deduzcas capacidad de taza, materiales certificados, dimensiones o accesorios incluidos a partir del nombre de un archivo. Conserva lo que esté confirmado en la fuente y registra lo pendiente de especificar.

### 2.2 Inventario de productos

La siguiente tabla utiliza el nombre original como identificador de auditoría. Los nombres públicos finales deben tener una versión inglesa corregida y una española natural, sin cambiar el producto representado.

| ID Woo | Nombre original | Precio EUR | Categoría | IDs de imagen únicos, en orden | URL original |
| --- | --- | --- | --- | --- | --- |
| `2042` | Springer Spaniel Greeting Card portrait | 3,49 € | Tarjeta | `2043, 2045, 2044` | [Ficha original](https://petsdrawings.com/product/springer-spaniel-greeting-card-portrait/) |
| `1977` | Springer Spaniel Coaster Portrait | 4,99 € | Posavasos | `1978, 1979, 1980` | [Ficha original](https://petsdrawings.com/product/springer-spaniel-coaster-portrait/) |
| `1974` | Springer Spaniel Black mug portrait | 9,99 € | Taza | `1975, 1976` | [Ficha original](https://petsdrawings.com/product/springer-spaniel-black-mug-portrait/) |
| `1968` | Labrador Retriever Black Greeting Card portrait | 3,49 € | Tarjeta | `1970, 1971, 1969` | [Ficha original](https://petsdrawings.com/product/labrador-retriever-black-greeting-card-portrait/) |
| `1964` | Labrador Retriever Black coaster portrait | 4,99 € | Posavasos | `1965, 1966, 1967` | [Ficha original](https://petsdrawings.com/product/labrador-retriever-black-coaster-portrait/) |
| `1961` | Labrador Retriever Black mug portrait | 9,99 € | Taza | `1962, 1963` | [Ficha original](https://petsdrawings.com/product/labrador-retriever-black-mug-portrait/) |
| `1957` | Golden Retriever Greeting Card portrait | 3,49 € | Tarjeta | `1960, 1958, 1959` | [Ficha original](https://petsdrawings.com/product/golden-retriever-greeting-card-portrait/) |
| `1953` | Golden Retriever coaster portrait | 4,99 € | Posavasos | `1954, 1955, 1956` | [Ficha original](https://petsdrawings.com/product/golden-retriever-coaster-portrait/) |
| `1950` | Golden Retriever mug portrait | 9,99 € | Taza | `1951, 1952` | [Ficha original](https://petsdrawings.com/product/golden-retriever-mug-portrait-copy/) |
| `1944` | Dachshund Greeting Card portrait | 3,49 € | Tarjeta | `1945, 1946, 1947` | [Ficha original](https://petsdrawings.com/product/dachshund-greeting-card-portrait/) |
| `1940` | Dachshund coaster portrait | 4,99 € | Posavasos | `1942, 1941, 1943` | [Ficha original](https://petsdrawings.com/product/dachshund-coaster-portrait/) |
| `1937` | Dachshund mug portrait | 9,99 € | Taza | `1938, 1939` | [Ficha original](https://petsdrawings.com/product/dachshund-mug-portrait/) |
| `1826` | Border Collie Greeting Card portrait | 3,49 € | Tarjeta | `1827, 1828, 1829` | [Ficha original](https://petsdrawings.com/product/border-collie-greeting-card-portrait/) |
| `1822` | Border Collie coaster portrait | 4,99 € | Posavasos | `1823, 1824, 1825` | [Ficha original](https://petsdrawings.com/product/border-collie-coaster-portrait/) |
| `1817` | Border Collie mug portrait | 9,99 € | Taza | `1818, 1819` | [Ficha original](https://petsdrawings.com/product/border-collie-mug-portrait-copy/) |
| `1798` | Jack Russell Terrier coaster portrait | 4,99 € | Posavasos | `1799, 1800, 1801` | [Ficha original](https://petsdrawings.com/product/jack-russell-terrier-coaster-portrait/) |
| `1803` | Jack Russell Terrier Greeting Card portrait | 3,49 € | Tarjeta | `1804, 1805` | [Ficha original](https://petsdrawings.com/product/jack-russell-terrier-greeting-card-portrait/) |
| `1789` | Jack Russell Terrier mug portrait | 9,99 € | Taza | `1790, 1791` | [Ficha original](https://petsdrawings.com/product/jack-russell-terrier-mug-portrait/) |

En particular, revisa el significado de `Black` en los títulos originales: puede describir al perro. No lo traduzcas automáticamente como una taza negra si las fotografías muestran una taza blanca.

### 2.3 Imágenes repetidas en las asociaciones originales

| Producto original | Secuencia de IDs observada | Secuencia normalizada, conservando la primera aparición |
| --- | --- | --- |
| `1940` Dachshund coaster | `1942, 1941, 1942, 1943` | `1942, 1941, 1943` |
| `1822` Border Collie coaster | `1823, 1823, 1824, 1825` | `1823, 1824, 1825` |
| `1798` Jack Russell Terrier coaster | `1799, 1799, 1800, 1801` | `1799, 1800, 1801` |
| `1803` Jack Russell Terrier card | `1804, 1804, 1805` | `1804, 1805` |

El conjunto original tiene **51 referencias a imágenes y 47 recursos únicos**. Después de eliminar repeticiones dentro de cada producto, deben quedar 47 asociaciones. La tarjeta de Jack Russell tiene dos imágenes únicas: no inventes una tercera para completar la cuadrícula.

Conserva el orden de las galerías y la portada de cada producto. Los tamaños responsive y sus formatos derivados no cuentan como fotografías nuevas.

### 2.4 Verificación de precios

Consulta al ejecutar la migración:

`https://petsdrawings.com/wp-json/wc/store/v1/products?per_page=100&currency=EUR`

Comprueba explícitamente:

- `currency_code === "EUR"`.
- `currency_minor_unit === 2`.
- Precio regular, efectivo y posible rebaja, sin interpretar un `sale_price` idéntico al precio regular como promoción.
- Correspondencia del ID original con el título, la URL y las imágenes.
- Ausencia de variaciones o nuevos productos que hayan aparecido desde la auditoría.

Guarda la respuesta original, fecha, URL exacta y resultado normalizado. Si cambia algún precio respecto a la tabla, registra ambos valores y el motivo. Si hay fuentes contradictorias, marca el producto para revisión y no actives su venta con un importe elegido arbitrariamente.

Los valores USD observados sin forzar EUR eran 4, 6 y 12 dólares. **No los importes como 4, 6 y 12 euros ni apliques un tipo de cambio calculado por ti.**

## 3. Migración del contenido y de las imágenes

### 3.1 Fuentes y descubrimiento

Utiliza de forma complementaria:

- Páginas públicas inglesas y españolas.
- `https://petsdrawings.com/wp-sitemap.xml` y los sitemaps a los que enlaza.
- `https://petsdrawings.com/page-sitemap.xml`.
- `https://petsdrawings.com/product-sitemap.xml`.
- `https://petsdrawings.com/product_cat-sitemap.xml`.
- API pública de productos en EUR.
- API de páginas y medios de WordPress, cuando sea accesible.
- HTML renderizado o navegador, si es necesario para recursos diferidos y comprobaciones visuales.

No dependas solamente del inventario de medios de WordPress: contrástalo con las URLs realmente utilizadas por las páginas. Sigue la paginación de las APIs hasta terminar; no presupongas que una primera página es el inventario completo.

Limita la concurrencia del crawler, añade timeouts, reintentos con espera progresiva y caché local. Trabaja en lectura sobre la web original. No ejecutes acciones de compra, inicio de sesión ni escritura en el WordPress existente.

### 3.2 Entregables de la migración

Crea al menos:

| Archivo o carpeta | Contenido |
| --- | --- |
| `migration/source/` | Snapshots públicos de HTML y JSON utilizados, con fecha |
| `migration/pages.json` | Secciones, textos, idioma, orden y URL original |
| `migration/assets.json` | Inventario canónico de recursos y derivados |
| `migration/products.json` | Los productos normalizados, traducciones, precios y relaciones |
| `migration/artworks.json` | Proyectos, textos y relaciones entre foto, dibujo y otros recursos |
| `migration/redirects.json` | Correspondencia de URLs antiguas y nuevas |
| `migration/report.md` | Conteos, errores, duplicados, decisiones y pendientes |
| `scripts/migration/` | Scripts reproducibles de extracción, descarga, conversión y validación |

Guarda los originales descargados en una carpeta ignorada por Git y súbelos al almacenamiento previsto. Versiona manifiestos, scripts y textos útiles; evita llenar el repositorio de originales pesados o datos privados.

Cada recurso debe registrar: ID interno estable, ID original si existe, URL original, URLs alternativas observadas, página y posición de uso, nombre original, MIME declarado, tipo detectado, bytes, dimensiones, orientación, SHA-256, función editorial, estado de descarga, destino y derivados generados.

Cada asociación debe registrar el proyecto o producto al que pertenece. La identidad de un archivo y su uso en una página son conceptos distintos: un mismo dibujo puede aparecer en la portada, el portfolio y los ejemplos de encargos sin crear tres obras diferentes.

### 3.3 Resolución de imágenes

1. Lee `src`, `srcset`, `data-src`, `data-srcset`, atributos de lazy loading, enlaces a lightbox y URLs de fondo.
2. Identifica el original de mayor calidad mediante metadatos y verificación HTTP. No elimines sufijos `-anchoxalto` a ciegas: podría no existir ese archivo o perder una rotación corregida.
3. Descarga y verifica que la respuesta es el archivo esperado, no un HTML de error con código 200.
4. Detecta el tipo real por firma y decodificación; no confíes exclusivamente en extensión o `Content-Type`.
5. Respeta EXIF y convierte a sRGB cuando corresponda. Conserva proporciones, firma, márgenes del papel y encuadre.
6. Calcula SHA-256 para duplicados exactos. Los hashes perceptuales pueden sugerir coincidencias, pero no deben fusionar automáticamente fotografías diferentes de una misma obra.
7. Asigna un nombre de destino legible y estable. Mantén el nombre original y su trazabilidad en el manifiesto.
8. Genera tamaños responsive adecuados al uso, sin ampliar imágenes por encima de su resolución útil.
9. Conserva un original de archivo y crea derivados públicos para la web.

No uses hotlinks al WordPress antiguo en la web final. No apliques filtros artísticos, suavizado de lápiz, eliminación de firmas, cambios de fondo o generación mediante IA a las obras existentes.

### 3.4 HEIC

Hay referencias públicas como:

- `https://petsdrawings.com/wp-content/uploads/2025/03/Moquitos.heic`.
- `https://petsdrawings.com/wp-content/uploads/2025/03/Kira-Sox.heic`.
- `https://petsdrawings.com/wp-content/uploads/2025/03/IMG_6106.heic`.

Descarga el original y busca también los JPEG asociados que WordPress ya haya generado. Elige como derivado de visualización el resultado de mejor calidad comprobada.

La conversión de migración debe realizarse **fuera del runtime de Vercel**, con herramientas verificadas: por ejemplo Python con Pillow y `pillow-heif`/libheif, o una imagen Docker reproducible. Aplica la orientación antes de exportar. Produce JPEG de calidad y derivados WebP/AVIF cuando sean adecuados.

No publiques HEIC como única fuente de un `<img>`. No asumas que Sharp instalado de forma estándar puede decodificar cualquier HEIC. Documenta dependencias y fallback. La falta de un codec debe producir un error visible en el informe, nunca una omisión silenciosa.

### 3.5 PDF

Existen originales como `IMG_3394.pdf`, `IMG_3427.pdf`, `IMG_2576-2-2.pdf`, `IMG_2491-2.pdf` e `IMG_2580-1.pdf`, con previsualizaciones JPEG en el portfolio.

- Preserva el archivo original y su relación con la obra.
- Comprueba el número de páginas. No pierdas páginas de un documento multipágina por elegir siempre la primera.
- Para la galería utiliza una previsualización existente de calidad suficiente o genera un raster de alta calidad con PyMuPDF o Poppler en el proceso de migración.
- Escoge una resolución útil para la visualización y el zoom, con límites de dimensiones y peso. No publiques un PDF incrustado como sustituto de la imagen de galería.
- Mantén el área correcta de la página y comprueba que no se corta la firma ni se introduce un fondo extraño.
- Si tiene sentido ofrecer descarga, muestra tipo y tamaño del archivo y un enlace diferenciado.
- Nunca renombres un PDF a `.jpg` para intentar usarlo como imagen.

### 3.6 Texto y traducciones

Extrae el contenido editorial, no el CSS, scripts, shortcodes, iconos `+` ni textos técnicos del tema. Usa el texto español existente como primera fuente de traducción y completa lo que falte.

Puedes mejorar ortografía, puntuación y naturalidad. Debes conservar hechos, tono personal, historias de los encargos, nombres y referencias afectivas. No resumas una historia hasta hacer desaparecer su sentido. No escribas información biográfica nueva.

Guarda el texto de origen y el revisado para poder contrastarlos. Las etiquetas de archivo como `IMG_1509` se mantienen en la trazabilidad. Si no hay un nombre de obra confirmado, utiliza un título descriptivo neutral y registra que es editorial.

## 4. Portfolio y asociaciones que no puedes perder

### 4.1 Work

La página de trabajo contiene 19 bloques principales observados y 48 enlaces de imagen. Conserva sus historias y sus grupos. El anexo B recoge las URLs en el orden observado.

Presta especial atención a:

- Los dos proyectos llamados `Dogs A3`, que no son el mismo bloque.
- Los dos proyectos cuyo título genérico es `Dog`, que tampoco deben fusionarse.
- Smokey: hay más de una imagen de dibujo/previsualización además de su fotografía.
- Michi y Pantera: hay dibujos independientes, referencias fotográficas y una imagen de productos. No asocies por proximidad el dibujo de un gato a la foto del otro.
- Doggy: conserva dibujo, imagen de comparación y fotografía.
- El bloque Millie, Lady y Charlie: el orden original intercala imágenes. Empareja por identidad y nombre, no por una alternancia automática de dos en dos.
- Hay una gata llamada Millie y un perro llamado Millie en grupos diferentes. Sus IDs internos deben ser distintos.
- Kira y Sox aparecen en Work, portada y ejemplos de encargos. Conserva la reutilización del mismo proyecto.

Modela explícitamente `artwork`, `subject`, `reference_photo`, `drawing`, `comparison`, `process_photo` y `related_product_photo` cuando corresponda. Una obra puede tener varios sujetos, varias fotos de referencia y varias imágenes finales.

No crees un comparador antes/después para dos imágenes de encuadres incompatibles. En esos casos utiliza una presentación de dos figuras con etiquetas o pestañas. Cuando uses un comparador, debe quedar claro qué lado es foto y cuál dibujo.

### 4.2 Extra gallery

Conserva las 16 posiciones observadas: dos piezas de menú/ilustración comercial, Mojácar, el retrato y fotografía de Jungkook, el regalo del Día de la Madre, Dylan/Mia/Jaedon, madre e hija, el regalo de San Valentín, el grupo etiquetado como Indian y el dibujo para libro.

No trates los dos elementos `Menu` de esa galería como navegación de la web: son piezas del trabajo publicado. Revisa visualmente sus imágenes para clasificarlas.

### 4.3 About, Order y Contact

- Conserva las cuatro imágenes de la sección biográfica.
- Conserva los ejemplos de Kira & Sox y Frankie en Encargos, con sus fotos correctas.
- Conserva la sección Feedbacks y sus tres imágenes de reseñas como recursos del sitio.
- Si conviertes una reseña en texto, comprueba el contenido con la imagen y no atribuyas nombres o frases que no se lean. No inventes estrellas, promedios o un número de reseñas.
- Las capturas de reseñas deben poder leerse mediante ampliación y tener una alternativa textual apropiada. Evita añadir datos personales nuevos a la transcripción.

## 5. Dirección artística obligatoria

### 5.1 Concepto

Diseña **un estudio de retratos y una galería de recuerdos**. La emoción está en las miradas de los animales, la huella del lápiz y la relación entre fotografía y obra. La tienda debe sentirse como una extensión de ese estudio.

La composición debe ser editorial y reconocible: amplios márgenes, títulos con presencia, fotografías reales, pies de obra pequeños pero legibles, una retícula precisa y variaciones de escala cuidadas. El contenido artístico debe tener espacio para respirar.

Evita plantillas genéricas de servicios, grandes bloques de tarjetas idénticas para cada sección, emojis decorativos, degradados de colores, fondos con partículas, glassmorphism y efectos que oculten las obras. No introduzcas un chatbot, newsletter, blog ni una nueva marca comercial sin que sean necesarios para este alcance.

### 5.2 Paleta

Utiliza esta base y ajusta solamente si la revisión visual lo exige:

```css
:root {
  --paper: #f6f3ec;
  --surface: #fffdf8;
  --ink: #24221f;
  --muted: #686158;
  --line: #d9d2c7;
  --accent: #754537;
  --accent-soft: #ece0d7;
  --success: #355844;
  --danger: #9c302e;
}
```

El papel cálido y el grafito dominan. El acento terracota oscuro aparece en enlaces, pequeñas marcas, estados y algún detalle; no tiñas las imágenes. Comprueba el contraste real de todas las combinaciones. Las líneas suaves son divisores, no texto funcional.

Puedes utilizar una única sección oscura de grafito en la portada o en el cierre, con contraste suficiente y sin invertir los dibujos. Mantén la tienda clara y fácil de leer.

### 5.3 Tipografía

- Títulos expresivos: **Bodoni Moda**, con su cursiva en detalles contados.
- Texto, navegación y controles: **Manrope**.
- Aloja WOFF2 localmente e incluye caracteres españoles, tildes, eñes y símbolos monetarios.
- Dos familias son suficientes. No uses una tipografía manuscrita como sustituto de una firma real.
- Display de portada: aproximadamente `clamp(3.4rem, 7.2vw, 8rem)`, con revisión específica de los saltos de línea en inglés y español.
- H1 interior: `clamp(2.7rem, 5.2vw, 5.8rem)`.
- H2: `clamp(2rem, 3.5vw, 4rem)`.
- Cuerpo: 17–18 px en escritorio y al menos 16 px en móvil, interlineado próximo a 1.6.
- Pies de obra y etiquetas: 12–14 px según función; no uses texto microscópico.
- Limita los bloques de lectura a unas 60–70 letras por línea.
- Usa cifras tabulares para precios y cantidades.

No comprimas el texto español hasta hacerlo pequeño. Ajusta la composición y los saltos de línea por idioma cuando sea necesario.

### 5.4 Retícula y espaciado

- Ancho máximo editorial: aproximadamente 1440 px.
- Márgenes: 64–80 px en escritorio amplio, 32–40 px en tablet y 20–24 px en móvil.
- Retícula de 12 columnas en escritorio; 6 en tablet; una columna principal en móvil.
- Ritmo de espaciado basado en 8 px, con secciones de 96–144 px de separación en escritorio y 56–80 px en móvil.
- Bordes de botones discretos y radios de 0–4 px. Reserva esquinas más suaves para elementos que lo necesiten, como diálogos.
- Sombras casi imperceptibles, asociadas al papel o al objeto fotografiado.
- Diseña el ritmo con cambios de tamaño y posición de las figuras. No hagas un masonry aleatorio sin jerarquía ni orden de lectura.

### 5.5 Tratamiento de la obra

- Dibujo y fotografía completos con `object-fit: contain` cuando el encuadre de la obra lo requiera.
- Fondos coherentes, con el papel real conservado.
- No recortes orejas, hocicos, firmas, bordes significativos ni el dibujo impreso de un producto.
- En fotografía comercial puedes ajustar la caja, pero revisa cada encuadre y conserva el objeto completo.
- No añadas marcos ficticios ni nuevos mockups que cambien la percepción del producto existente.
- Los pies deben distinguir nombre, tipo de imagen y datos confirmados de la obra.

### 5.6 Movimiento

- Entrada inicial breve: título y figura con desplazamiento de 12–20 px y opacidad, durante unos 500–700 ms.
- Aparición de secciones con IntersectionObserver y animación progresiva discreta.
- Hover de enlaces con subrayado animado y de figuras con cambio mínimo de escala, sin modificar el recorte de la obra.
- Menú y carrito con transiciones de 180–280 ms.
- Puedes usar transiciones nativas entre páginas si son compatibles con Astro 7 y no introducen errores de foco o listeners duplicados.
- Si hay un pequeño desplazamiento decorativo al hacer scroll, debe desactivarse en móvil y con movimiento reducido.
- `prefers-reduced-motion` debe dejar la navegación, galerías y compra plenamente funcionales.
- El contenido debe ser visible sin JavaScript. No bases la accesibilidad del contenido en que termine una animación.

Usa CSS, Web Animations API y JavaScript nativo como primera opción. Añade una biblioteca de animación solamente si resuelve una necesidad concreta que estas herramientas no cubran.

## 6. Diseño página por página

### 6.1 Cabecera y navegación global

Cabecera limpia sobre papel, con marca a la izquierda y navegación a la derecha. Presenta `Pets Drawings` con `by Meili Stringfellow` como firma tipográfica secundaria. Conserva el logo original como recurso y utilízalo si encaja; no estires una imagen de logo de baja resolución para convertirla en un elemento gigante.

Enlaces: Home/Inicio, About/Sobre mí, Work/Obra, Extra gallery/Galería extra, Commissions/Encargos, Shop/Tienda y Contact/Contacto. Mantén claros el selector EN/ES y el acceso al carrito con cantidad accesible.

La cabecera puede hacerse compacta al bajar, sin saltos ni transparencias que empeoren la lectura. En móvil usa un menú dialogado de pantalla completa con tipografía editorial, un cierre evidente, foco contenido y retorno del foco al botón de apertura. No dependas de hover.

### 6.2 Home / Inicio

Orden propuesto:

1. **Hero editorial**. En escritorio, texto en unas cinco columnas y una obra real en unas siete, con relación asimétrica y mucho aire. Utiliza un retrato canino de calidad; Frankie o Kira & Sox son candidatos que debes evaluar con sus archivos reales. Una pequeña foto de referencia puede acompañarlo si no invade la obra.
2. **Presentación de Meili**. Texto breve derivado del actual, una fotografía real trabajando y enlace a la biografía.
3. **Latest drawings / Últimos dibujos**. Conserva los seis elementos actuales como conjunto inicial: Moquitos, IMG_1509, Kira & Sox, IMG_1612, IMG_1585 y Mojacar Publo. Resuelve nombres editoriales y duplicados con el manifiesto, sin inventar identidades. Utiliza una retícula de dos o tres columnas con variación controlada de tamaños.
4. **De la fotografía al retrato**. Un ejemplo real, legible, con etiquetas y acceso a Encargos.
5. **Invitación a un encargo**. Explica el proceso en tres pasos: enviar una buena referencia, concretar el encargo y recibir la obra. No inventes un plazo.
6. **Selección de tienda**. Tres productos reales, uno de cada categoría; imagen, título, precio y acceso a su ficha. Una composición tranquila, sin llenar la portada con los 18 productos.
7. **Feedbacks**, con acceso a las reseñas existentes.
8. **Cierre de contacto**, con un gran titular editorial y acceso a email/encargo.

Propón y termina dos titulares localizados de calidad. Como punto de partida editorial, puedes usar la idea inglesa “Their character. Your forever.” y la española “Su mirada, para siempre.”; son textos propuestos para el rediseño, no citas de la artista. Ajusta el resto del copy a la realidad del servicio.

CTAs principales: ver obra y encargar un retrato. Tienda aparece en la navegación y en su bloque propio.

En móvil: título, texto breve, CTAs y obra en ese orden; sin collage que desborde ni una imagen de más de una pantalla de alto. No fuerces el hero a `100vh`. La primera visita debe permitir ver pronto una obra y una acción útil.

### 6.3 About / Sobre mí

- Hero interior con el nombre de Meili y una fotografía real en el estudio.
- Biografía completa revisada, dividida en bloques de lectura naturales.
- Intercala las imágenes actuales de trabajo y mercados con pies breves y reales.
- Explica la relación entre el retrato, los recuerdos y la producción de objetos ilustrados usando el contenido existente.
- Añade un cierre con acceso a portfolio, encargos y tienda.
- Evita cronologías, estudios o hitos inventados para llenar espacio.
- En móvil, las imágenes acompañan al bloque de texto al que pertenecen y conservan proporción.

### 6.4 Work / Obra

- Título editorial, introducción y acceso visible a Encargos.
- Conserva los 19 grupos e historias, con posibilidad de acceder a una ficha individual de cada proyecto.
- Puedes añadir filtros para perros, gatos, caballos y otros si todos los proyectos quedan clasificados correctamente. Incluye “Todos”.
- Los filtros no deben ocultar permanentemente contenido del HTML ni romper las URLs de los proyectos.
- Retícula editorial de dos o tres columnas con orden definido, dibujos completos y pies claros.
- Las fichas o bloques ampliados presentan la obra, el texto y sus referencias.
- En móvil usa una columna para historias y comparaciones. Dos columnas pequeñas solo donde las imágenes y pies sigan siendo legibles.
- La navegación entre proyectos debe mostrar el proyecto anterior/siguiente sin depender de un slider automático.

### 6.5 Ficha de proyecto

- Nombre y categoría editorial confirmada.
- Imagen final con máxima presencia.
- Historia original revisada y traducida.
- Grupo de fotos de referencia, dibujos adicionales y fotografías del proceso, con etiquetas explícitas.
- Un comparador opcional cuando el material lo permita; en otros casos, pareja de figuras o pestañas.
- Ampliación accesible, navegación por teclado y zoom cuando sea útil.
- CTA contextual a un retrato personalizado.
- Proyectos relacionados basados en categorías reales, no en testimonios o éxitos inventados.

### 6.6 Extra gallery / Galería extra

- Presentación que explica la amplitud del trabajo de Meili más allá de las mascotas.
- Mantén las 16 posiciones y sus relaciones. Puedes agruparlas en personas, arquitectura e ilustración cuando la clasificación sea verificable.
- Usa una composición similar a una sala de exposición: imágenes con proporciones naturales y pies discretos.
- No recortes una carta o un menú hasta impedir leer su diseño.
- Las parejas de foto y retrato deben mostrar claramente qué imagen es cada una.
- Acceso a ampliación y a contacto para otros encargos.

### 6.7 Commissions / Encargos

Esta página desarrolla la función del actual apartado Order. No la mezcles con la compra inmediata de tazas o tarjetas.

- Apertura con un retrato y una invitación clara.
- Instrucciones para enviar una fotografía nítida, bien iluminada y con el rostro reconocible.
- Conserva la recomendación de enviar por email la foto con calidad original.
- Presenta los precios observados: **A4 desde 90 €; A3 desde 110 €; cada sujeto adicional, 20 €**.
- Explica que el presupuesto final también depende del detalle y la complejidad.
- Puedes mostrar una estimación de partida con tamaño y número de sujetos. Debe calcularse con configuración del servidor y etiquetarse como orientación sujeta a confirmación.
- No cobres un encargo personalizado como si el precio inicial fuera un presupuesto final aceptado. El flujo inicial termina en solicitud y respuesta de la artista.
- Conserva los ejemplos correctos de Kira & Sox y Frankie.
- Incluye formulario real con nombre, email, idioma, tamaño orientativo, número de sujetos, mensaje y fotografías opcionales mediante la ruta privada definida más adelante.
- Añade acceso directo a email y WhatsApp.
- Tras el envío, muestra confirmación real y la referencia de la solicitud. No prometas respuesta en 24 horas si no existe ese compromiso.

En móvil el formulario es de una columna. Los precios y la advertencia sobre presupuesto deben quedar próximos; no ocultes la condición de “desde” en un tooltip.

### 6.8 Contact / Contacto

- Título grande, texto cercano y acceso protagonista a `info@petsdrawings.com`.
- Teléfono enlazado con `tel:+34636386531`.
- WhatsApp con `https://wa.me/34636386531` y un texto localizado correctamente codificado.
- Formulario corto: nombre, email, motivo y mensaje, con validación y envío real.
- Sección Feedbacks con las tres reseñas originales.
- Enlaces sociales verificados.
- No añadas un mapa con una dirección de estudio inventada ni un formulario de newsletter.
- En móvil, email y teléfono deben caber o partir correctamente sin causar desplazamiento horizontal.

### 6.9 Shop / Tienda

- Hero compacto con título, breve explicación y una imagen real de producto o de su proceso.
- Tres categorías: tarjetas, posavasos y tazas.
- Filtros por categoría y motivo/raza; orden por selección editorial, precio y nombre. Usa query parameters compartibles.
- Muestra los 18 productos al iniciar el catálogo si siguen siendo los existentes. No necesitas paginación para 18; prepara el acceso a datos para crecer.
- Cuadrícula de tres columnas en escritorio, dos en tablet y dos en móvil cuando el ancho permita títulos y controles cómodos. Pasa a una columna en los anchos más estrechos si hace falta.
- Tarjeta sobria: imagen real, nombre localizado, categoría o motivo, precio y disponibilidad. El producto debe ser el elemento visual principal.
- Una segunda imagen en hover es un detalle opcional; la navegación móvil debe funcionar sin ese estado.
- El enlace de ficha y el botón de añadir deben ser controles separados y semánticamente válidos.
- Al añadir, confirma la acción y actualiza el contador de carrito con `aria-live`.
- Estados específicos: sin resultados, error temporal, agotado, disponibilidad por confirmar y producto retirado.
- Mantén EUR en ambos idiomas. No reproduzcas la geoconversión a USD.

### 6.10 Product / Producto

- En escritorio, galería en la parte izquierda y zona de compra a la derecha, aproximadamente 60/40.
- Galería con dos o tres imágenes según el producto, sin duplicados. Mostrar la fotografía completa y miniaturas visibles.
- Nombre localizado, precio, descripción revisada, selector de cantidad, disponibilidad y botón de compra.
- Información de envío, devoluciones y detalles del producto solo cuando esté configurada y contrastada.
- El botón queda deshabilitado con explicación si falta disponibilidad verificada o la venta no está habilitada.
- No uses escasez falsa, contadores, descuentos inventados ni mensajes de “solo quedan dos” basados en datos inexistentes.
- Productos relacionados de la misma categoría o motivo; máximo tres o cuatro.
- En móvil, galería primero y compra después. Puedes usar una barra inferior de compra cuando su precio y estado estén visibles, respetando el área segura y sin tapar formularios o contenido.
- El gesto horizontal de galería, si existe, tiene controles alternativos y no bloquea el scroll vertical.

### 6.11 Carrito

Implementa un panel lateral y una página completa accesible.

- Panel de unos 420–480 px en escritorio y pantalla completa o casi completa en móvil.
- Imagen, título, precio unitario, cantidad, subtotal y eliminar por línea.
- Subtotal calculado con una cotización del servidor. Distingue si el envío está pendiente de calcular.
- No presentes como total final una cifra que todavía excluye costes obligatorios.
- Botón para continuar a Checkout y enlace para seguir comprando.
- Carrito vacío con una invitación coherente al catálogo.
- Durante validación o cambio de cantidades, muestra estado de actualización y evita clics duplicados.
- Si cambia un precio o se agota un producto, explica el cambio y solicita revisar el carrito antes de iniciar la sesión de pago.
- Conserva el carrito al cambiar de idioma y durante una cancelación del pago.
- No vacíes el carrito al iniciar Stripe. Retira las líneas compradas cuando el servidor confirme el pago, sin eliminar productos añadidos después en otra pestaña.

### 6.12 Checkout y retorno

La recogida de datos de tarjeta sucede en **Stripe Checkout alojado por Stripe**. No construyas un formulario de tarjeta propio.

Antes de salir de la web, debe haber un resumen fiable de productos, moneda, cantidades y política de envío aplicable. El servidor construye la sesión con precios propios.

Pantalla de éxito:

- Muestra “Estamos confirmando tu pedido” mientras falte confirmación persistida.
- Muestra pedido confirmado solamente cuando el backend lo haya conciliado como pagado.
- Ofrece referencia, resumen permitido, próximos pasos y contacto.
- No expongas datos personales por conocer un `session_id` o un ID de pedido.
- Contempla que el webhook llegue tarde, que el cliente cierre la ventana y que el retorno se abra sin la cookie original.

Pantalla de cancelación:

- Mensaje claro, regreso al carrito y opción de reintentar.
- Abrir la URL de cancelación no libera inventario por sí mismo: aplica el flujo de cancelación seguro del apartado de pagos.
- Una petición GET no debe cancelar ni modificar un pedido.

### 6.13 Panel privado

Diseño funcional y cuidado, con la misma tipografía de interfaz y una paleta relacionada. Evita que el panel necesite conocer conceptos técnicos para publicar un producto.

Vistas: acceso, resumen, productos, editor, medios, inventario, pedidos, solicitudes de encargo y ajustes de tienda.

En el editor, presenta claramente las dos versiones del producto y permite guardar borradores incompletos. La publicación exige contenido e imágenes suficientes y no activa automáticamente el cobro si falta configurar disponibilidad o tienda.

El apartado 13 detalla los comportamientos obligatorios del panel.

### 6.14 Footer, páginas legales, 404 y errores

- Footer amplio con marca, enlaces de secciones, email, teléfono, redes, selector de idioma y páginas legales.
- Conserva la información de autoría artística. No atribuyas el nuevo desarrollo a un proveedor anterior por copiar literalmente su crédito del footer.
- Añade páginas de condiciones de compra y envíos/devoluciones para el nuevo comercio, con datos configurables y revisión del titular antes de activar venta real.
- No inventes textos jurídicos definitivos ni mantengas cláusulas del sitio anterior que ya no describan los nuevos proveedores y tratamientos de datos.
- 404 bilingüe con acceso a obra, tienda e inicio.
- Error temporal de tienda con reintento y contacto. Un fallo de Supabase no debe convertirse en un falso “no hay productos”.
- Cesta, retorno de pago, administración y búsquedas internas no deben indexarse.

## 7. Requisitos transversales de interfaz

### 7.1 Responsive

Revisa al menos 360, 390, 768, 1024 y 1440 px. Comprueba también un escritorio amplio y zoom al 200 %.

- Ningún desbordamiento horizontal.
- Controles táctiles de unos 44 px o más cuando sea posible.
- Cabeceras, paneles y barras fijas respetan `safe-area-inset-*`.
- Las modales se adaptan al teclado virtual y a la orientación horizontal.
- Las tablas de administración se convierten en una presentación usable con desplazamiento controlado o fichas, sin ocultar acciones esenciales.
- No bloquees el scroll de la página después de cerrar un diálogo.

### 7.2 Accesibilidad

Objetivo: WCAG 2.2 AA en los flujos implementados.

- HTML semántico, enlace de salto, jerarquía correcta de títulos y landmarks.
- Un H1 principal por pantalla.
- Foco visible y orden de teclado coherente.
- Labels reales, errores asociados al campo y resumen de errores cuando proceda.
- Diálogos con nombre accesible, Escape, contención de foco y retorno al activador.
- Lightbox y comparadores utilizables sin ratón.
- Ningún botón que dependa solo de un icono sin nombre accesible.
- Alternativas textuales localizadas para imágenes relevantes; decorativas con alt vacío.
- Estados de compra y errores anunciados de forma discreta y útil.
- Contraste suficiente en texto pequeño, badges, botones, enlaces y foco.
- Movimiento reducido y ausencia de destellos.

### 7.3 Calidad del detalle

Diseña expresamente hover, focus-visible, active, disabled, loading, empty y error. Revisa alineación de precios, saltos de títulos, pies de imagen y textos españoles largos. No consideres terminada una página únicamente porque los componentes estén colocados.

## 8. Arquitectura de Astro 7 y Vercel

### 8.1 Stack concreto

- Astro **7.x estable**, TypeScript estricto.
- Adaptador oficial `@astrojs/vercel`, compatible con la versión instalada.
- Node.js **24.x** en desarrollo, CI y Vercel; verifica compatibilidad efectiva al preparar el proyecto.
- `pnpm` como gestor y lockfile versionado.
- Componentes `.astro` para la web editorial.
- React en islas para carrito, galería interactiva compleja y editor del panel cuando aporte una ventaja. No conviertas toda la web en una SPA.
- CSS con variables y estilos de componentes; puedes usar utilidades de Tailwind si ya están justificadas en el repositorio, manteniendo la dirección visual personalizada.
- Supabase Postgres, Auth y Storage.
- Stripe SDK oficial en servidor.
- Resend como proveedor transaccional por defecto, encapsulado tras una interfaz de email para poder sustituirlo.
- Zod para validación en fronteras de datos.
- Vitest para lógica y pruebas de integración; Playwright y axe para flujos de navegador y accesibilidad.

No añadas otro CMS, un segundo backend o una base de datos distinta sin una necesidad justificada. El panel solicitado se apoya en Supabase.

### 8.2 Renderizado

Usa **`output: 'server'`** con prerenderizado explícito de las páginas editoriales. Esta decisión permite que fichas y catálogo lean los cambios del panel sin reconstruir el sitio.

| Tipo de ruta | Renderizado inicial | Política |
| --- | --- | --- |
| Inicio, con selección de productos y precios actuales | SSR | HTML del estudio y consulta acotada de los productos destacados |
| Biografía, portfolio, galería y textos editoriales | Prerenderizado | `export const prerender = true` |
| Fichas de proyectos | Prerenderizado | Rutas generadas desde colecciones locales validadas |
| Tienda, categorías y producto | SSR | Consulta de datos publicados en Supabase |
| Carrito y retorno de compra | SSR, con isla de interacción | Datos de sesión privados cuando corresponda |
| Login, panel y endpoints privados | SSR | Autenticación real, sin caché compartida |
| API, webhook, formularios y trabajos internos | Servidor | Sin prerenderizado |
| Sitemap comercial | Endpoint SSR | Incluye solo rutas públicas publicadas en ambos idiomas |

Al principio, sirve catálogo y fichas sin caché de HTML compartida para que la edición sea inmediatamente verificable. Optimiza las imágenes y las consultas. Si después introduces caché pública, debe tener una invalidación demostrable y nunca incluir sesiones, pedidos o administración.

No uses `output: 'hybrid'`, APIs eliminadas ni importaciones antiguas del adaptador por copiar ejemplos de versiones previas. No habilites ISR global para todo el proyecto. No dependas de funciones experimentales de Astro para completar el alcance.

Configuración de partida, que debes ajustar y compilar contra las versiones instaladas:

```js
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import react from '@astrojs/react';

export default defineConfig({
  site: 'https://petsdrawings.com',
  output: 'server',
  adapter: vercel(),
  integrations: [react()],
  trailingSlash: 'always',
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'es'],
    routing: { prefixDefaultLocale: true },
  },
});
```

La configuración nativa de idiomas no traduce por sí sola los slugs. Implementa el mapa de rutas del siguiente apartado.

### 8.3 Rutas localizadas

| Función | Inglés | Español |
| --- | --- | --- |
| Inicio | `/en/` | `/es/` |
| Biografía | `/en/about-me/` | `/es/sobre-mi/` |
| Portfolio | `/en/work/` | `/es/obra/` |
| Proyecto | `/en/work/{slug}/` | `/es/obra/{slug}/` |
| Galería extra | `/en/gallery/` | `/es/galeria/` |
| Encargos | `/en/commissions/` | `/es/encargos/` |
| Contacto | `/en/contact/` | `/es/contacto/` |
| Tienda | `/en/shop/` | `/es/tienda/` |
| Producto | `/en/shop/{slug}/` | `/es/tienda/{slug}/` |
| Carrito | `/en/cart/` | `/es/carrito/` |
| Resumen previo al pago | `/en/checkout/` | `/es/finalizar-compra/` |
| Retorno de pago | `/en/checkout/success/` | `/es/compra/confirmacion/` |
| Pago cancelado | `/en/checkout/cancel/` | `/es/compra/cancelada/` |
| Estado de pedido | `/en/order-status/` | `/es/estado-pedido/` |
| Privacidad | `/en/privacy/` | `/es/privacidad/` |
| Cookies | `/en/cookies/` | `/es/cookies/` |
| Condiciones | `/en/terms/` | `/es/condiciones/` |
| Envíos y devoluciones | `/en/shipping-returns/` | `/es/envios-devoluciones/` |
| Ayuda de compra como invitado | `/en/account-help/` | `/es/ayuda-compra/` |

Utiliza claves de ruta semánticas en `src/i18n/routes.ts`. El selector de idioma resuelve la página equivalente y, para productos y proyectos, su traducción mediante el ID estable. No generes enlaces reemplazando únicamente `/en/` por `/es/`.

La raíz `/` redirige permanentemente a `/en/`. No cambies el idioma automáticamente según IP. Mantén una selección explícita y un comportamiento predecible para enlaces compartidos y buscadores.

### 8.4 Estructura del proyecto

| Ruta | Responsabilidad |
| --- | --- |
| `src/layouts/PublicLayout.astro` | Estructura pública, metadatos, header, footer y slots |
| `src/layouts/AdminLayout.astro` | Estructura privada y controles de sesión |
| `src/views/` | Composiciones compartidas de cada página pública |
| `src/components/brand/` | Marca, tipografía y detalles visuales |
| `src/components/navigation/` | Cabecera, menú móvil, idioma y footer |
| `src/components/art/` | Figuras, galería, pies, lightbox y comparador |
| `src/components/shop/` | ProductCard, ProductGallery y UI de catálogo |
| `src/components/islands/` | Carrito, formularios interactivos y componentes React necesarios |
| `src/components/admin/` | Editor, tablas, selector de imágenes y controles de inventario |
| `src/content/` | Biografía, proyectos, galería y contenido editorial bilingüe |
| `src/content.config.ts` | Colecciones y esquemas acordes con Astro 7 |
| `src/i18n/en.ts`, `src/i18n/es.ts` | Diccionarios tipados |
| `src/i18n/routes.ts` | Mapa de rutas y equivalencias |
| `src/lib/domain/` | Tipos, dinero, cantidades y reglas puras |
| `src/lib/server/` | Acceso a Supabase, Stripe, email y servicios privilegiados |
| `src/lib/server/auth/` | Verificación de sesión y permisos de administración |
| `src/lib/server/commerce/` | Cotización, checkout, cancelación y conciliación |
| `src/lib/server/forms/` | Contacto, encargos, archivos y antiabuso |
| `src/lib/validation/` | Schemas de entrada y normalización |
| `src/stores/cart.ts` | IDs y cantidades del carrito en navegador |
| `src/styles/` | Tokens, tipografía, reset, layout y utilidades |
| `src/pages/en/`, `src/pages/es/` | Wrappers de rutas localizadas |
| `src/pages/en/shop/[slug].astro` | Producto inglés SSR |
| `src/pages/es/tienda/[slug].astro` | Producto español SSR |
| `src/pages/admin/` | Pantallas privadas |
| `src/pages/api/` | Endpoints del proyecto |
| `src/pages/sitemap.xml.ts` | Sitemap público completo |
| `src/middleware.ts` | Verificación de rutas privadas y cabeceras necesarias |
| `supabase/migrations/` | Esquema, constraints, índices, RLS y funciones |
| `supabase/seed.sql` | Datos de configuración seguros y reproducibles |
| `scripts/` | Importación, validación, administración inicial y tareas de mantenimiento |
| `tests/` | Pruebas de dominio, integración y navegador |
| `docs/` | Arquitectura, operaciones y entrega |

Los wrappers de idioma comparten composiciones y servicios. No dupliques toda la implementación de una página para traducirla.

Mantén los módulos privilegiados fuera de cualquier grafo de importaciones del cliente. Verifica el bundle resultante: una carpeta llamada `server` no protege un secreto por sí misma.

### 8.5 Runtime y sesiones

Usa funciones Node de Vercel para Stripe y endpoints privilegiados. No presupongas un filesystem persistente ni un proceso de larga duración.

La sesión de administración vive en Supabase Auth. El carrito persiste en el navegador; cotizaciones, intentos de pago y reservas viven en Postgres. No uses memoria de una función, un `Map` de Node o un archivo local para guardar pedidos, locks o sesiones de compra.

No añadas sesiones de Astro que requieran otro almacenamiento si no se necesitan. Si utilizas alguna, configúrala explícitamente para el entorno serverless y documenta su persistencia.

## 9. Modelo de datos en Supabase

### 9.1 Principios

- Postgres es la fuente de verdad para productos, precios, stock, reservas y pedidos.
- Importes en céntimos enteros, moneda EUR y límites que eviten overflow. Nada de aritmética monetaria con floats.
- IDs internos UUID; IDs de WordPress conservados en `legacy_id`, con unicidad por tipo de entidad.
- Relaciones explícitas, claves foráneas, índices y constraints. Las invariantes de stock deben vivir también en la base de datos.
- Fechas en `timestamptz` y UTC; presentación según idioma/zona configurada.
- Estados con transiciones definidas. No utilices un campo genérico editable para convertir arbitrariamente un pedido en pagado.
- Las migraciones deben recrear el esquema desde cero en desarrollo. Los imports deben poder reejecutarse sin duplicar datos ni sobrescribir cambios editoriales posteriores sin control.
- Guarda snapshots de la compra. Un cambio de nombre, precio o imagen del producto no debe reescribir pedidos históricos.

### 9.2 Tablas mínimas

Puedes ajustar nombres o separar una entidad si aporta claridad, manteniendo estas responsabilidades:

| Tabla | Campos o responsabilidad esencial |
| --- | --- |
| `products` | UUID, legacy_id único, SKU único, categoría, motivo/raza, estado, precio en céntimos, moneda, orden editorial, flags de venta, versiones y timestamps |
| `product_translations` | product_id, locale, slug, título, resumen, descripción, detalles confirmados, SEO; única por producto/idioma y slug/idioma |
| `categories` | Código estable y nombres/slugs en ambos idiomas; tarjetas, posavasos, tazas |
| `media_assets` | Identidad del recurso, origen, bucket/path, MIME real, dimensiones, hash, derivados y estado de procesamiento |
| `media_translations` | Alt y pie localizados por recurso cuando corresponda |
| `product_images` | Producto, recurso, posición y portada; sin repetir el mismo recurso en un producto |
| `inventory` | product_id único, stock_on_hand, stock_reserved, modo de inventario, fecha de verificación y versión |
| `stock_movements` | Movimiento, producto, cantidad, motivo, pedido/reserva, administrador y clave de deduplicación |
| `checkout_quotes` | Cotización temporal, propietario de carrito, contenido canónico, versiones de precio/configuración, importes y expiración |
| `checkout_attempts` | Idempotencia de intento, request_hash, order_id, estado, payload de Stripe, session_id, lease y tiempos |
| `orders` | Referencia, estado de pago, estado de preparación, locale, moneda, importes, datos necesarios de cliente/envío y token de acceso protegido |
| `order_items` | Snapshot de producto, nombre, SKU, precio unitario, cantidad, subtotal y recurso de referencia |
| `stock_reservations` | Intento, producto, cantidad, estado, expiración prevista y timestamps de liberación/consumo |
| `stripe_events` | event_id único, tipo, objeto relacionado, estado de procesamiento, intentos y último error sin secretos |
| `notification_outbox` | Notificación única, destinatario, locale, plantilla, datos mínimos, estado, lease, intentos y próxima ejecución |
| `admin_users` | Membresía de administración por auth user ID, activación y permisos; no editable por el usuario ordinario |
| `admin_audit_log` | Actor, operación, entidad, cambio relevante y fecha, sin almacenar contraseñas/tokens |
| `commission_requests` | Solicitud de encargo, idioma, contacto, tamaño orientativo, sujetos, mensaje, estado y referencia |
| `commission_files` | Solicitud, recurso privado, validación, tamaño, MIME, propietario temporal y estado |
| `contact_messages` | Mensaje, contacto, locale, estado y fecha |
| `shop_settings` | Identidad pública, configuración de venta, política fiscal seleccionada, envíos, avisos y versiones |

Usa un esquema privado para datos internos o revoca sus privilegios de acceso desde los roles públicos. Activa RLS también en las tablas del esquema público que lo requieran.

### 9.3 Constraints esenciales

- `price_cents > 0` para los productos de pago de este catálogo.
- `currency = 'EUR'` para esta implementación.
- Cantidades enteras positivas y acotadas.
- `stock_on_hand >= 0`.
- `stock_reserved >= 0`.
- `stock_reserved <= stock_on_hand` en inventario controlado.
- `(product_id, locale)` único.
- `(locale, slug)` único en traducciones de producto.
- `(product_id, media_asset_id)` único en `product_images`.
- `stripe_session_id`, `stripe_payment_intent_id` y claves de idempotencia con unicidad donde corresponda.
- `(checkout_attempt_id, product_id)` único en reservas.
- Clave de movimiento de venta única por pedido y línea/producto para impedir doble descuento.
- Una única notificación de cada tipo por pedido o solicitud y destinatario.
- No borres en cascada pedidos o movimientos al archivar un producto.

Si el modo de inventario permite fabricación sin stock fijo, debe ser una opción explícita y verificada por la artista. No utilices ese modo para saltarte que falta conocer el inventario real.

### 9.4 Datos de inventario que no se conocen

La fuente pública indica que los productos pueden comprarse, pero no proporciona una cantidad física fiable. `maximum: 9999`, `is_in_stock: true` y `low_stock_remaining: null` no significan que haya 9999 unidades.

Importa esos productos con inventario pendiente de verificar y venta desactivada hasta su configuración. El panel debe permitir introducir el stock real o confirmar un modo de producción compatible. La tienda puede mostrar los productos y sus precios con un mensaje localizado de disponibilidad por confirmar.

Los fixtures de pruebas pueden contener cantidades artificiales en una base de datos de test separada. Nunca transfieras ese inventario a producción como si fuera real.

### 9.5 Funciones transaccionales

Implementa operaciones de base de datos para:

- Crear cotización canónica.
- Reservar un carrito completo y crear el pedido/intento en una transacción.
- Adjuntar una sesión de Stripe al intento correcto.
- Aplicar un pago verificado y consumir las reservas exactamente una vez dentro de la base de datos.
- Liberar reservas bajo una condición válida y sin repetir el movimiento.
- Ajustar inventario desde el panel con registro de auditoría.
- Reclamar trabajos de outbox con lease y `FOR UPDATE SKIP LOCKED`.

Para reservar, bloquea las filas de productos e inventario en un orden determinista, valida todo el carrito y confirma todo o revierte todo. Evita la secuencia de “consultar stock” y después “actualizarlo” en peticiones independientes.

No mantengas una transacción de Postgres abierta mientras esperas una llamada de red a Stripe o al proveedor de email. Usa una operación duradera en base de datos y compensación/conciliación entre sistemas.

Si alguna función es `SECURITY DEFINER`, fija un `search_path` seguro, cualifica los esquemas, limita el propietario y revoca `EXECUTE` a roles que no deban invocarla. Las funciones privilegiadas de checkout no deben ser ejecutables anónimamente desde la Data API.

## 10. Autenticación, autorización y almacenamiento

### 10.1 Administración real

- Supabase Auth con sesiones de servidor mediante `@supabase/ssr` y cliente por petición.
- Login de administrador mediante email/contraseña; recuperación de contraseña y cierre de sesión completos. Puedes añadir MFA si se configura, sin convertirlo en una simulación.
- Registro público de administradores desactivado.
- Script de bootstrap para dar acceso a un usuario concreto por su identidad verificada de Supabase Auth. No incluyas contraseñas por defecto.
- Verifica identidad en servidor con `getUser()` o un método de verificación de claims válido para la configuración instalada. No autorices usando solo el objeto de usuario de `getSession()` o decodificando un JWT sin verificar.
- Tras verificar identidad, comprueba la membresía activa en `admin_users` para cada ruta y mutación relevante.
- Un usuario autenticado sin membresía de administración debe recibir denegación real.
- No bases el rol en un email aportado por el navegador ni en `user_metadata` editable por el usuario.
- Refresca y escribe cookies según el flujo SSR soportado por la versión instalada.
- Usa `Secure` en HTTPS y `SameSite` adecuado. Si eliges un flujo de autenticación exclusivamente en servidor, emplea cookies HttpOnly y evita depender de que un SDK de navegador lea esos tokens.
- Valida destinos de callback y recuperación contra una lista permitida de orígenes/rutas. No admitas redirecciones abiertas.
- `Cache-Control: private, no-store` en respuestas autenticadas o con `Set-Cookie` de sesión.

Proteger solamente la página `/admin/` no basta. Aplica autorización también a todos los endpoints de productos, medios, inventario, pedidos y ajustes.

### 10.2 RLS y acceso a datos

| Actor | Permitido |
| --- | --- |
| Visitante | Lectura de campos públicos de productos publicados, categorías y derivados públicos |
| Usuario autenticado ordinario | Los mismos datos públicos; sin permisos de administración |
| Administrador verificado | Lectura y edición autorizada del catálogo, inventario, solicitudes y pedidos |
| Servicio de checkout/webhook | Operaciones privilegiadas estrictamente necesarias, después de validar la petición o firma |

No expongas reservas, emails, direcciones, pedidos, ajustes secretos, outbox ni logs internos mediante consultas públicas. Una vista pública debe evitar filtrar columnas internas y respetar las políticas previstas.

Utiliza el cliente de usuario y RLS para las operaciones de administración cuando sea posible. Aísla el cliente con secreto/service role para operaciones de backend que realmente lo necesiten. Esa clave evita RLS: no debe convertirse en una manera de ignorar la autorización de una petición del navegador.

### 10.3 Buckets

- `catalog-public`: únicamente derivados e imágenes deliberadamente publicables del catálogo.
- `portfolio-public`: derivados públicos de obras y fotografías ya destinadas al portfolio.
- `artwork-originals`: archivo de originales de migración y nuevas subidas, privado por defecto.
- `commission-private`: fotografías y documentos enviados por clientes, siempre privado.

Un bucket público permite acceder a sus archivos por URL. No basta con ocultar el listado ni con una política de SELECT para proteger una foto de cliente que hayas puesto allí.

Subidas, movimientos y borrados pasan por la API de Storage y sus políticas. No manipules directamente filas de `storage.objects` como sustituto de borrar o subir el objeto real.

### 10.4 Subidas y procesamiento

- Genera autorización de subida desde el servidor, ligada a administrador o solicitud concreta, tamaño, ruta aleatoria y tiempo de validez.
- Para archivos que superen el límite de payload de la función de Vercel, usa subida directa a Supabase con autorización limitada. No envíes todos los binarios a través de un endpoint de Astro.
- Confirma la subida mediante un endpoint que valide pertenencia, tamaño y tipo real. No aceptes una URL arbitraria de Internet para que el servidor la descargue.
- Limita bytes y dimensiones decodificadas. Rechaza SVG, HTML y ejecutables como fotografías de producto.
- Para nuevas imágenes comerciales, implementa una ruta fiable de JPEG, PNG y WebP; añade AVIF si se verifica su decodificación.
- HEIC y PDF del catálogo antiguo se convierten en el pipeline de migración. Si ofreces esos formatos en el editor, implementa y prueba una conversión compatible y acotada; de lo contrario, explica en ambos idiomas los formatos admitidos. No anuncies un formato que luego falla silenciosamente.
- Las fotos de referencia de encargos pueden guardarse como originales privados HEIC/PDF si pasan validación. Muestra nombre, tipo y estado de recepción; una miniatura es opcional y no justifica publicar el original.
- No apliques permisos de publicación a un archivo de encargo para reutilizarlo en el portfolio. Esa reutilización necesita un estado/consentimiento específico gestionado por la artista.
- Quita metadatos de ubicación de los derivados públicos cuando proceda; conserva un original privado según la política de archivo.

Para límites iniciales de encargos, utiliza hasta cinco archivos de 15 MB cada uno, configurables y revisados frente al plan real de Storage. Verifica en el servidor y en el bucket; la validación del navegador es solo ayuda de uso.

## 11. Carrito, cotización y Stripe Checkout

### 11.1 Estado del carrito

El navegador puede persistir únicamente:

```ts
type CartItem = {
  productId: string;
  quantity: number;
};

type CartState = {
  version: 1;
  items: CartItem[];
};
```

Un título o una imagen pueden almacenarse como caché de presentación, pero nunca como autoridad comercial. Revalida todo contra el servidor. Gestiona localStorage corrupto, versiones antiguas y sincronización entre pestañas.

No guardes datos de tarjeta, secretos, tokens de administración ni fotos de encargos en ese estado.

### 11.2 Contrato de cotización

`POST /api/cart/quote` recibe IDs/cantidades, idioma y la información mínima de zona de envío necesaria. No recibe precios como autoridad.

El servidor:

1. Valida esquema estricto, productos existentes y locale.
2. Agrupa IDs duplicados y suma cantidades antes de aplicar límites.
3. Acepta cantidades enteras entre 1 y un máximo configurado, por defecto 20 por producto, con un límite de líneas y unidades por carrito.
4. Lee estado, traducción, precio, disponibilidad y configuración actual.
5. Calcula importes con enteros y guarda una cotización temporal asociada al carrito visitante.
6. Devuelve un resumen localizado, importes fiables, disponibilidad y un `quoteId` opaco con expiración corta, por ejemplo cinco minutos.

Una cotización no reserva inventario. La disponibilidad todavía se comprueba al comenzar Checkout.

Asocia las cotizaciones e intentos a un identificador de carrito protegido por cookie de servidor o un mecanismo equivalente. No permitas reutilizar el intento de otra persona simplemente por conocer un UUID.

### 11.3 Creación del checkout

`POST /api/checkout/create` recibe el `quoteId`, un `attemptId` aleatorio y el idioma. Puede recibir el carrito como contraste, pero nunca un total que deba aceptarse.

Flujo obligatorio:

1. Valida origen, protección CSRF cuando corresponda, límites de uso y esquema.
2. Comprueba que la cotización existe, pertenece al carrito, no ha expirado y coincide con las líneas solicitadas.
3. Relee precio y configuración en la transacción de reserva. Si han cambiado, devuelve `409 PRICE_CHANGED` con instrucciones para revisar el carrito; no cobres silenciosamente un importe diferente.
4. Si el mismo intento ya se procesó con el mismo hash de petición, devuelve el resultado existente. Un mismo `attemptId` con un cuerpo diferente produce conflicto.
5. En una transacción, valida publicación, habilitación de venta, inventario verificado, disponibilidad y límites. Bloquea filas de forma determinista.
6. Reserva todas las unidades, crea pedido pendiente, snapshots de líneas e intento `creating_session`. Confirma la transacción.
7. Fuera de la transacción, crea Stripe Checkout con una clave de idempotencia estable derivada del intento persistido. Guarda el payload exacto que se usará en reintentos.
8. Envía `mode: 'payment'`, EUR y líneas calculadas a partir del snapshot del servidor. Puedes usar `price_data` construido por el backend, sin sincronizar un catálogo duplicado de precios como requisito inicial.
9. Usa nombres traducidos al idioma de compra, imágenes públicas permitidas y `locale` de Stripe explícito (`en` o `es`, según lo que soporte la versión instalada).
10. Incluye IDs internos de pedido e intento en metadata y una referencia de cliente. No incluyas fotos de clientes ni contenido sensible en metadata.
11. Construye URLs de retorno a partir de `SITE_URL` autorizado y el mapa de rutas. No aceptes una `success_url` arbitraria enviada por el navegador.
12. Persiste el ID y URL de sesión de Stripe y su expiración real. Devuelve la URL al cliente.

Desactiva cantidades ajustables en Stripe para que no se compren unidades diferentes de las reservadas. No habilites descuentos, códigos promocionales ni conversión automática de moneda sin integrar sus efectos en cotización, reservas y validación. Si la configuración de Stripe ofrece Adaptive Pricing, desactívalo para mantener EUR.

Para el lanzamiento inicial, utiliza pagos con tarjeta y los wallets disponibles mediante esa configuración, evitando activar métodos diferidos sin diseñar su reserva de stock. No prometas la presencia de un wallet que depende del país, dispositivo o cuenta de Stripe.

### 11.4 Sesiones, reservas y fallos entre servicios

La operación completa cruza Postgres y Stripe, por lo que no existe una transacción distribuida única. Implementa estados persistidos y conciliación.

- Una reserva se crea al empezar Checkout, no al añadir al carrito.
- Usa una expiración de sesión dentro del rango admitido por Stripe. En la documentación consultada, el rango es de 30 minutos a 24 horas.
- Puedes usar 35 minutos como valor inicial para dejar margen a la creación/reintento. Guarda un plazo breve y explícito para crear la sesión y un `expires_at` fijo en el payload; nunca recrees payloads diferentes con la misma clave de idempotencia.
- Si Stripe rechaza de forma definitiva la creación y consta que no existe sesión, libera la reserva mediante una operación idempotente.
- Si hay un timeout y la respuesta es desconocida, conserva el intento pendiente y recupera su resultado con la misma clave/payload o mediante conciliación. **No liberes inmediatamente el stock: Stripe podría haber creado una sesión que todavía permite pagar.**
- Si se crea la sesión pero falla la persistencia posterior, debe poder recuperarse. El webhook también puede llegar antes de guardar `session_id`: vincúlalo de forma segura a través de metadata y las comprobaciones del proveedor.
- No crees otra sesión o reserva al refrescar la página o repetir un clic.
- Si el payload ya no puede reintentarse por su expiración, no inventes otro bajo la misma clave. Resuelve el estado de la sesión anterior; si no es determinable, genera revisión y conserva el bloqueo necesario hasta resolverlo.
- Registra intentos atascados y hazlos visibles para administración. Evita tanto la sobreventa como reservas invisibles que quedan abandonadas sin diagnóstico.

### 11.5 Cancelación y expiración

La fecha local de una reserva es una señal para conciliar, no una prueba suficiente de que Stripe ya no pueda cobrar.

Para cancelar explícitamente:

1. Autoriza la operación sobre el intento del visitante.
2. Consulta o expira la sesión abierta en Stripe.
3. Si confirma expiración, libera la reserva en una transacción condicional.
4. Si ya está pagada o completada, concilia su estado y no repongas unidades por esa cancelación.

Para limpieza periódica:

- Escucha `checkout.session.expired`.
- Añade un trabajo de conciliación de intentos vencidos o en estado incierto.
- Si Stripe indica sesión abierta, expírala antes de liberar.
- Si indica pago completado, aplica el pago.
- Si está procesándose, conserva el estado correspondiente; no vendas esas unidades otra vez por haber pasado una fecha.
- Si la API no responde, reintenta y registra el problema; no conviertas la falta de respuesta en permiso para liberar.
- No actives enlaces automáticos de recuperación de sesiones caducadas que omitan la creación de una nueva reserva y la revalidación de precios.

### 11.6 Webhook seguro e idempotente

Implementa `POST /api/stripe/webhook` en Node.

- Lee el body crudo una sola vez. Valida `Stripe-Signature` con el secreto correcto de ese entorno antes de confiar en los datos.
- Usa la versión de API y formato de eventos soportados por el SDK instalado y configurados en Stripe. No copies una versión preview de un ejemplo si el proyecto utiliza una versión estable distinta.
- Rechaza firmas incorrectas o body alterado.
- Verifica modo test/live, sesión, moneda, importes, líneas, cantidades y relación con pedido/intento cuando corresponda.
- Compara el importe esperado con el resultado del proveedor; cualquier diferencia debe producir revisión y no una confirmación silenciosa.
- Guarda `event_id` con constraint único, pero no marques un evento como procesado antes de aplicar su transacción.
- En una misma operación transaccional, aplica la transición válida, consume o libera reserva, registra movimientos, crea outbox y marca el evento procesado.
- Si falla una operación recuperable, responde con error para permitir reintento o confirma únicamente después de haber almacenado de forma duradera el trabajo pendiente. No devuelvas 200 perdiendo el evento.
- La deduplicación debe existir también por pedido/sesión/operación comercial: dos eventos distintos sobre el mismo pago no deben descontar dos veces.
- No confíes en el orden de llegada de eventos. Un evento antiguo de expiración no revierte un pedido pagado.
- No envíes emails ni hagas trabajos lentos dentro de la transacción de inventario.

Eventos previstos:

| Evento | Comportamiento |
| --- | --- |
| `checkout.session.completed` | Confirmar pago solo cuando `payment_status` lo permita; si sigue pendiente, registrar procesamiento |
| `checkout.session.expired` | Liberar una reserva elegible una sola vez y marcar expiración |
| `checkout.session.async_payment_succeeded` | Confirmar de manera idempotente si se habilitan métodos diferidos |
| `checkout.session.async_payment_failed` | Aplicar fallo y liberación cuando sea seguro, si dichos métodos están habilitados |
| Eventos de devolución necesarios | Reflejar devoluciones de forma consistente, sin reponer stock automáticamente |

Un fallo de un intento de tarjeta puede permitir que el cliente reintente dentro de la misma sesión. No liberes la reserva por cualquier `payment_intent.payment_failed` sin analizar el estado de Checkout.

### 11.7 Aplicar un pago

Dentro de la base de datos:

- Si el pedido ya está aplicado como pagado, devuelve éxito idempotente.
- Si la reserva está activa, resta la cantidad tanto de `stock_on_hand` como de `stock_reserved`, marca la reserva consumida y registra un único movimiento de venta.
- Guarda referencia de Stripe e importes definitivos verificados.
- Crea las notificaciones duraderas correspondientes una sola vez.
- No permitas stock negativo ni una transición hacia atrás provocada por eventos tardíos.
- Si llega un pago válido sin una reserva utilizable, registra el pago y un estado de revisión visible. No ignores un cobro real ni fuerces inventario negativo para ocultar el problema.

La página de éxito no es la fuente de verdad del pago. Puede consultar o solicitar conciliación autorizada, pero no marcar un pedido como pagado por un query parameter.

### 11.8 Estados de pedido

Separa al menos:

- Estado de pago: pendiente de sesión, checkout abierto, procesando, pagado, expirado, cancelado, reembolso parcial, reembolsado o revisión.
- Estado de preparación: sin preparar, preparando, enviado o completado según el tipo de producto.

No equipares `checkout.session.completed` a producto enviado. No cambies un pedido cobrado a cancelado por una navegación del cliente.

Para devoluciones, registra lo ocurrido en Stripe. La reposición de inventario es una decisión separada de la artista, con movimiento auditable, porque el producto podría no haberse devuelto o no estar en condiciones de venderse.

## 12. Envíos, impuestos y configuración comercial

No se han confirmado en la auditoría costes de envío, áreas servidas, stock físico, política fiscal aplicable o plazos. Implementa configuración real para estos datos y no los rellenes con promesas comerciales inventadas.

### Requisitos

- Ajustes de países o zonas admitidas, modalidades de envío, importes y condiciones.
- Moneda EUR en todos los pasos.
- Mostrar qué incluye el precio y cómo se calcula cualquier coste adicional una vez configurado.
- Impedir una compra con dirección fuera de las zonas permitidas.
- Si necesitas país/código postal para cotizar antes de Stripe, recopílalos en el resumen y valida que el destino final de Checkout es compatible con esa cotización.
- No permita que elegir otra zona dentro de Stripe deje aplicable un envío calculado para un país diferente. Usa países permitidos coherentes, tarifas correspondientes y comprobación del destino final.
- Si se elige Stripe Tax, configura correctamente el comportamiento fiscal de los precios, categorías y datos necesarios. Si se eligen precios fijos con impuestos incluidos, documenta esa decisión. No actives ambos modelos de forma contradictoria.
- Los precios existentes son los importes observados de catálogo; no añadas un porcentaje fiscal inventado que los cambie sin configuración de la titular.
- Guarda versión de la política de envío/fiscalidad en cotización y pedido.
- Bloquea la activación de cobros live si faltan los datos comerciales necesarios. El resto del sitio y la tienda de presentación deben poder funcionar.

En la configuración local de test puede existir una política de envío de prueba, claramente limitada a ese entorno. No debe migrar como una oferta comercial real.

## 13. Panel privado: comportamiento detallado

### 13.1 Acceso y resumen

- Login real, errores localizados, cierre de sesión y recuperación.
- Dashboard con pedidos recientes, stock que requiere atención, productos pendientes de traducción y solicitudes de encargo.
- Datos reales. Si no hay actividad, muestra un estado vacío útil y ninguna cifra decorativa inventada.
- Aviso claro del modo test/live y de si la tienda está habilitada para cobrar, sin exponer claves.

### 13.2 Listado de productos

- Miniatura, título, SKU, categoría, precio, estado editorial, estado comercial, disponibilidad y fecha de modificación.
- Búsqueda y filtros por estado/categoría.
- Acciones de crear, editar, duplicar como borrador y archivar.
- Archivar es la opción normal para un producto que tenga pedidos. No borres su historial.
- Acciones masivas solo si son seguras y están justificadas; no son necesarias para terminar este alcance.

### 13.3 Editor de producto

Campos:

- Nombre y slug inglés/español.
- Resumen y descripción inglesa/española.
- Detalles confirmados de producto, instrucciones y SEO en ambos idiomas.
- Categoría y motivo/raza.
- SKU.
- Precio EUR con entrada decimal normalizada a céntimos en servidor.
- Imágenes con portada, orden, alt y pie en ambos idiomas.
- Estado borrador/publicado/archivado.
- Configuración de inventario y habilitación de venta, con permisos y validaciones correspondientes.

Funciones:

- Subir imagen, elegir de la biblioteca, reordenar y retirar una asociación sin borrar inmediatamente el archivo compartido.
- Previsualizar el producto en cada idioma mediante una ruta autenticada y no indexable.
- Guardar borrador con traducciones incompletas.
- Publicar solamente cuando pasen las validaciones de contenido requeridas.
- No activar ventas automáticamente al publicar si el inventario o la tienda no están configurados.
- Validar slugs únicos y mantener historial de redirect si cambia un slug ya público.
- Detectar conflicto de ediciones mediante `version` o `updated_at`. No sobrescribir silenciosamente el trabajo de otra pestaña.
- Indicar campos pendientes con instrucciones comprensibles.

No obligues a la artista a editar JSON, SQL o código para añadir un producto normal.

### 13.4 Inventario

- Mostrar stock físico, reservado y disponible como conceptos separados.
- Ajustar entradas/salidas con motivo y registro de quién lo hace.
- Impedir que el stock físico quede por debajo de reservas vigentes mediante una edición simple.
- Para resolver un conflicto de reservas, ofrecer información y el procedimiento de cancelación/conciliación; nunca reducir contadores saltándose los pedidos.
- No permitir editar `stock_reserved` a mano.
- Estados de disponibilidad por confirmar y fabricación bajo pedido explícitamente diferenciados.

### 13.5 Pedidos

- Lista con referencia, fecha, estado de pago, preparación, importe y cliente según permisos.
- Ficha con snapshot de líneas, cantidades, dirección necesaria, referencias Stripe y eventos relevantes.
- Preparar y marcar enviado con referencia de seguimiento opcional.
- Acceso al dashboard de Stripe para las operaciones financieras que no se implementen en el panel.
- Conciliación y revisión de incidencias sin un botón que convierta arbitrariamente en pagado un pedido pendiente.
- Reenvío controlado de una notificación, con registro y diferenciación respecto al envío automático.
- Nunca mostrar números completos de tarjeta ni intentar almacenarlos.

### 13.6 Solicitudes de encargo y mensajes

- Lista de solicitudes, idioma y estado.
- Ficha con datos del encargo y acceso temporal a archivos privados.
- Descargas mediante URLs firmadas cortas o endpoint autorizado.
- Estados sencillos: nueva, en conversación, aceptada, cerrada. El estado no envía automáticamente un mensaje si no se ha implementado ese flujo.
- La aceptación de una solicitud no equivale a un pago. No inventes una contratación automática.

### 13.7 Ajustes

- Identidad pública y contacto.
- Activación de tienda, comprobaciones pendientes y modo de operación.
- Configuración comercial y de envíos.
- Textos operativos bilingües.
- Destinatario de avisos internos y configuración de idioma preferido para administración.
- Los secretos se configuran mediante variables de entorno, no como texto público ni en formularios inseguros del panel.

## 14. Inglés y español completos

### 14.1 Cobertura

Traduce:

- Navegación, títulos, párrafos, CTAs y pies de obra.
- Catálogo: nombres, descripciones, categorías, detalles, SEO, alt y disponibilidad.
- Filtros, ordenación, cantidades y pluralización.
- Carrito, resumen, retorno de pago y estado de pedido.
- Formularios, ayudas, validaciones, errores de red y mensajes del servidor.
- Panel privado, campos, estados, conflictos y confirmaciones.
- Emails transaccionales y textos de recuperación de acceso del sistema utilizado.
- 404, errores y estados vacíos.
- Textos legales y comerciales una vez revisados.

No uses “fallback a inglés” para esconder que falta contenido público español. Los borradores pueden estar incompletos; los productos publicados deben cumplir las validaciones de ambos idiomas.

### 14.2 Implementación

- Diccionarios tipados, comprobación automática de paridad de claves y mensajes con pluralización adecuada.
- Errores de API como códigos estables y datos: `OUT_OF_STOCK`, `PRICE_CHANGED`, `QUOTE_EXPIRED`, `CHECKOUT_PENDING`, `INVALID_FILE`, `UNAUTHORIZED`, `FORBIDDEN`, `RATE_LIMITED` y `TEMPORARY_ERROR`.
- Traduce esos códigos en la interfaz. No muestres mensajes internos de Postgres, stack traces o cadenas de Stripe sin tratamiento.
- Formato de precio con `Intl.NumberFormat`: `en-GB` y `es-ES`, ambos con `currency: 'EUR'`.
- Número de céntimos estable: 349 siempre son 3,49 EUR aunque cambie el formato visual.
- Fechas localizadas y política de zona horaria documentada.
- Locale persistido en pedido y solicitud. Un cambio posterior de idioma del navegador no cambia el idioma de una confirmación ya encolada.
- URLs de emails y de Stripe dirigidas a la versión correcta.
- `html lang`, metadatos, Open Graph y textos alternativos coherentes con la ruta.

### 14.3 Cambio de idioma

Conserva entidad y contexto: producto actual, proyecto, filtros compatibles y carrito. Si una página no tiene equivalente porque está retirada, ofrece una ruta válida con mensaje adecuado; no enlaces a una URL rota.

En administración, cambiar el idioma de interfaz no debe borrar lo que se está editando en cualquiera de los dos idiomas de producto.

## 15. Formularios, archivos de clientes y emails

### 15.1 Contacto y encargos

- Validación de cliente y servidor.
- Normaliza y valida email; limita longitudes y sanea contenido para presentación y email.
- Honeypot y rate limit duradero; si hace falta CAPTCHA, verifica su token en servidor y configura su privacidad correctamente.
- El rate limit debe funcionar entre instancias de Vercel. No uses solo un contador en memoria.
- Registra aceptación de la información de privacidad con versión/fecha cuando corresponda. No conviertas ese checkbox en consentimiento de marketing.
- Persiste la solicitud y crea outbox en la misma operación lógica.
- Confirma éxito solo después de persistir. Un `mailto:` o un `console.log` no completan un formulario.
- Si la notificación está pendiente por un fallo de email, conserva la solicitud y ofrece una respuesta veraz.
- Una doble pulsación o un reintento con la misma clave no crea dos solicitudes.

### 15.2 Flujo de archivos privados

Para encargos sin cuenta de cliente:

1. Crea un intento de formulario y una autorización temporal limitada tras la validación antiabuso.
2. Sube a una ruta aleatoria de `commission-private` con permiso acotado.
3. Valida el objeto y su vinculación al intento en servidor.
4. Al finalizar el formulario, asocia solo archivos de ese intento.
5. Aplica una política de limpieza para subidas temporales no vinculadas, conservando las que ya pertenecen a una solicitud.

No aceptes que el navegador adjunte IDs de archivos ajenos. No crees una política general de upload anónimo sin límites a un bucket privado pensando que la privacidad elimina el abuso.

### 15.3 Emails

Implementa plantillas HTML y texto plano con estilo sobrio, tipografía segura y variantes EN/ES:

- Confirmación de solicitud de encargo.
- Confirmación de mensaje de contacto, si se decide enviar un acuse.
- Confirmación de compra pagada.
- Pedido enviado, cuando se registre ese estado.
- Avisos internos de nueva compra o solicitud.
- Recuperación de acceso, mediante las plantillas/configuración soportadas por Supabase Auth y el proveedor de envío.

Los emails de compra incluyen referencia, líneas, cantidades, importes confirmados, contacto y enlace de estado autorizado. No los envíes al crear una sesión impagada.

Configura un dominio remitente verificado. Usa el email del visitante como `reply-to` cuando sea apropiado, nunca como remitente suplantado. No adjuntes fotos privadas a emails generales ni generes URLs públicas permanentes para que se puedan leer.

### 15.4 Outbox y reintentos

- Un registro único por notificación semántica, no uno por cada entrega de webhook.
- Trabajador con lease, lotes pequeños y reintentos progresivos.
- Llamadas al proveedor con clave de idempotencia estable cuando la admita.
- Guarda resultado e ID del proveedor.
- No hagas `fetch()` o envío de email sin esperar y supongas que seguirá ejecutándose tras devolver la respuesta de una función.
- Coordina reintentos con la ventana de idempotencia del proveedor. Para Resend, comprueba la ventana vigente; no supongas una garantía infinita.
- Si hay incertidumbre fuera de esa ventana, ofrece revisión de entrega antes de reenviar ciegamente.
- No prometas “exactly once” absoluto entre base de datos y proveedor externo. Exige unicidad transaccional interna y reintentos idempotentes dentro de las garantías comprobadas.

### 15.5 Trabajos programados

Necesitas conciliación de checkout, envío de outbox y limpieza de temporales. Para este stack, usa Supabase Cron con llamadas HTTP a funciones/endpoint internos o una alternativa duradera realmente disponible.

- Guarda secretos de invocación en el mecanismo seguro del proveedor, no en SQL público versionado.
- Endpoints internos autorizados y sin exposición de datos.
- Evita trabajos solapados mediante leases/locks de base de datos.
- Procesa lotes dentro de límites de tiempo de Vercel; reanuda el resto en la siguiente ejecución.
- Si optas por Vercel Cron, comprueba el plan y la frecuencia permitida. No diseñes una limpieza cada minuto asumiendo que todos los planes la soportan.
- Un cron de base de datos no debe liberar reservas basándose solamente en el reloj: debe iniciar la conciliación con Stripe que se ha descrito.

## 16. SEO, URLs y continuidad del sitio

### 16.1 SEO por idioma

- Title y description únicos, naturales y localizados.
- Canonical absoluto de la ruta real de cada idioma; las páginas españolas no apuntan todas al canonical inglés.
- `hreflang` recíprocos EN/ES y `x-default` con una decisión consistente.
- Open Graph con imagen real y texto localizado.
- Datos estructurados de artista/persona, breadcrumbs y productos basados en datos existentes.
- Para productos: precio en EUR, URL, imagen y disponibilidad que coincidan con la ficha. No publiques `InStock` cuando la disponibilidad esté sin verificar.
- No añadas AggregateRating, reseñas de producto, premios o certificaciones que no existan.
- Sitemap que incluya productos SSR publicados en ambos idiomas, no solo páginas prerenderizadas.
- Excluye borradores, preview, administración, carrito, retornos, estado de pedido y rutas con tokens.
- `noindex` para entornos de preview y sus pantallas privadas.
- Las rutas que no existen deben responder con 404 real, no un HTML de error con estado 200.

No necesitas añadir una dependencia de sitemap que después ignore los productos de Supabase. Implementa el endpoint indicado y valida su XML y sus URLs.

### 16.2 Redirecciones

Genera un mapa explícito para las rutas inglesas antiguas sin prefijo y las españolas con slugs ingleses. Ejemplos:

| Antes | Después |
| --- | --- |
| `/` | `/en/` |
| `/about-me/` | `/en/about-me/` |
| `/work/` | `/en/work/` |
| `/gallery/` | `/en/gallery/` |
| `/order/` | `/en/commissions/` |
| `/contact/` | `/en/contact/` |
| `/shop/` | `/en/shop/` |
| `/basket/` | `/en/cart/` |
| `/checkout/` | `/en/checkout/` |
| `/my-account/` | `/en/account-help/` |
| `/es/about-me/` | `/es/sobre-mi/` |
| `/es/work/` | `/es/obra/` |
| `/es/gallery/` | `/es/galeria/` |
| `/es/order/` | `/es/encargos/` |
| `/es/contact/` | `/es/contacto/` |
| `/es/shop/` | `/es/tienda/` |
| `/es/basket/` | `/es/carrito/` |
| `/es/checkout/` | `/es/finalizar-compra/` |
| `/es/my-account/` | `/es/ayuda-compra/` |

Completa también privacidad, cookies, categorías, productos y sus equivalentes españoles. El producto original `golden-retriever-mug-portrait-copy` necesita una correspondencia concreta si limpias su slug; no olvides la URL por contener `copy`.

La ruta de ayuda de compra explica la compra como invitado y el acceso al pedido. No redirijas una antigua cuenta de cliente al login privado de administración. No se ha autorizado ni diseñado una migración de cuentas o contraseñas de WooCommerce: registra esta diferencia con claridad.

Para archivos antiguos publicados, genera correspondencias a sus nuevos recursos cuando sea viable. Respeta límites de redirecciones de Vercel y evita reglas amplias que redirijan recursos diferentes al mismo archivo. No dejes dependencias activas del dominio WordPress para imágenes esenciales.

Valida ausencia de bucles, saltos innecesarios y pérdida de idioma. El selector EN/ES debe enlazar directamente al destino, sin pasar por redirecciones antiguas.

## 17. Rendimiento, seguridad y funcionamiento operativo

### 17.1 Rendimiento

Objetivos medidos en una configuración móvil documentada:

- LCP inferior a 2,5 s como objetivo de lanzamiento.
- CLS inferior a 0,1.
- Interacciones ágiles, con objetivo INP inferior a 200 ms cuando haya datos de campo; antes del lanzamiento, utiliza métricas de laboratorio adecuadas para detectar trabajo excesivo.
- Lighthouse móvil: objetivo 90 o más en rendimiento y 95 o más en accesibilidad/SEO/buenas prácticas, explicando cualquier resultado que dependa del entorno.

Medidas concretas:

- Hero optimizado, con dimensiones explícitas, prioridad alta solo para la imagen LCP y sin lazy loading en ella.
- Resto de imágenes con lazy loading, `sizes` y `srcset` correctos.
- Evita cargar la resolución de zoom en todas las miniaturas.
- Fuentes locales, pocos pesos, `font-display` apropiado y preload limitado a lo realmente necesario.
- JS de primera carga pública idealmente por debajo de 100 KiB gzip de código propio y dependencias de UI, excluyendo servicios externos que no deban cargarse en esa pantalla. Mide y justifica el resultado real.
- No cargues el editor privado, SDK de Stripe de servidor ni utilidades de conversión en las páginas públicas.
- Consulta de home limitada a productos destacados; el fallo de esa consulta no debe derribar la presentación artística. Muestra un estado localizado y acceso a tienda/contacto sin precios ficticios.
- Índices para slug/locale, catálogo publicado, órdenes pendientes, reservas y outbox.
- Reutiliza promesas/consultas dentro de una petición cuando tenga sentido, sin almacenar información privada en cachés globales.

### 17.2 Seguridad concreta

- Valida y limita todo input de API, incluidos query parameters.
- Control de Origin/CSRF para mutaciones basadas en cookies. El webhook utiliza firma de Stripe y no debe depender de un token CSRF del navegador.
- Rate limits duraderos para login, formularios, cotización, checkout y subidas.
- No permitas URLs arbitrarias en descargas del servidor ni rutas de archivo proporcionadas por el usuario.
- Sanitiza el contenido que pueda convertirse en HTML. Para las descripciones editables, usa texto/Markdown controlado o un editor de contenido con saneamiento explícito.
- CSP acorde con los recursos que realmente se utilicen, junto a cabeceras de tipo de contenido, referrer y protección de transporte apropiadas.
- No rompas el checkout, las fuentes o las imágenes por copiar una CSP genérica sin probarla.
- Ningún secreto en variables `PUBLIC_*`, HTML, JSON público, sourcemaps públicos o logs.
- `private, no-store` para panel, pedidos, archivos privados, cotizaciones y respuestas de sesión.
- Respuestas de error sin PII, SQL ni stack traces.
- Tokens de estado de pedido de alta entropía, alcance de lectura y caducidad; almacena su hash cuando corresponda. Un ID secuencial o el email del comprador no son autenticación suficiente.
- Enlaces con tokens tratados como datos sensibles; evita analytics/referrers que los filtren.

### 17.3 Observabilidad

Registra eventos operativos con IDs de correlación para intento, pedido y evento de Stripe. Incluye tipo de error y fase, sin payloads de pago completos, fotos, secretos o direcciones en logs genéricos.

Haz visible para administración:

- Webhooks en error o pendientes.
- Checkout atascados y reservas antiguas.
- Notificaciones fallidas.
- Imágenes que no pudieron procesarse.
- Productos sin traducción, precio verificado o inventario confirmado.

Documenta cómo conciliar un pago confirmado en Stripe cuyo webhook se retrasó y cómo reenviar un evento de manera segura.

### 17.4 Cookies y scripts del sitio anterior

No migres automáticamente los scripts de marketing, píxeles y plugins encontrados en el HTML de WordPress. Empieza con lo necesario para la funcionalidad implementada y documenta las cookies reales.

Si añades analítica o herramientas no esenciales, deben tener la configuración y el consentimiento que correspondan al uso final. No muestres un banner decorativo que “acepta cookies” sin controlar nada.

## 18. Variables de entorno y despliegue en Vercel

### 18.1 Configuración

Incluye `.env.example` sin secretos reales, con estas responsabilidades:

| Variable | Uso |
| --- | --- |
| `SITE_URL` | Origen autorizado del entorno para callbacks y retornos |
| `PUBLIC_SUPABASE_URL` | Proyecto de Supabase del entorno |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Clave publicable; siempre protegida por políticas de acceso |
| `SUPABASE_SECRET_KEY` | Secreto de servidor o service role compatible con el proyecto |
| `STRIPE_SECRET_KEY` | API de Stripe del entorno |
| `STRIPE_WEBHOOK_SECRET` | Firma del endpoint de webhook de ese entorno |
| `STRIPE_MODE` | `test` o `live`, contrastado con configuración/eventos |
| `RESEND_API_KEY` | Envío de emails desde backend |
| `EMAIL_FROM` | Remitente autorizado y verificado |
| `ARTIST_NOTIFICATION_EMAIL` | Destinatario de avisos internos |
| `CRON_SECRET` | Autorización de trabajos internos |
| `ALLOWED_ORIGINS` | Orígenes permitidos para el entorno |
| `DATA_MODE` | `live` por defecto en despliegues reales; demo solo de forma explícita en desarrollo |
| `PAYMENTS_ENABLED` | Interruptor operativo, además de la validación de configuración comercial |

Si necesitas secretos adicionales para cookies o tokens firmados, decláralos y documéntalos. No añadas variables sin utilizarlas ni uses valores inventados que parezcan credenciales reales.

Valida las variables al arrancar el servicio o al usar la integración correspondiente. En producción, la ausencia de Supabase o Stripe no debe activar silenciosamente un backend falso.

### 18.2 Entornos

- Desarrollo local con Supabase CLI/Docker cuando esté disponible y Stripe test.
- Entorno de pruebas separado, con fixtures claramente identificados.
- Preview de Vercel con Stripe test y datos separados de producción.
- Producción con sus propios secretos, webhook, redirects de Auth y configuración comercial.

Impide que un preview use claves live por accidente. Asegura que el webhook del entorno es accesible para Stripe sin exponer el panel privado ni depender de la cookie de un navegador.

### 18.3 Despliegue

- `engines.node` y runtime compatibles en `24.x`.
- Build con `pnpm build` y lockfile respetado.
- Adaptador oficial y artefacto de salida generado por Astro/Vercel; no inventes un servidor persistente externo.
- No fuerces una SPA fallback para todas las rutas.
- No configures manualmente una carpeta de salida que contradiga el adaptador.
- Región de funciones razonablemente próxima al proyecto Supabase, según disponibilidad real.
- Redirects y cabeceras comprobados en preview.
- Migraciones aplicadas mediante procedimiento controlado y documentado, no al recibir la primera visita pública.
- Si se requiere rebuild para cambiar contenido editorial local, documenta ese caso. Los productos, stock y pedidos del panel sí deben funcionar sin reconstrucción.
- Copia de seguridad/exportación y procedimiento de recuperación documentados antes de activar venta real.
- Plan de servicios compatible con uso comercial y límites reales; no prometas que el conjunto de la tienda y sus trabajos recurrentes es gratuito.

El alcance solicitado es preparar la web para desplegar. Si tienes un entorno autorizado, puedes generar y verificar un preview. La conexión del dominio definitivo, los cambios de DNS y la activación de cobros live deben figurar como pasos operativos explícitos del lanzamiento.

## 19. Pruebas y evidencias

### 19.1 Verificación del contenido

- 18 productos importados por legacy ID, si la fuente no ha cambiado.
- 6 motivos y 3 categorías, con nombres en ambos idiomas.
- 47 imágenes únicas verificadas y 47 asociaciones normalizadas, sin perder las cuatro repeticiones registradas en el informe.
- 19 grupos del portfolio y sus 48 enlaces de imagen de referencia conciliados.
- 16 posiciones de la galería extra, 4 imágenes biográficas, 4 imágenes de ejemplos de encargos y 3 de Feedbacks preservadas como usos del contenido.
- Dibujo/foto correctos para cada sujeto, especialmente los grupos con imágenes intercaladas.
- Originales HEIC/PDF registrados y derivados visualizables comprobados.
- Ningún recurso esencial depende del WordPress viejo.
- Cero imágenes rotas en las rutas públicas.
- Precios EUR y unidades menores correctos; ninguna falsa promoción.

Los conteos son una línea base de auditoría, no un motivo para descartar contenido que haya aparecido después. Si la fuente cambia, actualiza el informe y conserva la explicación de la diferencia.

### 19.2 Pruebas automáticas de dominio e integración

Prueba reglas con consecuencias reales. No llenes la suite de tests que repitan la implementación de componentes triviales.

| Caso | Resultado exigido |
| --- | --- |
| Interpretar `349` con EUR y unidad menor 2 | 3,49 EUR, sin error por separadores |
| Una taza, un posavasos y una tarjeta | Subtotal de `1847` céntimos antes del envío aplicable |
| Cliente altera precio, moneda o total | El servidor rechaza o ignora esos valores y usa los propios |
| Cantidad negativa, decimal, cero o desmesurada | Rechazo de validación |
| El mismo producto se envía en varias líneas | Se normaliza y se comprueba el límite sobre la suma |
| Cotización caducada | Error localizado y renovación de cotización |
| Cambio de precio después de cotizar | `PRICE_CHANGED`, revisión y ningún cobro silencioso |
| Producto despublicado o venta desactivada | No se crea Checkout |
| Inventario sin verificar | Venta bloqueada sin inventar unidades |
| Dos intentos distintos compiten por la última unidad | Solo uno reserva; nunca hay stock negativo |
| Falta stock en una línea de un carrito múltiple | Se revierte la reserva completa |
| Doble clic con el mismo intento | Un pedido, una reserva y una sesión efectiva |
| Misma idempotencia con cuerpo diferente | Conflicto, sin segundo cobro |
| Timeout de Stripe después de crear sesión | Estado recuperable, sin liberar stock todavía cobrable |
| Fallo de base de datos tras respuesta de Stripe | Conciliación recupera la sesión sin duplicarla |
| Webhook llega antes de persistir session_id | Vinculación válida al intento y procesamiento consistente |
| Firma de webhook incorrecta | Rechazo sin cambios de estado |
| Mismo webhook dos veces, también en paralelo | Un efecto comercial y un registro de notificación |
| Eventos distintos del mismo pago | Un solo descuento de stock |
| Evento de expiración llega después del pago | Pedido pagado sin reversión |
| Fecha local vencida pero sesión todavía abierta | No libera hasta confirmar expiración segura |
| GET a la página de cancelación | No cambia pedido ni inventario |
| Cancelación compite con pago | Resultado acorde con Stripe, sin doble transición |
| Pago tarda o queda procesando | No se muestra confirmación prematura ni se libera a ciegas |
| Reembolso confirmado | Estado financiero correcto; no repone stock automáticamente |
| Error durante outbox/email | Pedido sigue pagado y la notificación puede reintentarse |
| Acceso anónimo a API privada | 401/403 y ningún dato privado |
| Usuario Auth sin rol admin | Sin CRUD, inventario ni pedidos |
| Acceso a archivos de otra solicitud | Denegación real |
| Upload falso JPEG que contiene HTML o exceso de tamaño | Rechazo y limpieza controlada |
| Conflicto de edición de producto | Aviso, sin sobrescritura silenciosa |
| Modificar catálogo desde el panel | La web SSR refleja el cambio sin rebuild |

Las pruebas de concurrencia e invariantes se ejecutan contra Postgres real de test, no solamente contra un mock de un array en memoria. Prueba RLS con roles/tokens anónimo, usuario ordinario y administrador, incluyendo rutas directas de API.

### 19.3 Pruebas de navegador

Con Playwright, recorre en EN y ES:

- Navegación, menú móvil y selector de idioma.
- Portfolio, filtro, lightbox y comparador.
- Catálogo, filtros, ficha y galería.
- Añadir, cambiar cantidades, eliminar y persistir carrito.
- Revisión de precio o disponibilidad.
- Formulario de contacto y solicitud de encargo con su validación.
- Login y denegación de administración.
- Crear/editar/traducir un producto, ordenar imágenes y archivar.
- Estado de pedido sin autorización y con autorización correcta.
- Teclado, Escape, retorno de foco y movimiento reducido.

### 19.4 Stripe y email reales en modo test

Además de pruebas deterministas con dobles del proveedor:

- Realiza al menos una compra completa con Stripe en modo test.
- Recibe el webhook mediante Stripe CLI o endpoint de preview real.
- Comprueba importes, una sola transición, inventario y notificación.
- Prueba rechazo de tarjeta y recuperación del flujo sin reserva duplicada.
- Prueba expiración/cancelación mediante las herramientas de test apropiadas, sin esperar innecesariamente 35 minutos cuando la API permita expirar la sesión.
- Reenvía un evento de test para verificar idempotencia.
- Verifica un email EN y otro ES con el proveedor o entorno de captura correspondiente.

Si faltan claves, acceso al proveedor o servicios de test, marca esas comprobaciones como pendientes. No sustituyas el pago real de test por una pantalla de “éxito” construida con datos falsos.

### 19.5 QA visual

Captura y revisa pantallas reales en 390 px y 1440 px, y comprobaciones de los otros anchos definidos. Incluye al menos Home, Work, Galería extra, Encargos, Tienda, Producto, Carrito, Contacto y editor privado.

Inspecciona:

- Composición, jerarquía y ritmo.
- Tamaño y saltos de línea de titulares EN/ES.
- Proporción de cada obra y ausencia de recortes destructivos.
- Legibilidad de reseñas y pies.
- Estados de foco y diálogo.
- Alineación de controles y precios.
- Espacios vacíos accidentales, elementos superpuestos y scroll horizontal.
- Tiempos de entrada y preferencia de movimiento reducido.
- Pantallas con textos largos y errores reales.

Corrige los defectos antes de dar por terminado el diseño. La existencia de screenshots no sustituye su inspección.

### 19.6 Comandos de entrega

Define y ejecuta comandos equivalentes a:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm migration:verify
pnpm build
```

Implementa los scripts que declares. Si un comando necesita servicios externos, documenta requisitos y resultado. No dejes scripts vacíos que devuelvan éxito sin comprobar nada.

## 20. Secuencia de trabajo y criterios de cada fase

### Fase 1 · Auditoría reproducible

- Leer repositorio e instrucciones.
- Confirmar stack y versiones.
- Descargar/normalizar contenido y catálogo.
- Crear manifiestos y mapa de asociaciones.
- Documentar pendientes comerciales sin inventarlos.

Salida: el inventario y las diferencias con esta auditoría se pueden revisar antes de importar.

### Fase 2 · Fundamentos y primer diseño completo

- Crear proyecto, tipado, rutas, diccionarios y estilos.
- Implementar header/footer, home y una ficha de proyecto representativa.
- Usar imágenes reales desde el principio.
- Inspeccionar móvil/escritorio y corregir composición.

Salida: la dirección artística ya existe en código y se ve en dos idiomas; no es un moodboard ni una promesa.

### Fase 3 · Sitio editorial y migración

- Terminar biografía, Work, galería, encargos y contacto.
- Integrar asociaciones verificadas y conversiones.
- Añadir rutas nuevas, redirects y SEO.

Salida: todas las secciones originales se conservan y son navegables.

### Fase 4 · Supabase, catálogo y panel

- Migraciones, RLS, Auth, Storage y bootstrap de administrador.
- Importar catálogo real de manera idempotente.
- Terminar tienda, producto y CRUD privado.
- Mantener ventas desactivadas cuando falte inventario/configuración real.

Salida: editar o crear un producto desde el panel actualiza la web sin tocar código.

### Fase 5 · Comercio y comunicación

- Carrito, cotización, reservas, checkout e idempotencia.
- Webhook, conciliación, cancelación y estados de pedido.
- Formularios reales, archivos privados, emails y outbox.

Salida: un flujo completo en test deja pedido, stock y notificaciones coherentes, incluso con reintentos.

### Fase 6 · Verificación y entrega

- Pruebas, accesibilidad, rendimiento y QA visual.
- Preparar/verificar Vercel preview si hay acceso autorizado.
- Manual de artista, despliegue y operaciones.
- Informe de lo probado y de los pasos externos pendientes.

No pospongas toda la calidad visual hasta después de terminar el backend. Mantén una revisión de diseño continua y una revisión final con datos reales.

## 21. Organización multitarea para Cursor

Si la instalación ofrece Agents Window, subagentes o `/multitask`, utiliza esas capacidades reales. La selección de modelo “Auto” y la ejecución de tareas en paralelo son conceptos diferentes: activar uno no garantiza el otro.

El coordinador debe leer el encargo entero y mantener una sola definición de contratos. Define antes de delegar:

- Rutas y claves de idioma.
- Tokens visuales y componentes compartidos.
- Tipos de producto, dinero, pedido, error y disponibilidad.
- Esquema inicial y funciones transaccionales.
- Contratos de API, códigos de error y estrategia de datos de test.

Después distribuye:

| Rol | Responsabilidad | Ámbito principal |
| --- | --- | --- |
| Coordinador | Arquitectura, contratos, integración y resolución de conflictos | Configuración, tipos, rutas y revisión final |
| Migración | Extracción, recursos, conversiones y asociaciones | `scripts/migration/`, `migration/`, contenido normalizado |
| Diseño y editorial | Sistema visual, layouts, portfolio, biografía y páginas informativas | Vistas públicas, estilos y componentes de arte |
| Datos y administración | Supabase, RLS, Auth, Storage y panel | Migraciones y administración |
| Comercio | Cotización, carrito, reservas, Stripe y conciliación | Servicios de comercio y endpoints relacionados |
| QA e integración | Pruebas, i18n, accesibilidad, redirects y validación | `tests/`, informes y revisión de flujos |

Reglas de colaboración:

1. Usa worktrees o ámbitos de archivos realmente separados cuando la herramienta lo permita.
2. Asigna un propietario a cada migración, archivo de configuración, lockfile y contrato compartido.
3. El agente de datos coordina las funciones de reservas con el de comercio antes de implementarlas en paralelo.
4. Nadie añade una dependencia o cambia el contrato común sin informar al coordinador.
5. No hagas que todos los agentes editen `package.json`, las mismas rutas o los mismos diccionarios a la vez.
6. No ejecutes en paralelo importaciones/migraciones destructivas contra la misma base de datos.
7. Reutiliza un servidor de desarrollo por checkout y respeta los mecanismos de lock de Astro 7.
8. Cada agente entrega cambios, decisiones, comprobaciones y pendientes concretos; el coordinador revisa e integra.
9. Después de integrar, ejecuta la suite con el resultado conjunto y comprueba visualmente la web completa.
10. Si no hay soporte de multitarea, continúa secuencialmente sin simular agentes ni inventar comandos.

Orden razonable: auditoría y contratos; después migración, diseño y datos en paralelo; luego integración comercial sobre el esquema acordado; finalmente QA conjunto. Las dependencias importantes se respetan aunque exista capacidad de paralelismo.

## 22. Entregables obligatorios

1. Proyecto Astro 7 completo y compilable, con lockfile.
2. Todas las páginas públicas en EN/ES y diseño revisado en móvil/escritorio.
3. Catálogo migrado, con 18 productos y 47 imágenes únicas salvo cambios documentados de fuente.
4. Portfolio y galería conservados con asociaciones verificadas.
5. Scripts de migración, conversión y validación reproducibles.
6. Supabase: esquema, migraciones, políticas RLS, buckets/configuración y funciones transaccionales.
7. Panel privado real, con CRUD, traducciones, imágenes, inventario y pedidos.
8. Carrito, cotización, Stripe Checkout y webhooks seguros e idempotentes.
9. Formularios, archivos privados, emails bilingües y trabajos de outbox/conciliación.
10. Redirects, metadatos, sitemap y páginas auxiliares.
11. Pruebas y evidencias de ejecución, con los pendientes externos diferenciados.
12. `.env.example`, README y documentos operativos.

Documentación mínima:

| Documento | Qué debe permitir hacer |
| --- | --- |
| `README.md` | Instalar, configurar, arrancar y ejecutar las comprobaciones |
| `docs/architecture.md` | Entender renderizado, permisos, dinero y estados de compra |
| `docs/migration-report.md` | Ver origen, conteos, correspondencias, conversiones y diferencias |
| `docs/admin-guide.es.md` | Que la artista añada/edite un producto, imágenes, traducciones y stock sin programar |
| `docs/admin-guide.en.md` | La misma guía en inglés |
| `docs/vercel-deployment.md` | Configurar Supabase, Vercel, Stripe, email y entornos |
| `docs/commerce-operations.md` | Conciliar, investigar reservas, reintentar emails y gestionar devoluciones |
| `docs/qa-report.md` | Saber qué se comprobó, con qué entorno y qué falta |
| `docs/launch-checklist.md` | Revisar datos comerciales reales, inventario, textos y configuración live |

No dejes `TODO` en el camino crítico ni botones sin acción. Si una comprobación externa no se puede realizar, el código debe quedar completo y el informe debe describir el bloqueo concreto y su siguiente paso.

## 23. Criterios de aceptación finales

El trabajo cumple cuando se puede demostrar lo siguiente:

- La portada transmite una identidad artística sofisticada y el resto de páginas mantiene ese nivel.
- Las obras y fotografías son las reales del sitio, con sus proporciones y relaciones preservadas.
- Todas las secciones existentes están presentes y sus traducciones son completas.
- La tienda presenta el catálogo verdadero y sus precios EUR verificados.
- La artista puede crear, editar, traducir, ilustrar y archivar un producto desde el panel.
- El precio y disponibilidad públicos cambian sin rebuild tras una edición comercial válida.
- Nadie sin permisos puede administrar productos o acceder a pedidos/fotografías privadas.
- La compra usa importes del servidor y valida las cantidades.
- Dos compradores no pueden reservar la misma última unidad.
- Los clics y webhooks repetidos no duplican pedido, descuento de stock o notificación semántica.
- Una sesión incierta o todavía cobrable no libera stock de forma prematura.
- Cerrar el navegador tras pagar no hace perder el pedido.
- El retorno de éxito no puede falsificar un pago ni filtrar información de otro comprador.
- Los formularios guardan solicitudes reales y las fotografías de clientes permanecen privadas.
- EN/ES cubre también errores, estados, productos y emails.
- El proyecto compila y las pruebas relevantes pasan o constan como pendientes externos precisos.
- Hay una ruta documentada de despliegue en Vercel y operación posterior.

Tu respuesta final de implementación debe presentar: resultado, cómo arrancarlo, qué se migró, pruebas ejecutadas, acceso/configuración del panel y dependencias externas pendientes. Evita decir “listo para producción” si faltan pruebas o configuración comercial necesarias.

Empieza ahora por inspeccionar el repositorio y confirmar las fuentes; después continúa hasta completar la implementación disponible dentro del entorno.

---

## Anexo A. Las 47 imágenes originales del catálogo

URLs e IDs obtenidos de la API pública. Todas se descargaron correctamente durante la auditoría y dieron hashes de contenido distintos. Revalida su disponibilidad al ejecutar la migración. La portada de cada producto y su orden están en la tabla del apartado 2.

| ID Woo de imagen | Archivo original | SHA-256 del original descargado |
| --- | --- | --- |
| `1790` | [Jack-russel.jpg](https://petsdrawings.com/wp-content/uploads/2026/06/Jack-russel.jpg) | `1be829b5589e3fcad38847b190c0abfdd5315468734ecd6bcd6fac9c8dc32914` |
| `1791` | [jack-russel-mug.jpg](https://petsdrawings.com/wp-content/uploads/2026/06/jack-russel-mug.jpg) | `4c6571ead3a7fe9272dc4ecbe8afe3c964d119f40cef1ca6576278dfc76afc26` |
| `1799` | [jack-russel-1.jpg](https://petsdrawings.com/wp-content/uploads/2026/06/jack-russel-1.jpg) | `3e18755cd607f30bb1624613f952f7d11ea8e69ee39fd5e97312f8aa4df79fa7` |
| `1800` | [jack-russel-3.jpg](https://petsdrawings.com/wp-content/uploads/2026/06/jack-russel-3.jpg) | `1932cde12232e147337cacffe7bd18c3f3ce7dcba52d81633093a3a033c406df` |
| `1801` | [Jack-russel_.jpg](https://petsdrawings.com/wp-content/uploads/2026/06/Jack-russel_.jpg) | `78284d0643fa99578c9b194f1a29941a850ebf088dacbde6557c554bbf2dcded` |
| `1804` | [Jackrusell-card.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/Jackrusell-card.jpg) | `1b67738600ed3d2d5045713f7053a989570f500f4f43f3e7e76732118f2b9a3c` |
| `1805` | [jackrussell-card-2.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/jackrussell-card-2.jpg) | `f3c218bdfe02afaa0470780298acff7ce47039912cd933b93d939ce0ed968917` |
| `1818` | [Border-Collie_.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/Border-Collie_.jpg) | `9be73e2dbe2ea4666dec48358f4c60c70f57ff886223bc950943878722684a38` |
| `1819` | [Border-Collie-mug.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/Border-Collie-mug.jpg) | `93b2cecd8496536120304122b77abaf399da1feefb4075c4f3756978dc84f14c` |
| `1823` | [Border-collie-1.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/Border-collie-1.jpg) | `48df233b60d57add221351209e42005e40869d6961e0b218ec8287f54242ff0e` |
| `1824` | [Border-collie-2.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/Border-collie-2.jpg) | `0af1aa6c1f290ace50c5e6344e4abbef1ee6534724d66394ae0ec7129dabb6d7` |
| `1825` | [Border-collie-3.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/Border-collie-3.jpg) | `125e16d3c5fe514e28d1bec040108e0ddf9f85b6e1e79a82d44791c58ea14c57` |
| `1827` | [White-Minimalist-Paper-Card-Mockup-Instagram-Post.png](https://petsdrawings.com/wp-content/uploads/2026/07/White-Minimalist-Paper-Card-Mockup-Instagram-Post.png) | `bad0763fe8a292e33f5ce597ea8d6c37cd6a4a87d7f48a719f3efea6015ebb0a` |
| `1828` | [Neutral-Simple-Aesthetic-Wedding-Invitation-Card-Instagram-Post.png](https://petsdrawings.com/wp-content/uploads/2026/07/Neutral-Simple-Aesthetic-Wedding-Invitation-Card-Instagram-Post.png) | `3e0451f9cc452379ae8625481f7a9f8a3eec430e0c6b84b6b2a770b494a1d110` |
| `1829` | [White-and-Beige-Minimalist-Card-Mockup-Facebook-Post.png](https://petsdrawings.com/wp-content/uploads/2026/07/White-and-Beige-Minimalist-Card-Mockup-Facebook-Post.png) | `a81bb19d5ab86b4c64701be47821c4c66cdd7af28ec3d7debc1b599913686f69` |
| `1938` | [mock-up1-dashund.jpeg](https://petsdrawings.com/wp-content/uploads/2026/07/mock-up1-dashund.jpeg) | `be8f1ef534a65bf0e64720969d30bebe9797811e3ecfe640b7dfba9071b5e4b5` |
| `1939` | [dachshund.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/dachshund.jpg) | `c089c6894a0ac75ced994dfb478d191372f70eab8e0e80e5e3211d4c0eef4016` |
| `1941` | [Dachshund-2.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/Dachshund-2.jpg) | `5a766433fd1a9a84818e0919e87b74b788d6294f13925ba4dce7512892433d94` |
| `1942` | [Dachshund-1.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/Dachshund-1.jpg) | `93c1489ae9a5bed63dba0b3118f54478be6fb7537325568ba158898a6be30782` |
| `1943` | [Dachshund-coaster.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/Dachshund-coaster.jpg) | `044167e3319b40e76a33287b786ad7ada7cbe567496e208cc705d5d4766fc6e8` |
| `1945` | [Neutral-Simple-Aesthetic-Wedding-Invitation-Card-Instagram-Post-1.png](https://petsdrawings.com/wp-content/uploads/2026/07/Neutral-Simple-Aesthetic-Wedding-Invitation-Card-Instagram-Post-1.png) | `32c3e8abaf7b7fd0241765ff36c270fdc2ade027d4f98275c6941ca7013918e5` |
| `1946` | [White-and-Beige-Minimalist-Card-Mockup-Facebook-Post-5.png](https://petsdrawings.com/wp-content/uploads/2026/07/White-and-Beige-Minimalist-Card-Mockup-Facebook-Post-5.png) | `a541a60067ce48c710352f79727adb8974ba040f6fc765a4a0baa955dd4d0816` |
| `1947` | [White-Minimalist-Paper-Card-Mockup-Instagram-Post-copy-2.png](https://petsdrawings.com/wp-content/uploads/2026/07/White-Minimalist-Paper-Card-Mockup-Instagram-Post-copy-2.png) | `f7c7f55aff9474579a0b56b330b744a7c543dd2f02ef40c38b89ec578a13e7e0` |
| `1951` | [Golden-Retriver-1.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/Golden-Retriver-1.jpg) | `ee48080f97b3e9cec91fb040a4b4a98e62564ccdd1dffcf7e8fc590ecd257341` |
| `1952` | [Golden-Retriver.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/Golden-Retriver.jpg) | `fff97a1ec1e78bcad0478feadbfb0e676e17c951c6314926e46fb3813613daea` |
| `1954` | [Golden-Retriver-2.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/Golden-Retriver-2.jpg) | `0130faa554b0c7db3f8ccebae9826adbd306ae144c000799edf42a8e1bec8f7d` |
| `1955` | [Golden-Retriver-3.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/Golden-Retriver-3.jpg) | `1363cce991e96bd8ae4858de01f732dad7f4656273c8fb10722560e1164fd6a6` |
| `1956` | [Golden-Retriver-1-1.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/Golden-Retriver-1-1.jpg) | `6db15191c12a882550855ade45f27199f0f4952ca367beff9c9118c1ce0c57e3` |
| `1958` | [Neutral-Simple-Aesthetic-Wedding-Invitation-Card-Instagram-Post-copy.png](https://petsdrawings.com/wp-content/uploads/2026/07/Neutral-Simple-Aesthetic-Wedding-Invitation-Card-Instagram-Post-copy.png) | `255719ee84ab0f922c7e1886a607f6d9861104b2af3f5e0dc2f7ce43cd3d1f39` |
| `1959` | [White-and-Beige-Minimalist-Card-Mockup-Facebook-Post-6.png](https://petsdrawings.com/wp-content/uploads/2026/07/White-and-Beige-Minimalist-Card-Mockup-Facebook-Post-6.png) | `2a6ff8c92515209c56e3c22cbac4aac441887a5d5d31452c49ea57d1c4277a17` |
| `1960` | [White-Minimalist-Paper-Card-Mockup-Instagram-Post-4.png](https://petsdrawings.com/wp-content/uploads/2026/07/White-Minimalist-Paper-Card-Mockup-Instagram-Post-4.png) | `f0182c03753f89807019061448dfb6b27f7329a2aed714db8e3f86e4516a2f7e` |
| `1962` | [mockupod_0101_white-11oz-coffee-mug-mockup-aesthetic-background-2.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/mockupod_0101_white-11oz-coffee-mug-mockup-aesthetic-background-2.jpg) | `7897fcc5b41ea79578c56c92483c06a6085efe82336be3c99bbd660f3f38249c` |
| `1963` | [Labrador.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/Labrador.jpg) | `b45471a30f12e51b66fd49aa92e8a003a580390c15138da102079aff15b3e138` |
| `1965` | [Coaster-Labrador.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/Coaster-Labrador.jpg) | `2fe4deeccf53cb86dfce1888cc3cf8a02b14fb80e28def57a2bed59d884d5aee` |
| `1966` | [Labrador-1.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/Labrador-1.jpg) | `7f68ace4927da26262d822e6fb235ef1e1d66a12698c7a30ca15b43b919d516e` |
| `1967` | [Labrador-2.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/Labrador-2.jpg) | `a17951426205f4839d53bdadfea8c6d3c1a9023316c7405788c2792059cdd14a` |
| `1969` | [White-and-Beige-Minimalist-Card-Mockup-Facebook-Post-2.png](https://petsdrawings.com/wp-content/uploads/2026/07/White-and-Beige-Minimalist-Card-Mockup-Facebook-Post-2.png) | `bb70459131425769aa96e3d6c0f69a349c6c86f5f132fd921a7285ac48e7be44` |
| `1970` | [White-Minimalist-Paper-Card-Mockup-Instagram-Post-copy-3.png](https://petsdrawings.com/wp-content/uploads/2026/07/White-Minimalist-Paper-Card-Mockup-Instagram-Post-copy-3.png) | `df65ae56c08fbf29d37bb161636e1f52f1d8c2d59c0d48bab16f4f85fc0b2187` |
| `1971` | [Neutral-Simple-Aesthetic-Wedding-Invitation-Card-Instagram-Post-2.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/Neutral-Simple-Aesthetic-Wedding-Invitation-Card-Instagram-Post-2.jpg) | `493106082e754620fbfcd740d3a73969c12544ebffe7a7bb2df8dd2b59c9860a` |
| `1975` | [Unknown.jpeg](https://petsdrawings.com/wp-content/uploads/2026/07/Unknown.jpeg) | `2d43bf2c94fc7d546fb410f956439a670e8c17b3915f50097ce01648f1380c10` |
| `1976` | [Sringer-spanial.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/Sringer-spanial.jpg) | `21d539773d07a57c95ae8f11cf5f6410e875c9f467cc26285a47b98d78d1bc8c` |
| `1978` | [Coaster-Springer-spanials.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/Coaster-Springer-spanials.jpg) | `620ac86d2624c76fb322f821ff4662be3e82f937756df6832db6af6475de5c2b` |
| `1979` | [Springer-spanial-1.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/Springer-spanial-1.jpg) | `4bd1e0799a5b941df78be81b770781368fb733418829f9669e8d25a534e80bd8` |
| `1980` | [springer-spanial-2.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/springer-spanial-2.jpg) | `34a7746f005fb9638b46c35ad0e2b4313c979e7cf426fa1954dcfd0a4e82718f` |
| `2043` | [White-Minimalist-Paper-Card-Mockup-Instagram-Post-2.png](https://petsdrawings.com/wp-content/uploads/2026/08/White-Minimalist-Paper-Card-Mockup-Instagram-Post-2.png) | `f2744bf170c174e50e74f7e7cfdb47b352e9b834e65d86d2cf85b0ac4b0aa852` |
| `2044` | [Neutral-Simple-Aesthetic-Wedding-Invitation-Card-Instagram-Post.jpg](https://petsdrawings.com/wp-content/uploads/2026/08/Neutral-Simple-Aesthetic-Wedding-Invitation-Card-Instagram-Post.jpg) | `2d8253e49ef50d9665f1a929f3cff2c52c9a20a088b6b228d796bf215287ccd4` |
| `2045` | [White-and-Beige-Minimalist-Card-Mockup-Facebook-Post-4.png](https://petsdrawings.com/wp-content/uploads/2026/08/White-and-Beige-Minimalist-Card-Mockup-Facebook-Post-4.png) | `402c91fe331fc428939f52a227a5601b5a493a8d200b8d07255b4e789238141f` |

## Anexo B. Portfolio: grupos y URLs observados

Estas listas conservan el orden de enlaces de la web original. **Orden de enlace no significa emparejamiento automático.** Comprueba identidad y función visual y registra cada asociación explícita en el manifiesto.

### B.1. Dogs A3

1. Sin etiqueta editorial útil: [IMG_1612-1547x1080.jpg](https://petsdrawings.com/wp-content/uploads/2026/08/IMG_1612-1547x1080.jpg).
2. Sin etiqueta editorial útil: [A3-drawing-jack-russels-1528x1080.jpg](https://petsdrawings.com/wp-content/uploads/2026/08/A3-drawing-jack-russels-1528x1080.jpg).
3. Sin etiqueta editorial útil: [IMG_5270.jpg](https://petsdrawings.com/wp-content/uploads/2026/08/IMG_5270.jpg).

### B.2. Dogs A3

1. Sin etiqueta editorial útil: [IMG_1585-1528x1080.jpg](https://petsdrawings.com/wp-content/uploads/2026/08/IMG_1585-1528x1080.jpg).
2. Sin etiqueta editorial útil: [BE046129-13D3-42A6-87A1-F3C54DF4DE2B-1620x1080.jpg](https://petsdrawings.com/wp-content/uploads/2026/08/BE046129-13D3-42A6-87A1-F3C54DF4DE2B-1620x1080.jpg).

### B.3. Dog: Mabel

1. Mabel: [IMG_1562-e1786611102186-764x1080.jpg](https://petsdrawings.com/wp-content/uploads/2026/08/IMG_1562-e1786611102186-764x1080.jpg).
2. Mabel: [IMG_1955-810x1080.jpg](https://petsdrawings.com/wp-content/uploads/2026/08/IMG_1955-810x1080.jpg).

### B.4. Dog

1. Sin etiqueta editorial útil: [IMG_1509-770x1080.jpg](https://petsdrawings.com/wp-content/uploads/2026/08/IMG_1509-770x1080.jpg).
2. Sin etiqueta editorial útil: [PHOTO-2025-06-07-10-21-49-e1786446260284.jpg](https://petsdrawings.com/wp-content/uploads/2026/08/PHOTO-2025-06-07-10-21-49-e1786446260284.jpg).

### B.5. Cat: Smokey

1. Smokey: [IMG_3394-pdf-755x1080.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/IMG_3394-pdf-755x1080.jpg).
2. Smocky: [IMG_3427-pdf-810x1080.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/IMG_3427-pdf-810x1080.jpg).
3. Smoky: [1000056511.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/1000056511.jpg).

### B.6. Dog

1. Sin etiqueta editorial útil: [IMG_1234-770x1080.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/IMG_1234-770x1080.jpg).
2. Sin etiqueta editorial útil: [20250616_160803-810x1080.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/20250616_160803-810x1080.jpg).

### B.7. Cats: Michi & Pantera

1. Michi: [IMG_2576-2-2-pdf-765x1080.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/IMG_2576-2-2-pdf-765x1080.jpg).
2. Pantera: [IMG_2491-2-pdf-770x1080.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/IMG_2491-2-pdf-770x1080.jpg).
3. Mugs & Coasters: [IMG_2580-1-pdf-1055x1080.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/IMG_2580-1-pdf-1055x1080.jpg).
4. Michi: [29a4b4ee-656f-4bd6-a422-33a2b33419b9-919x1080.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/29a4b4ee-656f-4bd6-a422-33a2b33419b9-919x1080.jpg).
5. Pantera: [d110a758-343a-4e15-830b-8622ecfc4897.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/d110a758-343a-4e15-830b-8622ecfc4897.jpg).

### B.8. Dog: Rufus

1. Rufus: [Rufus-762x1080.jpeg](https://petsdrawings.com/wp-content/uploads/2025/03/Rufus-762x1080.jpeg).
2. Rufus: [9ad5b5d1-3593-41f0-84a1-2d622237b608-801x1080.jpg](https://petsdrawings.com/wp-content/uploads/2025/03/9ad5b5d1-3593-41f0-84a1-2d622237b608-801x1080.jpg).

### B.9. My Dogs: Sox & Kira

1. Kira & Sox: [Kira-Sox-1541x1080.jpeg](https://petsdrawings.com/wp-content/uploads/2025/03/Kira-Sox-1541x1080.jpeg).
2. Kira & Sox: [photo-output-e1783718127926-1591x1080.png](https://petsdrawings.com/wp-content/uploads/2025/03/photo-output-e1783718127926-1591x1080.png).

### B.10. Dog: Chester

1. Chester: [IMG_9321-copy-852x1080.jpg](https://petsdrawings.com/wp-content/uploads/2025/03/IMG_9321-copy-852x1080.jpg).
2. Chester: [IMG_1590-865x1080.jpg](https://petsdrawings.com/wp-content/uploads/2025/03/IMG_1590-865x1080.jpg).

### B.11. Horses: Moquitos

1. Moquitos: [Moquitos-788x1080.jpeg](https://petsdrawings.com/wp-content/uploads/2025/03/Moquitos-788x1080.jpeg).
2. Moquitos: [MOquitos-1-871x1080.jpg](https://petsdrawings.com/wp-content/uploads/2025/03/MOquitos-1-871x1080.jpg).

### B.12. Cat: Millie

1. Millie Drawing: [Millie-Drawing-873x1080.jpeg](https://petsdrawings.com/wp-content/uploads/2023/05/Millie-Drawing-873x1080.jpeg).
2. Millie Photo: [Millie-Photo.jpg](https://petsdrawings.com/wp-content/uploads/2023/05/Millie-Photo.jpg).

### B.13. Dog: Tida

1. Tida drawing: [Tida-dog-drawing-rotated-810x1080.jpeg](https://petsdrawings.com/wp-content/uploads/2023/03/Tida-dog-drawing-rotated-810x1080.jpeg).
2. Tida photo: [Tida-dog-photo-691x1080.jpg](https://petsdrawings.com/wp-content/uploads/2023/04/Tida-dog-photo-691x1080.jpg).

### B.14. Dog: Frankie

1. Frankie drawing: [French-Bulldog-drawing-1551x1080.jpeg](https://petsdrawings.com/wp-content/uploads/2023/04/French-Bulldog-drawing-1551x1080.jpeg).
2. Frankie photo: [French-Bulldog-photo-1438x1080.jpg](https://petsdrawings.com/wp-content/uploads/2023/04/French-Bulldog-photo-1438x1080.jpg).

### B.15. My first dog: Doggy

1. Doggy drawing: [Doggy-my-dog-drawing-1535x1080.jpg](https://petsdrawings.com/wp-content/uploads/2023/03/Doggy-my-dog-drawing-1535x1080.jpg).
2. Doggy comparing: [Doggy-my-dog-comparing-1440x1080.jpeg](https://petsdrawings.com/wp-content/uploads/2023/04/Doggy-my-dog-comparing-1440x1080.jpeg).
3. Doggy photo: [Doggy-my-dog-photo-1620x1080.jpeg](https://petsdrawings.com/wp-content/uploads/2023/04/Doggy-my-dog-photo-1620x1080.jpeg).

### B.16. Dog: Patrón

1. Patron drawing: [Dog-Pedro-Arg-drawing-760x1080.jpg](https://petsdrawings.com/wp-content/uploads/2023/04/Dog-Pedro-Arg-drawing-760x1080.jpg).
2. Patron photo: [Dog-Pedro-Arg-photo-608x1080.jpg](https://petsdrawings.com/wp-content/uploads/2023/04/Dog-Pedro-Arg-photo-608x1080.jpg).

### B.17. Dogs: Lucky and Estrella

1. Lucky and Estrella: [Lucky-and-Estrella-dogs-drawing-1-758x1080.jpg](https://petsdrawings.com/wp-content/uploads/2023/04/Lucky-and-Estrella-dogs-drawing-1-758x1080.jpg).
2. Lucky and Estrella dogs photo: [Lucky-and-Estrella-dogs-photo-792x1080.jpg](https://petsdrawings.com/wp-content/uploads/2023/05/Lucky-and-Estrella-dogs-photo-792x1080.jpg).

### B.18. Dog: Nara

1. Nara drawing: [Dubi-dog-Nara-drawing-755x1080.jpg](https://petsdrawings.com/wp-content/uploads/2023/04/Dubi-dog-Nara-drawing-755x1080.jpg).
2. Nara photo: [Dubi-dog-Nara-photo.jpg](https://petsdrawings.com/wp-content/uploads/2023/04/Dubi-dog-Nara-photo.jpg).

### B.19. Dogs: Millie, Lady and Charlie

1. Millie drawing: [Millie-dog-drawing-1560x1080.jpg](https://petsdrawings.com/wp-content/uploads/2023/04/Millie-dog-drawing-1560x1080.jpg).
2. Millie photo: [Millie-dog-photo.jpg](https://petsdrawings.com/wp-content/uploads/2023/04/Millie-dog-photo.jpg).
3. Charlie drawing: [Charlie-dog-drawing-1539x1080.jpg](https://petsdrawings.com/wp-content/uploads/2023/03/Charlie-dog-drawing-1539x1080.jpg).
4. Lady photo: [Lady-dog-photo.jpeg](https://petsdrawings.com/wp-content/uploads/2023/04/Lady-dog-photo.jpeg).
5. Lady drawing: [Lady-dog-drawing.jpeg](https://petsdrawings.com/wp-content/uploads/2023/04/Lady-dog-drawing.jpeg).
6. Charlie photo: [Charlie-dog-photo-1374x1080.jpg](https://petsdrawings.com/wp-content/uploads/2023/04/Charlie-dog-photo-1374x1080.jpg).


## Anexo C. Galería extra y otros usos de imagen

### C.1. Galería extra

1. Menu: [IMG_4756-764x1080.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/IMG_4756-764x1080.jpg).
2. Menu: [IMG_4757-764x1080.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/IMG_4757-764x1080.jpg).
3. Mojacar Publo: [IMG_6106.heic](https://petsdrawings.com/wp-content/uploads/2025/03/IMG_6106.heic).
4. Jungkook singer drawing: [Jungkook-singer-drawing-742x1080.jpeg](https://petsdrawings.com/wp-content/uploads/2023/04/Jungkook-singer-drawing-742x1080.jpeg).
5. Jungkook singer photo: [Jungkook-singer-photo-833x1080.jpg](https://petsdrawings.com/wp-content/uploads/2023/04/Jungkook-singer-photo-833x1080.jpg).
6. Mother´s Day Present photo: [Mother´s-Day-Present-photo-736x1080.jpeg](https://petsdrawings.com/wp-content/uploads/2023/05/Mother´s-Day-Present-photo-736x1080.jpeg).
7. Mother´s Day present drawing: [Mother´s-Day-present-drawing-805x1080.jpeg](https://petsdrawings.com/wp-content/uploads/2023/05/Mother´s-Day-present-drawing-805x1080.jpeg).
8. Dylan, Mia, and Jaedon drawing: [IMG_8876-749x1080.jpeg](https://petsdrawings.com/wp-content/uploads/2023/04/IMG_8876-749x1080.jpeg).
9. Dylan, Mia, and Jaedon photo: [IMG_3564.jpg](https://petsdrawings.com/wp-content/uploads/2023/04/IMG_3564.jpg).
10. Mother and daughter photo: [Mother-and-photo.jpg](https://petsdrawings.com/wp-content/uploads/2023/04/Mother-and-photo.jpg).
11. Mother and daughter drawing: [Mother-and-daughter-drawing-791x1080.jpeg](https://petsdrawings.com/wp-content/uploads/2023/04/Mother-and-daughter-drawing-791x1080.jpeg).
12. Gift Valentine drawing: [IMG_3419-761x1080.jpeg](https://petsdrawings.com/wp-content/uploads/2023/04/IMG_3419-761x1080.jpeg).
13. Gift Valentine photo: [IMG_3188.jpg](https://petsdrawings.com/wp-content/uploads/2023/04/IMG_3188.jpg).
14. Indian photo: [Indian-photo-710x1080.jpeg](https://petsdrawings.com/wp-content/uploads/2023/04/Indian-photo-710x1080.jpeg).
15. Indian drawing: [Indian-drawing-765x1080.jpeg](https://petsdrawings.com/wp-content/uploads/2023/03/Indian-drawing-765x1080.jpeg).
16. drawing for book: [drawing-for-book-762x1080.jpg](https://petsdrawings.com/wp-content/uploads/2023/03/drawing-for-book-762x1080.jpg).

### C.2. Sobre mí

1. Imagen sin título confirmado: [IMG_2523-1390x1080.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/IMG_2523-1390x1080.jpg).
2. Imagen sin título confirmado: [4-1565x1080.jpg](https://petsdrawings.com/wp-content/uploads/2023/04/4-1565x1080.jpg).
3. Imagen sin título confirmado: [1-1007x1080.jpg](https://petsdrawings.com/wp-content/uploads/2023/04/1-1007x1080.jpg).
4. Imagen sin título confirmado: [IMG_5205-rotated-810x1080.jpeg](https://petsdrawings.com/wp-content/uploads/2026/07/IMG_5205-rotated-810x1080.jpeg).

### C.3. Ejemplos de encargos

1. Kira & Sox: [Kira-Sox.heic](https://petsdrawings.com/wp-content/uploads/2025/03/Kira-Sox.heic).
2. Kira & Sox: [photo-output-e1783718127926-1591x1080.png](https://petsdrawings.com/wp-content/uploads/2025/03/photo-output-e1783718127926-1591x1080.png).
3. Frankie drawing: [French-Bulldog-drawing-1551x1080.jpeg](https://petsdrawings.com/wp-content/uploads/2023/04/French-Bulldog-drawing-1551x1080.jpeg).
4. Frankie photo: [French-Bulldog-photo-1438x1080.jpg](https://petsdrawings.com/wp-content/uploads/2023/04/French-Bulldog-photo-1438x1080.jpg).

### C.4. Feedbacks

1. Review: [IMG_8507-598x1080.jpg](https://petsdrawings.com/wp-content/uploads/2026/08/IMG_8507-598x1080.jpg).
2. Review: [IMG_8505-618x1080.jpg](https://petsdrawings.com/wp-content/uploads/2026/08/IMG_8505-618x1080.jpg).
3. Review: [IMG_8504-656x1080.jpg](https://petsdrawings.com/wp-content/uploads/2026/08/IMG_8504-656x1080.jpg).

### C.5. Recursos observados en portada

Incluye el logo, las referencias de slider y los últimos dibujos. Algunas URLs del slider deben comprobarse especialmente: una referencia a PDF bajo 2023 puede estar obsoleta frente a los medios actuales de 2026. Registra errores HTTP y busca la correspondencia visual verificada; no asumas identidad solo por el nombre del archivo.

- [logo-pets-drawings.jpg](https://petsdrawings.com/wp-content/uploads/2025/06/logo-pets-drawings.jpg).
- [5073c56f-0936-4d33-9db4-8efc7030e03d-1-e1786554716558.jpg](https://petsdrawings.com/wp-content/uploads/2023/03/5073c56f-0936-4d33-9db4-8efc7030e03d-1-e1786554716558.jpg).
- [IMG_1585.jpg](https://petsdrawings.com/wp-content/uploads/2026/08/IMG_1585.jpg).
- [Chester.jpg](https://petsdrawings.com/wp-content/uploads/2023/03/Chester.jpg).
- [IMG_3394.pdf](https://petsdrawings.com/wp-content/uploads/2023/03/IMG_3394.pdf).
- [Kira-Sox.jpeg](https://petsdrawings.com/wp-content/uploads/2023/03/Kira-Sox.jpeg).
- [Moquitos.heic](https://petsdrawings.com/wp-content/uploads/2025/03/Moquitos.heic).
- [IMG_1509-619x867.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/IMG_1509-619x867.jpg).
- [Kira-Sox-1237x867.jpeg](https://petsdrawings.com/wp-content/uploads/2023/03/Kira-Sox-1237x867.jpeg).
- [IMG_1612-1242x867.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/IMG_1612-1242x867.jpg).
- [IMG_1585-1226x867.jpg](https://petsdrawings.com/wp-content/uploads/2026/07/IMG_1585-1226x867.jpg).
- [IMG_6106.heic](https://petsdrawings.com/wp-content/uploads/2025/03/IMG_6106.heic).

## Anexo D. Fuentes técnicas oficiales para verificar durante la implementación

Esta arquitectura es una propuesta concreta para este encargo. Contrasta las firmas de las APIs con las versiones efectivamente instaladas; los enlaces no sustituyen compilar y probar.

| Tema | Documentación |
| --- | --- |
| Astro 7 y migración de versión | https://astro.build/blog/astro-7/ y https://docs.astro.build/en/guides/upgrade-to/v7/ |
| Instalación y runtime de Astro | https://docs.astro.build/en/install-and-setup/ |
| Renderizado bajo demanda | https://docs.astro.build/en/guides/on-demand-rendering/ |
| Adaptador Vercel | https://docs.astro.build/en/guides/integrations-guide/vercel/ |
| Node en Vercel | https://vercel.com/docs/functions/runtimes/node-js/node-js-versions |
| Supabase SSR Auth | https://supabase.com/docs/guides/auth/server-side/creating-a-client |
| Supabase RLS | https://supabase.com/docs/guides/database/postgres/row-level-security |
| Storage y privacidad | https://supabase.com/docs/guides/storage/buckets/fundamentals y https://supabase.com/docs/guides/storage/security/access-control |
| Operaciones de Storage | https://supabase.com/docs/guides/storage/schema/design |
| Supabase Cron | https://supabase.com/docs/guides/cron |
| Creación de Checkout | https://docs.stripe.com/api/checkout/sessions/create |
| Inventario y expiración | https://docs.stripe.com/payments/checkout/managing-limited-inventory |
| Fulfillment | https://docs.stripe.com/checkout/fulfillment |
| Webhooks | https://docs.stripe.com/webhooks |
| Idempotencia Stripe | https://docs.stripe.com/api/idempotent_requests |
| Resend e idempotencia | https://resend.com/changelog/idempotency-keys |
| Cursor multitarea | https://cursor.com/help/ai-features/multi-agent |
| Cursor worktrees | https://cursor.com/docs/configuration/worktrees |

Fin del prompt.


