import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { initThemedSelects, syncThemedSelect } from './themedSelect.js';
import '@fontsource-variable/outfit';

/* ---------------------------------------------------------------------- */
/*  Storage                                                                */
/* ---------------------------------------------------------------------- */

const ENTRIES_KEY = 'trackia_entries_v1';
const SETTINGS_KEY = 'trackia_settings_v1';

const UNIT_BY_TYPE = {
  anime: 'episodes',
  series: 'episodes',
  movie: 'watch',
  book: 'pages',
  manga: 'chapters',
};

const TYPE_LABEL = { anime: 'Anime', series: 'Series', movie: 'Movie', book: 'Book', manga: 'Manga', list: 'List' };
const STATUS_LABEL = {
  plan: 'Plan to start',
  progress: 'In progress',
  completed: 'Completed',
  hold: 'On hold',
  dropped: 'Dropped',
};

function loadEntries() {
  try {
    const raw = localStorage.getItem(ENTRIES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveEntries(entries) {
  localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries));
}

function loadSettings() {
  const defaults = {
    fontSize: 'medium',
    tileSize: 'medium',
    theme: { '--c-bg': '', '--c-surface': '', '--c-accent': '', '--c-text': '' },
    tmdbApiKey: '',
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  } catch {
    return defaults;
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/* ---------------------------------------------------------------------- */
/*  State                                                                  */
/* ---------------------------------------------------------------------- */

let entries = loadEntries();
let settings = loadSettings();

const state = {
  typeFilter: 'all',
  statusFilter: 'all',
  sort: 'recent',
  search: '',
  editingId: null,
  draftTags: [],
  draftCover: null,
  draftTmdbId: null,
  draftGenreIds: [],
};

/* ---------------------------------------------------------------------- */
/*  DOM refs                                                               */
/* ---------------------------------------------------------------------- */

const $ = (sel) => document.querySelector(sel);
const grid = $('#grid');
const emptyState = $('#emptyState');
const backdrop = $('#backdrop');

const entrySheet = $('#entrySheet');
const menuSheet = $('#menuSheet');
const detailSheet = $('#detailSheet');
const ALL_SHEETS = [entrySheet, menuSheet, detailSheet];

/* ---------------------------------------------------------------------- */
/*  Pages (Home / Library / Profile) + bottom nav                         */
/* ---------------------------------------------------------------------- */

const PAGES = {
  home: $('#page-home'),
  library: $('#page-library'),
  profile: $('#page-profile'),
};
const bottomNav = $('#bottomNav');
let currentPage = 'home';

function showPage(name) {
  if (!PAGES[name]) return;
  currentPage = name;
  Object.entries(PAGES).forEach(([key, el]) => { el.hidden = key !== name; });
  bottomNav.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.page === name));
  window.scrollTo({ top: 0 });
  if (name === 'home') renderHome();
  if (name === 'profile') renderProfile();
}

bottomNav.addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-btn');
  if (!btn) return;
  showPage(btn.dataset.page);
});

/* ---------------------------------------------------------------------- */
/*  Init settings application                                              */
/* ---------------------------------------------------------------------- */

function applySettings() {
  document.body.dataset.font = settings.fontSize;
  document.body.dataset.tile = settings.tileSize;
  const root = document.documentElement.style;
  Object.entries(settings.theme).forEach(([key, val]) => {
    if (val) root.setProperty(key, val);
    else root.removeProperty(key);
  });

  $('#fontSizeSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.val === settings.fontSize));
  $('#tileSizeSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.val === settings.tileSize));

  document.querySelectorAll('.hex-input').forEach((input) => {
    const v = settings.theme[input.dataset.var];
    input.value = v || '';
  });
  document.querySelectorAll('.color-swatch').forEach((input) => {
    const v = settings.theme[input.dataset.var];
    input.value = v && /^#([0-9a-f]{6})$/i.test(v) ? v : '#000000';
  });

  $('#themePreset').value = detectPreset();
  syncThemedSelect($('#themePreset'));
}

/* ---------------------------------------------------------------------- */
/*  Rendering                                                              */
/* ---------------------------------------------------------------------- */

function initials(title) {
  return (title || '?').trim().slice(0, 1).toUpperCase();
}

function colorForString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 22%)`;
}

function filteredSortedEntries() {
  let list = entries.slice();

  if (state.typeFilter !== 'all') list = list.filter((e) => e.type === state.typeFilter);
  if (state.statusFilter !== 'all') list = list.filter((e) => e.status === state.statusFilter);
  if (state.search.trim()) {
    const q = state.search.trim().toLowerCase();
    list = list.filter((e) =>
      e.title.toLowerCase().includes(q) ||
      (e.notes || '').toLowerCase().includes(q) ||
      (e.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  }

  switch (state.sort) {
    case 'title':
      list.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case 'rating':
      list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      break;
    case 'progress': {
      const pct = (e) => (e.total ? e.progress / e.total : e.progress || 0);
      list.sort((a, b) => pct(b) - pct(a));
      break;
    }
    default:
      list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  return list;
}

function render() {
  const list = filteredSortedEntries();
  grid.innerHTML = '';
  emptyState.hidden = list.length !== 0;

  list.forEach((e, idx) => {
    const card = renderCard(e);
    // Gentle cascading fade-in, capped so long lists don't feel sluggish.
    card.style.animationDelay = `${Math.min(idx, 16) * 22}ms`;
    grid.appendChild(card);
  });
}

function renderCard(e) {
  if (e.type === 'list') return renderListItem(e);

  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.id = e.id;

  const cover = document.createElement('div');
  cover.className = 'card-cover';
  cover.style.background = e.cover ? 'transparent' : colorForString(e.title || e.id);

  if (e.cover) {
    const img = document.createElement('img');
    img.src = e.cover;
    img.alt = e.title;
    img.addEventListener('error', () => {
      // Broken/offline remote link: swap in the initial-letter placeholder.
      img.remove();
      const span = document.createElement('span');
      span.className = 'initial';
      span.textContent = initials(e.title);
      cover.insertBefore(span, cover.firstChild);
    });
    cover.appendChild(img);
  } else {
    const span = document.createElement('span');
    span.className = 'initial';
    span.textContent = initials(e.title);
    cover.appendChild(span);
  }

  const badgeRow = document.createElement('div');
  badgeRow.className = 'badge-row';
  badgeRow.innerHTML = `
    <span class="badge badge-type">${TYPE_LABEL[e.type] || e.type}</span>
    ${e.rating ? `<span class="badge badge-rating">★ ${e.rating}</span>` : '<span></span>'}
  `;
  cover.appendChild(badgeRow);

  if (e.status === 'progress') {
    const bump = document.createElement('button');
    bump.className = 'bump-btn';
    bump.type = 'button';
    bump.textContent = '+1';
    bump.setAttribute('aria-label', 'Bump progress by 1');
    bump.addEventListener('click', (ev) => {
      ev.stopPropagation();
      bumpProgress(e.id);
    });
    cover.appendChild(bump);
  }

  const body = document.createElement('div');
  body.className = 'card-body';

  const title = document.createElement('h3');
  title.className = 'card-title';
  title.textContent = e.title;

  const status = document.createElement('div');
  status.className = 'card-status';
  status.textContent = STATUS_LABEL[e.status] || e.status;

  body.appendChild(title);
  body.appendChild(status);

  const unit = UNIT_BY_TYPE[e.type] || 'progress';
  if (unit !== 'watch' || e.total) {
    const track = document.createElement('div');
    track.className = 'progress-track';
    const fill = document.createElement('div');
    fill.className = 'progress-fill';
    const pct = e.total ? Math.min(100, Math.round((e.progress / e.total) * 100)) : (e.status === 'completed' ? 100 : 0);
    fill.style.width = pct + '%';
    track.appendChild(fill);
    body.appendChild(track);

    const label = document.createElement('div');
    label.className = 'progress-label';
    label.textContent = e.total
      ? `${e.progress} / ${e.total} ${unit}`
      : `${e.progress} ${unit}`;
    body.appendChild(label);
  }

  if (e.tags && e.tags.length) {
    const chipRow = document.createElement('div');
    chipRow.className = 'chip-row';
    e.tags.slice(0, 4).forEach((t) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = t;
      chipRow.appendChild(chip);
    });
    body.appendChild(chipRow);
  }

  card.appendChild(cover);
  card.appendChild(body);

  card.addEventListener('click', () => openDetailSheet(e.id));

  return card;
}

/** List-type entries render as a Keep-style note card instead of a cover
 *  card — no cover art, no progress bar; just a title, a text snippet from
 *  the note body, and a bit of status/rating/tag context underneath. */
function renderListItem(e) {
  const row = document.createElement('article');
  row.className = 'card list-item';
  row.dataset.id = e.id;

  const head = document.createElement('div');
  head.className = 'list-item-head';

  const title = document.createElement('h3');
  title.className = 'list-item-title';
  title.textContent = e.title;
  head.appendChild(title);

  if (e.rating) {
    const rating = document.createElement('span');
    rating.className = 'badge badge-rating';
    rating.textContent = `★ ${e.rating}`;
    head.appendChild(rating);
  }
  row.appendChild(head);

  if (e.notes) {
    const plain = richNotesToPlainText(e.notes);
    if (plain) {
      const preview = document.createElement('p');
      preview.className = 'list-item-preview';
      preview.textContent = plain.length > 160 ? `${plain.slice(0, 160).trimEnd()}…` : plain;
      row.appendChild(preview);
    }
  }

  const meta = document.createElement('div');
  meta.className = 'list-item-meta';
  if (e.tags && e.tags.length) {
    e.tags.slice(0, 4).forEach((t) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = t;
      meta.appendChild(chip);
    });
  }
  const status = document.createElement('span');
  status.className = 'card-status';
  status.textContent = STATUS_LABEL[e.status] || e.status;
  meta.appendChild(status);
  row.appendChild(meta);

  row.addEventListener('click', () => openDetailSheet(e.id));

  return row;
}

function bumpProgress(id) {
  const e = entries.find((x) => x.id === id);
  if (!e) return;
  e.progress = (e.progress || 0) + 1;
  if (e.total && e.progress >= e.total) {
    e.progress = e.total;
    e.status = 'completed';
  }
  e.updatedAt = Date.now();
  saveEntries(entries);
  render();
  if (currentPage === 'home') renderHome();
}

/* ---------------------------------------------------------------------- */
/*  Home page — rows built from the current library                       */
/* ---------------------------------------------------------------------- */

const homeSections = $('#homeSections');
const homeEmptyState = $('#homeEmptyState');

function hcardProgressPct(e) {
  if (e.total) return Math.min(100, Math.round((e.progress / e.total) * 100));
  return e.status === 'completed' ? 100 : 0;
}

function renderHCard(e) {
  const card = document.createElement('article');
  card.className = 'hcard';
  card.dataset.id = e.id;

  const cover = document.createElement('div');
  cover.className = 'hcard-cover';
  cover.style.background = e.cover ? 'transparent' : colorForString(e.title || e.id);

  if (e.cover) {
    const img = document.createElement('img');
    img.src = e.cover;
    img.alt = e.title;
    img.addEventListener('error', () => {
      img.remove();
      const span = document.createElement('span');
      span.className = 'initial';
      span.textContent = initials(e.title);
      cover.insertBefore(span, cover.firstChild);
    });
    cover.appendChild(img);
  } else {
    const span = document.createElement('span');
    span.className = 'initial';
    span.textContent = initials(e.title);
    cover.appendChild(span);
  }

  if (e.rating) {
    const rating = document.createElement('span');
    rating.className = 'hcard-rating';
    rating.textContent = `★ ${e.rating}`;
    cover.appendChild(rating);
  }

  if (e.status === 'progress') {
    const track = document.createElement('div');
    track.className = 'hcard-progress';
    const fill = document.createElement('div');
    fill.className = 'hcard-progress-fill';
    fill.style.width = hcardProgressPct(e) + '%';
    track.appendChild(fill);
    cover.appendChild(track);
  }

  const title = document.createElement('div');
  title.className = 'hcard-title';
  title.textContent = e.title;

  const sub = document.createElement('div');
  sub.className = 'hcard-sub';
  sub.textContent = STATUS_LABEL[e.status] || e.status;

  card.appendChild(cover);
  card.appendChild(title);
  card.appendChild(sub);
  card.addEventListener('click', () => openDetailSheet(e.id));
  return card;
}

function renderHRow(title, list, opts = {}) {
  if (!list.length) return null;
  const { onSeeAll, cardRenderer = renderHCard } = opts;
  const section = document.createElement('section');
  section.className = 'hrow';

  const head = document.createElement('div');
  head.className = 'hrow-head';
  head.innerHTML = `<h2>${escapeHtml(title)}${onSeeAll ? '<svg class="chev" viewBox="0 0 24 24"><path d="M8.6 5.4L15.2 12l-6.6 6.6-1.4-1.4L12.4 12 7.2 6.8z"/></svg>' : ''}</h2>`;
  if (onSeeAll) head.addEventListener('click', onSeeAll);
  section.appendChild(head);

  const scroll = document.createElement('div');
  scroll.className = 'hscroll';
  list.forEach((item) => scroll.appendChild(cardRenderer(item)));
  section.appendChild(scroll);

  return section;
}

/* ---- TMDB-sourced cards (trending / genre picks — not yet in the library) ---- */
function renderTmdbCard(hit) {
  const mediaType = hit.media_type === 'tv' ? 'tv' : 'movie';
  const title = hit.title || hit.name || 'Untitled';

  const card = document.createElement('article');
  card.className = 'hcard';

  const cover = document.createElement('div');
  cover.className = 'hcard-cover';

  if (hit.poster_path) {
    const img = document.createElement('img');
    img.src = `https://image.tmdb.org/t/p/w300${hit.poster_path}`;
    img.alt = title;
    cover.appendChild(img);
  } else {
    cover.style.background = colorForString(title);
    const span = document.createElement('span');
    span.className = 'initial';
    span.textContent = initials(title);
    cover.appendChild(span);
  }

  const owned = entries.find((e) => e.tmdbId && String(e.tmdbId) === String(hit.id));
  if (owned) {
    const badge = document.createElement('span');
    badge.className = 'hcard-rating';
    badge.textContent = 'In list';
    cover.appendChild(badge);
  } else if (hit.vote_average) {
    const badge = document.createElement('span');
    badge.className = 'hcard-rating';
    badge.textContent = `★ ${hit.vote_average.toFixed(1)}`;
    cover.appendChild(badge);
  }

  const titleEl = document.createElement('div');
  titleEl.className = 'hcard-title';
  titleEl.textContent = title;

  const sub = document.createElement('div');
  sub.className = 'hcard-sub';
  sub.textContent = mediaType === 'movie' ? 'Movie' : 'Series';

  card.appendChild(cover);
  card.appendChild(titleEl);
  card.appendChild(sub);
  card.addEventListener('click', () => {
    if (owned) openDetailSheet(owned.id);
    else openEntrySheetFromSearch(hit, mediaType);
  });
  return card;
}

