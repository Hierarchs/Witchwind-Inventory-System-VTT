# Witchwind Inventory

A restyle of dnd5e character and NPC sheets, inspired by The Witcher 3 and Morrowind.

- **Whole sheet.** Dark leather and gold replace dnd5e's banner art and blue-grey theme: a leather header with a double gold rule, Cinzel headings, and brown panels on every tab and the sidebar. Works whether Foundry is set to light or dark.
- **Slot grid.** Items become square slots on dark leather, framed by rarity (uncommon green, rare blue, very rare purple, legendary orange, artifact red). A gold diamond marks equipped items, a violet star marks attuned ones, and stack sizes sit in the corner.
- **Category tabs.** All, Weapons, Equipment, Consumables, Tools and Loot filter the grid. Empty slots pad it out to the bottom of the sheet.
- **Pictures fill their slots.** Each picture is measured once: art on its own background is zoomed to fill the slot, and cut-out objects are shown whole at the largest size that fits, ignoring any transparent margins.
- **Legendary and artifact glow.** Their slots carry a slowly breathing orange or red halo. Animations are short and switch off if your system asks for reduced motion.
- **Detail panel.** When the sheet is wide enough, a parchment panel beside the grid shows the item you're hovering, with Use, Equip and Attune buttons. On narrower sheets the hover card does the same job.
- **Features tab.** Kept as a list, in the same dark panel. Limited uses show as pips you can click to spend or restore, class badges become leather plaques, and the detail panel shows a feature's activation, target, duration, uses and recovery, requirements and description.
- **Spells tab.** The same treatment: gold figures on the spellcasting cards, gold slot pips, and a detail panel with level and school, casting time, range, target, duration, components, concentration or ritual, damage or healing, and a Cast button.
- **Effects and Biography.** Effects use the same list styling; active conditions glow gold. The biography reads as a parchment page with a double gold rule, with the editing toolbar on leather above it.
- **Bags and other containers.** A container's own window gets the leather header and the same slot grid for its contents, with a footer showing its capacity and coins.
- **Item sheets.** Weapons, spells, feats and every other item window get the leather header and theme; descriptions read as parchment pages.
- **Footer.** Carried weight, attunement, total worth and coins sit in one bar along the bottom. The weight bar turns amber when encumbered, orange when heavily encumbered and red when over the limit.
- **Quick handling.** Double-click an item to equip or unequip it (a single click still uses it). Order the grid by type, rarity or value from the toolbar. Hover a bag in the top strip to peek at what's inside without opening it.
- **Sounds (off by default).** A soft clink on equipping and coins when money changes, made in the browser and following Foundry's interface volume.
- **Compare and spot new loot.** Hovering an unequipped weapon or armor shows how it compares with what's equipped (average damage, or armor class with your Dexterity). Items you haven't looked at yet carry a small gold dot until you hover them.
- **Resizable.** A slider on the inventory tab sets the slot size (44 to 80 px). Each player's choice is saved on their own device.
- **Grid or list.** A toggle switches back to dnd5e's rows, restyled to match.
- **Parchment item cards.** Hovering an item shows dnd5e's item card on parchment with a double gold rule. It can be switched to a dark steel style or the dnd5e default.

Everything else is dnd5e's own behavior: click to use, drag and drop, right-click menus, search, sort and filters all work as normal. Unidentified items show a neutral frame to players so rarity doesn't give them away.

## Requirements

- Foundry VTT v14
- dnd5e 6.0 or newer

## Installing

Install it from this manifest URL (Foundry's **Install Module** dialog, or your host's module manager):

```
https://raw.githubusercontent.com/Hierarchs/Witchwind-Inventory-System-VTT/main/module.json
```

Then enable **Witchwind Inventory** in your world's module settings.

## License

The module's code is under the [MIT License](LICENSE). The bundled fonts are under the SIL Open Font License 1.1; each license is in `fonts/`.

## Releasing a new version

1. Bump `version` in `module.json`.
2. Run `build.ps1` to rebuild `dist/witchwind-inventory.zip`.
3. Commit and push. Foundry will offer the update the next time it checks.

## Settings

Under **Configure Settings > Witchwind Inventory**:

| Setting | What it does |
|---|---|
| Restyle sheets | Turns the sheet restyle on or off for you. |
| Slot size | Default slot size in grid view. |
| Item card style | Parchment, Steel, or dnd5e default. |
| Sounds | Equip and coin sounds. Off by default. |

## Notes

- The fonts (Cinzel, Alegreya, Alegreya Sans) are bundled with the module, so the look doesn't depend on an internet connection.
- Character and NPC sheets are restyled. Vehicle and group sheets are untouched.
