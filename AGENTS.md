# Now Playing — agent notes

GNOME Shell 50 extension (ES modules, GJS). Shows `Artist – Title` plus prev / play-pause / next in the **left** panel box for the current MPRIS player. It is hidden unless something is playing, with an optional player whitelist.

- UUID `now-playing@methical`, schema `org.gnome.shell.extensions.now-playing`.
- The original design spec and implementation plan were removed to avoid rot; they remain in git history (`git log --diff-filter=D -- docs`). The rules below and the tests are the source of truth.

## Commands

```bash
make schemas       # compile GSettings schema (gschemas.compiled is git-ignored; required after schema edits)
make test          # unit tests, plain gjs, no Shell needed (tests/run.js)
make integration   # MprisSource vs tests/fake-player.js on a private bus (dbus-run-session)
make pack          # build the installable zip; add any new module to --extra-source in the Makefile
```

Fake player for manual testing: `FAKE_NAME=x FAKE_TITLE=… FAKE_ARTIST=… FAKE_ART=file:///… FAKE_STATUS=Paused gjs -m tests/fake-player.js`. Its PlayPause, Next and Previous work.

## Behavior rules

- **Current player:** the pinned player if it is showable, else the most recently started playing player, else the most recently started paused-but-showable one. Pinning is cleared when the pinned player stops or quits.
- **Visibility:** shown while Playing. After a pause it stays for `pause-hide-delay` seconds (0 = hide immediately) or indefinitely with `pause-hide-mode = never`. `Stopped` or a vanished player always hides. A player first seen already Paused counts as expired.
- **Whitelist:** matches the bus-name suffix (`.instanceN` stripped, lowercased) or the player's `DesktopEntry`. Enabled with an empty list shows nothing, on purpose.
- **Raise (cover click in the popup):** find the app through the Shell from the MPRIS `DesktopEntry` (original case, then startup / desktop WM class, since e.g. Spotify reports `spotify` but ships `com.spotify.Client.desktop`) and focus its first window with `Main.activateWindow`; else call MPRIS `Raise()` if `CanRaise`. With neither, the cover is not clickable.
- **Marquee** ping-pongs: pause, scroll to the end, pause, scroll back, repeat. It only runs when the text overflows `max-width` and the player is playing.

## Architecture (what isn't obvious from filenames)

- `tracker.js` and `util.js` are **pure**. They must not import `gi://` or Shell modules, so `make test` runs without a Shell. Put all selection logic there: recency, pinning, whitelist, pause-hide timers. Timers and clock are injected (`tests/fake-clock.js`).
- `mpris.js` is only the Gio D-Bus adapter that feeds the Tracker. It must pass `status` etc. in the same `addPlayer()` call, because the "first seen Paused → already expired" rule depends on it.
- `extension.js` renders Tracker state. `prefs.js` runs in a **separate process** (Adw/Gtk, no Shell imports). `names.js` is shared by both.
- Extension → prefs "open on the whitelist page" goes through the one-shot GSettings key `open-page`. Prefs must read it when the window is filled, because setting it to its current value emits no `changed`.
- `disable()` order matters: `source.stop()` before `tracker.destroy()`. The Tracker has no destroyed flag.

## Gotchas learned the hard way

- gjs 1.88 has **no global `URL`**; use `Gio.File.new_for_uri(...)`. `GLib.file_open_tmp()` returns `[fd, path]`.
- `PanelMenu.Button` installs a recognize-on-press click gesture, so child buttons would never get `clicked`. The indicator disables it (`this._clickGesture.set_enabled(false)`, a **private** 50.5 field) and the label is a separate `St.Button` that calls `menu.toggle()`. Re-check this on a new Shell version.
- `PanelMenu.ButtonBox` already connects `destroy` → `this._onDestroy`. Override `_onDestroy` and end it with `super._onDestroy()`. Do not connect `destroy` again, or you leak the container and menu.
- `ScrollingLabel`: a forced `set_width()` sticks as the preferred size. `_relayout` resets it with `set_width(-1)` before measuring. `setStyle` restarts the marquee, so only call it when values changed.
- `Main.panel._leftBox` is private but is the accepted way to place the item at the end of the left box.
- The popup cover is an `St.Button` inside an inert `PopupBaseMenuItem`. Item `activate` never fired for it, but child buttons get `clicked`. Raise runs in an idle callback after `menu.close()`, using `Main.activateWindow`; plain `app.activate()` or the player's own `Raise()` trips focus-stealing prevention and only shows a "… is ready" notification.
- `desktopEntry` in the Tracker is lowercased for whitelist matching; use `desktopId` (original case) for Shell app lookups.
- Cover art: `resolveCover` must never throw and only caches `image/*` bodies up to 5 MiB under `~/.cache/now-playing/`.