/* ---- TMDB trending / genre-based discovery, with pagination ----
   Kept in memory only (not persisted) and reused for a few minutes so
   revisiting the Home tab doesn't refire these requests every time.
   Each row starts with one page (~20 titles) and can be expanded with a
   "More" card up to ROW_PAGE_CAP pages (100 titles) per row. */
const TMDB_CACHE_TTL = 10 * 60 * 1000;
const ROW_PAGE_CAP = 5; // 5 pages x 20 results = up to 100 titles per row
const ROW_PAGE_SIZE = 20;

const tmdbPageCache = new Map(); // cacheKey -> { at, pages: Map(page -> items) }
let genreNameCache = null; // { at, map }

async function fetchTmdbPage(cacheKey, path, params, page) {
  let bucket = tmdbPageCache.get(cacheKey);
  if (bucket && Date.now() - bucket.at > TMDB_CACHE_TTL) bucket = null;
  if (!bucket) {
    bucket = { at: Date.now(), pages: new Map() };
    tmdbPageCache.set(cacheKey, bucket);
  }
  if (bucket.pages.has(page)) return bucket.pages.get(page);
  const [url, opts] = tmdbRequest(path, { ...params, page: String(page) });
  const res = await fetchWithTimeout(url, opts, 12000);
  if (!res.ok) throw new Error(`tmdb_page_failed:${path}`);
  const data = await res.json();
  const items = data.results || [];
  bucket.pages.set(page, items);
  return items;
}

function fetchTrendingPage(page) {
  return fetchTmdbPage('trending', '/trending/all/week', {}, page)
    .then((items) => items.filter((r) => r.media_type === 'movie' || r.media_type === 'tv'));
}

function fetchGenrePage(genreId, page) {
  return fetchTmdbPage(`genre:${genreId}`, '/discover/movie', { with_genres: String(genreId), sort_by: 'popularity.desc' }, page)
    .then((items) => items.map((r) => ({ ...r, media_type: 'movie' })));
}

async function getGenreNameMap() {
  if (genreNameCache && Date.now() - genreNameCache.at < TMDB_CACHE_TTL) return genreNameCache.map;
  const [url, opts] = tmdbRequest('/genre/movie/list');
  const res = await fetchWithTimeout(url, opts, 12000);
  const map = new Map();
  if (res.ok) {
    const data = await res.json();
    (data.genres || []).forEach((g) => map.set(g.id, g.name));
  }
  genreNameCache = { at: Date.now(), map };
  return map;
}

