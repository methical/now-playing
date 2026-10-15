# Now Playing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A GNOME Shell 50 extension that shows `Artist – Title` plus prev / play-pause / next buttons in the left panel box, only while an (optionally whitelisted) MPRIS player is playing.

**Architecture:** A pure-JS `Tracker` (recency ordering, pinning, whitelist, pause-hide timers; no `gi` imports, unit-tested under plain `gjs`) is fed by a thin Gio D-Bus adapter (`MprisSource`). `extension.js` renders tracker state into a `PanelMenu.Button` (inline buttons, scrolling/ellipsis label, popup with cover art, player list, settings link). `prefs.js` is a separate Adw process using GSettings.

**Tech Stack:** GJS (ES modules), Gio/GLib, St/Clutter (Shell), Adw/Gtk4 (prefs), Soup 3 (cover download), GSettings. GNOME Shell 50.5, gjs 1.88.

**Spec:** `docs/superpowers/specs/2026-10-15-now-playing-design.md`

## Global Constraints

- Extension UUID: `now-playing@chris`; GSettings schema id `org.gnome.shell.extensions.now-playing`, path `/org/gnome/shell/extensions/now-playing/`.
- `metadata.json` `shell-version` is `["50"]`; ES-module extension format only.
- Public APIs only (Gio, GLib, St, Clutter, Adw, Gtk, Soup); never import Shell's private `ui/mpris.js`.
- Indicator lives in the panel **left box**; hidden unless a qualifying player is playing (or recently paused per pause rules).
- Label is `Artist – Title` (en dash), `Title` alone when no artist, player `Identity` when no title.
- Overflow: `ellipsis` or `marquee`, bounded by `max-width` px (default 300).
- "Current player" = pinned (if showable) → most recently started playing → most recently started paused-but-showable.
- Pause behavior: `pause-hide-mode` `delay` (default; `pause-hide-delay` default 30 s, 0 = hide immediately) or `never`. `Stopped` / player quit always hides.
- Popup: cover art (hidden if unavailable), player list (click = pin/unpin), "Settings…" opening prefs on the whitelist page. No inline whitelist toggles.
- `disable()` must disconnect every signal, cancel every timer/cancellable and destroy every actor.
- No dependencies beyond the GNOME platform.

## Review Focus

Failure modes the spec implies but does not spell out; each has a pinning test in the owning task.

1. Pinned player quits or stops → must fall back to another player, not leave a stale indicator (Task 3).
2. Metadata with empty `xesam:artist` array, missing title, or non-string values → sensible label, no exception (Task 2).
3. Multi-instance bus names (`firefox.instance_1_23`, `chromium.instance4242`) and `DesktopEntry` aliases must match whitelist entries (Tasks 2, 3).
4. Player already paused when the extension starts → must not flash the indicator for the pause delay (Task 3).
5. Cover art URL unreachable / not an image / `file://` missing → popup still opens, cover hidden, no exception (Task 5).
6. Whitelist enabled with an empty list → nothing shown (intentional); prefs says so (Tasks 3, 8).

## File Structure

```
metadata.json                  extension manifest
extension.js                   enable/disable, NowPlayingIndicator (panel button + popup)
util.js                        pure helpers: playerId, parseMetadata, formatLabel, isAllowed
tracker.js                     pure Tracker (no gi imports)
names.js                       listMprisNames() (Gio only; shared by mpris.js + prefs.js)
mpris.js                       MprisSource: Gio adapter feeding Tracker, issues Previous/PlayPause/Next
cover.js                       resolveCover(artUrl) → local path | null
label.js                       ScrollingLabel (ellipsis / marquee)
prefs.js                       Adw preferences (general + whitelist pages)
schemas/org.gnome.shell.extensions.now-playing.gschema.xml
Makefile                       schemas / test / integration / pack
tests/harness.js               tiny async test harness
tests/fake-clock.js            fake now/timers for Tracker
tests/util.test.js  tests/tracker.test.js  tests/cover.test.js
tests/run.js                   runs all unit tests under gjs
tests/fake-player.js           standalone fake MPRIS player (integration + manual testing)
tests/integration.js           MprisSource ↔ fake player over a private session bus
```

---

### Task 1: Scaffold, schema, test harness

**Files:**
- Create: `metadata.json`, `schemas/org.gnome.shell.extensions.now-playing.gschema.xml`, `Makefile`, `.gitignore`, `tests/harness.js`, `tests/fake-clock.js`, `tests/run.js`
- Modify: `docs/superpowers/specs/2026-10-15-now-playing-design.md` (two small amendments, Step 5)

**Interfaces:**
- Produces: `test(name, fn)`, `assert(cond, msg)`, `assertEq(actual, expected, msg)`, `runAll(): Promise<number>` (failure count) from `tests/harness.js`; `FakeClock` with `hooks()`, `advance(ms)`, `pending` from `tests/fake-clock.js`; GSettings keys listed below.

- [ ] **Step 1: Init git and manifest**

```bash
cd /home/chris/development/now-playing && git init
```

`metadata.json`:
```json
{
  "uuid": "now-playing@chris",
  "name": "Now Playing",
  "description": "Shows the current song of any (or whitelisted) MPRIS player in the left panel, with prev / play-pause / next controls.",
  "shell-version": ["50"],
  "settings-schema": "org.gnome.shell.extensions.now-playing"
}
```

`.gitignore`:
```
schemas/gschemas.compiled
*.zip
```

- [ ] **Step 2: Schema**

`schemas/org.gnome.shell.extensions.now-playing.gschema.xml`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<schemalist>
  <schema id="org.gnome.shell.extensions.now-playing" path="/org/gnome/shell/extensions/now-playing/">
    <key name="whitelist-enabled" type="b"><default>false</default></key>
    <key name="whitelist" type="as"><default>[]</default></key>
    <key name="overflow-style" type="s">
      <choices><choice value="ellipsis"/><choice value="marquee"/></choices>
      <default>"ellipsis"</default>
    </key>
    <key name="max-width" type="i"><range min="100" max="1000"/><default>300</default></key>
    <key name="show-prev" type="b"><default>true</default></key>
    <key name="show-playpause" type="b"><default>true</default></key>
    <key name="show-next" type="b"><default>true</default></key>
    <key name="pause-hide-mode" type="s">
      <choices><choice value="delay"/><choice value="never"/></choices>
      <default>"delay"</default>
    </key>
    <key name="pause-hide-delay" type="i"><range min="0" max="600"/><default>30</default></key>
    <key name="open-page" type="s"><default>""</default></key>
  </schema>
</schemalist>
```

`Makefile` (tabs for recipe indentation):
```make
UUID = now-playing@chris

.PHONY: schemas test integration pack
schemas:
	glib-compile-schemas schemas/

test:
	gjs -m tests/run.js

integration:
	dbus-run-session -- gjs -m tests/integration.js

pack: schemas
	gnome-extensions pack --force --schema=schemas/org.gnome.shell.extensions.now-playing.gschema.xml \
	  --extra-source=util.js --extra-source=tracker.js --extra-source=names.js \
	  --extra-source=mpris.js --extra-source=cover.js --extra-source=label.js .
```

- [ ] **Step 3: Test harness**

`tests/harness.js`:
```js
const tests = [];

export function test(name, fn) {
    tests.push({name, fn});
}

export function assert(cond, msg = 'assertion failed') {
    if (!cond)
        throw new Error(msg);
}

export function assertEq(actual, expected, msg = '') {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        throw new Error(`${msg} expected ${e}, got ${a}`);
}

