#!/usr/bin/env bash
# Helper commun aux tests Bats : stubs PATH journalisés + fixtures + sourcing du script.
# Seules les commandes à effet de bord (iw, nmcli, tc, ip, ping, …) sont stubbées ;
# les outils de texte (awk, sed, grep, …) restent réels, le script en dépend pour parser.

load '../../node_modules/bats-support/load'
load '../../node_modules/bats-assert/load'

REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
SCRIPT="$REPO_ROOT/mint-hotspot"
INSTALL_SH="$REPO_ROOT/install.sh"
UNINSTALL_SH="$REPO_ROOT/uninstall.sh"

# Génère un stub pour $1 : journalise "cmd args…" dans $CALLS,
# puis exécute le script de comportement $BEHAVIORS/cmd s'il existe (sinon succès silencieux).
stub_gen() {
    local cmd=$1
    cat >"$STUBS_DIR/$cmd" <<EOF
#!/usr/bin/env bash
printf '%s' "$cmd" >>"\$CALLS"
printf ' %q' "\$@" >>"\$CALLS"
printf '\n' >>"\$CALLS"
if [ -x "\$BEHAVIORS/$cmd" ]; then
    exec "\$BEHAVIORS/$cmd" "\$@"
fi
exit 0
EOF
    chmod +x "$STUBS_DIR/$cmd"
}

# Retourne la Nième ligne (1-based) du journal d'appels.
call_line() { sed -n "${1}p" "$CALLS"; }

# Nombre total d'appels journalisés.
call_count() { grep -c '' "$CALLS" 2>/dev/null || true; }

# Vrai si un appel à $1 contenant la sous-chaîne $2 a été journalisé.
call_matches() { grep -F -- "$2" "$CALLS" | grep -q "^$1"; }

# Sourcing du script sous test (fonctions seulement, sans exécution du dispatcher).
source_script() {
    MINT_HOTSPOT_SOURCED=1
    # shellcheck source=/dev/null
    . "$SCRIPT"
}

# Setup commun : à appeler dans le setup() de chaque fichier .bats.
common_setup() {
    TEST_TMP="$BATS_TEST_TMPDIR"
    STUBS_DIR="$TEST_TMP/stubs"
    BEHAVIORS="$TEST_TMP/behaviors"
    FIXTURES="$TEST_TMP/fixtures"
    CALLS="$TEST_TMP/calls.log"
    SYSFS="$TEST_TMP/sysfs"
    HOME_DIR="$TEST_TMP/home"
    mkdir -p "$STUBS_DIR" "$BEHAVIORS" "$FIXTURES" "$SYSFS" "$HOME_DIR"
    : >"$CALLS"
    # Exportés : les stubs sont des sous-processus et doivent lire le journal et les comportements.
    export TEST_TMP="$BATS_TEST_TMPDIR"
    export CALLS BEHAVIORS FIXTURES

    # Stubs des commandes à effet de bord utilisées par le script.
    for cmd in iw nmcli tc ip ping date sleep logger notify-send hostname \
        pkexec sudo gsettings; do
        stub_gen "$cmd"
    done

    # sleep ne dort jamais ; date avance d'une seconde à chaque appel (pour idle_loop).
    printf '#!/usr/bin/env bash\nexit 0\n' >"$BEHAVIORS/sleep"
    cat >"$BEHAVIORS/date" <<'EOF'
#!/usr/bin/env bash
# date +%s : compteur incrémental contrôlable via $DATE_FILE (défaut : now + n).
f="${DATE_FILE:?DATE_FILE doit être défini}"
n=$(cat "$f" 2>/dev/null || echo 0)
echo $((n + 1)) >"$f"
printf '%s\n' $((1000000 + n + 1))
EOF
    chmod +x "$BEHAVIORS/sleep" "$BEHAVIORS/date"
    export DATE_FILE="$TEST_TMP/date.counter"

    # Env de test : paths pointant dans le tmp + budgets d'itérations bornés.
    export PATH="$STUBS_DIR:$PATH"
    export HOME="$HOME_DIR"
    export MINT_HOTSPOT_CONF="$TEST_TMP/mint-hotspot.conf"
    export MINT_HOTSPOT_PIDFILE="$TEST_TMP/shaper.pid"
    export MINT_HOTSPOT_PIDFILE_IDLE="$TEST_TMP/idle.pid"
    export MINT_HOTSPOT_LEASES_GLOB="$FIXTURES/leases/dnsmasq-*.leases"
    export MINT_HOTSPOT_OUI_DB="$FIXTURES/oui.txt"
    export MINT_HOTSPOT_SYSFS_NET="$SYSFS"
    export MINT_HOTSPOT_SHAPER_MAX_ITER=3
    export MINT_HOTSPOT_IDLE_MAX_ITER=3
    : >"$MINT_HOTSPOT_CONF"
    mkdir -p "$FIXTURES/leases"
}

common_teardown() {
    export PATH="${PATH#"$STUBS_DIR:"}"
    unset MINT_HOTSPOT_SOURCED DATE_FILE
}

# Teardown par défaut : les fichiers qui redéfinissent teardown() doivent appeler common_teardown.
teardown() {
    common_teardown
}
