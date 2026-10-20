#!/usr/bin/env bats
# up / down : allumage et extinction du point d'accès.

load test_helper

# Environnement complet : carte compatible, ap0 absent au 1er appel, nmcli ok.
setup() {
    common_setup
    mkdir -p "$SYSFS/wlo1/phy80211"
    echo phy0 >"$SYSFS/wlo1/phy80211/name"
    echo "aa:bb:cc:11:22:33" >"$SYSFS/wlo1/address"

    cat >"$BEHAVIORS/iw" <<'EOF'
#!/usr/bin/env bash
log="$CALLS.iw"
if [ "$1" = dev ] && [ -z "${2:-}" ]; then
    printf 'phy#0\n\tInterface wlo1\n\t\ttype managed\n'
elif [ "$1" = phy ] && [ "$3" = info ]; then
    cat <<'PHY'
Wiphy phy0
	Supported interface modes:
		 * managed
		 * AP
	valid interface combinations:
		 * #{ managed } <= 1, #{ AP } <= 1, total <= 2, STA/AP BIOP coexist
PHY
elif [ "$1" = dev ] && [ "$2" = wlo1 ] && [ "$3" = info ]; then
    printf 'Interface wlo1\n\ttype managed\n\tchannel 6 (2437 MHz)\n'
elif [ "$1" = dev ] && [ "$2" = ap0 ] && [ "$3" = info ]; then
    # Premier appel : ap0 absent (échec) ; ensuite présent (créé).
    if [ -f "$TEST_TMP/ap0.exists" ]; then
        printf 'Interface ap0\n\ttype AP\n'
        exit 0
    fi
    exit 1
elif [ "$1" = dev ] && [ "$2" = wlo1 ] && [ "$3" = interface ] && [ "$4" = add ]; then
    touch "$TEST_TMP/ap0.exists"
    exit 0
elif [ "$1" = dev ] && [ "$3" = station ] && [ "$4" = dump ]; then
    exit 0
fi
EOF
    chmod +x "$BEHAVIORS/iw"

    cat >"$BEHAVIORS/nmcli" <<'EOF'
#!/usr/bin/env bash
# con show mint-hotspot : succès si la connexion existe (fichier marker).
if [ "$1" = con ] && [ "$2" = show ]; then
    [ -f "$TEST_TMP/nm.con" ] && exit 0
    exit 10
fi
# con add : crée la connexion.
if [ "$1" = con ] && [ "$2" = add ]; then
    touch "$TEST_TMP/nm.con"
    exit 0
fi
# con up : succès.
if [ "$1" = con ] && [ "$2" = up ]; then
    exit 0
fi
exit 0
EOF
    chmod +x "$BEHAVIORS/nmcli"

    printf '#!/usr/bin/env bash\necho testhost\n' >"$BEHAVIORS/hostname"
    chmod +x "$BEHAVIORS/hostname"

    # ping : rtt stable bas pour shaper_loop.
    printf '#!/usr/bin/env bash\necho "64 bytes from 1.1.1.1: icmp_seq=1 ttl=57 time=10 ms"\n' >"$BEHAVIORS/ping"
    chmod +x "$BEHAVIORS/ping"
}

@test "up : succès, crée ap0 avec MAC dérivée (XOR 2)" {
    run "$SCRIPT" up
    assert_success
    call_matches iw "interface add ap0"
    # aa^2 = a8
    call_matches iw "addr a8:bb:cc:11:22:33"
}

@test "up : crée la connexion NM avec SSID hostname-hotspot, mode ap, WPA2" {
    run "$SCRIPT" up
    assert_success
    call_matches nmcli "con add"
    call_matches nmcli "testhost-hotspot"
    call_matches nmcli "mode ap"
    call_matches nmcli "wpa-psk"
}

@test "up : applique le canal de la STA (6) via nmcli con modify" {
    run "$SCRIPT" up
    assert_success
    call_matches nmcli "802-11-wireless.channel 6"
}

