/**
 * attach / hideAp / activeRemoved / enable / disable : câblage du menu et cycle de vie.
 */

'use strict';

const {
    loadExtension, mocks, makeFakeApplet, makeFakeClient, registerApplet,
} = require('./load-extension');

describe('attach', () => {
    let ext;

    beforeEach(() => {
        mocks().resetRegistry();
        ext = loadExtension();
    });

    test('applet absente → SOURCE_CONTINUE (réessaie au tick suivant)', () => {
        const result = ext.attach();
        expect(result).toBe(true); // GLib.SOURCE_CONTINUE
        expect(ext.state.timerId).toBe(0);
    });

    test('applet sans client → SOURCE_CONTINUE', () => {
        const applet = makeFakeApplet({ client: null });
        registerApplet(applet);
        const result = ext.attach();
        expect(result).toBe(true);
    });

    test('applet prête → insert 4 items, connecte les signaux, SOURCE_REMOVE', () => {
        const client = makeFakeClient({ activeIds: [], connectionIds: [] });
        const applet = makeFakeApplet({ client, menuItems: 3 });
        registerApplet(applet);

        const result = ext.attach();

        expect(result).toBe(false); // GLib.SOURCE_REMOVE
        expect(ext.state.applet).toBe(applet);
        expect(ext.state.client).toBe(client);
        // 4 éléments insérés avant les 2 derniers du menu (pos = numMenuItems-2 = 1).
        expect(applet.menu._items).toHaveLength(4);
        expect(ext.state.items).toHaveLength(4);
        expect(ext.state.toggle.label.text).toBe("Point d'accès");
        // Signaux NM + device-added + menu open-state-changed.
        expect(ext.state.clientSignals).toHaveLength(3);
        expect(ext.state.menuSignal).toBeGreaterThan(0);
    });

    test('toggle toggled → helper up/down avec userAction', () => {
        const client = makeFakeClient();
        const applet = makeFakeApplet({ client });
        registerApplet(applet);
        ext.attach();

        // Deux réponses pkexec (up puis down).
        mocks().queueSubprocess({ ok: true }, 'pkexec');
        ext.state.toggle.emit('toggled', true);
        expect(mocks().registry.subprocessCalls[0]).toEqual([
            'pkexec', '/usr/local/libexec/mint-hotspot', 'up',
        ]);

        mocks().queueSubprocess({ ok: true }, 'pkexec');
        ext.state.toggle.emit('toggled', false);
        expect(mocks().registry.subprocessCalls[1]).toEqual([
            'pkexec', '/usr/local/libexec/mint-hotspot', 'down',
        ]);
    });

    test('info activate → ouvre le dialogue d\'édition', () => {
        const client = makeFakeClient();
        const applet = makeFakeApplet({ client });
        registerApplet(applet);
        ext.attach();
        ext.state.info.emit('activate');
        expect(ext.state.dialog).toBeTruthy();
    });

    test('devices activate → ouvre le dialogue des appareils', () => {
        const client = makeFakeClient();
        const applet = makeFakeApplet({ client });
        registerApplet(applet);
        ext.attach();
        mocks().queueSubprocess({ ok: true, out: '[]', err: '' });
        ext.state.devices.emit('activate');
        expect(ext.state.devDialog).toBeTruthy();
    });

    test('menu open-state-changed (open) → refreshDevices', (done) => {
        const client = makeFakeClient();
        const applet = makeFakeApplet({ client });
        registerApplet(applet);
        ext.attach();
        ext.state.toggle.setToggleState(true);
        mocks().queueSubprocess({ ok: true, out: '[]', err: '' });
        applet.menu.emit('open-state-changed', true);
        setImmediate(() => {
            expect(ext.state.devices.label.text).toBe('Appareils connectés (0)');
            done();
        });
    });

    test('hideAp : masque ap0 via _deviceRemoved de l\'applet', () => {
        const client = makeFakeClient();
        const applet = makeFakeApplet({ client });
        registerApplet(applet);
        ext.attach();
        const device = { get_iface: () => 'ap0', _delegate: applet };
        ext.hideAp(client, device);
        expect(applet._deviceRemovedCalls).toHaveLength(1);
        expect(applet._deviceRemovedCalls[0][1]).toBe(device);
    });

    test('hideAp : autre interface → ignoré', () => {
        const client = makeFakeClient();
        const applet = makeFakeApplet({ client });
        registerApplet(applet);
        ext.attach();
        ext.hideAp(client, { get_iface: () => 'wlo1', _delegate: applet });
        expect(applet._deviceRemovedCalls).toHaveLength(0);
    });

    test('hideAp : device null → ignoré', () => {
        const client = makeFakeClient();
        const applet = makeFakeApplet({ client });
        registerApplet(applet);
        ext.attach();
        ext.hideAp(client, null); // ne doit pas throw
        expect(applet._deviceRemovedCalls).toHaveLength(0);
    });

    test('attach masque ap0 déjà présent au démarrage', () => {
        const apDevice = { get_iface: () => 'ap0', _delegate: {} };
        const client = makeFakeClient({ devices: [apDevice] });
        const applet = makeFakeApplet({ client });
        registerApplet(applet);
        ext.attach();
        expect(applet._deviceRemovedCalls).toHaveLength(1);
    });
});

