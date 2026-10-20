#!/usr/bin/env bats
# fmt_dur : durée lisible à partir des secondes (connected time de iw).

load test_helper

setup() {
    common_setup
    source_script
}

@test "fmt_dur : 0 seconde → 0s" {
    run fmt_dur 0
    assert_output "0s"
}

@test "fmt_dur : argument absent → 0s" {
    run fmt_dur
    assert_output "0s"
}

@test "fmt_dur : 9 secondes → 9s" {
    run fmt_dur 9
    assert_output "9s"
}

@test "fmt_dur : 59 secondes → 59s" {
    run fmt_dur 59
    assert_output "59s"
}

@test "fmt_dur : 60 secondes → 1m" {
    run fmt_dur 60
    assert_output "1m"
}

@test "fmt_dur : 45 minutes → 45m" {
    run fmt_dur 2700
    assert_output "45m"
}

@test "fmt_dur : 3599 secondes → 59m" {
    run fmt_dur 3599
    assert_output "59m"
}

@test "fmt_dur : 3600 secondes → 1h00m" {
    run fmt_dur 3600
    assert_output "1h00m"
}

@test "fmt_dur : 3h12m (11520 s) → 3h12m" {
    run fmt_dur 11520
    assert_output "3h12m"
}

@test "fmt_dur : 1h05m (3900 s) → 1h05m (zéro padding)" {
    run fmt_dur 3900
    assert_output "1h05m"
}
