// Offline regression tests. No real hc commands, network, credentials or model calls.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { createJiti } = await import('jiti');
const jiti = createJiti(import.meta.url, { alias: { typebox: require.resolve('typebox') }, moduleCache: false });
const mod = await jiti.import(path.join(here, 'index.ts'));
const ENTRY = 'herdr-pane-title-v1';

function harness({ env = true, mode = 'tui', entries = [], labels = {}, name, fail = false, sid = 'session-1' } = {}) {
  const oldId = process.env.HC_TERMINAL_ID, oldSocket = process.env.HC_TERMINAL_SOCKET;
  if (env) { process.env.HC_TERMINAL_ID = 't15'; process.env.HC_TERMINAL_SOCKET = '/tmp/fake.sock'; }
  else { delete process.env.HC_TERMINAL_ID; delete process.env.HC_TERMINAL_SOCKET; }
  const hooks = {}, commands = {}, tools = {}, calls = [], notices = [], saved = [...entries];
  const pi = {
    on(event, fn) { hooks[event] = fn; },
    registerTool(tool) { tools[tool.name] = tool; },
    registerCommand(key, command) { commands[key] = command; },
    appendEntry(customType, data) { saved.push({ type: 'custom', customType, data: { ...data } }); },
    async exec(cmd, args, opts) {
      calls.push({ cmd, args, opts });
      if (args[0] === 'get') return { code: 0, stdout: JSON.stringify({ labels }), stderr: '' };
      if (fail) return { code: 1, stdout: '', stderr: 'unavailable' };
      return { code: 0, stdout: '{}', stderr: '' };
    },
  };
  mod.default(pi);
  if (oldId === undefined) delete process.env.HC_TERMINAL_ID; else process.env.HC_TERMINAL_ID = oldId;
  if (oldSocket === undefined) delete process.env.HC_TERMINAL_SOCKET; else process.env.HC_TERMINAL_SOCKET = oldSocket;
  const ctx = {
    mode, cwd: '/projects/test-project',
    sessionManager: { getSessionId: () => sid, getBranch: () => saved, getSessionName: () => name },
    ui: { notify: (...x) => notices.push(x) },
  };
  const labelCalls = () => calls.filter(c => c.args[0] === 'label');
  return { hooks, commands, tools, calls, saved, ctx, notices, labelCalls,
    start: () => hooks.session_start?.({}, ctx),
    title: value => tools.set_pane_title.execute('test', { title: value }, undefined, undefined, ctx),
    command: value => commands['pane-title'].handler(value, ctx),
  };
}

