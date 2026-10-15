// SPDX-License-Identifier: GPL-3.0-or-later

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
