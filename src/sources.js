/* ---------------------------------------------------------------------- */
/*  Data sources: AniList (manga / manhwa / manhua) + Google Books         */
/*  No DOM in here — just fetch + normalise into one common "hit" shape:   */
/*  { source, id, title, cover, year, score (0-10), kind, total,           */
/*    genres[], authors[], description }                                   */
/* ---------------------------------------------------------------------- */

const ANILIST_URL = 'https://graphql.anilist.co';
const GOOGLE_BOOKS_URL = 'https://www.googleapis.com/books/v1/volumes';
// Optional. Without a key Google Books still works on a small shared quota.
// A key entered in Settings (setGoogleBooksKey) overrides any build-time key.
const BUILD_TIME_BOOKS_KEY = import.meta.env?.VITE_GOOGLE_BOOKS_KEY || '';
let googleBooksKey = BUILD_TIME_BOOKS_KEY;
export function setGoogleBooksKey(key) {
  googleBooksKey = (key || '').trim() || BUILD_TIME_BOOKS_KEY;
}

const CACHE_TTL = 10 * 60 * 1000;
const cache = new Map(); // key -> { at, value }

async function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value;
  const value = await loader();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function fetchJson(url, opts = {}, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (res.status === 429) throw new Error('rate_limited');
    if (!res.ok) throw new Error(`http_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const stripHtml = (s) => (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/* ------------------------------ AniList ------------------------------ */

const KIND_BY_COUNTRY = { JP: 'manga', KR: 'manhwa', CN: 'manhua', TW: 'manhua' };

const MEDIA_FIELDS = `
  id
  title { romaji english }
  coverImage { large }
  averageScore
  chapters
  volumes
  status
  genres
  countryOfOrigin
  startDate { year }
  description(asHtml: false)
`;

function normalizeAniList(m) {
  return {
    source: 'anilist',
    id: m.id,
    title: m.title?.english || m.title?.romaji || 'Untitled',
    cover: m.coverImage?.large || null,
    year: m.startDate?.year || null,
    score: m.averageScore ? m.averageScore / 10 : null,
    kind: KIND_BY_COUNTRY[m.countryOfOrigin] || 'manga',
    total: m.chapters || null,
    status: m.status,
    genres: m.genres || [],
    authors: [],
    description: stripHtml(m.description),
  };
}

async function anilist(query, variables) {
  const json = await fetchJson(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (json.errors?.length) throw new Error(json.errors[0].message || 'anilist_error');
  return json.data;
}

/**
 * Browse / search manga, manhwa and manhua.
 * opts: { page, perPage, search, sort, genre, country, status, popMin, popMax }
 *  sort    e.g. 'TRENDING_DESC' | 'POPULARITY_DESC' | 'SCORE_DESC'
 *  country 'JP' (manga) | 'KR' (manhwa) | 'CN' (manhua)
 *  status  'RELEASING' | 'FINISHED' | ...
 */
export function browseManga(opts = {}) {
  const { page = 1, perPage = 20, search, sort = 'POPULARITY_DESC', genre, country, status, popMin, popMax } = opts;
  const variables = {
    page, perPage,
    search: search || undefined,
    sort: [sort],
    genre: genre || undefined,
    country: country || undefined,
    status: status || undefined,
    popMin: popMin || undefined,
    popMax: popMax || undefined,
  };
  const query = `
    query ($page: Int, $perPage: Int, $search: String, $sort: [MediaSort], $genre: String,
           $country: CountryCode, $status: MediaStatus, $popMin: Int, $popMax: Int) {
      Page(page: $page, perPage: $perPage) {
        media(type: MANGA, format_in: [MANGA, ONE_SHOT], isAdult: false, search: $search, sort: $sort,
              genre: $genre, countryOfOrigin: $country, status: $status,
              popularity_greater: $popMin, popularity_lesser: $popMax) {
          ${MEDIA_FIELDS}
        }
      }
    }`;
  return cached(`al:${JSON.stringify(variables)}`, async () => {
    const data = await anilist(query, variables);
    return (data.Page?.media || []).map(normalizeAniList);
  });
}

/** Community recommendations for one AniList title ("because you liked X"). */
export function mangaRecommendations(anilistId, page = 1, perPage = 20) {
  const query = `
    query ($id: Int, $page: Int, $perPage: Int) {
      Media(id: $id, type: MANGA) {
        recommendations(page: $page, perPage: $perPage, sort: RATING_DESC) {
          nodes { rating mediaRecommendation { ${MEDIA_FIELDS} isAdult } }
        }
      }
    }`;
  return cached(`alrec:${anilistId}:${page}`, async () => {
    const data = await anilist(query, { id: anilistId, page, perPage });
    return (data.Media?.recommendations?.nodes || [])
      .filter((n) => n.mediaRecommendation && !n.mediaRecommendation.isAdult && (n.rating ?? 0) >= 0)
      .map((n) => normalizeAniList(n.mediaRecommendation));
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

function normalizeBook(item) {
  const v = item.volumeInfo || {};
  const thumb = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || null;
  return {
    source: 'gbooks',
    id: item.id,
    title: v.subtitle && v.title.length < 40 ? `${v.title}: ${v.subtitle}` : v.title || 'Untitled',
    cover: thumb
      ? thumb.replace('http://', 'https://').replace('&edge=curl', '').replace('zoom=1', 'zoom=2')
      : null,
    year: v.publishedDate ? Number(String(v.publishedDate).slice(0, 4)) || null : null,
    score: v.averageRating ? v.averageRating * 2 : null, // 0-5 -> 0-10
    kind: 'book',
    total: v.pageCount || null,
    genres: categoriesToGenres(v.categories),
    authors: v.authors || [],
    description: stripHtml(v.description),
  };
}

/**
 * Search / browse books.
 * opts: { page, perPage, q, orderBy ('relevance'|'newest'), subject, author }
 * Books without a cover are dropped so rows always look good.
 */
export function browseBooks(opts = {}) {
  const { page = 1, perPage = 20, q, orderBy = 'relevance', subject, author } = opts;
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

  return cached(`gb:${keyUsed ? 'k' : 'n'}:${buildUrl('')}`, async () => {
    let json;
    try {
      json = await fetchJson(buildUrl(keyUsed));
    } catch (err) {
      // A wrong / blocked key shouldn't break every row: retry on the shared quota.
      if (keyUsed && /^http_(400|403)$/.test(err.message)) json = await fetchJson(buildUrl(''));
      else throw err;
    }
    const seen = new Set();
    return (json.items || [])
      .map(normalizeBook)
      .filter((b) => {
        if (!b.cover) return false;
        const key = b.title.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  });
}
