import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { installScoutApiMiddleware } from "./server-core.ts";
import { mountWorldRoutes, type WorldRouteDeps } from "./routes/world.ts";
import {
  buildWorldJevRequest,
  resolveWorldCommand,
  fallbackWorldCommand,
  fuzzyName,
  resolveTime,
  worldVoiceActions,
  type WorldCommandContext,
} from "./world-command.ts";

// A fixed week on a PDT machine (getTimezoneOffset 420): Fri 10/02 22:00 → Fri 10/09 22:00 local.
// Friday occurs twice in it, every other weekday once.
const pdt = (iso: string) => Date.parse(`${iso}-07:00`);
const TO = pdt("2026-10-09T22:00:00"), FROM = TO - 7 * 864e5;
const ctx: WorldCommandContext = {
  from: FROM, to: TO, t: pdt("2026-10-06T10:00:00"), tzOffset: 420, speed: 1,
  roster: ["devon", "galileo", "hudson", "scoutbot"],
  lanes: ["openscout", "wt · voice-nav", "wt · world-port", "scratch", "unrooted"],
};

const headers = { authorization: "Bearer operator-test", "content-type": "application/json", origin: "http://localhost" };
function routeApp(command: WorldRouteDeps["command"]) {
  const app = new Hono();
  installScoutApiMiddleware(app, "world-command-test", { authToken: "operator-test" });
  mountWorldRoutes(app, { week: {} as WorldRouteDeps["week"], stash: {} as WorldRouteDeps["stash"], command });
  return app;
}
const post = (app: Hono, text: string, context: WorldCommandContext | undefined = ctx) =>
  app.request("http://localhost/api/ops/world-command", { method: "POST", headers, body: JSON.stringify({ text, context }) });

