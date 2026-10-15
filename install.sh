#!/bin/bash
set -e
cd "$(dirname "$0")"

# Copie appartenant à root : un lien vers un fichier modifiable par l'utilisateur ouvrirait une élévation de privilèges.
sudo install -D -o root -g root -m 755 mint-hotspot /usr/local/libexec/mint-hotspot
sudo install -m 644 net.minthotspot.policy /usr/share/polkit-1/actions/

# Lien pour que les modifications de l'extension soient prises en compte directement.
mkdir -p ~/.local/share/cinnamon/extensions
ln -sfn "$PWD/mint-hotspot@bobby" ~/.local/share/cinnamon/extensions/

echo "Activez l'extension dans Paramètres système > Extensions."
