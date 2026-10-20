// Injecte un interrupteur « Point d'accès » dans le menu de l'applet réseau (network@cinnamon.org).
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const AppletManager = imports.ui.appletManager;
const Dialog = imports.ui.dialog;
const ModalDialog = imports.ui.modalDialog;
const CinnamonEntry = imports.ui.cinnamonEntry;

const CON = 'mint-hotspot';
const AP = 'ap0';
const HELPER = '/usr/local/libexec/mint-hotspot';

let applet = null, client = null, clientSignals = [], timerId = 0, items = [], toggle = null, info = null;
let devices = null, devDialog = null, devTimer = 0, menuSignal = 0;
let current = [], dialog = null, userAction = false;

function run(argv, callback) {
    let proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    proc.communicate_utf8_async(null, null, (p, res) => {
        let [, out, err] = p.communicate_utf8_finish(res);
        callback(p.get_successful(), out, err);
    });
}

function helper(arg) {
    run(['pkexec', HELPER, arg], (ok, out, err) => {
        if (!ok) Main.notifyError("Point d'accès", err.trim());
        userAction = false; // action terminée : une future extinction est automatique
        refresh();
    });
}

function refresh() {
    if (!toggle) return;
    let on = client.get_active_connections().some(c => c.get_id() === CON);
    toggle.setToggleState(on);
    info.actor.hide();
    refreshDevices(on);
    if (!client.get_connection_by_id(CON)) return; // créée au premier allumage
    // -e no : sans ça « : » et « \ » sont échappés ; pas de trim(), un mot de passe peut finir par un espace.
    run(['nmcli', '-e', 'no', '-s', '-g', '802-11-wireless.ssid,802-11-wireless-security.psk', 'con', 'show', CON], (ok, out) => {
        if (!ok || !info) return;
        current = out.replace(/\n$/, '').split('\n');
        info.label.text = `SSID : ${current[0]} — Modifier…`;
        info.actor.show();
    });
}

function closeDialog() {
    if (dialog) dialog.close();
    dialog = null;
}

function edit() {
    let [ssid = '', psk = ''] = current;
    let d = dialog = new ModalDialog.ModalDialog({ styleClass: 'prompt-dialog' });

    let content = new Dialog.MessageDialogContent({ title: "Point d'accès" });
    let params = { style_class: 'prompt-dialog-password-entry', can_focus: true, x_align: Clutter.ActorAlign.CENTER };
    let ssidEntry = new St.Entry({ ...params, hint_text: 'SSID', text: ssid });
    let pskEntry = new St.PasswordEntry({ ...params, hint_text: 'Mot de passe', text: psk });
    let error = new St.Label({ style_class: 'prompt-dialog-error-label' });
    error.clutter_text.line_wrap = true;
    [ssidEntry, pskEntry].forEach(e => CinnamonEntry.addContextMenu(e));
    [ssidEntry, pskEntry, error].forEach(a => content.add_child(a));
    d.contentLayout.add_child(content);

    // NM valide lui-même (SSID 1-32 octets, mot de passe 8-63 caractères) : on affiche son refus sans fermer.
    // ponytail: le mot de passe passe un instant dans argv (visible par ps) ; libnm commit_changes_async si multi-utilisateur.
    let save = () => {
        run(['nmcli', 'con', 'modify', CON, '802-11-wireless.ssid', ssidEntry.text, 'wifi-sec.psk', pskEntry.text], (ok, out, err) => {
            if (dialog !== d) return; // fermée ou extension désactivée entre-temps
            if (!ok) { error.text = err.trim(); return; }
            closeDialog();
            if (toggle.state) { // relance la connexion pour appliquer
                userAction = true;
                helper('up');
            } else refresh();
        });
    };
    [ssidEntry, pskEntry].forEach(e => e.clutter_text.connect('activate', save));
    d.setButtons([
        { label: 'Annuler', action: closeDialog, key: Clutter.KEY_Escape },
        { label: 'Enregistrer', action: save, default: true },
    ]);
    d.setInitialKeyFocus(ssidEntry);
    d.open();
}

// Durée lisible à partir du « connected time » de iw, donné en secondes par list -j.
function fmtDur(s) {
    s = Math.max(0, Math.floor(Number(s) || 0));
    if (s >= 3600) return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
    if (s >= 60) return `${Math.floor(s / 60)}m`;
    return `${s}s`;
}