export async function runAll() {
    let failed = 0;
    for (const {name, fn} of tests) {
        try {
            await fn();
            print(`ok   ${name}`);
        } catch (e) {
            failed++;
            print(`FAIL ${name}\n     ${e.message}`);
        }
    }
    print(`${tests.length - failed}/${tests.length} passed`);
    return failed;
}
```

`tests/fake-clock.js`:
```js
export class FakeClock {
    constructor() {
        this.t = 0;
        this._timers = new Map();
        this._next = 1;
    }

    hooks() {
        return {
            now: () => this.t,
            setTimer: (ms, cb) => {
                const id = this._next++;
                this._timers.set(id, {at: this.t + ms, cb});
                return id;
            },
            clearTimer: id => this._timers.delete(id),
        };
    }

    get pending() {
        return this._timers.size;
    }

    advance(ms) {
        const end = this.t + ms;
        for (;;) {
            let nextId = null;
            let nextAt = Infinity;
            for (const [id, tm] of this._timers) {
                if (tm.at <= end && tm.at < nextAt) {
                    nextId = id;
                    nextAt = tm.at;
                }
            }
            if (nextId === null)
                break;
            const tm = this._timers.get(nextId);
            this._timers.delete(nextId);
            this.t = tm.at;
            tm.cb();
        }
        this.t = end;
    }
}
```

`tests/run.js` (the three test modules are created in later tasks; create them as empty files now so the runner works):
```js
import GLib from 'gi://GLib';
import System from 'system';
import './util.test.js';
import './tracker.test.js';
import './cover.test.js';
import {runAll} from './harness.js';

const loop = new GLib.MainLoop(null, false);
let failed = 0;
runAll().then(f => {
    failed = f;
    loop.quit();
}).catch(e => {
    print(e);
    failed = 1;
    loop.quit();
});
loop.run();
System.exit(failed ? 1 : 0);
```

```bash
touch tests/util.test.js tests/tracker.test.js tests/cover.test.js
```

- [ ] **Step 4: Verify tooling**

Run: `make schemas && make test`
Expected: schema compiles with no output; `0/0 passed`, exit code 0.

- [ ] **Step 5: Amend the spec**

In the spec's Preferences table add row `| open-page | s | "" |` (one-shot: the extension sets it to `whitelist` before opening prefs; prefs switches to that page and clears it). In its Modules list add `util.js` (pure helpers), `tracker.js` (pure tracker; `mpris.js` is only the Gio adapter) and `names.js`, `cover.js`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold extension, schema, test harness"
```

---

### Task 2: Pure helpers (`util.js`)

**Files:**
- Create: `util.js`
- Test: `tests/util.test.js`

**Interfaces:**
- Produces:
  - `MPRIS_PREFIX: string` = `'org.mpris.MediaPlayer2.'`
  - `playerId(busName: string): string` — strips prefix and `.instance…` suffix, lowercases.
  - `parseMetadata(md: object): {title: string, artist: string, artUrl: string}` — `md` is the recursively unpacked MPRIS Metadata dict.
  - `formatLabel({title, artist}, identity = ''): string`
  - `isAllowed({id, desktopEntry}, whitelist: string[]): boolean`

- [ ] **Step 1: Write the failing tests**

`tests/util.test.js`:
```js
import {test, assertEq} from './harness.js';
import {playerId, parseMetadata, formatLabel, isAllowed} from '../util.js';

test('playerId strips prefix and lowercases', () => {
    assertEq(playerId('org.mpris.MediaPlayer2.Spotify'), 'spotify');
    assertEq(playerId('org.mpris.MediaPlayer2.vlc'), 'vlc');
});

test('playerId strips multi-instance suffixes', () => {
    assertEq(playerId('org.mpris.MediaPlayer2.firefox.instance_1_23'), 'firefox');
    assertEq(playerId('org.mpris.MediaPlayer2.chromium.instance4242'), 'chromium');
});

test('parseMetadata joins artists', () => {
    assertEq(parseMetadata({
        'xesam:title': 'Karma Police',
        'xesam:artist': ['Radiohead', 'Thom Yorke'],
        'mpris:artUrl': 'file:///a.png',
    }), {title: 'Karma Police', artist: 'Radiohead, Thom Yorke', artUrl: 'file:///a.png'});
});

test('parseMetadata tolerates empty / missing / odd values', () => {
    assertEq(parseMetadata({'xesam:artist': []}), {title: '', artist: '', artUrl: ''});
    assertEq(parseMetadata(undefined), {title: '', artist: '', artUrl: ''});
    assertEq(parseMetadata({'xesam:artist': 'Solo', 'xesam:title': 5}),
        {title: '5', artist: 'Solo', artUrl: ''});
});

test('formatLabel variants', () => {
    assertEq(formatLabel({title: 'T', artist: 'A'}), 'A – T');
    assertEq(formatLabel({title: 'T', artist: ''}), 'T');
    assertEq(formatLabel({title: '', artist: 'A'}, 'Firefox'), 'Firefox');
    assertEq(formatLabel({title: '', artist: ''}, ''), '');
});

test('isAllowed matches id, desktop entry, case-insensitively', () => {
    assertEq(isAllowed({id: 'spotify', desktopEntry: ''}, ['spotify']), true);
    assertEq(isAllowed({id: 'plasma-browser-integration', desktopEntry: 'firefox'}, ['Firefox']), true);
    assertEq(isAllowed({id: 'vlc', desktopEntry: 'vlc'}, ['spotify']), false);
    assertEq(isAllowed({id: 'vlc', desktopEntry: 'vlc'}, []), false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `make test`
Expected: runner errors importing `../util.js` (module not found).

- [ ] **Step 3: Implement**

`util.js`:
```js
export const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';

export function playerId(busName) {
    let id = busName.startsWith(MPRIS_PREFIX) ? busName.slice(MPRIS_PREFIX.length) : busName;
    id = id.replace(/\.instance[_\d]+$/, '');
    return id.toLowerCase();
}

export function parseMetadata(md) {
    md = md ?? {};
    const rawArtist = md['xesam:artist'];
    let artist = '';
    if (Array.isArray(rawArtist))
        artist = rawArtist.filter(Boolean).join(', ');
    else if (typeof rawArtist === 'string')
        artist = rawArtist;
    return {
        title: String(md['xesam:title'] ?? ''),
        artist,
        artUrl: String(md['mpris:artUrl'] ?? ''),
    };
}

export function formatLabel({title, artist}, identity = '') {
    if (!title)
        return identity;
    return artist ? `${artist} – ${title}` : title;
}

