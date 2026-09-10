(() => {
  "use strict";

  const STORAGE_KEY = "trackia.items.v1";

  const TYPES = {
    anime:  { label: "Anime",     unit: "Episode", hasSeason: true,  color: "var(--c-anime)"  },
    series: { label: "TV series", unit: "Episode", hasSeason: true,  color: "var(--c-series)" },
    movie:  { label: "Movie",     unit: null,       hasSeason: false, color: "var(--c-movie)"  },
    book:   { label: "Book",      unit: "Page",     hasSeason: false, color: "var(--c-book)"   },
    manga:  { label: "Manga",     unit: "Chapter",  hasSeason: false, color: "var(--c-manga)"  },
  };

  const STATUS = {
    planning:  "Plan to start",
    active:    "In progress",
    completed: "Completed",
    onhold:    "On hold",
    dropped:   "Dropped",
  };

  // ---------- storage ----------

  function loadItems() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error("Failed to read storage", e);
      return [];
    }
  }

  function saveItems(items) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  let items = loadItems();

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------- state ----------

  let activeType = "all";
  let activeStatus = "all";
  let sortMode = "updated";
  let searchQuery = "";
  let editingId = null;

  // ---------- elements ----------

  const listEl = document.getElementById("list");
  const emptyEl = document.getElementById("emptyState");
  const typeTabs = document.getElementById("typeTabs");
  const statusFilter = document.getElementById("statusFilter");
  const sortOrder = document.getElementById("sortOrder");

  const searchToggle = document.getElementById("searchToggle");
  const searchRow = document.getElementById("searchRow");
  const searchInput = document.getElementById("searchInput");

  const menuToggle = document.getElementById("menuToggle");
  const menuBackdrop = document.getElementById("menuBackdrop");
  const menuSheet = document.getElementById("menuSheet");
  const closeMenuBtn = document.getElementById("closeMenuBtn");
  const exportBtn = document.getElementById("exportBtn");
  const importInput = document.getElementById("importInput");

  const addBtn = document.getElementById("addBtn");
  const formBackdrop = document.getElementById("formBackdrop");
  const form = document.getElementById("entryForm");
  const formTitle = document.getElementById("formTitle");
  const cancelBtn = document.getElementById("cancelBtn");
  const deleteBtn = document.getElementById("deleteBtn");

  const fieldTitle = document.getElementById("fieldTitle");
  const fieldType = document.getElementById("fieldType");
  const seasonRow = document.getElementById("seasonRow");
  const fieldSeason = document.getElementById("fieldSeason");
  const progressRow = document.getElementById("progressRow");
  const currentLabel = document.getElementById("currentLabel");
  const fieldCurrent = document.getElementById("fieldCurrent");
  const fieldTotal = document.getElementById("fieldTotal");
  const fieldStatus = document.getElementById("fieldStatus");
  const fieldRating = document.getElementById("fieldRating");
  const fieldNotes = document.getElementById("fieldNotes");

  let formType = "anime";
  let formStatus = "planning";

  // ---------- rendering ----------

  function render() {
    let filtered = items.filter((it) => {
      if (activeType !== "all" && it.type !== activeType) return false;
      if (activeStatus !== "all" && it.status !== activeStatus) return false;
      if (searchQuery && !it.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });

    filtered.sort((a, b) => {
      if (sortMode === "title") return a.title.localeCompare(b.title);
      if (sortMode === "rating") return (b.rating ?? -1) - (a.rating ?? -1);
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

    listEl.innerHTML = "";
    emptyEl.hidden = filtered.length !== 0;

    for (const it of filtered) {
      listEl.appendChild(renderItem(it));
    }
  }

  function renderItem(it) {
    const meta = TYPES[it.type];
    const row = document.createElement("div");
    row.className = "item";
    row.style.setProperty("--spine", meta.color);

    const main = document.createElement("div");
    main.className = "item-main";

    const title = document.createElement("p");
    title.className = "item-title";
    title.textContent = it.title;
    main.appendChild(title);

    const metaLine = document.createElement("div");
    metaLine.className = "item-meta";
    const dot = document.createElement("span");
    dot.className = "type-dot";
    metaLine.appendChild(dot);
    const typeSpan = document.createElement("span");
    typeSpan.textContent = meta.label;
    metaLine.appendChild(typeSpan);
    const statusSpan = document.createElement("span");
    statusSpan.className = "status-label " + it.status;
    statusSpan.textContent = STATUS[it.status];
    metaLine.appendChild(statusSpan);
    main.appendChild(metaLine);

    if (meta.unit) {
      const progLine = document.createElement("div");
      progLine.className = "progress-line";
      const parts = [];
      if (meta.hasSeason && it.season) parts.push(`Season ${it.season}`);
      const cur = it.current || 0;
      if (it.total) {
        parts.push(`${meta.unit} ${cur} of ${it.total}`);
      } else if (cur) {
        parts.push(`${meta.unit} ${cur}`);
      }
      progLine.textContent = parts.join(", ");
      if (parts.length) main.appendChild(progLine);

      if (it.total) {
        const track = document.createElement("div");
        track.className = "progress-track";
        const fill = document.createElement("div");
        fill.className = "progress-fill";
        const pct = Math.max(0, Math.min(100, (cur / it.total) * 100));
        fill.style.width = pct + "%";
        track.appendChild(fill);
        main.appendChild(track);
      }
    }

    row.appendChild(main);

    const side = document.createElement("div");
    side.className = "item-side";

    if (typeof it.rating === "number") {
      const rating = document.createElement("span");
      rating.className = "rating";
      rating.textContent = it.rating + "/10";
      side.appendChild(rating);
    } else {
      const spacer = document.createElement("span");
      side.appendChild(spacer);
    }

    if (meta.unit && it.status === "active") {
      const bump = document.createElement("button");
      bump.className = "bump-btn";
      bump.type = "button";
      bump.textContent = "+1";
      bump.addEventListener("click", (e) => {
        e.stopPropagation();
        it.current = (it.current || 0) + 1;
        it.updatedAt = Date.now();
        if (it.total && it.current >= it.total) it.status = "completed";
        saveItems(items);
        render();
      });
      side.appendChild(bump);
    }

    row.appendChild(side);

    row.addEventListener("click", () => openForm(it.id));

    return row;
  }

  // ---------- filters ----------

  typeTabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    typeTabs.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeType = btn.dataset.type;
    render();
  });

  statusFilter.addEventListener("change", () => {
    activeStatus = statusFilter.value;
    render();
  });

  sortOrder.addEventListener("change", () => {
    sortMode = sortOrder.value;
    render();
  });

  searchToggle.addEventListener("click", () => {
    searchRow.hidden = !searchRow.hidden;
    if (!searchRow.hidden) searchInput.focus();
  });

  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value.trim();
    render();
  });

  // ---------- menu sheet ----------

  function openMenu() {
    menuBackdrop.hidden = false;
    menuSheet.hidden = false;
  }
  function closeMenu() {
    menuBackdrop.hidden = true;
    menuSheet.hidden = true;
  }
  menuToggle.addEventListener("click", openMenu);
  closeMenuBtn.addEventListener("click", closeMenu);
  menuBackdrop.addEventListener("click", closeMenu);

  exportBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `trackia-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    closeMenu();
  });

  importInput.addEventListener("change", () => {
    const file = importInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const incoming = JSON.parse(reader.result);
        if (!Array.isArray(incoming)) throw new Error("Not a list");
        const existingIds = new Set(items.map((i) => i.id));
        let added = 0;
        for (const it of incoming) {
          if (it && it.id && !existingIds.has(it.id)) {
            items.push(it);
            added++;
          }
        }
        saveItems(items);
        render();
        alert(`Imported ${added} title${added === 1 ? "" : "s"}.`);
      } catch (e) {
        alert("That file doesn't look like a Trackia backup.");
      }
      importInput.value = "";
      closeMenu();
    };
    reader.readAsText(file);
  });

  // ---------- form sheet ----------

  function setSegmented(container, value) {
    container.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", b.dataset.value === value);
    });
  }

  fieldType.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    formType = btn.dataset.value;
    setSegmented(fieldType, formType);
    updateFieldVisibility();
  });

  fieldStatus.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    formStatus = btn.dataset.value;
    setSegmented(fieldStatus, formStatus);
  });

  function updateFieldVisibility() {
    const meta = TYPES[formType];
    seasonRow.style.display = meta.hasSeason ? "flex" : "none";
    progressRow.style.display = meta.unit ? "flex" : "none";
    if (meta.unit) currentLabel.firstChild.textContent = meta.unit + " ";
  }

  function openForm(id) {
    editingId = id || null;
    const existing = id ? items.find((i) => i.id === id) : null;

    formTitle.textContent = existing ? "Edit title" : "Add title";
    deleteBtn.hidden = !existing;

    fieldTitle.value = existing ? existing.title : "";
    formType = existing ? existing.type : "anime";
    formStatus = existing ? existing.status : "planning";
    setSegmented(fieldType, formType);
    setSegmented(fieldStatus, formStatus);
    updateFieldVisibility();

    fieldSeason.value = existing && existing.season ? existing.season : "";
    fieldCurrent.value = existing && existing.current ? existing.current : "";
    fieldTotal.value = existing && existing.total ? existing.total : "";
    fieldRating.value = existing && typeof existing.rating === "number" ? existing.rating : "";
    fieldNotes.value = existing && existing.notes ? existing.notes : "";

    formBackdrop.hidden = false;
    form.hidden = false;
    setTimeout(() => fieldTitle.focus(), 50);
  }

  function closeForm() {
    formBackdrop.hidden = true;
    form.hidden = true;
    editingId = null;
  }

  addBtn.addEventListener("click", () => openForm(null));
  cancelBtn.addEventListener("click", closeForm);
  formBackdrop.addEventListener("click", closeForm);

  deleteBtn.addEventListener("click", () => {
    if (!editingId) return;
    if (!confirm("Delete this title from your list?")) return;
    items = items.filter((i) => i.id !== editingId);
    saveItems(items);
    closeForm();
    render();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = fieldTitle.value.trim();
    if (!title) return;

    const data = {
      id: editingId || uid(),
      title,
      type: formType,
      season: fieldSeason.value ? Number(fieldSeason.value) : null,
      current: fieldCurrent.value ? Number(fieldCurrent.value) : 0,
      total: fieldTotal.value ? Number(fieldTotal.value) : null,
      status: formStatus,
      rating: fieldRating.value !== "" ? Number(fieldRating.value) : null,
      notes: fieldNotes.value.trim() || null,
      updatedAt: Date.now(),
    };

    if (editingId) {
      const idx = items.findIndex((i) => i.id === editingId);
      items[idx] = data;
    } else {
      items.push(data);
    }
    saveItems(items);
    closeForm();
    render();
  });

  // ---------- init ----------

  updateFieldVisibility();
  render();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((e) => console.error("SW registration failed", e));
    });
  }
})();
