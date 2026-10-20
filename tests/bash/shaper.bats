#!/usr/bin/env bats
# shaper_start / shaper_loop / shaper_apply / shaper_stop : plafonnement adaptatif.

load test_helper

setup() {
    common_setup
    # Budgets bornés pour que les boucles terminent.
    export MINT_HOTSPOT_SHAPER_MAX_ITER=5
    source_script

    # ping : séquence de RTT pilotée par un fichier (un RTT par ligne, dernier répété).
    export PING_SEQ="$TEST_TMP/ping.seq"
    : >"$PING_SEQ"
    cat >"$BEHAVIORS/ping" <<'EOF'
#!/usr/bin/env bash
f="${PING_SEQ:?}"
n=$(cat "$TEST_TMP/ping.n" 2>/dev/null || echo 0)
line=$(sed -n "$((n + 1))p" "$f" 2>/dev/null)
[ -z "$line" ] && line=$(tail -1 "$f" 2>/dev/null)
echo $((n + 1)) >"$TEST_TMP/ping.n"
[ -n "$line" ] && echo "64 bytes from 1.1.1.1: icmp_seq=1 ttl=57 time=${line} ms"
exit 0
EOF
    chmod +x "$BEHAVIORS/ping"
}

@test "shaper_apply : deux tc class replace (ap0 down, ifb up), quantum 1514" {
    shaper_apply 25000 5000
    call_matches tc "class replace dev ap0 parent 1: classid 1:10 htb rate 25000kbit ceil 25000kbit quantum 1514"
    call_matches tc "class replace dev mhifb parent 1: classid 1:10 htb rate 5000kbit ceil 5000kbit quantum 1514"
}

@test "shaper_start : qdiscs HTB + fq_codel + ingress + mirred ifb" {
    shaper_start
    call_matches tc "qdisc replace dev ap0 root handle 1: htb default 10"
    call_matches tc "qdisc replace dev ap0 parent 1:10 fq_codel"
    call_matches tc "qdisc replace dev ap0 handle ffff: ingress"
    call_matches tc "filter replace dev ap0 parent ffff: protocol all matchall action mirred egress redirect dev mhifb"
    call_matches tc "qdisc replace dev mhifb root handle 1: htb default 10"
    call_matches tc "qdisc replace dev mhifb parent 1:10 fq_codel"
    call_matches ip "link add mhifb type ifb"
}

@test "shaper_start : SHAPER=0 → no-op" {
    SHAPER=0
    shaper_start
    [ "$(call_count)" -eq 0 ]
}

@test "shaper_start : écrit le pidfile du daemon" {
    shaper_start
    [ -f "$MINT_HOTSPOT_PIDFILE" ]
    # Le pid pointé existe encore ou le daemon est sorti (budget) : pas de condition forte.
}

@test "shaper_stop : tue le daemon, supprime qdiscs et ifb" {
    # kill est un builtin : on lance un vrai processus de fond pour que la cible existe.
    tail -f /dev/null &
    echo $! >"$MINT_HOTSPOT_PIDFILE"
    shaper_stop
    call_matches tc "qdisc del dev ap0 root"
    call_matches tc "qdisc del dev ap0 ingress"
    call_matches ip "link del mhifb"
    [ ! -f "$MINT_HOTSPOT_PIDFILE" ]
}

@test "shaper_loop : congestion (RTT > best+offset) → STEP_DOWN appliqué" {
    # RTT de base 10, puis 100 (> 10+50) : 2 baisses (max 5 itérations mais 2 congestionnées visibles).
    printf '10\n100\n100\n' >"$PING_SEQ"
    shaper_loop 50000 10000
    # 50000*75/100 = 37500, puis 37500*75/100 = 28125
    call_matches tc "rate 37500kbit"
    call_matches tc "rate 28125kbit"
    call_matches tc "rate 7500kbit" # up : 10000*75/100
}

@test "shaper_loop : latence calme OK_CYCLES fois → STEP_UP" {
    export OK_CYCLES=2
    printf '10\n10\n10\n10\n' >"$PING_SEQ"
    # down part de DOWN_MAX mais on force bas pour voir la remontée : 10000→11500 (cap DOWN_MAX).
    shaper_loop 10000 8000
    call_matches tc "rate 11500kbit" # 10000*115/100
    call_matches tc "rate 9200kbit"  # 8000*115/100
}

@test "shaper_loop : plafonné au DOWN_MAX/UP_MAX" {
    export OK_CYCLES=1
    printf '10\n10\n' >"$PING_SEQ"
    shaper_loop 48000 9000
    # 48000*115/100=55200 > 50000 → cap 50000 ; 9000*115/100=10350 > 10000 → cap 10000.
    call_matches tc "rate 50000kbit ceil 50000kbit"
    call_matches tc "rate 10000kbit ceil 10000kbit"
}

@test "shaper_loop : congestion au plancher → recalage du best (CONG_CYCLES)" {
    export CONG_CYCLES=2
    export OK_CYCLES=2
    export RTT_OFFSET_MS=10
    SHAPER_MAX_ITER=20
    # RTT 10 (best), puis 200 congestionne au plancher 2 fois → best recalé à 200,
    # ensuite 10 redevenu calme → 2 cycles OK → STEP_UP.
    printf '10\n200\n200\n200\n10\n10\n' >"$PING_SEQ"
    shaper_loop 1000 1000
    call_matches tc "rate 1150kbit" # 1000*115/100 après recalage
}

@test "shaper_loop : ping sans réponse (rtt vide) → aucun ajustement" {
    printf '\n\n\n' >"$PING_SEQ"
    shaper_loop 50000 10000
    [ "$(grep -c 'class replace' "$CALLS")" -eq 0 ]
}

@test "shaper_apply : logger congestion" {
    printf '10\n100\n' >"$PING_SEQ"
    export RTT_OFFSET_MS=10
    shaper_loop 50000 10000
    call_matches logger "congestion"
}
