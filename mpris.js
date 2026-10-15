import Gio from 'gi://Gio';
import {MPRIS_PREFIX} from './util.js';
import {listMprisNames} from './names.js';

Gio._promisify(Gio.DBusProxy, 'new_for_bus', 'new_for_bus_finish');
Gio._promisify(Gio.DBusProxy.prototype, 'call', 'call_finish');

const PATH = '/org/mpris/MediaPlayer2';

function readPlayer(proxy) {
    const get = k => proxy.get_cached_property(k)?.recursiveUnpack();
    return {
        status: get('PlaybackStatus') ?? 'Stopped',
        metadata: get('Metadata') ?? {},
        canPrev: get('CanGoPrevious') ?? false,
        canNext: get('CanGoNext') ?? false,
        canControl: get('CanControl') ?? false,
    };
}

function readRoot(proxy) {
    const get = k => proxy.get_cached_property(k)?.unpack();
    return {identity: get('Identity') ?? '', desktopEntry: get('DesktopEntry') ?? ''};
}

export class MprisSource {
    constructor(tracker) {
        this._tracker = tracker;
        this._entries = new Map();
        this._cancellable = new Gio.Cancellable();
        this._subId = 0;
    }

    async start() {
        this._subId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged',
            '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
            (_c, _s, _p, _i, _sig, params) => {
                const [name, oldOwner, newOwner] = params.deepUnpack();
                if (!name.startsWith(MPRIS_PREFIX))
                    return;
                if (oldOwner)
                    this._drop(name);
                if (newOwner)
                    this._watch(name).catch(e => console.debug(`now-playing: watch ${name}: ${e.message}`));
            });
        for (const name of await listMprisNames(this._cancellable))
            this._watch(name).catch(e => console.debug(`now-playing: watch ${name}: ${e.message}`));
    }

    stop() {
        this._cancellable.cancel();
        if (this._subId) {
            Gio.DBus.session.signal_unsubscribe(this._subId);
            this._subId = 0;
        }
        for (const name of [...this._entries.keys()])
            this._drop(name, false);
    }

    async call(busName, method) {
        const proxy = this._entries.get(busName)?.player;
        if (!proxy)
            return;
        try {
            await proxy.call(method, null, Gio.DBusCallFlags.NONE, -1, this._cancellable);
        } catch (e) {
            console.debug(`now-playing: ${method} on ${busName} failed: ${e.message}`);
        }
    }

    async _watch(name) {
        if (this._entries.has(name))
            return;
        const entry = {root: null, player: null, handlerId: 0};
        this._entries.set(name, entry);
        try {
            const make = iface => Gio.DBusProxy.new_for_bus(
                Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null,
                name, PATH, iface, this._cancellable);
            [entry.root, entry.player] = await Promise.all([
                make('org.mpris.MediaPlayer2'),
                make('org.mpris.MediaPlayer2.Player'),
            ]);
        } catch (e) {
            if (this._entries.get(name) === entry)
                this._entries.delete(name);
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.debug(`now-playing: cannot watch ${name}: ${e.message}`);
            return;
        }
        if (this._entries.get(name) !== entry)
            return; // dropped while connecting
        entry.handlerId = entry.player.connect('g-properties-changed', () =>
            this._tracker.updatePlayer(name, readPlayer(entry.player)));
        this._tracker.addPlayer(name, {...readRoot(entry.root), ...readPlayer(entry.player)});
    }

    _drop(name, notify = true) {
        const entry = this._entries.get(name);
        if (!entry)
            return;
        this._entries.delete(name);
        if (entry.handlerId)
            entry.player.disconnect(entry.handlerId);
        if (notify)
            this._tracker.removePlayer(name);
    }
}
