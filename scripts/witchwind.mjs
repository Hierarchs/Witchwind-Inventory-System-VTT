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

Hooks.once("ready", applyTooltipStyle);
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
  buildFooter(tab, inventory);
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
function buildFooter(tab, inventory) {
  if ( tab.querySelector(".ww-footer") ) return;
  const parts = [
    tab.querySelector(".top .encumbrance") ?? inventory.querySelector(".bottom .encumbrance"),
    inventory.querySelector(".middle .attunement"),
    inventory.querySelector("section.currency")
  ].filter(Boolean);
  if ( !parts.length ) return;

  const footer = document.createElement("div");
  footer.className = "ww-footer";
  footer.append(...parts);
  tab.append(footer);
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
  const tooltip = await item.richTooltip?.();
  if ( (request !== state.detailRequest) || !panel.isConnected ) return;

  panel.dataset.wwRarity = rarityOf(item);
  panel.innerHTML = `<div class="ww-detail-card">${tooltip?.content ?? `<p>${item.name}</p>`}</div>`;
  panel.querySelector(".control-hint")?.remove();

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
      // With the panel docked, the hover card would only repeat it. dnd5e attaches the card as a
      // data-tooltip attribute at render, so set that aside while docked and restore it when not.
      for ( const name of list.querySelectorAll(".item .item-name") ) {
        if ( docked && ("tooltip" in name.dataset) ) {
          name.dataset.wwTooltip = name.dataset.tooltip;
          delete name.dataset.tooltip;
        } else if ( !docked && ("wwTooltip" in name.dataset) ) {
          name.dataset.tooltip = name.dataset.wwTooltip;
          delete name.dataset.wwTooltip;
        }
      }
    }
    fillSlots(tab);
  };

  const resize = new ResizeObserver(() => requestAnimationFrame(update));
  resize.observe(inventory);
  // dnd5e's search and filters show and hide rows with the hidden attribute.
  const filter = new MutationObserver(() => fillSlots(tab));
  filter.observe(list, { attributes: true, attributeFilter: ["hidden"], subtree: true });
  state.observers = [resize, filter];
  update();
}

/**
 * Pad the grid with empty slots to complete the last row and reach a minimum height.
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

  const columns = getComputedStyle(list).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
  const shown = Array.from(list.querySelectorAll("li.item")).filter(li => li.offsetParent !== null).length;
  const rows = Math.max(Math.ceil(shown / columns) + 1, MIN_ROWS);
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

function applyTooltipStyle() {
  const style = game.settings.get(MODULE_ID, "tooltipStyle");
  document.body.classList.toggle("ww-tooltip-parchment", style === "parchment");
  document.body.classList.toggle("ww-tooltip-steel", style === "steel");
}