/** A Jev stand-in: records the body, answers with the given choices. */
function jevMock(answers: Record<string, unknown>, status = 200) {
  const calls: { url: string; body: any; auth: string | null }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") });
    return new Response(JSON.stringify({ model: "jev-latest", answers }), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}
const jev = { apiKey: "k-test", endpoint: "https://jev.test/v1/systemone" };

describe("time phrases resolve inside the fixed week", () => {
  test("a weekday + part of day becomes a readable absolute goto", () => {
    const r = resolveTime("wednesday afternoon", ctx);
    expect(r).toEqual({ kind: "at", at: pdt("2026-10-07T15:00:00"), line: "goto wed 15:00", echo: "WED 15:00" });
  });
  test("a clock time: friday 2pm takes the most recent friday, exact because friday occurs twice", () => {
    const r = resolveTime("friday 2pm", ctx);
    expect(r).toMatchObject({ kind: "at", at: pdt("2026-10-09T14:00:00"), line: `goto @${pdt("2026-10-09T14:00:00")}` });
    expect(resolveTime("Friday at 2 p.m.", ctx)).toMatchObject({ at: pdt("2026-10-09T14:00:00") });
  });
  test("ago is from the week's now; back/forward stay relative to the playhead", () => {
    expect(resolveTime("an hour ago", ctx)).toMatchObject({ kind: "at", at: TO - 36e5 });
    expect(resolveTime("two days ago", ctx)).toMatchObject({ at: pdt("2026-10-07T22:00:00"), line: "goto wed 22:00" });
    expect(resolveTime("go back two hours", ctx)).toEqual({ kind: "line", line: "goto -2h", echo: "-2H" });
    expect(resolveTime("forward 30 minutes", ctx)).toMatchObject({ line: "goto +30m" });
    expect(resolveTime("half an hour later", ctx)).toMatchObject({ line: "goto +30m" });
  });
  test("week ends, today and yesterday", () => {
    expect(resolveTime("end of week", ctx)).toMatchObject({ line: "goto now" });
    expect(resolveTime("start of the week", ctx)).toMatchObject({ line: "goto start" });
    expect(resolveTime("yesterday at 9", ctx)).toMatchObject({ at: pdt("2026-10-08T09:00:00"), line: "goto thu 09:00" });
    expect(resolveTime("this morning", ctx)).toMatchObject({ at: pdt("2026-10-09T09:00:00") });
    expect(resolveTime("saturday morning", ctx)).toMatchObject({ line: "goto sat 09:00" });
  });
  test("a bare clock time lands on the playhead's day", () => {
    expect(resolveTime("3:30", ctx)).toMatchObject({ at: pdt("2026-10-06T03:30:00"), line: "goto tue 03:30" });
    expect(resolveTime("at 4", ctx)).toMatchObject({ at: pdt("2026-10-06T16:00:00") });
  });
  test("times outside the week say so instead of clamping", () => {
    expect(resolveTime("friday 11pm", ctx)).toMatchObject({ kind: "outside", echo: "FRI 23:00 HASN'T HAPPENED YET" });
    expect(resolveTime("ten days ago", ctx)).toMatchObject({ kind: "outside" });
  });
  test("no time phrase → null", () => {
    expect(resolveTime("find devon", ctx)).toBeNull();
    expect(resolveTime("pause", ctx)).toBeNull();
  });
});

describe("names are fuzzy-matched against the roster and lanes", () => {
  test("speech misspellings and lane parts", () => {
    expect(fuzzyName("find devin", ctx.roster!)?.name).toBe("devon");
    expect(fuzzyName("where is galilleo", ctx.roster!)?.name).toBe("galileo");
    expect(fuzzyName("solo voice nav", ctx.lanes!)?.name).toBe("wt · voice-nav");
    expect(fuzzyName("world port", ctx.lanes!)?.name).toBe("wt · world-port");
    expect(fuzzyName("the weather", ctx.roster!)).toBeNull();
  });
});

describe("fallback parser (no Jev)", () => {
  const cases: Array<[string, string[]]> = [
    ["wednesday afternoon", ["goto wed 15:00"]],
    ["go to wednesday at 2pm", ["goto wed 14:00"]],
    ["find devin", ["find devon"]],
    ["fly to galileo", ["find galileo"]],
    ["solo the voice nav lane", ["lane wt · voice-nav"]],
    ["show all lanes", ["lane all"]],
    ["top view", ["view top"]],
    ["look from above", ["view top"]],
    ["zero in", ["zero"]],
    ["go back", ["back"]],
    ["never mind", ["back"]],
    ["open the inspector", ["open"]],
    ["expand the preview", ["preview"]],
    ["pause", ["pause"]],
    ["resume", ["play"]],
    ["faster", ["speed 2"]],
    ["show the last four hours", ["window 4h"]],
    ["last 30 minutes", ["window 30m"]],
    ["widen the window", ["window wider"]],
    ["show the mesh", ["window all"]],
    ["close the window", ["window off"]],
    ["speed 4", ["speed 4"]],
    ["4x", ["speed 4"]],
    ["back two hours", ["goto -2h"]],
  ];
  for (const [text, commands] of cases) {
    test(`"${text}"`, () => {
      const r = fallbackWorldCommand(text, ctx);
      expect(r.status).toBe("ok");
      if (r.status === "ok") { expect(r.commands).toEqual(commands); expect(r.engine).toBe("fallback"); }
    });
  }
  test("a bare name is a guess: confirm, not run", () => {
    const r = fallbackWorldCommand("hudson", ctx);
    expect(r.status).toBe("confirm");
    if (r.status === "confirm") expect(r.proposal.commands).toEqual(["find hudson"]);
  });
  test("not a World command", () => {
    expect(fallbackWorldCommand("what's the weather", ctx).status).toBe("none");
    expect(fallbackWorldCommand("find nobody-at-all", ctx)).toMatchObject({ status: "none", echo: "NO AGENT MATCHES" });
  });
});

describe("POST /api/ops/world-command", () => {
  test("requires operator auth and a text", async () => {
    const app = routeApp({ jev: null });
    expect((await app.request("http://localhost/api/ops/world-command", { method: "POST", body: "{}" })).status).toBe(401);
    expect((await app.request("http://localhost/api/ops/world-command", { method: "POST", headers: { ...headers, origin: "https://foreign.example" }, body: "{}" })).status).toBe(403);
    expect((await post(app, "")).status).toBe(400);
  });
  test("literal ':' lines pass straight through", async () => {
    const res = await (await post(routeApp({ jev: null }), ":goto wed 14:00")).json();
    expect(res).toMatchObject({ status: "ok", engine: "literal", verb: "goto", commands: ["goto wed 14:00"] });
  });
  test("lines that only start like a verb are words: names fuzzy-match, back + a time is a goto", async () => {
    const app = routeApp({ jev: null });
    expect(await (await post(app, "find devin")).json()).toMatchObject({ engine: "fallback", commands: ["find devon"] });
    expect(await (await post(app, "back two hours")).json()).toMatchObject({ engine: "fallback", commands: ["goto -2h"] });
    expect(await (await post(app, "zero in")).json()).toMatchObject({ engine: "fallback", commands: ["zero"] });
    expect(await (await post(app, "speed 4")).json()).toMatchObject({ engine: "literal", commands: ["speed 4"] });
  });
  test("without a Jev key the keyword parser answers and says so", async () => {
    const res = await (await post(routeApp({ jev: null }), "wednesday afternoon")).json();
    expect(res).toMatchObject({ status: "ok", engine: "fallback", verb: "goto", commands: ["goto wed 15:00"], at: pdt("2026-10-07T15:00:00") });
  });
  test("Jev picks the verb and the agent; code reads nothing else from it", async () => {
    const m = jevMock({ verb: { type: "choice", choice: "find", probability: 0.94 }, agent: { type: "choice", choice: "r0", probability: 0.9 }, view: { type: "choice", choice: "none", probability: 0.99 }, lane: { type: "choice", choice: "none", probability: 0.97 } });
    const res = await (await post(routeApp({ jev, fetcher: m.fetcher }), "where did the devon guy get to")).json();
    expect(res).toMatchObject({ status: "ok", engine: "jev", verb: "find", commands: ["find devon"], confidence: 0.94 });
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]!.auth).toBe("Bearer k-test");
    expect(m.calls[0]!.body.questions.verb.type).toBe("choice");
    expect(m.calls[0]!.body.questions.agent.choices.r0).toBe("devon");
  });
  test("Jev's verb + code's dates: Jev never sees a time to compute", async () => {
    const m = jevMock({ verb: { type: "choice", probabilities: { goto: 0.88, find: 0.07 } } });
    const res = await (await post(routeApp({ jev, fetcher: m.fetcher }), "take me to thursday evening")).json();
    expect(res).toMatchObject({ status: "ok", engine: "jev", commands: ["goto thu 19:00"], confidence: 0.88 });
    expect(JSON.stringify(m.calls[0]!.body)).not.toContain(String(FROM));
  });
  test("below the 0.72 floor → confirm with the proposal, nothing to run", async () => {
    const m = jevMock({ verb: { type: "choice", choice: "goto", probability: 0.55 } });
    const res = await (await post(routeApp({ jev, fetcher: m.fetcher }), "maybe wednesday")).json();
    expect(res.status).toBe("confirm");
    expect(res.commands).toBeUndefined();
    expect(res.proposal).toMatchObject({ verb: "goto", commands: ["goto wed 12:00"], confidence: 0.55 });
  });
  test("a Jev failure falls back to the keyword parser and reports why", async () => {
    const m = jevMock({}, 500);
    const res = await (await post(routeApp({ jev, fetcher: m.fetcher }), "freeze it")).json();
    expect(res).toMatchObject({ status: "ok", engine: "fallback", commands: ["pause"], jevError: "Jev answered 500." });
  });
  test("context is optional; times then stay engine-relative", async () => {
    const res = await (await post(routeApp({ jev: null }), "wednesday afternoon", undefined)).json();
    expect(res).toMatchObject({ status: "ok", commands: ["goto wed 15:00"] });
  });
});

