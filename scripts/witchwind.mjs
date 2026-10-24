const MODULE_ID = "witchwind-inventory";
const SLOT_MIN = 44;
const SLOT_MAX = 80;
const SLOT_STEP = 4;

/** Inventory width at which the detail panel docks beside the grid. */
const DOCK_WIDTH = 760;

/** The grid always shows at least this many rows, padding with empty slots. */
const MIN_ROWS = 5;

const CATEGORIES = [
  { id: "all", icon: "fa-layer-group" },
  { id: "weapon", icon: "fa-khanda" },
  { id: "equipment", icon: "fa-shield-halved" },
  { id: "consumable", icon: "fa-flask" },
  { id: "tool", icon: "fa-screwdriver-wrench" },
  { id: "loot", icon: "fa-gem" }
];

/** Per-sheet UI state that should survive re-renders: chosen category, selected item, observers. */
const sheetStates = new WeakMap();

/* -------------------------------------------- */
/*  Settings                                    */
/* -------------------------------------------- */

Hooks.once("init", () => {
  const register = (key, data) => game.settings.register(MODULE_ID, key, { scope: "client", ...data });

  register("enabled", {
    name: "WITCHWIND.Settings.Enabled.Name",
    hint: "WITCHWIND.Settings.Enabled.Hint",
    config: true,
    type: Boolean,
    default: true,
    onChange: rerenderSheets
  });

  register("slotSize", {
    name: "WITCHWIND.Settings.SlotSize.Name",
    hint: "WITCHWIND.Settings.SlotSize.Hint",
    config: true,
    type: Number,
    default: 56,
    range: { min: SLOT_MIN, max: SLOT_MAX, step: SLOT_STEP },
    onChange: refreshSheets
  });

  register("tooltipStyle", {
    name: "WITCHWIND.Settings.TooltipStyle.Name",
    hint: "WITCHWIND.Settings.TooltipStyle.Hint",
    config: true,
    type: String,
    choices: {
      parchment: "WITCHWIND.Settings.TooltipStyle.Choices.parchment",
      steel: "WITCHWIND.Settings.TooltipStyle.Choices.steel",
      system: "WITCHWIND.Settings.TooltipStyle.Choices.system"
    },
    default: "parchment",
    onChange: applyTooltipStyle
  });

  // Grid or list, switched from the inventory tab itself.
  register("view", {
    config: false,
    type: String,
    default: "grid",
    onChange: refreshSheets
  });
});

Hooks.once("ready", () => {
  applyTooltipStyle();
  watchTooltips();
});
Hooks.on("renderCharacterActorSheet", onRenderActorSheet);
Hooks.on("renderNPCActorSheet", onRenderActorSheet);

/* -------------------------------------------- */
/*  Rendering                                   */
/* -------------------------------------------- */

/**
 * Theme a character or NPC sheet and rebuild its inventory tab after each render.
 * @param {ApplicationV2} app
 * @param {HTMLElement} element
 */
function onRenderActorSheet(app, element) {
  element.classList.add("ww-sheet");
  const enabled = game.settings.get(MODULE_ID, "enabled");
  element.classList.toggle("ww-theme", enabled);
  if ( !enabled ) return;

  const tab = element.querySelector('.tab[data-tab="inventory"]');
  const inventory = tab?.querySelector(".inventory-element");
  if ( !inventory ) return;

  let state = sheetStates.get(app);
  if ( !state ) sheetStates.set(app, state = { category: "all", selected: null, observers: [] });

  annotateItems(app.actor, tab);
  injectControls(tab);
  injectCategories(tab, inventory, state);
  buildFooter(app.actor, tab, inventory);
  injectDetailPanel(app, tab, inventory, state);
  applySheetState(element);
  observeLayout(tab, inventory, state);
}

/**
 * Copy the item data the slot styles depend on onto each row, since dnd5e doesn't render it as attributes.
 * @param {Actor} actor
 * @param {HTMLElement} root
 */
