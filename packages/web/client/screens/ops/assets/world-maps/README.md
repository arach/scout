# Fleet map materials

The sculpted garden material set is consumed by `WorldTerrain.tsx` and
`GardenFoundation.tsx`. These assets supply painted detail; shoreline geometry,
terraces, crew, camera and selection remain live app state.

- `garden-meadow-v3.webp`: 1254 × 1254 quiet opaque grass material.
- `garden-water-v2.webp`: 1254 × 1254 opaque broad caustic material.
- `garden-limestone-v2.webp`: 1254 × 1254 quiet unjointed limestone material.
- `garden-stone-v3.webp`: 1254 × 1254 quiet weathered limestone cliff material.
- `garden-rim-material.webp`: 1254 × 1254 opaque planted rock-edge material.
- `garden-bank.webp`: 1536 × 1024 shoreline scenery with preserved alpha.

Created with the built-in image generation tool on 2026-10-03, using the approved
Studio `sculpted-garden-stars.png` as a style reference for the original set and
water, limestone and rock refinements. The quieter grass and planted rock lip
are new materials in the same painterly style. Masters remain in the
local generated-image archive. Production files are WebP at quality 90, with no
resampling or creative changes during conversion. The exact generation prompts
are recorded in `garden-prompts.json`.

Meadow patterns share a world origin across chunks; two incommensurate rotated
periods reduce repetition. Cached texture pyramids supply smooth minification
as the camera pulls back. Water uses a low-contrast caustic pattern over a depth
gradient. The application supplies paving joints once, over unjointed limestone.

The landscape uses one continuous interpolated contour around real workspace
terraces and connecting paths. The ground clip and rock extrusion share it.
Stone wraps continuously along the contour, with local side lighting and depth
shading. The shallow foundation has even thickness across separate lobes.
The darker grass lip is clipped to land; low planting accents sit inside the
forward shoreline in irregular groups. The background remains neutral black.

The third composition pass adds two generated sprites with preserved alpha:

- `garden-grove.webp`: 1254 × 1254, three sunlit trees with a small botanical base.
- `garden-planted-lip.webp`: 1909 × 824, low shrubs, grasses, limestone and vines.

The grove uses WebP quality 92; the low planting uses quality 90. Neither was
resampled. The low planting takes its painterly style from the approved Studio
reference. Both alpha channels contain fully transparent and opaque pixels;
there is no opaque background or green haze. Exact prompts and master filenames
are recorded in `garden-prompts.json` under `round3`.

Cached contours and canvas paths survive roster status updates. Each ground
chunk paints only its visible region; only shore chunks paint the lip. Small
planting accents are omitted at the count-only zoom level. Sprite culling leaves
room for the full crowns rather than testing just their feet. Fit includes the
living landscape, tree crowns and rock depth; the minimap uses the same center.

The other map textures and landmarks in this directory preserve the existing
continuous terrain and daylight/engraved map collection.
The original `garden-meadow.webp` adds a restrained botanical detail pass over
the quieter refined grass. The original `garden-stone.webp`, `garden-stone-v2.webp` and planted rock
material remain as saved material studies. The quieter third stone material was
generated with the built-in image tool and converted to WebP quality 90 without
resampling; its exact prompt and master are recorded under `round4`.
