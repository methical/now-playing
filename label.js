import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

const PAUSE_MS = 1500;
const PX_PER_SECOND = 40;

export class ScrollingLabel {
    constructor() {
        this.actor = new Clutter.Actor({
            clip_to_allocation: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        this.actor.add_child(this._label);

        this._text = '';
        this._overflow = 'ellipsis';
        this._maxWidth = 300;
        this._paused = false;
        this._timeoutId = 0;
        this._generation = 0;
        this._mappedId = this.actor.connect('notify::mapped', () => this._relayout());
    }

    setText(text) {
        if (text === this._text)
            return;
        this._text = text;
        this._label.text = text;
        this._relayout();
    }

    setStyle({overflow, maxWidth}) {
        this._overflow = overflow;
        this._maxWidth = maxWidth;
        this._relayout();
    }

    setPaused(paused) {
        if (paused === this._paused)
            return;
        this._paused = paused;
        this._relayout();
    }

    destroy() {
        this._stopMarquee();
        this.actor.disconnect(this._mappedId);
        this.actor.destroy();
    }

    _relayout() {
        this._stopMarquee();
        // Not on stage yet (or unmapped): the notify::mapped handler re-runs this.
        if (!this.actor.get_stage())
            return;
        this._label.set_width(-1);
        const text = this._label.clutter_text;
        const [, naturalW] = this._label.get_preferred_width(-1);
        const [, naturalH] = this._label.get_preferred_height(naturalW);
        const width = Math.min(naturalW, this._maxWidth);
        this.actor.set_size(width, naturalH);
        this._label.translation_x = 0;

        if (naturalW <= this._maxWidth) {
            text.ellipsize = Pango.EllipsizeMode.NONE;
            this._label.set_width(naturalW);
        } else if (this._overflow === 'marquee') {
            text.ellipsize = Pango.EllipsizeMode.NONE;
            this._label.set_width(naturalW);
            if (!this._paused)
                this._cycle(naturalW - width);
        } else {
            text.ellipsize = Pango.EllipsizeMode.END;
            this._label.set_width(width);
        }
    }

    _later(callback) {
        const generation = this._generation;
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PAUSE_MS, () => {
            this._timeoutId = 0;
            if (generation === this._generation)
                callback();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Ping-pong: pause, scroll to the end, pause, scroll back to the start, repeat.
    _cycle(distance, forward = true) {
        const generation = this._generation;
        this._later(() => {
            this._label.ease({
                translation_x: forward ? -distance : 0,
                duration: Math.round(distance / PX_PER_SECOND * 1000),
                mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
                onComplete: () => {
                    if (generation === this._generation)
                        this._cycle(distance, !forward);
                },
            });
        });
    }

    _stopMarquee() {
        this._generation++;
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._label.remove_all_transitions();
    }
}
