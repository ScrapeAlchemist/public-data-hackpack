"""Dedupe tests: the normalization rules, the merge rules, and the full offline pipeline.

fixtures/expected/*.json is the exact out/intern_intel.json the pipeline writes for the
saved pages. The JavaScript version must produce the same bytes from the same fixtures.
To refresh it after a deliberate rule change, run the command for each case (the offline
command in CASES, or --from-dir on a folder holding the DIR_CASES files under their new
names) and copy out/intern_intel.json over the expected file.
"""

from pathlib import Path

import pytest

import dedupe
import intern_intel

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


# ---------------------------------------------------------------- normalization

@pytest.mark.parametrize("name,norm", [
    ("DoorDash USA", "doordash"),
    ("DocuSign", "docusign"),
    ("Docusign", "docusign"),
    ("Mercor (Poland)", "mercor"),
    ("Amazon.com Services LLC", "amazon"),
    ("Booking.com", "booking"),
    ("Acme, Inc.", "acme"),
    ("Bank of America Corporation", "bank of america"),
    ("Widgets Co. Ltd", "widgets"),
    ("US Bank", "us bank"),              # suffix words only come off the end
    ("Co", "co"),                        # and never the last word left
    ("Macy\u2019s", "macys"),
    ("AT&T", "at t"),
    ("Nestl\u00e9 USA", "nestle"),
    ("Soci\u00e9t\u00e9 G\u00e9n\u00e9rale", "societe generale"),
    ("", ""),
    (None, ""),
])
def test_norm_company(name, norm):
    assert dedupe.norm_company(name) == norm


@pytest.mark.parametrize("title,norm", [
    ("Software Engineering Intern (Summer 2027)", "software engineer intern"),
    ("Software Engineer, Intern (Summer 2027) - US", "software engineer intern"),
    ("[Summer 2027] Software Engineer Intern", "software engineer intern"),
    ("Software Development Engineer Intern", "software engineer intern"),
    ("Software Engineer Intern (US)", "software engineer intern"),
    ("Software Engineer Intern - USA", "software engineer intern"),
    ("Software Engineer Intern \u2013 United States", "software engineer intern"),
    ("Summer 2027: AI Science Intern", "ai science intern"),
    ("Robotics Intern - Winter 2026", "robotics intern"),
    ("Software Engineer Project Intern (AI Infrastructure) - 2026 Start (PhD)",
     "software engineer project intern ai infrastructure phd"),
    # the team inside the brackets is kept: these are two different jobs
    ("Software Engineer Intern (AI Platform) - 2027 Summer", "software engineer intern ai platform"),
    ("Software Engineer Intern (Global Payment) - 2027 Summer", "software engineer intern global payment"),
    ("Software Engineer (Machine Learning) Intern (Summer 2027)", "software engineer machine learning intern"),
    ("Undergrad Intern \u2013 Software Engineer \u2013 Technology, AI & Data (Summer 2027)",
     "undergrad intern software engineer technology ai data"),
    ("Women\u2019s Engineering Intern", "womens engineer intern"),
    ("Campus Intern", "campus intern"),   # 'us' inside a word is not a country tag
    ("Springboot Developer Intern", "springboot developer intern"),
    # language names keep their meaning: these are different jobs
    ("C++ Developer Intern", "cpp developer intern"),
    ("C# Developer Intern", "csharp developer intern"),
    ("C Developer Intern", "c developer intern"),
    ("F# Intern", "fsharp intern"),
    (".NET Intern", "dotnet intern"),
    ("ASP.NET Developer Intern", "asp dotnet developer intern"),
    ("Abc++ Intern", "abc intern"),          # only a standalone c++
    (".Network Intern", "network intern"),   # only a standalone .net
])
def test_norm_title(title, norm):
    assert dedupe.norm_title(title) == norm


def test_dedupe_key():
    row = {"company": "Harvey", "title": "Software Engineering Intern (Summer 2027)"}
    assert dedupe.dedupe_key(row) == "harvey|software engineer intern"


# ---------------------------------------------------------------- merge rules

def row(source, job_id, title="Software Engineer Intern", company="Acme", location=None,
        pay=None, hourly=None, rating=None, indeed_jk=None):
    url = (f"https://www.indeed.com/viewjob?jk={job_id}" if source == "indeed"
           else f"https://www.glassdoor.com/job-listing/x.htm?jl={job_id}")
    r = {"source": source, "title": title, "company": company, "location": location, "pay": pay,
         "pay_hourly_min": hourly, "rating": rating, "url": url, "job_id": job_id}
    if source == "glassdoor":
        r["indeed_jk"] = indeed_jk
    return r


