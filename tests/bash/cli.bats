#!/usr/bin/env bats
# Dispatcher CLI : up|down|check|list, argument inconnu → usage + exit 2.

load test_helper

setup() {
    common_setup
    mkdir -p "$SYSFS/wlo1/phy80211"
    echo phy0 >"$SYSFS/wlo1/phy80211/name"
    echo "aa:bb:cc:11:22:33" >"$SYSFS/wlo1/address"
    cat >"$BEHAVIORS/iw" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = dev ] && [ -z "${2:-}" ]; then
    printf 'phy#0\n\tInterface wlo1\n\t\ttype managed\n'
elif [ "$1" = phy ] && [ "$3" = info ]; then
    printf 'valid interface combinations:\n\t * #{ managed } <= 1, #{ AP } <= 1, total <= 2\n'
elif [ "$1" = dev ] && [ "$2" = wlo1 ] && [ "$3" = info ]; then
    printf 'Interface wlo1\n\tchannel 6 (2437 MHz)\n'
elif [ "$1" = dev ] && [ "$2" = ap0 ] && [ "$3" = info ]; then
    [ -f "$TEST_TMP/ap0.exists" ] && exit 0
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
if [ "$1" = con ] && [ "$2" = show ]; then exit 10; fi
if [ "$1" = con ] && [ "$2" = add ]; then touch "$TEST_TMP/nm.con"; exit 0; fi
exit 0
EOF
    chmod +x "$BEHAVIORS/nmcli"
    printf '#!/usr/bin/env bash\necho testhost\n' >"$BEHAVIORS/hostname"
    chmod +x "$BEHAVIORS/hostname"
}

@test "aucun argument → usage sur stderr, exit 2" {
    run "$SCRIPT"
    assert_failure
    assert [ "${status}" -eq 2 ]
    assert_output --partial "usage:"
}

@test "argument inconnu (foo) → usage, exit 2" {
    run "$SCRIPT" foo
    assert_failure
    assert [ "${status}" -eq 2 ]
    assert_output --partial "up|down|check|list"
}

@test "check → OK quand la carte est compatible" {
    run "$SCRIPT" check
    assert_success
    assert_output --partial "OK : la carte WiFi wlo1 peut partager sa connexion"
}

@test "list sans argument → tableau (ou message AP éteint)" {
    run "$SCRIPT" list
    assert_success
}

@test "list -j → JSON" {
    run "$SCRIPT" list -j
    assert_success
    [[ "$output" =~ ^\[.*\]$ || "$output" == "[]" ]]
}

@test "up → exit 0 en cas de succès" {
    run "$SCRIPT" up
    assert_success
}

@test "down → exit 0" {
    run "$SCRIPT" down
    assert_success
}
