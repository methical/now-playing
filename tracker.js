// SPDX-License-Identifier: GPL-3.0-or-later

import {playerId, parseMetadata, isAllowed} from './util.js';

const DEFAULTS = {
    whitelistEnabled: false,
    whitelist: [],
    pauseHideMode: 'delay',
    pauseHideDelay: 30,
};

export class Tracker {
    constructor({
        now = () => Date.now(),
        setTimer = (ms, cb) => setTimeout(cb, ms),
        clearTimer = id => clearTimeout(id),
    } = {}) {
        this._now = now;
        this._setTimer = setTimer;
        this._clearTimer = clearTimer;
        this._players = new Map();
        this._seq = 0;
        this._pinned = null;
        this._settings = {...DEFAULTS};
        this._listeners = new Set();
        this._timer = null;
    }

    get pinnedBusName() {
        return this._pinned;
    }

    onChange(cb) {
        this._listeners.add(cb);
        return () => this._listeners.delete(cb);
    }

    setSettings(partial) {
        Object.assign(this._settings, partial);
        this._changed();
    }

    addPlayer(busName, info = {}) {
        const p = {
            busName, id: playerId(busName), identity: '', desktopEntry: '',
            status: 'Stopped', title: '', artist: '', artUrl: '',
            canPrev: false, canNext: false, canControl: false, canRaise: false,
            playSeq: 0, pausedAt: 0,
        };
        this._players.set(busName, p);
        this._apply(p, info, true);
        this._changed();
    }

    updatePlayer(busName, patch) {
        const p = this._players.get(busName);
        if (!p)
            return;
        this._apply(p, patch, false);
        this._changed();
    }

    removePlayer(busName) {
        this._players.delete(busName);
        if (this._pinned === busName)
            this._pinned = null;
        this._changed();
    }

    togglePin(busName) {
        if (this._pinned === busName)
            this._pinned = null;
        else if (this._players.has(busName))
            this._pinned = busName;
        else
            return;
        this._changed();
    }

    unpin() {
        this._pinned = null;
        this._changed();
    }

    current() {
        const pinned = this._pinned ? this._players.get(this._pinned) : null;
        if (pinned && this._showable(pinned))
            return pinned;
        let best = null;
        let bestRank = -1;
        for (const p of this._players.values()) {
            if (!this._showable(p))
                continue;
            const rank = (p.status === 'Playing' ? 1e9 : 0) + p.playSeq;
            if (rank > bestRank) {
                best = p;
                bestRank = rank;
            }
        }
        return best;
    }

    availablePlayers() {
        return [...this._players.values()]
            .filter(p => this._allowed(p))
            .sort((a, b) => b.playSeq - a.playSeq);
    }

    destroy() {
        this._cancelTimer();
        this._listeners.clear();
    }

    _apply(p, patch, initial) {
        if (patch.identity !== undefined)
            p.identity = patch.identity;
        if (patch.desktopEntry !== undefined)
            p.desktopEntry = patch.desktopEntry.toLowerCase();
        if (patch.metadata !== undefined)
            Object.assign(p, parseMetadata(patch.metadata));
        for (const k of ['canPrev', 'canNext', 'canControl', 'canRaise']) {
            if (patch[k] !== undefined)
                p[k] = patch[k];
        }
        if (patch.status !== undefined && patch.status !== p.status) {
            p.status = patch.status;
            if (p.status === 'Stopped' && this._pinned === p.busName)
                this._pinned = null;
            if (p.status === 'Playing')
                p.playSeq = ++this._seq;
            else if (p.status === 'Paused')
                p.pausedAt = initial ? -Infinity : this._now();
        }
    }

    _allowed(p) {
        return !this._settings.whitelistEnabled || isAllowed(p, this._settings.whitelist);
    }

    _showable(p) {
        if (!this._allowed(p))
            return false;
        if (p.status === 'Playing')
            return true;
        if (p.status !== 'Paused')
            return false;
        if (this._settings.pauseHideMode === 'never')
            return true;
        return this._now() - p.pausedAt < this._settings.pauseHideDelay * 1000;
    }

    _cancelTimer() {
        if (this._timer !== null) {
            this._clearTimer(this._timer);
            this._timer = null;
        }
    }

    _reschedule() {
        this._cancelTimer();
        if (this._settings.pauseHideMode !== 'delay')
            return;
        const now = this._now();
        let next = Infinity;
        for (const p of this._players.values()) {
            if (p.status !== 'Paused' || !this._allowed(p))
                continue;
            const left = p.pausedAt + this._settings.pauseHideDelay * 1000 - now;
            if (left > 0)
                next = Math.min(next, left);
        }
        if (next === Infinity)
            return;
        this._timer = this._setTimer(next, () => {
            this._timer = null;
            this._changed();
        });
    }

    _changed() {
        this._reschedule();
        for (const cb of [...this._listeners])
            cb();
    }
}
