// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {test, assertEq} from './harness.js';
import {resolveCover, isAcceptableImage} from '../cover.js';

test('empty and unsupported urls → null', async () => {
    assertEq(await resolveCover(''), null);
    assertEq(await resolveCover('data:image/png;base64,AAAA'), null);
    assertEq(await resolveCover('ftp://example.invalid/a.png'), null);
});

test('missing file:// → null', async () => {
    assertEq(await resolveCover('file:///definitely/not/here.png'), null);
});

test('existing file:// → its path', async () => {
    const [, path] = GLib.file_open_tmp('cover-XXXXXX.png');
    try {
        assertEq(await resolveCover(Gio.File.new_for_path(path).get_uri()), path);
    } finally {
        GLib.unlink(path);
    }
});

test('unreachable http(s) → null, no throw', async () => {
    assertEq(await resolveCover('http://127.0.0.1:1/cover.jpg'), null);
    assertEq(await resolveCover('http://'), null);
});

test('non-string input → null, no throw', async () => {
    assertEq(await resolveCover(null), null);
    assertEq(await resolveCover(42), null);
    assertEq(await resolveCover({}), null);
});

test('only image/* bodies up to 5 MiB are accepted', () => {
    const MAX = 5 * 1024 * 1024;
    assertEq(isAcceptableImage('image/png', 1024), true);
    assertEq(isAcceptableImage('image/jpeg', MAX), true);
    assertEq(isAcceptableImage('image/png', MAX + 1), false);
    assertEq(isAcceptableImage('text/html', 1024), false);
    assertEq(isAcceptableImage(null, 1024), false);
    assertEq(isAcceptableImage('', 1024), false);
});

test('pre-cancelled http fetch → null', async () => {
    const cancellable = new Gio.Cancellable();
    cancellable.cancel();
    assertEq(await resolveCover('http://127.0.0.1:1/cover.jpg', cancellable), null);
});