export function isAllowed({id, desktopEntry}, whitelist) {
    const wanted = whitelist.map(w => w.toLowerCase());
    return wanted.includes(id.toLowerCase()) ||
        (desktopEntry !== '' && wanted.includes(desktopEntry.toLowerCase()));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `make test`
Expected: all `ok`, `6/6 passed`.

- [ ] **Step 5: Commit**

```bash
git add util.js tests/util.test.js && git commit -m "feat: pure helpers for ids, metadata, labels, whitelist"
```

---

### Task 3: Tracker (`tracker.js`)

**Files:**
- Create: `tracker.js`
- Test: `tests/tracker.test.js`

**Interfaces:**
- Consumes: `playerId`, `parseMetadata`, `isAllowed` from `util.js`; `FakeClock` from tests.
- Produces — `class Tracker`:
  - `constructor({now = () => Date.now(), setTimer = (ms, cb) => setTimeout(cb, ms), clearTimer = id => clearTimeout(id)} = {})`
  - `addPlayer(busName, info)` — `info`: `{identity?, desktopEntry?, status?, metadata?, canPrev?, canNext?, canControl?}`; a player first seen `Paused` counts as already expired.
  - `updatePlayer(busName, patch)` — same keys as `info`; unknown busName ignored.
  - `removePlayer(busName)`
  - `setSettings(partial)` — keys `whitelistEnabled: bool`, `whitelist: string[]`, `pauseHideMode: 'delay'|'never'`, `pauseHideDelay: number (seconds)`
  - `current(): Player|null`, `availablePlayers(): Player[]` (allowed, most recently started first), `pinnedBusName: string|null` (getter), `togglePin(busName)`, `unpin()`
  - `onChange(cb): () => void` (returns disconnect), `destroy()`
  - `Player`: `{busName, id, identity, desktopEntry, status: 'Playing'|'Paused'|'Stopped', title, artist, artUrl, canPrev, canNext, canControl, playSeq, pausedAt}`

- [ ] **Step 1: Write the failing tests**

`tests/tracker.test.js`:
```js
import {test, assert, assertEq} from './harness.js';
import {FakeClock} from './fake-clock.js';
import {Tracker} from '../tracker.js';

const SPOT = 'org.mpris.MediaPlayer2.spotify';
const FF = 'org.mpris.MediaPlayer2.firefox.instance_1_23';
const md = (title, artist) => ({'xesam:title': title, 'xesam:artist': artist ? [artist] : []});

function setup(settings = {}) {
    const clock = new FakeClock();
    const t = new Tracker(clock.hooks());
    t.setSettings(settings);
    return {clock, t};
}

function playing(t, bus, extra = {}) {
    t.addPlayer(bus, {
        identity: bus.split('.').pop(), desktopEntry: '', status: 'Playing',
        metadata: md('Song', 'Artist'), canPrev: true, canNext: true, canControl: true, ...extra,
    });
}

test('no players → current is null', () => {
    assertEq(setup().t.current(), null);
});

test('playing player is current with parsed metadata', () => {
    const {t} = setup();
    playing(t, SPOT, {metadata: md('Karma Police', 'Radiohead')});
    const c = t.current();
    assertEq([c.id, c.title, c.artist, c.status], ['spotify', 'Karma Police', 'Radiohead', 'Playing']);
});

test('most recently started wins; falls back when it pauses', () => {
    const {t, clock} = setup();
    playing(t, SPOT);
    clock.advance(1);
    playing(t, FF);
    assertEq(t.current().id, 'firefox');
    t.updatePlayer(FF, {status: 'Paused'});
    assertEq(t.current().id, 'spotify');
});

test('re-reporting Playing does not change recency', () => {
    const {t} = setup();
    playing(t, SPOT);
    playing(t, FF);
    t.updatePlayer(SPOT, {status: 'Playing', metadata: md('Other', 'X')});
    assertEq(t.current().id, 'firefox');
});

test('paused stays visible for the delay, then hides and emits change', () => {
    const {t, clock} = setup({pauseHideMode: 'delay', pauseHideDelay: 30});
    playing(t, SPOT);
    t.updatePlayer(SPOT, {status: 'Paused'});
    const seen = [];
    t.onChange(() => seen.push(t.current()?.id ?? null));
    clock.advance(29_999);
    assertEq(t.current()?.id, 'spotify');
    clock.advance(1);
    assertEq(t.current(), null);
    assertEq(seen[seen.length - 1], null);
});

test('delay 0 hides immediately on pause', () => {
    const {t} = setup({pauseHideMode: 'delay', pauseHideDelay: 0});
    playing(t, SPOT);
    t.updatePlayer(SPOT, {status: 'Paused'});
    assertEq(t.current(), null);
});

test('never mode keeps a paused track', () => {
    const {t, clock} = setup({pauseHideMode: 'never'});
    playing(t, SPOT);
    t.updatePlayer(SPOT, {status: 'Paused'});
    clock.advance(3_600_000);
    assertEq(t.current()?.id, 'spotify');
});

test('Stopped always hides', () => {
    const {t} = setup({pauseHideMode: 'never'});
    playing(t, SPOT);
    t.updatePlayer(SPOT, {status: 'Stopped'});
    assertEq(t.current(), null);
});

test('player already paused at startup does not flash in delay mode', () => {
    const {t} = setup({pauseHideMode: 'delay', pauseHideDelay: 30});
    t.addPlayer(SPOT, {status: 'Paused', metadata: md('Song', 'A')});
    assertEq(t.current(), null);
    const n = setup({pauseHideMode: 'never'});
    n.t.addPlayer(SPOT, {status: 'Paused', metadata: md('Song', 'A')});
    assertEq(n.t.current()?.id, 'spotify');
});

test('whitelist filters, matches instance ids and desktop entries', () => {
    const {t} = setup({whitelistEnabled: true, whitelist: ['spotify', 'firefox']});
    playing(t, 'org.mpris.MediaPlayer2.vlc');
    assertEq(t.current(), null);
    playing(t, 'org.mpris.MediaPlayer2.plasma-browser-integration', {desktopEntry: 'Firefox'});
    assertEq(t.current()?.id, 'plasma-browser-integration');
    assertEq(t.availablePlayers().map(p => p.id), ['plasma-browser-integration']);
});

test('whitelist enabled with empty list shows nothing', () => {
    const {t} = setup({whitelistEnabled: true, whitelist: []});
    playing(t, SPOT);
    assertEq(t.current(), null);
    t.setSettings({whitelistEnabled: false});
    assertEq(t.current()?.id, 'spotify');
});

test('pinning overrides recency; toggle unpins', () => {
    const {t} = setup();
    playing(t, SPOT);
    playing(t, FF);
    t.togglePin(SPOT);
    assertEq(t.current().id, 'spotify');
    assertEq(t.pinnedBusName, SPOT);
    t.togglePin(SPOT);
    assertEq(t.current().id, 'firefox');
    assertEq(t.pinnedBusName, null);
});

test('pinned player that quits or stops falls back', () => {
    const {t} = setup();
    playing(t, SPOT);
    playing(t, FF);
    t.togglePin(SPOT);
    t.updatePlayer(SPOT, {status: 'Stopped'});
    assertEq(t.current().id, 'firefox');
    t.updatePlayer(SPOT, {status: 'Playing'});
    assertEq(t.current().id, 'spotify');
    t.removePlayer(SPOT);
    assertEq(t.current().id, 'firefox');
    assertEq(t.pinnedBusName, null);
});

test('pinning an unknown player is ignored', () => {
    const {t} = setup();
    playing(t, SPOT);
    t.togglePin('org.mpris.MediaPlayer2.ghost');
    assertEq(t.pinnedBusName, null);
});

test('availablePlayers is ordered by recency', () => {
    const {t} = setup();
    playing(t, SPOT);
    playing(t, FF);
    assertEq(t.availablePlayers().map(p => p.id), ['firefox', 'spotify']);
});

test('destroy cancels pending timers and listeners', () => {
    const {t, clock} = setup({pauseHideMode: 'delay', pauseHideDelay: 30});
    let calls = 0;
    t.onChange(() => calls++);
    playing(t, SPOT);
    t.updatePlayer(SPOT, {status: 'Paused'});
    assert(clock.pending === 1, 'expected one pending timer');
    t.destroy();
    assertEq(clock.pending, 0);
    const before = calls;
    clock.advance(60_000);
    assertEq(calls, before);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `make test`
Expected: import error for `../tracker.js`.

- [ ] **Step 3: Implement**

`tracker.js`:
```js
import {playerId, parseMetadata, isAllowed} from './util.js';

const DEFAULTS = {
    whitelistEnabled: false,
    whitelist: [],
    pauseHideMode: 'delay',
    pauseHideDelay: 30,
};

export class Tracker {
    constructor({
        now = () => Date.now(),
        setTimer = (ms, cb) => setTimeout(cb, ms),
        clearTimer = id => clearTimeout(id),
    } = {}) {
        this._now = now;
        this._setTimer = setTimer;
        this._clearTimer = clearTimer;
        this._players = new Map();
        this._seq = 0;
        this._pinned = null;
        this._settings = {...DEFAULTS};
        this._listeners = new Set();
        this._timer = null;
    }

    get pinnedBusName() {
        return this._pinned;
    }

    onChange(cb) {
        this._listeners.add(cb);
        return () => this._listeners.delete(cb);
    }

    setSettings(partial) {
        Object.assign(this._settings, partial);
        this._changed();
    }

    addPlayer(busName, info = {}) {
        const p = {
            busName, id: playerId(busName), identity: '', desktopEntry: '',
            status: 'Stopped', title: '', artist: '', artUrl: '',
            canPrev: false, canNext: false, canControl: false,
            playSeq: 0, pausedAt: 0,
        };
        this._players.set(busName, p);
        this._apply(p, info, true);
        this._changed();
    }

    updatePlayer(busName, patch) {
        const p = this._players.get(busName);
        if (!p)
            return;
        this._apply(p, patch, false);
        this._changed();
    }

    removePlayer(busName) {
        this._players.delete(busName);
        if (this._pinned === busName)
            this._pinned = null;
        this._changed();
    }

    togglePin(busName) {
        if (this._pinned === busName)
            this._pinned = null;
        else if (this._players.has(busName))
            this._pinned = busName;
        else
            return;
        this._changed();
    }

    unpin() {
        this._pinned = null;
        this._changed();
    }

    current() {
        const pinned = this._pinned ? this._players.get(this._pinned) : null;
        if (pinned && this._showable(pinned))
            return pinned;
        let best = null;
        let bestRank = -1;
        for (const p of this._players.values()) {
            if (!this._showable(p))
                continue;
            const rank = (p.status === 'Playing' ? 1e9 : 0) + p.playSeq;
            if (rank > bestRank) {
                best = p;
                bestRank = rank;
            }
        }
        return best;
    }

    availablePlayers() {
        return [...this._players.values()]
            .filter(p => this._allowed(p))
            .sort((a, b) => b.playSeq - a.playSeq);
    }

    destroy() {
        this._cancelTimer();
        this._listeners.clear();
    }

    _apply(p, patch, initial) {
        if (patch.identity !== undefined)
            p.identity = patch.identity;
        if (patch.desktopEntry !== undefined)
            p.desktopEntry = patch.desktopEntry.toLowerCase();
        if (patch.metadata !== undefined)
            Object.assign(p, parseMetadata(patch.metadata));
        for (const k of ['canPrev', 'canNext', 'canControl']) {
            if (patch[k] !== undefined)
                p[k] = patch[k];
        }
        if (patch.status !== undefined && patch.status !== p.status) {
            p.status = patch.status;
            if (p.status === 'Playing')
                p.playSeq = ++this._seq;
            else if (p.status === 'Paused')
                p.pausedAt = initial ? -Infinity : this._now();
        }
    }

    _allowed(p) {
        return !this._settings.whitelistEnabled || isAllowed(p, this._settings.whitelist);
    }

    _showable(p) {
        if (!this._allowed(p))
            return false;
        if (p.status === 'Playing')
            return true;
        if (p.status !== 'Paused')
            return false;
        if (this._settings.pauseHideMode === 'never')
            return true;
        return this._now() - p.pausedAt < this._settings.pauseHideDelay * 1000;
    }

    _cancelTimer() {
        if (this._timer !== null) {
            this._clearTimer(this._timer);
            this._timer = null;
        }
    }

    _reschedule() {
        this._cancelTimer();
        if (this._settings.pauseHideMode !== 'delay')
            return;
        const now = this._now();
        let next = Infinity;
        for (const p of this._players.values()) {
            if (p.status !== 'Paused' || !this._allowed(p))
                continue;
            const left = p.pausedAt + this._settings.pauseHideDelay * 1000 - now;
            if (left > 0)
                next = Math.min(next, left);
        }
        if (next === Infinity)
            return;
        this._timer = this._setTimer(next, () => {
            this._timer = null;
            this._changed();
        });
    }

    _changed() {
        this._reschedule();
        for (const cb of [...this._listeners])
            cb();
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `make test`
Expected: all util + tracker tests `ok`. (`cover.test.js` is still empty.)

- [ ] **Step 5: Commit**

```bash
git add tracker.js tests/tracker.test.js && git commit -m "feat: player tracker with recency, pinning, whitelist, pause timers"
```

---

### Task 4: D-Bus adapter (`names.js`, `mpris.js`) + fake player + integration test

**Files:**
- Create: `names.js`, `mpris.js`, `tests/fake-player.js`, `tests/integration.js`

**Interfaces:**
- Consumes: `Tracker` (`addPlayer`, `updatePlayer`, `removePlayer`), `MPRIS_PREFIX`.
- Produces:
  - `listMprisNames(cancellable = null): Promise<string[]>` — full bus names.
  - `class MprisSource`: `constructor(tracker)`, `start(): Promise<void>`, `stop()`, `call(busName, method: 'Previous'|'PlayPause'|'Next'): Promise<void>` (errors swallowed + logged at debug).
  - `tests/fake-player.js` env vars: `FAKE_NAME` (default `fake`), `FAKE_TITLE` (`Karma Police`), `FAKE_ARTIST` (`Radiohead`), `FAKE_ART` (`''`), `FAKE_STATUS` (`Playing`). `PlayPause` toggles Playing/Paused; `Next`/`Previous` change the title to `<base> #<n>`.

- [ ] **Step 1: `names.js`**

```js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {MPRIS_PREFIX} from './util.js';

Gio._promisify(Gio.DBusConnection.prototype, 'call', 'call_finish');

export async function listMprisNames(cancellable = null) {
    const reply = await Gio.DBus.session.call(
        'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
        'ListNames', null, new GLib.VariantType('(as)'),
        Gio.DBusCallFlags.NONE, -1, cancellable);
    const [names] = reply.deepUnpack();
    return names.filter(n => n.startsWith(MPRIS_PREFIX));
}
```

- [ ] **Step 2: Fake player**

`tests/fake-player.js`:
```js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const env = (k, d) => GLib.getenv(k) ?? d;
const NAME = `org.mpris.MediaPlayer2.${env('FAKE_NAME', 'fake')}`;
const BASE_TITLE = env('FAKE_TITLE', 'Karma Police');
const ARTIST = env('FAKE_ARTIST', 'Radiohead');
const ART = env('FAKE_ART', '');

const ROOT_XML = `<node><interface name="org.mpris.MediaPlayer2">
  <property name="Identity" type="s" access="read"/>
  <property name="DesktopEntry" type="s" access="read"/>
</interface></node>`;

const PLAYER_XML = `<node><interface name="org.mpris.MediaPlayer2.Player">
  <method name="PlayPause"/><method name="Next"/><method name="Previous"/>
  <property name="PlaybackStatus" type="s" access="read"/>
  <property name="Metadata" type="a{sv}" access="read"/>
  <property name="CanGoNext" type="b" access="read"/>
  <property name="CanGoPrevious" type="b" access="read"/>
  <property name="CanControl" type="b" access="read"/>
</interface></node>`;

class Root {
    get Identity() { return `Fake ${env('FAKE_NAME', 'fake')}`; }
    get DesktopEntry() { return ''; }
}

class Player {
    constructor() {
        this._status = env('FAKE_STATUS', 'Playing');
        this._n = 1;
    }

    get PlaybackStatus() { return this._status; }
    get CanGoNext() { return true; }
    get CanGoPrevious() { return true; }
    get CanControl() { return true; }

    get Metadata() {
        const md = {
            'xesam:title': new GLib.Variant('s', this._n === 1 ? BASE_TITLE : `${BASE_TITLE} #${this._n}`),
            'xesam:artist': new GLib.Variant('as', [ARTIST]),
        };
        if (ART)
            md['mpris:artUrl'] = new GLib.Variant('s', ART);
        return new GLib.Variant('a{sv}', md);
    }

    PlayPause() {
        this._status = this._status === 'Playing' ? 'Paused' : 'Playing';
        this._exported.emit_property_changed('PlaybackStatus', new GLib.Variant('s', this._status));
    }

    Next() { this._skip(1); }
    Previous() { this._skip(-1); }

    _skip(d) {
        this._n = Math.max(1, this._n + d);
        this._exported.emit_property_changed('Metadata', this.Metadata);
    }
}

