/**
 * edit : dialogue SSID/PSK — sauvegarde, validation NM, relance si AP actif.
 */

'use strict';

const { loadExtension, mocks } = require('./load-extension');

describe('edit', () => {
    let ext;
    let toggle;

    beforeEach(() => {
        mocks().resetRegistry();
        ext = loadExtension();
        const { makePopupSwitchMenuItem, makeMenuItemBase, makeActor } = mocks();
        toggle = makePopupSwitchMenuItem("Point d'accès", false);
        // client + éléments de menu minimaux : refresh() est appelé en fin de helper() et de certains saves.
        const client = { get_active_connections: () => [], get_connection_by_id: () => null };
        const info = makeMenuItemBase('');
        ext.setState({ toggle, client, info, devices: null, current: ['AncienSSID', 'ancien-psk'] });
    });

    function getDialog() {
        // edit crée le dialogue et l'ouvre : le dernier ModalDialog créé est dans le registry ?
        // Pas de registry dédié : on récupère via state.dialog.
        return ext.state.dialog;
    }

    function getEntries(dialog) {
        const content = dialog.contentLayout._children[0]; // MessageDialogContent
        // children : [ssidEntry, pskEntry, error]
        return { ssidEntry: content.children[0], pskEntry: content.children[1], error: content.children[2] };
    }

    function clickSave(dialog) {
        const save = dialog._buttons.find((b) => b.label === 'Enregistrer').action;
        save();
    }

    test('les entrées sont pré-remplies avec le SSID et le PSK courants', () => {
        ext.edit();
        const { ssidEntry, pskEntry } = getEntries(getDialog());
        expect(ssidEntry.text).toBe('AncienSSID');
        expect(pskEntry.text).toBe('ancien-psk');
    });

    test('sauvegarde → nmcli con modify avec SSID et PSK', (done) => {
        ext.edit();
        const dialog = getDialog();
        const { ssidEntry, pskEntry } = getEntries(dialog);
        ssidEntry.text = 'NouveauSSID';
        pskEntry.text = 'nouveau-psk';
        mocks().queueSubprocess({ ok: true, out: '', err: '' });
        clickSave(dialog);
        setImmediate(() => {
            expect(mocks().registry.subprocessCalls[0]).toEqual([
                'nmcli', 'con', 'modify', 'mint-hotspot',
                '802-11-wireless.ssid', 'NouveauSSID',
                'wifi-sec.psk', 'nouveau-psk',
            ]);
            done();
        });
    });

    test('succès + AP actif → dialogue fermé et helper("up") relancé', (done) => {
        const client = { get_active_connections: () => [], get_connection_by_id: () => null };
        ext.setState({ toggle, client });
        toggle.state = true;
        ext.edit();
        const dialog = getDialog();
        // Deux réponses : nmcli modify, puis pkexec up.
        mocks().queueSubprocess({ ok: true, out: '', err: '' });
        mocks().queueSubprocess({ ok: true, out: '', err: '' });
        clickSave(dialog);
        setImmediate(() => {
            expect(ext.state.dialog).toBeNull();
            expect(mocks().registry.subprocessCalls[1]).toEqual([
                'pkexec', '/usr/local/libexec/mint-hotspot', 'up',
            ]);
            expect(ext.state.userAction).toBe(false); // helper remet userAction à false en fin de callback
            done();
        });
    });

    test('succès + AP éteint → dialogue fermé, refresh() sans up', (done) => {
        const client = {
            get_active_connections: () => [],
            get_connection_by_id: () => null,
        };
        ext.setState({ toggle, client });
        toggle.state = false;
        ext.edit();
        const dialog = getDialog();
        mocks().queueSubprocess({ ok: true, out: '', err: '' });
        clickSave(dialog);
        setImmediate(() => {
            expect(ext.state.dialog).toBeNull();
            expect(mocks().registry.subprocessCalls).toHaveLength(1); // modify seul
            done();
        });
    });

    test('nmcli refuse (SSID invalide) → erreur affichée, dialogue ouvert', (done) => {
        ext.edit();
        const dialog = getDialog();
        const { error } = getEntries(dialog);
        mocks().queueSubprocess({ ok: false, out: '', err: 'Error: SSID length\n' });
        clickSave(dialog);
        setImmediate(() => {
            expect(error.text).toBe('Error: SSID length');
            expect(ext.state.dialog).toBe(dialog);
            expect(dialog._open).toBe(true);
            done();
        });
    });

    test('dialogue fermé entre-temps → callback ignoré (pas de close() sur un autre)', (done) => {
        ext.edit();
        const dialog = getDialog();
        ext.closeDialog(); // ferme avant le retour nmcli
        mocks().queueSubprocess({ ok: true, out: '', err: '' });
        // La fermeture met dialog=null ; le callback ne doit pas réouvrir ni throw.
        clickSaveAfterClose();
        function clickSaveAfterClose() {
            // Le save captured d referencé dans la closure : on le rappelle via les boutons du dialog d'origine.
            const save = dialog._buttons.find((b) => b.label === 'Enregistrer').action;
            save();
        }
        setImmediate(() => {
            expect(ext.state.dialog).toBeNull();
            done();
        });
    });

    test('activate (Entrée) sur une entrée déclenche save', (done) => {
        ext.edit();
        const dialog = getDialog();
        const { ssidEntry } = getEntries(dialog);
        mocks().queueSubprocess({ ok: true, out: '', err: '' });
        ssidEntry.emit('activate'); // clutter_text connecté sur 'activate' — émis via entry ?
        // Le connect est sur e.clutter_text : on émet sur clutter_text.
        ssidEntry.clutter_text.emit('activate');
        setImmediate(() => {
            expect(mocks().registry.subprocessCalls).toHaveLength(1);
            done();
        });
    });
});
