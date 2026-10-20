#!/usr/bin/env bats
# list / list -j : appareils connectés (iw + bails DHCP + ARP + OUI).

load test_helper

# iw station dump : deux stations ; bails DHCP : IP + noms ; ARP en secours ; OUI factice.
setup() {
    common_setup
    printf 'AA-BB-CC\t(hex)\t\tApple, Inc.\r\n' >"$MINT_HOTSPOT_OUI_DB"
    printf 'D4-35-1D\t(hex)\t\tTechnicolor CH USA\r\n' >>"$MINT_HOTSPOT_OUI_DB"

    cat >"$BEHAVIORS/iw" <<'EOF'
#!/usr/bin/env bash
# iw dev ap0 station dump | iw dev ap0 info
if [ "$1" = dev ] && [ "$3" = station ] && [ "$4" = dump ]; then
    cat <<'ST'
Station aa:bb:cc:11:22:33 (on wlan0)
	inactive time:	10 ms
	rx bytes:	1234
	connected time:	11520
Station d4:35:1d:aa:bb:cc (on wlan0)
	inactive time:	20 ms
	connected time:	2700
ST
elif [ "$1" = dev ] && [ "$3" = info ]; then
    printf 'Interface ap0\n\ttype AP\n'
fi
EOF
    chmod +x "$BEHAVIORS/iw"

    printf '1700000000 aa:bb:cc:11:22:33 192.168.1.10 smartphone *\n' >"$FIXTURES/leases/dnsmasq-test.leases"
    printf '1700000001 d4:35:1d:aa:bb:cc 192.168.1.20 laptop *\n' >>"$FIXTURES/leases/dnsmasq-test.leases"

    cat >"$BEHAVIORS/ip" <<'EOF'
#!/usr/bin/env bash
# ip neigh show dev ap0
printf '192.168.1.10 lladdr aa:bb:cc:11:22:33 REACHABLE\n'
printf '192.168.1.30 lladdr 12:34:56:78:9a:bc STALE\n'
EOF
    chmod +x "$BEHAVIORS/ip"

    source_script
}

@test "list : tableau avec deux appareils, colonnes nom/IP/durée/MAC/fabricant" {
    run list
    assert_success
    assert_output --partial "Nom"
    assert_output --partial "192.168.1.10"
    assert_output --partial "192.168.1.20"
    assert_output --partial "aa:bb:cc:11:22:33"
    assert_output --partial "Apple, Inc."
    assert_output --partial "3h12m" # 11520 s
    assert_output --partial "45m"
}

@test "list : les noms d'hôte viennent des bails DHCP" {
    # Bails avec noms d'hôte réels (le champ '*' signale un bail sans nom).
    printf '1700000000 aa:bb:cc:11:22:33 192.168.1.10 smartphone *\n' >"$FIXTURES/leases/dnsmasq-test.leases"
    printf '1700000001 d4:35:1d:aa:bb:cc 192.168.1.20 * *\n' >>"$FIXTURES/leases/dnsmasq-test.leases"
    run list
    assert_success
    assert_output --partial "smartphone"
}

@test "list : IP manquante dans les bails → repli ARP" {
    # La station d4:35:1d a un bail, la 12:34:56:78:9a:bc non (uniquement ARP).
    cat >"$BEHAVIORS/iw" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = dev ] && [ "$3" = station ] && [ "$4" = dump ]; then
    printf 'Station 12:34:56:78:9a:bc (on wlan0)\n\tconnected time:	60\n'
elif [ "$1" = dev ] && [ "$3" = info ]; then
    printf 'Interface ap0\n\ttype AP\n'
fi
EOF
    chmod +x "$BEHAVIORS/iw"
    run list
    assert_success
    assert_output --partial "192.168.1.30" # IP venue de l'ARP
}