function annotateItems(actor, root) {
  for ( const el of root.querySelectorAll("li.item[data-item-id], .containers .container[data-item-id]") ) {
    const item = actor?.items.get(el.dataset.itemId);
    if ( !item ) continue;
    const { rarity, equipped, attuned, quantity } = item.system;
    el.dataset.wwType = item.type;
    el.dataset.wwRarity = rarityOf(item);
    toggleData(el, "wwEquipped", equipped === true);
    toggleData(el, "wwAttuned", attuned === true);

    if ( Number.isNumeric(quantity) && (Number(quantity) !== 1) ) el.dataset.wwQty = quantity;
    else delete el.dataset.wwQty;
  }
}

/**
 * Add the grid/list toggle and slot size slider beside dnd5e's search and filter controls.
 * @param {HTMLElement} tab
 */
function injectControls(tab) {
  const inventory = tab.querySelector(".inventory-element");
  if ( !inventory || inventory.querySelector(".ww-view-controls") ) return;

  let middle = inventory.querySelector(".middle");
  if ( !middle ) {
    middle = document.createElement("div");
    middle.className = "middle";
    inventory.querySelector(".items-list")?.before(middle);
  }

  const controls = document.createElement("div");
  controls.className = "ww-view-controls";
  controls.innerHTML = `
    <label class="ww-slot-size" data-tooltip="${t("SlotSize")}">
      <i class="fa-regular fa-square ww-icon-small" inert></i>
      <input type="range" class="always-interactive" min="${SLOT_MIN}" max="${SLOT_MAX}" step="${SLOT_STEP}"
             aria-label="${t("SlotSize")}">
      <i class="fa-regular fa-square ww-icon-large" inert></i>
    </label>
    <div class="ww-view-toggle" role="group" aria-label="${t("ViewToggle")}">
      <button type="button" class="always-interactive" data-ww-view="grid" aria-label="${t("ViewGrid")}"
              data-tooltip="${t("ViewGrid")}"><i class="fa-solid fa-grip" inert></i></button>
      <button type="button" class="always-interactive" data-ww-view="list" aria-label="${t("ViewList")}"
              data-tooltip="${t("ViewList")}"><i class="fa-solid fa-list" inert></i></button>
    </div>`;
  middle.append(controls);

  // Keep these out of the sheet's own form handling, which would otherwise try to submit on change.
  const range = controls.querySelector('input[type="range"]');
  range.addEventListener("input", event => {
    event.stopPropagation();
    setSlotSize(tab.closest(".ww-sheet"), event.target.value);
    fillSlots(tab);
  });
  range.addEventListener("change", event => {
    event.stopPropagation();
    game.settings.set(MODULE_ID, "slotSize", Number(event.target.value));
  });
  for ( const button of controls.querySelectorAll("[data-ww-view]") ) {
    button.addEventListener("click", event => {
      event.stopPropagation();
      game.settings.set(MODULE_ID, "view", event.currentTarget.dataset.wwView);
    });
  }
}

/**
 * Add a row of category tabs above the inventory that filters it by item type.
 * @param {HTMLElement} tab
 * @param {HTMLElement} inventory
 * @param {object} state
 */
function injectCategories(tab, inventory, state) {
  if ( inventory.querySelector(".ww-cats") ) return;
  const counts = {};
  for ( const li of inventory.querySelectorAll(".items-list li.item[data-ww-type]") ) {
    counts[li.dataset.wwType] = (counts[li.dataset.wwType] ?? 0) + 1;
  }

  const nav = document.createElement("nav");
  nav.className = "ww-cats";
  nav.setAttribute("aria-label", t("Categories"));
  for ( const { id, icon } of CATEGORIES ) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "always-interactive";
    button.dataset.wwCat = id;
    if ( (id !== "all") && !counts[id] ) button.classList.add("empty");
    button.innerHTML = `<i class="fa-solid ${icon}" inert></i><span>${id === "all" ? t("CategoryAll") : typeLabel(id)}</span>`;
    button.addEventListener("click", event => {
      event.stopPropagation();
      state.category = id;
      setCategory(tab, id);
      fillSlots(tab);
    });
    nav.append(button);
  }
  inventory.prepend(nav);

  // A category emptied since the last render falls back to showing everything.
  if ( (state.category !== "all") && !counts[state.category] ) state.category = "all";
  setCategory(tab, state.category);
}

