// Scoped under .wm — generated from the HTML study, edit freely.
export const CSS = "\n.wm {\n  --bg: var(--wm-ground);\n  --fg: var(--wm-ink);\n  --dim: var(--wm-dim);\n  --faint: var(--wm-faint);\n  --line: var(--wm-line);\n  --accent: var(--wm-accent);\n  --accent-dim: var(--wm-accent-dim);\n  --gap: 10px;\n}\n.wm, .wm * { box-sizing: border-box; margin: 0; padding: 0; }\n.wm { height: 100%; }\n.wm {\n  background: radial-gradient(120% 90% at 50% 40%, var(--wm-ground-lift) 0%, var(--bg) 70%);\n  color: var(--fg);\n  font: 300 10px/1.4 var(--wm-font), ui-monospace, \"SF Mono\", Menlo, monospace;\n  letter-spacing: 0.04em; overflow: hidden; -webkit-font-smoothing: antialiased; font-variant-numeric: tabular-nums;\n}\n.wm::after { content: \"\"; position: absolute; inset: 0; pointer-events: none; z-index: 20; background: repeating-linear-gradient(0deg, var(--wm-veil) 0 1px, transparent 1px 3px); }\n.wm #grain { position: absolute; inset: 0; pointer-events: none; opacity: var(--wm-grain); mix-blend-mode: var(--wm-grain-blend); z-index: 21; background-size: 160px 160px; }\n\n.wm .frame { height: 100%; display: grid; grid-template-columns: 320px minmax(0, 1fr) 340px; grid-template-rows: 44px minmax(0, 1fr) 20px; gap: var(--gap); padding: 12px 16px; }\n.wm .top { grid-column: 1 / -1; display: grid; grid-template-columns: 320px minmax(0,1fr) 340px; gap: var(--gap); align-items: center; border-bottom: 1px solid var(--line); position: relative; }\n.wm .top::after { content: \"\"; position: absolute; left: 0; bottom: -1px; width: 140px; height: 1px; background: var(--fg); }\n.wm .brand { display: flex; align-items: center; gap: 12px; }\n.wm .brand svg { width: 28px; height: 28px; flex: none; }\n.wm .brand svg circle { stroke: var(--wm-accent); }\n.wm .brand b { display: block; font-size: 17px; letter-spacing: 0.34em; font-weight: 300; }\n.wm .brand small { display: block; font-size: 7.5px; letter-spacing: 0.3em; color: var(--dim); }\n.wm .ticker { display: flex; justify-content: center; gap: 30px; color: var(--dim); font-size: 9px; white-space: nowrap; overflow: hidden; }\n.wm .ticker b { font-weight: 300; color: var(--fg); }\n.wm .clock { display: flex; justify-content: flex-end; align-items: center; gap: 18px; }\n.wm .clock small { display: block; color: var(--dim); font-size: 8px; letter-spacing: 0.2em; text-align: right; }\n.wm .clock b { display: block; font-size: 18px; font-weight: 300; letter-spacing: 0.12em; text-align: right; }\n.wm .legend { display: grid; grid-template-columns: repeat(2, auto); gap: 2px 12px; color: var(--dim); font-size: 8px; }\n.wm i.sq { display: inline-block; width: 6px; height: 6px; background: var(--wm-ok); margin-right: 5px; }\n.wm i.sq.acc { background: var(--wm-warn); }\n.wm i.sq.hol { background: none; border: 1px solid var(--dim); }\n.wm i.sq.x { background: none; position: relative; }\n.wm i.sq.x::before, .wm i.sq.x::after { content: \"\"; position: absolute; left: -1px; top: 2.5px; width: 8px; height: 1px; background: var(--fg); transform: rotate(45deg); }\n.wm i.sq.x::after { transform: rotate(-45deg); }\n\n.wm .col { display: flex; flex-direction: column; gap: var(--gap); min-height: 0; }\n.wm .center { display: grid; grid-template-rows: minmax(0, 1fr) 168px; gap: var(--gap); min-width: 0; min-height: 0; }\n.wm .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--gap); min-height: 0; }\n\n.wm .panel { position: relative; border: 1px solid var(--line); min-height: 0; background: linear-gradient(180deg, var(--wm-panel-hi), var(--wm-panel)); padding: 10px 12px; display: flex; flex-direction: column; overflow: hidden; }\n.wm .panel::before, .wm .panel::after { content: \"\"; position: absolute; width: 9px; height: 9px; border: 1px solid var(--fg); pointer-events: none; z-index: 4; transition: width .18s, height .18s, border-color .18s; }\n.wm .panel::before { top: -1px; left: -1px; border-right: 0; border-bottom: 0; }\n.wm .panel::after { bottom: -1px; right: -1px; border-left: 0; border-top: 0; }\n.wm .panel.focus { border-color: var(--wm-accent-dim); }\n.wm .panel.focus::before, .wm .panel.focus::after { border-color: var(--accent); width: 22px; height: 22px; }\n.wm .panel.focus .hd .k { background: var(--accent); color: var(--bg); border-color: var(--accent); }\n.wm .hd { display: flex; align-items: center; gap: 9px; letter-spacing: 0.22em; font-size: 9.5px; margin-bottom: 8px; white-space: nowrap; }\n.wm .hd .k { display: inline-grid; place-items: center; min-width: 13px; height: 13px; padding: 0 2px; border: 1px solid var(--faint); font-size: 7.5px; letter-spacing: 0; color: var(--dim); }\n.wm .hd .r { margin-left: auto; color: var(--faint); font-size: 7.5px; letter-spacing: 0.2em; overflow: hidden; text-overflow: ellipsis; }\n.wm .lbl { color: var(--faint); font-size: 7.5px; letter-spacing: 0.22em; }\n.wm .acc { color: var(--accent); }\n.wm .dim { color: var(--dim); }\n.wm .faint { color: var(--faint); }\n\n.wm .replay { display: grid; grid-template-columns: 92px minmax(0, 1fr) minmax(0, 1fr); gap: 6px 14px; align-items: start; }\n.wm .replay .readout { min-width: 0; }\n.wm .replay .readout .lbl { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.wm .replay .glyph { grid-row: span 2; text-align: center; padding-top: 2px; }\n.wm .replay .glyph b { display: block; font-size: 11px; font-weight: 300; letter-spacing: 0.08em; margin-top: 6px; }\n.wm .replay .glyph small { color: var(--faint); font-size: 7px; letter-spacing: 0.16em; }\n.wm .readout b { display: block; font-size: 16px; font-weight: 300; letter-spacing: 0.06em; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.wm .ctl { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }\n.wm button.chip { font: inherit; font-size: 7.5px; letter-spacing: 0.22em; color: var(--dim); background: none; border: 1px solid var(--line); padding: 3px 7px; cursor: pointer; }\n.wm button.chip kbd { font: inherit; color: var(--faint); margin-left: 5px; }\n.wm button.chip:hover { color: var(--fg); border-color: var(--faint); }\n.wm button.chip:focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; }\n.wm button.chip.on { color: var(--accent); border-color: var(--accent-dim); }\n\n.wm table { width: 100%; border-collapse: collapse; }\n.wm th { text-align: left; color: var(--faint); font-weight: 300; font-size: 7.5px; letter-spacing: 0.2em; padding: 0 6px 5px 0; }\n.wm td { padding: 3.2px 6px 3.2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 0; }\n.wm th.n, .wm td.n { text-align: right; padding-right: 0; }\n.wm tr.lit td { color: var(--accent); }\n.wm tr.sel td { background: var(--wm-sel); }\n.wm tr.sel td:first-child { box-shadow: inset 2px 0 0 var(--fg); padding-left: 6px; }\n.wm tr.idle td { color: var(--dim); }\n.wm .scroll { overflow: hidden; min-height: 0; flex: 1; position: relative; }\n\n.wm .lanes { display: grid; gap: 6px; }\n.wm .lane-row { display: grid; grid-template-columns: 14px minmax(0,1fr) auto; gap: 1px 8px; align-items: center; padding: 1px 0; }\n.wm .lane-row .ix { color: var(--faint); font-size: 7.5px; }\n.wm .lane-row .nm { letter-spacing: 0.08em; text-transform: uppercase; font-size: 8.5px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.wm .lane-row .spark { width: 110px; height: 12px; display: block; }\n.wm .lane-row.sel { background: var(--wm-sel); box-shadow: inset 2px 0 0 var(--fg); }\n.wm .lane-row.solo .nm { color: var(--accent); }\n.wm .lane-row.off { opacity: 0.35; }\n\n.wm canvas.fill { display: block; width: 100%; flex: 1; min-height: 0; }\n\n.wm .world { padding: 0; }\n.wm .world .hd { position: absolute; top: 10px; left: 12px; right: 12px; z-index: 3; }\n.wm .world .cam { position: absolute; top: 30px; left: 46px; z-index: 3; color: var(--dim); font-size: 8.5px; line-height: 1.7; letter-spacing: 0.08em; pointer-events: none; }\n.wm .world .views { position: absolute; top: 30px; right: 14px; z-index: 3; display: flex; gap: 4px; }\n.wm .world .hint { position: absolute; bottom: 10px; left: 46px; z-index: 3; color: var(--faint); font-size: 7.5px; letter-spacing: 0.24em; word-spacing: 0.9em; pointer-events: none; }\n.wm .world .scan { position: absolute; bottom: 10px; right: 14px; z-index: 3; color: var(--dim); font-size: 8.5px; text-align: right; line-height: 1.6; pointer-events: none; }\n.wm #gl, .wm #ov { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }\n.wm #gl { cursor: grab; }\n.wm #gl:active { cursor: grabbing; }\n.wm #ov { pointer-events: none; z-index: 2; }\n\n.wm .log { display: flex; flex-direction: column; gap: 5px; overflow: hidden; flex: 1; }\n.wm .log div { display: grid; grid-template-columns: 70px 1fr; gap: 8px; color: var(--dim); }\n.wm .log div span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg); }\n.wm .log div.open span:last-child { color: var(--accent); }\n.wm .log div.fail span:last-child { color: var(--fg); text-decoration: line-through; text-decoration-color: var(--wm-fail); }\n.wm .log div:nth-child(n+6) { opacity: 0.6; }\n.wm .log div:nth-child(n+10) { opacity: 0.35; }\n\n.wm .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px 10px; margin-bottom: 6px; }\n.wm .metrics b { display: block; font-size: 17px; font-weight: 300; letter-spacing: 0.04em; }\n.wm .metrics small { display: block; color: var(--faint); font-size: 7px; letter-spacing: 0.14em; }\n\n.wm .status { grid-column: 1 / -1; display: flex; gap: 0; align-items: stretch; font-size: 8px; letter-spacing: 0.14em; white-space: nowrap; overflow: hidden; border-top: 1px solid var(--line); }\n.wm .status .mode { background: var(--fg); color: var(--bg); padding: 0 9px; display: flex; align-items: center; letter-spacing: 0.24em; }\n.wm .status .mode.cmd { background: var(--accent); }\n.wm .status .keys { color: var(--dim); padding: 0 12px; display: flex; align-items: center; gap: 14px; overflow: hidden; flex: 1; }\n.wm .status .keys kbd { font: inherit; color: var(--fg); border: 1px solid var(--line); padding: 0 4px; margin-right: 4px; }\n.wm .status .cmdline { flex: 1; display: none; align-items: center; padding: 0 10px; color: var(--fg); }\n.wm .status .cmdline input { font: inherit; letter-spacing: 0.1em; color: var(--fg); background: none; border: 0; outline: 0; flex: 1; caret-color: var(--accent); }\n.wm .status.cmding .keys { display: none; }\n.wm .status.cmding .cmdline { display: flex; }\n.wm .status .msg { color: var(--accent); padding: 0 12px; display: flex; align-items: center; }\n.wm .status .pos { color: var(--faint); padding: 0 0 0 12px; display: flex; align-items: center; }\n\n.wm .help[hidden] { display: none !important; }\n.wm .help { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; background: var(--wm-scrim); backdrop-filter: blur(2px); }\n.wm .help .sheet { position: relative; border: 1px solid var(--line); background: var(--wm-sheet); padding: 18px 22px; width: min(880px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow-y: auto; overflow-x: hidden; }\n.wm .help .sheet::before, .wm .help .sheet::after { content: \"\"; position: absolute; width: 14px; height: 14px; border: 1px solid var(--accent); }\n.wm .help .sheet::before { top: -1px; left: -1px; border-right: 0; border-bottom: 0; }\n.wm .help .sheet::after { bottom: -1px; right: -1px; border-left: 0; border-top: 0; }\n.wm .help h2 { font-weight: 300; font-size: 11px; letter-spacing: 0.3em; margin-bottom: 14px; }\n.wm .help .cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px 26px; }\n.wm .help h3 { font-weight: 300; font-size: 8px; letter-spacing: 0.24em; color: var(--accent); margin-bottom: 6px; }\n.wm .help dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; }\n.wm .help dt kbd { font: inherit; border: 1px solid var(--line); padding: 0 4px; }\n.wm .help dd { color: var(--dim); }\n\n@media (max-width: 1100px) {\n  .wm { overflow: auto; }\n  .wm .frame { height: auto; grid-template-columns: minmax(0,1fr); grid-template-rows: auto; padding-inline: 16px; }\n  .wm .top { grid-template-columns: 1fr auto; padding-bottom: 8px; }\n  .wm .ticker, .wm .legend { display: none; }\n  .wm .center { grid-template-rows: 62vh auto; }\n  .wm .row2 { grid-template-columns: minmax(0,1fr); }\n  .wm .row2 .panel { height: 168px; }\n  .wm .col .panel { flex: none !important; min-height: 180px; }\n  .wm .status { display: none; }\n  .wm .help .cols { grid-template-columns: 1fr; }\n}\n@media (prefers-reduced-motion: reduce) { .wm::after { display: none; } }\n\n.wm .insp { position: absolute; inset: 0; z-index: 6; background: var(--wm-sheet); opacity: 0; transform: translateX(14px); transition: opacity .18s ease, transform .18s ease; }\n.wm .insp.open { opacity: 1; transform: none; }\n.wm .insp[hidden] { display: none !important; }\n.wm .insp .hd .r { display: flex; gap: 4px; overflow: visible; }\n.wm .insp .hd .r .chip { padding: 1px 5px; }\n.wm .ibody { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; scrollbar-color: var(--line) transparent; padding-right: 2px; }\n.wm .ih b { display: block; color: var(--fg); font-weight: 300; font-size: 10px; letter-spacing: .1em; }\n.wm .ih small { display: block; color: var(--faint); font-size: 7.5px; letter-spacing: .16em; margin-top: 3px; }\n.wm .target { color: var(--fg); font-size: 8.5px; line-height: 1.55; word-break: break-all; border: 1px solid var(--line); padding: 6px 8px; margin: 8px 0; max-height: 120px; overflow: auto; }\n.wm .kv { display: grid; grid-template-columns: 96px minmax(0,1fr); gap: 8px; font-size: 8px; padding: 1px 0; }\n.wm .kv span:first-child { color: var(--faint); letter-spacing: .16em; font-size: 7.5px; }\n.wm .kv span:last-child { color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.wm .sec { color: var(--faint); font-size: 7.5px; letter-spacing: .22em; border-top: 1px solid var(--line); padding-top: 6px; margin: 10px 0 4px; }\n.wm .it { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px; padding: 2px 4px; color: var(--dim); cursor: pointer; font-size: 8px; }\n.wm .it span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.wm .it span:last-child { color: var(--faint); }\n.wm .it em { font-style: normal; color: var(--faint); display: inline-block; width: 36px; font-size: 7px; letter-spacing: .12em; }\n.wm .it:hover { color: var(--fg); }\n.wm .it.sel { color: var(--fg); background: var(--wm-hover); box-shadow: inset 0 0 0 1px var(--line); }\n.wm .insp.focus .it.sel { box-shadow: inset 0 0 0 1px var(--accent-dim); }\n.wm .it.acc span:first-child { color: var(--accent); }\n.wm .it.cur span:first-child { color: var(--fg); } .wm .it.cur em { color: var(--accent); }\n.wm .kinds { margin: 8px 0 2px; display: grid; gap: 2px; }\n.wm .kinds div { display: grid; grid-template-columns: 76px minmax(0,1fr) 34px; gap: 8px; align-items: center; font-size: 7.5px; color: var(--dim); letter-spacing: .14em; }\n.wm .kinds i { display: block; height: 3px; background: var(--fg); opacity: .7; min-width: 1px; }\n.wm .kinds span:last-child { text-align: right; color: var(--fg); }\n.wm .spark7 { display: flex; align-items: flex-end; gap: 1px; height: 20px; margin: 4px 0 6px; }\n.wm .spark7 i { flex: 1; background: var(--fg); min-height: 1px; }\n.wm .none { color: var(--faint); font-size: 7.5px; letter-spacing: .14em; padding: 2px 4px; }\n\n.wm { position: fixed; inset: 0 0 28px 0; z-index: 60; overflow: hidden; background: radial-gradient(120% 90% at 50% 40%, var(--wm-ground-lift) 0%, var(--bg) 70%); color: var(--fg); font-family: var(--wm-font), ui-monospace, \"SF Mono\", Menlo, monospace; }\n.wm .frame { height: 100%; }\n.wm a.back { color: var(--faint); text-decoration: none; font-size: 7.5px; letter-spacing: .22em; border: 1px solid var(--line); padding: 2px 6px; margin-left: 10px; }\n.wm a.back:hover { color: var(--fg); border-color: var(--faint); }\n.wm .empty { position: absolute; inset: 0; display: grid; place-items: center; z-index: 30; }\n.wm .empty pre { color: var(--fg); border: 1px solid var(--line); padding: 14px 18px; font: inherit; font-size: 10px; line-height: 1.7; background: var(--wm-float); }\n\n.wm .zoomrail { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); z-index: 3; display: flex; flex-direction: column; gap: 2px; }\n.wm .zoomrail button { font: inherit; font-size: 7.5px; letter-spacing: .2em; color: var(--faint); background: none; border: 0; padding: 4px 0 4px 2px; cursor: pointer; display: flex; align-items: center; gap: 7px; justify-content: flex-end; }\n.wm .zoomrail button i { display: block; width: 8px; height: 1px; background: var(--line); order: 2; transition: width .18s ease, background .18s ease; }\n.wm .zoomrail button:hover { color: var(--fg); }\n.wm .zoomrail button.on { color: var(--accent); }\n.wm .zoomrail button.on i { width: 18px; background: var(--accent); }\n" + `
.wm .pv { position: absolute; top: 54px; right: 96px; bottom: 30px; width: min(46%, 620px); z-index: 4; background: var(--wm-sheet); border: 1px solid var(--line); display: flex; flex-direction: column; }
.wm .pv.big { left: 48px; width: auto; }
.wm .pv[hidden] { display: none; }
.wm .pvh { padding: 8px 10px 7px; border-bottom: 1px solid var(--line); }
.wm .pvh b { display: block; font-weight: 300; font-size: 10px; letter-spacing: .06em; color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wm .pvh small { display: block; font-size: 7.5px; color: var(--faint); letter-spacing: .1em; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: rtl; text-align: left; }
.wm .pvtags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.wm .pvtags span { font-size: 7px; letter-spacing: .16em; color: var(--dim); border: 1px solid var(--line); padding: 1px 5px; }
.wm .pvtags span.acc { color: var(--accent); border-color: var(--accent-dim); }
.wm .pvb { flex: 1; min-height: 0; overflow: auto; scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
.wm .pvb img { display: block; max-width: 100%; margin: 0 auto; }
.wm .pvb iframe { display: block; width: 100%; height: 100%; border: 0; background: var(--wm-stage); }
.wm .pvb pre { font: 300 8.5px/1.65 var(--wm-font), ui-monospace, monospace; color: var(--fg); padding: 8px 10px 8px 0; white-space: pre; tab-size: 2; }
.wm .pvb pre i { font-style: normal; display: inline-block; width: 38px; padding-right: 10px; text-align: right; color: var(--faint); user-select: none; }
.wm .pvb .gone { padding: 16px 12px; color: var(--dim); font-size: 8px; letter-spacing: .1em; }
.wm .pvf { border-top: 1px solid var(--line); padding: 4px 10px; font-size: 7px; letter-spacing: .16em; color: var(--faint); display: flex; gap: 14px; }
.wm .ih .steps { display: flex; gap: 4px; margin-top: 6px; }
.wm .ih .steps .chip { padding: 1px 6px; }
.wm .cmdl { font-size: 8px; color: var(--dim); padding: 1px 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wm .cmdl::before { content: "$ "; color: var(--faint); }

/* ---------- file window ---------- */
.wm .pv { top: auto; right: auto; bottom: auto; width: auto; z-index: 40; resize: both; overflow: hidden; min-width: 280px; min-height: 180px;
  background: var(--wm-sheet); border: 1px solid var(--line); box-shadow: 0 18px 50px var(--wm-shadow); }
.wm .pv.big { resize: none; }
.wm .pv.dragging { opacity: 0.88; }
.wm .pvh { cursor: grab; user-select: none; }
.wm .pv.dragging .pvh { cursor: grabbing; }
.wm .pvt { display: flex; align-items: center; gap: 8px; min-width: 0; }
.wm .pvt b { flex: 1; min-width: 0; }
.wm .pvt .r { display: flex; gap: 4px; flex: none; }
.wm .pvt .chip { padding: 1px 5px; }
.wm .pvb { position: relative; display: flex; flex-direction: column; }
.wm .pvb > iframe { flex: 1; height: auto; }
.wm .pvimg { padding: 12px; display: grid; place-items: start center; }
.wm .pvimg img { max-width: 100%; display: block; }
.wm .fv { flex: 1; min-height: 0; display: flex; flex-direction: column;
  --ink: var(--wm-code-ink); --bg: var(--wm-code-bg); --surface: var(--wm-code-surface); --border: var(--wm-code-border); --muted: var(--wm-code-muted);
  --doc-focus-accent: var(--accent); --font-mono: "SF Mono", ui-monospace, Menlo, monospace; --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
  --text-sm: 10.5px; --text-md: 11.5px; --text-lg: 12.5px; --text-xl: 14px; --text-2xl: 16px; --text-4xl: 20px;
  --leading-normal: 1.6; --leading-tight: 1.25; --radius-lg: 2px;
  --space-3xs: 2px; --space-2xs: 4px; --space-sm: 8px; --space-lg: 14px; --space-xl: 18px; --space-2xl: 22px; --space-3xl: 18px; --space-4xl: 22px;
  letter-spacing: 0; }
.wm .fv .s-text-document-surface { flex: 1; }
.wm .fv .s-text-document-markdown { font-weight: 300; }
/* code: Shiki with the Scout palette, line treatment from the Code screen */
.wm .fv-code { flex: 1; min-height: 0; overflow: auto; }
.wm .fv-code pre { margin: 0; padding: 10px 0 16px; min-width: max-content; background: transparent !important; font: 400 11.5px/1.6 "SF Mono", ui-monospace, Menlo, monospace; color: var(--wm-code-fg); letter-spacing: 0; }
.wm .fv-code code { display: block; counter-reset: codeline; }
.wm .fv-code .line { display: inline-block; min-width: 100%; }
.wm .fv-code .line::before { counter-increment: codeline; content: counter(codeline); display: inline-block; width: 36px; margin-right: 16px; text-align: right; color: var(--wm-code-gutter); }
.wm .fv-code .shiki span { font-style: var(--shiki-dark-font-style, inherit); font-weight: var(--shiki-dark-font-weight, inherit); }
.wm .fv-code .shiki ::selection, .wm .fv ::selection { background: var(--wm-code-sel); }
.wm .fv .s-text-document-surface {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: color-mix(in srgb, var(--ink) 78%, transparent);
}

.wm .fv .s-text-document-code,
.wm .fv .s-text-document-markdown {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.wm .fv .s-text-document-code,
.wm .fv .s-text-document-fenced-code {
  margin: 0;
  background: color-mix(in srgb, var(--bg) 96%, var(--wm-shade));
  color: color-mix(in srgb, var(--ink) 76%, transparent);
  font-family: var(--font-mono);
  font-size: var(--text-md);
  line-height: var(--leading-normal);
  tab-size: 2;
  white-space: pre-wrap;
  word-break: break-word;
}

.wm .fv .s-text-document-code {
  padding: var(--space-3xl) var(--space-3xl);
}

.wm .fv .s-syntax-comment {
  color: var(--wm-syn-comment);
  font-style: italic;
}

.wm .fv .s-syntax-keyword {
  color: var(--wm-syn-keyword);
}

.wm .fv .s-syntax-string {
  color: var(--wm-syn-string);
}

.wm .fv .s-syntax-number,
.wm .fv .s-syntax-literal {
  color: var(--wm-syn-number);
}

.wm .fv .s-syntax-property,
.wm .fv .s-syntax-attribute {
  color: var(--wm-syn-property);
}

.wm .fv .s-syntax-function,
.wm .fv .s-syntax-tag {
  color: var(--wm-syn-function);
}

.wm .fv .s-syntax-type {
  color: var(--wm-syn-type);
}

.wm .fv .s-syntax-operator,
.wm .fv .s-syntax-punctuation,
.wm .fv .s-syntax-meta {
  color: var(--wm-syn-punct);
}

.wm .fv .s-text-document-markdown {
  padding: clamp(18px, 2.5vw, 34px);
  color: color-mix(in srgb, var(--ink) 76%, transparent);
  font-family: var(--font-sans);
  font-size: var(--text-lg);
  line-height: var(--leading-normal);
}

.wm .fv .s-text-document-markdown > :first-child {
  margin-top: 0;
}

.wm .fv .s-text-document-markdown > :last-child {
  margin-bottom: 0;
}

.wm .fv .s-text-document-markdown h1,
.wm .fv .s-text-document-markdown h2,
.wm .fv .s-text-document-markdown h3,
.wm .fv .s-text-document-markdown h4,
.wm .fv .s-text-document-markdown h5,
.wm .fv .s-text-document-markdown h6 {
  margin: var(--space-4xl) 0 var(--space-sm);
  color: var(--ink);
  font-weight: 680;
  letter-spacing: 0;
  line-height: var(--leading-tight);
}

.wm .fv .s-text-document-markdown h1 {
  font-size: var(--text-4xl);
}

.wm .fv .s-text-document-markdown h2 {
  font-size: var(--text-2xl);
}

.wm .fv .s-text-document-markdown h3,
.wm .fv .s-text-document-markdown h4,
.wm .fv .s-text-document-markdown h5,
.wm .fv .s-text-document-markdown h6 {
  font-size: var(--text-xl);
}

.wm .fv .s-text-document-markdown p,
.wm .fv .s-text-document-markdown ul,
.wm .fv .s-text-document-markdown ol,
.wm .fv .s-text-document-markdown blockquote,
.wm .fv .s-text-document-markdown pre,
.wm .fv .s-text-document-table-wrap {
  margin: var(--space-lg) 0;
}

.wm .fv .s-text-document-markdown ul,
.wm .fv .s-text-document-markdown ol {
  padding-left: var(--space-4xl);
}

.wm .fv .s-text-document-markdown li + li {
  margin-top: var(--space-2xs);
}

.wm .fv .s-text-document-markdown blockquote {
  padding: var(--space-3xs) 0 var(--space-3xs) var(--space-lg);
  border-left: 2px solid color-mix(in srgb, var(--doc-focus-accent) 52%, transparent);
  color: color-mix(in srgb, var(--ink) 62%, transparent);
}

.wm .fv .s-text-document-markdown a {
  color: color-mix(in srgb, var(--doc-focus-accent) 82%, var(--ink));
  text-decoration: underline;
  text-underline-offset: 2px;
}

.wm .fv .s-text-document-markdown strong {
  color: var(--ink);
  font-weight: 650;
}

.wm .fv .s-text-document-markdown em {
  font-style: italic;
}

.wm .fv .s-text-document-markdown del {
  color: color-mix(in srgb, var(--ink) 50%, transparent);
  text-decoration-thickness: 1px;
}

.wm .fv .s-text-document-markdown code {
  border: 1px solid color-mix(in srgb, var(--border) 65%, transparent);
  border-radius: 5px;
  background: color-mix(in srgb, var(--surface) 76%, transparent);
  color: color-mix(in srgb, var(--doc-focus-accent) 76%, var(--ink));
  font-family: var(--font-mono);
  font-size: var(--text-md);
  padding: 1px 4px;
}

.wm .fv .s-text-document-fenced-code {
  overflow: auto;
  padding: var(--space-lg) var(--space-xl);
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: var(--radius-lg);
}

.wm .fv .s-text-document-fenced-code code {
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0;
}

.wm .fv .s-text-document-table-wrap {
  overflow-x: auto;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--bg) 96%, var(--wm-shade));
}

.wm .fv .s-text-document-table {
  width: 100%;
  min-width: 560px;
  border-collapse: collapse;
  font-size: var(--text-md);
  line-height: var(--leading-normal);
}

.wm .fv .s-text-document-table th,
.wm .fv .s-text-document-table td {
  padding: var(--space-sm) var(--space-lg);
  border-right: 1px solid color-mix(in srgb, var(--border) 62%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--border) 62%, transparent);
  vertical-align: top;
  text-align: left;
}

.wm .fv .s-text-document-table th {
  background: color-mix(in srgb, var(--surface) 78%, transparent);
  color: var(--ink);
  font-weight: 650;
}

.wm .fv .s-text-document-table th[data-align="center"],
.wm .fv .s-text-document-table td[data-align="center"] {
  text-align: center;
}

.wm .fv .s-text-document-table th[data-align="right"],
.wm .fv .s-text-document-table td[data-align="right"] {
  text-align: right;
}

.wm .fv .s-text-document-table tr:last-child td {
  border-bottom: 0;
}

.wm .fv .s-text-document-table th:last-child,
.wm .fv .s-text-document-table td:last-child {
  border-right: 0;
}

.wm .fv .s-text-document-table code {
  font-size: var(--text-sm);
}

.wm .fv .s-text-document-markdown hr {
  margin: var(--space-3xl) 0;
  border: 0;
  border-top: 1px solid color-mix(in srgb, var(--border) 76%, transparent);
}


/* ---------- right column tabs + stash ---------- */
.wm .tabs { display: inline-flex; gap: 2px; margin-right: 4px; }
.wm .tabs .tab { font: inherit; font-size: 8.5px; letter-spacing: .22em; color: var(--faint); background: none; border: 0; border-bottom: 1px solid transparent; padding: 1px 6px 3px; cursor: pointer; }
.wm .tabs .tab b { font-weight: 300; margin-left: 6px; color: var(--dim); }
.wm .tabs .tab:hover { color: var(--fg); }
.wm .tabs .tab.on { color: var(--fg); border-bottom-color: var(--accent); }
.wm .stash { position: absolute; inset: 0; z-index: 7; background: var(--wm-sheet); opacity: 0; transform: translateX(14px); transition: opacity .18s ease, transform .18s ease; }
.wm .stash.open { opacity: 1; transform: none; }
.wm .stash[hidden] { display: none !important; }
.wm .stash .hd .r { display: flex; gap: 4px; overflow: visible; }
.wm .stash .hd .r .chip { padding: 1px 5px; }
.wm .board { position: relative; flex: 1; min-height: 0; overflow: auto; scrollbar-width: thin; scrollbar-color: var(--line) transparent;
  background-image: radial-gradient(var(--wm-board) 0.6px, transparent 0.7px); background-size: 14px 14px; }
.wm .stash-empty { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; padding: 0 30px; color: var(--faint); font-size: 8px; letter-spacing: .14em; line-height: 1.8; }
.wm .card { position: absolute; width: 146px; height: 128px; display: flex; flex-direction: column; background: var(--wm-card); border: 1px solid var(--line); cursor: grab; user-select: none; }
.wm .card:hover { border-color: var(--faint); }
.wm .card.sel { border-color: var(--accent-dim); }
.wm .card.live { border-color: var(--accent); }
.wm .card.dragging { cursor: grabbing; z-index: 3; box-shadow: 0 10px 30px var(--wm-shadow); }
.wm .card .ch { display: flex; align-items: center; gap: 6px; padding: 5px 6px 0 7px; }
.wm .card .ch b { flex: 1; min-width: 0; font-weight: 300; font-size: 8.5px; letter-spacing: .04em; color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wm .card .ch button { font: inherit; font-size: 10px; line-height: 1; color: var(--faint); background: none; border: 0; cursor: pointer; padding: 0 2px; }
.wm .card .ch button:hover { color: var(--fg); }
.wm .card small { padding: 1px 7px 5px; font-size: 6.5px; letter-spacing: .14em; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wm .card .thumb { flex: 1; min-height: 0; margin: 0 5px 5px; overflow: hidden; position: relative; background: var(--wm-hover); pointer-events: none; }
.wm .card .thumb img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
.wm .card .thumb pre { font: 300 6px/1.45 "SF Mono", ui-monospace, monospace; color: var(--dim); padding: 4px 5px; white-space: pre; letter-spacing: 0; }
.wm .card .thumb.page iframe { position: absolute; left: 0; top: 0; width: 400%; height: 400%; transform: scale(0.25); transform-origin: 0 0; border: 0; background: var(--wm-stage); }
.wm .card .thumb .tk { position: absolute; inset: 0; display: grid; place-items: center; font-size: 7px; letter-spacing: .2em; color: var(--faint); }
.wm aside.drop::after { content: "DROP TO STASH"; position: absolute; inset: 0; z-index: 9; display: grid; place-items: center; border: 1px dashed var(--accent); background: var(--wm-accent-soft); color: var(--accent); font-size: 9px; letter-spacing: .3em; pointer-events: none; }
.wm .status .skin { margin-left: 10px; padding: 0 8px; border-width: 0 0 0 1px; }

/* ---------- SCOUT skin: same sharp grid, minimal texture ---------- */
.wm[data-skin~="scout"] {
  background: linear-gradient(180deg, var(--wm-sheen) 0, transparent 260px), var(--wm-ground);
  font-family: "SF Mono", ui-monospace, Menlo, monospace; letter-spacing: 0.02em; }
.wm[data-skin~="scout"]::after { display: none; }
.wm[data-skin~="scout"] .top { border-bottom: 0.5px solid var(--line); }
.wm[data-skin~="scout"] .top::after { display: none; }
.wm[data-skin~="scout"] .panel { background: var(--wm-panel); border: 0.5px solid var(--wm-panel-line); }
.wm[data-skin~="scout"] .panel::before, .wm[data-skin~="scout"] .panel::after { display: none; }
.wm[data-skin~="scout"] .panel.focus { border-color: var(--wm-accent-focus); }
.wm[data-skin~="scout"] .hd { letter-spacing: 0.16em; }
.wm[data-skin~="scout"] .hd .k { border-width: 0.5px; }
.wm[data-skin~="scout"] button.chip { border-width: 0.5px; letter-spacing: 0.16em; }
.wm[data-skin~="scout"] .status { border-top-width: 0.5px; }
.wm[data-skin~="scout"] .status .mode { background: none; color: var(--fg); box-shadow: inset -0.5px 0 0 var(--line); }
.wm[data-skin~="scout"] .status .mode.cmd { color: var(--accent); }
.wm[data-skin~="scout"] .help .sheet::before, .wm[data-skin~="scout"] .help .sheet::after { display: none; }
.wm[data-skin~="scout"] .help .sheet { border-width: 0.5px; }
.wm[data-skin~="scout"] .insp, .wm[data-skin~="scout"] .stash { background: var(--wm-sheet); }
.wm[data-skin~="scout"] .pv, .wm[data-skin~="scout"] .card { border-width: 0.5px; border-color: var(--wm-panel-line); }
.wm[data-skin~="scout"] .target { border-width: 0.5px; }
.wm[data-skin~="scout"] .sec { border-top-width: 0.5px; }

/* right-click menu */
.wm .cm { position: absolute; z-index: 70; min-width: 220px; max-width: 320px; padding: 4px; background: var(--wm-sheet); border: 1px solid var(--line); box-shadow: 0 12px 32px var(--wm-shadow); }
.wm .cm[hidden] { display: none; }
.wm .cm .cmh { padding: 5px 8px 6px; border-bottom: 1px solid var(--line); margin-bottom: 3px; }
.wm .cm .cmh b { display: block; font-weight: 400; font-size: 9px; letter-spacing: .1em; color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wm .cm .cmh small { display: block; font-size: 7.5px; color: var(--faint); letter-spacing: .06em; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wm .cm button { font: inherit; font-size: 8px; letter-spacing: .18em; width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 5px 8px; color: var(--dim); background: none; border: 0; cursor: pointer; text-align: left; }
.wm .cm button kbd { font: inherit; color: var(--faint); letter-spacing: 0; }
.wm .cm button.sel { color: var(--fg); background: var(--wm-hover); }
.wm .cm button.sel kbd { color: var(--accent); }
.wm .cm button:disabled { color: var(--faint); opacity: .55; cursor: default; }
.wm .cm hr { border: 0; border-top: 1px solid var(--line); margin: 3px 0; }

/* transport */
.wm .world .hint { bottom: 46px; }
.wm .transport { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); z-index: 4; display: flex; align-items: center; gap: 2px; padding: 3px; background: var(--wm-float); border: 1px solid var(--line); }
.wm .transport .tp { font: inherit; display: flex; align-items: center; gap: 7px; height: 26px; padding: 0 9px; color: var(--dim); background: none; border: 0; cursor: pointer; letter-spacing: .22em; font-size: 8.5px; }
.wm .transport .tp svg { width: 11px; height: 11px; display: block; }
.wm .transport .tp:hover { color: var(--fg); background: var(--wm-hover); }
.wm .transport .tp.main { color: var(--fg); padding: 0 12px 0 10px; min-width: 88px; border: 1px solid var(--faint); }
.wm .transport.on .tp.main { color: var(--accent); border-color: var(--accent-dim); }
.wm .transport .tp.sp { font-size: 8px; color: var(--faint); }
.wm .transport .tp.sp:hover { color: var(--fg); }
.wm .transport .tpt { display: flex; flex-direction: column; justify-content: center; padding: 0 12px; border-left: 1px solid var(--line); border-right: 1px solid var(--line); height: 26px; min-width: 104px; }
.wm .transport .tpt b { font-weight: 300; font-size: 10px; letter-spacing: .1em; color: var(--fg); white-space: nowrap; }
.wm .transport .tpt small { font-size: 6.5px; letter-spacing: .22em; color: var(--faint); }
.wm[data-skin~="scout"] .cm, .wm[data-skin~="scout"] .transport { border-width: 0.5px; border-color: var(--wm-panel-line); }
.wm[data-skin~="scout"] .transport .tp.main { border-width: 0.5px; }
.wm[data-skin~="scout"] .transport .tpt { border-width: 0 0.5px; }
.wm[data-skin~="scout"] .cm .cmh, .wm[data-skin~="scout"] .cm hr { border-width: 0.5px 0 0; }
.wm[data-skin~="scout"] .cm .cmh { border-width: 0 0 0.5px; }
.wm .world .views { top: 64px; left: 46px; right: 52px; flex-wrap: wrap; justify-content: flex-start; max-width: none; }
.wm .world .hint { right: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wm .world .scan { bottom: 46px; }
.wm .transport .tp i { display: block; }
.wm .world .views .br { flex-basis: 100%; height: 0; }
.wm .world .views .vlbl { color: var(--faint); font-size: 7px; letter-spacing: .24em; align-self: center; margin-right: 2px; }
/* bottom of the world: the legend sits on the floor, play controls directly above it */
.wm .world .hint { bottom: 9px; left: 46px; right: 14px; }
.wm .transport { bottom: 28px; }
.wm .world .scan { bottom: 28px; }
.wm .world .views .vlbl.vk { margin-left: 2px; color: var(--faint); }
.wm .world .views .vlbl.vsep { margin-left: 10px; }
.wm .world .views .vlbl { min-width: 34px; }
.wm .world .scan { bottom: 66px; }
.wm .world .views { gap: 3px; row-gap: 4px; }
.wm .world .views button.chip { padding: 2px 5px; letter-spacing: .14em; font-size: 7px; }
.wm .world .views button.chip kbd { margin-left: 3px; }
.wm .world .views .vlbl { min-width: 0; margin-right: 1px; font-size: 6.5px; letter-spacing: .18em; }
.wm .world .views .vlbl.vsep { margin-left: 8px; }
.wm .world .views .vlbl:not(.vk) { width: 34px; }
.wm .hd { flex-direction: row; }
.wm .q-row { grid-template-columns: minmax(0,1fr) 34px 110px; }
.wm .q-row .nm { font-size: 8px; }
.wm .q-row .qv { text-align: right; font-size: 8.5px; color: var(--fg); }
.wm .q-row .qv.acc { color: var(--accent); }
.wm .q-sep { height: 1px; background: var(--line); margin: 2px 0; }

/* filters fold behind one chip */
.wm .world .views .vsum { align-self: center; margin-left: 6px; color: var(--faint); font-size: 7px; letter-spacing: .18em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.wm .world .views { flex-wrap: wrap; }
/* left rail: heading tape + center */
.wm .world .turnrail { position: absolute; left: 4px; top: 96px; bottom: 74px; width: 44px; z-index: 3; cursor: ns-resize; touch-action: none; }
.wm .world .centerbtn { position: absolute; left: 10px; bottom: 34px; z-index: 3; display: flex; align-items: center; gap: 6px; font: inherit; font-size: 7px; letter-spacing: .22em; color: var(--faint); background: none; border: 0; padding: 4px 2px; cursor: pointer; }
.wm .world .centerbtn svg { width: 13px; height: 13px; display: block; }
.wm .world .centerbtn:hover { color: var(--accent); }
.wm .world .hint { bottom: 9px; left: 92px; }
.wm .world .scan { bottom: 28px; }
/* time stack: rows hold still, one opens */
.wm .center { grid-template-rows: minmax(0, 1fr) 204px; }
.wm .tstack { display: grid; grid-template-rows: minmax(0,1fr) 24px 24px; gap: 4px; min-height: 0; transition: grid-template-rows .24s ease; }
@media (prefers-reduced-motion: reduce) { .wm .tstack { transition: none; } }
.wm .ts { padding: 8px 12px; }
.wm .ts:not(.cur) { flex-direction: row; align-items: center; gap: 12px; padding: 0 12px; cursor: pointer; }
.wm .ts:not(.cur) .hd { margin: 0; width: 168px; flex: none; color: var(--dim); }
.wm .ts:not(.cur) .hd .r { display: none; }
.wm .ts:not(.cur) canvas.fill { height: 18px; flex: 1; }
.wm .ts:not(.cur)::before, .wm .ts:not(.cur)::after { width: 5px; height: 5px; }
.wm .ts:not(.cur):hover { border-color: var(--faint); }
.wm .ts .tsbody { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 6px; }
.wm .ts:not(.cur) .tsbody { flex-direction: row; align-items: center; gap: 10px; height: 100%; }
.wm .ts .transport { position: static; transform: none; left: auto; bottom: auto; align-self: flex-start; flex: none; }
.wm .ts:not(.cur) .transport { padding: 0; border: 0; background: none; }
.wm .ts:not(.cur) .transport .tp { height: 18px; }
.wm .ts:not(.cur) .transport .tp.main { min-width: 0; border: 0; padding: 0 6px; }
.wm .ts:not(.cur) .transport .tpt { height: 18px; flex-direction: row; align-items: center; gap: 8px; min-width: 0; border: 0; padding: 0 6px; }
@media (max-width: 1100px) { .wm .tstack { height: 220px; } }
.wm .world .views.open { background: var(--wm-float); border: 1px solid var(--line); padding: 6px 8px 7px; right: auto; max-width: calc(100% - 110px); }
.wm[data-skin~="scout"] .world .views.open { border-width: 0.5px; border-color: var(--wm-panel-line); }
/* vcs tally under the day bars: worktrees, branches, PRs counted to T, at row size */
.wm .vcs { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 0 10px; border-top: 1px solid var(--line); margin-top: 6px; padding-top: 5px; font-size: 8.5px; color: var(--dim); letter-spacing: 0.08em; white-space: nowrap; }
.wm .vcs div { display: flex; justify-content: space-between; gap: 6px; min-width: 0; }
.wm .vcs span { color: var(--faint); font-size: 7px; letter-spacing: 0.16em; align-self: center; }
.wm .vcs b { font-weight: 300; color: var(--fg); }
.wm .vcs em { font-style: normal; color: var(--faint); }
/* one row size for every list and log: tables, broker log, inspector rows, quota names all read at 8.5px */
.wm[data-skin~="scout"] td, .wm[data-skin~="scout"] .log div, .wm[data-skin~="scout"] .it, .wm[data-skin~="scout"] .q-row .nm { font-size: 8.5px; }
.wm[data-skin~="scout"] .log div { grid-template-columns: 58px 1fr; }
.wm .ts:not(.cur) .transport .tp.sp, .wm .ts:not(.cur) .transport [data-tp="stop"], .wm .ts:not(.cur) .transport .tpt small { display: none; }
.wm .ts:not(.cur) .transport .tpt b { font-size: 8.5px; }
.wm .ts:not(.cur) .hd { width: 150px; }
.wm .ts:not(.cur) .tsbody canvas.fill { min-width: 60px; }
.wm .ts:not(.cur) .transport .tp.main span { display: none; }

/* streaming caret, shared */
.wm i.caret { display: inline-block; width: 4px; height: 7px; margin-left: 2px; background: var(--accent); vertical-align: -0.5px; animation: wm-caret .76s steps(1) infinite; }
@keyframes wm-caret { 50% { opacity: 0; } }

/* ===== FINE: Scout at hairline — half-pixel strokes, lighter ink, more air, system Light for words that aren't data ===== */
.wm[data-skin~="fine"] { --gap: 14px; --sys: -apple-system, "SF Pro Text", system-ui, sans-serif;
  background: radial-gradient(140% 70% at 50% -10%, var(--wm-sheen), transparent 60%), var(--wm-ground); }
.wm[data-skin~="fine"] .frame { padding: 16px 20px 14px; }
.wm[data-skin~="fine"].wm--app .frame { padding-top: 14px; }
.wm[data-skin~="fine"] .panel { background: none; border: 0.5px solid var(--wm-line); padding: 13px 15px; }
.wm[data-skin~="fine"] .panel.focus { border-color: var(--wm-accent-focus); }
.wm[data-skin~="fine"] .hd { font: 400 9px/1.2 var(--sys); letter-spacing: 0.16em; color: var(--dim); margin-bottom: 11px; gap: 8px; }
.wm[data-skin~="fine"] .hd .k { border: 0; min-width: 0; height: auto; padding: 0; font: 300 7.5px/1 "SF Mono", ui-monospace, Menlo; color: var(--faint); }
.wm[data-skin~="fine"] .panel.focus .hd .k { background: none; color: var(--accent); }
.wm[data-skin~="fine"] .panel.focus .hd { color: var(--fg); }
.wm[data-skin~="fine"] .hd .r { font: 300 7px/1 "SF Mono", ui-monospace, Menlo; letter-spacing: 0.14em; color: var(--wm-faint); }
.wm[data-skin~="fine"] .lbl, .wm[data-skin~="fine"] .metrics small, .wm[data-skin~="fine"] th { font-size: 6.5px; letter-spacing: 0.2em; color: var(--wm-faint); }
.wm[data-skin~="fine"] .readout b, .wm[data-skin~="fine"] .metrics b { font: 300 19px/1.15 var(--sys); letter-spacing: 0.01em; font-variant-numeric: tabular-nums; }
.wm[data-skin~="fine"] .replay .glyph b { font: 300 12px var(--sys); letter-spacing: 0.04em; }
.wm[data-skin~="fine"] td { font-size: 8.5px; padding-block: 3.6px; color: var(--wm-ink); }
.wm[data-skin~="fine"] tr.sel td { background: var(--wm-sel); }
.wm[data-skin~="fine"] tr.sel td:first-child { box-shadow: none; padding-left: 0; color: var(--fg); }
.wm[data-skin~="fine"] .lane-row .nm { font-size: 8px; letter-spacing: 0.1em; color: var(--wm-ink); }
.wm[data-skin~="fine"] .lane-row.sel { background: var(--wm-sel); box-shadow: none; }
.wm[data-skin~="fine"] button.chip { border: 0; padding: 3px 5px; letter-spacing: 0.16em; color: var(--faint); }
.wm[data-skin~="fine"] button.chip:hover { color: var(--fg); }
.wm[data-skin~="fine"] button.chip.on { color: var(--accent); box-shadow: inset 0 -0.5px 0 var(--wm-accent-dim); }
.wm[data-skin~="fine"] .world .views.open { background: var(--wm-float); border: 0.5px solid var(--wm-line); }
.wm[data-skin~="fine"] .world .views .vlbl { color: var(--wm-faint); }
.wm[data-skin~="fine"] .world .cam { color: var(--wm-dim); font-size: 8px; }
.wm[data-skin~="fine"] .world .hint { color: var(--wm-faint); font-size: 7px; }
.wm[data-skin~="fine"] .world .scan { color: var(--wm-dim); font-size: 8px; }
.wm[data-skin~="fine"] .zoomrail button { font-size: 7px; letter-spacing: 0.16em; }
.wm[data-skin~="fine"] .zoomrail button i { height: 0.5px; }
.wm[data-skin~="fine"] .zoomrail button.on i { width: 22px; }
.wm[data-skin~="fine"] .transport { border: 0.5px solid var(--wm-line); background: none; }
.wm[data-skin~="fine"] .transport .tp.main { border: 0.5px solid var(--wm-panel-line); }
.wm[data-skin~="fine"] .transport .tpt b { font: 300 11px var(--sys); letter-spacing: 0.04em; }
.wm[data-skin~="fine"] .ts:not(.cur) .hd { color: var(--faint); }
.wm[data-skin~="fine"] .tstack { gap: 6px; }
.wm[data-skin~="fine"] .log div { gap: 10px; font-size: 8.5px; }
.wm[data-skin~="fine"] .log div span:first-child { color: var(--wm-dim); }
.wm[data-skin~="fine"] .status { font-size: 7.5px; letter-spacing: 0.12em; }
.wm[data-skin~="fine"] .status .keys kbd { border: 0.5px solid var(--wm-line); color: var(--wm-ink); }
.wm[data-skin~="fine"] .status .mode { color: var(--dim); }
.wm[data-skin~="fine"] .q-sep { height: 0.5px; }
.wm[data-skin~="fine"] .insp, .wm[data-skin~="fine"] .stash { background: var(--wm-sheet); }
.wm[data-skin~="fine"] .sec { font-size: 6.5px; letter-spacing: 0.22em; border-top: 0.5px solid var(--wm-line); }
.wm[data-skin~="fine"] .target { border: 0.5px solid var(--wm-line); }
.wm[data-skin~="fine"] .ih b { font: 300 12px var(--sys); letter-spacing: 0.02em; }
/* ---------- right pane: code lists at rest; inspector, stash and a preview stack over them ---------- */
.wm .pv.dock { position: absolute; inset: 0; z-index: 8; width: auto; height: auto; resize: none; min-width: 0; min-height: 0; box-shadow: none; background: var(--wm-ground); }
.wm .pv .pvh { cursor: default; }
.wm .pvt .chip[data-pv="close"] { flex: none; }
.wm .pvf { justify-content: space-between; }
.wm .sitecard { margin: 18px 14px; border: 1px solid var(--line); padding: 14px 14px 12px; display: flex; flex-direction: column; gap: 4px; }
.wm .sitecard small { color: var(--faint); font-size: 7px; letter-spacing: .24em; }
.wm .sitecard b { font-weight: 300; font-size: 12px; letter-spacing: .04em; color: var(--fg); overflow-wrap: anywhere; }
.wm .sitecard span { font-size: 8.5px; color: var(--fg); overflow-wrap: anywhere; }
.wm .sitecard span.dim { color: var(--dim); }
.wm .sitecard .chip { align-self: flex-start; margin-top: 10px; }
.wm .sitecard p { color: var(--faint); font-size: 7.5px; letter-spacing: .14em; margin-top: 8px; }
.wm .code .vcs { margin: 0 0 2px; border-top: 0; padding-top: 0; }
.wm .cbody { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; scrollbar-color: var(--line) transparent; padding-right: 2px; }
.wm .csec { display: flex; justify-content: space-between; gap: 8px; color: var(--faint); font-size: 7.5px; letter-spacing: .22em; border-top: 1px solid var(--line); padding: 6px 0 3px; margin-top: 6px; position: sticky; top: 0; z-index: 1; background: var(--wm-sheet); white-space: nowrap; }
.wm .csec:first-child { margin-top: 2px; }
.wm .cr { padding: 2px 4px 3px; cursor: pointer; }
.wm .cr .l1, .wm .cr .l2 { display: grid; grid-template-columns: minmax(0, max-content) minmax(0, 1fr) auto; gap: 8px; align-items: center; white-space: nowrap; }
.wm .cr .l1 > *, .wm .cr .l2 > * { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.wm .cr .l1 { font-size: 8.5px; color: var(--dim); }
.wm .cr .l1 b { font-weight: 300; color: var(--fg); max-width: 150px; }
.wm .cr .l2 { font-size: 7.5px; color: var(--faint); margin-top: 1px; letter-spacing: .06em; }
.wm .cr .n { text-align: right; color: var(--dim); }
.wm .cr .l1 .n.acc { color: var(--accent); }
.wm .cr .l1 em.pr { font-style: normal; color: var(--dim); opacity: .8; }
.wm .cr .l1 em.pr.acc { color: var(--accent); opacity: 1; }
.wm .cr:hover { background: var(--wm-hover); }
.wm .cr.sel { background: var(--wm-hover); box-shadow: inset 0 0 0 1px var(--line); }
.wm .panel.focus .cr.sel { box-shadow: inset 0 0 0 1px var(--accent-dim); }
.wm .cr .db { display: flex; align-items: center; gap: 1px; height: 8px; }
.wm .cr .db i { display: block; height: 3px; background: var(--fg); opacity: .65; }
.wm .cr .db i.rm { background: none; box-shadow: inset 0 0 0 1px var(--dim); opacity: 1; }
/* outcomes carries the stalls now: a sub-head and the list under the day bars */
.wm .sub { display: flex; justify-content: space-between; gap: 8px; color: var(--faint); font-size: 7.5px; letter-spacing: .2em; border-top: 1px solid var(--line); margin-top: 6px; padding-top: 5px; white-space: nowrap; }
.wm .sub .r { overflow: hidden; text-overflow: ellipsis; }
.wm[data-skin~="scout"] .cr .l1 { font-size: 8.5px; }
.wm[data-skin~="scout"] .csec, .wm[data-skin~="scout"] .sub { border-top-width: 0.5px; }
.wm[data-skin~="fine"] .csec { background: var(--wm-sheet); }
/* broker log: its own panel in the right column, a window of rows around the playhead */
.wm .blog { padding-bottom: 8px; }
.wm .blog .hd { margin-bottom: 6px; }
.wm .blog .lchip .chip { padding: 1px 5px; font-size: 7px; }
.wm .blog .log { flex: 1 1 auto; min-height: 0; gap: 0; overflow: hidden; }
.wm .blog .log .lr { display: grid; grid-template-columns: 58px 8px minmax(0, max-content) minmax(0, 1fr); gap: 7px; align-items: center; font-size: 8.5px; line-height: 13px; height: 13px; color: var(--dim); opacity: 1; cursor: pointer; position: relative; }
.wm .blog .log .lr > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.wm .blog .log .lr .t { color: var(--faint); }
.wm .blog .log .lr .ft { color: var(--dim); max-width: 132px; }
.wm .blog .log .lr .tx { color: var(--fg); }
.wm .blog .log .lr .mk { display: block; width: 6px; height: 6px; justify-self: center; position: relative; }
.wm .blog .log .k-open .mk { border-radius: 50%; background: var(--dim); }
.wm .blog .log .k-open.live .mk { background: var(--accent); }
.wm .blog .log .k-done .mk { background: var(--fg); }
.wm .blog .log .k-stall .mk { border: 1px solid var(--dim); }
.wm .blog .log .k-fail .mk::before, .wm .blog .log .k-fail .mk::after { content: ""; position: absolute; left: -1px; top: 2.5px; width: 8px; height: 1px; background: var(--fg); transform: rotate(45deg); }
.wm .blog .log .k-fail .mk::after { transform: rotate(-45deg); }
.wm .blog .log .k-fail .tx { text-decoration: line-through; text-decoration-color: var(--wm-fail); }
.wm .blog .log .lr.fut, .wm .blog .log .lr.fut > span { color: var(--faint); }
.wm .blog .log .lr.fut .mk { opacity: .4; }
.wm .blog .log .lr.cur { box-shadow: inset 0 -1px 0 var(--line); }
.wm .blog .log .lr.cur .t { color: var(--accent); }
.wm .blog .log .lr.cur::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 1px; background: linear-gradient(90deg, var(--accent) 0 58px, transparent 58px); opacity: .7; }
.wm .blog .log .lr.sel { background: var(--wm-sel); box-shadow: inset 2px 0 0 var(--fg); }
.wm .blog .log .lr:hover .tx { color: var(--fg); }
.wm .blog .log .lr.quiet { cursor: default; } .wm .blog .log .lr.quiet .tx { color: var(--faint); letter-spacing: .08em; }
.wm .blog .log .lr.fl > span { animation: wm-logfl 1.1s ease-out 1; }
@keyframes wm-logfl { 0% { color: var(--accent); } 60% { color: var(--accent); } 100% { } }
@media (prefers-reduced-motion: reduce) { .wm .blog .log .lr.fl > span { animation: none; } }
.wm .blog .logtip { position: absolute; left: 10px; right: 10px; z-index: 5; background: var(--wm-sheet); border: 1px solid var(--line); padding: 5px 7px; font-size: 8px; line-height: 1.5; color: var(--fg); pointer-events: none; white-space: normal; word-break: break-word; }
.wm .blog .logtip[hidden] { display: none; }
.wm .blog .logtip b { display: block; font-weight: 300; color: var(--dim); font-size: 7.5px; letter-spacing: .14em; margin-bottom: 2px; }
.wm[data-skin~="scout"] .blog .log .lr { font-size: 8.5px; }
/* left column: panels hold their natural heights; a tall window gives its extra height to the world */
.wm [data-panel="h"] .scroll { flex: 1 1 auto; height: 92px; min-height: 30px; }
/* slots: the columns as the web shell's sidebar and inspector, each in a .wm host of its own */
.wm.wm--slot { position: relative; inset: auto; z-index: auto; height: 100%; width: 100%; overflow: hidden; }
.wm.wm--slot > .col { height: 100%; padding: 10px; }
.wm.wm--float { position: fixed; inset: 0; z-index: 1000; pointer-events: none; background: none; overflow: visible; }
.wm.wm--float::after { display: none; }
.wm.wm--float .cm { pointer-events: auto; }
.wm .frame.slotted { grid-template-columns: minmax(0, 1fr); }
/* filters, open: one bar across the top of the world — a column per group, spread evenly */
.wm .world .views.open { left: 12px; right: 12px; max-width: none; display: block; padding: 6px 10px 7px; background: var(--wm-float); border: 1px solid var(--line); }
.wm[data-skin~="scout"] .world .views.open { border-width: 0.5px; }
.wm .world .views .vbar { display: grid; grid-template-columns: repeat(6, minmax(0, max-content)); justify-content: space-between; column-gap: 14px; align-items: start; }
.wm .world .views .vg { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.wm .world .views .vg + .vg { border-left: 0.5px solid var(--line); padding-left: 10px; }
.wm .world .views .vg .vlbl { width: auto; min-width: 0; margin: 0; font-size: 7px; letter-spacing: .24em; color: var(--faint); white-space: nowrap; }
.wm .world .views .vg .vlbl em { font-style: normal; margin-left: 6px; opacity: .7; letter-spacing: .1em; }
.wm .world .views .vc { display: flex; flex-wrap: wrap; gap: 3px; }
.wm .world .views .vc button.chip { font-size: 7.5px; white-space: nowrap; }

/* right column: Code keeps its natural height up to a cap and scrolls inside; the Broker Log takes what is left, never under ~24 rows */
.wm [data-panel="v"] { min-height: 0; max-height: 40%; }
.wm [data-panel="v"] .cbody { flex: 1 1 auto; }
.wm .blog { min-height: calc(24 * 13px + 34px); }

/* the window ladder: live · 5m · 30m · 4h · 24h · all, bottom-left of the world; the second row says where it's anchored */
.wm .world .winbar { position: absolute; left: 92px; bottom: 24px; right: 160px; z-index: 3; display: flex; flex-direction: column; gap: 3px; pointer-events: none; }
.wm .world .winbar .wr { display: flex; align-items: center; gap: 3px; flex-wrap: wrap; }
.wm .world .winbar .wl { color: var(--faint); font-size: 7px; letter-spacing: .24em; margin-right: 4px; }
.wm .world .winbar button { pointer-events: auto; font: inherit; font-size: 7.5px; letter-spacing: .16em; color: var(--dim); background: var(--wm-chip); border: 0.5px solid var(--line); padding: 2px 6px; cursor: pointer; }
.wm .world .winbar button kbd { font: inherit; color: var(--faint); margin-right: 5px; }
.wm .world .winbar button:hover { color: var(--fg); border-color: var(--faint); }
.wm .world .winbar button.on { color: var(--accent); border-color: var(--accent-dim); }
.wm .world .winbar button.on kbd { color: var(--accent); }
.wm .world .winbar .wf { margin-left: 8px; color: var(--dim); font-size: 7px; letter-spacing: .2em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wm .world .winbar .wf b { color: var(--fg); font-weight: 300; }
.wm .world .winbar .wa { color: var(--dim); font-size: 7px; letter-spacing: .16em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wm .world .winbar .wa b { color: var(--accent); font-weight: 300; }

/* the source: WEEK (the snapshot) · LIVE (our machines, now) · OTLP (only what exporters send); freshness per machine */
.wm .world .livebar { position: absolute; left: 92px; bottom: 62px; right: 160px; z-index: 3; display: flex; flex-direction: column; gap: 3px; pointer-events: none; }
.wm .world .livebar .lr { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; align-self: flex-start; padding: 2px 8px 2px 0; }
.wm .world .livebar .la { align-self: flex-start; padding: 2px 8px 2px 0; }
.wm .world .livebar .seg { display: inline-flex; }
.wm .world .livebar .seg button { pointer-events: auto; font: inherit; font-size: 7.5px; letter-spacing: .2em; color: var(--dim); background: var(--wm-chip); border: 0.5px solid var(--line); margin-right: -0.5px; padding: 2px 7px; cursor: pointer; }
.wm .world .livebar .seg button:hover { color: var(--fg); border-color: var(--faint); }
.wm .world .livebar .seg button.on { color: var(--accent); border-color: var(--accent-dim); position: relative; }
.wm .world .livebar .ls { font-size: 7.5px; letter-spacing: .2em; color: var(--dim); white-space: nowrap; }
.wm .world .livebar .ls b { color: var(--fg); font-weight: 300; }
.wm .world .livebar .ls b.on { color: var(--accent); }
.wm .world .livebar .ls b.on::before { content: ""; display: inline-block; width: 4px; height: 4px; margin: 0 6px 1px 0; background: var(--accent); animation: wmLivePulse 1.6s ease-in-out infinite; }
@keyframes wmLivePulse { 50% { opacity: .25; } }
.wm .world .livebar .lh { display: inline-flex; gap: 12px; font-size: 7px; letter-spacing: .18em; color: var(--dim); white-space: nowrap; overflow: hidden; }
.wm .world .livebar .lh .stale { color: var(--faint); text-decoration: line-through; text-decoration-thickness: 0.5px; pointer-events: auto; }
.wm .world .livebar .la { font-size: 7px; letter-spacing: .16em; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wm .world .livebar .la b { color: var(--accent); font-weight: 300; letter-spacing: .08em; }
@media (prefers-reduced-motion: reduce) { .wm .world .livebar .ls b.on::before { animation: none; } }
/* FAILED · STUCK — one alarm colour (engine ALARM block; the treatment's alarm token, theme.ts) */
.wm { --alarm: var(--wm-alarm, #ff8f66); --alarm-dim: var(--wm-alarm-dim, rgba(255,143,102,0.55)); --alarm-faint: var(--wm-alarm-faint, rgba(255,143,102,0.22)); }
.wm i.sq.al { background: none; border: 1px solid var(--alarm); border-radius: 50%; }
.wm #stalls td.al { color: var(--alarm); letter-spacing: .08em; }
.wm #stalls tr.tr-tool td.al { color: var(--alarm-dim); }
.wm #stallR.al { color: var(--alarm); }
.wm .blog .log .lr.k-fail .mk::before, .wm .blog .log .lr.k-fail .mk::after { background: var(--alarm); }
.wm .blog .log .lr.k-stall .mk { border-color: var(--alarm); border-style: dashed; }
.wm .blog .log .lr.k-fail .ft, .wm .blog .log .lr.k-stall .ft { color: var(--alarm); }
.wm .world .lt { display: flex; flex-direction: column; gap: 2px; align-self: flex-start; padding: 3px 10px 3px 0; color: var(--faint); }
.wm .world .lt.in { flex-direction: row; align-items: center; gap: 8px; background: none; padding: 0; }
.wm .world .lt .tw { display: flex; align-items: center; gap: 10px; white-space: nowrap; }
.wm .world .lt .tn { pointer-events: auto; font: inherit; background: none; border: 0; padding: 0; cursor: pointer; display: inline-flex; align-items: baseline; gap: 7px; color: var(--faint); }
.wm .world .lt .tn span { font-size: 7.5px; letter-spacing: .2em; }
.wm .world .lt .tn b { font-size: 15px; font-weight: 300; letter-spacing: .04em; color: var(--dim); min-width: 1.2em; }
.wm .world .lt.in .tn b { font-size: 11px; }
.wm .world .lt .tn:hover span, .wm .world .lt .tn:hover b { color: var(--fg); }
.wm .world .lt .tn.hot span { color: var(--alarm-dim); }
.wm .world .lt .tn.hot b { color: var(--alarm); }
.wm .world .lt .tb { font-size: 7px; letter-spacing: .16em; color: var(--dim); white-space: nowrap; }
.wm .world .lt .tb b { color: var(--alarm); font-weight: 300; }
.wm .world .lt .tq { font-size: 7px; letter-spacing: .16em; color: var(--dim); white-space: nowrap; pointer-events: auto; }
.wm .world .lt .tsep { display: inline-block; width: 1px; height: 10px; background: var(--line); }
.wm #mStall.al { color: var(--alarm); }
.wm #mStall em { font-style: normal; font-size: 11px; }

/* the command palette (commands.ts): rises from the status bar while ":" is open */
.wm .pal[hidden] { display: none !important; }
.wm .pal { position: absolute; left: 16px; bottom: 36px; z-index: 31; width: min(680px, calc(100% - 32px)); max-height: min(46vh, 420px); overflow: hidden auto; scrollbar-width: thin;
  background: var(--wm-sheet); border: 1px solid var(--line); font-size: 9px; letter-spacing: .05em; box-shadow: 0 12px 36px var(--wm-scrim); }
.wm .pal .ph { position: sticky; top: 0; display: flex; justify-content: space-between; gap: 12px; color: var(--faint); font-size: 7.5px; letter-spacing: .22em; padding: 6px 10px; border-bottom: 1px solid var(--line); background: var(--wm-sheet); }
.wm .pal .pr { display: grid; grid-template-columns: minmax(0, 230px) minmax(0, 1fr) auto; gap: 14px; padding: 4px 10px; cursor: pointer; align-items: baseline; }
.wm .pal .pr .pl { color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wm .pal .pr .pd { color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wm .pal .pr .pk { color: var(--faint); font-size: 8px; white-space: nowrap; letter-spacing: .1em; }
.wm .pal .pr:hover { background: var(--wm-hover); }
.wm .pal .pr.sel { background: var(--wm-sel); box-shadow: inset 2px 0 0 var(--accent); }
.wm .pal .pr.sel .pl { color: var(--accent); }
.wm .pal .pr.group .pl { font-size: 8px; letter-spacing: .26em; color: var(--accent); }
.wm .pal .pr.group .pd { color: var(--faint); }
.wm .pal .pr.recent .pl::before { content: "\\21BA  "; color: var(--faint); }
.wm .pal .pr.hint { cursor: default; }
.wm .pal .pr.hint .pl { color: var(--dim); }
.wm .status .keys .more { margin-left: auto; color: var(--faint); }
.wm .status .keys .more kbd { margin-left: 6px; }
.wm .status .keys .more button { font: inherit; letter-spacing: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
.wm .status .keys .more button:hover { color: var(--fg); }

/* the "?" sheet, generated from the registry */
.wm .help .sheet { width: min(1180px, calc(100vw - 32px)); }
.wm .help .hhd { display: flex; align-items: baseline; gap: 18px; margin-bottom: 14px; }
.wm .help .hhd h2 { margin: 0; white-space: nowrap; }
.wm .help .hhd input { flex: 1; min-width: 0; font: inherit; font-size: 10px; letter-spacing: .08em; color: var(--fg); background: none; border: 0; border-bottom: 1px solid var(--line); outline: 0; padding: 3px 0; caret-color: var(--accent); }
.wm .help .hhd input::placeholder { color: var(--faint); }
.wm .help .hhd .hn { color: var(--faint); font-size: 7.5px; letter-spacing: .2em; white-space: nowrap; }
.wm .help .cols { display: block; columns: 3 300px; column-gap: 28px; }
.wm .help .hg { break-inside: avoid; margin-bottom: 14px; }
.wm .help dl { grid-template-columns: minmax(64px, auto) 1fr; gap: 4px 10px; }
.wm .help dt { display: flex; flex-wrap: wrap; gap: 3px 4px; align-content: flex-start; max-width: 150px; }
.wm .help dt .kb.sc { flex-basis: 100%; }
.wm .help dt .kb { white-space: nowrap; }
.wm .help dt small { color: var(--faint); font-size: 6.5px; letter-spacing: .12em; margin-left: 3px; }
.wm .help dd code { font: inherit; color: var(--fg); display: block; }
.wm .help dd span { display: block; }
.wm .help dd i { display: block; font-style: normal; color: var(--faint); font-size: 7.5px; letter-spacing: .08em; }
.wm .help .hft { margin-top: 6px; color: var(--faint); font-size: 7.5px; letter-spacing: .16em; }
/* RECAP: highlights and lowlights, a card on the world (recap.ts picks them; :recap show|hide|play|<n>) */
.wm .recap[hidden] { display: none !important; }
.wm .recap { position: absolute; top: 96px; right: 52px; z-index: 5; width: min(360px, calc(100% - 120px)); background: var(--wm-sheet); border: 1px solid var(--line); padding: 8px 0 0; font-size: 8.5px; letter-spacing: .05em; box-shadow: 0 10px 30px var(--wm-scrim); }
.wm .recap::before, .wm .recap::after { content: ""; position: absolute; width: 9px; height: 9px; border: 1px solid var(--accent); pointer-events: none; }
.wm .recap::before { top: -1px; left: -1px; border-right: 0; border-bottom: 0; }
.wm .recap::after { bottom: -1px; right: -1px; border-left: 0; border-top: 0; }
.wm .recap .rh { display: flex; align-items: center; gap: 6px; padding: 0 10px 6px; font-size: 9px; letter-spacing: .24em; }
.wm .recap .rh span { flex: 1; }
.wm .recap .rh button { font: inherit; font-size: 7.5px; letter-spacing: .2em; color: var(--dim); background: none; border: 1px solid var(--line); padding: 2px 6px; cursor: pointer; }
.wm .recap .rh button:hover { color: var(--fg); border-color: var(--faint); }
.wm .recap .rs { color: var(--faint); font-size: 7px; letter-spacing: .24em; padding: 6px 10px 3px; border-top: 1px solid var(--line); }
.wm .recap .rr { font: inherit; display: grid; grid-template-columns: 20px 92px minmax(0, 1fr); gap: 8px; align-items: baseline; width: 100%; text-align: left; background: none; border: 0; color: var(--dim); padding: 3px 10px; cursor: pointer; }
.wm .recap .rr i { font-style: normal; color: var(--accent); font-size: 7.5px; }
.wm .recap .rr.lo i { color: var(--wm-fail); }
.wm .recap .rr .rc { color: var(--faint); font-size: 7px; letter-spacing: .16em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wm .recap .rr b { font-weight: 300; color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wm .recap .rr:hover { background: var(--wm-hover); }
.wm .recap .rr.on { background: var(--wm-sel); box-shadow: inset 2px 0 0 var(--accent); }
.wm .recap .rr.lo.on { box-shadow: inset 2px 0 0 var(--wm-fail); }
.wm .recap .rcap { border-top: 1px solid var(--line); margin-top: 6px; padding: 7px 10px 9px; color: var(--fg); font-size: 8.5px; line-height: 1.55; letter-spacing: .03em; }
.wm .recap .rcap small { display: block; color: var(--faint); font-size: 7px; letter-spacing: .2em; margin-bottom: 3px; }
/* point & speak: one panel anchored beside the pointed session (strip → pill → review → result); the HUD's own tokens */
.wm .ps { position: absolute; left: 0; top: 0; z-index: 5; width: 300px; background: var(--wm-sheet); border: 1px solid var(--line); padding: 8px 10px 7px; font-size: 8px; letter-spacing: .06em; box-shadow: 0 10px 30px var(--wm-scrim); pointer-events: auto; will-change: transform; }
.wm .ps[hidden] { display: none !important; }
.wm .ps::before, .wm .ps::after { content: ""; position: absolute; width: 9px; height: 9px; border: 1px solid var(--accent); pointer-events: none; }
.wm .ps::before { top: -1px; left: -1px; border-right: 0; border-bottom: 0; }
.wm .ps::after { bottom: -1px; right: -1px; border-left: 0; border-top: 0; }
.wm .ps kbd { font: inherit; color: var(--faint); border: 1px solid var(--line); padding: 0 3px; letter-spacing: 0; }
.wm .ps .psgs { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0 10px; }
.wm .ps .psg.direct { border-left: 1px solid var(--line); padding-left: 10px; }
.wm .ps .psr { color: var(--faint); font-size: 6.5px; letter-spacing: .2em; margin-bottom: 4px; white-space: nowrap; }
.wm .ps .psg:not(.direct) .psr { color: var(--accent); }
.wm .ps .psb { display: flex; gap: 4px; flex-wrap: wrap; }
.wm .ps .psb + .psb { margin-top: 5px; }
.wm .ps button.chip { padding: 3px 6px; }
.wm .ps button.chip.dash { border-style: dashed; color: var(--fg); }
.wm .ps button.chip.quiet { color: var(--faint); }
.wm .ps .psf { color: var(--faint); font-size: 6.5px; letter-spacing: .18em; margin-top: 7px; padding-top: 5px; border-top: 1px solid var(--line); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wm .ps .psf b { color: var(--accent); font-weight: 300; }
.wm .ps .psv { display: flex; align-items: center; gap: 9px; }
.wm .ps .pss { color: var(--accent); font-size: 6.5px; letter-spacing: .2em; white-space: nowrap; }
.wm .ps .pswave { display: inline-flex; align-items: center; gap: 2px; height: 22px; }
.wm .ps .pswave i { display: block; width: 1px; height: var(--h); background: var(--accent); animation: wmPsWave .9s ease-in-out infinite alternate; }
.wm .ps .pswave.quiet i { background: var(--faint); animation: none; }
@keyframes wmPsWave { from { transform: scaleY(.3); } to { transform: scaleY(1); } }
.wm .ps .pssaid { color: var(--fg); font-size: 9.5px; line-height: 1.45; letter-spacing: .02em; margin-top: 6px; min-height: 14px; }
.wm .ps .caret { display: inline-block; width: 4px; height: 9px; background: var(--accent); margin-left: 3px; vertical-align: -1px; animation: wmPsCaret 1s steps(1) infinite; }
@keyframes wmPsCaret { 50% { opacity: 0; } }
.wm .ps .pskv { display: grid; grid-template-columns: 58px minmax(0, 1fr); gap: 8px; padding: 2px 0; }
.wm .ps .pskv span:first-child { color: var(--faint); font-size: 6.5px; letter-spacing: .2em; padding-top: 1px; }
.wm .ps .pskv span:last-child { color: var(--fg); line-height: 1.45; overflow-wrap: anywhere; }
.wm .ps .pskv:first-child span:first-child { color: var(--accent); }
.wm .ps .pskv span.direct { border-bottom: 1px dashed var(--faint); justify-self: start; }
.wm .ps .psin { font: inherit; font-size: 9px; color: var(--fg); background: none; border: 0; border-bottom: 1px solid var(--accent-dim); outline: 0; width: 100%; caret-color: var(--accent); padding: 1px 0; }
.wm .ps .psh { color: var(--dim); font-size: 7px; letter-spacing: .16em; margin-bottom: 5px; }
.wm .ps .psh b { color: var(--fg); font-weight: 300; }
.wm .ps .pscode { font-size: 7.5px; line-height: 1.5; color: var(--dim); border: 1px solid var(--line); padding: 5px 7px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 110px; overflow: hidden; }
.wm .ps .psnote { color: var(--faint); font-size: 7px; line-height: 1.5; margin-top: 5px; }
.wm .ps .psbody { color: var(--fg); font-size: 9px; line-height: 1.5; margin-bottom: 6px; }
.wm .ps.pstalk { left: auto; top: auto; right: 52px; bottom: 44px; width: min(420px, calc(100% - 120px)); }
.wm .ps .psline { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 8px; color: var(--fg); font-size: 8.5px; line-height: 1.5; padding: 2px 0; }
.wm .ps .psline span { color: var(--faint); font-size: 6.5px; letter-spacing: .2em; padding-top: 2px; }
.wm .ps .psline.scout span { color: var(--accent); }
.wm .ps .psv.small { margin-top: 6px; padding-top: 5px; border-top: 1px solid var(--line); }
.wm .ps .psv.small .pswave { height: 14px; }
/* freeze: the stamp at the top of the world */
.wm .psfz { position: absolute; top: 54px; right: 14px; z-index: 4; color: var(--dim); font-size: 7.5px; letter-spacing: .18em; background: var(--wm-float); border: 1px dashed var(--faint); padding: 4px 10px; white-space: nowrap; pointer-events: none; text-align: right; }
.wm .psfz[hidden] { display: none !important; }
.wm .psfz b { color: var(--fg); font-weight: 300; letter-spacing: .3em; }
.wm .psfz kbd { font: inherit; color: var(--fg); border: 1px solid var(--line); padding: 0 3px; letter-spacing: 0; }
.wm .psfz small { display: block; color: var(--faint); font-size: 6.5px; margin-top: 2px; }
.wm #gl { transition: filter .25s ease; }
/* the log: a DRY RUN line is the operator's own, accent-marked, dashed */
.wm .blog .log .lr.k-dry .mk { border: 1px dashed var(--accent); }
.wm .blog .log .lr.k-dry .tx { color: var(--accent); }
.wm[data-skin~="scout"] .ps, .wm[data-skin~="scout"] .ps .pscode, .wm[data-skin~="scout"] .ps kbd, .wm[data-skin~="scout"] .psfz, .wm[data-skin~="scout"] .psfz kbd { border-width: 0.5px; }
.wm[data-skin~="scout"] .ps .psg.direct { border-left-width: 0.5px; }
.wm[data-skin~="scout"] .ps .psf, .wm[data-skin~="scout"] .ps .psv.small { border-top-width: 0.5px; }
@media (prefers-reduced-motion: reduce) { .wm .ps .pswave i, .wm .ps .caret { animation: none; } }
/* bottom-left: one column at 46px (camera readout, chatter, source, window, hints); CENTER sits in the 44px rail beside it */
.wm .world .livebar, .wm .world .winbar { left: 46px; }
.wm .world .hint { left: 46px; }
/* CENTER opens the floor line on the same 46px edge as the chatter traces above it; the key hints follow it */
.wm .world .centerbtn { left: 46px; bottom: 6px; padding: 2px 0; gap: 6px; }
.wm .world .hint { left: 118px; }
/* the tally sits top-right of the world, right-aligned, clear of the bottom-left controls */
.wm .world .tally { position: absolute; top: 30px; right: 14px; z-index: 3; pointer-events: none; display: flex; flex-direction: column; align-items: flex-end; }
.wm .world .tally[hidden] { display: none; }
.wm .world .tally .lt { align-self: flex-end; align-items: flex-end; padding: 3px 0 3px 10px; }
.wm .world .tally .tw { justify-content: flex-end; }
/* scrims: the world dims under the HUD's top and bottom bands (heights measured by the engine), so canvas text never collides with a control */
.wm .world .scrim { position: absolute; left: 0; right: 0; z-index: 2; pointer-events: none; }
.wm .world .scrim-b { bottom: 0; height: var(--scrim-b, 96px); background: linear-gradient(to top, color-mix(in srgb, var(--bg) 88%, transparent) calc(100% - 14px), transparent); }
.wm .world .scrim-t { top: 0; height: var(--scrim-t, 84px); background: linear-gradient(to bottom, color-mix(in srgb, var(--bg) 82%, transparent) calc(100% - 14px), transparent); }
/* :guides — measured HUD edges over an 8px grid */
.wm .world .guides { position: absolute; inset: 0; z-index: 8; pointer-events: none; background-image: linear-gradient(to right, color-mix(in srgb, var(--fg) 6%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--fg) 6%, transparent) 1px, transparent 1px); background-size: 8px 8px; }
.wm .world .guides i { position: absolute; display: block; }
.wm .world .guides .gv { top: 0; bottom: 0; width: 0; border-left: 1px dashed color-mix(in srgb, var(--fg) 35%, transparent); }
.wm .world .guides .gh { left: 0; right: 0; height: 0; border-top: 1px dashed color-mix(in srgb, var(--fg) 35%, transparent); }
.wm .world .guides .on { border-style: solid; border-color: var(--accent); opacity: .7; }
.wm .world .guides b { position: absolute; font-weight: 300; font-size: 6.5px; letter-spacing: .08em; color: var(--fg); background: var(--bg); padding: 0 2px; }
.wm .world .guides .gv b { top: 2px; left: 2px; }
.wm .world .guides .gh b { left: 2px; top: -5px; }
.wm .world .guides .gv:nth-child(even) b { top: auto; bottom: 2px; }
/* the grid: 16px outer margin, one 48px content edge, every vertical position on 8px. :guides shows it */
.wm .world .hd { top: 8px; left: 16px; right: 16px; }
.wm .world .hd .k { margin-right: 10px; }
.wm .world .cam { top: 32px; left: 48px; }
.wm .world .views { top: 72px; left: 48px; }
.wm .world .tally { top: 32px; right: 16px; }
.wm .zoomrail { right: 16px; }
.wm .world .livebar { left: 48px; bottom: 64px; right: 160px; }
.wm .world .winbar { left: 48px; bottom: 24px; }
.wm .world .centerbtn { left: 48px; bottom: 8px; padding: 0; }
.wm .world .hint { left: 120px; bottom: 8px; right: 16px; }
.wm .world .scan { right: 16px; bottom: 24px; }
/* in the app: fill the ops content area instead of the Studio's fixed full-window frame */
.wm.wm--app { position: absolute; inset: 0; z-index: auto; }
.wm.wm--app .help { position: absolute; }
/* inside the app the shell already says where you are: no brand, ticker or clock row */
.wm.wm--app .top { display: none; }
.wm.wm--app .frame { grid-template-rows: minmax(0, 1fr) 20px; padding-top: 10px; }
`;