## Verification rules

- Agents cannot run the Shell here. The maintainer has run v0.1.1 in a real session (panel, controls, popup, marquee, cover raise, zip install), but any new change touching St/Clutter/PanelMenu/PopupMenu is **unverified at runtime** until they try it, so state that plainly.
- Never `gnome-extensions enable`, symlink into `~/.local/share/gnome-shell/extensions`, or touch dconf without the user's go-ahead. That loads code into their live session.
- Wayland cannot reload extensions. Test in a nested shell (`gnome-shell --devkit`, needs `mutter-devkit`) or log out and in.
- Don't commit `.superpowers/` (SDD scratch workspace, git-ignored).

## extensions.gnome.org review rules

The extension is meant for ego, so keep to https://gjs.guide/extensions/review-guidelines/review-guidelines.html. Last audited at v0.1.2. What matters here:

- **Nothing before `enable()`.** The `Extension` constructor and module scope may only hold static data (`registerClass`, constants, `Gio._promisify`). Create objects, connect signals and add sources in `enable()`.
- **`disable()` undoes everything.** Destroy every widget and object, disconnect every signal and remove every main loop source, even ones that return `SOURCE_REMOVE` on their own. Store each `GLib.idle_add` / `timeout_add` ID and remove it in `_onDestroy` (the cover-click raise once leaked one).
- **No cross-process imports.** `extension.js` and the modules it loads must not import Gtk, Gdk or Adw. `prefs.js` and `names.js` must not import Clutter, Meta, St or Shell.
- **No deprecated modules** (`ByteArray`, `Lang`, `Mainloop`). No `run_dispose`, no subprocesses or binaries, no clipboard, no telemetry.
- **Logging stays sparse.** `console.debug` for recoverable failures only, never per-frame or per-tick.
- **Code must be readable.** No minified or obfuscated code, and no comments that read like LLM prompts. The maintainer must be able to explain all of it. Reviewers reject AI-looking output.
- **`metadata.json`:** valid `uuid`, only stable `shell-version` entries, a `url` to the repo, no `version` key, no `session-modes` (user mode only), no unnecessary keys.
- **Schema:** ID base `org.gnome.shell.extensions`, path base `/org/gnome/shell/extensions`, file named `<id>.gschema.xml`, and the XML shipped in the zip (the compiled file is not needed).
- **Zip contents:** only what the extension needs. No tests, docs, screenshots or build scripts. Every new module goes into `--extra-source` in the Makefile.
- **Licensing:** GPL-3.0-or-later. Code copied from another extension needs attribution in the shipped files. No trademarked logos or artwork.

## Releasing

1. Bump `version-name` in `metadata.json` and add a dated section to `CHANGELOG.md` (semantic versioning).
2. `make test && make integration`, commit, then `git tag -a vX.Y.Z -m vX.Y.Z` and `git push origin main vX.Y.Z`.
3. `make pack`, then `gh release create vX.Y.Z now-playing@methical.shell-extension.zip --title vX.Y.Z --notes-file <notes>`. Creating a release is public: only do it when the user asks.

## Conventions

- 4-space indent, single quotes, semicolons; match the existing files.
- New logic goes into the pure modules first, with a test in `tests/*.test.js` (register it in `tests/run.js`).
- Log recoverable failures with `console.debug` and unexpected ones with `console.error`; don't swallow errors silently.
