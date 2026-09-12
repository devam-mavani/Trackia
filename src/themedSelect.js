/* ---------------------------------------------------------------------- */
/*  Themed select                                                          */
/*                                                                          */
/*  Progressively enhances a native <select> into a custom, theme-aware   */
/*  dropdown (matches --c-surface / --c-accent / etc., so it follows any   */
/*  color preset the user picks). The original <select> is kept in the    */
/*  DOM as the single source of truth for value/validation/events — it's  */
/*  just visually hidden. Existing `select.addEventListener('change', …)` */
/*  code keeps working untouched, because choosing a custom option sets   */
/*  select.value and dispatches a real 'change' event.                    */
/* ---------------------------------------------------------------------- */

const registry = new Map(); // <select> -> { wrap, trigger, valueEl }

let menuEl = null;
let activeSelect = null;

function ensureMenu() {
  if (menuEl) return menuEl;

  menuEl = document.createElement('ul');
  menuEl.className = 'tselect-menu';
  menuEl.setAttribute('role', 'listbox');
  menuEl.setAttribute('tabindex', '-1');
  menuEl.hidden = true;
  document.body.appendChild(menuEl);

  document.addEventListener('click', (e) => {
    if (menuEl.hidden) return;
    if (menuEl.contains(e.target)) return;
    const rec = activeSelect && registry.get(activeSelect);
    if (rec && rec.wrap.contains(e.target)) return;
    closeMenu();
  });

  window.addEventListener('resize', closeMenu);
  document.addEventListener(
    'scroll',
    (e) => {
      if (menuEl.hidden) return;
      if (menuEl.contains(e.target)) return;
      closeMenu();
    },
    true
  );

  menuEl.addEventListener('keydown', handleMenuKeydown);

  return menuEl;
}

function handleMenuKeydown(e) {
  const items = Array.from(menuEl.querySelectorAll('.tselect-option:not(.is-disabled)'));
  if (!items.length) return;
  const idx = items.findIndex((it) => it.classList.contains('is-focus'));

  if (e.key === 'Escape') {
    e.preventDefault();
    closeMenu();
    activeSelect && registry.get(activeSelect)?.trigger.focus();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    focusItem(items, idx < 0 ? 0 : Math.min(items.length - 1, idx + 1));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    focusItem(items, idx < 0 ? items.length - 1 : Math.max(0, idx - 1));
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    (items[idx] || items[0])?.click();
  }
}

function focusItem(items, idx) {
  items.forEach((it) => it.classList.remove('is-focus'));
  const el = items[idx];
  if (el) {
    el.classList.add('is-focus');
    el.scrollIntoView({ block: 'nearest' });
  }
}

function positionMenu(trigger) {
  const rect = trigger.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  menuEl.style.minWidth = Math.max(160, rect.width) + 'px';
  menuEl.style.left = Math.min(rect.left, vw - Math.max(160, rect.width) - 8) + 'px';

  // Measure natural height first (visible but off-screen-safe) to decide
  // whether it should drop down or flip above the trigger.
  menuEl.style.top = '-9999px';
  menuEl.style.bottom = 'auto';
  menuEl.hidden = false;
  const menuHeight = menuEl.getBoundingClientRect().height;

  const spaceBelow = vh - rect.bottom;
  const openUp = spaceBelow < menuHeight + 12 && rect.top > menuHeight + 12;

  if (openUp) {
    menuEl.style.top = 'auto';
    menuEl.style.bottom = vh - rect.top + 6 + 'px';
  } else {
    menuEl.style.bottom = 'auto';
    menuEl.style.top = rect.bottom + 6 + 'px';
  }
}

function closeMenu() {
  if (!menuEl || menuEl.hidden) return;
  menuEl.classList.remove('is-visible');
  menuEl.hidden = true;
  menuEl.innerHTML = '';
  if (activeSelect) {
    const rec = registry.get(activeSelect);
    if (rec) {
      rec.wrap.classList.remove('is-open');
      rec.trigger.setAttribute('aria-expanded', 'false');
    }
  }
  activeSelect = null;
}

function openMenu(select) {
  const rec = registry.get(select);
  if (!rec) return;

  ensureMenu();
  if (activeSelect === select) {
    closeMenu();
    return;
  }
  closeMenu();
  activeSelect = select;
  rec.wrap.classList.add('is-open');
  rec.trigger.setAttribute('aria-expanded', 'true');

  menuEl.innerHTML = '';
  Array.from(select.options).forEach((opt, i) => {
    const li = document.createElement('li');
    li.className = 'tselect-option';
    li.setAttribute('role', 'option');
    li.dataset.index = String(i);
    li.textContent = opt.textContent;

    if (opt.disabled) {
      li.classList.add('is-disabled');
      li.setAttribute('aria-disabled', 'true');
    }
    if (opt.value === select.value) {
      li.classList.add('is-selected', 'is-focus');
      li.setAttribute('aria-selected', 'true');
    }
    if (!opt.disabled) {
      li.addEventListener('click', () => {
        selectOption(select, opt.value);
        closeMenu();
        rec.trigger.focus();
      });
    }
    menuEl.appendChild(li);
  });

  positionMenu(rec.trigger);
  requestAnimationFrame(() => menuEl.classList.add('is-visible'));
  menuEl.focus({ preventScroll: true });
}

function selectOption(select, value) {
  if (select.value === value) return;
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  syncThemedSelect(select);
}

function labelFor(select) {
  const opt = select.options[select.selectedIndex];
  return opt ? opt.textContent : '';
}

/** Re-reads select.value/selectedIndex and updates its custom trigger's
 *  label. Call this after setting select.value from application code
 *  (e.g. select.value = 'x'), since that doesn't fire a 'change' event. */
export function syncThemedSelect(select) {
  const rec = registry.get(select);
  if (!rec) return;
  rec.valueEl.textContent = labelFor(select);
}

function enhanceSelect(select) {
  if (registry.has(select)) return;

  const wrap = document.createElement('div');
  wrap.className = 'tselect' + (select.className ? ' ' + select.className : '');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'tselect-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  if (select.disabled) trigger.disabled = true;

  const valueEl = document.createElement('span');
  valueEl.className = 'tselect-value';
  valueEl.textContent = labelFor(select);

  const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chevron.setAttribute('class', 'tselect-chevron');
  chevron.setAttribute('viewBox', '0 0 24 24');
  chevron.innerHTML = '<path d="M7 10l5 5 5-5z"></path>';

  trigger.appendChild(valueEl);
  trigger.appendChild(chevron);

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (trigger.disabled) return;
    openMenu(select);
  });

  select.classList.add('tselect-native');
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(trigger);
  wrap.appendChild(select);

  registry.set(select, { wrap, trigger, valueEl });
}

/** Enhances every <select> matching `selector` that hasn't been enhanced yet. */
export function initThemedSelects(selector = '[data-themed]') {
  document.querySelectorAll(selector).forEach((select) => {
    if (select.tagName === 'SELECT') enhanceSelect(select);
  });
}
