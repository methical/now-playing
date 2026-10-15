// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {MPRIS_PREFIX} from './util.js';

Gio._promisify(Gio.DBusConnection.prototype, 'call', 'call_finish');

export async function listMprisNames(cancellable = null) {
    const reply = await Gio.DBus.session.call(
        'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
        'ListNames', null, new GLib.VariantType('(as)'),
        Gio.DBusCallFlags.NONE, -1, cancellable);
    const [names] = reply.deepUnpack();
    return names.filter(n => n.startsWith(MPRIS_PREFIX));
}
