(() => {
  "use strict";

  const STORAGE_KEY = "trackia.items.v1";

  const TYPES = {
    anime: {
      label: "Anime",
      unit: "Episode",
      hasSeason: true,
      color: "var(--c-anime)",
    },
    series: {
      label: "TV series",
      unit: "Episode",
      hasSeason: true,
      color: "var(--c-series)",
    },
    movie: {
      label: "Movie",
      unit: null,
      hasSeason: false,
      color: "var(--c-movie)",
    },
    book: {
      label: "Book",
      unit: "Page",
      hasSeason: false,
      color: "var(--c-book)",
    },
    manga: {
      label: "Manga",
      unit: "Chapter",
      hasSeason: false,
      color: "var(--c-manga)",
    },
  };

  const STATUS = {
    planning: "Plan to start",
    active: "In progress",
    completed: "Completed",
    onhold: "On hold",
    dropped: "Dropped",
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
  const formHandle = document.getElementById("formHandle");
  const formTitle = document.getElementById("formTitle");
  const cancelBtn = document.getElementById("cancelBtn");
  const closeFormBtn = document.getElementById("closeFormBtn");
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

  const fieldCover = document.getElementById("fieldCover");
  const coverPreview = document.getElementById("coverPreview");
  const coverPreviewImg = document.getElementById("coverPreviewImg");
  const removeCoverBtn = document.getElementById("removeCoverBtn");
  const coverPicker = document.getElementById("coverPicker");

  const tagChips = document.getElementById("tagChips");
  const fieldTagEntry = document.getElementById("fieldTagEntry");

  let formType = "anime";
  let formStatus = "planning";
  let formCover = null;
  let formTags = [];

  // ---------- rendering ----------

  function render() {
    let filtered = items.filter((it) => {
      if (activeType !== "all" && it.type !== activeType) return false;
      if (activeStatus !== "all" && it.status !== activeStatus) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const inTitle = it.title.toLowerCase().includes(q);
        const inTags =
          Array.isArray(it.tags) &&
          it.tags.some((t) => t.toLowerCase().includes(q));
        if (!inTitle && !inTags) return false;
      }
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
    const card = document.createElement("div");
    card.className = "item";
    card.style.setProperty("--spine", meta.color);

    // ----- cover -----
    const cover = document.createElement("div");
    cover.className = "item-cover";
    if (it.coverImage) {
      const img = document.createElement("img");
      img.src = it.coverImage;
      img.alt = "";
      img.loading = "lazy";
      cover.appendChild(img);
    } else {
      cover.classList.add("no-cover");
      const initial = document.createElement("span");
      initial.textContent = (it.title || "?").trim().charAt(0).toUpperCase();
      cover.appendChild(initial);
    }

    const typeBadge = document.createElement("span");
    typeBadge.className = "cover-badge cover-type-badge";
    typeBadge.textContent = meta.label;
    cover.appendChild(typeBadge);

    if (typeof it.rating === "number") {
      const ratingBadge = document.createElement("span");
      ratingBadge.className = "cover-badge cover-rating-badge";
      ratingBadge.textContent = "★ " + it.rating;
      cover.appendChild(ratingBadge);
    }

    card.appendChild(cover);

    // ----- body -----
    const body = document.createElement("div");
    body.className = "item-body";

    const title = document.createElement("p");
    title.className = "item-title";
    title.textContent = it.title;
    body.appendChild(title);

    const statusSpan = document.createElement("span");
    statusSpan.className = "status-label " + it.status;
    statusSpan.textContent = STATUS[it.status];
    body.appendChild(statusSpan);

    if (meta.unit) {
      const progLine = document.createElement("div");
      progLine.className = "progress-line";
      const parts = [];
      if (meta.hasSeason && it.season) parts.push(`S${it.season}`);
      const cur = it.current || 0;
      if (it.total) {
        parts.push(`${meta.unit} ${cur}/${it.total}`);
      } else if (cur) {
        parts.push(`${meta.unit} ${cur}`);
      }
      if (parts.length) {
        progLine.textContent = parts.join(" · ");
        body.appendChild(progLine);
      }

      if (it.total) {
        const track = document.createElement("div");
        track.className = "progress-track";
        const fill = document.createElement("div");
        fill.className = "progress-fill";
        const pct = Math.max(0, Math.min(100, (cur / it.total) * 100));
        fill.style.width = pct + "%";
        track.appendChild(fill);
        body.appendChild(track);
      }
    }

    if (Array.isArray(it.tags) && it.tags.length) {
      const tagRow = document.createElement("div");
      tagRow.className = "item-tags";
      it.tags.slice(0, 4).forEach((tag) => {
        const chip = document.createElement("span");
        chip.className = "item-tag";
        chip.textContent = tag;
        tagRow.appendChild(chip);
      });
      body.appendChild(tagRow);
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
      body.appendChild(bump);
    }

    card.appendChild(body);
    card.addEventListener("click", () => openForm(it.id));

    return card;
  }

  // ---------- filters ----------

  typeTabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    typeTabs
      .querySelectorAll(".tab")
      .forEach((b) => b.classList.remove("active"));
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
    const blob = new Blob([JSON.stringify(items, null, 2)], {
      type: "application/json",
    });
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

  // ---------- cover image ----------

  function resizeImageToDataUrl(file, maxW, maxH, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          const ratio = Math.min(maxW / width, maxH / height, 1);
          width = Math.max(1, Math.round(width * ratio));
          height = Math.max(1, Math.round(height * ratio));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = () => reject(new Error("Could not load image"));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error("Could not read file"));
      reader.readAsDataURL(file);
    });
  }

  function showCoverPreview() {
    if (formCover) {
      coverPreviewImg.src = formCover;
      coverPreview.hidden = false;
      coverPicker.hidden = true;
    } else {
      coverPreview.hidden = true;
      coverPicker.hidden = false;
    }
  }

  function isNativeShell() {
    return !!(
      window.Capacitor &&
      typeof window.Capacitor.isNativePlatform === "function" &&
      window.Capacitor.isNativePlatform()
    );
  }

  function isNativeCameraAvailable() {
    return (
      isNativeShell() &&
      !!(window.Capacitor.Plugins && window.Capacitor.Plugins.Camera)
    );
  }

  async function pickCoverNative() {
    try {
      const photo = await window.Capacitor.Plugins.Camera.getPhoto({
        resultType: "dataUrl",
        source: "PHOTOS",
        quality: 80,
        width: 500,
        height: 750,
      });
      if (photo && photo.dataUrl) {
        formCover = photo.dataUrl;
        showCoverPreview();
      }
    } catch (err) {
      console.error("Camera.getPhoto failed", err);
      // user cancelled the picker, or permission was denied — nothing to do
    }
  }

  coverPicker.addEventListener("click", (e) => {
    // Always take over the click ourselves. Raw <input type="file"> pickers are
    // unreliable inside the Android WebView (they can freeze the whole sheet
    // after returning from the system picker), so we never want to silently
    // fall through to the label's default file-input behavior while running
    // as the native app.
    e.preventDefault();

    if (isNativeCameraAvailable()) {
      pickCoverNative();
    } else if (isNativeShell()) {
      // Running as the native app but the Camera plugin isn't registered —
      // surface this instead of risking the freeze-prone fallback.
      const known = window.Capacitor.Plugins
        ? Object.keys(window.Capacitor.Plugins).join(", ")
        : "(none)";
      console.error("Camera plugin not available. Registered plugins:", known);
      alert(
        "Cover photo picking isn't available in this build. (Camera plugin not detected.)",
      );
    } else {
      // Plain browser/PWA — open the hidden file input ourselves.
      fieldCover.click();
    }
  });

  fieldCover.addEventListener("change", () => {
    const file = fieldCover.files[0];
    fieldCover.value = "";
    if (!file) return;
    resizeImageToDataUrl(file, 500, 750, 0.82)
      .then((dataUrl) => {
        formCover = dataUrl;
        showCoverPreview();
      })
      .catch(() => alert("Couldn't load that image."));
  });

  removeCoverBtn.addEventListener("click", () => {
    formCover = null;
    showCoverPreview();
  });

  // ---------- tags ----------

  function renderTagChips() {
    tagChips.innerHTML = "";
    formTags.forEach((tag, idx) => {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      const label = document.createElement("span");
      label.textContent = tag;
      chip.appendChild(label);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "✕";
      remove.setAttribute("aria-label", "Remove tag " + tag);
      remove.addEventListener("click", () => {
        formTags.splice(idx, 1);
        renderTagChips();
      });
      chip.appendChild(remove);
      tagChips.appendChild(chip);
    });
  }

  function addTagFromInput() {
    const raw = fieldTagEntry.value.trim().replace(/,+$/, "");
    if (!raw) return;
    const tag = raw.slice(0, 24);
    if (!formTags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      formTags.push(tag);
      renderTagChips();
    }
    fieldTagEntry.value = "";
  }

  fieldTagEntry.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTagFromInput();
    } else if (
      e.key === "Backspace" &&
      !fieldTagEntry.value &&
      formTags.length
    ) {
      formTags.pop();
      renderTagChips();
    }
  });
  fieldTagEntry.addEventListener("blur", addTagFromInput);

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
    fieldRating.value =
      existing && typeof existing.rating === "number" ? existing.rating : "";
    fieldNotes.value = existing && existing.notes ? existing.notes : "";

    formCover = existing && existing.coverImage ? existing.coverImage : null;
    showCoverPreview();

    formTags =
      existing && Array.isArray(existing.tags) ? existing.tags.slice() : [];
    fieldTagEntry.value = "";
    renderTagChips();

    form.style.transform = "";
    form.classList.remove("dragging");
    form.classList.remove("closing");
    formBackdrop.classList.remove("closing");

    formBackdrop.hidden = false;
    form.hidden = false;
    setTimeout(() => fieldTitle.focus(), 50);
  }

  function closeForm() {
    if (form.hidden) return;

    // Stop any drag state
    form.classList.remove("dragging");

    // Remove inline transform so the CSS animation can take over
    form.style.transform = "";

    // Add closing state
    form.classList.add("closing");
    formBackdrop.classList.add("closing");

    // Hide only AFTER the animation completes
    setTimeout(() => {
      form.hidden = true;
      formBackdrop.hidden = true;

      form.classList.remove("closing");
      formBackdrop.classList.remove("closing");

      form.style.transform = "";
      editingId = null;
    }, 180);
  }

  addBtn.addEventListener("click", () => openForm(null));
  cancelBtn.addEventListener("click", closeForm);
  closeFormBtn.addEventListener("click", closeForm);
  formBackdrop.addEventListener("click", closeForm);

  // ---------- swipe-down-to-close ----------

  (() => {
    const DISMISS_DISTANCE = 110; // px of downward drag that counts as "close"
    const DISMISS_VELOCITY = 0.5; // px/ms — a quick flick closes even if short
    let dragging = false;
    let startY = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;

    function onPointerDown(e) {
      dragging = true;
      startY = lastY = e.clientY;
      lastT = e.timeStamp;
      velocity = 0;
      form.classList.add("dragging");
      formHandle.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e) {
      if (!dragging) return;
      const dy = Math.max(0, e.clientY - startY); // only allow dragging downward
      const dt = e.timeStamp - lastT;
      if (dt > 0) velocity = (e.clientY - lastY) / dt;
      lastY = e.clientY;
      lastT = e.timeStamp;
      form.style.transform = `translateY(${dy}px)`;
    }

    function onPointerUp(e) {
      if (!dragging) return;
      dragging = false;
      form.classList.remove("dragging");
      const dy = Math.max(0, e.clientY - startY);
      if (dy > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY) {
        closeForm();
      } else {
        form.style.transform = "";
      }
    }

    formHandle.addEventListener("pointerdown", onPointerDown);
    formHandle.addEventListener("pointermove", onPointerMove);
    formHandle.addEventListener("pointerup", onPointerUp);
    formHandle.addEventListener("pointercancel", onPointerUp);
  })();

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
      coverImage: formCover || null,
      tags: formTags.slice(),
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
      navigator.serviceWorker
        .register("sw.js")
        .catch((e) => console.error("SW registration failed", e));
    });
  }
})();