const loop = new GLib.MainLoop(null, false);
Gio.bus_own_name(Gio.BusType.SESSION, NAME, Gio.BusNameOwnerFlags.NONE,
    connection => {
        const root = Gio.DBusExportedObject.wrapJSObject(ROOT_XML, new Root());
        root.export(connection, '/org/mpris/MediaPlayer2');
        const player = new Player();
        player._exported = Gio.DBusExportedObject.wrapJSObject(PLAYER_XML, player);
        player._exported.export(connection, '/org/mpris/MediaPlayer2');
    }, null, () => loop.quit());
loop.run();
```

Note: if `Metadata` returning a `GLib.Variant` is rejected by `wrapJSObject` at runtime, return the plain object `md` instead (values are already variants, so GJS converts it for `a{sv}`).

- [ ] **Step 3: `mpris.js`**

```js
import Gio from 'gi://Gio';
import {MPRIS_PREFIX} from './util.js';
import {listMprisNames} from './names.js';

Gio._promisify(Gio.DBusProxy, 'new_for_bus', 'new_for_bus_finish');
Gio._promisify(Gio.DBusProxy.prototype, 'call', 'call_finish');

const PATH = '/org/mpris/MediaPlayer2';

function readPlayer(proxy) {
    const get = k => proxy.get_cached_property(k)?.recursiveUnpack();
    return {
        status: get('PlaybackStatus') ?? 'Stopped',
        metadata: get('Metadata') ?? {},
        canPrev: get('CanGoPrevious') ?? false,
        canNext: get('CanGoNext') ?? false,
        canControl: get('CanControl') ?? false,
    };
}

