/**
 * listDevices / refreshDevices / openDevices / closeDevices : dialogue des appareils connectés.
 */

'use strict';

const { loadExtension, mocks } = require('./load-extension');

describe('listDevices', () => {
    let ext;

    beforeEach(() => {
        mocks().resetRegistry();
        ext = loadExtension();
    });

    test('JSON valide → callback(true, tableau)', (done) => {
        mocks().queueSubprocess({ ok: true, out: '[{"ip":"1.2.3.4"}]\n', err: '' });
        ext.listDevices((ok, list, err) => {
            expect(ok).toBe(true);
            expect(list).toEqual([{ ip: '1.2.3.4' }]);
            expect(err).toBe('');
            done();
        });
        expect(mocks().registry.subprocessCalls[0]).toEqual([
            'pkexec', '/usr/local/libexec/mint-hotspot', 'list', '-j',
        ]);
    });

    test('pkexec échoue → callback(false, null, stderr trimé)', (done) => {
        mocks().queueSubprocess({ ok: false, out: '', err: '  pas root  \n' });
        ext.listDevices((ok, list, err) => {
            expect(ok).toBe(false);
            expect(list).toBeNull();
            expect(err).toBe('pas root');
            done();
        });
    });

    test('JSON illisible → callback(false, null, "Réponse illisible")', (done) => {
        mocks().queueSubprocess({ ok: true, out: 'pas du json{', err: '' });
        ext.listDevices((ok, list, err) => {
            expect(ok).toBe(false);
            expect(err).toBe('Réponse illisible');
            done();
        });
    });
});

describe('refreshDevices', () => {
    let ext;
    let devices;

    beforeEach(() => {
        mocks().resetRegistry();
        ext = loadExtension();
        const { makeMenuItemBase } = mocks();
        devices = makeMenuItemBase('Appareils connectés');
        ext.setState({ devices });
    });

    test('AP éteint → item masqué, pas d\'appel', () => {
        ext.refreshDevices(false);
        expect(devices.actor.visible).toBe(false);
        expect(mocks().registry.subprocessCalls).toHaveLength(0);
    });

    test('AP actif → compteur mis à jour avec la longueur de la liste', (done) => {
        mocks().queueSubprocess({ ok: true, out: '[{"ip":"a"},{"ip":"b"},{"ip":"c"}]', err: '' });
        ext.refreshDevices(true);
        setImmediate(() => {
            expect(devices.label.text).toBe('Appareils connectés (3)');
            expect(devices.actor.visible).toBe(true);
            done();
        });
    });

    test('échec → label inchangé (défaut)', (done) => {
        mocks().queueSubprocess({ ok: false, out: '', err: 'fail' });
        ext.refreshDevices(true);
        setImmediate(() => {
            expect(devices.label.text).toBe('Appareils connectés');
            done();
        });
    });

    test('devices null → no-op', () => {
        ext.setState({ devices: null });
        ext.refreshDevices(true); // ne doit pas throw
    });
});

describe('openDevices / closeDevices', () => {
    let ext;
    let devices;

    beforeEach(() => {
        mocks().resetRegistry();
        ext = loadExtension();
        const { makeMenuItemBase } = mocks();
        devices = makeMenuItemBase('Appareils connectés');
        ext.setState({ devices, toggle: { state: true } });
    });

    test('ouvre un dialogue avec la liste et un timer 5 s', (done) => {
        mocks().queueSubprocess({ ok: true, out: '[{"ip":"1.2.3.4","mac":"aa","seconds":65,"hostname":"h","vendor":"v"}]', err: '' });
        ext.openDevices();
        const d = ext.state.devDialog;
        expect(d).toBeTruthy();
        setImmediate(() => {
            const label = d.contentLayout._children[0].children[0];
            expect(label.text).toContain('1.2.3.4');
            expect(label.text).toContain('h');
            expect(label.text).toContain('1m');
            // Un timer planifié (le refresh 5 s).
            expect(mocks().registry.timers.size).toBe(1);
            done();
        });
    });

    test('déjà ouvert → pas de second dialogue', () => {
        mocks().queueSubprocess({ ok: true, out: '[]', err: '' });
        ext.openDevices();
        const first = ext.state.devDialog;
        ext.openDevices();
        expect(ext.state.devDialog).toBe(first);
    });

    test('closeDevices ferme et retire le timer', (done) => {
        mocks().queueSubprocess({ ok: true, out: '[]', err: '' });
        ext.openDevices();
        setImmediate(() => {
            ext.closeDevices();
            expect(ext.state.devDialog).toBeNull();
            expect(mocks().registry.timers.size).toBe(0);
            done();
        });
    });

    test('tick du timer → recharge la liste', (done) => {
        mocks().queueSubprocess({ ok: true, out: '[]', err: '' });
        ext.openDevices();
        setImmediate(() => {
            // Deuxième réponse pour le tick.
            mocks().queueSubprocess({ ok: true, out: '[{"ip":"9.9.9.9"}]', err: '' });
            mocks().fireTimers(1);
            const d = ext.state.devDialog;
            const label = d.contentLayout._children[0].children[0];
            expect(label.text).toContain('9.9.9.9');
            // SOURCE_CONTINUE → timer toujours présent.
            expect(mocks().registry.timers.size).toBe(1);
            done();
        });
    });

    test('fermeture via le bouton Fermer → closed nettoie devTimer', (done) => {
        mocks().queueSubprocess({ ok: true, out: '[]', err: '' });
        ext.openDevices();
        setImmediate(() => {
            const d = ext.state.devDialog;
            const fermer = d._buttons.find((b) => b.label === 'Fermer');
            fermer.action();
            expect(ext.state.devDialog).toBeNull();
            expect(mocks().registry.timers.size).toBe(0);
            done();
        });
    });

    test('dialogue échec d\'ouverture (autre modal) → nettoyage', () => {
        mocks().queueSubprocess({ ok: true, out: '[]', err: '' });
        mocks().registry.failNextModalOpen = true;
        ext.openDevices();
        expect(ext.state.devDialog).toBeNull();
        expect(ext.state.devTimer).toBe(0);
    });

    test('liste en erreur → message d\'erreur dans le label', (done) => {
        mocks().queueSubprocess({ ok: false, out: '', err: 'interdit' });
        ext.openDevices();
        setImmediate(() => {
            const label = ext.state.devDialog.contentLayout._children[0].children[0];
            expect(label.text).toBe('interdit');
            done();
        });
    });
});