test('removes ANSI, terminal controls and bidirectional formatting', () => {
  assert.equal(mod.cleanTitle('\x1b[31mProject\x1b[0m\n\u202e task'), 'Project task');
});
test('caps Unicode titles to 64 code points', () => {
  assert.equal(Array.from(mod.cleanTitle('🎉'.repeat(80))).length, 64);
});
test('rejects empty or risky UI metadata', () => {
  for (const text of ['', ' \n', 'email person@example.com', 'https://example.com', 'api_key=abc', 'Bearer abc']) {
    assert.throws(() => mod.cleanTitle(text));
  }
});
test('restores valid latest state on active branch only', () => {
  assert.deepEqual(mod.restoreState([
    { type: 'custom', customType: ENTRY, data: { mode: 'manual', title: 'Pinned' } },
    { type: 'custom', customType: ENTRY, data: { mode: 'invalid', title: 'Bad' } },
  ]), { mode: 'manual', title: 'Pinned' });
});
test('is a no-op outside Herdr', () => {
  const h = harness({ env: false }); assert.deepEqual(h.tools, {}); assert.deepEqual(h.hooks, {});
});
test('print-mode child cannot relabel its parent terminal', async () => {
  const h = harness({ mode: 'print' }); await h.start(); await h.title('Wrong child');
  assert.equal(h.calls.length, 0);
});
test('RPC child cannot relabel its parent terminal', async () => {
  const h = harness({ mode: 'rpc' }); await h.start(); await h.title('Wrong child');
  assert.equal(h.calls.length, 0);
});
test('startup supplies a folder-based fallback', async () => {
  const h = harness(); await h.start();
  assert(h.labelCalls()[0].args.includes('pane.title=test-project · Pi'));
});
test('startup uses named session when available', async () => {
  const h = harness({ name: 'Named task' }); await h.start();
  assert(h.labelCalls()[0].args.includes('pane.title=Named task'));
});
test('preserves pre-existing labels on initial rollout', async () => {
  const h = harness({ labels: { 'pane.title': 'Already useful' } }); await h.start();
  assert(h.labelCalls()[0].args.includes('pane.title=Already useful'));
});
test('a new session does not inherit another sessions owned label', async () => {
  const h = harness({ labels: { 'pane.title': 'Old unrelated task', 'pane.title.session': 'other-session' } });
  await h.start(); assert(h.labelCalls()[0].args.includes('pane.title=test-project · Pi'));
});
test('tree navigation before the first title entry does not resurrect a future branch title', async () => {
  const h = harness({ labels: { 'pane.title': 'Future branch task', 'pane.title.session': 'session-1' } });
  await h.hooks.session_tree({}, h.ctx);
  assert(h.labelCalls()[0].args.includes('pane.title=test-project · Pi'));
});
test('no background resources or hc processes are started during module registration', () => {
  const h = harness(); assert.equal(h.calls.length, 0); assert.equal(h.saved.length, 0);
});
test('proactively instructs the agent, without a separate inference request', async () => {
  const h = harness(); await h.start(); const event = { systemPromptOptions: { sections: {} } };
  assert.equal(h.hooks.before_agent_start(event, h.ctx), undefined);
  assert.match(event.systemPromptOptions.sections.herdr_pane_title, /proactively call set_pane_title/);
  assert.match(event.systemPromptOptions.sections.herdr_pane_title, /Do not ask the user/);
});
test('old runtimes receive hidden context rather than visible chatter', async () => {
  const h = harness(); await h.start(); const r = h.hooks.before_agent_start({}, h.ctx);
  assert.equal(r.message.display, false);
});
test('semantic title tool writes only own terminal labels, persists and deduplicates', async () => {
  const h = harness(); await h.start(); await h.title('Project · Login fix'); await h.title('Project · Login fix');
  assert.equal(h.labelCalls().length, 2);
  assert.equal(h.saved.length, 1);
  for (const c of h.labelCalls()) {
    assert.equal(c.cmd, 'hc'); assert.equal(c.args[1], 't15'); assert.equal(c.opts.timeout, 1500);
  }
});
test('shell-like title text remains a literal argument, never a shell command', async () => {
  const h = harness(); await h.start(); await h.title('Task $(touch /tmp/not-executed)');
  assert(h.labelCalls().at(-1).args.includes('pane.title=Task $(touch /tmp/not-executed)'));
});
test('manual pin blocks automatic tool changes and survives reload', async () => {
  const h = harness(); await h.start(); await h.command('Pinned task'); await h.title('Do not replace');
  assert.equal(h.labelCalls().length, 2);
  const resumed = harness({ entries: h.saved }); await resumed.start(); await resumed.title('Still blocked');
  assert.equal(resumed.labelCalls().length, 1);
  assert(resumed.labelCalls()[0].args.includes('pane.title=Pinned task'));
});
test('auto unpins and enables future semantic updates', async () => {
  const h = harness(); await h.start(); await h.command('Pinned'); await h.command('auto'); await h.title('New task');
  assert(h.labelCalls().at(-1).args.includes('pane.title=New task'));
});
test('off freezes updates, persists, and suppresses future writes', async () => {
  const h = harness(); await h.start(); await h.command('off'); await h.title('Ignored');
  assert.equal(h.labelCalls().length, 1);
  const resumed = harness({ entries: h.saved }); await resumed.start();
  assert.equal(resumed.calls.length, 0);
});
test('session rename synchronizes title unless manually pinned', async () => {
  const h = harness(); await h.start(); await h.hooks.session_info_changed({ name: 'Renamed' }, h.ctx);
  assert(h.labelCalls().at(-1).args.includes('pane.title=Renamed'));
  await h.command('Pinned'); const n = h.labelCalls().length;
  await h.hooks.session_info_changed({ name: 'Ignored' }, h.ctx); assert.equal(h.labelCalls().length, n);
});
test('unavailable hc never fails session startup; semantic writes surface errors', async () => {
  const h = harness({ fail: true }); await h.start(); assert.equal(h.notices.length, 1);
  await assert.rejects(() => h.title('New task'), /hc label failed/);
});
test('status command does not mutate labels or history', async () => {
  const h = harness(); await h.start(); await h.command('status');
  assert.equal(h.labelCalls().length, 1); assert.equal(h.saved.length, 0);
});
test('serialized tool calls cannot override a subsequent manual pin', async () => {
  const h = harness(); await h.start();
  await Promise.all([h.title('Automatic first'), h.command('Pinned second'), h.title('Ignored third')]);
  assert(h.labelCalls().at(-1).args.includes('pane.title=Pinned second'));
});
