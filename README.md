# mint-hotspot

Point d'accès WiFi pour Linux Mint (Cinnamon) **sans couper la connexion WiFi en cours** : le partage passe par une interface virtuelle `ap0` créée sur la même carte.

Une extension Cinnamon ajoute au menu Réseau :

- un interrupteur « Point d'accès » ;
- une ligne `SSID : … — Modifier…` qui ouvre une boîte de dialogue pour changer le SSID et le mot de passe (masqué, icône œil pour l'afficher).

## Prérequis

- Linux Mint Cinnamon (testé avec Cinnamon 6.6), NetworkManager, `iw`, polkit (`pkexec`).
- Une carte WiFi capable d'être client et point d'accès en même temps. C'est vérifié automatiquement par `install.sh` (qui s'arrête sinon) et à chaque allumage depuis l'extension. En cas d'échec, Cinnamon affiche une notification. Pour vérifier à la main :

  ```bash
  ./mint-hotspot check
  ```

## Installation

```bash
./install.sh
```

Le script :

- copie `mint-hotspot` dans `/usr/local/libexec/` (propriétaire root) et la règle polkit dans `/usr/share/polkit-1/actions/` (demande `sudo`) ;
- crée un lien de `mint-hotspot@bobby` vers `~/.local/share/cinnamon/extensions/`.

Activez ensuite l'extension dans **Paramètres système > Extensions**.

## Utilisation

- **Allumer / éteindre** : interrupteur « Point d'accès » dans le menu Réseau. Pas de mot de passe demandé pour la session active.
- **Extinction automatique** : le point d'accès s'éteint après 2 minutes sans aucun appareil connecté, avec notification Cinnamon et entrée dans `journalctl -t mint-hotspot` (délai modifiable, voir plus bas).
- **Modifier le SSID ou le mot de passe** : cliquer sur la ligne `SSID : …`. Elle apparaît après le premier allumage, qui crée la connexion. Le mot de passe doit faire 8 à 63 caractères. Si le point d'accès est allumé, il redémarre pour appliquer les changements.

Au premier allumage, le SSID est `<nom-de-la-machine>-hotspot` et le mot de passe est généré aléatoirement.

## Limite de débit

Pour que les appareils connectés ne saturent pas la connexion de l'ordinateur, le débit partagé est plafonné automatiquement :

- plafond de départ : 50 Mbit/s vers les clients et 10 Mbit/s en envoi ;
- une boucle d'arrière-plan mesure la latence de l'ordinateur (`ping` vers `1.1.1.1`) toutes les 2 s : si elle augmente de plus de 50 ms au-dessus du minimum observé, les plafonds sont baissés ; ils remontent progressivement au calme ;
- chaque ajustement est journalisé : `journalctl -t mint-hotspot` (le daemon est identifié par `/run/mint-hotspot-shaper.pid`, le daemon de veille par `/run/mint-hotspot-idle.pid`, leur nom de processus reste celui du script).

Les valeurs par défaut sont codées en tête de `mint-hotspot`, surchargeables par un fichier `/etc/mint-hotspot.conf` (détenu par root, ignoré sinon) :

```bash
DOWN_MAX=50000   # plafond vers les clients, kbit/s
UP_MAX=10000     # plafond d'envoi des clients, kbit/s
DOWN_MIN=1000    # planchers, kbit/s
UP_MIN=1000
PING_TARGET=1.1.1.1
RTT_OFFSET_MS=50
INTERVAL=2       # période de mesure, s
SHAPER=0         # désactive entièrement la limitation
IDLE=0           # désactive l'extinction automatique
IDLE_TIMEOUT=120 # s sans appareil connecté avant extinction
IDLE_INTERVAL=5  # période de sonde des appareils connectés, s
```

En ligne de commande :

```bash
pkexec /usr/local/libexec/mint-hotspot up    # allumer
pkexec /usr/local/libexec/mint-hotspot down  # éteindre
```

## Fonctionnement

- `mint-hotspot` (lancé en root via `pkexec`, n'accepte que `up`, `down` ou `check`) vérifie la carte, crée `ap0` avec une adresse MAC dérivée de la carte, puis active la connexion NetworkManager `mint-hotspot` (mode AP, WPA2, partage IPv4).
- Le point d'accès prend le canal de la connexion WiFi en cours (bande 2,4 GHz). Si la box est en 5 GHz, il utilise le canal 6.
- Tant qu'il est allumé, un shaper `tc` (HTB + fq_codel) plafonne le débit des appareils connectés dans les deux sens, avec réduction automatique selon la latence de l'ordinateur (voir « Limite de débit »). Le trafic de l'ordinateur lui-même n'est jamais limité.
- Un daemon de veille compte les appareils associés (`iw dev ap0 station dump`) ; après `IDLE_TIMEOUT` s sans aucun, il éteint le point d'accès et notifie (journal + Cinnamon).
- L'extension masque `ap0` de la liste des cartes WiFi du menu Réseau, pour qu'on ne la connecte pas par erreur à un réseau.

## Limites

- Le canal est fixé à l'allumage : si la box change de canal, éteindre puis rallumer le point d'accès.
- Le plafonnement s'effectue au niveau IP : un appareil au WiFi très lent peut malgré tout occuper plus d'airtime que sa part de débit.
- Lors d'une modification, le mot de passe est passé à `nmcli` en argument et reste visible un court instant par `ps` pour les autres utilisateurs de la machine.

## Désinstallation

```bash
./uninstall.sh
```

Le script désactive l'extension, éteint le point d'accès, supprime la connexion NetworkManager `mint-hotspot`, puis retire le lien de l'extension, le script root et la règle polkit (demande `sudo`).

## Licence

[MIT](LICENSE)