def test_cross_source_merge():
    rows = [
        row("glassdoor", "1", title="Software Engineering Intern (Summer 2027)", company="DocuSign",
            location="San Francisco, CA", pay="$39.00 - $51.00 Per Hour (Employer provided)", hourly=39,
            rating=3.6),
        row("indeed", "a" * 16, title="Software Engineer Intern", company="Docusign",
            location="Hybrid work in San Francisco, CA", pay="$39 - $51 an hour", hourly=39),
    ]
    [m] = dedupe.merge_rows(rows)
    assert m["sources"] == ["indeed", "glassdoor"]           # fixed order, not input order
    assert list(m["urls"]) == ["indeed", "glassdoor"]
    assert m["title"] == "Software Engineering Intern (Summer 2027)"   # first non-null
    assert m["company"] == "DocuSign"
    assert m["location"] == "San Francisco, CA"
    assert m["pay"] == "$39.00 - $51.00 Per Hour (Employer provided)"  # tie on hourly: first row
    assert m["rating"] == 3.6
    assert m["key"] == "docusign|software engineer intern"


def test_first_non_null_fields():
    rows = [row("indeed", "a" * 16, location=None), row("glassdoor", "2", location="Austin, TX", rating=4.0)]
    [m] = dedupe.merge_rows(rows)
    assert m["location"] == "Austin, TX" and m["rating"] == 4.0


def test_pay_comes_from_highest_hourly():
    rows = [
        row("indeed", "a" * 16, pay="$8,000 a month", hourly=46.15),
        row("glassdoor", "3", pay="$60.00 Per Hour", hourly=60),
    ]
    [m] = dedupe.merge_rows(rows)
    assert (m["pay"], m["pay_hourly_min"]) == ("$60.00 Per Hour", 60)


def test_glassdoor_estimate_never_beats_employer_pay():
    # parse_glassdoor gives estimates no hourly value, so the employer number wins even when lower
    rows = [
        row("indeed", "a" * 16, pay="$20 an hour", hourly=20),
        row("glassdoor", "2", pay="$100K - $150K (Glassdoor est.)", hourly=None),
    ]
    [m] = dedupe.merge_rows(rows)
    assert (m["pay"], m["pay_hourly_min"]) == ("$20 an hour", 20)


def test_same_site_rows_never_merge():
    # two Glassdoor jobs with one key (C++ vs C# looked alike before the protected tokens)
    rows = [
        row("glassdoor", "1", title="Quant Intern"),
        row("glassdoor", "2", title="Quant Intern (Summer 2027)"),
        row("indeed", "a" * 16, title="Quant Intern"),
        row("indeed", "b" * 16, title="Quant Intern"),
        row("indeed", "c" * 16, title="Quant Intern"),
    ]
    merged = dedupe.merge_rows(rows)
    assert [m["urls"] for m in merged] == [
        {"indeed": "https://www.indeed.com/viewjob?jk=" + "a" * 16, "glassdoor": "https://www.glassdoor.com/job-listing/x.htm?jl=1"},
        {"indeed": "https://www.indeed.com/viewjob?jk=" + "b" * 16, "glassdoor": "https://www.glassdoor.com/job-listing/x.htm?jl=2"},
        {"indeed": "https://www.indeed.com/viewjob?jk=" + "c" * 16},
    ]


def test_twin_link_joins_different_company_names():
    rows = [
        row("indeed", "d" * 16, title="Software Engineer Intern - Summer 2027", company="IMC Financial Markets",
            pay="$200,000 a year", hourly=96.15),
        row("glassdoor", "7", title="Software Engineer Intern - Summer 2027", company="IMC Trading",
            pay="$200K (Employer provided)", hourly=96.15, rating=4.5, indeed_jk="d" * 16),
    ]
    [m] = dedupe.merge_rows(rows)
    assert m["sources"] == ["indeed", "glassdoor"]
    assert m["company"] == "IMC Financial Markets" and m["rating"] == 4.5
    assert m["key"] == "imc financial markets|software engineer intern"


