/** Task labels for the Herdr pane-labels mod. No background model calls or polling. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { basename } from "node:path";
import { stripVTControlCharacters } from "node:util";

const ENTRY = "herdr-pane-title-v1";
type State = { mode: "auto" | "manual" | "off"; title: string };

export function cleanTitle(value: string): string {
  const text = stripVTControlCharacters(value)
    .replace(/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ").trim();
  if (!text) throw new Error("Give the pane a short, nonempty task title.");
  // Titles are visible UI metadata, not a place for prompts or credentials.
  if (/https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\bBearer\s|PRIVATE KEY|\b(?:api[_-]?key|password|token)\s*[:=]|\b(?:sk-|ghp_|github_pat_)[a-z0-9_]{12,}/i.test(text)) {
    throw new Error("Use a generic task title without links, email addresses or credentials.");
  }
  return Array.from(text).slice(0, 64).join("");
}

export function restoreState(entries: any[]): State {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type !== "custom" || e.customType !== ENTRY) continue;
    if (!["auto", "manual", "off"].includes(e.data?.mode) || typeof e.data?.title !== "string") continue;
    try { return { mode: e.data.mode, title: e.data.title ? cleanTitle(e.data.title) : "" }; } catch { /* ignore invalid historical metadata */ }
  }
  return { mode: "auto", title: "" };
}