function readRoot(proxy) {
    const get = k => proxy.get_cached_property(k)?.unpack();
    return {identity: get('Identity') ?? '', desktopEntry: get('DesktopEntry') ?? ''};
}

export class MprisSource {
    constructor(tracker) {
        this._tracker = tracker;
        this._entries = new Map();
        this._cancellable = new Gio.Cancellable();
        this._subId = 0;
    }

    async start() {
        this._subId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged',
            '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
            (_c, _s, _p, _i, _sig, params) => {
                const [name, oldOwner, newOwner] = params.deepUnpack();
                if (!name.startsWith(MPRIS_PREFIX))
                    return;
                if (oldOwner)
                    this._drop(name);
                if (newOwner)
                    this._watch(name);
            });
        for (const name of await listMprisNames(this._cancellable))
            this._watch(name);
    }

    stop() {
        this._cancellable.cancel();
        if (this._subId) {
            Gio.DBus.session.signal_unsubscribe(this._subId);
            this._subId = 0;
        }
        for (const name of [...this._entries.keys()])
            this._drop(name, false);
    }

    async call(busName, method) {
        const proxy = this._entries.get(busName)?.player;
        if (!proxy)
            return;
        try {
            await proxy.call(method, null, Gio.DBusCallFlags.NONE, -1, this._cancellable);
        } catch (e) {
            console.debug(`now-playing: ${method} on ${busName} failed: ${e.message}`);
        }
    }

    async _watch(name) {
        if (this._entries.has(name))
            return;
        const entry = {root: null, player: null, handlerId: 0};
        this._entries.set(name, entry);
        try {
            const make = iface => Gio.DBusProxy.new_for_bus(
                Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null,
                name, PATH, iface, this._cancellable);
            [entry.root, entry.player] = await Promise.all([
                make('org.mpris.MediaPlayer2'),
                make('org.mpris.MediaPlayer2.Player'),
            ]);
        } catch (e) {
            if (this._entries.get(name) === entry)
                this._entries.delete(name);
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.debug(`now-playing: cannot watch ${name}: ${e.message}`);
            return;
        }
        if (this._entries.get(name) !== entry)
            return; // dropped while connecting
        entry.handlerId = entry.player.connect('g-properties-changed', () =>
            this._tracker.updatePlayer(name, readPlayer(entry.player)));
        this._tracker.addPlayer(name, {...readRoot(entry.root), ...readPlayer(entry.player)});
    }

    _drop(name, notify = true) {
        const entry = this._entries.get(name);
        if (!entry)
            return;
        this._entries.delete(name);
        if (entry.handlerId)
            entry.player.disconnect(entry.handlerId);
        if (notify)
            this._tracker.removePlayer(name);
    }
}
```

- [ ] **Step 4: Integration test**

`tests/integration.js`:
```js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import {Tracker} from '../tracker.js';
import {MprisSource} from '../mpris.js';

const fakePath = GLib.filename_from_uri(new URL('./fake-player.js', import.meta.url).href)[0];

function waitFor(pred, what, ms = 5000) {
    const deadline = GLib.get_monotonic_time() + ms * 1000;
    return new Promise((resolve, reject) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            if (pred()) {
                resolve();
                return GLib.SOURCE_REMOVE;
            }
            if (GLib.get_monotonic_time() > deadline) {
                reject(new Error(`timeout waiting for: ${what}`));
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    });
}

async function main() {
    const tracker = new Tracker();
    const source = new MprisSource(tracker);
    await source.start();

    const proc = Gio.Subprocess.new(['gjs', '-m', fakePath], Gio.SubprocessFlags.NONE);
    try {
        await waitFor(() => tracker.current()?.title === 'Karma Police', 'player discovered');
        const cur = tracker.current();
        if (cur.artist !== 'Radiohead' || cur.status !== 'Playing' || !cur.canNext)
            throw new Error(`bad initial state: ${JSON.stringify(cur)}`);

        await source.call(cur.busName, 'PlayPause');
        await waitFor(() => tracker.current()?.status === 'Paused', 'PlayPause → Paused');

        await source.call(cur.busName, 'Next');
        await waitFor(() => tracker.current()?.title === 'Karma Police #2', 'Next → new title');
        await source.call(cur.busName, 'Previous');
        await waitFor(() => tracker.current()?.title === 'Karma Police', 'Previous → old title');

        proc.force_exit();
        await waitFor(() => tracker.current() === null && tracker.availablePlayers().length === 0,
            'player removal');
    } finally {
        proc.force_exit();
        source.stop();
        tracker.destroy();
    }
}

const loop = new GLib.MainLoop(null, false);
let code = 0;
main().then(() => print('integration: ok')).catch(e => {
    print(`integration: FAIL ${e.message}`);
    code = 1;
}).finally(() => loop.quit());
loop.run();
System.exit(code);
```

- [ ] **Step 5: Run it**

Run: `make integration`
Expected: `integration: ok`. If the fake player's exported properties misbehave, apply the fallback noted under Step 2 and re-run.

- [ ] **Step 6: Commit**

```bash
git add names.js mpris.js tests/fake-player.js tests/integration.js && git commit -m "feat: Gio MPRIS adapter with fake-player integration test"
```

---

### Task 5: Cover art resolver (`cover.js`)

**Files:**
- Create: `cover.js`
- Test: `tests/cover.test.js`

**Interfaces:**
- Produces: `resolveCover(artUrl: string, cancellable = null): Promise<string|null>` — local file path or `null`; never throws. `https?://` results are cached in `$XDG_CACHE_HOME/now-playing/<sha1(url)>`.

