#!/usr/bin/env bats
# idle_start / idle_loop / idle_stop : extinction automatique sans appareil.

load test_helper

setup() {
    common_setup
    export MINT_HOTSPOT_IDLE_MAX_ITER=5
    source_script

    # Stations pilotées par un fichier : nb de lignes "Station " = nb d'appareils.
    export STATION_FILE="$TEST_TMP/stations.txt"
    : >"$STATION_FILE"
    cat >"$BEHAVIORS/iw" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = dev ] && [ "$3" = station ] && [ "$4" = dump ]; then
    cat "$STATION_FILE"
    exit 0
fi
exit 0
EOF
    chmod +x "$BEHAVIORS/iw"
}

@test "idle_start : IDLE=0 → no-op, pas de pidfile" {
    IDLE=0
    idle_start
    [ ! -f "$MINT_HOTSPOT_PIDFILE_IDLE" ]
}

@test "idle_start : écrit le pidfile du daemon de veille" {
    idle_start
    [ -f "$MINT_HOTSPOT_PIDFILE_IDLE" ]
}

@test "idle_loop : appareil présent → pas d'extinction" {
    printf 'Station aa:bb:cc:11:22:33 (on ap0)\n' >"$STATION_FILE"
    # IDLE_TIMEOUT petit mais date avance de 1 s/itération ; appareil présent reset last.
    run idle_loop
    # Pas d'appel nmcli con down ni iw del (pas d'ap_down).
    ! call_matches nmcli "con down"
    ! call_matches iw "dev ap0 del"
}

@test "idle_loop : aucun appareil pendant IDLE_TIMEOUT → ap_down + exit 0" {
    # date : +1 s par appel ; IDLE_TIMEOUT=4 atteint en ~4 itérations (budget 5).
    IDLE_TIMEOUT=4
    : >"$STATION_FILE"
    run idle_loop
    assert_success
    call_matches nmcli "con down mint-hotspot"
    call_matches iw "dev ap0 del"
    call_matches logger "extinction" # un mot seul : %q échappe les espaces dans le journal
}

@test "idle_loop : appareil qui apparaît remet le compteur à zéro" {
    # Timeout=10. Itération 1 : 1 station → reset. Itérations suivantes : 0 station
    # mais écart < timeout → pas d'extinction (budget atteint avant).
    IDLE_TIMEOUT=10
    cat >"$BEHAVIORS/iw" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = dev ] && [ "$3" = station ] && [ "$4" = dump ]; then
    n=$(cat "$TEST_TMP/iw.n" 2>/dev/null || echo 0)
    echo $((n + 1)) >"$TEST_TMP/iw.n"
    # 1er appel (reset last) : 1 station ; suivants : 0.
    [ "$n" -eq 0 ] && printf 'Station aa:bb:cc:11:22:33 (on ap0)\n'
fi
exit 0
EOF
    chmod +x "$BEHAVIORS/iw"
    run idle_loop
    assert_success
    ! call_matches nmcli "con down"
}

@test "idle_stop : tue le daemon sauf soi-même, supprime le pidfile" {
    tail -f /dev/null &
    echo $! >"$MINT_HOTSPOT_PIDFILE_IDLE"
    idle_stop
    [ ! -f "$MINT_HOTSPOT_PIDFILE_IDLE" ]
}

@test "idle_stop : pidfile absent → no-op" {
    idle_stop
    [ ! -f "$MINT_HOTSPOT_PIDFILE_IDLE" ]
}
