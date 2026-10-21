import type { ScoutCommandContext } from "../context.ts";
import { ScoutCliError } from "../errors.ts";
import { askScoutApp } from "../scout-app-socket.ts";

// Codex voice in the ChatGPT app, through the Scout app's socket. The app
// reads and presses the ChatGPT app's own controls (Accessibility), so any
// tool on this Mac (Fab, Talkie, Lattices, a hotkey) can start, mute and
// stop a chat's voice without knowing how ChatGPT draws them.

const VOICE_HELP = `scout voice: Codex voice chat in the ChatGPT app

  scout voice status [--thread <codex-thread-id>]...
  scout voice talk [<codex-thread-id>]
  scout voice mic [on|off|toggle]
  scout voice speakers [on|off|toggle]
  scout voice stop

status says whether a voice chat is on, in which of the given threads, and
whether its microphone and speakers are muted. talk opens the thread in the
ChatGPT app and starts its voice chat; the thread defaults to CODEX_THREAD_ID.
mic and speakers turn that side on or off (toggle when no word is given);
stop ends the voice chat. Needs Scout.app running with Accessibility access.
Add --json for the raw reply.

The same calls are on the app socket (~/.openscout/run/scout-app.sock), one
JSON line each: {"schema":"scout-app.request.v1","op":"voice.state"},
{"op":"voice.talk","threadId":…}, {"op":"voice.press","control":"microphone"|
"speakers"|"stop","muted":true|false}.
`;

const THREAD_ID = /^[0-9a-f-]{16,64}$/i;

type VoiceState = {
  active: boolean;
  thread: string | null;
  title?: string;
  micMuted?: boolean;
  speakersMuted?: boolean;
};

export async function runVoiceCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  const [action = "status", ...rest] = args;
  if (action === "help" || action === "--help" || action === "-h" || rest.includes("--help")) {
    context.output.writeText(VOICE_HELP);
    return;
  }
  switch (action) {
    case "status": {
      const threadIds: string[] = [];
      for (let i = 0; i < rest.length; i += 1) {
        if (rest[i] === "--thread" && rest[i + 1]) threadIds.push(rest[(i += 1)]!);
      }
      const state = await call({ op: "voice.state", threadIds });
      context.output.writeValue(state, renderState);
      return;
    }
    case "talk": {
      const threadId = rest[0]?.trim() || context.env.CODEX_THREAD_ID?.trim() || "";
      if (!THREAD_ID.test(threadId)) {
        throw new ScoutCliError("scout voice talk needs a Codex thread id (or run it inside a Codex chat).");
      }
      const reply = await call({ op: "voice.talk", threadId });
      context.output.writeValue(reply, () => (reply.listening ? "Voice chat started in the ChatGPT app." : "Pressed Start voice chat; ChatGPT hasn't shown it running yet."));
      return;
    }
    case "mic":
    case "microphone":
    case "speakers": {
      const control = action === "speakers" ? "speakers" : "microphone";
      const word = rest[0] ?? "toggle";
      if (!["on", "off", "toggle"].includes(word)) throw new ScoutCliError(`scout voice ${action} takes on, off or toggle.`);
      const muted = word === "toggle" ? undefined : word === "off";
      const state = await call({ op: "voice.press", control, ...(muted === undefined ? {} : { muted }) });
      context.output.writeValue(state, renderState);
      return;
    }
    case "stop": {
      const state = await call({ op: "voice.press", control: "stop" });
      context.output.writeValue(state, renderState);
      return;
    }
    default:
      throw new ScoutCliError(`unknown voice action: ${action} (try: scout voice status|talk|mic|speakers|stop)`);
  }
}

async function call(request: { op: string; [field: string]: unknown }): Promise<VoiceState & { listening?: boolean }> {
  const reply = await askScoutApp(request);
  if (!reply.ok) throw new ScoutCliError(reply.message);
  const { ok: _ok, ...value } = reply;
  return value as unknown as VoiceState & { listening?: boolean };
}

function renderState(state: VoiceState): string {
  if (!state.active) return "No voice chat is on in the ChatGPT app.";
  const where = state.title ? `in “${state.title}”` : "in the ChatGPT app";
  const sides = [
    state.micMuted === undefined ? null : state.micMuted ? "mic muted" : "mic on",
    state.speakersMuted === undefined ? null : state.speakersMuted ? "speakers muted" : "speakers on",
  ].filter(Boolean);
  return `Voice chat on ${where}${sides.length ? ` (${sides.join(", ")})` : ""}.`;
}