function setCategory(tab, category) {
  tab.dataset.wwCat = category;
  for ( const button of tab.querySelectorAll(".ww-cats [data-ww-cat]") ) {
    button.setAttribute("aria-pressed", String(button.dataset.wwCat === category));
  }
}

/**
 * Gather carried weight, attunement and coins into one bar along the bottom of the tab.
 * @param {HTMLElement} tab
 * @param {HTMLElement} inventory
 */
function buildFooter(actor, tab, inventory) {
  if ( tab.querySelector(".ww-footer") ) return;
  const encumbrance = tab.querySelector(".top .encumbrance") ?? inventory.querySelector(".bottom .encumbrance");
  const parts = [
    encumbrance ? carriedBlock(encumbrance) : null,
    attunementBlock(actor),
    inventory.querySelector("section.currency")
  ].filter(Boolean);
  if ( !parts.length ) return;

  const footer = document.createElement("div");
  footer.className = "ww-footer";
  footer.append(...parts);
  tab.append(footer);
}

/**
 * Wrap dnd5e's encumbrance meter with a "Carried 35 / 150" line above it, read from the meter's own label.
 * @param {HTMLElement} encumbrance
 * @returns {HTMLElement}
 */
function carriedBlock(encumbrance) {
  const value = encumbrance.querySelector(".label .value")?.textContent.trim();
  const max = encumbrance.querySelector(".label .max")?.textContent.trim();
  const block = document.createElement("div");
  block.className = "ww-carried";
  block.innerHTML = `
    <div class="ww-carried-head">
      <span class="ww-carried-label">${t("Carried")}</span>
      <span class="ww-carried-value"></span>
    </div>`;
  if ( value && max ) block.querySelector(".ww-carried-value").textContent = `${value} / ${max}`;
  block.append(encumbrance);
  return block;
}

/**
 * "Attuned ●●○ 2 / 3", as in the concept, from the actor's attunement count and limit.
 * @param {Actor} actor
 * @returns {HTMLElement|null}
 */
function attunementBlock(actor) {
  const { value = 0, max = 0 } = actor?.system.attributes?.attunement ?? {};
  if ( !max ) return null;
  const block = document.createElement("div");
  block.className = "ww-attune";
  const pips = Array.from({ length: Math.min(max, 10) }, (_, i) => `<span class="ww-pip${i < value ? " filled" : ""}"></span>`);
  block.innerHTML = `
    <span class="ww-attune-label">${t("Attuned")}</span>
    <span class="ww-attune-pips" aria-hidden="true">${pips.join("")}</span>
    <span class="ww-attune-count">${value} / ${max}</span>`;
  return block;
}

/**
 * Add the parchment panel that shows the hovered item's card beside the grid on wide sheets.
 * @param {ApplicationV2} app
 * @param {HTMLElement} tab
 * @param {HTMLElement} inventory
 * @param {object} state
 */
function injectDetailPanel(app, tab, inventory, state) {
  if ( inventory.querySelector(".ww-detail") ) return;
  const panel = document.createElement("aside");
  panel.className = "ww-detail";
  panel.setAttribute("aria-label", t("Details"));
  inventory.append(panel);

  const list = inventory.querySelector(".items-list");
  const show = foundry.utils.debounce(id => showDetail(app, tab, panel, id, state), 60);
  const onEnter = event => {
    const id = event.target.closest("li.item[data-item-id]")?.dataset.itemId;
    if ( id && (id !== state.selected) ) show(id);
  };
  list?.addEventListener("pointerover", onEnter);
  list?.addEventListener("focusin", onEnter);

  const first = app.actor?.items.has(state.selected) ? state.selected
    : list?.querySelector("li.item[data-item-id]")?.dataset.itemId;
  if ( first ) showDetail(app, tab, panel, first, state);
  else panel.innerHTML = `<p class="ww-detail-empty">${t("NoItem")}</p>`;
}

