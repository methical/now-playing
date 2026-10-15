import GLib from 'gi://GLib';
import System from 'system';
import './util.test.js';
import './tracker.test.js';
import './cover.test.js';
import {runAll} from './harness.js';

const loop = new GLib.MainLoop(null, false);
let failed = 0;
runAll().then(f => {
    failed = f;
    loop.quit();
}).catch(e => {
    print(e);
    failed = 1;
    loop.quit();
});
loop.run();
System.exit(failed ? 1 : 0);