describe("Jev request body", () => {
  test("carries the words and names, no week bounds or playhead", () => {
    const body = buildWorldJevRequest("find devin", ctx);
    expect(body.state).toEqual({ schema: "openscout.world-command.v1", words: "find devin", open: null, playing: null });
    expect(Object.keys(body.questions)).toEqual(["verb", "view", "agent", "lane"]);
  });
});

describe("always-on voice → World", () => {
  test("a HUD move goes to the open World page", () => {
    expect(worldVoiceActions("go to wednesday afternoon", { worldOpen: true })).toEqual([{ type: "world.command", text: "go to wednesday afternoon", reason: "voice" }]);
    expect(worldVoiceActions("I was reading the logs. Pause", { worldOpen: true })).toEqual([{ type: "world.command", text: "Pause", reason: "voice" }]);
  });
  test("World named while it isn't open: navigate there first", () => {
    expect(worldVoiceActions("show me wednesday on the timeline", { worldOpen: false })).toEqual([
      { type: "navigate", route: { view: "ops", mode: "week" } },
      { type: "world.command", text: "show me wednesday on the timeline", reason: "voice" },
    ]);
  });
  test("everything else stays with Scoutbot", () => {
    expect(worldVoiceActions("pause", { worldOpen: false })).toBeNull();
    expect(worldVoiceActions("what did devon ship today", { worldOpen: true })).toBeNull();
    expect(worldVoiceActions("summarize the world news", { worldOpen: false })).toBeNull();
  });
});