@test "up : canal hors 1-11 (5 GHz) → repli canal 6" {
    cat >"$BEHAVIORS/iw" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = dev ] && [ -z "${2:-}" ]; then
    printf 'phy#0\n\tInterface wlo1\n\t\ttype managed\n'
elif [ "$1" = phy ] && [ "$3" = info ]; then
    printf 'valid interface combinations:\n\t * #{ managed } <= 1, #{ AP } <= 1, total <= 2\n'
elif [ "$1" = dev ] && [ "$2" = wlo1 ] && [ "$3" = info ]; then
    printf 'Interface wlo1\n\tchannel 44 (5220 MHz)\n'
elif [ "$1" = dev ] && [ "$2" = ap0 ] && [ "$3" = info ]; then
    [ -f "$TEST_TMP/ap0.exists" ] && exit 0
    exit 1
elif [ "$1" = dev ] && [ "$2" = wlo1 ] && [ "$3" = interface ] && [ "$4" = add ]; then
    touch "$TEST_TMP/ap0.exists"
    exit 0
fi
EOF
    chmod +x "$BEHAVIORS/iw"
    run "$SCRIPT" up
    assert_success
    call_matches nmcli "802-11-wireless.channel 6"
}

@test "up : connexion NM déjà existante → pas de con add" {
    touch "$TEST_TMP/nm.con"
    run "$SCRIPT" up
    assert_success
    ! call_matches nmcli "con add"
}

@test "up : nmcli con up échoue 5 fois → suppression ap0 + erreur" {
    cat >"$BEHAVIORS/nmcli" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = con ] && [ "$2" = show ]; then exit 10; fi
if [ "$1" = con ] && [ "$2" = add ]; then touch "$TEST_TMP/nm.con"; exit 0; fi
if [ "$1" = con ] && [ "$2" = up ]; then echo "Error: Connection failed" >&2; exit 10; fi
exit 0
EOF
    chmod +x "$BEHAVIORS/nmcli"
    run "$SCRIPT" up
    assert_failure
    assert_output --partial "Error: Connection failed"
    call_matches iw "dev ap0 del"
}

@test "up : échec check → exit 1 sans nmcli" {
    cat >"$BEHAVIORS/iw" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
    chmod +x "$BEHAVIORS/iw"
    run "$SCRIPT" up
    assert_failure
    ! call_matches nmcli "con add"
}

@test "up : shaper démarré (tc qdisc htb + fq_codel + ifb)" {
    run "$SCRIPT" up
    assert_success
    call_matches tc "qdisc replace dev ap0 root handle 1: htb"
    call_matches tc "qdisc replace dev ap0 parent 1:10 fq_codel"
    call_matches tc "qdisc replace dev ap0 handle ffff: ingress"
    call_matches tc "filter replace dev ap0 parent ffff:"
    call_matches ip "link add mhifb type ifb"
    [ -f "$MINT_HOTSPOT_PIDFILE" ]
}

@test "up : veille démarrée (pidfile idle)" {
    run "$SCRIPT" up
    assert_success
    [ -f "$MINT_HOTSPOT_PIDFILE_IDLE" ]
}

@test "down : shaper stop + nmcli down + iw del" {
    touch "$TEST_TMP/ap0.exists" "$TEST_TMP/nm.con"
    printf '12345\n' >"$MINT_HOTSPOT_PIDFILE"
    printf '12346\n' >"$MINT_HOTSPOT_PIDFILE_IDLE"
    run "$SCRIPT" down
    assert_success
    call_matches tc "qdisc del dev ap0 root"
    call_matches nmcli "con down mint-hotspot"
    call_matches iw "dev ap0 del"
}

@test "down : sans pidfiles, réussi quand même" {
    touch "$TEST_TMP/ap0.exists"
    run "$SCRIPT" down
    assert_success
}
