/* ---------------------------------------------------------------------- */
/*  Data sources: AniList (anime / manga / manhwa / manhua) + Google Books */
/*  No DOM in here — just fetch + normalise into one common "hit" shape:   */
/*  { source, id, title, cover, year, score (0-10), kind, total,           */
/*    genres[], authors[], description }                                   */
/*                                                                         */
/*  Every request goes through a small scheduler, because AniList is       */
/*  currently limited to ~30 requests/minute (plus a burst limiter) and    */
/*  Google Books throttles keyless traffic. Results are cached on disk so  */
/*  reopening the app doesn't re-fire the same requests.                   */
/* ---------------------------------------------------------------------- */

const ANILIST_URL = 'https://graphql.anilist.co';
const GOOGLE_BOOKS_URL = 'https://www.googleapis.com/books/v1/volumes';

// Optional. A key entered in Settings (setGoogleBooksKey) overrides a build-time key.
const BUILD_TIME_BOOKS_KEY = import.meta.env?.VITE_GOOGLE_BOOKS_KEY || '';
let googleBooksKey = BUILD_TIME_BOOKS_KEY;
export function setGoogleBooksKey(key) {
  googleBooksKey = (key || '').trim() || BUILD_TIME_BOOKS_KEY;
}

/* ------------------------- cache (memory + disk) ------------------------- */

const CACHE_KEY = 'trackia_discovery_cache_v1';
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const CACHE_MAX_ENTRIES = 60;
const mem = new Map(); // key -> { at, value }
const inflight = new Map(); // key -> Promise (share identical concurrent requests)

try {
  const raw = localStorage.getItem(CACHE_KEY);
  if (raw) Object.entries(JSON.parse(raw)).forEach(([k, v]) => mem.set(k, v));
} catch { /* no storage / bad JSON: start empty */ }

let persistTimer = null;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      const fresh = [...mem.entries()]
        .filter(([, v]) => Date.now() - v.at < CACHE_TTL)
        .sort((a, b) => b[1].at - a[1].at)
        .slice(0, CACHE_MAX_ENTRIES);
      localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(fresh)));
    } catch { /* storage full: cache stays in memory only */ }
  }, 500);
}