describe("the window ladder by voice and by line", () => {
  test("a literal :window line passes through as the window verb", async () => {
    const r = await resolveWorldCommand(":window 24h", ctx, { jev: null });
    expect(r).toMatchObject({ status: "ok", engine: "literal", verb: "window", commands: ["window 24h"] });
    expect((await resolveWorldCommand("window", ctx, { jev: null })).status).toBe("ok");
  });
  test("an always-on utterance about the window goes to the open HUD", () => {
    expect(worldVoiceActions("show me the last five minutes", { worldOpen: true })).toEqual([{ type: "world.command", text: "show me the last five minutes", reason: "voice" }]);
  });
});

describe("the source verb", () => {
  test("a literal :source line passes through", async () => {
    expect(await resolveWorldCommand(":source live", ctx, { jev: null })).toMatchObject({ status: "ok", engine: "literal", verb: "source", commands: ["source live"] });
    expect((await resolveWorldCommand("source", ctx, { jev: null })).status).toBe("ok");
  });
  test("words pick the source; a bare 'live' window stays a window", async () => {
    expect(await resolveWorldCommand("go live", ctx, { jev: null })).toMatchObject({ verb: "source", commands: ["source live"] });
    expect(await resolveWorldCommand("switch the source to otlp", ctx, { jev: null })).toMatchObject({ verb: "source", commands: ["source otlp"] });
    expect(await resolveWorldCommand("back to the snapshot", ctx, { jev: null })).toMatchObject({ verb: "source", commands: ["source week"] });
    expect(await resolveWorldCommand("show the last five minutes", ctx, { jev: null })).toMatchObject({ verb: "window", commands: ["window 5m"] });
  });
});

describe("FAILED · STUCK by voice and by line", () => {
  test("show me errors · what's broken · hide the errors", () => {
    const a = fallbackWorldCommand("show me errors");
    expect(a.status === "ok" && a.verb).toBe("errors");
    expect(a.status === "ok" && a.commands).toEqual(["errors on"]);
    const b = fallbackWorldCommand("what's broken");
    expect(b.status === "ok" && b.commands).toEqual(["errors on"]);
    const c = fallbackWorldCommand("hide the errors");
    expect(c.status === "ok" && c.commands).toEqual(["errors off"]);
  });
  test("anything stuck over ten minutes? sets the threshold, then shows it", () => {
    const r = fallbackWorldCommand("anything stuck over ten minutes?");
    expect(r.status === "ok" && r.verb).toBe("stuck");
    expect(r.status === "ok" && r.commands).toEqual(["stuck 10m", "errors on"]);
    const h = fallbackWorldCommand("what's been stuck for an hour");
    expect(h.status === "ok" && h.commands).toEqual(["stuck 1h", "errors on"]);
    const bare = fallbackWorldCommand("is anything stuck");
    expect(bare.status === "ok" && bare.commands).toEqual(["errors on"]);
  });
  test(":errors and :stuck lines pass through literally", async () => {
    for (const line of ["errors", "errors on", "errors off", "stuck 10m", "stuck 1h", "stuck 30"]) {
      const r = await resolveWorldCommand(line, {}, { jev: null });
      expect(r.status === "ok" && r.engine).toBe("literal");
    }
  });
  test("voice routes trouble words to the open World", () => {
    expect(worldVoiceActions("what's broken", { worldOpen: true })?.[0]).toMatchObject({ type: "world.command" });
    expect(worldVoiceActions("anything stuck over ten minutes", { worldOpen: true })?.[0]).toMatchObject({ type: "world.command" });
  });
});

