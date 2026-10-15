"""recipes/watch.py on the saved sample pages (offline, no network)."""

import json
import sys
from pathlib import Path

import intern_intel

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "recipes"))
import watch  # noqa: E402

ARGV = ["--offline", "--pages", "2"]


def test_first_run_saves_baseline_then_finds_new(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(intern_intel, "OUT_DIR", tmp_path)
    baseline = tmp_path / "watch" / "software-engineer-intern--san-francisco-ca--p2.json"

    assert watch.run(ARGV) == 0
    assert "First run for this search: saved 77 listings" in capsys.readouterr().out
    saved = json.loads(baseline.read_text(encoding="utf-8"))
    assert len(saved) == 77

    assert watch.run(ARGV) == 0
    assert "0 new listings since the last run" in capsys.readouterr().out

    # Pretend three listings were not there last time.
    dropped = {r["key"] for r in saved[:3]}
    baseline.write_text(json.dumps(saved[3:]), encoding="utf-8")
    assert watch.run(ARGV) == 0
    out = capsys.readouterr().out
    assert "3 new listings since the last run (77 listings now, 74 last time, 0 no longer listed)" in out
    new = json.loads((tmp_path / "watch" / "software-engineer-intern--san-francisco-ca--p2.new.json")
                     .read_text(encoding="utf-8"))
    assert {r["key"] for r in new} == dropped


def test_filters_limit_what_is_shown_not_what_is_remembered(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(intern_intel, "OUT_DIR", tmp_path)
    assert watch.run(ARGV + ["--min-hourly", "1000"]) == 0
    assert "saved 77 listings" in capsys.readouterr().out


def test_new_listings_keeps_order():
    rows = [{"key": k} for k in "abcd"]
    assert watch.new_listings([{"key": "b"}, {"key": "x"}], rows) == [{"key": "a"}, {"key": "c"}, {"key": "d"}]


def test_rejects_flags_that_skip_fetching(capsys):
    assert watch.run(["--from-dir", "x"]) == 2