/**
 * Fill the detail panel with an item's dnd5e card and Witchwind actions.
 * @param {ApplicationV2} app
 * @param {HTMLElement} tab
 * @param {HTMLElement} panel
 * @param {string} itemId
 * @param {object} state
 */
async function showDetail(app, tab, panel, itemId, state) {
  const item = app.actor?.items.get(itemId);
  if ( !item ) return;
  state.selected = itemId;
  for ( const li of tab.querySelectorAll("li.item[data-ww-selected]") ) delete li.dataset.wwSelected;
  tab.querySelector(`li.item[data-item-id="${itemId}"]`)?.setAttribute("data-ww-selected", "");

  // Hovering quickly across slots starts several loads; only the latest one gets to draw.
  const request = state.detailRequest = (state.detailRequest ?? 0) + 1;
  const html = await detailHTML(item);
  if ( (request !== state.detailRequest) || !panel.isConnected ) return;

  panel.dataset.wwRarity = rarityOf(item);
  panel.innerHTML = html;

  const actions = document.createElement("div");
  actions.className = "ww-detail-actions";
  const addAction = (label, primary, handler, disabled=false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `always-interactive${primary ? " primary" : ""}`;
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener("click", event => {
      event.stopPropagation();
      handler(event);
    });
    actions.append(button);
  };

  addAction(t("Use"), true, event => item.use({ event }));
  if ( "equipped" in item.system ) {
    addAction(t(item.system.equipped ? "Unequip" : "Equip"), false,
      () => item.update({ "system.equipped": !item.system.equipped }), !item.isOwner);
  }
  if ( item.system.attunement ) {
    addAction(t(item.system.attuned ? "Unattune" : "Attune"), false,
      () => item.update({ "system.attuned": !item.system.attuned }), !item.isOwner);
  }
  panel.append(actions);
}

/**
 * Build the detail panel's contents: name, rarity and type, a headline stat, a stat list and the description.
 * @param {Item} item
 * @returns {Promise<string>}
 */