describe('activeRemoved', () => {
    let ext;
    let toggle;

    beforeEach(() => {
        mocks().resetRegistry();
        ext = loadExtension();
        const { makePopupSwitchMenuItem, makeMenuItemBase } = mocks();
        toggle = makePopupSwitchMenuItem("Point d'accès", true);
        const client = makeFakeClient();
        ext.setState({ toggle, client, info: makeMenuItemBase(''), devices: null });
    });

    function activeConn(id) {
        return { get_id: () => id };
    }

    test('extinction auto (pas userAction) → notification "Éteint automatiquement"', () => {
        ext.setState({ userAction: false });
        ext.activeRemoved(null, activeConn('mint-hotspot'));
        expect(mocks().registry.notifications).toEqual([
            { title: "Point d'accès", msg: 'Éteint automatiquement : aucun appareil connecté' },
        ]);
    });

    test('userAction vraie (extinction manuelle) → pas de notification', () => {
        ext.setState({ userAction: true });
        ext.activeRemoved(null, activeConn('mint-hotspot'));
        expect(mocks().registry.notifications).toHaveLength(0);
    });

    test('toggle déjà à false → pas de notification', () => {
        toggle.state = false;
        ext.setState({ userAction: false });
        ext.activeRemoved(null, activeConn('mint-hotspot'));
        expect(mocks().registry.notifications).toHaveLength(0);
    });

    test('autre connexion retirée → pas de notification, mais refresh', () => {
        ext.setState({ userAction: false });
        ext.activeRemoved(null, activeConn('autre'));
        expect(mocks().registry.notifications).toHaveLength(0);
    });

    test('remet userAction à false après coup', () => {
        ext.setState({ userAction: true });
        ext.activeRemoved(null, activeConn('mint-hotspot'));
        expect(ext.state.userAction).toBe(false);
    });
});

describe('enable / disable (cycle de vie)', () => {
    let ext;

    beforeEach(() => {
        mocks().resetRegistry();
        ext = loadExtension();
    });

    test('enable planifie attach avec un timer 1 s', () => {
        ext.enable();
        expect(ext.state.timerId).toBeGreaterThan(0);
        const timer = mocks().registry.timers.get(ext.state.timerId);
        expect(timer.seconds).toBe(1);
    });

    test('disable sans attach → safe (rien à nettoyer)', () => {
        ext.disable(); // ne doit pas throw avec client null
        expect(ext.state.timerId).toBe(0);
        expect(ext.state.applet).toBeNull();
    });

    test('enable puis tick → attach exécuté ; disable nettoie tout', () => {
        const client = makeFakeClient();
        const applet = makeFakeApplet({ client });
        registerApplet(applet);
        ext.enable();
        mocks().fireTimers(1); // tick → attach
        expect(ext.state.applet).toBe(applet);
        expect(ext.state.items).toHaveLength(4);

        ext.disable();
        expect(ext.state.timerId).toBe(0);
        expect(ext.state.applet).toBeNull();
        expect(ext.state.client).toBeNull();
        expect(ext.state.items).toEqual([]);
        expect(ext.state.toggle).toBeNull();
        expect(ext.state.info).toBeNull();
        expect(ext.state.devices).toBeNull();
        expect(ext.state.clientSignals).toEqual([]);
        expect(ext.state.menuSignal).toBe(0);
        expect(ext.state.current).toEqual([]);
        expect(ext.state.userAction).toBe(false);
        // Items détruits.
        expect(applet.menu._items.every((i) => i._destroyed)).toBe(true);
    });

    test('disable ferme le dialogue d\'édition ouvert', () => {
        const client = makeFakeClient();
        const applet = makeFakeApplet({ client });
        registerApplet(applet);
        ext.attach();
        ext.state.info.emit('activate'); // ouvre edit
        expect(ext.state.dialog).toBeTruthy();
        ext.disable();
        expect(ext.state.dialog).toBeNull();
    });

    test('disable ferme le dialogue des appareils et retire le timer', () => {
        const client = makeFakeClient();
        const applet = makeFakeApplet({ client });
        registerApplet(applet);
        ext.attach();
        mocks().queueSubprocess({ ok: true, out: '[]', err: '' });
        ext.state.devices.emit('activate');
        expect(ext.state.devDialog).toBeTruthy();
        ext.disable();
        expect(ext.state.devDialog).toBeNull();
        expect(mocks().registry.timers.size).toBe(0);
    });

    test('init ne fait rien (signature)', () => {
        expect(() => ext.init({})).not.toThrow();
    });
});