def test_twin_pair_takes_no_other_rows():
    rows = [
        row("glassdoor", "7", company="Twin Co", indeed_jk="e" * 16),
        row("indeed", "e" * 16, company="Twin Co"),
        row("indeed", "f" * 16, company="Twin Co"),      # same key, but the pair is closed
        row("glassdoor", "8", company="Other", indeed_jk="e" * 16),   # the Indeed row is taken
        row("glassdoor", "9", company="Ghost", indeed_jk="0" * 16),   # no such Indeed row here
    ]
    merged = dedupe.merge_rows(rows)
    assert [m["sources"] for m in merged] == [["indeed", "glassdoor"], ["indeed"], ["glassdoor"], ["glassdoor"]]
    assert merged[0]["urls"]["indeed"].endswith("e" * 16)


def test_pay_without_hourly():
    rows = [row("indeed", "a" * 16), row("glassdoor", "2", pay="Competitive")]
    [m] = dedupe.merge_rows(rows)
    assert (m["pay"], m["pay_hourly_min"]) == ("Competitive", None)


def test_repeated_job_id_is_dropped():
    rows = [
        row("indeed", "a" * 16, title="Data Intern"),
        row("indeed", "a" * 16, title="Web Intern"),     # same listing seen on page 2
        row("glassdoor", "a" * 16, title="Ops Intern"),   # same id on the other site is not the same job
    ]
    merged = dedupe.merge_rows(rows)
    assert [m["title"] for m in merged] == ["Data Intern", "Ops Intern"]


def test_different_teams_stay_apart():
    rows = [
        row("glassdoor", "1", title="Software Engineer Intern (AI Platform) - 2027 Summer", company="ByteDance"),
        row("glassdoor", "2", title="Software Engineer Intern (Global Payment) - 2027 Summer", company="ByteDance"),
    ]
    assert len(dedupe.merge_rows(rows)) == 2


def test_group_order_is_first_appearance():
    rows = [row("indeed", "a" * 16, company="B"), row("indeed", "b" * 16, company="A"),
            row("glassdoor", "1", company="B")]
    assert [m["company"] for m in dedupe.merge_rows(rows)] == ["B", "A"]


# ---------------------------------------------------------------- sort and filters

def merged_row(title, hourly, location="San Francisco, CA"):
    return {"title": title, "company": "Acme", "location": location, "pay": None, "pay_hourly_min": hourly,
            "rating": None, "sources": ["indeed"], "urls": {}, "key": title}


def test_sort_by_hourly_desc_nulls_last_stable():
    rows = [merged_row("a", None), merged_row("b", 40), merged_row("c", 60), merged_row("d", 40),
            merged_row("e", None), merged_row("f", 0)]
    assert [r["title"] for r in dedupe.sort_rows(rows)] == ["c", "b", "d", "f", "a", "e"]


def test_filters():
    rows = [merged_row("Software Engineer Intern", 50), merged_row("Data Science Intern", 30, "New York, NY"),
            merged_row("Software Intern", None, None)]
    titles = lambda rs: [r["title"] for r in rs]  # noqa: E731
    assert titles(dedupe.filter_rows(rows, title_includes="SOFTWARE")) == ["Software Engineer Intern",
                                                                         "Software Intern"]
    assert titles(dedupe.filter_rows(rows, location_includes="new york")) == ["Data Science Intern"]
    assert titles(dedupe.filter_rows(rows, min_hourly=30)) == ["Software Engineer Intern", "Data Science Intern"]
    assert titles(dedupe.filter_rows(rows, min_hourly=31)) == ["Software Engineer Intern"]
    assert titles(dedupe.filter_rows(rows)) == titles(rows)


# ---------------------------------------------------------------- full offline pipeline

CASES = {
    "sf_swe_p2": ["--offline", "--pages", "2"],
    "ny_ds_p1": ["--offline", "--role", "data science intern", "--location", "New York, NY"],
    "remote_swe_p1": ["--offline", "--location", "Remote"],
}


def run_offline(argv):
    args = intern_intel.parse_args(argv)
    _, pages, all_rows = intern_intel.fetch_rows(args)
    assert all(p.ok and p.origin == "fixture" for p in pages)
    merged, rows = intern_intel.build_table(all_rows, args)
    return all_rows, merged, rows


@pytest.mark.parametrize("case", sorted(CASES))
def test_pipeline_matches_expected_output(case):
    _, _, rows = run_offline(CASES[case])
    expected = (FIXTURES / "expected" / f"{case}.json").read_bytes().decode("utf-8")
    assert intern_intel.json_text(rows) == expected