async function detailHTML(item) {
  const system = item.system;
  const labels = item.labels ?? {};
  const concealed = (system.identified === false) && !game.user.isGM;
  const rarity = rarityOf(item);

  const name = concealed ? (system.unidentified?.name || item.name) : item.name;
  const subtitle = [
    rarity === "mundane" ? "" : loc(CONFIG.DND5E.itemRarity?.[rarity]),
    system.type?.label || loc(CONFIG.Item.typeLabels?.[item.type])
  ].filter(Boolean).join(" · ");
  const key = concealed ? null : headlineStat(item, labels);
  const stats = concealed ? physicalStats(item) : [...combatStats(item, labels), ...physicalStats(item), ...stateStats(item)];
  const description = await enrich(concealed ? system.unidentified?.description : system.description?.value, item);

  return `
    <div class="ww-detail-scroll">
      <header class="ww-d-head">
        <h3 class="ww-d-name">${esc(name)}</h3>
        ${subtitle ? `<p class="ww-d-sub">${esc(subtitle)}</p>` : ""}
      </header>
      <div class="ww-d-rule" aria-hidden="true"><span></span></div>
      <div class="ww-d-key">
        <img src="${esc(item.img)}" alt="">
        ${key ? `<div class="ww-d-key-text">
          <span class="ww-d-key-label">${esc(key.label)}</span>
          <span class="ww-d-key-value">${esc(key.value)}</span>
        </div>` : ""}
      </div>
      ${stats.length ? `<dl class="ww-d-stats">${stats.map(([label, value]) => `
        <div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}
      </dl>` : ""}
      ${description ? `<div class="ww-d-desc">${description}</div>` : ""}
    </div>`;
}

/** The one number that matters most for an item: damage, armor class, a tool's check, or uses left. */
function headlineStat(item, labels) {
  const system = item.system;
  const damage = (labels.damages ?? []).map(d => {
    const type = loc(CONFIG.DND5E.damageTypes?.[d.damageType]) || loc(CONFIG.DND5E.healingTypes?.[d.damageType]);
    return [d.formula, type?.toLowerCase()].filter(Boolean).join(" ");
  }).filter(Boolean);
  if ( damage.length ) return { label: t(item.type === "weapon" ? "Damage" : "Effect"), value: damage.join(", ") };
  if ( (item.type === "weapon") && labels.damage ) {
    return { label: t("Damage"), value: [labels.damage, labels.damageTypes?.toLowerCase()].filter(Boolean).join(" ") };
  }
  if ( (item.type === "equipment") && system.armor?.value ) return { label: t("ArmorClass"), value: armorText(system) };
  if ( (item.type === "tool") && system.ability ) {
    return { label: t("Check"), value: loc(CONFIG.DND5E.abilities?.[system.ability]) };
  }
  if ( system.uses?.max ) return { label: t("Uses"), value: `${system.uses.value ?? 0} / ${system.uses.max}` };
  return null;
}

function armorText(system) {
  const value = system.armor.value;
  switch ( system.type?.value ) {
    case "shield": return `+${value}`;
    case "light": return `${value} + Dex`;
    case "medium": return `${value} + Dex (max ${system.armor.dex ?? 2})`;
    default: return String(value);
  }
}

/** To hit, range or reach, properties and weapon mastery. */
function combatStats(item, labels) {
  const system = item.system;
  const stats = [];
  if ( labels.toHit ) stats.push([t("ToHit"), labels.toHit]);
  if ( labels.range ) stats.push([t("Range"), labels.range]);
  else if ( system.range?.reach ) stats.push([t("Reach"), `${number(system.range.reach)} ${system.range.units ?? ""}`.trim()]);
  const properties = (labels.properties ?? []).map(p => p.label).filter(Boolean);
  if ( properties.length ) stats.push([t("Properties"), properties.join(", ")]);
  const mastery = loc(CONFIG.DND5E.weaponMasteries?.[system.mastery]);
  if ( mastery ) stats.push([t("Mastery"), mastery]);
  return stats;
}

/** Weight, value and quantity. */
function physicalStats(item) {
  const system = item.system;
  const stats = [];
  const each = (Number(system.quantity) > 1) ? ` ${t("Each")}` : "";
  const weight = system.weight?.value;
  if ( weight ) {
    const units = loc(CONFIG.DND5E.weightUnits?.[system.weight.units], "abbreviation") || system.weight.units || "lb";
    stats.push([t("Weight"), `${number(weight)} ${units}${each}`]);
  }
  const price = system.price?.value;
  if ( price ) {
    const denomination = loc(CONFIG.DND5E.currencies?.[system.price.denomination], "abbreviation") || system.price.denomination;
    stats.push([t("Value"), `${number(price)} ${denomination}${each}`]);
  }
  if ( Number.isNumeric(system.quantity) && (Number(system.quantity) !== 1) ) stats.push([t("Quantity"), String(system.quantity)]);
  return stats;
}

/** Charges, attunement and whether it's equipped. */
function stateStats(item) {
  const system = item.system;
  const stats = [];
  if ( system.uses?.max && (item.type !== "tool") && !headlineIsUses(item) ) {
    stats.push([t("Uses"), `${system.uses.value ?? 0} / ${system.uses.max}`]);
  }
  if ( system.attunement ) {
    stats.push([t("Attunement"), system.attuned ? t("Attuned") : loc(CONFIG.DND5E.attunementTypes?.[system.attunement])]);
  }
  if ( "equipped" in system ) stats.push([t("Status"), t(system.equipped ? "Equipped" : "Carried")]);
  return stats;
}

function headlineIsUses(item) {
  return headlineStat(item, item.labels ?? {})?.label === t("Uses");
}

async function enrich(html, item) {
  if ( !html ) return "";
  const editor = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
  return editor.enrichHTML(html, { relativeTo: item, rollData: item.getRollData?.(), secrets: item.isOwner });
}

/**
 * Keep the grid padded with empty slots and dock or undock the detail panel as the sheet resizes or filters.
 * @param {HTMLElement} tab
 * @param {HTMLElement} inventory
 * @param {object} state
 */
function observeLayout(tab, inventory, state) {
  for ( const observer of state.observers ) observer.disconnect();
  const list = inventory.querySelector(".items-list");
  if ( !list ) return;

  const update = () => {
    const docked = inventory.clientWidth >= DOCK_WIDTH;
    if ( docked !== tab.classList.contains("ww-docked") ) {
      tab.classList.toggle("ww-docked", docked);
      // With the panel docked, the hover card would only repeat it.
      for ( const el of list.querySelectorAll(".item-tooltip, [data-ww-tooltips]") ) suppressTooltip(el, docked);
    }
    fillSlots(tab);
  };

  const resize = new ResizeObserver(() => requestAnimationFrame(update));
  resize.observe(inventory);
  // The sheet growing taller gives the grid more room to fill.
  const scroller = scrollParent(tab);
  if ( scroller ) resize.observe(scroller);
  // dnd5e's search and filters show and hide rows with the hidden attribute.
  const filter = new MutationObserver(() => fillSlots(tab));
  filter.observe(list, { attributes: true, attributeFilter: ["hidden"], subtree: true });
  state.observers = [resize, filter];
  update();
}

/**
 * Pad the grid with empty slots: complete the last row, then keep adding rows until the inventory
 * reaches the bottom of the visible sheet, so there's no dead space under the grid.
 * @param {HTMLElement} tab
 */
function fillSlots(tab) {
  const list = tab?.querySelector(".inventory-element .items-list");
  if ( !list ) return;
  let fillers = list.querySelector(":scope > .ww-fillers");
  if ( !tab.closest(".ww-sheet")?.classList.contains("ww-grid") ) {
    fillers?.remove();
    return;
  }
  // A hidden tab has no layout to measure; the resize observer calls back once it's shown.
  if ( !list.clientWidth ) return;

  const style = getComputedStyle(list);
  const columns = style.gridTemplateColumns.split(" ").filter(Boolean).length || 1;
  const step = (parseFloat(style.getPropertyValue("--ww-slot")) || 56) + (parseFloat(style.rowGap) || 8);
  const shown = Array.from(list.querySelectorAll("li.item")).filter(li => li.offsetParent !== null).length;
  const current = fillers?.childElementCount ?? 0;

  let rows = Math.max(Math.ceil(shown / columns) + 1, MIN_ROWS);
  const scroller = scrollParent(tab);
  if ( scroller ) {
    // Measured in the scroller's content coordinates, so scrolling doesn't change the answer.
    const tabBottom = tab.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const spare = scroller.clientHeight - tabBottom - 8;
    rows = Math.max(rows, Math.ceil((shown + current) / columns) + Math.floor(spare / step));
  }
  const count = (rows * columns) - shown;

  if ( !fillers ) {
    fillers = document.createElement("div");
    fillers.className = "ww-fillers";
    fillers.setAttribute("aria-hidden", "true");
    list.append(fillers);
  }
  if ( fillers.childElementCount === count ) return;
  fillers.replaceChildren(...Array.from({ length: count }, () => {
    const filler = document.createElement("div");
    filler.className = "ww-filler";
    return filler;
  }));
}

/**
 * Apply the current view and slot size to a rendered sheet.
 * @param {HTMLElement} element
 */
function applySheetState(element) {
  const view = game.settings.get(MODULE_ID, "view");
  const size = game.settings.get(MODULE_ID, "slotSize");
  element.classList.toggle("ww-grid", view === "grid");
  element.classList.toggle("ww-list", view !== "grid");
  setSlotSize(element, size);

  for ( const button of element.querySelectorAll(".ww-view-controls [data-ww-view]") ) {
    button.setAttribute("aria-pressed", String(button.dataset.wwView === view));
  }
  const slider = element.querySelector(".ww-slot-size");
  if ( slider ) {
    slider.hidden = view !== "grid";
    slider.querySelector("input").value = size;
  }
  fillSlots(element.querySelector('.tab[data-tab="inventory"]'));
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

function t(key) {
  return game.i18n.localize(`WITCHWIND.${key}`);
}

/**
 * Localize a dnd5e config entry, which may be a translation key or an object holding one.
 * @param {string|object} entry
 * @param {string} [property="label"]  Which property to read when the entry is an object.
 */
function loc(entry, property="label") {
  const key = (typeof entry === "object") ? (entry?.[property] ?? entry?.label) : entry;
  return key ? game.i18n.localize(key) : "";
}

function number(value) {
  return globalThis.dnd5e?.utils?.formatNumber?.(value) ?? Number(value).toLocaleString();
}

function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** The nearest ancestor that scrolls vertically, which is the space the inventory can grow into. */
function scrollParent(element) {
  for ( let el = element?.parentElement; el && !el.classList.contains("application"); el = el.parentElement ) {
    if ( /auto|scroll/.test(getComputedStyle(el).overflowY) ) return el;
  }
  return null;
}

/** dnd5e's own plural label for an item type, such as "Weapons". */
function typeLabel(type) {
  const key = `TYPES.Item.${type}Pl`;
  const label = game.i18n.localize(key);
  return label === key ? type : label;
}

/** The rarity to frame an item with. Unidentified items stay neutral for players so the frame doesn't give them away. */
function rarityOf(item) {
  const concealed = (item.system.identified === false) && !game.user.isGM;
  return (!concealed && item.system.rarity) ? item.system.rarity : "mundane";
}

function setSlotSize(element, size) {
  element?.style.setProperty("--ww-slot", `${size}px`);
}

function toggleData(element, key, state) {
  if ( state ) element.dataset[key] = "";
  else delete element.dataset[key];
}

function* openSheets() {
  for ( const app of foundry.applications.instances.values() ) {
    if ( app.rendered && app.element?.classList.contains("ww-sheet") ) yield app;
  }
}

function refreshSheets() {
  for ( const app of openSheets() ) applySheetState(app.element);
}

function rerenderSheets() {
  for ( const app of openSheets() ) app.render();
}

/** Data attributes Foundry reads hover card content from. */
const TOOLTIP_KEYS = ["tooltip", "tooltipHtml", "tooltipText"];

/**
 * Set an element's hover card attributes aside, or put them back.
 * @param {HTMLElement} el
 * @param {boolean} suppressed
 */
function suppressTooltip(el, suppressed) {
  if ( suppressed ) {
    const saved = {};
    for ( const key of TOOLTIP_KEYS ) {
      if ( !(key in el.dataset) ) continue;
      saved[key] = el.dataset[key];
      delete el.dataset[key];
    }
    if ( Object.keys(saved).length ) el.dataset.wwTooltips = JSON.stringify(saved);
  } else if ( el.dataset.wwTooltips ) {
    Object.assign(el.dataset, JSON.parse(el.dataset.wwTooltips));
    delete el.dataset.wwTooltips;
  }
}

/**
 * Close any hover card that opens for an item in a docked inventory, however it was attached.
 * Covers cards dnd5e adds after render, which suppressTooltip can't see in advance.
 */
function watchTooltips() {
  const tooltip = game.tooltip?.tooltip ?? document.getElementById("tooltip");
  if ( !tooltip ) return;
  new MutationObserver(() => {
    if ( !tooltip.classList.contains("active") ) return;
    if ( game.tooltip.element?.closest?.(".ww-theme .tab.ww-docked .items-list") ) game.tooltip.deactivate();
  }).observe(tooltip, { attributeFilter: ["class"] });
}

function applyTooltipStyle() {
  const style = game.settings.get(MODULE_ID, "tooltipStyle");
  document.body.classList.toggle("ww-tooltip-parchment", style === "parchment");
  document.body.classList.toggle("ww-tooltip-steel", style === "steel");
}
