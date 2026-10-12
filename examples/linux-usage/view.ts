import {
  absolute,
  cached,
  cachedCount,
  captured,
  cells,
  compactReset,
  type Direction,
  DIRECTIONS,
  OBSERVED_AT,
  percentage,
  type Reading,
  readingsFor,
  remaining,
  type Scenario,
} from "./model";

const root = document.getElementById("linux-usage-study")!;
const queries = new URLSearchParams(location.search);
const state = {
  scenario:
    (["example", "pressure", "missing"].includes(queries.get("scenario") ?? "")
      ? queries.get("scenario")
      : "example") as Scenario,
  width: Math.max(320, Math.min(520, Number(queries.get("width")) || 448)),
  dense: queries.get("density") !== "earlier",
  accent: queries.get("accent") === "phosphor" ? "phosphor" : "ash",
  expanded: null as string | null,
};
const escape = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const scoutMark =
  '<svg viewBox="0 0 20 24" width="20" height="24" aria-hidden="true"><path d="M10 1 18 5.5v9L10 19 2 14.5v-9L10 1Zm0 5 4 2.2v4.5L10 15l-4-2.3V8.2L10 6Z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
function meter(reading: Reading, direction: Direction): string {
  const left = remaining(reading);
  const tone = left === null
    ? "unknown"
    : left === 0
    ? "empty"
    : left <= 10
    ? "low"
    : "normal";
  const value = left === null
    ? 'role="img"'
    : `role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${left}"`;
  const marks = direction === "led"
    ? Array.from(
      { length: 20 },
      (_, i) => `<span data-lit="${i < cells(left)}"></span>`,
    ).join("")
    : `<span style="width:${left ?? 0}%"></span>`;
  return `<span class="meter ${
    direction === "led" ? "segmented" : "continuous"
  }" data-tone="${tone}" data-cached="${cached(reading)}" data-unknown="${
    left === null
  }" ${value} aria-label="${
    escape(reading.provider)
  } ${reading.window} capacity remaining${
    left === null ? " unknown" : ""
  }">${marks}</span>`;
}
function menu(direction: Direction, readings: Reading[]): string {
  return `<div class="menu" style="width:${state.width}px;max-width:100%" data-direction="${direction}" data-density="${
    state.dense ? "dense" : "earlier"
  }" data-accent="${state.accent}">
    <header class="menuHeader">${scoutMark}<div><strong>Scout</strong><small>Fixture · no live data</small></div><span aria-hidden="true">⌖ ×</span></header>
    <div class="tabs" aria-label="Proposed menu views"><span>Now</span><span>Work</span><span data-active="true">Usage</span><span>Machines</span><span>Tools</span></div>
    <div class="columnHeads" ${
    state.dense ? "" : "hidden"
  }><span>Window</span><span>Capacity</span><span>%</span><span>Reset</span><span></span></div>
    ${
    direction === "chart" && !state.dense
      ? '<div class="axis"><span>0</span><span>50</span><span>100%</span></div>'
      : ""
  }
    ${
    readings.map((reading, index) => {
      const id = `${direction}-${index}`,
        left = remaining(reading),
        open = state.expanded === id;
      return `<button class="quotaRow" data-row="${id}" aria-expanded="${open}" aria-controls="detail-${id}"><span class="identity"><strong>${reading.provider}</strong><span>${reading.window}</span></span>${
        meter(reading, direction)
      }<span class="value" data-low="${left !== null && left <= 10}">${
        escape(percentage(left))
      }${
        left === null
          ? ""
          : '<small class="srOnly">% capacity remaining</small>'
      }</span><span class="reset">${
        compactReset(reading)
      }</span><span class="freshness" data-cached="${
        cached(reading)
      }" data-missing="${
        reading.capturedAt === null
      }"><i aria-hidden="true"></i><span class="srOnly">${
        captured(reading)
      }</span></span></button>
      <div class="detail" id="detail-${id}" ${
        open ? "" : "hidden"
      }><strong>${reading.provider} · ${reading.window}</strong><span>${
        left === null
          ? "Capacity unknown"
          : `${percentage(left)}% capacity remaining`
      }</span><span>${reading.source}</span><span>${captured(reading)} · ${
        absolute(reading.capturedAt)
      }</span><span>Reset: ${
        absolute(reading.resetAt)
      }</span><span>Fixed observation: ${absolute(OBSERVED_AT)}</span></div>`;
    }).join("")
  }
    <footer class="menuFooter"><span><i aria-hidden="true"></i>${
    cachedCount(readings)
  } of ${readings.length} cached</span><span>Refresh limits</span></footer></div>`;
}
function render(): void {
  const readings = readingsFor(state.scenario);
  const focused = document.activeElement instanceof HTMLButtonElement
    ? document.activeElement.dataset.row
    : undefined;
  root.dataset.scenario = state.scenario;
  root.dataset.width = String(state.width);
  root.dataset.phosphor = String(state.accent === "phosphor");
  root.style.setProperty("--study-menu-width", `${state.width}px`);
  root.querySelector<HTMLOutputElement>("#width-output")!.value =
    `${state.width}px`;
  root.querySelector<HTMLInputElement>("#width")!.value = String(state.width);
  root.querySelector<HTMLSelectElement>("#scenario")!.value = state.scenario;
  root.querySelectorAll<HTMLButtonElement>("[data-density-choice]").forEach(
    (button) =>
      button.setAttribute(
        "aria-pressed",
        String((button.dataset.densityChoice === "dense") === state.dense),
      ),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-accent-choice]").forEach(
    (button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.accentChoice === state.accent),
      ),
  );
  root.querySelector("#comparison")!.innerHTML = DIRECTIONS.map((direction) =>
    `<section class="candidate"><div class="caption"><span>${direction.letter}</span><h2>${direction.title}</h2></div>${
      menu(direction.id, readings)
    }<p class="note">${
      state.dense
        ? direction.note
        : "Earlier pass: separate identity, gauge and reset lines for each window."
    }</p></section>`
  ).join("");
  if (focused) {
    root.querySelector<HTMLButtonElement>(`[data-row="${focused}"]`)?.focus();
  }
}
root.querySelector("#width")!.addEventListener("input", (event) => {
  state.width = Number((event.target as HTMLInputElement).value);
  render();
});
root.querySelector("#scenario")!.addEventListener("change", (event) => {
  state.scenario = (event.target as HTMLSelectElement).value as Scenario;
  state.expanded = null;
  render();
});
root.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("button");
  if (!button) return;
  if (button.dataset.row) {
    state.expanded = state.expanded === button.dataset.row
      ? null
      : button.dataset.row;
  } else if (button.dataset.densityChoice) {
    state.dense = button.dataset.densityChoice === "dense";
  } else if (button.dataset.accentChoice) {
    state.accent = button.dataset.accentChoice;
  } else return;
  render();
});
render();
if (queries.has("qa")) {
  const checks: string[] = [];
  const check = (name: string, value: boolean) => {
    if (!value) throw new Error(name);
    checks.push(name);
  };
  try {
    const scenario = root.querySelector<HTMLSelectElement>("#scenario")!;
    scenario.value = "missing";
    scenario.dispatchEvent(new Event("change"));
    check(
      "missing sample excluded from cached count",
      root.querySelector(".menuFooter")!.textContent!.includes("2 of 5 cached"),
    );
    check(
      "unknown capacity has no numeric meter",
      root.querySelectorAll('[role="meter"]').length === 9,
    );
    const row = root.querySelector<HTMLButtonElement>('[data-row="led-1"]')!;
    row.click();
    check(
      "row details open",
      !root.querySelector<HTMLElement>("#detail-led-1")!.hidden,
    );
    const width = root.querySelector<HTMLInputElement>("#width")!;
    width.value = "320";
    width.dispatchEvent(new Event("input"));
    check("320px width control", root.dataset.width === "320");
    check(
      "dense row is 28px",
      Math.abs(
        root.querySelector(".quotaRow")!.getBoundingClientRect().height - 28,
      ) < .5,
    );
    root.querySelector<HTMLButtonElement>('[data-density-choice="earlier"]')!
      .click();
    check(
      "earlier pass selected",
      root.querySelector<HTMLElement>(".menu")!.dataset.density === "earlier",
    );
    root.querySelector<HTMLButtonElement>('[data-density-choice="dense"]')!
      .click();
    root.querySelector<HTMLButtonElement>('[data-accent-choice="phosphor"]')!
      .click();
    check(
      "accent selected",
      root.querySelector<HTMLElement>(".menu")!.dataset.accent === "phosphor",
    );
    state.accent = "ash";
    state.expanded = null;
    render();
    const report = root.querySelector<HTMLElement>("#qa")!;
    report.hidden = false;
    report.textContent = `PASS · ${checks.length} control checks`;
  } catch (error) {
    const report = root.querySelector<HTMLElement>("#qa")!;
    report.hidden = false;
    report.textContent = `FAIL · ${String(error)}`;
    console.error(error);
  }
}
