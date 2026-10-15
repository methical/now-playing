# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/).

## [0.1.2] - 2026-10-15

### Fixed

- The idle source scheduled by a cover click is now tracked and removed when the extension is disabled, as the extensions.gnome.org review guidelines require.

## [0.1.1] - 2026-10-15

### Fixed

- Clicking the cover in the popup now raises and focuses the player. The cover is a real button instead of an inert menu item, and the window is activated through the Shell after the menu has closed, so focus-stealing prevention no longer shows a "is ready" notification.
- Players whose MPRIS `DesktopEntry` differs from their desktop file (for example Spotify, `spotify` vs `com.spotify.Client`) are now found through their window class.
- Desktop entries with capital letters are looked up with their original case.

## [0.1.0] - 2026-10-15

First version.

### Added

- Panel indicator in the left box showing `Artist – Title` of the current MPRIS player, visible only while something is playing.
- Inline previous / play-pause / next buttons, each hideable in the preferences.
- Ellipsis or ping-pong marquee for long titles, with a configurable maximum width.
- Popup with cover art (click it to raise the player), a player list with pin / unpin, and a link to the settings.
- Configurable pause behavior: hide after a delay, or never while a track is loaded.
- Optional whitelist of players, chosen from detected players or entered by name.
- Preferences window (general and whitelist pages).

[0.1.1]: https://github.com/methical/now-playing/releases/tag/v0.1.1
[0.1.0]: https://github.com/methical/now-playing/releases/tag/v0.1.0
