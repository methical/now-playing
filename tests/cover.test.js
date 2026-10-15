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
