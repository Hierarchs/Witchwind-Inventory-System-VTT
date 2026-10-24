const MODULE_ID = "witchwind-inventory";
const SLOT_MIN = 44;
const SLOT_MAX = 80;
const SLOT_STEP = 4;

/** Inventory width at which the detail panel docks beside the grid. */
const DOCK_WIDTH = 760;

/** The grid always shows at least this many rows, padding with empty slots. */
const MIN_ROWS = 5;

/** Tabs shown as a slot grid: a character's inventory and a container's contents. */
const GRID_TABS = ["inventory", "contents"];

const CATEGORIES = [
  { id: "all", icon: "fa-layer-group" },
  { id: "weapon", icon: "fa-khanda" },
  { id: "equipment", icon: "fa-shield-halved" },
  { id: "consumable", icon: "fa-flask" },
  { id: "tool", icon: "fa-screwdriver-wrench" },
  { id: "loot", icon: "fa-gem" }
];

/** Per-sheet UI state that should survive re-renders: chosen category, selected item, observers, cached panels. */
const sheetStates = new WeakMap();

/* Picture fitting: pictures are sampled at this size, pixels below this alpha count as empty, and a
   content box at least this full counts as a filled rectangle rather than a cut-out object. */
const PICTURE_SAMPLE = 96;
const PICTURE_ALPHA = 24;
const PICTURE_FILLED = 0.85;
const PICTURE_PADDING = 0.06;

/** Measured picture content by image URL, shared by every sheet: a fit, null when unreadable, or a pending promise. */
const pictureFits = new Map();

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
Hooks.on("closeCharacterActorSheet", onCloseActorSheet);
Hooks.on("closeNPCActorSheet", onCloseActorSheet);
Hooks.on("renderContainerSheet", onRenderContainerSheet);
Hooks.on("closeContainerSheet", onCloseActorSheet);

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

  const find = id => app.actor?.items.get(id);
  const tab = element.querySelector('.tab[data-tab="inventory"]');
  const inventory = tab?.querySelector(".inventory-element");
  if ( inventory ) {
    const state = tabState(app, "inventory");
    annotateItems(find, tab);
    fitPictures(tab);
    injectControls(tab);
    injectCategories(tab, inventory, state);
    buildFooter(tab, inventory, attunementBlock(app.actor), "Carried");
    injectDetailPanel(find, tab, inventory, state);
    observeLayout(tab, inventory, state);
  }

  // Features and Spells stay lists, with uses as pips and the same docked detail panel.
  for ( const id of ["features", "spells"] ) {
    const listTab = element.querySelector(`.tab[data-tab="${id}"]`);
    const list = listTab?.querySelector(".inventory-element");
    if ( !list ) continue;
    const state = tabState(app, id);
    annotateItems(find, listTab);
    decorateUses(find, listTab);
    injectDetailPanel(find, listTab, list, state);
    observeLayout(listTab, list, state);
  }

  applySheetState(element);
}

/**
 * Theme a container's own window (a bag, a chest) and give its contents the same slot grid as the inventory.
 * @param {ApplicationV2} app
 * @param {HTMLElement} element
 */
function onRenderContainerSheet(app, element) {
  element.classList.add("ww-sheet");
  const enabled = game.settings.get(MODULE_ID, "enabled");
  element.classList.toggle("ww-theme", enabled);
  if ( !enabled ) return;

  // A container's contents are its owner's items, or world items when the container isn't owned.
  const container = app.document ?? app.item;
  const find = id => container?.actor?.items.get(id) ?? game.items?.get(id);
  const tab = element.querySelector('.tab[data-tab="contents"]');
  const inventory = tab?.querySelector(".inventory-element");
  if ( inventory ) {
    const state = tabState(app, "contents");
    annotateItems(find, tab);
    fitPictures(tab);
    injectControls(tab);
    buildFooter(tab, inventory, null, "Capacity");
    injectDetailPanel(find, tab, inventory, state);
    observeLayout(tab, inventory, state);
  }
  applySheetState(element);
}

/**
 * UI state for one tab of one sheet, kept across re-renders.
 * @param {ApplicationV2} app
 * @param {string} id  The tab, such as "inventory" or "features".
 */
