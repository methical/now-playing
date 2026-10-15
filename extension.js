import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Tracker} from './tracker.js';
import {MprisSource} from './mpris.js';
import {ScrollingLabel} from './label.js';
import {resolveCover} from './cover.js';
import {formatLabel} from './util.js';

const COVER_SIZE = 220;

const NowPlayingIndicator = GObject.registerClass(
class NowPlayingIndicator extends PanelMenu.Button {
    _init({tracker, source, openPrefs}) {
        super._init(0.5, 'Now Playing', false);
        this._tracker = tracker;
        this._source = source;
        this._openPrefs = openPrefs;
        this._cancellable = new Gio.Cancellable();
        this._coverToken = 0;
        this._artUrl = null;
        this._appliedOverflow = null;
        this._appliedMaxWidth = null;

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._prev = this._makeButton('media-skip-backward-symbolic', 'Previous', c => c.canPrev);
        this._play = this._makeButton('media-playback-start-symbolic', 'PlayPause', c => c.canControl);
        this._next = this._makeButton('media-skip-forward-symbolic', 'Next', c => c.canNext);
        this._label = new ScrollingLabel();
        for (const b of [this._prev, this._play, this._next])
            box.add_child(b.button);
        // The PanelMenu.Button's own click gesture (recognize-on-press) would
        // swallow presses on the control buttons, so disable it and toggle the
        // menu only from the label.
        this._clickGesture.set_enabled(false);
        this._labelButton = new St.Button({
            child: this._label.actor, reactive: true, can_focus: true, track_hover: true,
        });
        this._labelButton.connect('clicked', () => this.menu.toggle());
        box.add_child(this._labelButton);
        this.add_child(box);

        this._buildMenu();
        this._unsubscribe = tracker.onChange(() => this._update());
        this._update();
    }

    applySettings(settings) {
        this._prev.button.visible = settings.get_boolean('show-prev');
        this._play.button.visible = settings.get_boolean('show-playpause');
        this._next.button.visible = settings.get_boolean('show-next');
        // setStyle restarts the marquee, so only call it on a real change.
        const overflow = settings.get_string('overflow-style');
        const maxWidth = settings.get_int('max-width');
        if (overflow !== this._appliedOverflow || maxWidth !== this._appliedMaxWidth) {
            this._appliedOverflow = overflow;
            this._appliedMaxWidth = maxWidth;
            this._label.setStyle({overflow, maxWidth});
        }
    }

    _makeButton(iconName, method, isEnabled) {
        const icon = new St.Icon({icon_name: iconName, style_class: 'system-status-icon'});
        const button = new St.Button({
            child: icon, reactive: true, can_focus: true, track_hover: true,
            style: 'padding: 0 4px;',
        });
        button.connect('clicked', () => {
            const cur = this._tracker.current();
            if (cur)
                this._source.call(cur.busName, method);
        });
        return {button, icon, isEnabled};
    }

    _buildMenu() {
        this._coverItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this._coverBin = new St.Bin({x_expand: true, x_align: Clutter.ActorAlign.CENTER});
        this._coverItem.add_child(this._coverBin);
        this._coverItem.visible = false;
        this.menu.addMenuItem(this._coverItem);

        this._playerSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._playerSection);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction('Settings…', () => this._openPrefs());

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._refreshPlayers();
        });
    }

    _refreshPlayers() {
        this._playerSection.removeAll();
        const cur = this._tracker.current();
        for (const p of this._tracker.availablePlayers()) {
            const pinned = this._tracker.pinnedBusName === p.busName;
            const item = new PopupMenu.PopupMenuItem(`${p.identity || p.id}${pinned ? ' (pinned)' : ''}`);
            item.setOrnament(cur?.busName === p.busName
                ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
            item.connect('activate', () => this._tracker.togglePin(p.busName));
            this._playerSection.addMenuItem(item);
        }
    }

    async _loadCover(artUrl) {
        const token = ++this._coverToken;
        this._coverItem.visible = false;
        if (!artUrl)
            return;
        const path = await resolveCover(artUrl, this._cancellable);
        if (token !== this._coverToken || !path)
            return;
        const uri = GLib.filename_to_uri(path, null);
        this._coverBin.set_style(
            `background-image: url("${uri}"); background-size: cover; ` +
            `width: ${COVER_SIZE}px; height: ${COVER_SIZE}px; border-radius: 12px;`);
        this._coverItem.visible = true;
    }

    _update() {
        const cur = this._tracker.current();
        this.visible = cur !== null;
        if (!cur) {
            this.menu.close();
            this._label.setText('');
            this._artUrl = null;
            this._coverToken++;
            return;
        }

        this._label.setText(formatLabel(cur, cur.identity));
        this._label.setPaused(cur.status !== 'Playing');
        this._play.icon.icon_name = cur.status === 'Playing'
            ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        for (const b of [this._prev, this._play, this._next]) {
            const enabled = b.isEnabled(cur);
            b.button.reactive = enabled;
            b.button.opacity = enabled ? 255 : 90;
        }
        if (cur.artUrl !== this._artUrl) {
            this._artUrl = cur.artUrl;
            this._loadCover(cur.artUrl).catch(e => console.debug(`now-playing: ${e.message}`));
        }
        if (this.menu.isOpen)
            this._refreshPlayers();
    }

    _onDestroy() {
        this._unsubscribe();
        this._cancellable.cancel();
        this._coverToken++;
        this._label.destroy();
        super._onDestroy();
    }
});

export default class NowPlayingExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._tracker = new Tracker();
        this._source = new MprisSource(this._tracker);
        this._indicator = new NowPlayingIndicator({
            tracker: this._tracker,
            source: this._source,
            openPrefs: () => {
                this._settings.set_string('open-page', 'whitelist');
                this.openPreferences();
            },
        });
        this._applySettings();
        this._settingsId = this._settings.connect('changed', () => this._applySettings());

        Main.panel.addToStatusArea(this.uuid, this._indicator,
            Main.panel._leftBox.get_n_children(), 'left');
        this._source.start().catch(e => {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.error(`now-playing: ${e.message}`);
        });
    }

    disable() {
        this._settings?.disconnect(this._settingsId);
        this._source?.stop();
        this._indicator?.destroy();
        this._tracker?.destroy();
        this._indicator = null;
        this._source = null;
        this._tracker = null;
        this._settings = null;
    }

    _applySettings() {
        const s = this._settings;
        this._tracker.setSettings({
            whitelistEnabled: s.get_boolean('whitelist-enabled'),
            whitelist: s.get_strv('whitelist'),
            pauseHideMode: s.get_string('pause-hide-mode'),
            pauseHideDelay: s.get_int('pause-hide-delay'),
        });
        this._indicator.applySettings(s);
    }
}