// Genre ids across the library, most common first, weighted slightly by
// rating so a well-liked title counts a bit more than an unrated one.
function topGenreIds(n) {
  const counts = new Map();
  entries.forEach((e) => {
    (e.genreIds || []).forEach((id) => {
      counts.set(id, (counts.get(id) || 0) + 1 + (e.rating ? e.rating / 10 : 0));
    });
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => id);
}

// A broad spread of popular TMDB genres, used to fill out the Home page
// with plenty to browse even before your own library has much genre data.
const DEFAULT_GENRES = [
  [28, 'Action'], [35, 'Comedy'], [18, 'Drama'], [16, 'Animation'],
  [27, 'Horror'], [10749, 'Romance'], [878, 'Science Fiction'],
  [53, 'Thriller'], [14, 'Fantasy'], [80, 'Crime'], [99, 'Documentary'],
  [10751, 'Family'],
];

async function buildFeaturedGenres() {
  const topIds = topGenreIds(3);
  const nameMap = await getGenreNameMap().catch(() => new Map());
  const seen = new Set();
  const featured = [];
  topIds.forEach((id) => {
    if (seen.has(id)) return;
    seen.add(id);
    featured.push({ id, name: nameMap.get(id) || 'Recommended', personal: true });
  });
  DEFAULT_GENRES.forEach(([id, name]) => {
    if (featured.length >= 7) return;
    if (seen.has(id)) return;
    seen.add(id);
    featured.push({ id, name, personal: false });
  });
  return featured;
}

// A trailing "More" card that fetches the row's next page on tap and
// appends the results, keeping itself at the end of the row until the
// page cap is hit or TMDB stops returning full pages.
function makeLoadMoreCard(onActivate) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'hcard hcard-more';
  card.innerHTML = `
    <div class="hcard-cover hcard-more-cover">
      <svg viewBox="0 0 24 24"><path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4z"/></svg>
    </div>
    <div class="hcard-title">More</div>
  `;
  let loading = false;
  card.addEventListener('click', async () => {
    if (loading) return;
    loading = true;
    card.classList.add('loading');
    try {
      await onActivate();
    } finally {
      loading = false;
      card.classList.remove('loading');
    }
  });
  return card;
}

// Builds one horizontally-scrolling, paginated TMDB row. `fetchPage(page)`
// must resolve to an array of TMDB-shaped hits for that page (1-indexed).
async function createPaginatedTmdbRow(title, fetchPage) {
  const first = await fetchPage(1);
  if (!first.length) return null;

  const section = document.createElement('section');
  section.className = 'hrow';
  const head = document.createElement('div');
  head.className = 'hrow-head';
  head.innerHTML = `<h2>${escapeHtml(title)}</h2>`;
  section.appendChild(head);

  const scroll = document.createElement('div');
  scroll.className = 'hscroll';
  section.appendChild(scroll);
  first.forEach((hit) => scroll.appendChild(renderTmdbCard(hit)));

  let page = 1;
  let moreCard = null;

  const attachMoreCard = () => {
    if (page >= ROW_PAGE_CAP) return;
    moreCard = makeLoadMoreCard(async () => {
      const next = await fetchPage(page + 1);
      page += 1;
      moreCard.remove();
      moreCard = null;
      next.forEach((hit) => scroll.appendChild(renderTmdbCard(hit)));
      if (next.length >= ROW_PAGE_SIZE) attachMoreCard();
    });
    scroll.appendChild(moreCard);
  };
  if (first.length >= ROW_PAGE_SIZE) attachMoreCard();

  return section;
}

let homeRenderToken = 0;

async function renderTmdbDiscoveryRows(token) {
  try {
    const row = await createPaginatedTmdbRow('Trending this week', fetchTrendingPage);
    if (token !== homeRenderToken) return;
    if (row) homeSections.appendChild(row);
  } catch (err) {
    console.error('TMDB trending fetch failed:', err);
  }

  let featured;
  try {
    featured = await buildFeaturedGenres();
  } catch (err) {
    console.error('TMDB genre list fetch failed:', err);
    featured = DEFAULT_GENRES.map(([id, name]) => ({ id, name, personal: false }));
  }
  if (token !== homeRenderToken) return;

  for (const genre of featured) {
    if (token !== homeRenderToken) return;
    try {
      const label = genre.personal ? `Because you like ${genre.name}` : genre.name;
      const row = await createPaginatedTmdbRow(label, (page) => fetchGenrePage(genre.id, page));
      if (token !== homeRenderToken) return;
      if (row) homeSections.appendChild(row);
    } catch (err) {
      console.error(`TMDB genre row failed (${genre.name}):`, err);
    }
  }
}

function renderHome() {
  const token = ++homeRenderToken;
  homeSections.innerHTML = '';
  const trackable = entries.filter((e) => e.type !== 'list');
  homeEmptyState.hidden = entries.length !== 0;

  const continueWatching = trackable
    .filter((e) => e.status === 'progress')
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 15);

  const recentlyAdded = trackable
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 15);

  const topRated = trackable
    .filter((e) => e.rating > 0)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 15);

  const planToStart = trackable
    .filter((e) => e.status === 'plan')
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 15);

  const goToLibrary = (statusFilter) => () => {
    showPage('library');
    state.statusFilter = statusFilter;
    $('#statusFilter').value = statusFilter;
    syncThemedSelect($('#statusFilter'));
    render();
  };

  const rows = [
    renderHRow('Continue watching', continueWatching, { onSeeAll: goToLibrary('progress') }),
    renderHRow('Recently added', recentlyAdded, { onSeeAll: goToLibrary('all') }),
    renderHRow('Top rated', topRated, { onSeeAll: goToLibrary('all') }),
    renderHRow('Plan to start', planToStart, { onSeeAll: goToLibrary('plan') }),
  ].filter(Boolean);

  rows.forEach((row) => homeSections.appendChild(row));

  if (!settings.tmdbApiKey) {
    const hint = document.createElement('div');
    hint.className = 'search-status-msg';
    hint.style.padding = '4px 18px 14px';
    hint.style.textAlign = 'left';
    hint.innerHTML = 'Add a free TMDB API key in <button type="button" class="link-btn" id="homeAddKeyHint">Settings</button> to see trending titles and genre-based picks.';
    homeSections.appendChild(hint);
    const link = hint.querySelector('#homeAddKeyHint');
    if (link) link.addEventListener('click', () => { showPage('profile'); setTimeout(() => openSheet(menuSheet), 200); });
  } else {
    renderTmdbDiscoveryRows(token);
  }
}

/* ---------------------------------------------------------------------- */
/*  Home page — TMDB title search (add-by-search)                         */
/* ---------------------------------------------------------------------- */

const homeSearchInput = $('#homeSearchInput');
const homeSearchResults = $('#homeSearchResults');
let homeSearchTimer = null;
let homeSearchToken = 0;

function showSearchStatus(html) {
  homeSearchResults.innerHTML = `<div class="search-status-msg">${html}</div>`;
  homeSearchResults.hidden = false;
}

function tmdbYear(hit) {
  const d = hit.release_date || hit.first_air_date || '';
  return d ? d.slice(0, 4) : '';
}

function renderSearchHits(hits) {
  homeSearchResults.innerHTML = '';
  if (!hits.length) {
    showSearchStatus("No matches on TMDB — try a different title.");
    return;
  }
  hits.forEach((hit) => {
    const mediaType = hit.media_type === 'movie' ? 'movie' : 'tv';
    const title = hit.title || hit.name || 'Untitled';
    const row = document.createElement('div');
    row.className = 'search-hit';

    const cover = document.createElement('div');
    cover.className = 'search-hit-cover';
    if (hit.poster_path) {
      const img = document.createElement('img');
      img.src = `https://image.tmdb.org/t/p/w200${hit.poster_path}`;
      img.alt = '';
      cover.appendChild(img);
    } else {
      cover.style.background = colorForString(title);
      const span = document.createElement('span');
      span.className = 'initial';
      span.textContent = initials(title);
      cover.appendChild(span);
    }

    const info = document.createElement('div');
    info.className = 'search-hit-info';
    const year = tmdbYear(hit);
    info.innerHTML = `
      <div class="search-hit-title">${escapeHtml(title)}</div>
      <div class="search-hit-meta">${year ? escapeHtml(year) + ' · ' : ''}${mediaType === 'movie' ? 'Movie' : 'Series'}</div>
    `;

    const alreadyHave = entries.find((e) => e.tmdbId && String(e.tmdbId) === String(hit.id));
    const tag = document.createElement('span');
    tag.className = 'search-hit-tag';
    tag.textContent = alreadyHave ? 'In list' : '+ Add';

    row.appendChild(cover);
    row.appendChild(info);
    row.appendChild(tag);

    row.addEventListener('click', () => {
      homeSearchResults.hidden = true;
      homeSearchInput.blur();
      if (alreadyHave) {
        openDetailSheet(alreadyHave.id);
      } else {
        openEntrySheetFromSearch(hit, mediaType);
      }
    });

    homeSearchResults.appendChild(row);
  });
  homeSearchResults.hidden = false;
}

async function runHomeSearch(query) {
  const apiKey = settings.tmdbApiKey;
  if (!apiKey) {
    showSearchStatus('Add a free TMDB API key in <button type="button" class="link-btn" id="searchOpenSettingsLink">Settings</button> to search.');
    const link = $('#searchOpenSettingsLink');
    if (link) link.addEventListener('click', () => { homeSearchResults.hidden = true; showPage('profile'); setTimeout(() => openSheet(menuSheet), 200); });
    return;
  }

  const token = ++homeSearchToken;
  showSearchStatus('Searching…');
  try {
    const [url, opts] = tmdbRequest('/search/multi', { query, include_adult: 'false' });
    const res = await fetchWithTimeout(url, opts, 12000);
    if (token !== homeSearchToken) return; // a newer keystroke superseded this request
    if (res.status === 401) { showSearchStatus('TMDB rejected that API key — double check it in Settings.'); return; }
    if (!res.ok) { showSearchStatus('TMDB error — try again shortly.'); return; }
    const data = await res.json();
    const hits = (data.results || []).filter((r) => r.media_type === 'movie' || r.media_type === 'tv').slice(0, 10);
    if (token !== homeSearchToken) return;
    renderSearchHits(hits);
  } catch (err) {
    if (token !== homeSearchToken) return;
    showSearchStatus(err.name === 'AbortError' ? 'TMDB took too long to respond.' : "Couldn't reach TMDB — check your connection.");
  }
}

