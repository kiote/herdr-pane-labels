# Pane labels for Herdr

Give each pane its own title from outside the app. Set a label on the pane's
terminal, and the pane header shows it after the agent's name:

```sh
hc label t7 "pane.title=Fix the login redirect loop"
```

![Pane labels](preview.png)

Two agents in one tab and one folder look the same in Herdr's shipped header
(`Pi  ~/shop-api`). With this mod, a script, a dashboard or the agent itself
names each one. Herdr has no pane name of its own, so the title is a label on
the core terminal: it stays while the terminal lives, also when the window
closes.

## Install

Ask your Herdr agent: *"add the mod at github.com/kiote/herdr-pane-labels"*.
It reads [RECIPE.md](RECIPE.md) and the files, copies the folder and points a
copy of your layout at it.

By hand:

1. Copy the mod folder:

   ```sh
   git clone https://github.com/kiote/herdr-pane-labels
   cp -R herdr-pane-labels/mods/pane-labels ~/.config/herdr-app/mods/
   ```

   Use `$HERDR_APP_HOME` instead of `~/.config/herdr-app` if you set it.

2. Copy the layout you use (Herdr updates its own layouts on start). For the
   default one, `main`:

   ```sh
   herdr-app do layout.clone --name main --as main-labels
   ```

3. In `layouts/main-labels.json`, change the pane header's
   `"mod": "pane"` to `"mod": "pane-labels"`. The window reloads it.

4. Check it: `herdr-app check ~/.config/herdr-app/mods/pane-labels`.

To go back, switch to your old layout (`ctrl-shift-l`).

## Use

| Command | Effect |
|---|---|
| `hc label <terminal> "pane.title=<title>"` | shows `<title>` in the header |
| `hc label <terminal> pane.title=` | removes it; the header is Herdr's again |
| `hc ls` | the terminal addresses (`t7`) |

Inside a Herdr terminal, `$HC_TERMINAL_ID` is its own address, so an agent
hook can name its own pane: `hc label "$HC_TERMINAL_ID" "pane.title=..."`.

The mod also reads `dashboard.title` when `pane.title` is not set.

## What it does not do

- It does not make titles. Something must set the label.
- It reads only labels: no network, no programs, no files.
- It replaces the header only in the layout that points to it.

## License

Apache-2.0. The mod is a modified copy of Herdr's shipped `pane` mod; see
[NOTICE](NOTICE).