describe("theme and accent by voice and by line", () => {
  test("words pick a treatment", () => {
    const cases: Array<[string, string]> = [["switch to paper", "theme paper"], ["ember theme", "theme ember"], ["light mode", "theme paper"], ["go dark", "theme scout"], ["next theme", "theme next"]];
    for (const [said, line] of cases) {
      const r = fallbackWorldCommand(said);
      expect(r.status === "ok" && r.verb).toBe("theme");
      expect(r.status === "ok" && r.commands).toEqual([line]);
    }
  });
  test("words pick an accent, or reset it", () => {
    const a = fallbackWorldCommand("make the accent cobalt");
    expect(a.status === "ok" && a.commands).toEqual(["accent cobalt"]);
    const b = fallbackWorldCommand("reset the accent");
    expect(b.status === "ok" && b.commands).toEqual(["accent default"]);
  });
  test(":theme and :accent lines pass through literally", async () => {
    for (const line of ["theme", "theme paper", "theme next", "accent", "accent violet", "accent default"]) {
      const r = await resolveWorldCommand(line, {}, { jev: null });
      expect(r.status === "ok" && r.engine).toBe("literal");
    }
  });
});

describe("voice derives from the HUD's command registry", () => {
  test("every verb lands on one registry entry, and Jev's choices are that entry's words", async () => {
    const { COMMANDS } = await import("../client/screens/ops/world-week/commands.ts");
    const { WORLD_VERBS, VERB_CHOICES } = await import("./world-command.ts");
    for (const verb of WORLD_VERBS) {
      const c = COMMANDS.filter((x) => x.voice?.verb === verb);
      expect({ verb, n: c.length }).toEqual({ verb, n: 1 });
      expect(VERB_CHOICES[verb]).toBe(c[0]!.voice!.choice ?? c[0]!.desc);
    }
    for (const c of COMMANDS) if (c.voice?.verb) expect(WORLD_VERBS as readonly string[]).toContain(c.voice.verb);
  });
  test("every registry phrase resolves (fallback parser) to its command", async () => {
    const { COMMANDS, CMD_LINE, parseLine } = await import("../client/screens/ops/world-week/commands.ts");
    for (const c of COMMANDS) for (const p of c.voice?.phrases ?? []) {
      const said = Array.isArray(p) ? p[0] : p;
      const r = fallbackWorldCommand(said);
      expect({ said, status: r.status }).toEqual({ said, status: "ok" });
      if (r.status !== "ok") continue;
      if (c.voice!.verb) expect({ said, verb: r.verb }).toEqual({ said, verb: c.voice!.verb });
      else expect({ said, commands: r.commands }).toEqual({ said, commands: [Array.isArray(p) ? p[1] : c.voice!.line!] });
      // whatever it makes is a line the HUD runs, on this command
      for (const line of r.commands) {
        expect({ line, ok: CMD_LINE.test(line) }).toEqual({ line, ok: true });
        if (r.verb !== "errors" && r.verb !== "stuck") expect({ said, id: parseLine(line)?.cmd.id }).toEqual({ said, id: c.id });
      }
    }
  });
  test("a verbless command passes through literally and by phrase", async () => {
    const lit = await resolveWorldCommand("lift on", {}, { jev: null });
    expect(lit.status === "ok" && lit.engine).toBe("literal");
    const said = await resolveWorldCommand("reset the camera", {}, { jev: null });
    expect(said.status === "ok" && said.commands).toEqual(["reset"]);
    expect(worldVoiceActions("artifacts up", { worldOpen: true })?.[0]).toMatchObject({ type: "world.command" });
  });
});
