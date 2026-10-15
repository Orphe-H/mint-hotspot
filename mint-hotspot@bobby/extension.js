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
let current = [], dialog = null;

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
        refresh();
    });
}

function refresh() {
    if (!toggle) return;
    toggle.setToggleState(client.get_active_connections().some(c => c.get_id() === CON));
    info.actor.hide();
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
            if (toggle.state) helper('up'); // relance la connexion pour appliquer
            else refresh();
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

// L'applet affiche ap0 comme une deuxième carte WiFi (interrupteur + réseaux), ce qui permet de couper le point
// d'accès ou de connecter ap0 à un réseau : on la retire avec son propre _deviceRemoved, qui remet _delegate à null.
function hideAp(c, device) {
    if (device && device.get_iface() === AP && device._delegate) applet._deviceRemoved(c, device);
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
    items = [toggle, info, new PopupMenu.PopupSeparatorMenuItem()];
    let pos = applet.menu.numMenuItems - 2; // avant « Paramètres réseau » et « Connexions réseau »
    items.forEach((item, i) => applet.menu.addMenuItem(item, pos + i));

    toggle.connect('toggled', (item, state) => helper(state ? 'up' : 'down'));
    info.connect('activate', edit);
    clientSignals = ['active-connection-added', 'active-connection-removed'].map(s => client.connect(s, refresh));
    clientSignals.push(client.connect('device-added', hideAp)); // connecté après l'applet, donc appelé après lui
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
    clientSignals.forEach(id => client.disconnect(id));
    clientSignals = [];
    applet = client = null;
    items.forEach(item => item.destroy());
    items = [];
    toggle = info = null;
    current = [];
}
