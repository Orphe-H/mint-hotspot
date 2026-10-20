/**
 * Mocks du runtime GJS (imports.gi / imports.ui) pour tester extension.js sous Node/Jest.
 * Les classes imitent l'interface utilisée par l'extension (actor, label, connect, …).
 */

'use strict';

// ---------- enregistrement centralisé (réinitialisé par test) ----------

const registry = {
    // subprocesses Gio : file d'attente de réponses {ok, out, err} par argv[0] (ou clé exacte)
    subprocessQueue: [],
    subprocessCalls: [],
    // GLib : timers
    timers: new Map(),
    nextTimerId: 1,
    // ModalDialog : faire échouer le prochain open()
    failNextModalOpen: false,
    // Main : notifications
    notifications: [],
    errorNotifications: [],
};

function resetRegistry() {
    registry.subprocessQueue.length = 0;
    registry.subprocessCalls.length = 0;
    registry.timers.clear();
    registry.nextTimerId = 1;
    registry.failNextModalOpen = false;
    registry.notifications.length = 0;
    registry.errorNotifications.length = 0;
}

// ---------- helpers de configuration pour les tests ----------

/** Empile une réponse pour le prochain subprocess (ou pour argv[0] via key). */
function queueSubprocess(result, key) {
    registry.subprocessQueue.push({ key: key || null, ...result });
}

/** Fait tourner tous les timers planifiés via GLib.timeout_add_seconds (n = nb de ticks). */
function fireTimers(n = 1) {
    for (let i = 0; i < n; i++) {
        for (const [id, timer] of [...registry.timers]) {
            const again = timer.callback();
            if (again !== true) registry.timers.delete(id); // SOURCE_REMOVE === false/0
        }
    }
}

// ---------- objets mock ----------

function makeSignalEmitter(obj = {}) {
    const handlers = new Map();
    let nextId = 1;
    obj.connect = (signal, cb) => {
        const id = nextId++;
        handlers.set(id, { signal, cb });
        return id;
    };
    obj.disconnect = (id) => handlers.delete(id);
    obj.emit = (signal, ...args) => {
        for (const { signal: s, cb } of handlers.values()) {
            if (s === signal) cb(obj, ...args);
        }
    };
    obj._handlers = handlers;
    return obj;
}

function makeActor() {
    return {
        visible: true,
        hide() { this.visible = false; },
        show() { this.visible = true; },
    };
}

function makeMenuItemBase(text = '') {
    const item = makeSignalEmitter({
        label: { text },
        actor: makeActor(),
        destroy() { this._destroyed = true; },
        _destroyed: false,
    });
    return item;
}

function makePopupSwitchMenuItem(text, state) {
    const item = makeMenuItemBase(text);
    item.state = !!state;
    item.setToggleState = (s) => { item.state = !!s; };
    return item;
}

function makeSeparator() {
    return makeSignalEmitter({ actor: makeActor(), destroy() { this._destroyed = true; } });
}

function makeEntry(options = {}) {
    // Appelé via new St.Entry({ text, hint_text, … }) : accepte un objet OU une string.
    const opts = typeof options === 'string' ? { text: options } : options;
    const entry = makeSignalEmitter({
        text: opts.text || '',
        hint_text: opts.hint_text || '',
        style_class: opts.style_class || '',
        can_focus: opts.can_focus !== undefined ? opts.can_focus : true,
        x_align: opts.x_align !== undefined ? opts.x_align : null,
        clutter_text: makeSignalEmitter({ line_wrap: false, selectable: false }),
        _menu: null,
    });
    return entry;
}

function makePasswordEntry(options = {}) {
    return makeEntry(options);
}

function makeLabel(options = {}) {
    const opts = typeof options === 'string' ? { text: options } : options;
    return makeSignalEmitter({
        text: opts.text || '',
        style: opts.style || '',
        style_class: opts.style_class || '',
        reactive: opts.reactive !== undefined ? opts.reactive : false,
        can_focus: opts.can_focus !== undefined ? opts.can_focus : false,
        clutter_text: makeSignalEmitter({ line_wrap: false, selectable: false }),
    });
}