- [ ] **Step 1: Write the failing tests**

`tests/cover.test.js`:
```js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {test, assertEq} from './harness.js';
import {resolveCover} from '../cover.js';

test('empty and unsupported urls → null', async () => {
    assertEq(await resolveCover(''), null);
    assertEq(await resolveCover('data:image/png;base64,AAAA'), null);
    assertEq(await resolveCover('ftp://example.invalid/a.png'), null);
});

test('missing file:// → null', async () => {
    assertEq(await resolveCover('file:///definitely/not/here.png'), null);
});

test('existing file:// → its path', async () => {
    const [path] = GLib.file_open_tmp('cover-XXXXXX.png');
    assertEq(await resolveCover(Gio.File.new_for_path(path).get_uri()), path);
});

test('unreachable http(s) → null, no throw', async () => {
    assertEq(await resolveCover('http://127.0.0.1:1/cover.jpg'), null);
    assertEq(await resolveCover('http://'), null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `make test`
Expected: import error for `../cover.js`.

- [ ] **Step 3: Implement**

`cover.js`:
```js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');

export async function resolveCover(artUrl, cancellable = null) {
    if (!artUrl)
        return null;

    if (artUrl.startsWith('file://')) {
        const file = Gio.File.new_for_uri(artUrl);
        return file.query_exists(null) ? file.get_path() : null;
    }
    if (!/^https?:\/\//.test(artUrl))
        return null;

    const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'now-playing']);
    const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, artUrl, -1);
    const path = GLib.build_filenamev([dir, hash]);
    const file = Gio.File.new_for_path(path);
    if (file.query_exists(null))
        return path;

    const session = new Soup.Session({timeout: 10});
    try {
        GLib.mkdir_with_parents(dir, 0o755);
        const msg = Soup.Message.new('GET', artUrl);
        const bytes = await session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, cancellable);
        if (msg.get_status() !== Soup.Status.OK)
            return null;
        await file.replace_contents_bytes_async(
            bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, cancellable);
        return path;
    } catch (e) {
        console.debug(`now-playing: cover fetch failed for ${artUrl}: ${e.message}`);
        return null;
    } finally {
        session.abort();
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `make test`
Expected: all tests `ok`.

- [ ] **Step 5: Commit**

```bash
git add cover.js tests/cover.test.js && git commit -m "feat: cover art resolver with cache and safe failure"
```

---

### Task 6: Scrolling label (`label.js`)

**Files:**
- Create: `label.js`

(Shell-only widget: it cannot run under plain `gjs`; it is verified visually in Task 9 and exercised by Task 7.)

**Interfaces:**
- Produces: `class ScrollingLabel` with `actor: Clutter.Actor` (add this to containers), `setText(text: string)`, `setStyle({overflow: 'ellipsis'|'marquee', maxWidth: number})`, `setPaused(paused: boolean)` (marquee stops while paused), `destroy()`.

- [ ] **Step 1: Implement**

`label.js`:
```js
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

const PAUSE_MS = 1500;
const PX_PER_SECOND = 40;

export class ScrollingLabel {
    constructor() {
        this.actor = new Clutter.Actor({
            clip_to_allocation: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        this.actor.add_child(this._label);

        this._text = '';
        this._overflow = 'ellipsis';
        this._maxWidth = 300;
        this._paused = false;
        this._timeoutId = 0;
        this._generation = 0;
        this._mappedId = this.actor.connect('notify::mapped', () => this._relayout());
    }

    setText(text) {
        if (text === this._text)
            return;
        this._text = text;
        this._label.text = text;
        this._relayout();
    }

    setStyle({overflow, maxWidth}) {
        this._overflow = overflow;
        this._maxWidth = maxWidth;
        this._relayout();
    }

    setPaused(paused) {
        if (paused === this._paused)
            return;
        this._paused = paused;
        this._relayout();
    }

    destroy() {
        this._stopMarquee();
        this.actor.disconnect(this._mappedId);
        this.actor.destroy();
    }

    _relayout() {
        this._stopMarquee();
        const text = this._label.clutter_text;
        const [, naturalW] = this._label.get_preferred_width(-1);
        const [, naturalH] = this._label.get_preferred_height(naturalW);
        const width = Math.min(naturalW, this._maxWidth);
        this.actor.set_size(width, naturalH);
        this._label.translation_x = 0;

        if (naturalW <= this._maxWidth) {
            text.ellipsize = Pango.EllipsizeMode.NONE;
            this._label.set_width(naturalW);
        } else if (this._overflow === 'marquee') {
            text.ellipsize = Pango.EllipsizeMode.NONE;
            this._label.set_width(naturalW);
            if (!this._paused)
                this._cycle(naturalW - width);
        } else {
            text.ellipsize = Pango.EllipsizeMode.END;
            this._label.set_width(width);
        }
    }

    _later(callback) {
        const generation = this._generation;
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PAUSE_MS, () => {
            this._timeoutId = 0;
            if (generation === this._generation)
                callback();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cycle(distance) {
        const generation = this._generation;
        this._later(() => {
            this._label.ease({
                translation_x: -distance,
                duration: Math.round(distance / PX_PER_SECOND * 1000),
                mode: Clutter.AnimationMode.LINEAR,
                onComplete: () => {
                    if (generation !== this._generation)
                        return;
                    this._later(() => {
                        this._label.translation_x = 0;
                        this._cycle(distance);
                    });
                },
            });
        });
    }

    _stopMarquee() {
        this._generation++;
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._label.remove_all_transitions();
    }
}
```

- [ ] **Step 2: Commit** (the widget is first loaded and checked in Task 7)

```bash
git add label.js && git commit -m "feat: ellipsis/marquee label widget"
```

---

### Task 7: Panel indicator and popup (`extension.js`)

**Files:**
- Create: `extension.js`

**Interfaces:**
- Consumes: `Tracker` (all public methods), `MprisSource.start/stop/call`, `ScrollingLabel`, `resolveCover`, `formatLabel`; GSettings keys from Task 1.
- Produces: default-export `NowPlayingExtension` (`enable()`, `disable()`); internal `NowPlayingIndicator` (`applySettings(settings)`).

- [ ] **Step 1: Implement**

`extension.js`:
```js
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Tracker} from './tracker.js';
import {MprisSource} from './mpris.js';
import {ScrollingLabel} from './label.js';
import {resolveCover} from './cover.js';
import {formatLabel} from './util.js';

const COVER_SIZE = 220;

const NowPlayingIndicator = GObject.registerClass(
class NowPlayingIndicator extends PanelMenu.Button {
    _init({tracker, source, openPrefs}) {
        super._init(0.5, 'Now Playing', false);
        this._tracker = tracker;
        this._source = source;
        this._openPrefs = openPrefs;
        this._cancellable = new Gio.Cancellable();
        this._coverToken = 0;
        this._artUrl = null;

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._prev = this._makeButton('media-skip-backward-symbolic', 'Previous', c => c.canPrev);
        this._play = this._makeButton('media-playback-start-symbolic', 'PlayPause', c => c.canControl);
        this._next = this._makeButton('media-skip-forward-symbolic', 'Next', c => c.canNext);
        this._label = new ScrollingLabel();
        for (const b of [this._prev, this._play, this._next])
            box.add_child(b.button);
        box.add_child(this._label.actor);
        this.add_child(box);

        this._buildMenu();
        this._unsubscribe = tracker.onChange(() => this._update());
        this.connect('destroy', () => this._onDestroy());
        this._update();
    }

    applySettings(settings) {
        this._prev.button.visible = settings.get_boolean('show-prev');
        this._play.button.visible = settings.get_boolean('show-playpause');
        this._next.button.visible = settings.get_boolean('show-next');
        this._label.setStyle({
            overflow: settings.get_string('overflow-style'),
            maxWidth: settings.get_int('max-width'),
        });
    }

    _makeButton(iconName, method, isEnabled) {
        const icon = new St.Icon({icon_name: iconName, style_class: 'system-status-icon'});
        const button = new St.Button({
            child: icon, reactive: true, can_focus: true, track_hover: true,
            style: 'padding: 0 4px;',
        });
        button.connect('clicked', () => {
            const cur = this._tracker.current();
            if (cur)
                this._source.call(cur.busName, method);
        });
        return {button, icon, isEnabled};
    }

    _buildMenu() {
        this._coverItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this._coverBin = new St.Bin({x_expand: true, x_align: Clutter.ActorAlign.CENTER});
        this._coverItem.add_child(this._coverBin);
        this._coverItem.visible = false;
        this.menu.addMenuItem(this._coverItem);

        this._playerSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._playerSection);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction('Settings…', () => this._openPrefs());

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._refreshPlayers();
        });
    }

    _refreshPlayers() {
        this._playerSection.removeAll();
        const cur = this._tracker.current();
        for (const p of this._tracker.availablePlayers()) {
            const pinned = this._tracker.pinnedBusName === p.busName;
            const item = new PopupMenu.PopupMenuItem(`${p.identity || p.id}${pinned ? ' (pinned)' : ''}`);
            item.setOrnament(cur?.busName === p.busName
                ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
            item.connect('activate', () => this._tracker.togglePin(p.busName));
            this._playerSection.addMenuItem(item);
        }
    }

    async _loadCover(artUrl) {
        const token = ++this._coverToken;
        this._coverItem.visible = false;
        if (!artUrl)
            return;
        const path = await resolveCover(artUrl, this._cancellable);
        if (token !== this._coverToken || !path)
            return;
        const uri = GLib.filename_to_uri(path, null);
        this._coverBin.set_style(
            `background-image: url("${uri}"); background-size: cover; ` +
            `width: ${COVER_SIZE}px; height: ${COVER_SIZE}px; border-radius: 12px;`);
        this._coverItem.visible = true;
    }

    _update() {
        const cur = this._tracker.current();
        this.visible = cur !== null;
        if (!cur) {
            this.menu.close();
            this._label.setText('');
            this._artUrl = null;
            this._coverToken++;
            return;
        }

        this._label.setText(formatLabel(cur, cur.identity));
        this._label.setPaused(cur.status !== 'Playing');
        this._play.icon.icon_name = cur.status === 'Playing'
            ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        for (const b of [this._prev, this._play, this._next]) {
            const enabled = b.isEnabled(cur);
            b.button.reactive = enabled;
            b.button.opacity = enabled ? 255 : 90;
        }
        if (cur.artUrl !== this._artUrl) {
            this._artUrl = cur.artUrl;
            this._loadCover(cur.artUrl).catch(e => console.debug(`now-playing: ${e.message}`));
        }
        if (this.menu.isOpen)
            this._refreshPlayers();
    }

    _onDestroy() {
        this._unsubscribe();
        this._cancellable.cancel();
        this._coverToken++;
        this._label.destroy();
    }
});

export default class NowPlayingExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._tracker = new Tracker();
        this._source = new MprisSource(this._tracker);
        this._indicator = new NowPlayingIndicator({
            tracker: this._tracker,
            source: this._source,
            openPrefs: () => {
                this._settings.set_string('open-page', 'whitelist');
                this.openPreferences();
            },
        });
        this._applySettings();
        this._settingsId = this._settings.connect('changed', () => this._applySettings());

        Main.panel.addToStatusArea(this.uuid, this._indicator,
            Main.panel._leftBox.get_n_children(), 'left');
        this._source.start().catch(e => console.error(`now-playing: ${e.message}`));
    }

    disable() {
        this._settings?.disconnect(this._settingsId);
        this._source?.stop();
        this._indicator?.destroy();
        this._tracker?.destroy();
        this._indicator = null;
        this._source = null;
        this._tracker = null;
        this._settings = null;
    }

    _applySettings() {
        const s = this._settings;
        this._tracker.setSettings({
            whitelistEnabled: s.get_boolean('whitelist-enabled'),
            whitelist: s.get_strv('whitelist'),
            pauseHideMode: s.get_string('pause-hide-mode'),
            pauseHideDelay: s.get_int('pause-hide-delay'),
        });
        this._indicator.applySettings(s);
    }
}
```

- [ ] **Step 2: Install for development**

```bash
make schemas
ln -s /home/chris/development/now-playing ~/.local/share/gnome-shell/extensions/now-playing@chris
gnome-extensions list | grep now-playing
```
Expected: `now-playing@chris` listed.

- [ ] **Step 3: Load in a nested shell and check the log**

```bash
rpm -q mutter-devkit || sudo dnf install -y mutter-devkit
dbus-run-session -- bash -c '
  gnome-extensions enable now-playing@chris
  gjs -m tests/fake-player.js &
  FAKE_NAME=two FAKE_TITLE="A very long title that should overflow the configured width" FAKE_ARTIST="Long Artist" gjs -m tests/fake-player.js &
  gnome-shell --devkit 2>&1 | grep -iE "now-playing|error|exception"'
```
Expected: the nested shell opens with `⏮ ⏯ ⏭ <label>` at the right of the Activities button; no `now-playing` errors/exceptions in output. (On Wayland a normal session cannot reload extensions; use the devkit session for every iteration.)

- [ ] **Step 4: Manual checks (in the nested shell)**

- Label reads `Artist – Title`; the most recently launched player wins.
- ⏯ pauses the shown player (icon flips to play); after 30 s the indicator disappears; resuming from the app brings it back.
- ⏭/⏮ change the title (`#2`, `#1`).
- Clicking the label opens the popup: player list with the current one dotted; clicking another pins it (label switches, "(pinned)" shown); clicking again unpins; "Settings…" opens prefs (Task 8).
- Popup cover art: relaunch a fake player with `FAKE_ART=file:///usr/share/backgrounds/default.png` (any image) → cover shows; with a bogus URL → popup opens without cover.
- `gnome-extensions disable now-playing@chris` removes the indicator; re-enable works; `journalctl --user -b | grep -i now-playing` shows no leaked-actor warnings.

- [ ] **Step 5: Commit**

```bash
git add extension.js && git commit -m "feat: panel indicator with controls, label and popup"
```

---

### Task 8: Preferences (`prefs.js`)

**Files:**
- Create: `prefs.js`

**Interfaces:**
- Consumes: `listMprisNames` (`names.js`), `playerId` (`util.js`); GSettings keys from Task 1 including `open-page`.
- Produces: default-export `NowPlayingPrefs extends ExtensionPreferences`.

- [ ] **Step 1: Implement**

`prefs.js`:
```js
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {listMprisNames} from './names.js';
import {playerId} from './util.js';

function comboRow(settings, key, title, options) {
    const row = new Adw.ComboRow({
        title,
        model: Gtk.StringList.new(options.map(o => o[1])),
    });
    const sync = () => {
        const i = options.findIndex(o => o[0] === settings.get_string(key));
        row.selected = Math.max(i, 0);
    };
    sync();
    row.connect('notify::selected', () => settings.set_string(key, options[row.selected][0]));
    settings.connect(`changed::${key}`, sync);
    return row;
}

function spinRow(settings, key, title, lower, upper, step, subtitle = '') {
    const row = new Adw.SpinRow({
        title, subtitle,
        adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, value: lower}),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function switchRow(settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function generalPage(settings) {
    const page = new Adw.PreferencesPage({name: 'general', title: 'General', icon_name: 'preferences-system-symbolic'});

    const label = new Adw.PreferencesGroup({title: 'Label'});
    label.add(comboRow(settings, 'overflow-style', 'Long text', [
        ['ellipsis', 'Truncate with …'], ['marquee', 'Scroll (marquee)'],
    ]));
    label.add(spinRow(settings, 'max-width', 'Maximum width', 100, 1000, 10, 'In pixels'));
    page.add(label);

    const buttons = new Adw.PreferencesGroup({title: 'Buttons'});
    buttons.add(switchRow(settings, 'show-prev', 'Previous'));
    buttons.add(switchRow(settings, 'show-playpause', 'Play / pause'));
    buttons.add(switchRow(settings, 'show-next', 'Next'));
    page.add(buttons);

    const paused = new Adw.PreferencesGroup({title: 'When paused'});
    const mode = comboRow(settings, 'pause-hide-mode', 'Hide indicator', [
        ['delay', 'After a delay'], ['never', 'Never (while a track is loaded)'],
    ]);
    const delay = spinRow(settings, 'pause-hide-delay', 'Delay', 0, 600, 5, 'Seconds; 0 hides immediately');
    const syncDelay = () => delay.set_sensitive(settings.get_string('pause-hide-mode') === 'delay');
    syncDelay();
    settings.connect('changed::pause-hide-mode', syncDelay);
    paused.add(mode);
    paused.add(delay);
    page.add(paused);

    return page;
}

function whitelistPage(settings) {
    const page = new Adw.PreferencesPage({name: 'whitelist', title: 'Whitelist', icon_name: 'view-list-symbolic'});

    const modeGroup = new Adw.PreferencesGroup();
    modeGroup.add(switchRow(settings, 'whitelist-enabled', 'Only show whitelisted players',
        'When off, any media player is shown'));
    page.add(modeGroup);

    const listGroup = new Adw.PreferencesGroup({title: 'Whitelisted players'});
    const addGroup = new Adw.PreferencesGroup({
        title: 'Add player',
        description: 'Players running right now are listed below. You can also type a name.',
    });
    page.add(listGroup);
    page.add(addGroup);

    const refreshButton = new Gtk.Button({icon_name: 'view-refresh-symbolic', valign: Gtk.Align.CENTER});
    refreshButton.add_css_class('flat');
    addGroup.set_header_suffix(refreshButton);

    const entry = new Adw.EntryRow({title: 'Add by name (e.g. spotify, firefox)', show_apply_button: true});
    addGroup.add(entry);

    const add = name => {
        const id = playerId(name.trim());
        if (!id)
            return;
        const list = settings.get_strv('whitelist');
        if (!list.includes(id))
            settings.set_strv('whitelist', [...list, id]);
    };
    entry.connect('apply', () => {
        add(entry.text);
        entry.text = '';
    });

    let listRows = [];
    let detectedRows = [];

    const rebuildList = () => {
        listRows.forEach(r => listGroup.remove(r));
        listRows = [];
        const list = settings.get_strv('whitelist');
        if (list.length === 0) {
            const row = new Adw.ActionRow({
                title: 'No players whitelisted',
                subtitle: 'With the whitelist on, nothing is shown until you add a player.',
            });
            listGroup.add(row);
            listRows.push(row);
        }
        for (const id of list) {
            const row = new Adw.ActionRow({title: id});
            const remove = new Gtk.Button({icon_name: 'user-trash-symbolic', valign: Gtk.Align.CENTER});
            remove.add_css_class('flat');
            remove.connect('clicked', () =>
                settings.set_strv('whitelist', settings.get_strv('whitelist').filter(x => x !== id)));
            row.add_suffix(remove);
            listGroup.add(row);
            listRows.push(row);
        }
    };

    const rebuildDetected = async () => {
        detectedRows.forEach(r => addGroup.remove(r));
        detectedRows = [];
        let names = [];
        try {
            names = await listMprisNames();
        } catch (e) {
            console.debug(`now-playing prefs: ${e.message}`);
        }
        const listed = settings.get_strv('whitelist');
        const ids = [...new Set(names.map(playerId))].filter(id => !listed.includes(id));
        detectedRows.forEach(r => addGroup.remove(r));
        detectedRows = [];
        for (const id of ids) {
            const row = new Adw.ActionRow({title: id, subtitle: 'Detected'});
            const button = new Gtk.Button({label: 'Add', valign: Gtk.Align.CENTER});
            button.connect('clicked', () => add(id));
            row.add_suffix(button);
            addGroup.add(row);
            detectedRows.push(row);
        }
    };

    refreshButton.connect('clicked', () => rebuildDetected());
    settings.connect('changed::whitelist', () => {
        rebuildList();
        rebuildDetected();
    });
    rebuildList();
    rebuildDetected();

    return page;
}

export default class NowPlayingPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;
        window.set_default_size(600, 700);
        window.add(generalPage(settings));
        window.add(whitelistPage(settings));

        const target = settings.get_string('open-page');
        if (target) {
            window.set_visible_page_name(target);
            settings.set_string('open-page', '');
        }
    }
}
```

- [ ] **Step 2: Manual verification**

Run: `gnome-extensions prefs now-playing@chris` (works outside the nested shell too).
Expected: General and Whitelist pages render. Check:
- Changing overflow / width / button toggles / pause mode updates the nested-shell indicator live (Task 7 environment).
- Delay row is greyed out when mode is "Never".
- Start a fake player, press refresh on the Whitelist page → it appears under "Add player"; Add moves it to "Whitelisted players"; trash removes it; typing `Firefox` + Enter adds `firefox`.
- With whitelist on and a non-listed fake player running, the indicator hides; adding it makes the indicator appear.
- Popup "Settings…" opens prefs directly on the Whitelist page, and a second open from the Extensions app lands on General.

- [ ] **Step 3: Commit**

```bash
git add prefs.js && git commit -m "feat: preferences window with whitelist management"
```

---

### Task 9: Final verification and packaging

**Files:**
- Modify: none expected (fixes only, if verification finds problems)

- [ ] **Step 1: Full automated pass**

Run: `make test && make integration`
Expected: all unit tests `ok`, `integration: ok`.

- [ ] **Step 2: Real-player pass in the nested shell**

Do this after Step 4, in the *host* session, with Spotify and/or a YouTube tab in Firefox (mpv has no MPRIS support by default). Verify that: Firefox video playing → label appears with the video title; pausing → hides after the delay; whitelist `spotify` only → Firefox ignored; two sources playing → most recent wins; pin from popup works.

- [ ] **Step 3: Marquee and cover visual check**

With `overflow-style=marquee` and the long-title fake player: text pauses ~1.5 s, scrolls to its end at ~40 px/s, pauses, jumps back and repeats; pausing the player stops the scroll; switching to ellipsis truncates with `…`. Confirm the label's height/baseline looks right next to the buttons; if the panel text is vertically offset, adjust `y_align`/height in `label.js` `_relayout` and re-check.

- [ ] **Step 4: Package and install for real**

```bash
rm ~/.local/share/gnome-shell/extensions/now-playing@chris   # remove the dev symlink
make pack
gnome-extensions install --force now-playing@chris.shell-extension.zip
```
Then log out and in (Wayland), `gnome-extensions enable now-playing@chris`, and run Step 2's checks. Re-create the symlink only when developing again.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A && git commit -m "fix: issues found during final verification"
```
(Skip when nothing changed.)
