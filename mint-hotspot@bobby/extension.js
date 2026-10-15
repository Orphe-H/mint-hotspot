// Injecte un interrupteur « Point d'accès » dans le menu de l'applet réseau (network@cinnamon.org).
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const AppletManager = imports.ui.appletManager;

const CON = 'mint-hotspot';
const AP = 'ap0';
const HELPER = '/usr/local/libexec/mint-hotspot';

let applet = null, client = null, clientSignals = [], timerId = 0, items = [], toggle = null, info = null;

function run(argv, callback) {
    let proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    proc.communicate_utf8_async(null, null, (p, res) => {
        let [, out, err] = p.communicate_utf8_finish(res);
        callback(p.get_successful(), out, err);
    });
}

function refresh() {
    if (!toggle) return;
    let on = client.get_active_connections().some(c => c.get_id() === CON);
    toggle.setToggleState(on);
    info.actor.hide();
    if (!on) return;
    run(['nmcli', '-s', '-g', '802-11-wireless.ssid,802-11-wireless-security.psk', 'con', 'show', CON], (ok, out) => {
        if (!ok || !info) return;
        let [ssid, psk] = out.trim().split('\n');
        info.label.text = `SSID : ${ssid} — Mot de passe : ${psk}`;
        info.actor.show();
    });
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
    info = new PopupMenu.PopupMenuItem('', { reactive: false, style_class: 'popup-inactive-menu-item' });
    items = [toggle, info, new PopupMenu.PopupSeparatorMenuItem()];
    let pos = applet.menu.numMenuItems - 2; // avant « Paramètres réseau » et « Connexions réseau »
    items.forEach((item, i) => applet.menu.addMenuItem(item, pos + i));

    toggle.connect('toggled', (item, state) => {
        run(['pkexec', HELPER, state ? 'up' : 'down'], (ok, out, err) => {
            if (!ok) Main.notifyError("Point d'accès", err.trim());
            refresh();
        });
    });
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
    clientSignals.forEach(id => client.disconnect(id));
    clientSignals = [];
    applet = client = null;
    items.forEach(item => item.destroy());
    items = [];
    toggle = info = null;
}
