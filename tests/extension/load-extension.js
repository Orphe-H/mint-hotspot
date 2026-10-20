/**
 * Recharge extension.js à blanc pour chaque test (module state réinitialisé).
 * Les mocks GJS sont installés par gjs-mocks.js (setupFiles Jest).
 */

'use strict';

const path = require('path');

const EXTENSION_PATH = path.resolve(__dirname, '../../mint-hotspot@bobby/extension.js');

function loadExtension() {
    jest.resetModules();
    // Recharge les mocks (global.imports) après resetModules.
    require('./gjs-mocks');
    return require(EXTENSION_PATH);
}

// Raccourcis d'accès aux mocks.
function mocks() {
    return require('./gjs-mocks');
}

/** Factice applet network@cinnamon.org avec client NM et menu. */
function makeFakeApplet({ client, menuItems = 2 } = {}) {
    const { makeSignalEmitter, makeMenuItemBase } = mocks();
    const menu = makeSignalEmitter({
        numMenuItems: menuItems,
        _items: [],
        addMenuItem(item, pos) {
            this._items.splice(pos ?? this._items.length, 0, item);
        },
    });
    const applet = makeSignalEmitter({
        uuid: 'network@cinnamon.org',
        _client: client,
        menu,
        _deviceRemovedCalls: [],
        _deviceRemoved(c, device) {
            this._deviceRemovedCalls.push([c, device]);
        },
    });
    return applet;
}

/** Factice client NM minimal utilisé par refresh/attach. */
function makeFakeClient({ activeIds = [], connectionIds = [], devices = [] } = {}) {
    const { makeSignalEmitter } = mocks();
    const client = makeSignalEmitter({
        _activeIds: activeIds,
        _connectionIds: connectionIds,
        _devices: devices,
        get_active_connections() {
            return this._activeIds.map((id) => ({ get_id: () => id }));
        },
        get_connection_by_id(id) {
            return this._connectionIds.includes(id) ? { get_id: () => id } : null;
        },
        get_device_by_iface(iface) {
            return this._devices.find((d) => d.get_iface() === iface) || null;
        },
    });
    return client;
}

/** Enregistre une applet factice dans le mock AppletManager (global.imports partagé). */
function registerApplet(applet) {
    global.imports.ui.appletManager._instances.push(applet);
    return applet;
}

module.exports = { loadExtension, mocks, makeFakeApplet, makeFakeClient, registerApplet, EXTENSION_PATH };
