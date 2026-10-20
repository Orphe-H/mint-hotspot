#!/usr/bin/env bats
# check : la carte WiFi accepte-t-elle STA + AP simultanés ?

load test_helper

# iw dev : une interface STA (wlo1). phy info : combinaisons avec managed+AP, total <= 2.
setup_ok() {
    common_setup
    mkdir -p "$SYSFS/wlo1/phy80211"
    echo phy0 >"$SYSFS/wlo1/phy80211/name"
    cat >"$BEHAVIORS/iw" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = dev ] && [ -z "${2:-}" ]; then
    printf 'phy#0\n\tInterface wlo1\n\t\tifindex 3\n\t\ttype managed\n'
elif [ "$1" = phy ] && [ "$3" = info ]; then
    cat <<'PHY'
Wiphy phy0
	max # scan IEs: 104
	Supported interface modes:
		 * managed
		 * AP
	valid interface combinations:
		 * #{ managed } <= 1, #{ AP } <= 1, total <= 2, STA/AP BIOP coexist
PHY
fi
EOF
    chmod +x "$BEHAVIORS/iw"
    source_script
}

setup() { setup_ok; }

@test "check : carte compatible → succès, STA=wlo1" {
    check
    [ "$STA" = "wlo1" ]
}

@test "check : aucune interface WiFi → erreur" {
    cat >"$BEHAVIORS/iw" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
    chmod +x "$BEHAVIORS/iw"
    run check
    assert_failure
    assert_output --partial "Aucune interface WiFi trouvée"
}

@test "check : combinaisons sans AP → échec avec message" {
    cat >"$BEHAVIORS/iw" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = dev ] && [ -z "${2:-}" ]; then
    printf 'phy#0\n\tInterface wlo1\n\t\ttype managed\n'
elif [ "$1" = phy ] && [ "$3" = info ]; then
    cat <<'PHY'
Wiphy phy0
	valid interface combinations:
		 * #{ managed } <= 2, total <= 2
PHY
fi
EOF
    chmod +x "$BEHAVIORS/iw"
    run check
    assert_failure
    assert_output --partial "ne peut pas créer de point d'accès"
}

@test "check : total <= 1 (pas de 2e interface) → échec" {
    cat >"$BEHAVIORS/iw" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = dev ] && [ -z "${2:-}" ]; then
    printf 'phy#0\n\tInterface wlo1\n\t\ttype managed\n'
elif [ "$1" = phy ] && [ "$3" = info ]; then
    cat <<'PHY'
Wiphy phy0
	valid interface combinations:
		 * #{ managed } <= 1, #{ AP } <= 1, total <= 1
PHY
fi
EOF
    chmod +x "$BEHAVIORS/iw"
    run check
    assert_failure
}

@test "check : notify-send appelé hors root en cas d'échec" {
    cat >"$BEHAVIORS/iw" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
    chmod +x "$BEHAVIORS/iw"
    run check
    assert_failure
    call_matches notify-send "-i"
}
