"""--from-dir and --print-urls: the two flags the cli/ scripts use.

The CLI scripts fetch pages with the Bright Data CLI, save them as indeed_p1.md,
glassdoor_p1.md, ... and run `intern_intel.py --from-dir <folder>`. A folder holding the
same pages as the offline fixtures must give the exact same table.
"""

import json
import shutil
from pathlib import Path

import pytest

import intern_intel

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


def table_from_dir(folder, *extra):
    args = intern_intel.parse_args(["--from-dir", str(folder), *extra])
    _, pages, all_rows = intern_intel.fetch_rows(args)
    _, rows = intern_intel.build_table(all_rows, args)
    return pages, rows


def expected(case):
    return (FIXTURES / "expected" / f"{case}.json").read_bytes().decode("utf-8")


def test_from_dir_matches_offline_run(tmp_path):
    for name in ("glassdoor_p2.md", "indeed_p2.md", "glassdoor_p1.md", "indeed_p1.md"):
        shutil.copyfile(FIXTURES / name, tmp_path / name)
    shutil.copyfile(FIXTURES / "ny_ds_indeed_p1.md", tmp_path / "ny_ds_indeed_p1.md")  # ignored: wrong name
    (tmp_path / "notes.txt").write_text("ignored")
    pages, rows = table_from_dir(tmp_path)
    assert [Path(p.url).name for p in pages] == ["indeed_p1.md", "indeed_p2.md", "glassdoor_p1.md", "glassdoor_p2.md"]
    assert all(p.ok and p.origin.startswith("file ") for p in pages)
    assert intern_intel.json_text(rows) == expected("sf_swe_p2")


def test_from_dir_names_without_page_number(tmp_path):
    shutil.copyfile(FIXTURES / "ny_ds_glassdoor_p1.md", tmp_path / "glassdoor.md")
    shutil.copyfile(FIXTURES / "ny_ds_indeed_p1.md", tmp_path / "indeed.md")
    _, rows = table_from_dir(tmp_path)
    assert intern_intel.json_text(rows) == expected("ny_ds_p1")


def test_from_dir_applies_filters(tmp_path):
    for name in ("indeed_p1.md", "indeed_p2.md", "glassdoor_p1.md", "glassdoor_p2.md"):
        shutil.copyfile(FIXTURES / name, tmp_path / name)
    _, rows = table_from_dir(tmp_path, "--title-includes", "software engineer",
                             "--location-includes", "san francisco", "--min-hourly", "50")
    # 11 rows match the text filters with a number of at least 50 on the page; one of them is
    # a Glassdoor estimate ('$162K - $207K (Glassdoor est.)'), which has no hourly value.
    assert len(rows) == 10
    assert all(r["pay_hourly_min"] >= 50 for r in rows)
    assert not any("(Glassdoor est.)" in r["pay"] for r in rows)


def test_from_dir_empty_and_missing_folder(tmp_path, capsys):
    assert intern_intel.run(intern_intel.parse_args(["--from-dir", str(tmp_path)])) == 1
    assert "No indeed_p<N>.md or glassdoor_p<N>.md files" in capsys.readouterr().out
    missing = tmp_path / "nope"
    assert intern_intel.run(intern_intel.parse_args(["--from-dir", str(missing)])) == 1
    assert "No such folder" in capsys.readouterr().out


@pytest.mark.parametrize("other", [["--offline"], ["--refresh"], ["--print-urls"], ["--save-fixtures"]])
def test_from_dir_rejects_fetch_flags(other):
    with pytest.raises(SystemExit):
        intern_intel.parse_args(["--from-dir", "x", *other])


def test_print_urls_lists_the_planned_pages(capsys):
    args = intern_intel.parse_args(["--print-urls", "--pages", "2"])
    assert intern_intel.run(args) == 0
    lines = [line.split("\t") for line in capsys.readouterr().out.splitlines()]
    assert [(s, n) for s, n, _ in lines] == [("indeed", "1"), ("indeed", "2"), ("glassdoor", "1"), ("glassdoor", "2")]
    manifest = json.loads((FIXTURES / "manifest.json").read_text(encoding="utf-8"))["pages"]
    for source, n, url in lines:  # the default search is the saved San Francisco one
        assert manifest[url]["file"] == f"{source}_p{n}.md"
