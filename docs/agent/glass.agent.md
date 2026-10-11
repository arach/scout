# Glass window: files agents can edit

Glass is Scout as one see-through, chromeless window: one conversation, no sidebar, vim keys. Open it from the Scout menu with Glass Window (⌥⌘G).

Agents can open and close it through the app's control socket. `action` is `open`, `close` or `toggle`:

```sh
printf '{"schema":"scout-app.request.v1","op":"glass","action":"open"}\n' | nc -U ~/.openscout/run/scout-app.sock
```

Everything about it lives in files under `$OPENSCOUT_HOME/glass/` (default `~/.openscout/glass/`). While the window is open it re-reads them about every 1.5 s, so edits apply without a restart. `:set` in the window writes back to `config.json`. Parse errors and rejected entries show up in the window's bottom-left label and in `:help`.

## config.json

Every key is optional.

```json
{
  "version": 1,
  "window": { "tint": 0.42, "material": "ghostty", "chrome": "gone", "width": 820, "height": 560 },
  "ink": "scout",
  "font": { "size": 13 },
  "start": "scoutbot",
  "aliases": { "t": "go terminals", "brain": "b long-running brain" },
  "commands": {
    "standup": { "hint": "standup for a project", "to": "scoutbot", "say": "Give me a standup for {args}" }
  }
}
```

**`window`**
- `tint`: 0 to 0.95. The dark tint over the blur.
- `material`: one of
  - `ghostty`: the HUD blur under the tint.
  - `liquid`: the system glass on macOS 26, with a lighter tint.
- `chrome`: one of
  - `gone`: the traffic lights appear only when the pointer is on the top edge.
  - `strip`: the title appears there too.
- `width`, `height`: used when the window opens.

**`ink`**: `scout` (cool grey) or `lacquer` (warm cream).

**`font.size`**: 10 to 22.

**`start`**: the conversation the window opens on. One of:
- `scoutbot`
- an `@agent` handle
- a conversation id

**`aliases`**: a name that expands to a command line.

**`commands`**: the same fields as the command files below. If a file and a config entry define the same name, the file wins and the config entry is reported as a duplicate.

## commands/*.md — your own `:commands`

The file name is the command: `commands/review.md` becomes `:review`. Names use lowercase letters, digits and dashes. The built-in commands can't be redefined.

```markdown
---
hint: review the selected message
to: "@claude"
---
/review {selection}
```

**Frontmatter** (all optional; quote values that start with `@`):
- `to`: where the message goes. One of:
  - `scoutbot` (the default)
  - `here`, the conversation open in the window
  - an `@agent` handle
- `hint`: the text shown next to the command in the suggestion list and in `:help`.
- `run`: a command line to run instead of sending the body. This makes a macro, e.g. `run: go terminals`.

**Body**: the message to send. It can use these variables:
- `{args}`: whatever was typed after the command.
- `{selection}`: the selected message's text, in Nav mode.
- `{conversation}`: the open conversation's id.

A body that starts with `/skill-name` invokes that skill in the target agent's harness. That is how a skill becomes a Glass command.

## Built-in commands (the starting set)

| Command | What it does |
|---|---|
| `:go <place>` | Open the full app at terminals, projects, chat, home, requests, … |
| `:b <n or name>` (also `:e`) | Switch conversation |
| `:ls` | List conversations |
| `:new [@agent]` | New conversation; Scoutbot when no agent is given |
| `:ask @agent text` | Send a request to an agent |
| `:w` | Send the reply |
| `:set key=value` | `tint`, `material`, `chrome`, `ink`, `fontsize`, `start`; written to config.json |
| `:reload` | Re-read the files now |
| `:q` | Leave Glass for the full app |
| `:help` | List the built-in commands, your commands, your aliases and where the files are |

## Keys

**Insert mode** (the default): you are typing a reply.

**Esc** switches to **Nav** mode:
- `j` / `k`: move between messages.
- `gg` / `G`: jump to the first or last message.
- `^d` / `^u`: move half a page.
- `[` / `]`: previous or next conversation.
- `/`: search, highlighted as you type. Then `n` / `N` step through the matches.
- `y`: copy the selected message.
- `:`: a command.
- `i`, `a` or Return: back to the reply.
