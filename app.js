/* =========================================================================
   NEWS FACILITATOR — Lógica de la aplicación
   -------------------------------------------------------------------------
   Arquitectura (100 % front-end, sin backend):
   1. Se piden feeds RSS/Atom de medios reales.
   2. Como el navegador bloquea por CORS la mayoría de feeds, se usan
      "proxies" públicos (rss2json, AllOrigins, CodeTabs) en cadena:
      si uno falla, se prueba el siguiente. Los aciertos se recuerdan para
      priorizar el proxy más rápido en las siguientes peticiones.
   3. Los artículos se normalizan, deduplican, ordenan y cachean en
      localStorage (para arranques instantáneos y modo sin conexión).
   4. El HTML se genera con plantillas y TODO texto se escapa antes de
      inyectarse (evita XSS desde los feeds).
   ========================================================================= */

(() => {
  'use strict';

  /* =======================================================================
     1. CONFIGURACIÓN
     ======================================================================= */
  const CONFIG = {
    storagePrefix: 'news-facilitator.v2:',
    feedTTL: 20 * 60 * 1000,        // 20 min: caché por fuente
    viewTTL: 40 * 60 * 1000,        // 40 min: caché por vista (categoría + idioma)
    freshTTL: 5 * 60 * 1000,        // 5 min: si la vista es más nueva, no se pide red
    snapshotTTL: 7 * 24 * 3600 * 1000, // 7 días: última copia para modo offline
    maxAge: 10 * 24 * 3600 * 1000,  // descartar noticias de más de 10 días
    maxItemsPerFeed: 12,
    maxPerSource: 8,
    maxArticles: 60,
    requestTimeout: 8000,           // timeout por intento (ms)
    feedBudget: 18000,              // presupuesto total por fuente (ms)

    /* Cuántas fuentes se piden por vista y por idioma.
       'all' = filtro «Todos»; 'single' = filtro EN o ES.
       Cada feed nuevo es una petición al proxy, así que nunca se pasan
       de 4 por vista: es la cifra que evita el error 429 de rss2json. */
    viewSize: {
      top: { all: 2, single: 3 },
      politics: { all: 2, single: 3 },
      sports: { all: 2, single: 3 },
      default: { all: 1, single: 2 },
    },
  };

  /* =======================================================================
     2. FUENTES
     -----------------------------------------------------------------------
     Enfoque editorial de la app:
       · Portada   → lo más importante del día (general).
       · Política  → EE. UU., Rusia, China y temas relacionados.
       · Deportes  → solo NBA / WNBA (baloncesto de EE. UU.) y MLS / NWSL
                     (fútbol de EE. UU.). Nada de ligas europeas.
       · Tecnología, Ciencia y Salud → divulgación general.

     Cada fuente declara:
       cats   → categorías en las que aparece (la primera define el color
                y la etiqueta que se ve en la tarjeta)
       direct → el feed permite CORS y se puede pedir sin proxy

     El ORDEN importa: cuando una vista carga solo 1-3 fuentes por idioma,
     se toman las primeras de la lista. Por eso las más relevantes van
     arriba. Para añadir un medio, copia una línea y ajusta url/site/cats.
     ======================================================================= */
  const SOURCES = [
    /* ============================== English ============================== */

    /* --- Portada --- */
    { id: 'bbc-top', name: 'BBC News', lang: 'en', cats: ['top'], url: 'https://feeds.bbci.co.uk/news/rss.xml', site: 'https://www.bbc.com/news' },
    { id: 'guardian-world', name: 'The Guardian', lang: 'en', cats: ['top'], url: 'https://www.theguardian.com/world/rss', site: 'https://www.theguardian.com/world' },

    /* --- Política: EE. UU. (1.º), Rusia (2.º) y China (3.º) --- */
    { id: 'guardian-us-politics', name: 'The Guardian', lang: 'en', cats: ['politics'], url: 'https://www.theguardian.com/us-news/us-politics/rss', site: 'https://www.theguardian.com/us-news/us-politics' },
    { id: 'guardian-russia', name: 'The Guardian', lang: 'en', cats: ['politics'], url: 'https://www.theguardian.com/world/russia/rss', site: 'https://www.theguardian.com/world/russia' },
    { id: 'guardian-china', name: 'The Guardian', lang: 'en', cats: ['politics'], url: 'https://www.theguardian.com/world/china/rss', site: 'https://www.theguardian.com/world/china' },
    { id: 'politico-politics', name: 'Politico', lang: 'en', cats: ['politics'], url: 'https://rss.politico.com/politics-news.xml', site: 'https://www.politico.com' },
    { id: 'meduza-en', name: 'Meduza', lang: 'en', cats: ['politics'], url: 'https://meduza.io/rss/en/all', site: 'https://meduza.io/en' },
    { id: 'scmp-china', name: 'SCMP', lang: 'en', cats: ['politics'], url: 'https://www.scmp.com/rss/91/feed', site: 'https://www.scmp.com' },
    { id: 'npr-politics', name: 'NPR', lang: 'en', cats: ['politics'], url: 'https://feeds.npr.org/1014/rss.xml', site: 'https://www.npr.org/sections/politics/' },

    /* --- Tecnología --- */
    { id: 'bbc-tech', name: 'BBC News', lang: 'en', cats: ['tech'], url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', site: 'https://www.bbc.com/news/technology' },
    { id: 'verge', name: 'The Verge', lang: 'en', cats: ['tech'], url: 'https://www.theverge.com/rss/index.xml', site: 'https://www.theverge.com' },
    { id: 'guardian-tech', name: 'The Guardian', lang: 'en', cats: ['tech'], url: 'https://www.theguardian.com/uk/technology/rss', site: 'https://www.theguardian.com/uk/technology' },

    /* --- Deportes: NBA, WNBA y MLS/NWSL ---
       CBS y ESPN permiten CORS: se piden directo, sin proxy, así que
       cargan aunque rss2json esté saturado. Con el filtro «Todos» se
       combinan NBA + MLS (inglés) y NBA + WNBA (español), de modo que
       las tres ligas aparecen en la vista por defecto. */
    { id: 'cbs-nba', name: 'CBS Sports', lang: 'en', cats: ['sports'], url: 'https://www.cbssports.com/rss/headlines/nba/', site: 'https://www.cbssports.com/nba/', direct: true },
    { id: 'guardian-mls', name: 'The Guardian', lang: 'en', cats: ['sports'], url: 'https://www.theguardian.com/football/mls/rss', site: 'https://www.theguardian.com/football/mls' },
    { id: 'espn-wnba', name: 'ESPN', lang: 'en', cats: ['sports'], url: 'https://www.espn.com/espn/rss/wnba/news', site: 'https://www.espn.com/wnba/', direct: true },
    { id: 'guardian-nba', name: 'The Guardian', lang: 'en', cats: ['sports'], url: 'https://www.theguardian.com/sport/nba/rss', site: 'https://www.theguardian.com/sport/nba' },
    { id: 'guardian-wnba', name: 'The Guardian', lang: 'en', cats: ['sports'], url: 'https://www.theguardian.com/sport/wnba/rss', site: 'https://www.theguardian.com/sport/wnba' },
    { id: 'espn-nba', name: 'ESPN', lang: 'en', cats: ['sports'], url: 'https://www.espn.com/espn/rss/nba/news', site: 'https://www.espn.com/nba/', direct: true },
    { id: 'socceramerica', name: 'Soccer America', lang: 'en', cats: ['sports'], url: 'https://www.socceramerica.com/rss', site: 'https://www.socceramerica.com' },

    /* --- Ciencia --- */
    { id: 'bbc-science', name: 'BBC News', lang: 'en', cats: ['science'], url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', site: 'https://www.bbc.com/news/science_and_environment' },
    { id: 'guardian-science', name: 'The Guardian', lang: 'en', cats: ['science'], url: 'https://www.theguardian.com/science/rss', site: 'https://www.theguardian.com/science' },

    /* --- Salud --- */
    { id: 'bbc-health', name: 'BBC News', lang: 'en', cats: ['health'], url: 'https://feeds.bbci.co.uk/news/health/rss.xml', site: 'https://www.bbc.com/news/health' },
    { id: 'guardian-health', name: 'The Guardian', lang: 'en', cats: ['health'], url: 'https://www.theguardian.com/society/health/rss', site: 'https://www.theguardian.com/society/health' },

    /* ============================== Español ============================== */

    /* --- Portada --- */
    { id: 'elpais', name: 'El País', lang: 'es', cats: ['top'], url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada', site: 'https://elpais.com', direct: true },

    /* --- Política: internacional con foco en EE. UU., Rusia y China --- */
    { id: 'elpais-int', name: 'El País', lang: 'es', cats: ['politics'], url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/internacional/portada', site: 'https://elpais.com/internacional/', direct: true },
    { id: 'bbc-mundo', name: 'BBC Mundo', lang: 'es', cats: ['top', 'politics'], url: 'https://feeds.bbci.co.uk/mundo/rss.xml', site: 'https://www.bbc.com/mundo' },
    { id: 'france24-es', name: 'France 24', lang: 'es', cats: ['top', 'politics'], url: 'https://www.france24.com/es/rss', site: 'https://www.france24.com/es/' },

    /* --- Tecnología --- */
    { id: 'elpais-tec', name: 'El País', lang: 'es', cats: ['tech'], url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/tecnologia/portada', site: 'https://elpais.com/tecnologia/', direct: true },
    { id: 'xataka', name: 'Xataka', lang: 'es', cats: ['tech'], url: 'https://feeds.weblogssl.com/xataka2', site: 'https://www.xataka.com' },
    { id: 'hipertextual', name: 'Hipertextual', lang: 'es', cats: ['tech'], url: 'https://hipertextual.com/feed', site: 'https://hipertextual.com' },

    /* --- Deportes: MLS (Marca) + NBA y WNBA (ESPN Deportes) ---
       ESPN Deportes permite CORS; Marca necesita proxy. */
    { id: 'espn-deportes-nba', name: 'ESPN Deportes', lang: 'es', cats: ['sports'], url: 'https://espndeportes.espn.com/espn/rss/nba/news', site: 'https://espndeportes.espn.com/nba/', direct: true },
    { id: 'espn-deportes-wnba', name: 'ESPN Deportes', lang: 'es', cats: ['sports'], url: 'https://espndeportes.espn.com/espn/rss/wnba/news', site: 'https://espndeportes.espn.com/basquetbol/wnba/', direct: true },
    { id: 'marca-mls', name: 'Marca', lang: 'es', cats: ['sports'], url: 'https://e00-marca.uecdn.es/rss/futbol/estados-unidos.xml', site: 'https://www.marca.com/futbol/estados-unidos.html' },

    /* --- Ciencia --- */
    { id: 'elpais-ciencia', name: 'El País', lang: 'es', cats: ['science'], url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/ciencia/portada', site: 'https://elpais.com/ciencia/', direct: true },
    { id: 'muyinteresante', name: 'Muy Interesante', lang: 'es', cats: ['science'], url: 'https://www.muyinteresante.es/rss', site: 'https://www.muyinteresante.es' },

    /* --- Salud --- */
    { id: '20min-salud', name: '20minutos', lang: 'es', cats: ['health'], url: 'https://www.20minutos.es/rss/salud/', site: 'https://www.20minutos.es/salud/' },
  ];

  /* =======================================================================
     3. CATEGORÍAS
     -----------------------------------------------------------------------
     Se muestran en este orden en los chips. Si añades o quitas una,
     revisa también los colores por categoría en style.css ([data-cat]).
     ======================================================================= */
  const CATEGORIES = [
    { id: 'top', es: 'Portada', en: 'Top stories' },
    { id: 'politics', es: 'Política', en: 'Politics' },
    { id: 'tech', es: 'Tecnología', en: 'Technology' },
    { id: 'sports', es: 'Deportes', en: 'Sports' },
    { id: 'science', es: 'Ciencia', en: 'Science' },
    { id: 'health', es: 'Salud', en: 'Health' },
  ];

  /* =======================================================================
     4. TEXTOS (i18n)
     ======================================================================= */
  const I18N = {
    es: {
      pageTitle: 'News Facilitator — Titulares del mundo',
      skip: 'Saltar al contenido',
      theme: 'Cambiar tema',
      settings: 'Ajustes',
      heroTitle: 'El mundo, <em>en titulares</em>.',
      heroSub: 'Política de EE. UU., Rusia y China, deporte de ligas estadounidenses y lo esencial del día. En inglés y español, sin ruido.',
      langLabel: 'Idioma de las noticias',
      feedLabel: 'Titulares',
      filtersLabel: 'Filtros',
      categoriesLabel: 'Categorías',
      langAll: 'Todos',
      searchPlaceholder: 'Buscar titulares, temas o fuentes…',
      searchAria: 'Buscar noticias',
      clearSearch: 'Limpiar búsqueda',
      install: 'Instalar app',
      refresh: 'Actualizar',
      loading: 'Cargando titulares…',
      refreshing: 'Actualizando titulares…',
      headlines: '{n} titulares',
      updated: 'Actualizado {when}',
      statusError: 'Sin conexión con las fuentes',
      statusStale: 'Mostrando una copia guardada',
      readMore: 'Leer nota',
      errorTitle: 'No pudimos cargar las noticias',
      errorBody: 'Puede ser un fallo temporal de la red o del proveedor. Revisa tu conexión y vuelve a intentarlo.',
      retry: 'Reintentar',
      emptyTitle: 'Sin resultados',
      emptyBody: 'No hay titulares que coincidan con tu búsqueda. Prueba con otras palabras o cambia de categoría.',
      clearFilters: 'Limpiar filtros',
      offlineBanner: 'Estás sin conexión. Mostrando contenido guardado.',
      footerNote: 'News Facilitator es un agregador: los titulares y las imágenes pertenecen a sus respectivos medios.',
      sources: 'Fuentes',
      madeFor: 'Hecho para GitHub Pages',
      settingsTitle: 'Ajustes',
      close: 'Cerrar',
      settingsIntro: 'News Facilitator funciona sin claves de API. Si quieres más margen frente a los límites del servicio público, añade una clave gratuita de rss2json.',
      uiLangLabel: 'Idioma de la interfaz',
      apiKeyLabel: 'Clave de API de rss2json (opcional)',
      apiKeyPlaceholder: 'Pega tu clave aquí',
      apiKeyHelp: 'Se guarda solo en este navegador. Consíguela gratis en rss2json.com.',
      clearData: 'Borrar caché y datos',
      save: 'Guardar',
      saved: 'Ajustes guardados',
      cleared: 'Datos borrados. Recargando…',
      installIos: 'En iPhone o iPad: toca el botón Compartir y elige «Añadir a pantalla de inicio».',
      installHint: 'Abre el menú del navegador y elige «Instalar app» o «Añadir a pantalla de inicio».',
      staleToast: 'No pudimos conectar con las fuentes. Mostrando la última copia guardada.',
      rateLimitHint: 'Algunas fuentes no respondieron. Puedes añadir una clave gratuita de rss2json en Ajustes para más estabilidad.',
    },
    en: {
      pageTitle: 'News Facilitator — World headlines',
      skip: 'Skip to content',
      theme: 'Toggle theme',
      settings: 'Settings',
      heroTitle: 'The world, <em>in headlines</em>.',
      heroSub: 'US, Russian and Chinese politics, US league sports, and the essentials of the day. In English and Spanish, no noise.',
      langLabel: 'News language',
      feedLabel: 'Headlines',
      filtersLabel: 'Filters',
      categoriesLabel: 'Categories',
      langAll: 'All',
      searchPlaceholder: 'Search headlines, topics or sources…',
      searchAria: 'Search news',
      clearSearch: 'Clear search',
      install: 'Install app',
      refresh: 'Refresh',
      loading: 'Loading headlines…',
      refreshing: 'Refreshing headlines…',
      headlines: '{n} headlines',
      updated: 'Updated {when}',
      statusError: 'No connection to sources',
      statusStale: 'Showing a saved copy',
      readMore: 'Read story',
      errorTitle: "We couldn't load the news",
      errorBody: 'This may be a temporary network or provider issue. Check your connection and try again.',
      retry: 'Try again',
      emptyTitle: 'No results',
      emptyBody: 'No headlines match your search. Try different words or another category.',
      clearFilters: 'Clear filters',
      offlineBanner: "You're offline. Showing saved content.",
      footerNote: 'News Facilitator is an aggregator: headlines and images belong to their respective publishers.',
      sources: 'Sources',
      madeFor: 'Built for GitHub Pages',
      settingsTitle: 'Settings',
      close: 'Close',
      settingsIntro: 'News Facilitator works without API keys. Add a free rss2json key if you want more headroom against the public rate limits.',
      uiLangLabel: 'Interface language',
      apiKeyLabel: 'rss2json API key (optional)',
      apiKeyPlaceholder: 'Paste your key here',
      apiKeyHelp: 'Stored only in this browser. Get one free at rss2json.com.',
      clearData: 'Clear cache and data',
      save: 'Save',
      saved: 'Settings saved',
      cleared: 'Data cleared. Reloading…',
      installIos: 'On iPhone or iPad: tap Share, then “Add to Home Screen”.',
      installHint: 'Open the browser menu and choose “Install app” or “Add to Home screen”.',
      staleToast: "We couldn't reach the sources. Showing the last saved copy.",
      rateLimitHint: 'Some sources did not respond. Add a free rss2json key in Settings for more stability.',
    },
  };

  /* Iconos reutilizados en plantillas */
  const ICONS = {
    arrow:
      '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 17 17 7M8 7h9v9"/></svg>',
    alert:
      '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 9v5"/><circle cx="12" cy="17.5" r="0.6" fill="currentColor" stroke="none"/><path d="M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
    search:
      '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>',
  };

  /* =======================================================================
     5. UTILIDADES
     ======================================================================= */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const escapeHtml = (value) =>
    String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));

  const escapeAttr = escapeHtml;

  const htmlParser = new DOMParser();

  /** Texto de relleno que algunos feeds devuelven en vez de un resumen. */
  const PLACEHOLDER_TEXT = /^(null|undefined|n\/?a|none|-|—|\.)$/i;

  /** Convierte HTML/entidades de un feed en texto plano seguro. */
  function cleanText(value) {
    if (!value) return '';
    const text = String(value);
    const plain = /[<&]/.test(text)
      ? (htmlParser.parseFromString(text, 'text/html').body.textContent || '')
      : text;
    const clean = plain.replace(/\s+/g, ' ').trim();
    return PLACEHOLDER_TEXT.test(clean) ? '' : clean;
  }

  function truncate(text, max) {
    if (!text || text.length <= max) return text || '';
    const cut = text.slice(0, max);
    const space = cut.lastIndexOf(' ');
    return cut.slice(0, space > max * 0.6 ? space : max).trim() + '…';
  }

  function sanitizeUrl(value) {
    if (!value) return '';
    try {
      const url = new URL(String(value).trim(), window.location.href);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch {
      return '';
    }
  }

  /** Mejora miniaturas conocidas (BBC permite pedir 800px). */
  function upgradeImage(value) {
    const safe = sanitizeUrl(value);
    if (!safe) return '';
    let out = safe.replace(/^http:\/\//i, 'https://');
    if (/ichef\.bbci\.co\.uk/.test(out)) {
      out = out.replace(/\/standard\/\d+\//, '/standard/800/');
    }
    return out;
  }

  function parseDate(value) {
    if (!value) return 0;
    let str = String(value).trim();
    // rss2json devuelve "2026-11-25 12:21:49" en UTC
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str)) {
      str = str.replace(' ', 'T') + 'Z';
    }
    const ts = Date.parse(str);
    return Number.isFinite(ts) ? ts : 0;
  }

  function hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i += 1) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
  }

  function normalizeKey(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /* =======================================================================
     6. ESTADO
     ======================================================================= */
  const state = {
    category: 'top',
    lang: 'all',          // 'all' | 'en' | 'es'
    query: '',
    uiLang: 'es',
    theme: 'dark',
    articles: [],
    groups: new Map(),
    status: 'idle',
    lastUpdated: null,
    loadToken: 0,
    failures: 0,
    totalSources: 0,
  };

  const els = {};

  /* =======================================================================
     7. ALMACENAMIENTO LOCAL
     ======================================================================= */
  const storage = {
    get(key, maxAge) {
      try {
        const raw = localStorage.getItem(CONFIG.storagePrefix + key);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object') return null;
        if (maxAge && Date.now() - data.ts > maxAge) return null;
        return data.value;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(CONFIG.storagePrefix + key, JSON.stringify({ ts: Date.now(), value }));
      } catch {
        /* cuota llena o navegación privada: la app sigue funcionando sin caché */
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(CONFIG.storagePrefix + key);
      } catch { /* ignorar */ }
    },
    clear() {
      try {
        Object.keys(localStorage)
          .filter((key) => key.startsWith(CONFIG.storagePrefix))
          .forEach((key) => localStorage.removeItem(key));
      } catch { /* ignorar */ }
    },
  };

  const getApiKey = () => storage.get('rss2jsonKey') || '';

  /* =======================================================================
     8. RED: PROXIES Y PARSEO DE FEEDS
     ======================================================================= */
  const PROXIES = {
    rss2json: {
      json: true,
      build(url) {
        const key = getApiKey();
        return (
          'https://api.rss2json.com/v1/api.json?rss_url=' +
          encodeURIComponent(url) +
          '&count=' + CONFIG.maxItemsPerFeed +
          (key ? '&api_key=' + encodeURIComponent(key) : '')
        );
      },
    },
    allorigins: {
      json: false,
      build: (url) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
    },
    /* Mismo proveedor, otro endpoint: responde {contents:"<xml>"}.
       Funciona a veces cuando /raw devuelve error 5xx. */
    'allorigins-json': {
      wrapped: true,
      build: (url) => 'https://api.allorigins.win/get?url=' + encodeURIComponent(url),
    },
    codetabs: {
      json: false,
      build: (url) => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url),
    },
  };

  /** Orden de proxies: el último que funcionó pasa al frente. */
  let proxyOrder = (() => {
    const stored = storage.get('proxyOrder');
    const valid = Array.isArray(stored) ? stored.filter((id) => PROXIES[id]) : [];
    return [...new Set([...valid, ...Object.keys(PROXIES)])];
  })();

  function promoteProxy(id) {
    if (proxyOrder[0] === id) return;
    proxyOrder = [id, ...proxyOrder.filter((item) => item !== id)];
    storage.set('proxyOrder', proxyOrder);
  }

  async function fetchWithTimeout(url, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(url, {
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchDirect(source, timeout) {
    const res = await fetchWithTimeout(source.url, timeout);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    if (!text.trimStart().startsWith('<')) throw new Error('Respuesta no XML');
    return parseXmlFeed(text);
  }

  async function fetchViaProxy(id, source, timeout) {
    const proxy = PROXIES[id];
    const res = await fetchWithTimeout(proxy.build(source.url), timeout);
    if (!res.ok) throw new Error(id + ': HTTP ' + res.status);

    if (proxy.json) {
      const data = await res.json();
      if (!data || data.status !== 'ok') {
        throw new Error(id + ': ' + ((data && data.message) || 'respuesta inválida'));
      }
      return (data.items || []).map((item) => ({
        title: item.title,
        link: item.link || item.guid,
        date: item.pubDate,
        summary: item.description || item.content || '',
        image:
          item.thumbnail ||
          (item.enclosure && (item.enclosure.thumbnail || item.enclosure.link)) ||
          '',
      }));
    }

    if (proxy.wrapped) {
      const data = await res.json();
      const text = data && data.contents;
      if (typeof text !== 'string' || !text.trimStart().startsWith('<')) {
        throw new Error(id + ': respuesta inválida');
      }
      return parseXmlFeed(text);
    }

    const text = await res.text();
    if (!text.trimStart().startsWith('<')) throw new Error(id + ': respuesta no XML');
    return parseXmlFeed(text);
  }

  /** Extrae la mejor imagen disponible de un ítem RSS/Atom. */
  function extractImage(node) {
    const thumb = node.getElementsByTagName('media:thumbnail')[0];
    if (thumb && thumb.getAttribute('url')) return thumb.getAttribute('url');

    const media = Array.from(node.getElementsByTagName('media:content'));
    if (media.length) {
      const images = media
        .filter((el) => {
          const type = (el.getAttribute('type') || '').toLowerCase();
          const medium = (el.getAttribute('medium') || '').toLowerCase();
          return medium === 'image' || type.startsWith('image') || (!type && !medium);
        })
        .sort(
          (a, b) =>
            (parseInt(b.getAttribute('width'), 10) || 0) -
            (parseInt(a.getAttribute('width'), 10) || 0)
        );
      if (images[0] && images[0].getAttribute('url')) return images[0].getAttribute('url');
    }

    const enclosure = Array.from(node.getElementsByTagName('enclosure')).find(
      (el) => (el.getAttribute('type') || '').startsWith('image') && el.getAttribute('url')
    );
    if (enclosure) return enclosure.getAttribute('url');

    const enclosureLink = Array.from(node.getElementsByTagName('link')).find(
      (el) =>
        el.getAttribute('rel') === 'enclosure' &&
        (el.getAttribute('type') || '').startsWith('image')
    );
    if (enclosureLink) return enclosureLink.getAttribute('href');

    const html = ['content:encoded', 'content', 'description', 'summary']
      .map((tag) => {
        const el = node.getElementsByTagName(tag)[0];
        return el ? el.textContent : '';
      })
      .join(' ');
    const match = html.match(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/i);
    return match ? match[1] : '';
  }

  /** Parser único para RSS 2.0, RDF y Atom. */
  function parseXmlFeed(text) {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('XML inválido');

    const root = doc.documentElement;
    const isAtom = root && root.localName === 'feed';
    const nodes = Array.from(doc.getElementsByTagName(isAtom ? 'entry' : 'item')).slice(0, 30);

    return nodes
      .map((node) => {
        const textOf = (tag) => {
          const el = node.getElementsByTagName(tag)[0];
          return el ? (el.textContent || '').trim() : '';
        };

        let link = '';
        const links = Array.from(node.getElementsByTagName('link'));
        if (isAtom) {
          const alternate = links.find(
            (el) => (el.getAttribute('rel') || 'alternate') === 'alternate'
          );
          link =
            (alternate && alternate.getAttribute('href')) ||
            (links[0] && links[0].getAttribute('href')) ||
            '';
        } else {
          const plain = links.find((el) => !el.getAttribute('rel'));
          link = (plain && plain.textContent.trim()) || textOf('link');
          if (!link) {
            const guid = node.getElementsByTagName('guid')[0];
            if (guid && guid.getAttribute('isPermaLink') !== 'false') {
              link = guid.textContent.trim();
            }
          }
        }

        const date =
          textOf('pubDate') ||
          textOf('published') ||
          textOf('updated') ||
          textOf('date') ||
          textOf('dc:date');

        const summary =
          textOf('description') ||
          textOf('summary') ||
          textOf('content:encoded') ||
          textOf('content');

        return {
          title: textOf('title'),
          link,
          date,
          summary,
          image: extractImage(node),
        };
      })
      .filter((item) => item.title && item.link);
  }

  function normalizeItems(rawItems, source) {
    const now = Date.now();
    const seen = new Set();
    const out = [];

    for (const raw of rawItems) {
      const title = cleanText(raw.title);
      const url = sanitizeUrl(raw.link);
      if (!title || !url || seen.has(url)) continue;
      seen.add(url);

      const publishedAt = parseDate(raw.date);
      if (publishedAt && now - publishedAt > CONFIG.maxAge) continue;

      out.push({
        id: hashString(url),
        title: truncate(title, 200),
        url,
        image: upgradeImage(raw.image),
        summary: truncate(cleanText(raw.summary), 190),
        source: source.name,
        sourceId: source.id,
        lang: source.lang,
        category: source.cats[0],
        publishedAt,
      });

      if (out.length >= CONFIG.maxItemsPerFeed) break;
    }

    return out;
  }

  /** Descarga una fuente probando, en orden, todos los caminos posibles. */
  async function fetchFeed(source, force = false) {
    const cacheKey = 'feed:' + source.id;

    if (!force) {
      const cached = storage.get(cacheKey, CONFIG.feedTTL);
      if (Array.isArray(cached)) return cached;
    }

    const attempts = [];
    if (source.direct) attempts.push({ id: 'direct', run: (ms) => fetchDirect(source, ms) });
    proxyOrder.forEach((id) =>
      attempts.push({ id, run: (ms) => fetchViaProxy(id, source, ms) })
    );

    const deadline = Date.now() + CONFIG.feedBudget;
    let lastError = null;

    for (const attempt of attempts) {
      // Cada intento recibe solo el tiempo que queda del presupuesto, para
      // que una fuente caída no bloquee la vista más de ~18 s en total.
      const remaining = deadline - Date.now();
      if (remaining < 1500) break;
      try {
        const raw = await attempt.run(Math.min(CONFIG.requestTimeout, remaining));
        if (!raw || !raw.length) throw new Error('Feed vacío');
        if (attempt.id !== 'direct') promoteProxy(attempt.id);

        const items = normalizeItems(raw, source);
        storage.set(cacheKey, items); // también cachea [] para no insistir 10 min
        return items;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error('No se pudo cargar la fuente');
  }

  /* =======================================================================
     9. SELECCIÓN DE FUENTES Y MEZCLA
     ======================================================================= */
  function pickSources(category, lang) {
    const pool = SOURCES.filter((source) => source.cats.includes(category));
    const size = CONFIG.viewSize[category] || CONFIG.viewSize.default;

    // Portada, Política y Deportes cargan 2 fuentes por idioma (4 en total).
    // Tecnología, Ciencia y Salud cargan 1 por idioma. Si filtras por un
    // idioma concreto hay más cupo (3), porque solo se pide una lengua.
    const perLang = lang === 'all' ? size.all : size.single;

    const english = pool.filter((source) => source.lang === 'en').slice(0, perLang);
    const spanish = pool.filter((source) => source.lang === 'es').slice(0, perLang);

    if (lang === 'en') return english;
    if (lang === 'es') return spanish;
    return [...english, ...spanish];
  }

  /** Mezcla round-robin por fuente (diversidad) y luego ordena por fecha. */
  function mergeGroups(groups) {
    const lists = Array.from(groups.values()).map((list) =>
      list.slice(0, CONFIG.maxPerSource)
    );
    if (!lists.length) return [];

    const seenTitles = new Set();
    const seenUrls = new Set();
    const merged = [];
    const max = lists.reduce((acc, list) => Math.max(acc, list.length), 0);

    for (let index = 0; index < max; index += 1) {
      for (const list of lists) {
        const item = list[index];
        if (!item) continue;
        const titleKey = normalizeKey(item.title).slice(0, 70);
        if (!titleKey || seenTitles.has(titleKey) || seenUrls.has(item.url)) continue;
        seenTitles.add(titleKey);
        seenUrls.add(item.url);
        merged.push(item);
      }
    }

    merged.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
    return merged.slice(0, CONFIG.maxArticles);
  }

  function filteredArticles() {
    const query = normalizeKey(state.query);
    return state.articles.filter((article) => {
      if (state.lang !== 'all' && article.lang !== state.lang) return false;
      if (!query) return true;
      return normalizeKey(
        article.title + ' ' + article.summary + ' ' + article.source
      ).includes(query);
    });
  }

  /* =======================================================================
     10. CARGA
     ======================================================================= */
  async function load({ force = false } = {}) {
    const token = ++state.loadToken;
    const category = state.category;
    const lang = state.lang;
    const viewKey = 'view:' + category + ':' + lang;
    const sources = pickSources(category, lang);

    state.groups = new Map();
    state.failures = 0;
    state.totalSources = sources.length;
    state.lastUpdated = null;

    const cached = force ? null : storage.get(viewKey, CONFIG.viewTTL);
    const hadCache = Boolean(cached && Array.isArray(cached.articles) && cached.articles.length);

    if (hadCache) {
      state.articles = cached.articles;
      state.lastUpdated = cached.updatedAt || Date.now();
      state.status = 'ready';
      render();

      // Si la copia es muy reciente, no gastamos peticiones.
      if (Date.now() - (cached.updatedAt || 0) < CONFIG.freshTTL) return;
    } else {
      state.articles = [];
      state.status = 'loading';
      renderSkeleton();
    }

    if (!navigator.onLine) {
      state.status = state.articles.length ? 'stale' : 'error';
      render();
      return;
    }

    state.status = state.articles.length ? 'refreshing' : 'loading';
    updateStatus();

    if (!sources.length) {
      finalize(viewKey, token, hadCache ? cached : null);
      return;
    }

    let settled = 0;

    sources.forEach((source) => {
      fetchFeed(source, force)
        .then((items) => {
          if (token !== state.loadToken) return;
          state.groups.set(source.id, items);

          // Si ya había una copia en pantalla, esperamos a tener todo para
          // evitar que la rejilla "encoja" mientras llegan las fuentes.
          if (!hadCache) {
            state.articles = mergeGroups(state.groups);
            state.status = 'ready';
            if (!state.lastUpdated) state.lastUpdated = Date.now();
            scheduleRender();
          }
        })
        .catch(() => {
          if (token !== state.loadToken) return;
          state.failures += 1;
        })
        .finally(() => {
          settled += 1;
          if (token !== state.loadToken || settled < sources.length) return;
          finalize(viewKey, token, hadCache ? cached : null);
        });
    });
  }

  function finalize(viewKey, token, cachedView) {
    if (token !== state.loadToken) return;

    state.articles = mergeGroups(state.groups);

    if (state.articles.length) {
      state.status = 'ready';
      state.lastUpdated = Date.now();
      storage.set(viewKey, { articles: state.articles, updatedAt: state.lastUpdated });
      storage.set('snapshot', { articles: state.articles, updatedAt: state.lastUpdated });
    } else {
      // Sin datos frescos: primero la copia de esta misma vista y, si no,
      // la última copia global (puede ser de otra categoría).
      const fallback =
        cachedView && Array.isArray(cachedView.articles) && cachedView.articles.length
          ? cachedView
          : storage.get('snapshot', CONFIG.snapshotTTL);

      if (fallback && Array.isArray(fallback.articles) && fallback.articles.length) {
        state.articles = fallback.articles;
        state.lastUpdated = fallback.updatedAt || null;
        state.status = 'stale';
        showToast(t('staleToast'), 5000);
      } else {
        state.status = 'error';
      }
    }

    render();

    // Aviso único si varias fuentes fallan (por ejemplo, límite del proxy).
    if (
      state.status === 'ready' &&
      state.failures >= 2 &&
      navigator.onLine &&
      !getApiKey()
    ) {
      try {
        if (!sessionStorage.getItem('news-facilitator.hintShown')) {
          sessionStorage.setItem('news-facilitator.hintShown', '1');
          showToast(t('rateLimitHint'), 7000);
        }
      } catch { /* sesión no disponible */ }
    }
  }

  /* =======================================================================
     11. RENDER
     ======================================================================= */
  function renderSkeleton() {
    const card = `<div class="card" aria-hidden="true">
      <div class="sk sk-media"></div>
      <div class="card-body">
        <div class="sk sk-line w40"></div>
        <div class="sk sk-line tall"></div>
        <div class="sk sk-line w80"></div>
      </div>
    </div>`;

    els.feed.innerHTML = `
      <div class="sk-lead" aria-hidden="true">
        <div class="sk sk-media"></div>
        <div class="lead-body">
          <div class="sk sk-line w30"></div>
          <div class="sk sk-line tall w90"></div>
          <div class="sk sk-line w70"></div>
        </div>
      </div>
      <div class="grid">${card.repeat(6)}</div>`;
    updateStatus();
  }

  function mediaHtml(article, eager) {
    const fallback = `<span class="media-fallback" data-cat="${escapeAttr(
      article.category
    )}" aria-hidden="true"><span>${escapeHtml(article.source)}</span></span>`;

    const image = article.image
      ? `<img src="${escapeAttr(article.image)}" alt="" loading="${
          eager ? 'eager' : 'lazy'
        }" fetchpriority="${eager ? 'high' : 'low'}" decoding="async" referrerpolicy="no-referrer" />`
      : '';

    return fallback + image;
  }

  function timeTag(article) {
    if (!article.publishedAt) return '<span></span>';
    const iso = new Date(article.publishedAt).toISOString();
    return `<time datetime="${iso}" title="${escapeAttr(
      fullDate(article.publishedAt)
    )}">${escapeHtml(relTime(article.publishedAt))}</time>`;
  }

  function metaHtml(article) {
    return `<div class="meta">
      <span class="cat-dot" data-cat="${escapeAttr(article.category)}"></span>
      <span>${escapeHtml(categoryLabel(article.category))}</span>
      <span class="dot-sep" aria-hidden="true">·</span>
      ${timeTag(article)}
    </div>`;
  }

  function leadHtml(article) {
    const url = escapeAttr(article.url);
    return `<article class="lead" lang="${escapeAttr(article.lang)}">
      <a class="lead-media" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="${escapeAttr(
        article.title
      )}">
        ${mediaHtml(article, true)}
        <span class="badge">${escapeHtml(article.source)}</span>
      </a>
      <div class="lead-body">
        ${metaHtml(article)}
        <h2 class="lead-title">
          <a href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(
            article.title
          )}</a>
        </h2>
        ${
          article.summary
            ? `<p class="lead-summary">${escapeHtml(article.summary)}</p>`
            : ''
        }
        <a class="read-btn" href="${url}" target="_blank" rel="noopener noreferrer">
          ${escapeHtml(t('readMore'))} ${ICONS.arrow}
        </a>
      </div>
    </article>`;
  }

  function cardHtml(article) {
    const url = escapeAttr(article.url);
    return `<article class="card" lang="${escapeAttr(article.lang)}">
      <a class="card-media" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="${escapeAttr(
        article.title
      )}">
        ${mediaHtml(article, false)}
        <span class="badge">${escapeHtml(article.source)}</span>
      </a>
      <div class="card-body">
        ${metaHtml(article)}
        <h3 class="card-title">
          <a href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(
            article.title
          )}</a>
        </h3>
        ${
          article.summary
            ? `<p class="card-summary">${escapeHtml(article.summary)}</p>`
            : ''
        }
        <a class="card-link" href="${url}" target="_blank" rel="noopener noreferrer">
          ${escapeHtml(t('readMore'))} ${ICONS.arrow}
        </a>
      </div>
    </article>`;
  }

  function statePanel(kind) {
    const isError = kind === 'error';
    const action = isError ? 'retry' : 'reset';
    return `<div class="state">
      <div class="state-icon">${isError ? ICONS.alert : ICONS.search}</div>
      <h2>${escapeHtml(t(isError ? 'errorTitle' : 'emptyTitle'))}</h2>
      <p>${escapeHtml(t(isError ? 'errorBody' : 'emptyBody'))}</p>
      <button class="primary-btn" type="button" data-action="${action}">
        ${escapeHtml(t(isError ? 'retry' : 'clearFilters'))}
      </button>
    </div>`;
  }

  function render() {
    const articles = filteredArticles();
    const isLoading = state.status === 'loading';
    els.feed.setAttribute('aria-busy', String(isLoading));

    if (isLoading && !articles.length) {
      if (!els.feed.querySelector('.sk-lead')) renderSkeleton();
      updateStatus();
      return;
    }

    if (!articles.length) {
      // Sin resultados de búsqueda ≠ sin noticias: solo mostramos el estado
      // vacío cuando hay una búsqueda activa y sí había artículos cargados.
      const kind = state.status === 'error' || !state.query ? 'error' : 'empty';
      els.feed.innerHTML = statePanel(kind);
      updateStatus();
      return;
    }

    const lead = articles.find((article) => article.image) || articles[0];
    const rest = articles.filter((article) => article !== lead);

    els.feed.innerHTML =
      leadHtml(lead) +
      (rest.length ? `<div class="grid">${rest.map(cardHtml).join('')}</div>` : '');

    updateStatus();
  }

  let renderTimer = 0;
  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = window.setTimeout(() => {
      renderTimer = 0;
      render();
    }, 120);
  }

  function updateStatus() {
    const count = filteredArticles().length;
    let label = '';
    let statusName = 'ready';

    if (state.status === 'loading') {
      label = t('loading');
      statusName = 'loading';
    } else if (state.status === 'refreshing') {
      label = t('refreshing');
      statusName = 'loading';
    } else if (state.status === 'error') {
      label = t('statusError');
      statusName = 'error';
    } else if (state.status === 'stale') {
      label = t('statusStale');
      statusName = 'stale';
    } else if (state.lastUpdated) {
      label = t('headlines', { n: count }) + ' · ' + t('updated', { when: relTime(state.lastUpdated) });
    } else {
      label = t('loading');
      statusName = 'loading';
    }

    els.statusText.textContent = label;
    els.statusText.dataset.state = statusName;
  }

  /* =======================================================================
     12. FECHAS
     ======================================================================= */
  function relTime(ts) {
    if (!ts) return '';
    const diff = ts - Date.now();
    const abs = Math.abs(diff);
    const rtf = new Intl.RelativeTimeFormat(state.uiLang, { numeric: 'auto' });

    if (abs < 60e3) return rtf.format(Math.round(diff / 1000), 'second');
    if (abs < 3600e3) return rtf.format(Math.round(diff / 60e3), 'minute');
    if (abs < 86400e3) return rtf.format(Math.round(diff / 3600e3), 'hour');
    if (abs < 7 * 86400e3) return rtf.format(Math.round(diff / 86400e3), 'day');

    return new Intl.DateTimeFormat(state.uiLang, {
      day: 'numeric',
      month: 'short',
    }).format(ts);
  }

  function fullDate(ts) {
    return new Intl.DateTimeFormat(state.uiLang, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(ts);
  }

  function renderTodayLabel() {
    const label = new Intl.DateTimeFormat(state.uiLang, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date());
    els.todayLabel.textContent = label.charAt(0).toUpperCase() + label.slice(1);
  }

  /* =======================================================================
     13. i18n
     ======================================================================= */
  function t(key, vars) {
    const dict = I18N[state.uiLang] || I18N.es;
    let text = dict[key] != null ? dict[key] : I18N.es[key] != null ? I18N.es[key] : key;
    if (vars) {
      Object.keys(vars).forEach((name) => {
        text = text.replace(new RegExp('\\{' + name + '\\}', 'g'), String(vars[name]));
      });
    }
    return text;
  }

  function categoryLabel(id) {
    const category = CATEGORIES.find((item) => item.id === id) || CATEGORIES[0];
    return state.uiLang === 'en' ? category.en : category.es;
  }

  function applyI18n() {
    document.documentElement.lang = state.uiLang;
    document.title = t('pageTitle');

    $$('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    $$('[data-i18n-html]').forEach((el) => {
      el.innerHTML = t(el.dataset.i18nHtml);
    });
    $$('[data-i18n-placeholder]').forEach((el) => {
      el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
    });
    $$('[data-i18n-aria]').forEach((el) => {
      el.setAttribute('aria-label', t(el.dataset.i18nAria));
    });
  }

  /* =======================================================================
     14. CONTROLES DE INTERFAZ
     ======================================================================= */
  function buildCategories() {
    els.chips.innerHTML = CATEGORIES.map((category) => {
      const active = category.id === state.category;
      const label = state.uiLang === 'en' ? category.en : category.es;
      return `<button class="chip${active ? ' is-active' : ''}" type="button"
        data-cat="${category.id}" aria-pressed="${active}">${escapeHtml(label)}</button>`;
    }).join('');
  }

  function buildSourceList() {
    const seen = new Set();
    const unique = SOURCES.filter((source) => {
      if (seen.has(source.name)) return false;
      seen.add(source.name);
      return true;
    });

    els.sourceList.innerHTML = unique
      .map(
        (source) =>
          `<li><a href="${escapeAttr(source.site)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
            source.name
          )}</a></li>`
      )
      .join('');
  }

  function syncControls() {
    $$('.seg-btn').forEach((button) => {
      const active = button.dataset.lang === state.lang;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function setContentLang(lang) {
    if (!['all', 'en', 'es'].includes(lang) || state.lang === lang) return;
    state.lang = lang;
    syncControls();
    updateUrl();
    load();
  }

  function setTheme(theme, persist = true) {
    state.theme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = state.theme;
    if (persist) {
      try {
        localStorage.setItem('news-facilitator.theme', state.theme);
      } catch { /* ignorar */ }
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', state.theme === 'dark' ? '#080a0f' : '#f5f3ef');
  }

  function updateUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (state.category === 'top') params.delete('cat');
      else params.set('cat', state.category);
      if (state.lang === 'all') params.delete('lang');
      else params.set('lang', state.lang);
      const query = params.toString();
      const url = window.location.pathname + (query ? '?' + query : '');
      window.history.replaceState(null, '', url);
    } catch { /* ignorar */ }
  }

  let searchTimer = 0;
  function onSearchInput() {
    state.query = els.searchInput.value.trim();
    els.searchClear.hidden = !state.query;
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(render, 140);
  }

  function clearSearch() {
    els.searchInput.value = '';
    state.query = '';
    els.searchClear.hidden = true;
    render();
    els.searchInput.focus();
  }

  /* =======================================================================
     15. AJUSTES
     ======================================================================= */
  function openSettings() {
    els.apiKeyInput.value = getApiKey();
    els.uiLangSelect.value = state.uiLang;
    els.settingsDialog.returnValue = 'cancel';
    els.settingsDialog.showModal();
  }

  function onSettingsClose() {
    if (els.settingsDialog.returnValue !== 'save') return;

    const key = els.apiKeyInput.value.trim();
    if (key) storage.set('rss2jsonKey', key);
    else storage.remove('rss2jsonKey');

    const nextLang = els.uiLangSelect.value === 'en' ? 'en' : 'es';
    const langChanged = nextLang !== state.uiLang;
    state.uiLang = nextLang;
    try {
      localStorage.setItem('news-facilitator.uiLang', nextLang);
    } catch { /* ignorar */ }

    if (langChanged) {
      applyI18n();
      renderTodayLabel();
      buildCategories();
      buildSourceList();
      render();
    }

    showToast(t('saved'));
    load({ force: true });
  }

  async function clearAllData() {
    storage.clear();
    try {
      localStorage.removeItem('news-facilitator.theme');
      localStorage.removeItem('news-facilitator.uiLang');
    } catch { /* ignorar */ }

    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    } catch { /* ignorar */ }

    els.settingsDialog.close();
    showToast(t('cleared'));
    window.setTimeout(() => window.location.reload(), 700);
  }

  /* =======================================================================
     16. TOAST, PWA E INSTALACIÓN
     ======================================================================= */
  let toastTimer = 0;
  function showToast(message, duration = 3200) {
    els.toast.textContent = message;
    els.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      els.toast.classList.remove('is-visible');
    }, duration);
  }

  let deferredPrompt = null;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const isIOS = () =>
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  async function promptInstall() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (choice && choice.outcome === 'accepted') els.installBtn.hidden = true;
      return;
    }
    showToast(isIOS() ? t('installIos') : t('installHint'), 6500);
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    const secure =
      window.location.protocol === 'https:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';
    if (!secure) return;

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {
        /* sin SW la app sigue funcionando, solo pierde el modo offline */
      });
    });
  }

  /* =======================================================================
     17. EVENTOS
     ======================================================================= */
  function bindEvents() {
    els.themeBtn.addEventListener('click', () => {
      setTheme(state.theme === 'dark' ? 'light' : 'dark');
    });

    els.refreshBtn.addEventListener('click', () => load({ force: true }));

    els.settingsBtn.addEventListener('click', openSettings);
    els.settingsDialog.addEventListener('close', onSettingsClose);
    els.clearDataBtn.addEventListener('click', clearAllData);
    els.installBtn.addEventListener('click', promptInstall);

    els.chips.addEventListener('click', (event) => {
      const button = event.target.closest('[data-cat]');
      if (!button) return;
      const category = button.dataset.cat;
      if (category === state.category) return;
      state.category = category;
      buildCategories();
      updateUrl();
      load();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    $$('.seg-btn').forEach((button) => {
      button.addEventListener('click', () => setContentLang(button.dataset.lang));
    });

    els.searchInput.addEventListener('input', onSearchInput);
    els.searchClear.addEventListener('click', clearSearch);

    els.feed.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'retry') load({ force: true });
      if (action.dataset.action === 'reset') clearSearch();
    });

    // Las imágenes que fallan dejan ver el degradado de reserva.
    els.feed.addEventListener(
      'error',
      (event) => {
        if (event.target instanceof HTMLImageElement) {
          event.target.classList.add('is-broken');
        }
      },
      true
    );

    window.addEventListener('online', () => {
      els.offlineBanner.hidden = true;
      load();
    });

    window.addEventListener('offline', () => {
      els.offlineBanner.hidden = false;
    });

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredPrompt = event;
      if (!isStandalone()) els.installBtn.hidden = false;
    });

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      els.installBtn.hidden = true;
    });

    document.addEventListener('keydown', (event) => {
      const typing =
        event.target instanceof HTMLElement &&
        (event.target.matches('input, textarea, select') || event.target.isContentEditable);

      if (event.key === '/' && !typing) {
        event.preventDefault();
        els.searchInput.focus();
      }
      if (event.key === 'Escape' && document.activeElement === els.searchInput && state.query) {
        clearSearch();
      }
    });
  }

  /* =======================================================================
     18. ARRANQUE
     ======================================================================= */
  function cacheDom() {
    els.todayLabel = $('#todayLabel');
    els.chips = $('#categoryChips');
    els.searchInput = $('#searchInput');
    els.searchClear = $('#searchClear');
    els.statusText = $('#statusText');
    els.refreshBtn = $('#refreshBtn');
    els.installBtn = $('#installBtn');
    els.themeBtn = $('#themeBtn');
    els.settingsBtn = $('#settingsBtn');
    els.settingsDialog = $('#settingsDialog');
    els.uiLangSelect = $('#uiLangSelect');
    els.apiKeyInput = $('#apiKeyInput');
    els.clearDataBtn = $('#clearDataBtn');
    els.sourceList = $('#sourceList');
    els.feed = $('#feed');
    els.toast = $('#toast');
    els.offlineBanner = $('#offlineBanner');
    els.yearLabel = $('#yearLabel');
  }

  function detectUILang() {
    try {
      const stored = localStorage.getItem('news-facilitator.uiLang');
      if (stored === 'es' || stored === 'en') return stored;
    } catch { /* ignorar */ }
    return (navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en';
  }

  function readTheme() {
    try {
      return localStorage.getItem('news-facilitator.theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  }

  function readUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const category = params.get('cat');
    const lang = params.get('lang');
    let stale = false;

    if (category && CATEGORIES.some((item) => item.id === category)) {
      state.category = category;
    } else if (category) {
      stale = true; // enlace antiguo, p. ej. ?cat=world o ?cat=business
    }

    if (lang && ['all', 'en', 'es'].includes(lang)) {
      state.lang = lang;
    } else if (lang) {
      stale = true;
    }

    if (stale) updateUrl(); // deja la URL limpia y coherente con lo mostrado
  }

  function init() {
    cacheDom();
    state.uiLang = detectUILang();
    readUrlParams();

    setTheme(readTheme(), false);
    applyI18n();
    renderTodayLabel();
    buildCategories();
    buildSourceList();
    syncControls();
    bindEvents();
    registerServiceWorker();

    els.yearLabel.textContent = String(new Date().getFullYear());
    els.offlineBanner.hidden = navigator.onLine;
    els.installBtn.hidden = !(isIOS() && !isStandalone());

    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
