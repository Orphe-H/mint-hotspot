#!/bin/bash
set -e
UUID=mint-hotspot@bobby
HELPER=/usr/local/libexec/mint-hotspot

# Désactiver l'extension d'abord : Cinnamon la décharge et retire ses éléments du menu Réseau.
gsettings set org.cinnamon enabled-extensions "$(gsettings get org.cinnamon enabled-extensions |
    python3 -c "import ast, sys; print([x for x in ast.literal_eval(sys.stdin.read().removeprefix('@as ')) if x != '$UUID'])")"

[ -x "$HELPER" ] && sudo "$HELPER" down
nmcli con delete mint-hotspot >/dev/null 2>&1 || true

rm -f ~/.local/share/cinnamon/extensions/"$UUID"
sudo rm -f "$HELPER" /usr/share/polkit-1/actions/net.minthotspot.policy

echo "Point d'accès désinstallé."