homeSearchInput.addEventListener('input', () => {
  const q = homeSearchInput.value.trim();
  clearTimeout(homeSearchTimer);
  if (!q) { homeSearchResults.hidden = true; homeSearchResults.innerHTML = ''; return; }
  if (q.length < 2) { showSearchStatus('Keep typing…'); return; }
  homeSearchTimer = setTimeout(() => runHomeSearch(q), 450);
});

homeSearchInput.addEventListener('focus', () => {
  if (homeSearchInput.value.trim().length >= 2 && homeSearchResults.innerHTML) homeSearchResults.hidden = false;
});

document.addEventListener('click', (e) => {
  if (homeSearchResults.hidden) return;
  if (homeSearchResults.contains(e.target) || homeSearchInput.contains(e.target)) return;
  homeSearchResults.hidden = true;
});

/* ---------------------------------------------------------------------- */
/*  Profile page — brief stats + entry point to Settings                  */
/* ---------------------------------------------------------------------- */

const statsGrid = $('#statsGrid');
const breakdownList = $('#breakdownList');
const profileSummary = $('#profileSummary');
const profileAvatar = $('#profileAvatar');

function renderProfile() {
  const total = entries.length;
  const completed = entries.filter((e) => e.status === 'completed').length;
  const inProgress = entries.filter((e) => e.status === 'progress').length;
  const rated = entries.filter((e) => e.rating > 0);
  const avgRating = rated.length ? (rated.reduce((sum, e) => sum + e.rating, 0) / rated.length).toFixed(1) : '—';

  profileSummary.textContent = `${total} title${total === 1 ? '' : 's'} tracked`;
  profileAvatar.textContent = total ? initials(entries[0].title) : 'T';

  statsGrid.innerHTML = `
    <div class="stat-card"><div class="stat-value">${total}</div><div class="stat-label">Total</div></div>
    <div class="stat-card"><div class="stat-value">${completed}</div><div class="stat-label">Completed</div></div>
    <div class="stat-card"><div class="stat-value">${inProgress}</div><div class="stat-label">In progress</div></div>
    <div class="stat-card"><div class="stat-value">${avgRating}</div><div class="stat-label">Avg rating</div></div>
  `;

  const typeCounts = {};
  entries.forEach((e) => { typeCounts[e.type] = (typeCounts[e.type] || 0) + 1; });
  breakdownList.innerHTML = Object.keys(TYPE_LABEL)
    .filter((t) => typeCounts[t])
    .map((t) => `
      <div class="breakdown-row">
        <span class="b-label">${escapeHtml(TYPE_LABEL[t])}</span>
        <span class="b-value">${typeCounts[t]}</span>
      </div>
    `).join('') || '<div class="breakdown-row"><span class="b-label">Nothing tracked yet</span></div>';
}

$('#openSettingsBtn').addEventListener('click', () => openSheet(menuSheet));

/* ---------------------------------------------------------------------- */
/*  Detail sheet (title card)                                              */
/* ---------------------------------------------------------------------- */

let detailId = null;

const detailCover = $('#detailCover');
const detailCoverImg = $('#detailCoverImg');
const detailCoverInitial = $('#detailCoverInitial');
const detailBadges = $('#detailBadges');
const detailTitle = $('#detailTitle');
const detailMeta = $('#detailMeta');
const detailProgressWrap = $('#detailProgressWrap');
const detailProgressFill = $('#detailProgressFill');
const detailProgressLabel = $('#detailProgressLabel');
const detailBumpBtn = $('#detailBumpBtn');
const detailTags = $('#detailTags');
const detailNotesWrap = $('#detailNotesWrap');
const detailNotes = $('#detailNotes');

function openDetailSheet(id) {
  const e = entries.find((x) => x.id === id);
  if (!e) return;
  detailId = id;

  // Cover
  if (e.cover) {
    detailCoverImg.src = e.cover;
    detailCoverImg.hidden = false;
    detailCoverInitial.hidden = true;
    detailCoverImg.onerror = () => {
      detailCoverImg.hidden = true;
      detailCoverInitial.hidden = false;
    };
  } else {
    detailCoverImg.hidden = true;
    detailCoverImg.src = '';
    detailCoverInitial.hidden = false;
  }
  detailCoverInitial.textContent = initials(e.title);
  detailCover.style.background = e.cover ? 'transparent' : colorForString(e.title || e.id);
  detailCover.hidden = e.type === 'list';

  // Badges
  detailBadges.innerHTML = `
    <span class="badge badge-type">${escapeHtml(TYPE_LABEL[e.type] || e.type)}</span>
    <span class="badge badge-status">${escapeHtml(STATUS_LABEL[e.status] || e.status)}</span>
    ${e.rating ? `<span class="badge badge-rating">★ ${e.rating}</span>` : ''}
  `;

  // Title & meta (season, if any)
  detailTitle.textContent = e.title;
  if (e.season) {
    detailMeta.textContent = e.season;
    detailMeta.hidden = false;
  } else {
    detailMeta.hidden = true;
  }

  // Progress
  const unit = UNIT_BY_TYPE[e.type] || 'progress';
  if (e.type === 'list') {
    detailProgressWrap.hidden = true;
  } else {
    detailProgressWrap.hidden = false;
    const pct = e.total
      ? Math.min(100, Math.round((e.progress / e.total) * 100))
      : (e.status === 'completed' ? 100 : 0);
    detailProgressFill.style.width = pct + '%';
    detailProgressLabel.textContent = e.total
      ? `${e.progress} / ${e.total} ${unit}`
      : `${e.progress} ${unit}`;
    detailBumpBtn.hidden = e.status !== 'progress';
  }

  // Tags (free-text, shown as chips)
  detailTags.innerHTML = '';
  const hasTags = e.tags && e.tags.length;
  detailTags.hidden = !hasTags;
  if (hasTags) {
    e.tags.forEach((t) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = t;
      detailTags.appendChild(chip);
    });
  }

  // Notes
  if (e.notes) {
    detailNotesWrap.hidden = false;
    if (e.type === 'list') {
      detailNotes.innerHTML = sanitizeRichHtml(e.notes);
    } else {
      detailNotes.textContent = e.notes;
    }
  } else {
    detailNotesWrap.hidden = true;
  }

  openDetailCard();
}

function openDetailCard() {
  document.body.style.overflow = 'hidden';

  backdrop.hidden = false;
  void backdrop.offsetWidth;
  backdrop.classList.add('visible');

  detailSheet.hidden = false;
  detailSheet.classList.remove('open');
  void detailSheet.offsetWidth;
  detailSheet.classList.add('open');
}

function closeDetailCard() {
  detailSheet.classList.remove('open');
  backdrop.classList.remove('visible');
  document.body.style.overflow = '';
  setTimeout(() => {
    detailSheet.hidden = true;
    if (ALL_SHEETS.every((s) => s.hidden)) backdrop.hidden = true;
  }, 320);
}

$('#detailClose').addEventListener('click', () => closeDetailCard());

$('#detailBumpBtn').addEventListener('click', () => {
  if (!detailId) return;
  bumpProgress(detailId);
  openDetailSheet(detailId); // refresh the numbers/progress bar in place
});

$('#detailEditBtn').addEventListener('click', () => {
  const id = detailId;
  closeDetailCard();
  setTimeout(() => openEntrySheet(id), 220);
});

$('#detailDeleteBtn').addEventListener('click', () => {
  if (!detailId) return;
  if (!confirm('Delete this entry? This cannot be undone.')) return;
  entries = entries.filter((x) => x.id !== detailId);
  saveEntries(entries);
  render();
  if (currentPage === 'home') renderHome();
  closeDetailCard();
  showToast('Entry deleted');
});

/* ---------------------------------------------------------------------- */
/*  Sheets: generic open/close with swipe-to-close                         */
/* ---------------------------------------------------------------------- */

function openSheet(sheetEl) {
  document.body.style.overflow = 'hidden';

  backdrop.hidden = false;
  void backdrop.offsetWidth; // force reflow so the opacity transition runs
  backdrop.classList.add('visible');

  sheetEl.hidden = false;
  sheetEl.classList.remove('closing', 'open');
  void sheetEl.offsetWidth; // force reflow so the slide-up transition runs
  sheetEl.classList.add('open');
}

function closeSheet(sheetEl) {
  sheetEl.classList.remove('open');
  sheetEl.classList.add('closing');
  backdrop.classList.remove('visible');
  document.body.style.overflow = '';
  setTimeout(() => {
    sheetEl.hidden = true;
    sheetEl.classList.remove('closing');
    if (ALL_SHEETS.every((s) => s.hidden)) backdrop.hidden = true;
  }, 380);
}