function tabState(app, id) {
  let tabs = sheetStates.get(app);
  if ( !tabs ) sheetStates.set(app, tabs = new Map());
  let state = tabs.get(id);
  if ( !state ) tabs.set(id, state = { category: "all", selected: null, observers: [], details: new Map() });
  return state;
}

/**
 * Stop watching a sheet's layout once it closes.
 * @param {ApplicationV2} app
 */
function onCloseActorSheet(app) {
  for ( const state of sheetStates.get(app)?.values() ?? [] ) {
    for ( const observer of state.observers ) observer.disconnect();
    state.observers = [];
  }
}

/**
 * Copy the item data the slot styles depend on onto each row, since dnd5e doesn't render it as attributes.
 * @param {function(string): Item} find  Looks up an item shown on this sheet by id.
 * @param {HTMLElement} root
 */
function annotateItems(find, root) {
  for ( const el of root.querySelectorAll("li.item[data-item-id], .containers .container[data-item-id]") ) {
    const item = find(el.dataset.itemId);
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

/** Features with more uses than this keep dnd5e's number instead of pips. */
const MAX_PIPS = 12;

/**
 * Show limited uses as a row of pips, like the attunement dots. Clicking a pip sets the remaining uses
 * by writing to dnd5e's own uses field and letting dnd5e save it, so nothing bypasses its handling.
 * @param {function(string): Item} find  Looks up an item shown on this sheet by id.
 * @param {HTMLElement} tab
 */
function decorateUses(find, tab) {
  for ( const column of tab.querySelectorAll(".items-list li.item[data-item-id] .item-uses:not(.empty)") ) {
    // Recharge and cooldown variants show an icon rather than value / max; leave those alone.
    if ( !column.querySelector(".max") || column.querySelector(".ww-uses-pips") ) continue;
    const item = find(column.closest("li.item").dataset.itemId);
    const uses = item?.system.uses;
    const max = Number(uses?.max);
    if ( !max || (max > MAX_PIPS) ) continue;

    const value = Math.clamp(Number(uses.value) || 0, 0, max);
    const input = column.querySelector("input");
    const pips = document.createElement("span");
    pips.className = "ww-uses-pips";
    pips.setAttribute("role", "group");
    pips.setAttribute("aria-label", `${t("Uses")}: ${value} / ${max}`);
    pips.dataset.tooltip = usesText(item);
    for ( let n = 1; n <= max; n++ ) {
      // Without an editable field (a locked sheet) the pips only display.
      const pip = document.createElement(input ? "button" : "span");
      pip.className = `ww-use-pip${n <= value ? " filled" : ""}`;
      if ( input ) {
        pip.type = "button";
        pip.classList.add("always-interactive");
        pip.setAttribute("aria-label", `${n} / ${max}`);
        pip.addEventListener("click", event => {
          event.stopPropagation();
          // Clicking a lit pip spends down to below it; clicking an unlit one restores up to it.
          input.value = String(value >= n ? n - 1 : n);
          input.dispatchEvent(new Event("change"));
        });
      }
      pips.append(pip);
    }
    column.classList.add("ww-has-pips");
    column.append(pips);
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
    scheduleFill(tab);
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
      if ( state.category === id ) return;
      state.category = id;
      setCategory(tab, id);
      replayAnimation(tab, state);
      scheduleFill(tab);
    });
    nav.append(button);
  }
  inventory.prepend(nav);

  // A category emptied since the last render falls back to showing everything.
  if ( (state.category !== "all") && !counts[state.category] ) state.category = "all";
  setCategory(tab, state.category);
}

/**
 * Let the slots shown by a category change settle in with a short animation. It's tied to this class
 * rather than always on, so ordinary re-renders (equipping, using an item) don't make the grid flicker.
 */
function replayAnimation(tab, state) {
  tab.classList.remove("ww-animate");
  void tab.offsetWidth; // Restart the animation even when switching again mid-way.
  tab.classList.add("ww-animate");
  clearTimeout(state.animationTimer);
  state.animationTimer = setTimeout(() => tab.classList.remove("ww-animate"), 400);
}

function setCategory(tab, category) {
  tab.dataset.wwCat = category;
  for ( const button of tab.querySelectorAll(".ww-cats [data-ww-cat]") ) {
    button.setAttribute("aria-pressed", String(button.dataset.wwCat === category));
  }
}

