#!/usr/bin/env bats
# oui_name : fabricant à partir du préfixe OUI (base IEEE locale, CRLF).

load test_helper

setup() {
    common_setup
    source_script
    # Base OUI factice au format IEEE réel : préfixe avec tirets, "(hex)", fabricant, CRLF.
    printf 'AA-BB-CC\t(hex)\t\tApple, Inc.\r\n' >"$MINT_HOTSPOT_OUI_DB"
    printf 'D4-35-1D\t(hex)\t\tTechnicolor CH USA\r\n' >>"$MINT_HOTSPOT_OUI_DB"
    printf '00-11-22\t(hex)\t\tFoo Bar Ltd\r\n' >>"$MINT_HOTSPOT_OUI_DB"
}

@test "oui_name : MAC en minuscules avec deux-points → fabricant" {
    run oui_name "aa:bb:cc:11:22:33"
    assert_output "Apple, Inc."
}

@test "oui_name : MAC en majuscules → même fabricant" {
    run oui_name "AA:BB:CC:11:22:33"
    assert_output "Apple, Inc."
}

@test "oui_name : préfixe inconnu → sortie vide" {
    run oui_name "99:99:88:77:66:55"
    assert_output ""
}

@test "oui_name : base absente → sortie vide" {
    export MINT_HOTSPOT_OUI_DB="$BATS_TEST_TMPDIR/inexistante.txt"
    source_script
    run oui_name "aa:bb:cc:11:22:33"
    assert_output "" # awk échoue silencieusement (stderr nul) ; le script ignore le statut
}

@test "oui_name : fabricant sur plusieurs mots préservé" {
    run oui_name "d4:35:1d:aa:bb:cc"
    assert_output "Technicolor CH USA"
}

@test "oui_name : le \\r CRLF n'apparaît pas dans la sortie" {
    run oui_name "00:11:22:33:44:55"
    assert_output "Foo Bar Ltd"
    [[ "$output" != *$'\r'* ]]
}