@test "list -j : JSON valide avec les champs attendus" {
    run list -j
    assert_success
    # Un objet par appareil, champs ip/mac/hostname/vendor/seconds.
    [[ "$output" =~ ^\[.*\]$ ]]
    [[ "$output" == *'"ip":"192.168.1.10"'* ]]
    [[ "$output" == *'"mac":"aa:bb:cc:11:22:33"'* ]]
    [[ "$output" == *'"vendor":"Apple, Inc."'* ]]
    [[ "$output" == *'"seconds":11520'* ]]
    # JSON parsable par python3.
    echo "$output" | python3 -c 'import json,sys; json.load(sys.stdin)'
}

@test "list -j : tri par IP (sort -V)" {
    run list -j
    # 192.168.1.10 avant 192.168.1.20
    local i10 i20
    i10=$(echo "$output" | grep -bo '"ip":"192.168.1.10"' | head -1 | cut -d: -f1)
    i20=$(echo "$output" | grep -bo '"ip":"192.168.1.20"' | head -1 | cut -d: -f1)
    [ "$i10" -lt "$i20" ]
}

@test "list : aucune station → message" {
    cat >"$BEHAVIORS/iw" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = dev ] && [ "$3" = station ] && [ "$4" = dump ]; then
    exit 0
elif [ "$1" = dev ] && [ "$3" = info ]; then
    printf 'Interface ap0\n\ttype AP\n'
fi
EOF
    chmod +x "$BEHAVIORS/iw"
    run list
    assert_success
    assert_output "Aucun appareil connecté"
}

@test "list -j : aucune station → tableau JSON vide" {
    cat >"$BEHAVIORS/iw" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = dev ] && [ "$3" = station ] && [ "$4" = dump ]; then
    exit 0
elif [ "$1" = dev ] && [ "$3" = info ]; then
    printf 'Interface ap0\n\ttype AP\n'
fi
EOF
    chmod +x "$BEHAVIORS/iw"
    run list -j
    assert_success
    assert_output "[]"
}

@test "list : AP éteint (iw info échoue aussi) → message + succès" {
    cat >"$BEHAVIORS/iw" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
    chmod +x "$BEHAVIORS/iw"
    run list
    assert_success
    assert_output --partial "Le point d'accès est éteint"
}

@test "list -j : AP éteint → [] JSON" {
    cat >"$BEHAVIORS/iw" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
    chmod +x "$BEHAVIORS/iw"
    run list -j
    assert_success
    assert_output "[]"
}

@test "list : station dump échoue mais ap0 existe → erreur droits" {
    cat >"$BEHAVIORS/iw" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = dev ] && [ "$3" = station ]; then
    exit 1
elif [ "$1" = dev ] && [ "$3" = info ]; then
    printf 'Interface ap0\n\ttype AP\n'
fi
EOF
    chmod +x "$BEHAVIORS/iw"
    run list
    assert_failure
    assert_output --partial "droits insuffisants"
}

@test "list : sans bails lisibles, IP viennent de l'ARP uniquement" {
    rm -f "$FIXTURES/leases/dnsmasq-test.leases"
    run list
    assert_success
    assert_output --partial "192.168.1.10" # IP de l'ARP pour aa:bb:cc
}

@test "list : guillemets dans le nom d'hôte retirés du JSON" {
    cat >"$BEHAVIORS/iw" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = dev ] && [ "$3" = station ] && [ "$4" = dump ]; then
    printf 'Station aa:bb:cc:11:22:33 (on wlan0)\n\tconnected time:	10\n'
elif [ "$1" = dev ] && [ "$3" = info ]; then
    printf 'Interface ap0\n\ttype AP\n'
fi
EOF
    chmod +x "$BEHAVIORS/iw"
    printf '1700000000 aa:bb:cc:11:22:33 192.168.1.10 "evil"host *\n' >"$FIXTURES/leases/dnsmasq-test.leases"
    run list -j
    assert_success
    [[ "$output" != *'"evil"host'* ]]
    echo "$output" | python3 -c 'import json,sys; json.load(sys.stdin)'
}
