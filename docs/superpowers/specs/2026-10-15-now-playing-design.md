# Now Playing — GNOME Shell Extension Design

Date: 2026-10-15
Target: GNOME Shell 50.x (ES modules extension format)

## Goal

A glanceable "what's playing" indicator in the left side of the top panel, with
basic playback controls. It appears only while media is playing (or briefly
after pausing), works with any MPRIS player or an optional whitelist.

## Scope

In: label, prev / play-pause / next buttons, popup with cover art + player list
+ link to prefs, whitelist-capable prefs window.
Out: volume, seek bar, lyrics, per-app code, non-MPRIS sources.

## Panel UI

Added to the panel **left box** via `Main.panel.addToStatusArea(..., 0, 'left')`.

```
[⏮] [⏯] [⏭]  Artist – Title
```

- Each of the three buttons is individually hideable (pref).
- Buttons call MPRIS `Previous`, `PlayPause`, `Next` on the current player.
  A button is insensitive when the player reports `CanGoPrevious` /
  `CanGoNext` / `CanControl` (play-pause) as false.
- Play/pause icon reflects `PlaybackStatus`.
- Label text is `Artist – Title`, or `Title` alone when no artist is provided
  (`xesam:artist` empty). If title is missing, fall back to the player's
  `Identity`.
- Overflow, selected by pref: **ellipsis** or **marquee** (scrolling), both
  bounded by a configurable max width. Marquee scrolls only when the text
  exceeds the max width and pauses its animation while the player is paused.

## Popup (click on label area)

Buttons keep their own click behavior; clicking the label opens a `PopupMenu`:

1. **Cover art** at the top, from `mpris:artUrl` (file:// or http(s)://,
   loaded via Gio / GdkPixbuf-free St.Icon/Clutter image content). If absent or
   loading fails, the section is hidden — no placeholder.
2. **Player list**: every detected (and whitelist-allowed) player, current one
   marked. Clicking a player **pins** it, overriding "most recently started"
   until it stops or quits; clicking the pinned player unpins.
3. **Settings…** item that opens the extension prefs window (directly at the
   whitelist page).

## Player tracking (`mpris.js`)

- Watch the session bus for names matching `org.mpris.MediaPlayer2.*`
  (`NameOwnerChanged`), plus an initial `ListNames` pass.
- Per player: proxy for `org.mpris.MediaPlayer2.Player`; listen to
  `PropertiesChanged` for `PlaybackStatus` and `Metadata`; read `Identity` and
  `DesktopEntry` from the root interface.
- Maintain a recency-ordered list: when a player transitions to `Playing`, it
  moves to the front.
- **Current player** = pinned player if set and alive; else the front-most
  playing player; else (paused behavior below) the most recently playing
  paused player.
- Whitelist filtering applies when whitelist mode is on; match on the bus-name
  suffix (e.g. `spotify`, `firefox.instance_1_23` → `firefox`) or
  `DesktopEntry`. Instance suffixes are stripped for matching.
- Emits a single `changed` signal; the UI re-renders from tracker state only.

## Visibility rules

- Visible while the current player is `Playing`.
- When paused: stay visible for a delay, then hide. Pref modes:
  - **after delay** (seconds, default 30; 0 = hide immediately)
  - **never while a track is loaded**
- Hidden immediately when the player quits or reports `Stopped` with no track.
- Hidden when no allowed player qualifies.

## Preferences (GSettings, `prefs.js`)

| Key | Type | Default |
|---|---|---|
| `whitelist-enabled` | bool | false |
| `whitelist` | as | [] |
| `overflow-style` | enum: ellipsis / marquee | ellipsis |
| `max-width` | int (px) | 300 |
| `show-prev` / `show-playpause` / `show-next` | bool | true |
| `pause-hide-mode` | enum: delay / never | delay |
| `pause-hide-delay` | int (s) | 30 |

Prefs window (Adw): a general page (overflow, width, buttons, pause behavior)
and a whitelist page — mode switch, list of whitelisted players with remove,
and an "Add detected player" picker populated from the currently running MPRIS
players, plus manual entry.

## Modules

- `extension.js` — enable/disable, indicator, popup wiring.
- `mpris.js` — tracker (no UI imports; testable in isolation).
- `label.js` — ellipsis/marquee St widget.
- `prefs.js` — Adw preferences.
- `schemas/org.gnome.shell.extensions.now-playing.gschema.xml`
- `metadata.json` (`shell-version: ["50"]`)

## Lifecycle & errors

- `disable()` disconnects every signal, cancels timers, destroys the indicator
  and proxies; nothing persists beyond GSettings.
- D-Bus calls on vanished players fail silently (log at debug level); the
  tracker drops the player on `NameOwnerChanged`.
- Cover art load failure never blocks the popup.

## Testing

- `mpris.js` logic (ordering, pinning, whitelist matching, pause timers) tested
  against a fake player source with a headless GJS runner.
- Manual: `dbus-run-session -- gnome-shell --devkit` (nested session) with
  Spotify/Firefox/mpv; verify show/hide, controls, marquee, cover art,
  whitelist, enable/disable leak-free.

## Decisions log

- Own implementation over forking `mprisLabel` (installed on this machine) —
  its model doesn't match recency ordering and hide-unless-playing.
- Public APIs only (Gio, St, Adw); no reuse of Shell's private `ui/mpris.js`.
- Popup whitelist handling is a link to prefs, not inline toggles.