@pytest.mark.parametrize("case,listings,unique,keys", [
    ("sf_swe_p2", 87, 77, {
        "mercor|software engineer intern",
        "harvey|software engineer intern",
        "affirm|software engineer intern",
        "rippling|software engineer intern backend focused",
        "affirm|it engineer intern early careers",
        "docusign|software engineer intern",
    }),
    ("ny_ds_p1", 45, 43, {
        "meta|data scientist intern product analytics",
        "intuit|ai science intern",
    }),
    ("remote_swe_p1", 45, 38, {
        "springer capital|backend developer internship remote",
        "lief|web development software engineer intern",
        "stellar software solutions|cloud engineer intern",
        "stellar software solutions|backend developer intern",
        "stellar software solutions|frontend developer intern",
        "enthuziastic|software engineer intern remote job",
        "amgen|undergrad intern software engineer technology ai data",
    }),
])
def test_cross_site_merges(case, listings, unique, keys):
    all_rows, merged, _ = run_offline(CASES[case])
    assert len(all_rows) == listings
    assert len(merged) == unique
    assert {m["key"] for m in merged if len(m["sources"]) == 2} == keys


def test_no_two_listings_from_one_site_merge_on_the_sample_pages():
    """On the sample pages every merge joins one Indeed and one Glassdoor listing."""
    for argv in CASES.values():
        all_rows, merged, _ = run_offline(argv)
        unique_ids = {(r["source"], r["job_id"]) for r in all_rows}
        assert len(unique_ids) == sum(len(m["sources"]) for m in merged)


# ---------------------------------------------------------------- saved pages read with --from-dir

DIR_CASES = {
    # Chicago, fetched with cli/intern_intel.ps1 on 2026-10-15
    "chicago_swe_p1": [("chicago_swe_indeed_p1.md", "indeed_p1.md"), ("chicago_swe_glassdoor_p1.md", "glassdoor_p1.md")],
    # an Indeed page that came back in Spanish on 2026-10-15, with the New York Glassdoor page
    "ny_ds_es_p1": [("ny_ds_es_indeed_p1.md", "indeed_p1.md"), ("ny_ds_glassdoor_p1.md", "glassdoor_p1.md")],
}


def run_from_dir(case, tmp_path):
    for src, dest in DIR_CASES[case]:
        (tmp_path / dest).write_bytes((FIXTURES / src).read_bytes())
    args = intern_intel.parse_args(["--from-dir", str(tmp_path)])
    _, pages, all_rows = intern_intel.fetch_rows(args)
    assert all(p.ok for p in pages)
    merged, rows = intern_intel.build_table(all_rows, args)
    return all_rows, merged, rows


@pytest.mark.parametrize("case", sorted(DIR_CASES))
def test_from_dir_matches_expected_output(case, tmp_path):
    _, _, rows = run_from_dir(case, tmp_path)
    expected = (FIXTURES / "expected" / f"{case}.json").read_bytes().decode("utf-8")
    assert intern_intel.json_text(rows) == expected


def test_chicago_merges(tmp_path):
    all_rows, merged, _ = run_from_dir("chicago_swe_p1", tmp_path)
    assert (len(all_rows), len(merged)) == (45, 38)
    both = [m for m in merged if len(m["sources"]) == 2]
    assert len(both) == 7
    # found only by the twin link: the two sites name the employer differently
    assert {"imc financial markets|software engineer intern", "enova international|software engineer internship hybrid"} <= {
        m["key"] for m in both}
    # C++ and C# are two jobs, and two Glassdoor Motorola listings stay two rows
    keys = [m["key"] for m in merged]
    assert {"scalptrade|cpp developer intern", "scalptrade|csharp developer intern"} <= set(keys)
    assert keys.count("motorola solutions|software engineer intern") == 2


def test_spanish_indeed_page(tmp_path, capsys):
    all_rows, merged, _ = run_from_dir("ny_ds_es_p1", tmp_path)
    assert "[indeed p1] warning: this page is in Spanish" in capsys.readouterr().out
    indeed = [r for r in all_rows if r["source"] == "indeed"]
    assert len(indeed) == 15
    assert all(r["pay_hourly_min"] is not None for r in indeed if r["pay"])
    assert not any(r["company"].startswith("Post") for r in indeed)


def test_offline_url_without_fixture_reports_error():
    import fetch
    page = fetch.fetch_one("https://www.indeed.com/jobs?q=nothing+saved&l=", offline=True)
    assert not page.ok and "no fixture" in page.error