function wireSwipeToClose(handleEl, sheetEl, onClose) {
  let startY = 0;
  let currentY = 0;
  let dragging = false;

  const onStart = (y) => { dragging = true; startY = y; currentY = y; sheetEl.style.transition = 'none'; };
  const onMove = (y) => {
    if (!dragging) return;
    currentY = y;
    const delta = Math.max(0, currentY - startY);
    sheetEl.style.transform = `translateY(${delta}px)`;
  };
  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    sheetEl.style.transition = '';
    const delta = currentY - startY;
    sheetEl.style.transform = '';
    if (delta > 90) onClose();
  };

  handleEl.addEventListener('touchstart', (e) => onStart(e.touches[0].clientY), { passive: true });
  handleEl.addEventListener('touchmove', (e) => onMove(e.touches[0].clientY), { passive: true });
  handleEl.addEventListener('touchend', onEnd);

  handleEl.addEventListener('mousedown', (e) => {
    onStart(e.clientY);
    const move = (ev) => onMove(ev.clientY);
    const up = () => { onEnd(); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

backdrop.addEventListener('click', () => {
  if (!entrySheet.hidden) closeSheet(entrySheet);
  if (!menuSheet.hidden) closeSheet(menuSheet);
  if (!detailSheet.hidden) closeDetailCard();
});

wireSwipeToClose($('#sheetHandle'), entrySheet, () => closeSheet(entrySheet));
wireSwipeToClose($('#menuHandle'), menuSheet, () => closeSheet(menuSheet));

/* ---------------------------------------------------------------------- */
/*  Entry form                                                             */
/* ---------------------------------------------------------------------- */

const form = $('#entryForm');
const f_title = $('#f_title');
const f_type = $('#f_type');
const f_season_field = $('#f_season_field');
const f_season = $('#f_season');
const f_progress_row = $('#f_progress_row');
const f_progress = $('#f_progress');
const f_total = $('#f_total');
const f_progress_label = $('#f_progress_label');
const f_total_label = $('#f_total_label');
const f_status = $('#f_status');
const f_rating = $('#f_rating');
const f_rating_val = $('#f_rating_val');
const f_notes = $('#f_notes');
const f_notesField = $('#f_notesField');
const f_richNotesField = $('#f_richNotesField');
const f_richNotes = $('#f_richNotes');
const richToolbar = $('#richToolbar');
const f_tagInput = $('#f_tagInput');
const tagChips = $('#tagChips');
const deleteEntryBtn = $('#deleteEntryBtn');
const coverImg = $('#coverImg');
const coverInitial = $('#coverInitial');
const coverClearBtn = $('#coverClearBtn');
const coverPicker = $('#coverPicker');
const imdbImportRow = $('#imdbImportRow');

function updateUnitLabels() {
  const type = f_type.value;
  const unit = UNIT_BY_TYPE[type] || 'progress';
  const isSeasonType = type === 'anime' || type === 'series';
  const isListType = type === 'list';
  const supportsImdbImport = type === 'anime' || type === 'series' || type === 'movie';

  f_season_field.style.display = isSeasonType ? '' : 'none';
  f_progress_row.style.display = isListType ? 'none' : '';
  coverPicker.style.display = isListType ? 'none' : '';
  imdbImportRow.style.display = supportsImdbImport ? '' : 'none';
  imdbImportRow.style.display = isListType ? 'none' : '';
  if (isListType) {
    coverLinkRow.hidden = true;
    setCoverPreview(null);
  }

  // Pure show/hide only — no content is touched here. Migrating text
  // between the plain textarea and the rich editor only happens when the
  // person actually changes the Type dropdown themselves (see the
  // 'change' listener below), never as a side effect of this function
  // running again with the type unchanged.
  f_notesField.hidden = isListType;
  f_richNotesField.hidden = !isListType;

  if (unit === 'watch') {
    f_progress_label.textContent = 'Watched';
    f_total_label.textContent = 'Total (optional)';
  } else {
    const label = unit[0].toUpperCase() + unit.slice(1);
    f_progress_label.textContent = label + ' progress';
    f_total_label.textContent = `Total ${unit} (optional)`;
  }
}
f_type.addEventListener('change', () => {
  // Switching the Type dropdown mid-edit shouldn't drop whatever notes are
  // already typed — carry them over to the other editor as plain text.
  const isListType = f_type.value === 'list';
  const wasListType = !f_richNotesField.hidden;
  if (isListType && !wasListType) {
    f_richNotes.textContent = f_notes.value.trim();
    f_notes.value = '';
  } else if (!isListType && wasListType) {
    f_notes.value = f_richNotes.innerText.trim();
    f_richNotes.innerHTML = '';
  }
  updateUnitLabels();
});

f_rating.addEventListener('input', () => {
  f_rating_val.textContent = f_rating.value === '0' ? '—' : f_rating.value;
});

function renderTagChips() {
  tagChips.innerHTML = '';
  state.draftTags.forEach((tag, idx) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `${escapeHtml(tag)} <button type="button" aria-label="Remove tag">×</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      state.draftTags.splice(idx, 1);
      renderTagChips();
    });
    tagChips.appendChild(chip);
  });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/* ---- Rich note sanitizer (List-type entries) ----
   The rich text note editor below stores its content as an HTML string in
   the same `notes` field plain-text notes use. That HTML can also arrive
   from a JSON backup import, which is a hand-editable file — so before it
   is ever written into innerHTML (in the editor, the detail view, or a
   card preview) it's run through this small allow-list sanitizer instead
   of being trusted as-is. Only a few formatting tags survive, and the
   only attribute kept is a `font-size` style on <span>. */
const RICH_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'DIV', 'P', 'SPAN', 'UL', 'OL', 'LI']);
const RICH_DROP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META',
  'IMG', 'SVG', 'FORM', 'INPUT', 'BUTTON', 'VIDEO', 'AUDIO', 'SOURCE', 'TEMPLATE',
]);

function sanitizeRichHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  const root = doc.body.firstChild;

  function clean(node) {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) return;
      if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); return; }

      if (RICH_DROP_TAGS.has(child.tagName)) {
        child.remove();
        return;
      }

      // Recurse before deciding whether to keep this node, so a disallowed
      // tag nested inside another disallowed tag is still cleaned up once
      // both layers get unwrapped.
      clean(child);

      if (!RICH_TAGS.has(child.tagName)) {
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        node.removeChild(child);
        return;
      }

      [...child.attributes].forEach((attr) => {
        if (child.tagName === 'SPAN' && attr.name === 'style') {
          const match = /font-size:\s*(\d+(?:\.\d+)?)(px|pt|em|rem)/i.exec(attr.value);
          if (match) child.setAttribute('style', `font-size:${match[1]}${match[2]}`);
          else child.removeAttribute('style');
        } else {
          child.removeAttribute(attr.name);
        }
      });
    });
  }

  clean(root);
  return root.innerHTML;
}

function richNotesToPlainText(html) {
  const div = document.createElement('div');
  div.innerHTML = sanitizeRichHtml(html);
  return (div.textContent || '').replace(/\s+/g, ' ').trim();
}

/* ---- Rich note toolbar (Bold / Italic / Underline / size / bullets) ---- */
const RICH_FONT_SIZE_PX = { 2: '12px', 3: '15px', 5: '20px' };

function applyRichFontSize(execSize) {
  document.execCommand('fontSize', false, execSize);
  // execCommand('fontSize') only knows how to wrap the selection in a
  // legacy <font size="N">, so immediately swap any of those out for a
  // <span style="font-size:...">, which is all the sanitizer keeps anyway.
  f_richNotes.querySelectorAll('font[size]').forEach((font) => {
    const span = document.createElement('span');
    const px = RICH_FONT_SIZE_PX[font.getAttribute('size')];
    if (px) span.style.fontSize = px;
    while (font.firstChild) span.appendChild(font.firstChild);
    font.replaceWith(span);
  });
}

function isRichCmdActive(cmd) {
  try {
    return document.queryCommandState(cmd);
  } catch {
    return false;
  }
}

function updateRichToolbarState() {
  ['bold', 'italic', 'underline', 'insertUnorderedList'].forEach((cmd) => {
    const btn = richToolbar.querySelector(`[data-cmd="${cmd}"]`);
    if (btn) btn.classList.toggle('active', isRichCmdActive(cmd));
  });
}

richToolbar.addEventListener('mousedown', (e) => {
  // Without this, clicking a toolbar button first steals focus away from
  // the editor, which collapses the text selection before execCommand
  // gets a chance to use it.
  if (e.target.closest('.rich-btn')) e.preventDefault();
});

richToolbar.addEventListener('click', (e) => {
  const btn = e.target.closest('.rich-btn');
  if (!btn) return;
  f_richNotes.focus();
  if (btn.dataset.size) {
    applyRichFontSize(btn.dataset.size);
  } else if (btn.dataset.cmd) {
    document.execCommand(btn.dataset.cmd, false, null);
  }
  updateRichToolbarState();
});

f_richNotes.addEventListener('keyup', updateRichToolbarState);
f_richNotes.addEventListener('mouseup', updateRichToolbarState);
f_richNotes.addEventListener('focus', updateRichToolbarState);

f_tagInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const val = f_tagInput.value.trim();
    if (val && !state.draftTags.includes(val)) {
      state.draftTags.push(val);
      renderTagChips();
    }
    f_tagInput.value = '';
  }
});

function setCoverPreview(dataUrl, titleForInitial) {
  state.draftCover = dataUrl || null;
  if (dataUrl) {
    coverImg.src = dataUrl;
    coverImg.hidden = false;
    coverInitial.hidden = true;
    coverClearBtn.hidden = false;
  } else {
    coverImg.hidden = true;
    coverImg.src = '';
    coverInitial.hidden = false;
    coverInitial.textContent = initials(titleForInitial || f_title.value || '+');
    coverClearBtn.hidden = true;
  }
}

$('#coverClearBtn').addEventListener('click', () => setCoverPreview(null));

// Fall back to the initial-letter placeholder if a linked image fails to
// load (broken URL, offline, host down, etc.) instead of showing a blank box.
coverImg.addEventListener('error', () => {
  if (!coverImg.hidden) {
    showToast("Couldn't load that image link");
    setCoverPreview(null);
  }
});

/* ---- Cover from a web link ---- */
const coverLinkRow = $('#coverLinkRow');
const coverLinkInput = $('#coverLinkInput');

$('#coverLinkBtn').addEventListener('click', () => {
  coverLinkRow.hidden = !coverLinkRow.hidden;
  if (!coverLinkRow.hidden) {
    coverLinkInput.value = state.draftCover && /^https?:\/\//i.test(state.draftCover) ? state.draftCover : '';
    coverLinkInput.focus();
  }
});

function useCoverLink() {
  const url = coverLinkInput.value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) {
    showToast('Enter a full image URL, starting with http(s)://');
    return;
  }
  setCoverPreview(url);
  coverLinkRow.hidden = true;
}

$('#coverLinkUseBtn').addEventListener('click', useCoverLink);
coverLinkInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); useCoverLink(); }
});

/* ---- Import title + cover from an IMDb link (via TMDB's find-by-id API) ---- */
const imdbLinkInput = $('#imdbLinkInput');
const imdbFetchBtn = $('#imdbFetchBtn');

function extractImdbId(text) {
  const match = text.match(/tt\d{5,10}/);
  return match ? match[0] : null;
}

// Plain fetch() has no timeout — on a blocked/dropped connection (firewall,
// ad-blocker, flaky carrier network) it can just hang forever with no error.
// Force it to fail loudly instead.
function fetchWithTimeout(url, opts, ms = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// TMDB's settings page hands out two different credentials: a short
// "API Key (v3 auth)" (~32 chars) and a long "API Read Access Token
// (v4 auth)" JWT (100+ chars). Both are valid, but they're sent
// differently — detect which one was pasted so either works, and build
// a ready-to-fetch [url, opts] pair for any TMDB path + query params.
function tmdbRequest(path, params = {}) {
  const apiKey = settings.tmdbApiKey;
  const isReadAccessToken = apiKey.length > 60;
  const qs = new URLSearchParams(params);
  if (!isReadAccessToken) qs.set('api_key', apiKey);
  const query = qs.toString();
  const url = `https://api.themoviedb.org/3${path}${query ? `?${query}` : ''}`;
  const opts = isReadAccessToken
    ? { headers: { Authorization: `Bearer ${apiKey}`, accept: 'application/json' } }
    : undefined;
  return [url, opts];
}

// Merge freshly-fetched genre names into the notes textarea as a single
// "Genres: ..." line, replacing any previous genre line from an earlier
// import but leaving the rest of whatever notes are already there intact.
function applyGenresToNotes(genreNames) {
  if (!genreNames.length) return;
  const genreLine = `Genres: ${genreNames.join(', ')}`;
  const existingLines = f_notes.value.split('\n');
  const genreLineIndex = existingLines.findIndex((l) => l.trim().startsWith('Genres:'));

  if (genreLineIndex !== -1) {
    existingLines[genreLineIndex] = genreLine;
    f_notes.value = existingLines.join('\n');
  } else if (f_notes.value.trim()) {
    f_notes.value = `${genreLine}\n${f_notes.value}`;
  } else {
    f_notes.value = genreLine;
  }
}

// Applies a TMDB search/find result to the (already open) entry form: title,
// type, cover art (embedded locally when possible), and a best-effort
// "Genres: ..." notes line. Shared by the IMDb-link import below and the
// Home page's title search. `mediaType` is 'movie' or 'tv'.
async function importTmdbHit(hit, mediaType) {
  const title = hit.title || hit.name || '';
  if (title) f_title.value = title;

  f_type.value = mediaType === 'movie' ? 'movie' : 'series';
  updateUnitLabels();
  syncThemedSelect(f_type);
  state.draftTmdbId = hit.id != null ? String(hit.id) : null;

  if (hit.poster_path) {
    const posterUrl = `https://image.tmdb.org/t/p/w500${hit.poster_path}`;
    try {
      const imgRes = await fetchWithTimeout(posterUrl, undefined, 12000);
      if (!imgRes.ok) throw new Error('bad_image');
      const blob = await imgRes.blob();
      const dataUrl = await optimizeCoverImage(blob).catch(() => blobToDataUrl(blob));
      setCoverPreview(dataUrl, title);
    } catch {
      // Still works even if we can't embed the image locally — it'll just
      // load live from TMDB instead of being cached offline.
      setCoverPreview(posterUrl, title);
    }
  }

  // Genre names aren't in the /find or /search response (only numeric
  // genre_ids), so pull them from the movie/tv details endpoint and drop
  // them into notes. Best-effort: if it fails, the rest of the import
  // above has already succeeded, so we just skip it quietly.
  try {
    const detailsPath = mediaType === 'movie' ? `/movie/${hit.id}` : `/tv/${hit.id}`;
    const [detailsUrl, detailsOpts] = tmdbRequest(detailsPath);
    const detailsRes = await fetchWithTimeout(detailsUrl, detailsOpts, 12000);
    if (detailsRes.ok) {
      const details = await detailsRes.json();
      const genres = details.genres || [];
      applyGenresToNotes(genres.map((g) => g.name).filter(Boolean));
      state.draftGenreIds = genres.map((g) => g.id).filter((id) => id != null);
    }
  } catch (err) {
    console.error('TMDB genre fetch failed:', err);
  }
}

async function fetchImdbImport() {
  const raw = imdbLinkInput.value.trim();
  const imdbId = extractImdbId(raw);
  if (!imdbId) {
    showToast('Paste a full IMDb link, e.g. imdb.com/title/tt1234567');
    return;
  }

  const apiKey = settings.tmdbApiKey;
  if (!apiKey) {
    showToast('Add a free TMDB API key in Settings first');
    return;
  }

  const [url, fetchOpts] = tmdbRequest(`/find/${imdbId}`, { external_source: 'imdb_id' });

  const originalLabel = imdbFetchBtn.textContent;
  imdbFetchBtn.disabled = true;
  imdbFetchBtn.textContent = 'Fetching…';

  try {
    const res = await fetchWithTimeout(url, fetchOpts);

    if (res.status === 401) {
      showToast('TMDB rejected that API key — double check it in Settings');
      return;
    }
    if (!res.ok) {
      showToast(`TMDB error (${res.status}) — try again shortly`);
      console.error('TMDB find request failed:', res.status, await res.text().catch(() => ''));
      return;
    }

    const data = await res.json();
    const movie = data.movie_results && data.movie_results[0];
    const tv = data.tv_results && data.tv_results[0];
    const hit = movie || tv;

    if (!hit) {
      showToast("Couldn't find that title on TMDB");
      return;
    }

    await importTmdbHit(hit, movie ? 'movie' : 'tv');
    showToast('Imported from TMDB');
  } catch (err) {
    if (err.name === 'AbortError') {
      showToast('TMDB took too long to respond — check your connection and try again');
    } else {
      showToast("Couldn't reach TMDB — check your connection");
    }
    console.error('TMDB import failed:', err);
  } finally {
    imdbFetchBtn.disabled = false;
    imdbFetchBtn.textContent = originalLabel;
  }
}

imdbFetchBtn.addEventListener('click', fetchImdbImport);
imdbLinkInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); fetchImdbImport(); }
});

