import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import {Tracker} from '../tracker.js';
import {MprisSource} from '../mpris.js';

const fakePath = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('fake-player.js').get_path();

function waitFor(pred, what, ms = 5000) {
    const deadline = GLib.get_monotonic_time() + ms * 1000;
    return new Promise((resolve, reject) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            if (pred()) {
                resolve();
                return GLib.SOURCE_REMOVE;
            }
            if (GLib.get_monotonic_time() > deadline) {
                reject(new Error(`timeout waiting for: ${what}`));
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    });
}

async function main() {
    const tracker = new Tracker();
    const source = new MprisSource(tracker);
    await source.start();

    const [fd, raiseFile] = GLib.file_open_tmp('np-raise-XXXXXX');
    GLib.close(fd);
    GLib.unlink(raiseFile);
    GLib.setenv('FAKE_RAISE_FILE', raiseFile, true);
    const proc = Gio.Subprocess.new(['gjs', '-m', fakePath], Gio.SubprocessFlags.NONE);
    try {
        await waitFor(() => tracker.current()?.title === 'Karma Police', 'player discovered');
        const cur = tracker.current();
        if (cur.artist !== 'Radiohead' || cur.status !== 'Playing' || !cur.canNext || !cur.canRaise)
            throw new Error(`bad initial state: ${JSON.stringify(cur)}`);

        await source.raise(cur.busName);
        await waitFor(() => GLib.file_test(raiseFile, GLib.FileTest.EXISTS), 'Raise reaches the player');

        await source.call(cur.busName, 'PlayPause');
        await waitFor(() => tracker.current()?.status === 'Paused', 'PlayPause → Paused');

        await source.call(cur.busName, 'Next');
        await waitFor(() => tracker.current()?.title === 'Karma Police #2', 'Next → new title');
        await source.call(cur.busName, 'Previous');
        await waitFor(() => tracker.current()?.title === 'Karma Police', 'Previous → old title');

        proc.force_exit();
        await waitFor(() => tracker.current() === null && tracker.availablePlayers().length === 0,
            'player removal');
    } finally {
        proc.force_exit();
        GLib.unlink(raiseFile);
        source.stop();
        tracker.destroy();
    }
}

const loop = new GLib.MainLoop(null, false);
let code = 0;
main().then(() => print('integration: ok')).catch(e => {
    print(`integration: FAIL ${e.message}`);
    code = 1;
}).finally(() => loop.quit());
loop.run();
System.exit(code);
