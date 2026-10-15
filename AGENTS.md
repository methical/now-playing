# Now Playing — agent notes

GNOME Shell 50 extension (ES modules, GJS). Shows `Artist – Title` plus prev / play-pause / next in the **left** panel box for the current MPRIS player. It is hidden unless something is playing, with an optional player whitelist.

- UUID `now-playing@chris`, schema `org.gnome.shell.extensions.now-playing`.
- Spec: `docs/superpowers/specs/2026-10-15-now-playing-design.md` (binding). Plan: `docs/superpowers/plans/2026-10-15-now-playing.md`.

## Commands

```bash
make schemas       # compile GSettings schema (gschemas.compiled is git-ignored; required after schema edits)
make test          # unit tests, plain gjs, no Shell needed (tests/run.js)
make integration   # MprisSource vs tests/fake-player.js on a private bus (dbus-run-session)
make pack          # build the installable zip; add any new module to --extra-source in the Makefile
```

Fake player for manual testing: `FAKE_NAME=x FAKE_TITLE=… FAKE_ARTIST=… FAKE_ART=file:///… FAKE_STATUS=Paused gjs -m tests/fake-player.js`. Its PlayPause, Next and Previous work.

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
- Cover art: `resolveCover` must never throw and only caches `image/*` bodies up to 5 MiB under `~/.cache/now-playing/`.

## Verification rules

- The extension has not been exercised in a real Shell by the agents that built it. Anything touching St/Clutter/PanelMenu/PopupMenu is **unverified at runtime**, so state that plainly.
- Never `gnome-extensions enable`, symlink into `~/.local/share/gnome-shell/extensions`, or touch dconf without the user's go-ahead. That loads code into their live session.
- Wayland cannot reload extensions. Test in a nested shell (`gnome-shell --devkit`, needs `mutter-devkit`) or log out and in.
- Don't commit `.superpowers/` (SDD scratch workspace, git-ignored).

## Conventions

- 4-space indent, single quotes, semicolons; match the existing files.
- New logic goes into the pure modules first, with a test in `tests/*.test.js` (register it in `tests/run.js`).
- Log recoverable failures with `console.debug` and unexpected ones with `console.error`; don't swallow errors silently.
