# Amy Gray Wall Art — Mock-Up Creator

Design to-scale wall art groupings for clients, priced straight from the
Amy Gray Photography [price guide](https://amygrayphotography.sproutstudio.com/pricing/price-guide).
Runs entirely in the browser — **client photos never leave your computer**.

## Use it

Open `index.html` in any browser (or the GitHub Pages link on this repo).

1. **Add photos** — drag image files in, or click *+ Add photos*.
2. **Pick a wall** — the four standard presets (tall/stairwell, sofa, bed,
   hallway) with furniture for scale, or *Custom* with any dimensions.
   Or click *Use photo…* and load a photo of the client's actual wall —
   ask them to tape a **credit card or dollar bill** to the wall and shoot
   straight on. Then *Set scale*: zoom in, click the card's two ends, and
   pick the built-in credit-card (3.37″) or dollar-bill (6.14″) reference.
3. **Templates…** offers eight suggested layouts (gallery wall, triptych,
   anchor & four, the six, and more) sized to fit each wall's hanging zone —
   pick one and swap your photos in.
4. **Drag photos onto the wall.** Each piece can be any product and size in
   the catalog — Canvas & Floating Gallery Wraps, Metal, Framed Fine Art
   (with real mat + print sizes), Acrylic Float Frames, Giclee prints — all
   rendered to scale with the right frames, mats and float gaps.
4. Pieces **snap** to each other, to even gaps, and to the recommended
   hanging zone. Arrange buttons line everything up as a row, column, or grid.
5. **Pricing** updates live from the Sprout price guide, with an optional
   percentage coupon.
6. **Export PNG** for a client-ready to-scale mock-up, and **Save/Open** to
   keep editable designs (photos are embedded in the file).

Shortcuts: arrows nudge 1″ (Shift = ¼″) · Delete removes · Cmd+D duplicates ·
Cmd+Z / Shift+Cmd+Z undo & redo · hold Alt while dragging to disable snapping.

## When prices change

Re-scrape the price guide (see the `agp-wall-art` toolkit's
`scripts/scrape_catalog.js`), replace `catalog.json`, then:

```
python3 embed_data.py
```

Wall presets live in `walls.json` (`w`, `h`, hanging `zone`, optional
`furniture`) — same format as the toolkit.

## Files

| file | what it is |
|---|---|
| `index.html` / `style.css` / `app.js` | the whole app — no build step, no dependencies |
| `catalog.json` | every product/size/price from the Sprout price guide |
| `walls.json` | the standard wall presets |
| `data.js` | the two JSONs embedded as JS (generated) |
| `embed_data.py` | regenerates `data.js` |

Fonts are Lora + Jost from Google Fonts (the amygrayphotography.com pairing);
offline it falls back to system serif/sans.
