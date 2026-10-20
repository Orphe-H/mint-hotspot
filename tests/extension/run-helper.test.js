/**
 * run / helper : exécution de sous-processus (pkexec, nmcli) et notifications d'erreur.
 */

'use strict';

const { loadExtension, mocks } = require('./load-extension');

describe('run', () => {
    let ext;

    beforeEach(() => {
        mocks().resetRegistry();
        ext = loadExtension();
    });

    test('délègue à Gio.Subprocess et reçoit succès + stdout', (done) => {
        mocks().queueSubprocess({ ok: true, out: 'sortie\n', err: '' });
        ext.run(['nmcli', 'dev', 'status'], (ok, out, err) => {
            expect(ok).toBe(true);
            expect(out).toBe('sortie\n');
            expect(err).toBe('');
            expect(mocks().registry.subprocessCalls[0]).toEqual(['nmcli', 'dev', 'status']);
            done();
        });
    });

    test('échec → ok=false + stderr', (done) => {
        mocks().queueSubprocess({ ok: false, out: '', err: 'boom\n' });
        ext.run(['false'], (ok, out, err) => {
            expect(ok).toBe(false);
            expect(err).toBe('boom\n');
            done();
        });
    });
});

describe('helper', () => {
    let ext;

    beforeEach(() => {
        mocks().resetRegistry();
        ext = loadExtension();
    });

    test('succès → pas de notification, userAction remis à false', (done) => {
        mocks().queueSubprocess({ ok: true, out: '', err: '' }, 'pkexec');
        ext.helper('up');
        // communicate_utf8_async est synchrone dans nos mocks → callback déjà appelé.
        setImmediate(() => {
            expect(mocks().registry.errorNotifications).toHaveLength(0);
            expect(ext.state.userAction).toBe(false);
            done();
        });
    });

    test('échec → Main.notifyError avec le stderr trimé', (done) => {
        mocks().queueSubprocess({ ok: false, out: '', err: '  erreur root  \n' }, 'pkexec');
        ext.helper('down');
        setImmediate(() => {
            expect(mocks().registry.errorNotifications).toEqual([
                { title: "Point d'accès", msg: 'erreur root' },
            ]);
            expect(ext.state.userAction).toBe(false);
            done();
        });
    });

    test('invoque pkexec + HELPER + arg', (done) => {
        mocks().queueSubprocess({ ok: true }, 'pkexec');
        ext.helper('up');
        setImmediate(() => {
            expect(mocks().registry.subprocessCalls[0]).toEqual([
                'pkexec',
                '/usr/local/libexec/mint-hotspot',
                'up',
            ]);
            done();
        });
    });
});
