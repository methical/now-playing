import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {listMprisNames} from './names.js';
import {playerId} from './util.js';

function comboRow(settings, watch, key, title, options) {
    const row = new Adw.ComboRow({
        title,
        model: Gtk.StringList.new(options.map(o => o[1])),
    });
    const sync = () => {
        const i = options.findIndex(o => o[0] === settings.get_string(key));
        row.selected = Math.max(i, 0);
    };
    sync();
    row.connect('notify::selected', () => settings.set_string(key, options[row.selected][0]));
    watch(`changed::${key}`, sync);
    return row;
}

function spinRow(settings, key, title, lower, upper, step, subtitle = '') {
    const row = new Adw.SpinRow({
        title, subtitle,
        adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, value: lower}),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function switchRow(settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function generalPage(settings, watch) {
    const page = new Adw.PreferencesPage({name: 'general', title: 'General', icon_name: 'preferences-system-symbolic'});

    const label = new Adw.PreferencesGroup({title: 'Label'});
    label.add(comboRow(settings, watch, 'overflow-style', 'Long text', [
        ['ellipsis', 'Truncate with …'], ['marquee', 'Scroll (marquee)'],
    ]));
    label.add(spinRow(settings, 'max-width', 'Maximum width', 100, 1000, 10, 'In pixels'));
    page.add(label);

    const buttons = new Adw.PreferencesGroup({title: 'Buttons'});
    buttons.add(switchRow(settings, 'show-prev', 'Previous'));
    buttons.add(switchRow(settings, 'show-playpause', 'Play / pause'));
    buttons.add(switchRow(settings, 'show-next', 'Next'));
    page.add(buttons);

    const paused = new Adw.PreferencesGroup({title: 'When paused'});
    const mode = comboRow(settings, watch, 'pause-hide-mode', 'Hide indicator', [
        ['delay', 'After a delay'], ['never', 'Never (while a track is loaded)'],
    ]);
    const delay = spinRow(settings, 'pause-hide-delay', 'Delay', 0, 600, 5, 'Seconds; 0 hides immediately');
    const syncDelay = () => delay.set_sensitive(settings.get_string('pause-hide-mode') === 'delay');
    syncDelay();
    watch('changed::pause-hide-mode', syncDelay);
    paused.add(mode);
    paused.add(delay);
    page.add(paused);

    return page;
}

function whitelistPage(settings, watch) {
    const page = new Adw.PreferencesPage({name: 'whitelist', title: 'Whitelist', icon_name: 'view-list-symbolic'});

    const modeGroup = new Adw.PreferencesGroup();
    modeGroup.add(switchRow(settings, 'whitelist-enabled', 'Only show whitelisted players',
        'When off, any media player is shown'));
    page.add(modeGroup);

    const listGroup = new Adw.PreferencesGroup({title: 'Whitelisted players'});
    const addGroup = new Adw.PreferencesGroup({
        title: 'Add player',
        description: 'Players running right now are listed below. You can also type a name.',
    });
    page.add(listGroup);
    page.add(addGroup);

    const refreshButton = new Gtk.Button({icon_name: 'view-refresh-symbolic', valign: Gtk.Align.CENTER});
    refreshButton.add_css_class('flat');
    addGroup.set_header_suffix(refreshButton);

    const entry = new Adw.EntryRow({title: 'Add by name (e.g. spotify, firefox)', show_apply_button: true});
    addGroup.add(entry);

    const add = name => {
        const id = playerId(name.trim());
        if (!id)
            return;
        const list = settings.get_strv('whitelist');
        if (!list.includes(id))
            settings.set_strv('whitelist', [...list, id]);
    };
    entry.connect('apply', () => {
        add(entry.text);
        entry.text = '';
    });

    let listRows = [];
    let detectedRows = [];

    const rebuildList = () => {
        listRows.forEach(r => listGroup.remove(r));
        listRows = [];
        const list = settings.get_strv('whitelist');
        if (list.length === 0) {
            const row = new Adw.ActionRow({
                title: 'No players whitelisted',
                subtitle: 'With the whitelist on, nothing is shown until you add a player.',
            });
            listGroup.add(row);
            listRows.push(row);
        }
        for (const id of list) {
            const row = new Adw.ActionRow({title: id});
            const remove = new Gtk.Button({icon_name: 'user-trash-symbolic', valign: Gtk.Align.CENTER});
            remove.add_css_class('flat');
            remove.connect('clicked', () =>
                settings.set_strv('whitelist', settings.get_strv('whitelist').filter(x => x !== id)));
            row.add_suffix(remove);
            listGroup.add(row);
            listRows.push(row);
        }
    };

    let generation = 0;
    const rebuildDetected = async () => {
        const mine = ++generation;
        let names = [];
        try {
            names = await listMprisNames();
        } catch (e) {
            console.debug(`now-playing prefs: ${e.message}`);
        }
        if (mine !== generation)
            return; // a newer rebuild superseded this one
        const listed = settings.get_strv('whitelist');
        const ids = [...new Set(names.map(playerId))].filter(id => !listed.includes(id));
        detectedRows.forEach(r => addGroup.remove(r));
        detectedRows = [];
        for (const id of ids) {
            const row = new Adw.ActionRow({title: id, subtitle: 'Detected'});
            const button = new Gtk.Button({label: 'Add', valign: Gtk.Align.CENTER});
            button.connect('clicked', () => add(id));
            row.add_suffix(button);
            addGroup.add(row);
            detectedRows.push(row);
        }
    };

    refreshButton.connect('clicked', () => rebuildDetected());
    watch('changed::whitelist', () => {
        rebuildList();
        rebuildDetected();
    });
    rebuildList();
    rebuildDetected();

    return page;
}

export default class NowPlayingPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;
        const ids = [];
        const watch = (signal, cb) => ids.push(settings.connect(signal, cb));
        window.connect('close-request', () => {
            ids.splice(0).forEach(id => settings.disconnect(id));
            return false;
        });
        window.set_default_size(600, 700);
        window.add(generalPage(settings, watch));
        window.add(whitelistPage(settings, watch));

        const target = settings.get_string('open-page');
        if (target) {
            window.set_visible_page_name(target);
            settings.set_string('open-page', '');
        }
    }
}
