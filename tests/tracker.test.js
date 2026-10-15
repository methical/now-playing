// SPDX-License-Identifier: GPL-3.0-or-later

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

test('pin is cleared when the pinned player stops', () => {
    const {t} = setup();
    playing(t, SPOT);
    playing(t, FF);
    t.togglePin(SPOT);
    t.updatePlayer(SPOT, {status: 'Stopped'});
    t.updatePlayer(SPOT, {status: 'Paused'});
    assertEq(t.current().id, 'firefox');
    assertEq(t.pinnedBusName, null);
});

test('canRaise is carried from addPlayer and updatePlayer', () => {
    const {t} = setup();
    playing(t, SPOT);
    assertEq(t.current().canRaise, false);
    t.updatePlayer(SPOT, {canRaise: true});
    assertEq(t.current().canRaise, true);
    playing(t, FF, {canRaise: true});
    assertEq(t.current().canRaise, true);
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
