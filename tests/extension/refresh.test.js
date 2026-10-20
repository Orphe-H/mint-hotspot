/**
 * refresh : synchronisation de l'interrupteur + ligne SSID avec l'état NetworkManager.
 */

'use strict';

const { loadExtension, mocks, makeFakeClient, makeFakeApplet } = require('./load-extension');

describe('refresh', () => {
    let ext;
    let toggle, info;

    beforeEach(() => {
        mocks().resetRegistry();
        ext = loadExtension();
        const { makePopupSwitchMenuItem, makeMenuItemBase } = mocks();
        toggle = makePopupSwitchMenuItem("Point d'accès", false);
        info = makeMenuItemBase('');
        // devices null : refreshDevices no-op, sinon il consomme une réponse subprocess (list -j).
        ext.setState({ toggle, info, devices: null });
    });

    test('sans toggle (non attaché) → no-op', () => {
        ext.setState({ toggle: null });
        ext.refresh(); // ne doit pas throw
    });

    test('AP actif → toggle à true, info masquée si nmcli échoue', (done) => {
        const client = makeFakeClient({ activeIds: ['mint-hotspot'], connectionIds: ['mint-hotspot'] });
        ext.setState({ client });
        mocks().queueSubprocess({ ok: false, out: '', err: 'fail' });
        ext.refresh();
        setImmediate(() => {
            expect(toggle.state).toBe(true);
            expect(info.actor.visible).toBe(false);
            done();
        });
    });

    test('AP inactif → toggle à false', () => {
        const client = makeFakeClient({ activeIds: [], connectionIds: ['mint-hotspot'] });
        ext.setState({ client });
        ext.refresh();
        expect(toggle.state).toBe(false);
    });

    test('connexion NM absente → pas d\'appel nmcli (ligne SSID masquée)', () => {
        const client = makeFakeClient({ activeIds: [], connectionIds: [] });
        ext.setState({ client });
        ext.refresh();
        expect(mocks().registry.subprocessCalls).toHaveLength(0);
        expect(info.actor.visible).toBe(false);
    });

    test('connexion existante → nmcli -e no -s -g ssid,psk puis label + show', (done) => {
        const client = makeFakeClient({ activeIds: ['mint-hotspot'], connectionIds: ['mint-hotspot'] });
        ext.setState({ client });
        mocks().queueSubprocess({ ok: true, out: 'MonSSID\nsecret-psk\n' });
        ext.refresh();
        setImmediate(() => {
            expect(mocks().registry.subprocessCalls[0]).toEqual([
                'nmcli', '-e', 'no', '-s', '-g',
                '802-11-wireless.ssid,802-11-wireless-security.psk',
                'con', 'show', 'mint-hotspot',
            ]);
            expect(info.label.text).toBe('SSID : MonSSID — Modifier…');
            expect(info.actor.visible).toBe(true);
            expect(ext.state.current).toEqual(['MonSSID', 'secret-psk']);
            done();
        });
    });

    test('nmcli échoue → info reste masquée', (done) => {
        const client = makeFakeClient({ activeIds: ['mint-hotspot'], connectionIds: ['mint-hotspot'] });
        ext.setState({ client });
        mocks().queueSubprocess({ ok: false, out: '', err: 'fail' });
        ext.refresh();
        setImmediate(() => {
            expect(info.actor.visible).toBe(false);
            done();
        });
    });

    test('psk peut contenir des espaces/ deux-points (pas de trim)', (done) => {
        const client = makeFakeClient({ activeIds: ['mint-hotspot'], connectionIds: ['mint-hotspot'] });
        ext.setState({ client });
        mocks().queueSubprocess({ ok: true, out: 'SSID:1\nmot de passe final \n' });
        ext.refresh();
        setImmediate(() => {
            expect(ext.state.current).toEqual(['SSID:1', 'mot de passe final ']);
            done();
        });
    });
});