// Colonnes alignées en monospace, comme la sortie de « mint-hotspot list ».
function devicesText(list) {
    if (!list.length) return 'Aucun appareil connecté.';
    const pad = (s, n) => s.padEnd(n);
    const lines = [pad('Nom', 25) + pad('IP', 16) + pad('Durée', 9) + pad('MAC', 18) + 'Fabricant'];
    list.forEach(d => lines.push(
        pad((d.hostname || '-').slice(0, 24), 25) + pad(d.ip || '-', 16) + pad(fmtDur(d.seconds), 9) +
        pad(d.mac || '-', 18) + (d.vendor || '-').slice(0, 28)));
    return lines.join('\n');
}

// Les bails DHCP (nom d'hôte) sont racine-only : list passe par pkexec, autorisé sans mot de passe
// par la règle polkit pour la session active.
function listDevices(callback) {
    run(['pkexec', HELPER, 'list', '-j'], (ok, out, err) => {
        if (!ok) return callback(false, null, (err || '').trim());
        try { callback(true, JSON.parse(out), ''); } catch (e) { callback(false, null, 'Réponse illisible'); }
    });
}

// Intitulé avec le compteur, masqué quand le point d'accès est éteint.
function refreshDevices(on) {
    if (!devices) return;
    devices.label.text = 'Appareils connectés';
    if (!on) { devices.actor.hide(); return; }
    devices.actor.show();
    listDevices((ok, list) => {
        if (!ok || !devices || !devices.actor.visible) return;
        devices.label.text = `Appareils connectés (${list.length})`;
    });
}

function closeDevices() {
    let d = devDialog;
    devDialog = null;
    if (devTimer) { GLib.source_remove(devTimer); devTimer = 0; }
    if (d) d.close();
}

// Boîte de dialogue : liste rafraîchie toutes les 5 s tant qu'elle est ouverte.
// Deux règles du thème rognent le tableau : .prompt-dialog impose width: 26em et
// .dialog .dialog-content-box max-width: 28em. On retire donc la classe prompt-dialog à la
// construction et celle du content box : le dialogue prend la largeur naturelle du tableau
// (re-centré à chaque réallocation par le BinLayout du dialogue).
function openDevices() {
    if (devDialog) return;
    let d = devDialog = new ModalDialog.ModalDialog();
    d.contentLayout.remove_style_class_name('dialog-content-box');
    d.contentLayout.set_style('margin-top: 8px; margin-bottom: 16px;'); // marges perdues avec la classe
    let content = new Dialog.MessageDialogContent({ title: "Appareils connectés" });
    let label = new St.Label({ text: 'Chargement…', style: 'font-family: monospace;' });
    label.clutter_text.line_wrap = false;
    label.clutter_text.selectable = true; // sélection à la souris, comme du texte
    label.reactive = true;
    label.can_focus = true;
    content.add_child(label);
    d.contentLayout.add_child(content);
    d.setButtons([{ label: 'Fermer', action: closeDevices, key: Clutter.KEY_Escape }]);
    d.setInitialKeyFocus(label); // sans focus, Clutter vide la sélection au moindre clic à côté
    CinnamonEntry.addContextMenu(label); // clic droit → « Copier » (déjà utilisé par la boîte SSID)
    if (label._menu && label._menu._pasteItem) label._menu._pasteItem.actor.hide(); // non éditable
    d.connect('closed', () => {
        if (devTimer) { GLib.source_remove(devTimer); devTimer = 0; }
        if (devDialog === d) devDialog = null;
    });
    let load = () => listDevices((ok, list, err) => {
        if (devDialog !== d) return; // fermée ou extension désactivée entre-temps
        label.text = ok ? devicesText(list) : (err || 'Lecture de la liste impossible');
    });
    load();
    if (!d.open()) { // un autre dialogue modal est déjà ouvert : on ne reste pas bloqué
        closeDevices();
        return;
    }
    devTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => { load(); return GLib.SOURCE_CONTINUE; });
}

// L'applet affiche ap0 comme une deuxième carte WiFi (interrupteur + réseaux), ce qui permet de couper le point
// d'accès ou de connecter ap0 à un réseau : on la retire avec son propre _deviceRemoved, qui remet _delegate à null.
function hideAp(c, device) {
    if (device && device.get_iface() === AP && device._delegate) applet._deviceRemoved(c, device);
}