// Opens a fresh entry sheet pre-filled from a Home page search result.
async function openEntrySheetFromSearch(hit, mediaType) {
  openEntrySheet(null);
  showToast('Importing from TMDB…');
  try {
    await importTmdbHit(hit, mediaType);
    showToast('Imported — review and save');
  } catch (err) {
    console.error('TMDB import failed:', err);
    showToast("Couldn't reach TMDB — check your connection");
  }
}

/* ---- Cover from clipboard ---- */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/* ---- Cover image optimization ----
   Every locally-embedded cover (camera/gallery photo, pasted image, TMDB
   poster fetched to embed offline) gets run through here before it's
   stored: center-cropped to a 2:3 poster ratio so covers of any original
   shape fill the (now taller) card frame consistently instead of being
   stretched or letterboxed, then downscaled and re-encoded as JPEG so a
   multi-megabyte phone photo doesn't bloat localStorage. `source` can be
   a Blob or an existing data: URL string. Remote "From link" covers are
   left untouched — cross-origin canvas reads would just throw anyway,
   and object-fit: cover on the card already keeps their aspect ratio
   consistent visually regardless of the source image's real dimensions. */
const COVER_TARGET_WIDTH = 480;
const COVER_ASPECT = 2 / 3; // width / height

function optimizeCoverImage(source, { maxWidth = COVER_TARGET_WIDTH, aspect = COVER_ASPECT, quality = 0.85 } = {}) {
  return new Promise((resolve, reject) => {
    const isBlob = source instanceof Blob;
    const objectUrl = isBlob ? URL.createObjectURL(source) : null;
    const cleanup = () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };

    const img = new Image();
    img.onload = () => {
      try {
        const srcW = img.naturalWidth;
        const srcH = img.naturalHeight;
        if (!srcW || !srcH) throw new Error('bad_dimensions');

        // Center-crop horizontally, but bias vertical cropping toward the
        // top (matching the CSS object-position on the card grid) — most
        // photos/posters keep their important content in the upper part
        // of the frame, and this now crops a fair bit off a taller source.
        let cropW = srcW;
        let cropH = srcW / aspect;
        let sx = 0;
        let sy = 0;
        if (cropH > srcH) {
          cropH = srcH;
          cropW = srcH * aspect;
          sx = (srcW - cropW) / 2;
        } else {
          sy = (srcH - cropH) * 0.2;
        }
        const outW = Math.round(Math.min(maxWidth, cropW));
        const outH = Math.round(outW / aspect);

        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, outW, outH);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (err) {
        reject(err);
      } finally {
        cleanup();
      }
    };
    img.onerror = () => { cleanup(); reject(new Error('image_decode_failed')); };
    img.src = isBlob ? objectUrl : source;
  });
}

