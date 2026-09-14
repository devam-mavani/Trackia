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

/** List-type entries render as a plain full-width title strip instead of a
 *  cover card — no cover art, no progress bar, just the title and a bit of
 *  status/rating/tag context on one line. */
function renderListItem(e) {
  const row = document.createElement('article');
  row.className = 'card list-item';
  row.dataset.id = e.id;

  const title = document.createElement('h3');
  title.className = 'list-item-title';
  title.textContent = e.title;
  row.appendChild(title);

  if (e.tags && e.tags.length) {
    const tagRow = document.createElement('div');
    tagRow.className = 'list-item-tags';
    e.tags.slice(0, 3).forEach((t) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = t;
      tagRow.appendChild(chip);
    });
    row.appendChild(tagRow);
  }

  const meta = document.createElement('div');
  meta.className = 'list-item-meta';
  if (e.rating) {
    const rating = document.createElement('span');
    rating.className = 'badge badge-rating';
    rating.textContent = `★ ${e.rating}`;
    meta.appendChild(rating);
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
}

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
    detailNotes.textContent = e.notes;
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

  if (unit === 'watch') {
    f_progress_label.textContent = 'Watched';
    f_total_label.textContent = 'Total (optional)';
  } else {
    const label = unit[0].toUpperCase() + unit.slice(1);
    f_progress_label.textContent = label + ' progress';
    f_total_label.textContent = `Total ${unit} (optional)`;
  }
}
f_type.addEventListener('change', updateUnitLabels);

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

  // TMDB's settings page hands out two different credentials: a short
  // "API Key (v3 auth)" (~32 chars) and a long "API Read Access Token
  // (v4 auth)" JWT (100+ chars). Both are valid, but they're sent
  // differently — detect which one was pasted so either works.
  const isReadAccessToken = apiKey.length > 60;
  const url = isReadAccessToken
    ? `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id`
    : `https://api.themoviedb.org/3/find/${imdbId}?api_key=${encodeURIComponent(apiKey)}&external_source=imdb_id`;
  const fetchOpts = isReadAccessToken
    ? { headers: { Authorization: `Bearer ${apiKey}`, accept: 'application/json' } }
    : undefined;

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

    const title = hit.title || hit.name || '';
    if (title) f_title.value = title;

    f_type.value = movie ? 'movie' : 'series';
    updateUnitLabels();
    syncThemedSelect(f_type);

    if (hit.poster_path) {
      const posterUrl = `https://image.tmdb.org/t/p/w500${hit.poster_path}`;
      try {
        const imgRes = await fetchWithTimeout(posterUrl, undefined, 12000);
        if (!imgRes.ok) throw new Error('bad_image');
        const blob = await imgRes.blob();
        setCoverPreview(await blobToDataUrl(blob), title);
      } catch {
        // Still works even if we can't embed the image locally — it'll just
        // load live from TMDB instead of being cached offline.
        setCoverPreview(posterUrl, title);
      }
    }

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

/* ---- Cover from clipboard ---- */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function useClipboardImage(clipboardItems) {
  for (const item of clipboardItems) {
    const type = item.types ? item.types.find((t) => t.startsWith('image/')) : item.type;
    if (!type || !type.startsWith('image/')) continue;
    const blob = item.getType ? await item.getType(type) : item.getAsFile();
    if (!blob) continue;
    setCoverPreview(await blobToDataUrl(blob));
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
    if (photo?.dataUrl) setCoverPreview(photo.dataUrl);
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
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCoverPreview(reader.result);
    reader.readAsDataURL(file);
  };
  input.click();
}

function resetForm() {
  form.reset();
  state.draftTags = [];
  state.editingId = null;
  imdbLinkInput.value = '';
  coverLinkRow.hidden = true;
  coverLinkInput.value = '';
  setCoverPreview(null);
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
      f_notes.value = e.notes || '';
      state.draftTags = [...(e.tags || [])];
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

  const payload = {
    title,
    type: f_type.value,
    season: (f_type.value === 'anime' || f_type.value === 'series') ? f_season.value.trim() : '',
    progress: Number(f_progress.value) || 0,
    total: f_total.value === '' ? null : Number(f_total.value),
    status: f_status.value,
    rating: Number(f_rating.value) || 0,
    notes: f_notes.value.trim(),
    tags: state.draftTags.slice(),
    cover: state.draftCover,
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
  closeSheet(entrySheet);
  showToast(state.editingId ? 'Entry updated' : 'Entry added');
});

deleteEntryBtn.addEventListener('click', () => {
  if (!state.editingId) return;
  if (!confirm('Delete this entry? This cannot be undone.')) return;
  entries = entries.filter((x) => x.id !== state.editingId);
  saveEntries(entries);
  render();
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

$('#menuToggle').addEventListener('click', () => openSheet(menuSheet));
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
        createdAt: raw.createdAt || Date.now(),
        updatedAt: raw.updatedAt || Date.now(),
      });
      added++;
    });

    saveEntries(entries);
    render();
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

$('#typeTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.type-tab');
  if (!btn) return;
  state.typeFilter = btn.dataset.type;
  document.querySelectorAll('.type-tab').forEach((b) => b.classList.toggle('active', b === btn));
  render();
});

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
