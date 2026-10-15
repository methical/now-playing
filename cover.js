// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');

const MAX_COVER_BYTES = 5 * 1024 * 1024;

export function isAcceptableImage(contentType, size) {
    return typeof contentType === 'string' &&
        contentType.startsWith('image/') &&
        size <= MAX_COVER_BYTES;
}

export async function resolveCover(artUrl, cancellable = null) {
    let session = null;
    try {
        if (typeof artUrl !== 'string' || !artUrl)
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

        session = new Soup.Session({timeout: 10});
        GLib.mkdir_with_parents(dir, 0o755);
        const msg = Soup.Message.new('GET', artUrl);
        const bytes = await session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, cancellable);
        if (msg.get_status() !== Soup.Status.OK)
            return null;
        const [contentType] = msg.get_response_headers().get_content_type();
        if (!isAcceptableImage(contentType, bytes.get_size()))
            return null;
        await file.replace_contents_bytes_async(
            bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, cancellable);
        return path;
    } catch (e) {
        if (!e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            console.debug(`now-playing: cover fetch failed for ${artUrl}: ${e?.message}`);
        return null;
    } finally {
        session?.abort();
    }
}