function cached(key, loader) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return Promise.resolve(hit.value);
  if (inflight.has(key)) return inflight.get(key);
  const p = loader()
    .then((value) => {
      const worthKeeping = Array.isArray(value) ? value.length > 0 : !!value;
      if (worthKeeping) { mem.set(key, { at: Date.now(), value }); persist(); }
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/* ------------------------------ scheduler ------------------------------ */

// Runs jobs one-at-a-time-ish with a minimum gap, and can be paused after a 429.
function makeLimiter({ minGapMs, concurrency }) {
  const queue = [];
  let active = 0;
  let lastStart = 0;
  let blockedUntil = 0;

  const pump = () => {
    if (active >= concurrency || !queue.length) return;
    const wait = Math.max(blockedUntil - Date.now(), lastStart + minGapMs - Date.now());
    if (wait > 0) { setTimeout(pump, wait); return; }
    const job = queue.shift();
    active++;
    lastStart = Date.now();
    job.fn().then(job.resolve, job.reject).finally(() => { active--; pump(); });
    pump();
  };

  return {
    run(fn, priority = false) {
      return new Promise((resolve, reject) => {
        const job = { fn, resolve, reject };
        if (priority) queue.unshift(job); else queue.push(job);
        pump();
      });
    },
    block(ms) { blockedUntil = Math.max(blockedUntil, Date.now() + ms); },
  };
}

// AniList: ~30 req/min currently => 1 request every ~2.2s stays under it.
const anilistLimiter = makeLimiter({ minGapMs: 2200, concurrency: 1 });
const booksLimiter = makeLimiter({ minGapMs: 350, concurrency: 2 });

async function fetchJson(url, opts = {}, ms = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  let res;
  try {
    res = await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (err) {
    throw new Error(err?.name === 'AbortError' ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) {
    const e = new Error('rate_limited');
    const retryAfter = Number(res.headers?.get?.('Retry-After'));
    e.retryAfterMs = retryAfter > 0 ? retryAfter * 1000 : 0;
    throw e;
  }
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json();
}

// Queue a request; on a 429 pause this service and retry once.
async function limitedJson(limiter, url, opts, { priority = false, blockMs = 5000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await limiter.run(() => fetchJson(url, opts), priority);
    } catch (err) {
      if (err.message === 'rate_limited' && attempt < 1) {
        limiter.block(err.retryAfterMs || blockMs);
        continue;
      }
      throw err;
    }
  }
}

/** Human-readable reason for the UI. */
export function describeError(err) {
  const m = err?.message || '';
  if (m === 'rate_limited') return 'rate limit reached, try again in a minute';
  if (m === 'network') return "couldn't reach the service (offline, or blocked by the app)";
  if (m === 'timeout') return 'timed out';
  if (/^http_/.test(m)) return `server error ${m.slice(5)}`;
  return m || 'unknown error';
}

const stripHtml = (s) => (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const shortText = (s) => stripHtml(s).slice(0, 240);

/* ------------------------------ AniList ------------------------------ */

const KIND_BY_COUNTRY = { JP: 'manga', KR: 'manhwa', CN: 'manhua', TW: 'manhua' };

const MEDIA_FIELDS = `
  id
  type
  format
  title { romaji english }
  coverImage { large }
  averageScore
  episodes
  chapters
  volumes
  status
  genres
  countryOfOrigin
  isAdult
  startDate { year }
  description(asHtml: false)
`;

function normalizeAniList(m) {
  const isAnime = m.type === 'ANIME';
  return {
    source: 'anilist',
    id: m.id,
    title: m.title?.english || m.title?.romaji || 'Untitled',
    cover: m.coverImage?.large || null,
    year: m.startDate?.year || null,
    score: m.averageScore ? m.averageScore / 10 : null,
    kind: isAnime ? 'anime' : (KIND_BY_COUNTRY[m.countryOfOrigin] || 'manga'),
    format: m.format || null,
    total: (isAnime ? m.episodes : m.chapters) || null,
    status: m.status,
    genres: m.genres || [],
    authors: [],
    description: shortText(m.description),
  };
}

async function anilist(query, variables, priority = false) {
  const json = await limitedJson(
    anilistLimiter,
    ANILIST_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    },
    { priority, blockMs: 60000 }, // AniList's penalty after a 429 is about a minute
  );
  if (json.errors?.length) throw new Error(json.errors[0].message || 'anilist_error');
  return json.data;
}

/** Tiny request used by Settings → "Test AniList". Throws on failure. */
export function pingAniList() {
  return anilist('query { Media(id: 30013, type: MANGA) { id } }', {}, true);
}

const ANIME_FORMATS = ['TV', 'TV_SHORT', 'MOVIE', 'OVA', 'ONA'];
const MANGA_FORMATS = ['MANGA', 'ONE_SHOT'];

/**
 * Browse / search AniList anime or manga (incl. manhwa / manhua).
 * opts: { type ('ANIME'|'MANGA'), page, perPage, search, sort, genre, country,
 *         status, popMin, popMax, season, seasonYear, format[], priority }
 */
export function browseMedia(opts = {}) {
  const {
    type = 'MANGA', page = 1, perPage = 20, search, sort = 'POPULARITY_DESC', genre, country,
    status, popMin, popMax, season, seasonYear, format, priority,
  } = opts;
  const variables = {
    type,
    formats: format || (type === 'ANIME' ? ANIME_FORMATS : MANGA_FORMATS),
    page, perPage,
    search: search || undefined,
    sort: [sort],
    genre: genre || undefined,
    country: country || undefined,
    status: status || undefined,
    popMin: popMin || undefined,
    popMax: popMax || undefined,
    season: season || undefined,
    seasonYear: seasonYear || undefined,
  };
  const query = `
    query ($type: MediaType, $formats: [MediaFormat], $page: Int, $perPage: Int, $search: String,
           $sort: [MediaSort], $genre: String, $country: CountryCode, $status: MediaStatus,
           $popMin: Int, $popMax: Int, $season: MediaSeason, $seasonYear: Int) {
      Page(page: $page, perPage: $perPage) {
        media(type: $type, format_in: $formats, isAdult: false, search: $search, sort: $sort,
              genre: $genre, countryOfOrigin: $country, status: $status,
              popularity_greater: $popMin, popularity_lesser: $popMax,
              season: $season, seasonYear: $seasonYear) {
          ${MEDIA_FIELDS}
        }
      }
    }`;
  return cached(`al:${JSON.stringify(variables)}`, async () => {
    const data = await anilist(query, variables, priority);
    return (data.Page?.media || []).filter((m) => !m.isAdult).map(normalizeAniList);
  });
}

export const browseManga = (opts = {}) => browseMedia({ ...opts, type: 'MANGA' });
export const browseAnime = (opts = {}) => browseMedia({ ...opts, type: 'ANIME' });

/** Community recommendations for one AniList title ("because you liked X"). */
export function mediaRecommendations(anilistId, type = 'MANGA', page = 1, perPage = 20) {
  const query = `
    query ($id: Int, $type: MediaType, $page: Int, $perPage: Int) {
      Media(id: $id, type: $type) {
        recommendations(page: $page, perPage: $perPage, sort: RATING_DESC) {
          nodes { rating mediaRecommendation { ${MEDIA_FIELDS} } }
        }
      }
    }`;
  return cached(`alrec:${type}:${anilistId}:${page}`, async () => {
    const data = await anilist(query, { id: anilistId, type, page, perPage });
    return (data.Media?.recommendations?.nodes || [])
      .filter((n) => n.mediaRecommendation && !n.mediaRecommendation.isAdult && (n.rating ?? 0) >= 0)
      .map((n) => normalizeAniList(n.mediaRecommendation));
  });
}
export const mangaRecommendations = (id, page = 1, perPage = 20) => mediaRecommendations(id, 'MANGA', page, perPage);
export const animeRecommendations = (id, page = 1, perPage = 20) => mediaRecommendations(id, 'ANIME', page, perPage);

const formatDate = (d) => (d?.year ? d.year : null);

/**
 * Everything the detail card needs for one AniList title: a full description,
 * format / length / studio / staff, next-airing info, a trailer link and the
 * related titles (sequels, prequels, adaptations…).
 */
export function mediaDetails(anilistId, type = 'ANIME') {
  const query = `
    query ($id: Int, $type: MediaType) {
      Media(id: $id, type: $type) {
        ${MEDIA_FIELDS}
        duration
        season
        seasonYear
        popularity
        siteUrl
        endDate { year }
        studios(isMain: true) { nodes { name } }
        staff(perPage: 12, sort: RELEVANCE) { edges { role node { name { full } } } }
        nextAiringEpisode { episode airingAt }
        trailer { id site }
        relations {
          edges { relationType(version: 2) node { ${MEDIA_FIELDS} } }
        }
      }
    }`;
  return cached(`aldetail:${type}:${anilistId}`, async () => {
    const data = await anilist(query, { id: anilistId, type }, true);
    const m = data.Media;
    if (!m) return null;
    const trailerUrl = m.trailer?.id
      ? (m.trailer.site === 'youtube' ? `https://www.youtube.com/watch?v=${m.trailer.id}`
        : m.trailer.site === 'dailymotion' ? `https://www.dailymotion.com/video/${m.trailer.id}` : null)
      : null;
    const SHOW_RELATIONS = new Set(['PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE', 'ADAPTATION', 'SOURCE', 'SUMMARY', 'CHARACTER', 'OTHER']);
    return {
      ...normalizeAniList(m),
      description: stripHtml(m.description).slice(0, 1500),
      duration: m.duration || null,
      volumes: m.volumes || null,
      season: m.season || null,
      seasonYear: m.seasonYear || null,
      endYear: formatDate(m.endDate),
      popularity: m.popularity || 0,
      siteUrl: m.siteUrl || '',
      studios: (m.studios?.nodes || []).map((n) => n.name).filter(Boolean),
      staff: (m.staff?.edges || [])
        .map((e) => ({ role: e.role || '', name: e.node?.name?.full || '' }))
        .filter((e) => e.name),
      nextEpisode: m.nextAiringEpisode
        ? { episode: m.nextAiringEpisode.episode, airingAt: m.nextAiringEpisode.airingAt * 1000 }
        : null,
      trailerUrl,
      related: (m.relations?.edges || [])
        .filter((e) => e.node && !e.node.isAdult && SHOW_RELATIONS.has(e.relationType))
        .map((e) => ({ relation: e.relationType, hit: normalizeAniList(e.node) })),
    };
  });
}

/* ------------------------------- Staff -------------------------------- */

function normalizeStaff(s) {
  return {
    source: 'anilist',
    id: s.id,
    name: s.name?.full || 'Unknown',
    image: s.image?.medium || s.image?.large || null,
    occupations: s.primaryOccupations || [],
  };
}

/** People search (directors, mangaka, voice actors…). */
export function searchStaff(search, perPage = 5) {
  const query = `
    query ($search: String, $perPage: Int) {
      Page(page: 1, perPage: $perPage) {
        staff(search: $search, sort: SEARCH_MATCH) {
          id
          name { full }
          image { medium }
          primaryOccupations
        }
      }
    }`;
  return cached(`alstaff:${search.toLowerCase()}:${perPage}`, async () => {
    const data = await anilist(query, { search, perPage }, true);
    return (data.Page?.staff || []).map(normalizeStaff);
  });
}

/** One person's credits: production roles, plus (anime only) voice-acting roles. */
export function staffDetails(staffId, type = 'ANIME') {
  const query = `
    query ($id: Int, $type: MediaType) {
      Staff(id: $id) {
        id
        name { full }
        image { large }
        description(asHtml: false)
        primaryOccupations
        staffMedia(type: $type, sort: POPULARITY_DESC, perPage: 30) { nodes { ${MEDIA_FIELDS} } }
        characterMedia(sort: POPULARITY_DESC, perPage: 30) { nodes { ${MEDIA_FIELDS} } }
      }
    }`;
  return cached(`alstaffd:${type}:${staffId}`, async () => {
    const data = await anilist(query, { id: staffId, type }, true);
    const st = data.Staff;
    if (!st) return null;
    const seen = new Set();
    const toHits = (nodes, onlyType) => (nodes || [])
      .filter((m) => m && !m.isAdult && (!onlyType || m.type === onlyType) && m.coverImage?.large)
      .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
      .map(normalizeAniList);
    return {
      ...normalizeStaff(st),
      image: st.image?.large || null,
      bio: stripHtml(st.description).slice(0, 500),
      credits: toHits(st.staffMedia?.nodes, type),
      voice: type === 'ANIME' ? toHits(st.characterMedia?.nodes, 'ANIME') : [],
    };
  });
}

/* --------------------------- Google Books ---------------------------- */

// "Fiction / Fantasy / Epic" -> ['Fantasy', 'Epic']  (drops vague words)
const VAGUE_CATEGORIES = new Set(['fiction', 'general', 'nonfiction', 'non-fiction', 'juvenile fiction', 'juvenile nonfiction']);
function categoriesToGenres(categories = []) {
  const out = [];
  categories.forEach((c) =>
    String(c).split('/').map((s) => s.trim()).forEach((g) => {
      if (g && !VAGUE_CATEGORIES.has(g.toLowerCase()) && !out.includes(g)) out.push(g);
    }));
  return out.slice(0, 5);
}

function normalizeBook(item, descLen = 240) {
  const v = item.volumeInfo || {};
  const thumb = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || null;
  return {
    source: 'gbooks',
    id: item.id,
    title: v.subtitle && (v.title || '').length < 40 ? `${v.title}: ${v.subtitle}` : v.title || 'Untitled',
    cover: thumb
      ? thumb.replace('http://', 'https://').replace('&edge=curl', '').replace('zoom=1', 'zoom=2')
      : null,
    year: v.publishedDate ? Number(String(v.publishedDate).slice(0, 4)) || null : null,
    score: v.averageRating ? v.averageRating * 2 : null, // 0-5 -> 0-10
    kind: 'book',
    total: v.pageCount || null,
    genres: categoriesToGenres(v.categories),
    authors: v.authors || [],
    description: stripHtml(v.description).slice(0, descLen),
    publisher: v.publisher || '',
    published: v.publishedDate || '',
    pages: v.pageCount || null,
    ratingsCount: v.ratingsCount || 0,
    link: v.infoLink || '',
  };
}

/**
 * Search / browse books.
 * opts: { page, perPage, q, orderBy ('relevance'|'newest'), subject, author, priority, requireCover }
 * By default books without a cover are dropped so rows always look good
 * (search passes requireCover: false so a title never goes missing).
 */
export function browseBooks(opts = {}) {
  const { page = 1, perPage = 20, q, orderBy = 'relevance', subject, author, priority, requireCover = true } = opts;
  const parts = [];
  if (q) parts.push(q);
  if (subject) parts.push(`subject:"${subject}"`);
  if (author) parts.push(`inauthor:"${author}"`);
  if (!parts.length) parts.push('subject:fiction');

  const buildUrl = (key) => {
    const params = new URLSearchParams({
      q: parts.join('+'),
      orderBy,
      maxResults: String(perPage),
      startIndex: String((page - 1) * perPage),
      printType: 'books',
      langRestrict: 'en',
    });
    if (key) params.set('key', key);
    // URLSearchParams encodes "+" — Google wants a literal "+" between terms.
    return `${GOOGLE_BOOKS_URL}?${params.toString().replace(/%2B/g, '+')}`;
  };
  const keyUsed = googleBooksKey;
  const fetchOpts = { priority, blockMs: 5000 };

  return cached(`gb:${requireCover ? 'c' : 'a'}:${buildUrl('')}`, async () => {
    let json;
    try {
      json = await limitedJson(booksLimiter, buildUrl(keyUsed), undefined, fetchOpts);
    } catch (err) {
      // A wrong / blocked key shouldn't break every row: retry on the shared quota.
      if (keyUsed && /^http_(400|403)$/.test(err.message)) {
        json = await limitedJson(booksLimiter, buildUrl(''), undefined, fetchOpts);
      } else {
        throw err;
      }
    }
    const seen = new Set();
    return (json.items || [])
      .map(normalizeBook)
      .filter((b) => {
        if (requireCover && !b.cover) return false;
        const key = b.title.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  });
}

/** Full details for one Google Books volume (longer description, publisher…). */
export function bookDetails(volumeId) {
  const buildUrl = (key) => `${GOOGLE_BOOKS_URL}/${encodeURIComponent(volumeId)}${key ? `?key=${encodeURIComponent(key)}` : ''}`;
  const keyUsed = googleBooksKey;
  return cached(`gbvol:${volumeId}`, async () => {
    let json;
    try {
      json = await limitedJson(booksLimiter, buildUrl(keyUsed), undefined, { priority: true, blockMs: 5000 });
    } catch (err) {
      if (keyUsed && /^http_(400|403)$/.test(err.message)) {
        json = await limitedJson(booksLimiter, buildUrl(''), undefined, { priority: true, blockMs: 5000 });
      } else {
        throw err;
      }
    }
    return json?.volumeInfo ? normalizeBook(json, 1500) : null;
  });
}