/**
 * Gather weight, attunement and coins into one bar along the bottom of the tab.
 * @param {HTMLElement} tab
 * @param {HTMLElement} inventory
 * @param {HTMLElement|null} attunement  The attunement block, for characters; null for containers.
 * @param {string} weightLabel           "Carried" for a character, "Capacity" for a container.
 */
function buildFooter(tab, inventory, attunement, weightLabel) {
  if ( tab.querySelector(".ww-footer") ) return;
  const encumbrance = tab.querySelector(".top .encumbrance") ?? inventory.querySelector(".bottom .encumbrance");
  const parts = [
    encumbrance ? carriedBlock(encumbrance, weightLabel) : null,
    attunement,
    inventory.querySelector("section.currency")
  ].filter(Boolean);
  if ( !parts.length ) return;

  const footer = document.createElement("div");
  footer.className = "ww-footer";
  footer.append(...parts);
  tab.append(footer);
}

/**
 * Wrap dnd5e's encumbrance or capacity meter with a "Carried 35 / 150" line above it, read from the meter's own label.
 * @param {HTMLElement} encumbrance
 * @param {string} label  The localization key for the line's label.
 * @returns {HTMLElement}
 */
function carriedBlock(encumbrance, label) {
  const value = encumbrance.querySelector(".label .value")?.textContent.trim();
  const max = encumbrance.querySelector(".label .max")?.textContent.trim();
  const block = document.createElement("div");
  block.className = "ww-carried";
  block.innerHTML = `
    <div class="ww-carried-head">
      <span class="ww-carried-label">${t(label)}</span>
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
 * @param {function(string): Item} find  Looks up an item shown on this sheet by id.
 * @param {HTMLElement} tab
 * @param {HTMLElement} inventory
 * @param {object} state
 */
function injectDetailPanel(find, tab, inventory, state) {
  if ( inventory.querySelector(".ww-detail") ) return;
  const panel = document.createElement("aside");
  panel.className = "ww-detail";
  panel.setAttribute("aria-label", t("Details"));
  inventory.append(panel);

  const list = inventory.querySelector(".items-list");
  const show = foundry.utils.debounce(id => showDetail(find, tab, panel, id, state), 60);
  const onEnter = event => {
    const id = event.target.closest("li.item[data-item-id]")?.dataset.itemId;
    if ( id && (id !== state.selected) ) show(id);
  };
  list?.addEventListener("pointerover", onEnter);
  list?.addEventListener("focusin", onEnter);

  const first = (state.selected && find(state.selected)) ? state.selected
    : list?.querySelector("li.item[data-item-id]")?.dataset.itemId;
  if ( first ) showDetail(find, tab, panel, first, state);
  else panel.innerHTML = `<p class="ww-detail-empty">${t("NoItem")}</p>`;
}

/**
 * Fill the detail panel with an item's details and Witchwind actions.
 * @param {function(string): Item} find  Looks up an item shown on this sheet by id.
 * @param {HTMLElement} tab
 * @param {HTMLElement} panel
 * @param {string} itemId
 * @param {object} state
 */
async function showDetail(find, tab, panel, itemId, state) {
  const item = find(itemId);
  if ( !item ) return;
  state.selected = itemId;
  for ( const li of tab.querySelectorAll("li.item[data-ww-selected]") ) delete li.dataset.wwSelected;
  tab.querySelector(`li.item[data-item-id="${itemId}"]`)?.setAttribute("data-ww-selected", "");

  // Hovering quickly across slots starts several loads; only the latest one gets to draw.
  const request = state.detailRequest = (state.detailRequest ?? 0) + 1;
  const html = await cachedDetailHTML(item, state);
  if ( (request !== state.detailRequest) || !panel.isConnected ) return;

  panel.dataset.wwRarity = rarityOf(item);
  panel.innerHTML = html;
  fitPicture(panel.querySelector(".ww-d-pic img"));

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

  // Something with nothing to activate (a passive feature, plain loot) just posts its card to chat.
  const useLabel = !item.system.activities?.size ? "ToChat" : (item.type === "spell") ? "Cast" : "Use";
  addAction(t(useLabel), true, event => item.use({ event }));
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
 * The panel contents for an item, reused while the item is unchanged so hovering back and forth
 * doesn't re-enrich its description every time.
 * @param {Item} item
 * @param {object} state
 * @returns {Promise<string>}
 */
function cachedDetailHTML(item, state) {
  const key = `${item.id}:${item._stats?.modifiedTime ?? ""}`;
  let html = state.details.get(key);
  if ( !html ) {
    html = detailHTML(item).catch(error => {
      console.error(`${MODULE_ID} | Couldn't build details for ${item.name}`, error);
      state.details.delete(key);
      return `<div class="ww-detail-scroll"><h3 class="ww-d-name">${esc(item.name)}</h3></div>`;
    });
    state.details.set(key, html);
    if ( state.details.size > 60 ) state.details.delete(state.details.keys().next().value);
  }
  return html;
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
  // Spells: level and school ("1st Level · Evocation"). Everything else: rarity, type, and where a
  // feature comes from ("Feature · Fighter 1").
  const subtitle = (item.type === "spell") ? [labels.level, labels.school].filter(isText).join(" · ") : [
    rarity === "mundane" ? "" : loc(CONFIG.DND5E.itemRarity?.[rarity]),
    system.type?.label || loc(CONFIG.Item.typeLabels?.[item.type]),
    (!concealed && isText(system.requirements)) ? system.requirements : ""
  ].filter(Boolean).join(" · ");
  const key = concealed ? null : headlineStat(item, labels);
  const stats = concealed ? physicalStats(item) : [
    ...actionStats(item, labels, key), ...spellStats(item, labels), ...combatStats(item, labels),
    ...physicalStats(item), ...stateStats(item, key)
  ];
  const description = await enrich(concealed ? system.unidentified?.description : system.description?.value, item);

  return `
    <div class="ww-detail-scroll">
      <header class="ww-d-head">
        <h3 class="ww-d-name">${esc(name)}</h3>
        ${subtitle ? `<p class="ww-d-sub">${esc(subtitle)}</p>` : ""}
      </header>
      <div class="ww-d-rule" aria-hidden="true"><span></span></div>
      <div class="ww-d-key">
        <span class="ww-d-pic"><img src="${esc(item.img)}" alt=""></span>
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
  const damages = labels.damages ?? [];
  const damage = damages.map(d => {
    const type = loc(CONFIG.DND5E.damageTypes?.[d.damageType]) || loc(CONFIG.DND5E.healingTypes?.[d.damageType]);
    return [d.formula, type?.toLowerCase()].filter(Boolean).join(" ");
  }).filter(Boolean);
  if ( damage.length ) {
    const heals = damages.every(d => d.damageType in (CONFIG.DND5E.healingTypes ?? {}));
    const label = heals ? "Healing" : ["weapon", "spell"].includes(item.type) ? "Damage" : "Effect";
    return { label: t(label), value: damage.join(", ") };
  }
  if ( (item.type === "weapon") && labels.damage ) {
    return { label: t("Damage"), value: [labels.damage, labels.damageTypes?.toLowerCase()].filter(Boolean).join(" ") };
  }
  if ( (item.type === "equipment") && system.armor?.value ) return { label: t("ArmorClass"), value: armorText(system) };
  if ( (item.type === "tool") && system.ability ) {
    return { label: t("Check"), value: loc(CONFIG.DND5E.abilities?.[system.ability]) };
  }
  if ( system.uses?.max ) return { label: t("Uses"), value: usesText(item) };
  if ( isText(labels.save) ) return { label: t("Save"), value: labels.save };
  if ( isText(labels.activation) && !("quantity" in system) ) return { label: activationLabel(item), value: labels.activation };
  return null;
}

/** Range, or reach for melee weapons. */
function rangeStats(item, labels) {
  const range = item.system.range;
  if ( isText(labels.range) ) return [[t("Range"), labels.range]];
  if ( range?.reach ) return [[t("Reach"), `${number(range.reach)} ${range.units ?? ""}`.trim()]];
  return [];
}

/** Spells are cast; features are activated. */
function activationLabel(item) {
  return t(item.type === "spell" ? "CastingTime" : "Activation");
}

/** Components (with materials), concentration and ritual tags, and the save a spell calls for. */
function spellStats(item, labels) {
  if ( item.type !== "spell" ) return [];
  const stats = [];
  const components = labels.components;
  const parts = isText(components?.full) ? components.full : components?.vsm;
  if ( isText(parts) ) stats.push([t("Components"), parts]);
  if ( components?.tags?.length ) stats.push([t("Tags"), components.tags.join(", ")]);
  return stats;
}

/** "2 / 3 · Long Rest": uses left and how they come back. */
function usesText(item) {
  const { value = 0, max } = item.system.uses;
  return [`${value} / ${max}`, isText(item.labels?.recovery) ? item.labels.recovery : ""].filter(Boolean).join(" · ");
}

function isText(value) {
  return (typeof value === "string") && (value.trim() !== "");
}

/** How a feature is used: activation, target and duration. Gear skips these; prerequisites are in the subtitle. */
function actionStats(item, labels, key) {
  if ( "quantity" in item.system ) return [];
  const stats = [];
  const activation = activationLabel(item);
  if ( isText(labels.activation) && (key?.label !== activation) ) stats.push([activation, labels.activation]);
  stats.push(...rangeStats(item, labels));
  if ( isText(labels.target) ) stats.push([t("Target"), labels.target]);
  if ( isText(labels.duration) ) stats.push([t("Duration"), labels.duration]);
  if ( isText(labels.save) && (key?.label !== t("Save")) ) stats.push([t("Save"), labels.save]);
  return stats;
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
  // Spells and features list range with their casting details instead (see actionStats).
  if ( "quantity" in system ) stats.push(...rangeStats(item, labels));
  // A spell's properties are its components and tags, already listed by spellStats.
  const properties = (item.type === "spell") ? [] : (labels.properties ?? []).map(p => p.label).filter(Boolean);
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

/** Charges, recharge, attunement and whether it's equipped. */
function stateStats(item, key) {
  const system = item.system;
  const stats = [];
  if ( system.uses?.max && (item.type !== "tool") && (key?.label !== t("Uses")) ) stats.push([t("Uses"), usesText(item)]);
  if ( isText(item.labels?.recharge) ) stats.push([t("Recharge"), item.labels.recharge]);
  if ( system.attunement ) {
    stats.push([t("Attunement"), system.attuned ? t("Attuned") : loc(CONFIG.DND5E.attunementTypes?.[system.attunement])]);
  }
  if ( "equipped" in system ) stats.push([t("Status"), t(system.equipped ? "Equipped" : "Carried")]);
  return stats;
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
  const filter = new MutationObserver(() => scheduleFill(tab));
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
  // Only the inventory and container contents are grids; the Features list never gets empty slots.
  if ( !GRID_TABS.includes(tab?.dataset.tab) ) return;
  const list = tab.querySelector(".inventory-element .items-list");
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
  // A container window sizes itself to its contents, so only the character sheet grows to fill its space.
  const scroller = (tab.dataset.tab === "inventory") ? scrollParent(tab) : null;
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

/** Ask for a fillSlots pass on the next frame, folding repeated requests from one burst of changes into one. */
const pendingFills = new Set();
function scheduleFill(tab) {
  if ( !tab || pendingFills.has(tab) ) return;
  pendingFills.add(tab);
  requestAnimationFrame(() => {
    pendingFills.delete(tab);
    fillSlots(tab);
  });
}

/* -------------------------------------------- */
/*  Picture fitting                             */
/* -------------------------------------------- */

/**
 * Fit every slot picture in a tab to its visible content.
 * @param {HTMLElement} root
 */
function fitPictures(root) {
  for ( const img of root.querySelectorAll(".items-list li.item img.item-image") ) fitPicture(img);
}

/**
 * Size and place a picture inside its slot from where its visible content sits. Measurements are
 * cached by URL, so each picture is read once per session and re-renders apply the fit immediately.
 * @param {HTMLImageElement} img
 */
function fitPicture(img) {
  const src = img?.getAttribute("src");
  if ( !src ) return;
  const known = pictureFits.get(src);
  if ( known instanceof Promise ) known.then(fit => applyFit(img, fit));
  else if ( known !== undefined ) applyFit(img, known);
  else {
    const pending = measurePicture(src).then(fit => {
      pictureFits.set(src, fit);
      return fit;
    });
    pictureFits.set(src, pending);
    pending.then(fit => applyFit(img, fit));
  }
}

/**
 * Pictures painted on their own background cover the slot with that background; cut-out objects
 * on transparency are shown whole, as large as the slot allows, so long thin ones aren't cropped away.
 * @param {HTMLImageElement} img
 * @param {object|null} fit
 */
function applyFit(img, fit) {
  if ( !fit || !img.isConnected ) return;
  const { width, height, x, y, w, h, filled } = fit;
  const span = filled ? Math.min(w * width, h * height) : Math.max(w * width, h * height) / (1 - (2 * PICTURE_PADDING));
  const centerX = (x + (w / 2)) * width;
  const centerY = (y + (h / 2)) * height;
  img.style.setProperty("--ww-fit-w", `${(width / span) * 100}%`);
  img.style.setProperty("--ww-fit-h", `${(height / span) * 100}%`);
  img.style.setProperty("--ww-fit-x", `${50 - ((centerX / span) * 100)}%`);
  img.style.setProperty("--ww-fit-y", `${50 - ((centerY / span) * 100)}%`);
  img.classList.add("ww-fit");
}

/**
 * Load a picture and find the box around its visible pixels.
 * @param {string} src
 * @returns {Promise<object|null>}  The content box as fractions of the picture, or null when it can't be read.
 */
function measurePicture(src) {
  return new Promise(resolve => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onerror = () => resolve(null);
    image.onload = () => {
      // A picture from another site without permission to read it throws here, and keeps the plain crop.
      try { resolve(contentBox(image)); } catch { resolve(null); }
    };
    image.src = src;
  });
}

function contentBox(image) {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if ( !width || !height ) return null;
  const scale = Math.min(1, PICTURE_SAMPLE / Math.max(width, height));
  const cw = Math.max(1, Math.round(width * scale));
  const ch = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, cw, ch);
  const { data } = context.getImageData(0, 0, cw, ch);

  let x0 = cw, y0 = ch, x1 = -1, y1 = -1, solid = 0;
  for ( let py = 0; py < ch; py++ ) {
    for ( let px = 0; px < cw; px++ ) {
      if ( data[(((py * cw) + px) * 4) + 3] < PICTURE_ALPHA ) continue;
      solid++;
      if ( px < x0 ) x0 = px;
      if ( px > x1 ) x1 = px;
      if ( py < y0 ) y0 = py;
      if ( py > y1 ) y1 = py;
    }
  }
  if ( x1 < 0 ) return null;
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  return { width, height, x: x0 / cw, y: y0 / ch, w: bw / cw, h: bh / ch, filled: (solid / (bw * bh)) >= PICTURE_FILLED };
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
  for ( const id of GRID_TABS ) scheduleFill(element.querySelector(`.tab[data-tab="${id}"]`));
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

/** Scroll containers already found, per inventory tab element (a fresh element each render). */
const scrollParents = new WeakMap();

/** The nearest ancestor that scrolls vertically, which is the space the inventory can grow into. */
function scrollParent(element) {
  if ( scrollParents.has(element) ) return scrollParents.get(element);
  let found = null;
  for ( let el = element?.parentElement; el && !el.classList.contains("application"); el = el.parentElement ) {
    if ( /auto|scroll/.test(getComputedStyle(el).overflowY) ) {
      found = el;
      break;
    }
  }
  if ( element ) scrollParents.set(element, found);
  return found;
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
    // Only item cards; small hints in the list (such as the uses pips) still show.
    const source = game.tooltip.element;
    if ( source?.closest?.(".ww-theme .tab.ww-docked .items-list") && source.closest(".item-tooltip, [data-ww-tooltips]") ) {
      game.tooltip.deactivate();
    }
  }).observe(tooltip, { attributeFilter: ["class"] });
}

function applyTooltipStyle() {
  const style = game.settings.get(MODULE_ID, "tooltipStyle");
  document.body.classList.toggle("ww-tooltip-parchment", style === "parchment");
  document.body.classList.toggle("ww-tooltip-steel", style === "steel");
}