async function useClipboardImage(clipboardItems) {
  for (const item of clipboardItems) {
    const type = item.types ? item.types.find((t) => t.startsWith('image/')) : item.type;
    if (!type || !type.startsWith('image/')) continue;
    const blob = item.getType ? await item.getType(type) : item.getAsFile();
    if (!blob) continue;
    const dataUrl = await optimizeCoverImage(blob).catch(() => blobToDataUrl(blob));
    setCoverPreview(dataUrl);
    return true;
  }
  return false;
}

$('#coverPasteBtn').addEventListener('click', async () => {
  if (f_type.value === 'list') return;
  if (!navigator.clipboard || !navigator.clipboard.read) {
    showToast('Press Ctrl+V (or Cmd+V) anywhere in this form to paste an image');
    return;
  }
  try {
    const items = await navigator.clipboard.read();
    const found = await useClipboardImage(items);
    if (!found) showToast('No image found on the clipboard');
  } catch (err) {
    showToast('Could not read the clipboard — try Ctrl+V instead');
  }
});

// Lets you paste an image straight into the sheet (Ctrl/Cmd+V) without
// touching the "Paste image" button — works wherever the browser fires a
// native clipboard paste event.
entrySheet.addEventListener('paste', async (e) => {
  if (f_type.value === 'list') return;
  const items = e.clipboardData && e.clipboardData.items;
  if (!items || !items.length) return;
  const found = await useClipboardImage(Array.from(items));
  if (found) e.preventDefault();
});

/* ---- Cover picker: official @capacitor/camera plugin ---- */
$('#coverPickBtn').addEventListener('click', async () => {
  try {
    const photo = await Camera.getPhoto({
      quality: 70,
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Prompt,
      promptLabelHeader: 'Cover image',
      promptLabelPhoto: 'Choose from gallery',
      promptLabelPicture: 'Take photo',
      width: 600,
    });
    if (photo?.dataUrl) {
      const dataUrl = await optimizeCoverImage(photo.dataUrl).catch(() => photo.dataUrl);
      setCoverPreview(dataUrl);
    }
  } catch (err) {
    // User cancelled, or running in a plain browser without native camera support.
    if (!window.Capacitor?.isNativePlatform?.()) {
      fallbackFilePick();
    }
  }
});

function fallbackFilePick() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      setCoverPreview(await optimizeCoverImage(file));
    } catch {
      const reader = new FileReader();
      reader.onload = () => setCoverPreview(reader.result);
      reader.readAsDataURL(file);
    }
  };
  input.click();
}

function resetForm() {
  form.reset();
  state.draftTags = [];
  state.editingId = null;
  state.draftTmdbId = null;
  state.draftGenreIds = [];
  imdbLinkInput.value = '';
  coverLinkRow.hidden = true;
  coverLinkInput.value = '';
  setCoverPreview(null);
  // form.reset() only touches native form controls, not the contenteditable
  // rich note editor, so it needs clearing by hand.
  f_richNotes.innerHTML = '';
  f_rating.value = 0;
  f_rating_val.textContent = '—';
  renderTagChips();
  updateUnitLabels();
  syncThemedSelect(f_type);
  syncThemedSelect(f_status);
  deleteEntryBtn.hidden = true;
  $('#sheetTitle').textContent = 'New entry';
}

function openEntrySheet(id) {
  resetForm();
  if (id) {
    const e = entries.find((x) => x.id === id);
    if (e) {
      state.editingId = id;
      f_title.value = e.title;
      f_type.value = e.type;
      f_season.value = e.season || '';
      f_progress.value = e.progress ?? 0;
      f_total.value = e.total ?? '';
      f_status.value = e.status;
      f_rating.value = e.rating || 0;
      f_rating_val.textContent = e.rating ? e.rating : '—';
      if (e.type === 'list') {
        f_notes.value = '';
        f_richNotes.innerHTML = sanitizeRichHtml(e.notes || '');
      } else {
        f_notes.value = e.notes || '';
        f_richNotes.innerHTML = '';
      }
      state.draftTags = [...(e.tags || [])];
      state.draftTmdbId = e.tmdbId || null;
      state.draftGenreIds = e.genreIds || [];
      setCoverPreview(e.cover || null, e.title);
      renderTagChips();
      updateUnitLabels();
      syncThemedSelect(f_type);
      syncThemedSelect(f_status);
      deleteEntryBtn.hidden = false;
      $('#sheetTitle').textContent = 'Edit entry';
    }
  }
  openSheet(entrySheet);
}

$('#fabAdd').addEventListener('click', () => openEntrySheet(null));
$('#fabTab').addEventListener('click', () => openEntrySheet(null));
$('#sheetClose').addEventListener('click', () => closeSheet(entrySheet));

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const title = f_title.value.trim();
  if (!title) return;

  // List-type entries store the rich editor's HTML (sanitized on the way
  // in); everything else keeps plain-text notes as before. richTextEmpty
  // guards against contenteditable's habit of leaving a stray <br> behind
  // in an editor the person never actually typed into.
  const richTextEmpty = f_richNotes.textContent.trim() === '';
  const notes = f_type.value === 'list'
    ? (richTextEmpty ? '' : sanitizeRichHtml(f_richNotes.innerHTML).trim())
    : f_notes.value.trim();

  const payload = {
    title,
    type: f_type.value,
    season: (f_type.value === 'anime' || f_type.value === 'series') ? f_season.value.trim() : '',
    progress: Number(f_progress.value) || 0,
    total: f_total.value === '' ? null : Number(f_total.value),
    status: f_status.value,
    rating: Number(f_rating.value) || 0,
    notes,
    tags: state.draftTags.slice(),
    cover: state.draftCover,
    tmdbId: state.draftTmdbId,
    genreIds: state.draftGenreIds.slice(),
    updatedAt: Date.now(),
  };

  if (state.editingId) {
    const idx = entries.findIndex((x) => x.id === state.editingId);
    if (idx >= 0) entries[idx] = { ...entries[idx], ...payload };
  } else {
    entries.push({ id: crypto.randomUUID(), createdAt: Date.now(), ...payload });
  }

  saveEntries(entries);
  render();
  if (currentPage === 'home') renderHome();
  closeSheet(entrySheet);
  showToast(state.editingId ? 'Entry updated' : 'Entry added');
});

deleteEntryBtn.addEventListener('click', () => {
  if (!state.editingId) return;
  if (!confirm('Delete this entry? This cannot be undone.')) return;
  entries = entries.filter((x) => x.id !== state.editingId);
  saveEntries(entries);
  render();
  if (currentPage === 'home') renderHome();
  closeSheet(entrySheet);
  showToast('Entry deleted');
});

/* ---------------------------------------------------------------------- */
/*  Menu / settings sheet                                                  */
/* ---------------------------------------------------------------------- */

const THEME_PRESETS = {
  default: { '--c-bg': '', '--c-surface': '', '--c-accent': '', '--c-text': '' },
  blood:    { '--c-bg': '#0a0000', '--c-surface': '#1a0707', '--c-accent': '#ff1a1a', '--c-text': '#ffecec' },
  midnight: { '--c-bg': '#00030a', '--c-surface': '#0a1428', '--c-accent': '#3d7fff', '--c-text': '#eaf1ff' },
  forest:   { '--c-bg': '#020a04', '--c-surface': '#0d1f10', '--c-accent': '#2fbf5a', '--c-text': '#eafff0' },
  sunset:   { '--c-bg': '#0a0500', '--c-surface': '#241006', '--c-accent': '#ff8a1e', '--c-text': '#fff2e4' },
  mono:     { '--c-bg': '#000000', '--c-surface': '#161616', '--c-accent': '#e6e6e6', '--c-text': '#ffffff' },
};

function detectPreset() {
  const t = settings.theme;
  for (const [name, vals] of Object.entries(THEME_PRESETS)) {
    if (Object.keys(vals).every((k) => (t[k] || '') === (vals[k] || ''))) return name;
  }
  return 'custom';
}

function applyThemePreset(name) {
  const preset = THEME_PRESETS[name];
  if (!preset) return;
  settings.theme = { ...preset };
  saveSettings(settings);
  applySettings();
}

$('#themePreset').addEventListener('change', (e) => applyThemePreset(e.target.value));

$('#menuClose').addEventListener('click', () => closeSheet(menuSheet));

