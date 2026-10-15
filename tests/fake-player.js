import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const env = (k, d) => GLib.getenv(k) ?? d;
const NAME = `org.mpris.MediaPlayer2.${env('FAKE_NAME', 'fake')}`;
const BASE_TITLE = env('FAKE_TITLE', 'Karma Police');
const ARTIST = env('FAKE_ARTIST', 'Radiohead');
const ART = env('FAKE_ART', '');

const ROOT_XML = `<node><interface name="org.mpris.MediaPlayer2">
  <property name="Identity" type="s" access="read"/>
  <property name="DesktopEntry" type="s" access="read"/>
  <property name="CanRaise" type="b" access="read"/>
  <method name="Raise"/>
</interface></node>`;

const PLAYER_XML = `<node><interface name="org.mpris.MediaPlayer2.Player">
  <method name="PlayPause"/><method name="Next"/><method name="Previous"/>
  <property name="PlaybackStatus" type="s" access="read"/>
  <property name="Metadata" type="a{sv}" access="read"/>
  <property name="CanGoNext" type="b" access="read"/>
  <property name="CanGoPrevious" type="b" access="read"/>
  <property name="CanControl" type="b" access="read"/>
</interface></node>`;

class Root {
    get Identity() { return `Fake ${env('FAKE_NAME', 'fake')}`; }
    get DesktopEntry() { return ''; }
    get CanRaise() { return true; }

    // FAKE_RAISE_FILE: touched when Raise() is called (used by the integration test).
    Raise() {
        const path = GLib.getenv('FAKE_RAISE_FILE');
        if (path)
            GLib.file_set_contents(path, 'raised');
    }
}

class Player {
    constructor() {
        this._status = env('FAKE_STATUS', 'Playing');
        this._n = 1;
    }

    get PlaybackStatus() { return this._status; }
    get CanGoNext() { return true; }
    get CanGoPrevious() { return true; }
    get CanControl() { return true; }

    get Metadata() {
        const md = {
            'xesam:title': new GLib.Variant('s', this._n === 1 ? BASE_TITLE : `${BASE_TITLE} #${this._n}`),
            'xesam:artist': new GLib.Variant('as', [ARTIST]),
        };
        if (ART)
            md['mpris:artUrl'] = new GLib.Variant('s', ART);
        return new GLib.Variant('a{sv}', md);
    }

    PlayPause() {
        this._status = this._status === 'Playing' ? 'Paused' : 'Playing';
        this._exported.emit_property_changed('PlaybackStatus', new GLib.Variant('s', this._status));
    }

    Next() { this._skip(1); }
    Previous() { this._skip(-1); }

    _skip(d) {
        this._n = Math.max(1, this._n + d);
        this._exported.emit_property_changed('Metadata', this.Metadata);
    }
}

const loop = new GLib.MainLoop(null, false);
Gio.bus_own_name(Gio.BusType.SESSION, NAME, Gio.BusNameOwnerFlags.NONE,
    connection => {
        const root = Gio.DBusExportedObject.wrapJSObject(ROOT_XML, new Root());
        root.export(connection, '/org/mpris/MediaPlayer2');
        const player = new Player();
        player._exported = Gio.DBusExportedObject.wrapJSObject(PLAYER_XML, player);
        player._exported.export(connection, '/org/mpris/MediaPlayer2');
    }, null, () => loop.quit());
loop.run();
