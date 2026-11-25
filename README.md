# News Facilitator — Titulares del mundo

Una web app ligera, bilingüe (inglés/español) y 100 % front-end para leer los titulares más relevantes del mundo. Está pensada para publicarse gratis en **GitHub Pages**, sin backend, sin build y sin dependencias.

![Estado](https://img.shields.io/badge/backend-0%20dependencias-ff6b4a) ![PWA](https://img.shields.io/badge/PWA-instalable-2ea44f) ![Sin build](https://img.shields.io/badge/build-ninguno-8b95a7)

---

## 1. Qué incluye

- **Diseño dark mode por defecto**, con tema claro opcional y persistencia.
- **Mobile first**: 1 columna en móvil, 2 en tablet, 3 en escritorio; portada destacada.
- **Bilingüe**: contenido en inglés y español, filtro «Todos / EN / ES» y una noticia principal.
- **Buscador** instantáneo por titular, resumen o medio.
- **6 categorías**: Portada, Política, Tecnología, Deportes, Ciencia y Salud.
- **Enfoque editorial claro**:
  - **Política** → Estados Unidos, Rusia, China y temas relacionados (The Guardian US/Russia/China, Politico, Meduza, SCMP, NPR, El País Internacional, BBC Mundo, France 24).
  - **Deportes** → solo **NBA y WNBA** (baloncesto de EE. UU.) y **MLS/NWSL** (fútbol de EE. UU.). No hay ligas europeas ni otros deportes.
  - **Portada, Tecnología, Ciencia y Salud** → actualidad general.
- **Miniaturas, fecha relativa** («hace 2 horas») y botón «Leer nota» al medio original.
- **Caché inteligente** en `localStorage`: arranque instantáneo y contenido guardado si falla la red.
- **Manejo de errores**: skeletons de carga, mensaje amigable con reintento y aviso de copia guardada.
- **PWA instalable**: manifest, service worker e iconos. Funciona en modo standalone y guarda el shell para uso offline.
- **Cero claves obligatorias**: funciona desde el primer despliegue.

### Categorías y fuentes

| Categoría | Qué muestra | Fuentes (EN / ES) |
|---|---|---|
| **Portada** | Lo más importante del día | BBC, The Guardian / El País, BBC Mundo, France 24 |
| **Política** | EE. UU., Rusia, China y temas relacionados | The Guardian (US, Russia, China), Politico, Meduza, SCMP, NPR / El País Internacional, BBC Mundo, France 24 |
| **Tecnología** | Productos, IA, internet | BBC, The Verge, The Guardian / El País, Xataka, Hipertextual |
| **Deportes** | Solo NBA, WNBA, MLS y NWSL | The Guardian (NBA, WNBA, MLS), CBS Sports, ESPN, Soccer America / Marca (MLS), ESPN Deportes (NBA, WNBA) |
| **Ciencia** | Investigación y medio ambiente | BBC, The Guardian / El País, Muy Interesante |
| **Salud** | Medicina y bienestar | BBC, The Guardian / 20minutos |

> Cada vista carga solo las primeras fuentes de su lista (ver sección 7), no todas a la vez. El pie de página muestra la lista completa con enlace a cada medio.

```
news-facilitator/
├── index.html          → estructura y textos base
├── style.css           → diseño, tokens y responsive
├── app.js              → feeds, proxies, estado, render e i18n
├── sw.js               → service worker (offline + caché del shell)
├── manifest.json       → metadatos PWA
├── favicon.svg
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── icon-maskable-512.png
│   └── apple-touch-icon.png
├── .nojekyll           → evita el procesado de Jekyll en GitHub Pages
└── README.md
```

---

## 2. Cómo funciona (sin backend)

Los navegadores no pueden leer la mayoría de feeds RSS directamente porque el medio no envía la cabecera `Access-Control-Allow-Origin`. News Facilitator resuelve esto con una **cadena de proveedores**:

1. **El País, CBS Sports y ESPN** publican sus feeds con CORS abierto → se piden **directamente** (rápido y fiable, sin intermediarios). Por eso Deportes sigue funcionando aunque los proxies estén saturados.
2. **rss2json** convierte el RSS en JSON (incluye miniaturas). Es el proveedor principal para BBC, Guardian, Politico, Meduza, SCMP, Marca, Xataka, etc.
3. **AllOrigins** actúa como proxy CORS de respaldo, con dos endpoints (`/raw` y `/get`).
4. **CodeTabs** es el último respaldo.

Si un proveedor falla o tarda más de 8 s, se prueba el siguiente. El que funciona se recuerda y pasa al frente para las siguientes peticiones. Cada fuente se cachea 20 minutos y cada vista (categoría + idioma) 40 minutos. Una fuente que falla en todos los caminos se descarta a los ~18 s para no bloquear la vista.

rss2json, sin clave, limita la **conversión de feeds nuevos en un periodo corto** (aunque el cupo diario sea alto). Por eso la app pide pocas fuentes por vista: **4 como máximo** (2 en inglés + 2 en español en Portada, Política y Deportes; 1 + 1 en Tecnología, Ciencia y Salud). Si abres muchas categorías seguidas la primera vez, algunas fuentes pueden no responder; al añadir tu clave gratuita (sección 6) o al volver unos minutos después, se resuelve.

> **Importante:** los proxies públicos tienen límites de uso. Para una app personal o un portfolio son más que suficientes; si esperas mucho tráfico, añade tu clave gratuita de rss2json (sección 6) o monta tu propio proxy en Cloudflare Workers.

### Límites que conviene conocer

| Proveedor | Coste | Límite aproximado |
|---|---|---|
| rss2json (sin clave) | Gratis | ~1.500 peticiones/día por IP + límite de feeds nuevos por ráfaga |
| rss2json (con clave) | Gratis | 10.000 peticiones/día |
| AllOrigins | Gratis | Sin cuota publicada; puede ir lento |
| CodeTabs | Gratis | ~5 peticiones/segundo |

---

## 3. Probar en local

No abras `index.html` con doble clic: el protocolo `file://` bloquea las peticiones y el service worker. Usa un servidor local.

**Con Python (incluido en macOS/Linux; en Windows instala Python):**

```bash
cd news-facilitator
python -m http.server 8080
```

Abre <http://localhost:8080>.

**Con Node.js:**

```bash
npx serve .
```

> El service worker solo se registra en `https://` o en `localhost`, así que en local funciona sin problemas.

---

## 4. Publicar en GitHub Pages (desde cero)

### 4.1. Crear el repositorio

1. Entra en <https://github.com> e inicia sesión (crea una cuenta si no tienes).
2. Pulsa el botón **+** (arriba a la derecha) → **New repository**.
3. Rellena:
   - **Repository name:** `news-facilitator` (o el nombre que quieras; afectará a la URL).
   - **Description:** opcional.
   - **Visibility:** **Public** (GitHub Pages gratis requiere repositorio público).
   - **Initialize this repository with:** deja todo desmarcado (no añadas README ni .gitignore).
4. Pulsa **Create repository**.

### 4.2. Subir los archivos

#### Opción A — Desde la web de GitHub (sin instalar nada)

1. En el repositorio vacío verás el enlace **uploading an existing file**. Púlsalo.
2. Arrastra **todo el contenido** de la carpeta `news-facilitator` (no la carpeta en sí): `index.html`, `style.css`, `app.js`, `sw.js`, `manifest.json`, `favicon.svg`, `.nojekyll`, `README.md` y la carpeta `icons`.
3. En el campo de mensaje escribe `Versión inicial`.
4. Pulsa **Commit changes**.

> La carpeta `icons` se arrastra junto con los archivos y GitHub conserva la estructura. Verifica que exista `icons/icon-192.png`.

#### Opción B — Con Git desde tu computadora

```bash
cd news-facilitator
git init
git add .
git commit -m "Versión inicial de News Facilitator"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/news-facilitator.git
git push -u origin main
```

Sustituye `TU-USUARIO` por tu nombre de usuario de GitHub. Si te pide credenciales, usa un **Personal Access Token** como contraseña (GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens, permiso `Contents: Read and write` sobre el repositorio).

### 4.3. Activar GitHub Pages

1. En el repositorio, entra en **Settings** (pestaña superior).
2. En la barra lateral, pulsa **Pages**.
3. En **Build and deployment → Source**, elige **Deploy from a branch**.
4. En **Branch**, selecciona **`main`** y la carpeta **`/ (root)`**. Pulsa **Save**.
5. Espera 1–3 minutos. La misma página mostrará:

   > **Your site is live at** `https://TU-USUARIO.github.io/news-facilitator/`

6. Abre esa URL. Si ves un 404, espera un minuto y recarga (la primera publicación tarda).

**Cómo se forma la URL:**

| Repositorio | URL pública |
|---|---|
| `usuario/news-facilitator` | `https://usuario.github.io/news-facilitator/` |
| `usuario/usuario.github.io` | `https://usuario.github.io/` |

> No hace falta configurar HTTPS: GitHub Pages lo activa automáticamente y es requisito para que la PWA sea instalable.

### 4.4. Actualizar la app más adelante

Edita los archivos y haz commit. GitHub Pages republica solo en ~1 minuto.

```bash
git add .
git commit -m "Actualizo fuentes"
git push
```

#### Cómo saber si tu navegador ya tiene la versión nueva

Al pie de la página aparece la versión, por ejemplo **v1.2.0**. Compárala con `APP_VERSION` en `app.js`: si coinciden, estás viendo lo último.

La app está pensada para actualizarse sola:

1. Al cargar, el navegador busca un `sw.js` nuevo (`updateViaCache: 'none'`), sin quedarse con el de la caché HTTP.
2. El service worker nuevo descarga los archivos con `cache: 'reload'`, así no guarda copias viejas.
3. Al activarse, borra la caché anterior y **recarga las pestañas abiertas** una vez. No hace falta Ctrl+F5.

Si aun así ves la versión vieja en el pie:

| Situación | Qué hacer |
|---|---|
| Acabas de publicar y pasó menos de 1 min | Espera y recarga: GitHub Pages tarda en propagar |
| El pie muestra una versión anterior | Cierra **todas** las pestañas del sitio y vuelve a abrir la URL |
| Sigue igual | Dentro de la app: **Ajustes → Borrar caché y datos** (borra caché y desregistra el service worker) |
| Quieres forzarlo en el ordenador | DevTools → **Application** → **Service Workers** → *Unregister* y recarga |

> Cada vez que publiques cambios sube **las dos** versiones: `VERSION` en `sw.js` y `APP_VERSION` en `app.js`. Si solo cambias una, el aviso del pie y la caché dejarán de coincidir.

---

## 5. Instalar en el celular (como app nativa)

La app ya es una **PWA**. Al abrirla desde la URL de GitHub Pages:

### Android (Chrome, Edge, Samsung Internet)

1. Abre la URL en Chrome.
2. Toca el menú **⋮** → **Instalar aplicación** (o **Añadir a pantalla de inicio**).
3. Confirma. Aparecerá el icono de News Facilitator junto a tus apps y se abrirá sin barra del navegador.

También verás un botón **«Instalar app»** en la barra de estado cuando el navegador lo permita.

### iPhone / iPad (Safari)

1. Abre la URL **en Safari** (en iOS, Chrome no puede instalar PWAs).
2. Toca el botón **Compartir** (cuadrado con flecha hacia arriba).
3. Desplázate y elige **Añadir a pantalla de inicio**.
4. Ponle nombre («News Facilitator») y toca **Añadir**.

> En iOS la app se abre a pantalla completa y usa el icono `icons/apple-touch-icon.png`. La primera vez necesita conexión; después el shell queda cacheado.

### Requisitos para que aparezca la opción de instalar

- Estar en `https://` (GitHub Pages ya lo cumple).
- Haber visitado la página al menos una vez.
- Que el manifest y el service worker carguen sin errores (revisa la pestaña **Application** en DevTools).

---

## 6. Clave de API (opcional)

**News Facilitator no necesita ninguna clave para funcionar.** Añadir una solo mejora el límite de peticiones y la estabilidad cuando hay mucho tráfico.

### 6.1. rss2json (recomendada, gratis)

1. Entra en <https://rss2json.com>.
2. Pulsa **Get API Key** (o **Sign up**).
3. Regístrate con tu correo y confirma el mensaje que recibirás.
4. En tu panel verás tu **API Key** (una cadena larga). Cópiala.
5. Abre News Facilitator → botón de **Ajustes** (icono de controles, arriba a la derecha) → pega la clave en **«Clave de API de rss2json»** → **Guardar**.

La clave se guarda **solo en tu navegador** (`localStorage`), nunca en el código ni en GitHub. Si la app es pública, cada visitante puede añadir la suya; la tuya no se comparte.

> El plan gratuito de rss2json permite 10.000 peticiones al día. Cada visita hace 2–4 peticiones, así que da para miles de visitas.

### 6.2. GNews (alternativa, si prefieres una API de noticias)

GNews permite CORS y tiene plan gratuito de 100 peticiones/día. **No está implementada por defecto** para que la app funcione sin claves y porque una clave incrustada en el JavaScript público se agota en minutos.

Si quieres usarla:

1. Entra en <https://gnews.io/register> y crea una cuenta.
2. En el dashboard copia tu **API key**.
3. En `app.js`, añade un proveedor que llame a:
   `https://gnews.io/api/v4/top-headlines?category=general&lang=es&max=10&apikey=TU_CLAVE`
4. **No subas la clave al repositorio.** Guárdala en `localStorage` y léela con `storage.get('gnewsKey')`, igual que la de rss2json.

> ⚠️ Cualquier clave incluida en un archivo público de GitHub Pages es visible para todo el mundo. Para un proyecto serio, lo correcto es un pequeño proxy propio (Cloudflare Worker, Vercel Function) que guarde la clave en el servidor.

---

## 7. Personalización rápida

### Añadir un medio

En `app.js`, dentro de `SOURCES`, añade una línea:

```js
{
  id: 'mi-medio',                 // identificador único
  name: 'Mi Medio',               // nombre que se muestra
  lang: 'es',                     // 'es' o 'en'
  cats: ['politics', 'top'],      // categorías (la primera define el color)
  url: 'https://ejemplo.com/rss', // feed RSS o Atom
  site: 'https://ejemplo.com',    // enlace para el pie de página
  // direct: true                 // solo si el feed permite CORS
}
```

No hace falta tocar nada más: la selección es automática y respeta **el orden de la lista** (las primeras de cada categoría son las que se cargan). Portada, Política y Deportes usan 2 fuentes por idioma; Tecnología, Ciencia y Salud, 1 por idioma. Al filtrar por **EN** o **ES** el cupo sube a 3, porque solo se pide un idioma. Esos números se ajustan en `CONFIG.viewSize` (arriba del todo en `app.js`).

### Cambiar el idioma inicial de la interfaz

En `app.js`, `detectUILang()` detecta el idioma del navegador. Para forzar español:

```js
function detectUILang() {
  return 'es';
}
```

### Cambiar colores

En `style.css`, dentro de `:root`:

```css
--accent: #ff6b4a;   /* color de marca */
--bg: #080a0f;       /* fondo */
--surface: #11161f;  /* tarjetas */
```

### Abrir una categoría concreta por enlace

La app acepta parámetros: `?cat=politics`, `?cat=sports`, `?cat=tech`, `?lang=es`. Ejemplo:
`https://usuario.github.io/news-facilitator/?cat=politics&lang=es`

---

## 8. Problemas frecuentes

| Síntoma | Causa probable | Solución |
|---|---|---|
| «No pudimos cargar las noticias» | Proxies saturados o sin red | Pulsa **Reintentar**; añade una clave de rss2json; espera unos minutos |
| Solo cargan algunas fuentes | Límite 429 de un proxy (feeds nuevos en ráfaga) | La app muestra el resto. Añade tu clave gratuita en **Ajustes** o espera unos minutos |
| Faltan imágenes | El feed no incluye miniatura | Se muestra un degradado con el nombre del medio (diseño previsto) |
| Deportes muestra NBA/WNBA pero no MLS/NWSL | Los feeds de MLS (Guardian, Marca) sí necesitan proxy; NBA/WNBA van directos | Pulsa **Reintentar** o añade tu clave de rss2json: los feeds de fútbol volverán |
| Cambios que no aparecen | Caché del service worker | Mira la versión del pie; sube `VERSION` y `APP_VERSION`, o usa **Ajustes → Borrar caché y datos** |
| 404 al entrar | Pages aún publicando o ruta incorrecta | Espera 1–2 min; revisa Settings → Pages; la URL debe terminar en `/news-facilitator/` |
| La opción «Instalar» no aparece | Falta HTTPS, manifest o SW | Comprueba Application → Manifest y Service Workers en DevTools |
| El feed de El País falla | Cambio de URL del medio | Actualiza `url` en `SOURCES`; el resto de fuentes sigue funcionando |

### Notas legales

News Facilitator es un agregador: muestra titulares, un extracto y una miniatura, y **siempre enlaza al medio original**. Los textos e imágenes pertenecen a sus autores. Si vas a monetizar o a hacer un uso intensivo, revisa los términos de cada medio y considera usar sus APIs oficiales.

---

## 9. Créditos

- Datos: BBC, The Guardian, Politico, Meduza, SCMP, NPR, CBS Sports, ESPN, Soccer America, El País, BBC Mundo, France 24, Marca, Xataka, Hipertextual, Muy Interesante y 20minutos.
- Proxies: [rss2json](https://rss2json.com), [AllOrigins](https://allorigins.win) y [CodeTabs](https://codetabs.com).
- Código: HTML, CSS y JavaScript sin frameworks. Sin build, sin cookies, sin analítica.