export default function (pi: ExtensionAPI) {
  const terminal = process.env.HC_TERMINAL_ID;
  if (!terminal || !/^t[a-z0-9]+$/i.test(terminal) || !process.env.HC_TERMINAL_SOCKET) return;

  let state: State = { mode: "auto", title: "" };
  let published = "";
  let session = "";
  let warned = false;
  // Serialize mutations: simultaneous model tools must not race a manual override.
  let queue: Promise<unknown> = Promise.resolve();
  function serialized<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work);
    queue = next.catch(() => {});
    return next;
  }
  const active = (ctx: ExtensionContext) => ctx.mode === "tui";
  function persist() { pi.appendEntry(ENTRY, { ...state }); }
  function warn(ctx: ExtensionContext, error: unknown) {
    if (!warned) {
      warned = true;
      ctx.ui.notify(`Pane title could not be updated: ${String(error).slice(0, 160)}`, "warning");
    }
  }
  async function publish(ctx: ExtensionContext) {
    if (!active(ctx) || state.mode === "off" || !state.title) return;
    const signature = JSON.stringify([session, state.mode, state.title]);
    if (signature === published) return;
    const r = await pi.exec("hc", ["label", terminal!, `pane.title=${state.title}`,
      `pane.title.mode=${state.mode}`, `pane.title.session=${session}`], { timeout: 1500 });
    if (r.code !== 0) throw new Error("hc label failed (terminal/core unavailable)");
    published = signature;
    warned = false;
  }

  async function initialize(ctx: ExtensionContext) {
    if (!active(ctx)) return;
    session = ctx.sessionManager.getSessionId();
    state = restoreState(ctx.sessionManager.getBranch());
    published = "";
    if (!state.title && state.mode !== "off") {
      // Preserve current unowned labels (including existing hand-labelled panes).
      try {
        const r = await pi.exec("hc", ["get", terminal!, "--json"], { timeout: 1500 });
        if (r.code === 0) {
          const labels = JSON.parse(r.stdout).labels || {};
          // Once a label is owned by a Pi session, branch state is authoritative.
          // Do not resurrect a future/abandoned branch's title from the terminal.
          if (!labels["pane.title.session"] && labels["pane.title"]) {
            state.title = cleanTitle(labels["pane.title"]);
          }
        }
      } catch { /* useful local fallback below; label failure is reported by publish */ }
      if (!state.title) {
        try { state.title = cleanTitle(ctx.sessionManager.getSessionName() || `${basename(ctx.cwd) || "Project"} · Pi`); }
        catch { state.title = "Pi task"; }
      }
    }
    try { await publish(ctx); } catch (e) { warn(ctx, e); }
  }
  pi.on("session_start", (_e, ctx) => serialized(() => initialize(ctx)));
  pi.on("session_tree", (_e, ctx) => serialized(() => initialize(ctx)));

  pi.on("before_agent_start", (event, ctx) => {
    if (!active(ctx)) return;
    const content = state.mode === "auto"
      ? `Herdr pane labels are automatic. Current task title: ${JSON.stringify(state.title)}. At the start of a new substantive task, or if this title no longer describes the work, proactively call set_pane_title with a concise project + task label. Do not ask the user to name it. Keep the existing label for acknowledgments, follow-ups and minor steps within the same task. This label is visible UI metadata: omit credentials, personal details, URLs and private quoted content. Use existing conversation context; do not make a separate model request, read other sessions or scan files just to choose a title.`
      : `Herdr pane title is ${state.mode === "manual" ? "manually pinned" : "disabled"}. Do not call set_pane_title to change it.`;
    if (event.systemPromptOptions?.sections) {
      event.systemPromptOptions.sections.herdr_pane_title = content;
      return;
    }
    // Compatibility with Pi runtimes predating structured prompt sections.
    return { message: { customType: "herdr-pane-title-context", display: false, content } };
  });

  pi.registerTool({
    name: "set_pane_title",
    label: "Set task label",
    description: "Maintain this Herdr pane's short semantic task label. Call proactively when a substantive new task starts or its focus changes. No effect on other panes, tabs or agent status. Manual pins are respected.",
    promptSnippet: "Automatically keep this pane labelled with the current project and task",
    promptGuidelines: ["Use set_pane_title proactively when starting a different substantive task, without waiting for the user to request a label. Keep it stable for minor follow-ups; never put secrets or personal details in a pane label."],
    parameters: Type.Object({ title: Type.String({ description: "Concise project + task, ideally 3–8 words; at most 64 characters" }) }),
    async execute(_id, args, _signal, _update, ctx) {
      return serialized(async () => {
        if (!active(ctx)) return { content: [{ type: "text" as const, text: "Pane labels are only active in interactive Herdr sessions." }], details: {} };
        if (state.mode !== "auto") return { content: [{ type: "text" as const, text: `Title unchanged: ${state.mode} mode.` }], details: {} };
        const next = cleanTitle(args.title);
        const old = state.title;
        state.title = next;
        try { await publish(ctx); } catch (e) { state.title = old; throw e; }
        if (next !== old) persist();
        return { content: [{ type: "text" as const, text: `Pane title: ${next}` }], details: {} };
      });
    },
  });

  pi.on("session_info_changed", (event, ctx) => serialized(async () => {
    if (!active(ctx) || state.mode !== "auto" || !event.name) return;
    const previous = state.title;
    try { state.title = cleanTitle(event.name); await publish(ctx); persist(); }
    catch (e) { state.title = previous; warn(ctx, e); }
  }));

  pi.registerCommand("pane-title", {
    description: "Pane label: /pane-title <title> pins it; auto resumes automatic labels; off freezes updates; status shows the mode",
    handler: async (args, ctx) => serialized(async () => {
      if (!active(ctx)) { ctx.ui.notify("Use pane-title in an interactive Herdr session.", "warning"); return; }
      const value = args.trim();
      if (!value || value === "status") { ctx.ui.notify(`${state.mode}: ${state.title || "(no title)"}`, "info"); return; }
      const previous = { ...state };
      try {
        if (value === "off") state.mode = "off";
        else if (value === "auto") state.mode = "auto";
        else state = { mode: "manual", title: cleanTitle(value) };
        await publish(ctx);
        persist();
        ctx.ui.notify(`Pane title ${state.mode}: ${state.title}`, "info");
      } catch (e) { state = previous; warn(ctx, e); }
    }),
  });
}
