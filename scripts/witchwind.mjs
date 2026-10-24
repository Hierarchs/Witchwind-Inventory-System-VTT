const MODULE_ID = "witchwind-inventory";
const SLOT_MIN = 44;
const SLOT_MAX = 80;
const SLOT_STEP = 4;

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
 * Theme a character or NPC sheet and decorate its inventory tab after each render.
 * @param {ApplicationV2} app
 * @param {HTMLElement} element
 */
function onRenderActorSheet(app, element) {
  element.classList.add("ww-sheet");
  const enabled = game.settings.get(MODULE_ID, "enabled");
  element.classList.toggle("ww-theme", enabled);
  if ( !enabled ) return;

  const tab = element.querySelector('.tab[data-tab="inventory"]');
  if ( !tab ) return;
  annotateItems(app.actor, tab);
  injectControls(tab);
  applySheetState(element);
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
    const { rarity, equipped, attuned, quantity, identified } = item.system;

    // An unidentified item's frame would reveal that it's magical, so keep it neutral for players.
    const concealed = (identified === false) && !game.user.isGM;
    el.dataset.wwRarity = (!concealed && rarity) ? rarity : "mundane";
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

  const t = key => game.i18n.localize(`WITCHWIND.${key}`);
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
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

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