function makeMessageDialogContent({ title = '' } = {}) {
    const children = [];
    return {
        title,
        children,
        add_child(a) { children.push(a); },
    };
}

function makeModalDialog({ styleClass = '' } = {}) {
    const d = makeSignalEmitter({
        styleClass,
        contentLayout: {
            _children: [],
            _styleClasses: new Set(['dialog-content-box']),
            add_child(a) { this._children.push(a); },
            remove_style_class_name(c) { this._styleClasses.delete(c); },
            set_style(s) { this._style = s; },
        },
        content: null,
        _buttons: [],
        _open: false,
        _initialFocus: null,
        setButtons(b) { this._buttons = b; },
        setInitialKeyFocus(a) { this._initialFocus = a; },
        open() {
            if (registry.failNextModalOpen) {
                registry.failNextModalOpen = false;
                this._open = false;
                return false;
            }
            this._open = true;
            return true;
        },
        close() { this._open = false; this.emit('closed'); },
    });
    return d;
}

// ---------- Gio.Subprocess ----------

function makeSubprocess(argv, _flags) {
    registry.subprocessCalls.push(argv.slice());
    const entry = registry.subprocessQueue.shift() || { ok: true, out: '', err: '' };
    let finished = false;
    const proc = {
        _argv: argv,
        get_successful: () => entry.ok,
        communicate_utf8_async(_stdin, _cancellable, callback) {
            // Appel synchrone du callback : simplifie les tests (pas de vrai event loop).
            callback(proc, {});
        },
        communicate_utf8_finish(_res) {
            finished = true;
            return [true, entry.out || '', entry.err || ''];
        },
        _finished: () => finished,
    };
    return proc;
}

// ---------- construction du global imports ----------

function buildImports() {
    const Clutter = {
        ActorAlign: { CENTER: 2 },
        KEY_Escape: 65307,
    };

    const Gio = {
        SubprocessFlags: { STDOUT_PIPE: 1, STDERR_PIPE: 2 },
        Subprocess: { new: makeSubprocess },
    };

    const GLib = {
        PRIORITY_DEFAULT: 0,
        SOURCE_CONTINUE: true,
        SOURCE_REMOVE: false,
        timeout_add_seconds(_prio, seconds, callback) {
            const id = registry.nextTimerId++;
            registry.timers.set(id, { seconds, callback });
            return id;
        },
        source_remove(id) {
            return registry.timers.delete(id);
        },
    };

    const St = {
        Entry: makeEntry,
        PasswordEntry: makePasswordEntry,
        Label: makeLabel,
    };

    const Main = {
        notifyError: (title, msg) => registry.errorNotifications.push({ title, msg }),
        notify: (title, msg) => registry.notifications.push({ title, msg }),
    };

    const PopupMenu = {
        PopupSwitchMenuItem: makePopupSwitchMenuItem,
        PopupMenuItem: makeMenuItemBase,
        PopupSeparatorMenuItem: makeSeparator,
    };

    const AppletManager = {
        _instances: [],
        getRunningInstancesForUuid(uuid) {
            return this._instances.filter((i) => i.uuid === uuid);
        },
    };

    const Dialog = { MessageDialogContent: makeMessageDialogContent };
    const ModalDialog = { ModalDialog: makeModalDialog };

    const CinnamonEntry = {
        addContextMenu(actor) {
            actor._menu = { _pasteItem: { actor: makeActor() } };
        },
    };

    return {
        gi: { Clutter, Gio, GLib, St },
        ui: { main: Main, popupMenu: PopupMenu, appletManager: AppletManager, dialog: Dialog, modalDialog: ModalDialog, cinnamonEntry: CinnamonEntry },
    };
}

// ---------- installation ----------

resetRegistry();
global.imports = buildImports();

// Expose aux tests.
global.__gjsMocks = {
    registry,
    resetRegistry,
    queueSubprocess,
    fireTimers,
    makeSignalEmitter,
    makeActor,
    makeMenuItemBase,
    makePopupSwitchMenuItem,
    makeEntry,
    makeLabel,
    makeModalDialog,
    buildImports,
};

module.exports = global.__gjsMocks;
