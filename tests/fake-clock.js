export class FakeClock {
    constructor() {
        this.t = 0;
        this._timers = new Map();
        this._next = 1;
    }

    hooks() {
        return {
            now: () => this.t,
            setTimer: (ms, cb) => {
                const id = this._next++;
                this._timers.set(id, {at: this.t + ms, cb});
                return id;
            },
            clearTimer: id => this._timers.delete(id),
        };
    }

    get pending() {
        return this._timers.size;
    }

    advance(ms) {
        const end = this.t + ms;
        for (;;) {
            let nextId = null;
            let nextAt = Infinity;
            for (const [id, tm] of this._timers) {
                if (tm.at <= end && tm.at < nextAt) {
                    nextId = id;
                    nextAt = tm.at;
                }
            }
            if (nextId === null)
                break;
            const tm = this._timers.get(nextId);
            this._timers.delete(nextId);
            this.t = tm.at;
            tm.cb();
        }
        this.t = end;
    }
}
