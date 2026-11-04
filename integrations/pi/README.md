# Automatic task titles for Pi

An **optional** integration for [Pi](https://pi.dev) and this repository's Herdr
`pane-labels` mod. It gives each interactive Pi agent a tool and task instructions
to maintain its own short, meaningful pane title as the work changes.

The UI mod remains independent: any program can still set `pane.title` using
`hc label`, and nothing here is required to use it manually.

## Install

First install and enable the Herdr header as described in the [root README](../../README.md).
Then choose **one** Pi installation method:

### Pi package

Once the integration is in the repository/ref you want to use:

```sh
pi install git:github.com/kiote/herdr-pane-labels
```

A branch or commit can be selected explicitly:

```sh
pi install git:github.com/kiote/herdr-pane-labels@feat/pi-auto-titles
```

The root `package.json` exposes only `integrations/pi/index.ts` to Pi. This
installs the Pi integration, **not** the Herdr mod or a layout. Node modules used
at runtime are provided by Pi; no additional title-generation service is used.

### Manual copy

From this repository:

```sh
mkdir -p ~/.pi/agent/extensions/herdr-pane-titles
cp integrations/pi/index.ts ~/.pi/agent/extensions/herdr-pane-titles/index.ts
```

Use your actual Pi agent directory if you have customized it. Do not install
both ways: duplicate extensions would register the same tool/command. To migrate
from a manual installation to the package, move the manual extension directory
out of `extensions/` first, retaining a backup if you want one.

New Pi sessions load it automatically. In **already running** sessions, use
`/reload` once. The integration does not inject keystrokes, interrupt other
agents or overwrite unsent drafts. No user command is needed to name each task
after the integration is loaded.

## What happens

1. On startup, resume or reload, restore the active branch's saved title/mode.
   Preserve a pre-existing, unowned label during initial rollout; otherwise use
   the Pi session name or project-folder name as an immediate fallback.
2. Before work starts, tell the conversational agent to call `set_pane_title`
   proactively when a substantive new task starts or its focus changes. Labels
   should identify the project and task, not repeat every small step.
3. Set only that terminal's labels using `hc label "$HC_TERMINAL_ID" ...`.
   The header updates live. No other pane, tab or agent-status field changes.
4. Persist semantic title changes and manual settings as Pi custom entries.
   Restore those settings from the active branch, not abandoned branches.

**This is agent-maintained automation, not an independent summarization daemon.**
If the model does not call the tool, the previous/fallback title remains. There
is no separate model request, transcript scanner, background polling, credentials
lookup or third-party service. The instruction/tool uses a small amount of the
normal conversation's context and activity.

Pi's `/name` synchronizes the pane title in automatic mode. It does not replace
a manually pinned pane title. The integration does not rename Pi sessions.

## Optional controls

| Command in Pi | Effect |
|---|---|
| `/pane-title status` | Show the current mode and title |
| `/pane-title A fixed label` | Pin that label; automatic calls cannot replace it |
| `/pane-title auto` | Resume automatic task-title maintenance |
| `/pane-title off` | Freeze updates while retaining the displayed label |

Settings survive reload/resume and follow Pi's active conversation branch.
`auto`, `off` and `status` are reserved command arguments.

## Requirements and safety

- An interactive Pi TUI session inside a Herdr terminal, with
  `HC_TERMINAL_ID` and `HC_TERMINAL_SOCKET`, and `hc` on PATH.
- Pi 1.5.0 is the host version tested. A hidden-message fallback supports hosts
  without structured prompt sections, but older versions are not certified.
- Print/JSON/RPC runs do not publish labels. In particular, headless child agents
  inheriting their parent's environment cannot rename that parent's pane.
- The integration is local to the machine running Pi. Remote Pi sessions need
  their own installation and local Herdr core environment.
- `hc` runs with a literal argument array, never a shell-interpolated title.
  Writes are serialized, deduplicated and bounded by a 1.5-second subprocess timeout.
- ANSI/control/bidirectional characters are removed; titles are capped at 64
  Unicode code points. Common URL/email/credential patterns are rejected.
  This is **not a complete sensitive-data filter**: agents are instructed to
  use generic descriptions, never secrets, personal details or private quotations.
- Herdr status indicators and its managed Pi integration are untouched. No
  subprocess or timer starts just because the extension module is imported.
- Titles are display metadata, not trusted instructions or authorization.

## Tests

From the repository root, using Node 22 or 24:

```sh
npm ci --ignore-scripts
npm test
```

Tests run the TypeScript extension through Jiti with mock Pi/`hc` interfaces.
They do not require Herdr, a running Pi session, credentials or model calls.
CI runs on Node 22 and 24. A passing test run does not guarantee that every
model will follow the title-maintenance instruction.

The root `devDependencies` exist only for tests. The extension's runtime
TypeBox and Pi types are host-provided peers; no Pi runtime is bundled.

## Uninstall

For a package installation:

```sh
pi remove git:github.com/kiote/herdr-pane-labels
```

Use the configured source/ref if yours differs. For a manual installation, move
`herdr-pane-titles` out of Pi's `extensions/` directory. Then `/reload` affected
sessions. Existing terminal labels remain; clear one with
`hc label <terminal> pane.title=` if desired. Neither removal method disables
the independent Herdr header mod.
