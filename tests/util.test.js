// SPDX-License-Identifier: GPL-3.0-or-later

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
