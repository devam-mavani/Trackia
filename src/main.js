import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

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

const TYPE_LABEL = { anime: 'Anime', series: 'Series', movie: 'Movie', book: 'Book', manga: 'Manga' };
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

  for (const e of list) {
    grid.appendChild(renderCard(e));
  }
}

function renderCard(e) {
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

  card.addEventListener('click', () => openEntrySheet(e.id));

  return card;
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
/*  Sheets: generic open/close with swipe-to-close                         */
/* ---------------------------------------------------------------------- */

function openSheet(sheetEl) {
  backdrop.hidden = false;
  sheetEl.hidden = false;
  sheetEl.classList.remove('closing');
  document.body.style.overflow = 'hidden';
}

function closeSheet(sheetEl) {
  sheetEl.classList.add('closing');
  backdrop.hidden = true;
  document.body.style.overflow = '';
  setTimeout(() => {
    sheetEl.hidden = true;
    sheetEl.classList.remove('closing');
  }, 220);
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

function updateUnitLabels() {
  const unit = UNIT_BY_TYPE[f_type.value] || 'progress';
  const isSeasonType = f_type.value === 'anime' || f_type.value === 'series';
  f_season_field.style.display = isSeasonType ? '' : 'none';
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
  coverLinkRow.hidden = true;
  coverLinkInput.value = '';
  setCoverPreview(null);
  f_rating.value = 0;
  f_rating_val.textContent = '—';
  renderTagChips();
  updateUnitLabels();
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

$('#exportBtn').addEventListener('click', () => {
  const payload = { app: 'trackia', version: 1, exportedAt: new Date().toISOString(), entries };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `trackia-backup-${new Date().toISOString().slice(0, 10)}.json`;
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
        type: UNIT_BY_TYPE[raw.type] ? raw.type : 'anime',
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
function showToast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

/* ---------------------------------------------------------------------- */
/*  Boot                                                                   */
/* ---------------------------------------------------------------------- */

applySettings();
updateUnitLabels();
render();
