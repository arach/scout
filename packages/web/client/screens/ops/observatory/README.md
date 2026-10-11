# Observatory preview

An opt-in isometric Fleet experiment at `/ops/world#observatory`.
The normal Fleet URL still mounts `AgentFloorView` and `SharedWorkFloor`.
The only integration is a lazy branch in `AgentLanesView`; remove that branch
and this directory to discard the experiment. No new worktree is needed.

The preview inherits Scout's web design system and the approved Ring Observatory
artwork. It is an operational scene: black stars, upright crew, clear handles,
and minimal controls. It does not redefine the product's design system.

## Boundaries

- Live roster and observed exchange data are read through existing adapters.
- Existing pure grouping/affinity helpers are reused without modification.
- Camera and interaction state belong to this component. Styles use a CSS module.
- Layout writes use only `openscout:observatory-preview:layout:v1`; production
  island, room, artwork and projection preferences are never read or migrated.
- No broker writes, new agents, or synthetic roster entries.
- Host rail selection handlers are installed only while this view is mounted.

## Scene contract

`scene-model.ts` owns bounded artwork sizes, rooms, seats, saved placements and
camera math. Three composed sizes share the current illustration; these are not
three newly authored artworks. More than three rooms adds a connected platform
belonging to the same workspace instead of stretching the entire island.
Authored seats provide the initial layout. Agents and whole rooms can then be
placed freely, including outside the artwork. A direct drop near another actor
exchanges their exact positions; a drop near another room’s center exchanges the
two groups. Other drops retain their exact coordinates. Room centers are stored
relative to the island, and free actors relative to their room, so moving a parent
carries its members. Moving through space preserves workspace membership; an
agent placed within another room on the same island joins that room. Explicit
placement retains room membership across roster shrink and reload.

`useSceneInteraction.ts` owns pointer capture. It picks once at press and freezes
the scene until release. Characters and room grips take priority over the island’s
broad exposed stone surface and rim; the nameplate remains an additional handle.
The island hit silhouette excludes the transparent sky around the illustration. Hover/focus highlights the
exact target and its affected members. During drag, a landing marker and text
distinguish free placement, a person exchange, and a whole-room exchange. Empty
sky pans. Pointer cancellation,
lost capture, Escape and window blur discard the pending object movement.
Trackpad scroll pans; pinch or Control/Command-wheel zooms around its anchor.
Two-finger touch cancels a pending object drag and begins camera pinch.

Keyboard: Enter selects an object; arrow keys move islands, exchange rooms, or
change a character's seat. The inspector also offers room/position selectors.
At distant zoom, zoom in to pick individual agents or select one through the Fleet rail.

`ObservatoryFloor.tsx` adapts the live feed and renders the scene. It deliberately
has no Flat view, material selector, character-family controls, or Studio tools.
The return link leaves the preview without changing the original floor settings.

Tests cover bounded growth, complete rosters, affinity grouping, stable ordering,
seat and room exchange, persistence parsing, ellipse hit targets and anchored zoom.

## Activity and travel

Selecting an agent opens a bottom-right activity preview until it is dismissed or
another object is selected. Hover adds a transient overhead preview; clicking never
pins that bubble. Both use the latest timestamped substantive events in the loaded
observe history, even for idle/completed agents and events older than the current
activity window. If no events are available, the last reported task is explicitly
untimed. They do not imply that the latest recorded action is still running.

Fleet rail selection flies to an agent. Its context menu offers Fly to agent and
Open activity. Camera travel pulls back between distant destinations and honors
reduced motion. Off-screen island hints are clickable destinations.
The lower-left minimap uses the scene's already-projected coordinates, shows the
camera frame, and stays oriented while travelling. Select an island dot to fly
there, drag the frame or map to pan, and scroll to zoom. Arrow keys pan a focused
minimap; plus/minus zoom. Drag geometry is frozen until release. Minimap bounds
and Fit include freely placed rooms and agents; room navigation includes all
members, even when they are outside the island artwork.

## Explicit spaces and communication

Select an island nameplate or room grip and choose **Create room** to add an empty
space at any roster size. Explicit room names and memberships are saved with the
preview layout, retain empty rooms, and survive reload and roster shrink. Newcomers
join a room with capacity, preferring observed collaborators. Additional rooms use
the same bounded connected-platform geometry.

Parent/subagent lineage does not define room affinity or map lines. Only observed
messages contribute to collaboration grouping. Communication uses one subtle
arrow per pair, pointing in the latest message's direction; the overview shows
at most twelve recent pairs, and focusing a person or group shows up to twenty-four
relevant pairs. Clicking an arrow opens the recorded exchange.

The Fleet rail follows the scene's exact island and room membership. Identically
named workspaces stay separate by their full scene identity. Island and room
headings fly to that area; separate chevrons fold islands and rooms without moving
the camera. Collapse state uses full island/room identities and survives live
roster updates within the mounted rail. Agent rows retain their fly-to and context actions.
Room moves republish membership even when identity and activity are unchanged.
Empty rooms remain on the map; the Fleet rail lists occupied areas.
Room outlines and projected stone grips appear on hover, keyboard focus, selection,
or a pending drop. Hidden grips do not receive pointer hits; hovering the floor
reveals a grip while exposed stone remains an island drag target. Touch-only devices
keep grips visible. Empty rooms retain a quiet marker so they remain discoverable. The small, shallow
inlay follows the rising-right floor axis, with the
transformed button itself defining the hit area. The island nameplate sits on its front rim
so it remains reachable in the usual close view.
