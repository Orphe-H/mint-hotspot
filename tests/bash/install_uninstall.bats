#!/usr/bin/env bats
# install.sh / uninstall.sh : installation et désinstallation.

load test_helper

setup() {
    common_setup
    mkdir -p "$SYSFS/wlo1/phy80211"
    echo phy0 >"$SYSFS/wlo1/phy80211/name"
    cat >"$BEHAVIORS/iw" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = dev ] && [ -z "${2:-}" ]; then
    printf 'phy#0\n\tInterface wlo1\n\t\ttype managed\n'
elif [ "$1" = phy ] && [ "$3" = info ]; then
    printf 'valid interface combinations:\n\t * #{ managed } <= 1, #{ AP } <= 1, total <= 2\n'
fi
EOF
    chmod +x "$BEHAVIORS/iw"

    # sudo : journalise puis exécute la commande réelle, en retirant -o/-g (pas de root en test).
    cat >"$BEHAVIORS/sudo" <<'EOF'
#!/usr/bin/env bash
printf 'sudo' >>"$CALLS"
printf ' %q' "$@" >>"$CALLS"
printf '\n' >>"$CALLS"
args=()
while [ "$#" -gt 0 ]; do
    case "$1" in
    -o | -g) shift 2 ;;
    *) args+=("$1"); shift ;;
    esac
done
exec "${args[@]}"
EOF
    chmod +x "$BEHAVIORS/sudo"

    # gsettings get → liste avec l'UUID ; set → ok.
    cat >"$BEHAVIORS/gsettings" <<'EOF'
#!/usr/bin/env bash
printf 'gsettings' >>"$CALLS"
printf ' %q' "$@" >>"$CALLS"
printf '\n' >>"$CALLS"
if [ "$1" = get ]; then
    printf "@as ['mint-hotspot@bobby', 'other@ext']\n"
fi
exit 0
EOF
    chmod +x "$BEHAVIORS/gsettings"

    # Redirige les destinations racine vers le tmp et pointe ./mint-hotspot vers le vrai script.
    sed 's|/usr/local/libexec|'"$TEST_TMP"'/libexec|g; s|/usr/share/polkit-1/actions|'"$TEST_TMP"'/polkit|g; s|\./mint-hotspot |'"$SCRIPT"' |g' \
        "$INSTALL_SH" >"$TEST_TMP/install.sh"
    sed 's|/usr/local/libexec|'"$TEST_TMP"'/libexec|g; s|/usr/share/polkit-1/actions|'"$TEST_TMP"'/polkit|g' \
        "$UNINSTALL_SH" >"$TEST_TMP/uninstall.sh"
    chmod +x "$TEST_TMP/install.sh" "$TEST_TMP/uninstall.sh"
    # install.sh fait cd vers son répertoire puis installe ./mint-hotspot (relatif).
    ln -sfn "$SCRIPT" "$TEST_TMP/mint-hotspot"
    ln -sfn "$REPO_ROOT/net.minthotspot.policy" "$TEST_TMP/net.minthotspot.policy"
    mkdir -p "$TEST_TMP/polkit" "$TEST_TMP/libexec"
}

@test "install.sh : vérifie la carte puis installe helper + polkit + lien extension" {
    run "$TEST_TMP/install.sh"
    assert_success
    [ -x "$TEST_TMP/libexec/mint-hotspot" ]
    [ -f "$TEST_TMP/polkit/net.minthotspot.policy" ]
    [ -L "$HOME/.local/share/cinnamon/extensions/mint-hotspot@bobby" ]
    call_matches sudo "install"
}

@test "install.sh : s'arrête si la carte n'est pas compatible" {
    cat >"$BEHAVIORS/iw" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
    chmod +x "$BEHAVIORS/iw"
    run "$TEST_TMP/install.sh"
    assert_failure
    [ ! -x "$TEST_TMP/libexec/mint-hotspot" ]
}

@test "uninstall.sh : retire l'UUID du enabled-extensions (gsettings set)" {
    run "$TEST_TMP/uninstall.sh"
    assert_success
    call_matches gsettings "set"
    # La liste set contient other@ext (conservé) et pas mint-hotspot.
    grep '^gsettings set' "$CALLS" | grep -F 'other@ext'
    ! grep '^gsettings set' "$CALLS" | grep -F 'mint-hotspot@bobby'
}

@test "uninstall.sh : appelle nmcli con delete" {
    run "$TEST_TMP/uninstall.sh"
    assert_success
    call_matches nmcli "con delete mint-hotspot"
}

@test "uninstall.sh : supprime le lien extension et le helper" {
    mkdir -p "$TEST_TMP/libexec"
    printf '#!/bin/bash\nexit 0\n' >"$TEST_TMP/libexec/mint-hotspot"
    chmod +x "$TEST_TMP/libexec/mint-hotspot"
    mkdir -p "$HOME/.local/share/cinnamon/extensions"
    ln -s /nonexistent "$HOME/.local/share/cinnamon/extensions/mint-hotspot@bobby"
    run "$TEST_TMP/uninstall.sh"
    assert_success
    [ ! -e "$HOME/.local/share/cinnamon/extensions/mint-hotspot@bobby" ]
    [ ! -f "$TEST_TMP/libexec/mint-hotspot" ]
    call_matches sudo "down" # helper down via sudo
}