// Extinction automatique (daemon veille) vs manuelle : l'interrupteur est encore à l'ancien état à ce stade.
function activeRemoved(c, activeConn) {
    if (activeConn.get_id() === CON && toggle.state && !userAction)
        Main.notify("Point d'accès", "Éteint automatiquement : aucun appareil connecté");
    userAction = false;
    refresh();
}

// Applets et extensions sont chargés en parallèle : on réessaie jusqu'à ce que l'applet ait construit son menu,
// ce qu'il fait d'un bloc dès qu'il a son client NM.
function attach() {
    applet = AppletManager.getRunningInstancesForUuid('network@cinnamon.org')[0];
    if (!applet || !applet._client) return GLib.SOURCE_CONTINUE;
    timerId = 0;

    client = applet._client;
    toggle = new PopupMenu.PopupSwitchMenuItem("Point d'accès", false);
    info = new PopupMenu.PopupMenuItem('');
    devices = new PopupMenu.PopupMenuItem('Appareils connectés');
    items = [toggle, info, devices, new PopupMenu.PopupSeparatorMenuItem()];
    let pos = applet.menu.numMenuItems - 2; // avant « Paramètres réseau » et « Connexions réseau »
    items.forEach((item, i) => applet.menu.addMenuItem(item, pos + i));

    toggle.connect('toggled', (item, state) => {
        userAction = true;
        helper(state ? 'up' : 'down');
    });
    info.connect('activate', edit);
    devices.connect('activate', openDevices);
    clientSignals = [
        client.connect('active-connection-added', refresh),
        client.connect('active-connection-removed', activeRemoved),
    ];
    clientSignals.push(client.connect('device-added', hideAp)); // connecté après l'applet, donc appelé après lui
    // Le compteur n'est juste qu'au moment de l'allumage (0 appareil) : on le recalcule
    // à chaque ouverture du menu Réseau, quand il devient visible.
    menuSignal = applet.menu.connect('open-state-changed', (menu, open) => {
        if (open) refreshDevices(toggle.state);
    });
    hideAp(client, client.get_device_by_iface(AP));
    refresh();
    return GLib.SOURCE_REMOVE;
}

function init(metadata) {}

function enable() {
    timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, attach);
}

function disable() {
    if (timerId) GLib.source_remove(timerId);
    timerId = 0;
    closeDialog();
    closeDevices();
    clientSignals.forEach(id => client.disconnect(id));
    clientSignals = [];
    if (menuSignal && applet) applet.menu.disconnect(menuSignal);
    menuSignal = 0;
    applet = client = null;
    items.forEach(item => item.destroy());
    items = [];
    toggle = info = devices = null;
    devDialog = null;
    current = [];
    userAction = false;
}

// Export conditionnel : `module` est indéfini sous GJS, présent sous Node/Jest.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        CON, AP, HELPER,
        fmtDur, devicesText,
        run, helper, refresh, edit,
        listDevices, refreshDevices, openDevices, closeDevices, closeDialog,
        hideAp, activeRemoved, attach, init, enable, disable,
        get state() {
            return {
                applet, client, clientSignals, timerId, items, toggle, info,
                devices, devDialog, devTimer, menuSignal, current, dialog, userAction,
            };
        },
        setState(patch) {
            if ('applet' in patch) applet = patch.applet;
            if ('client' in patch) client = patch.client;
            if ('clientSignals' in patch) clientSignals = patch.clientSignals;
            if ('timerId' in patch) timerId = patch.timerId;
            if ('items' in patch) items = patch.items;
            if ('toggle' in patch) toggle = patch.toggle;
            if ('info' in patch) info = patch.info;
            if ('devices' in patch) devices = patch.devices;
            if ('devDialog' in patch) devDialog = patch.devDialog;
            if ('devTimer' in patch) devTimer = patch.devTimer;
            if ('menuSignal' in patch) menuSignal = patch.menuSignal;
            if ('current' in patch) current = patch.current;
            if ('dialog' in patch) dialog = patch.dialog;
            if ('userAction' in patch) userAction = patch.userAction;
        },
    };
}