/* ---- TMDB API key (used for the IMDb-link import below) ---- */
const tmdbApiKeyInput = $('#tmdbApiKeyInput');
tmdbApiKeyInput.value = settings.tmdbApiKey || '';
tmdbApiKeyInput.addEventListener('change', () => {
  settings.tmdbApiKey = tmdbApiKeyInput.value.trim();
  saveSettings(settings);
});

$('#fontSizeSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  settings.fontSize = btn.dataset.val;
  saveSettings(settings);
  applySettings();
});

$('#tileSizeSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  settings.tileSize = btn.dataset.val;
  saveSettings(settings);
  applySettings();
});

function isValidHex(v) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());
}

document.querySelectorAll('.hex-input').forEach((input) => {
  input.addEventListener('change', () => {
    const key = input.dataset.var;
    const val = input.value.trim();
    if (val === '') {
      settings.theme[key] = '';
    } else if (isValidHex(val)) {
      settings.theme[key] = val;
    } else {
      showToast('Enter a valid hex color, e.g. #e60000');
      return;
    }
    saveSettings(settings);
    applySettings();
    $('#themePreset').value = detectPreset();
  });
});

document.querySelectorAll('.color-swatch').forEach((input) => {
  input.addEventListener('input', () => {
    const key = input.dataset.var;
    settings.theme[key] = input.value;
    saveSettings(settings);
    applySettings();
    $('#themePreset').value = detectPreset();
  });
});

$('#resetThemeBtn').addEventListener('click', () => {
  applyThemePreset('default');
  showToast('Theme reset to default');
});

/* ---- Re-optimize covers saved before optimizeCoverImage existed ---- */
$('#optimizeCoversBtn').addEventListener('click', async () => {
  const btn = $('#optimizeCoversBtn');
  // Only locally-embedded covers (data: URLs) can be reprocessed — a
  // "From link" cover is a live remote URL with nothing stored locally to
  // shrink, and re-fetching it here would need CORS the source may not
  // grant, so those are left as they are.
  const targets = entries.filter((e) => e.cover && e.cover.startsWith('data:'));
  if (!targets.length) {
    showToast('No locally-saved covers to optimize');
    return;
  }

  const originalLabel = btn.textContent;
  btn.disabled = true;
  let done = 0;
  let changed = 0;

  for (const e of targets) {
    btn.textContent = `Optimizing… ${done + 1}/${targets.length}`;
    try {
      e.cover = await optimizeCoverImage(e.cover);
      changed++;
    } catch {
      // Leave this one as-is and move on — a single undecodable image
      // shouldn't stop the rest of the library from being processed.
    }
    done++;
  }

  saveEntries(entries);
  render();
  btn.disabled = false;
  btn.textContent = originalLabel;
  showToast(changed ? `Optimized ${changed} cover${changed === 1 ? '' : 's'}` : "Couldn't optimize any covers");
});

/* ---- Export / Import ---- */

$('#exportBtn').addEventListener('click', async () => {
  const payload = { app: 'trackia', version: 1, exportedAt: new Date().toISOString(), entries };
  const json = JSON.stringify(payload, null, 2);
  const filename = `trackia-backup-${new Date().toISOString().slice(0, 10)}.json`;

  if (window.Capacitor?.isNativePlatform?.()) {
    // Inside the Android WebView, the <a download> + blob-URL trick doesn't
    // reliably save anywhere visible — there's no real "Downloads" folder
    // exposed to it. Write the file with Filesystem instead, then hand it
    // off through the native Share sheet so the user picks where it goes
    // (Files, Drive, email, etc.) without needing storage permissions.
    try {
      const written = await Filesystem.writeFile({
        path: filename,
        data: json,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
      await Share.share({
        title: 'Trackia backup',
        text: 'Trackia library backup',
        url: written.uri,
        dialogTitle: 'Save or send your Trackia backup',
      });
      showToast('Backup ready to save');
    } catch (err) {
      if (err?.message?.toLowerCase().includes('cancel')) return; // user dismissed the share sheet
      showToast('Could not prepare the backup file');
    }
    return;
  }

  // Plain browser: normal blob download.
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('Backup downloaded');
});

$('#importBtn').addEventListener('click', () => $('#importFile').click());

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const incoming = Array.isArray(data) ? data : data.entries;
    if (!Array.isArray(incoming)) throw new Error('Invalid file');

    const existingIds = new Set(entries.map((x) => x.id));
    let added = 0;
    incoming.forEach((raw) => {
      const id = raw.id && !existingIds.has(raw.id) ? raw.id : crypto.randomUUID();
      existingIds.add(id);
      entries.push({
        id,
        title: raw.title || 'Untitled',
        type: TYPE_LABEL[raw.type] ? raw.type : 'anime',
        season: raw.season || '',
        progress: Number(raw.progress) || 0,
        total: raw.total == null ? null : Number(raw.total),
        status: STATUS_LABEL[raw.status] ? raw.status : 'plan',
        rating: Number(raw.rating) || 0,
        notes: raw.notes || '',
        tags: Array.isArray(raw.tags) ? raw.tags : [],
        cover: raw.cover || null,
        tmdbId: raw.tmdbId || null,
        genreIds: Array.isArray(raw.genreIds) ? raw.genreIds : [],
        createdAt: raw.createdAt || Date.now(),
        updatedAt: raw.updatedAt || Date.now(),
      });
      added++;
    });

    saveEntries(entries);
    render();
    if (currentPage === 'home') renderHome();
    showToast(`Imported ${added} entr${added === 1 ? 'y' : 'ies'}`);
  } catch (err) {
    showToast('Could not read that file');
  } finally {
    e.target.value = '';
  }
});

/* ---------------------------------------------------------------------- */
/*  Search / filters                                                       */
/* ---------------------------------------------------------------------- */

$('#searchToggle').addEventListener('click', () => {
  const bar = $('#searchBar');
  bar.hidden = !bar.hidden;
  if (!bar.hidden) $('#searchInput').focus();
  else { state.search = ''; $('#searchInput').value = ''; render(); }
});

$('#searchInput').addEventListener('input', (e) => {
  state.search = e.target.value;
  render();
});

function setTypeFilter(type) {
  const btn = document.querySelector(`.type-tab[data-type="${type}"]`);
  if (!btn) return;
  state.typeFilter = type;
  document.querySelectorAll('.type-tab').forEach((b) => b.classList.toggle('active', b === btn));
  btn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  render();
}

$('#typeTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.type-tab');
  if (!btn) return;
  setTypeFilter(btn.dataset.type);
});

/* ---- Swipe left/right on the card grid to switch type tabs ---- */
function wireSwipeTabs(el) {
  let startX = 0;
  let startY = 0;
  let tracking = false;

  const SWIPE_THRESHOLD = 60; // px of horizontal travel needed to count as a swipe

  el.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    tracking = true;
    startX = t.clientX;
    startY = t.clientY;
  }, { passive: true });

  el.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;

    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    // Require the gesture to be mostly horizontal so a vertical scroll of
    // the grid is never mistaken for a tab swipe.
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;

    const tabs = Array.from(document.querySelectorAll('.type-tab'));
    const currentIndex = tabs.findIndex((b) => b.dataset.type === state.typeFilter);
    if (currentIndex === -1) return;
    // Swipe left (dx < 0) moves forward to the next tab; swipe right moves
    // back — clamped at the ends rather than wrapping around.
    const nextIndex = dx < 0
      ? Math.min(tabs.length - 1, currentIndex + 1)
      : Math.max(0, currentIndex - 1);
    if (nextIndex === currentIndex) return;

    // A recognized swipe shouldn't also fire a click on whatever card was
    // under the finger at release — that would pop open its detail sheet
    // right after the tab switch.
    e.preventDefault();
    setTypeFilter(tabs[nextIndex].dataset.type);
  });
}

wireSwipeTabs(grid);
wireSwipeTabs(emptyState);

$('#statusFilter').addEventListener('change', (e) => { state.statusFilter = e.target.value; render(); });
$('#sortSelect').addEventListener('change', (e) => { state.sort = e.target.value; render(); });

/* ---------------------------------------------------------------------- */
/*  Toast                                                                  */
/* ---------------------------------------------------------------------- */

let toastTimer = null;
let toastHideTimer = null;
function showToast(msg) {
  const el = $('#toast');
  clearTimeout(toastTimer);
  clearTimeout(toastHideTimer);
  el.textContent = msg;
  el.hidden = false;
  void el.offsetWidth; // force reflow so the fade-in transition runs
  el.classList.add('visible');
  toastTimer = setTimeout(() => {
    el.classList.remove('visible');
    toastHideTimer = setTimeout(() => { el.hidden = true; }, 300);
  }, 2200);
}

/* ---------------------------------------------------------------------- */
/*  Boot                                                                   */
/* ---------------------------------------------------------------------- */

// Hide the top-bar logo slot if src/assets/logo.png is a placeholder/blank
// (0x0 natural size) or fails to load, so the text-only wordmark shows instead.
const brandLogo = document.getElementById('brandLogo');
if (brandLogo) {
  brandLogo.addEventListener('error', () => { brandLogo.hidden = true; });
  brandLogo.addEventListener('load', () => {
    if (brandLogo.naturalWidth < 2) brandLogo.hidden = true;
  });
}

initThemedSelects();
applySettings();
updateUnitLabels();
render();
showPage('home');
