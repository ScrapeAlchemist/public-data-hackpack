"""Parser tests on the saved search pages in fixtures/ plus small hand-written blocks.

Fixture pages (all fetched through the Bright Data Web Unlocker as markdown):
  indeed_p1/p2, glassdoor_p1/p2       software engineer intern, San Francisco, CA (pages 1 and 2)
  ny_ds_indeed_p1, ny_ds_glassdoor_p1 data science intern, New York, NY
  remote_swe_indeed_p1, remote_swe_glassdoor_p1   software engineer intern, Remote
  chicago_swe_indeed_p1, chicago_swe_glassdoor_p1 software engineer intern, Chicago, IL (fetched
                                      with the Bright Data CLI; not in manifest.json, so --offline
                                      still has no Chicago search)
  ny_ds_es_indeed_p1                  the New York Indeed page as Indeed sometimes serves it: in Spanish
  sf_swe_nolink_indeed_p1             the San Francisco Indeed page fetched again later on 2026-10-15:
                                      the repeated copy has a 'Salary Search' line with no link
  mcp/*                             the same pages as rendered by the Bright Data MCP server
                                      (scrape_as_markdown), a slightly different markdown
"""

import re
from pathlib import Path

import pytest

import parsers

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"

EXPECTED_COUNTS = {
    "indeed_p1.md": 15,
    "indeed_p2.md": 15,
    "glassdoor_p1.md": 30,
    "glassdoor_p2.md": 27,
    "ny_ds_indeed_p1.md": 15,
    "ny_ds_glassdoor_p1.md": 30,
    "remote_swe_indeed_p1.md": 15,
    "remote_swe_glassdoor_p1.md": 30,
    "mcp/ny_ds_glassdoor_p1.md": 30,
    "mcp/remote_swe_indeed_p1.md": 15,
    "chicago_swe_indeed_p1.md": 15,
    "chicago_swe_glassdoor_p1.md": 30,
    "ny_ds_es_indeed_p1.md": 15,
    "sf_swe_nolink_indeed_p1.md": 15,
}


def load(name):
    return (FIXTURES / name).read_bytes().decode("utf-8")


def source_of(name):
    return "glassdoor" if "glassdoor" in name else "indeed"


def parse(name):
    return parsers.PARSERS[source_of(name)](load(name))


# ---------------------------------------------------------------- every fixture page

@pytest.mark.parametrize("name,count", sorted(EXPECTED_COUNTS.items()))
def test_listing_count(name, count):
    assert len(parse(name)) == count


@pytest.mark.parametrize("name", sorted(EXPECTED_COUNTS))
def test_row_fields(name):
    source = source_of(name)
    rows = parse(name)
    assert len({r["job_id"] for r in rows}) == len(rows), "job ids repeat within one page"
    fields = {"source", "title", "company", "location", "pay", "pay_hourly_min", "rating", "url", "job_id"}
    for r in rows:
        assert set(r) == (fields | {"indeed_jk"} if source == "glassdoor" else fields)
        assert r["source"] == source
        assert r["title"] and r["title"] == r["title"].strip()
        assert r["company"], r
        assert not r["company"].endswith(" Logo")
        if source == "indeed":
            assert re.fullmatch(r"[0-9a-f]{16}", r["job_id"])
            assert r["url"] == f"https://www.indeed.com/viewjob?jk={r['job_id']}"
            assert r["rating"] is None
        else:
            assert re.fullmatch(r"\d+", r["job_id"])
            assert r["url"].startswith("https://www.glassdoor.com/job-listing/")
            assert r["url"].endswith(f".htm?jl={r['job_id']}")
            assert r["rating"] is None or 1.0 <= r["rating"] <= 5.0
            assert r["indeed_jk"] is None or re.fullmatch(r"[0-9a-f]{16}", r["indeed_jk"])
            if r["pay"] and "(Glassdoor est.)" in r["pay"]:
                assert r["pay_hourly_min"] is None   # an estimate is not the employer's number
        if r["pay"] is not None:
            assert r["pay"].startswith(("$", "From $", "Up to $")), r["pay"]
        if r["pay_hourly_min"] is not None:
            # Wide bounds on purpose: employers post odd numbers ('$1 - $2' on the Remote page).
            assert 0 < r["pay_hourly_min"] < 500, r


@pytest.mark.parametrize("name", [n for n in sorted(EXPECTED_COUNTS) if source_of(n) == "indeed"])
def test_indeed_decoy_is_dropped(name):
    """Each Indeed page has one /viewjob?jk=<made-up id> copy of a real listing."""
    md = load(name)
    decoys = re.findall(r"/viewjob\?jk=([0-9a-f]{16})", md)
    assert len(decoys) == 1
    ids = {r["job_id"] for r in parse(name)}
    assert decoys[0] not in ids


@pytest.mark.parametrize("rest,mcp", [
    ("ny_ds_glassdoor_p1.md", "mcp/ny_ds_glassdoor_p1.md"),
    ("remote_swe_indeed_p1.md", "mcp/remote_swe_indeed_p1.md"),
])
def test_rest_and_mcp_markdown_parse_the_same(rest, mcp):
    assert parse(rest) == parse(mcp)


# ---------------------------------------------------------------- known rows

def test_indeed_known_row():
    first = parse("indeed_p1.md")[0]
    assert first == {
        "source": "indeed",
        "title": "Software Engineer, Intern (Summer 2027) - US",
        "company": "DoorDash USA",
        "location": "San Francisco, CA",
        "pay": "$107,400 - $158,000 a year",
        "pay_hourly_min": 51.63,
        "rating": None,
        "url": "https://www.indeed.com/viewjob?jk=bca7afa58e1841a6",
        "job_id": "bca7afa58e1841a6",
    }


def test_indeed_hybrid_location_and_hourly_pay():
    first = parse("ny_ds_indeed_p1.md")[0]
    assert (first["title"], first["company"], first["location"], first["pay"], first["pay_hourly_min"]) == \
        ("Data Science Intern", "Coinbase", "Hybrid work in New York, NY", "$50 an hour", 50)


def test_glassdoor_known_row():
    first = parse("glassdoor_p1.md")[0]
    assert first["title"] == "College Student -Software Engineer"
    assert first["company"] == "Lockheed Martin"
    assert first["location"] == "Sunnyvale, CA"
    assert first["rating"] == 4.1
    assert first["pay"] == "$25.18 - $35.19 Per Hour (Employer provided)"
    assert first["pay_hourly_min"] == 25.18
    assert first["job_id"] == "1010290936896"


def test_glassdoor_listing_without_location():
    rows = [r for r in parse("glassdoor_p1.md") if r["location"] is None]
    assert len(rows) == 1
    r = rows[0]
    assert r["company"] == "Amazon"
    assert r["title"].startswith("Software Development Engineer Intern (Embedded")
    assert r["pay"] is None and r["rating"] == 3.5


def test_glassdoor_partner_link_gives_the_indeed_jk():
    """Most Glassdoor listings link to the same posting on Indeed; the link ends with its jk."""
    for name in ("glassdoor_p1.md", "ny_ds_glassdoor_p1.md", "mcp/ny_ds_glassdoor_p1.md", "chicago_swe_glassdoor_p1.md"):
        rows = parse(name)
        assert sum(r["indeed_jk"] is not None for r in rows) >= len(rows) - 1, name
    imc = [r for r in parse("chicago_swe_glassdoor_p1.md") if r["company"] == "IMC Trading"]
    indeed = {r["job_id"]: r for r in parse("chicago_swe_indeed_p1.md")}
    assert [indeed[r["indeed_jk"]]["company"] for r in imc] == ["IMC Financial Markets"]


def test_glassdoor_listing_without_rating():
    rows = [r for r in parse("glassdoor_p2.md") if r["rating"] is None]
    assert len(rows) == 3
    assert all(r["company"] and r["location"] for r in rows)


# ---------------------------------------------------------------- hand-written blocks

GD_URL = "https://www.glassdoor.com/job-listing/data-intern-acme-JV_KO0,11_KE12,16.htm"


def test_glassdoor_block_variants():
    md = "\n".join([
        "Acme Logo",                         # company line missing, the logo alt text has the name
        "4.2",
        f"[Data Intern]({GD_URL}?jl=1001)",
        "Austin, TX",
        "$20.00 Per Hour (Employer provided)",
        "Bolt",                              # no rating
        f"[Web Intern]({GD_URL}?src=GD&jl=1002&ao=1)",
        "$5,000 (Employer provided)",        # no location: pay comes right after the title
        "Easy Apply",
        "Cobalt",
        "3",
        f"[Ops Intern]({GD_URL}?jl=1003)",
        "Easy Apply",                        # no location and no pay
    ])
    a, b, c = parsers.parse_glassdoor(md)
    assert (a["company"], a["rating"], a["location"], a["pay_hourly_min"]) == ("Acme", 4.2, "Austin, TX", 20)
    assert (b["company"], b["rating"], b["location"], b["pay"]) == ("Bolt", None, None, "$5,000 (Employer provided)")
    assert b["url"] == f"{GD_URL}?jl=1002" and b["job_id"] == "1002"
    assert (c["company"], c["rating"], c["location"], c["pay"]) == ("Cobalt", 3.0, None, None)


def test_indeed_block_variants():
    md = "\n".join([
        "[Data Intern](/rc/clk?jk=0123456789abcdef&bb=xyz)",
        "Easily apply",                      # badge before the company
        "Acme",
        "Austin, TX 78701",                  # ZIP code is dropped
        "Urgently hiring",
        "$20 - $25 an hour",
        "Internship",
        "Salary Search: [Data Intern salaries](/career/salaries?fromjk=0123456789abcdef)",
        "[Web Intern](/viewjob?jk=aaaaaaaaaaaaaaaa)",   # decoy: its fromjk points at another job
        "Acme",
        "Austin, TX",
        "Salary Search: [x](/career/salaries?fromjk=bbbbbbbbbbbbbbbb)",
        "[Ops Intern](/pagead/clk?jk=fedcba9876543210&ad=1)",
        "Bolt",
        "Remote",
        "Up to $30 an hour",
        "[1](#)",                            # pagination: the listing ends here
        "[Ignored Intern](/rc/clk?jk=1111111111111111)",
        "Nobody",
        "Nowhere",
    ])
    rows = parsers.parse_indeed(md)
    assert [r["job_id"] for r in rows] == ["0123456789abcdef", "fedcba9876543210"]
    a, b = rows
    assert (a["company"], a["location"], a["pay"], a["pay_hourly_min"]) == ("Acme", "Austin, TX", "$20 - $25 an hour", 20)
    assert (b["company"], b["location"], b["pay"], b["pay_hourly_min"]) == ("Bolt", "Remote", "Up to $30 an hour", None)


def test_glassdoor_partner_link_block():
    md = "\n".join([
        "Acme",
        "4.0",
        f"[Data Intern]({GD_URL}?jl=1001)",
        "Austin, TX",
        "$5,000 (Employer provided)",
        "[](/partner/jobListing.htm?pos=101&ao=1&jobListingId=1001&jrtk=5-yul1-0-1abc-0123456789abcdef&cs=1)",
        "Bolt",
        f"[Web Intern]({GD_URL}?jl=1002)",
        "$90K - $120K (Glassdoor est.)",
        "[](/partner/jobListing.htm?jobListingId=1002&jrtk=5-yul1-0-1abc-NOTHEX)",
    ])
    a, b = parsers.parse_glassdoor(md)
    assert a["indeed_jk"] == "0123456789abcdef"
    assert b["indeed_jk"] is None
    assert (b["pay"], b["pay_hourly_min"]) == ("$90K - $120K (Glassdoor est.)", None)


def test_indeed_spanish_page():
    md = load("ny_ds_es_indeed_p1.md")
    assert parsers.indeed_is_spanish(md)
    assert not parsers.indeed_is_spanish(load("ny_ds_indeed_p1.md"))
    rows = parsers.parse_indeed(md)
    assert sum(r["pay"] is not None for r in rows) == sum(r["pay_hourly_min"] is not None for r in rows) > 0
    sage = [r for r in rows if r["company"] == "SageSure"]
    assert len(sage) == 1 and sage[0]["location"] != "SageSure"


def test_indeed_spanish_block():
    md = "\n".join([
        "[Data Intern](/rc/clk?jk=0123456789abcdef&bb=xyz)",
        "Post\u00falate r\u00e1pidamente",
        "Acme",
        "Jersey City, NJ",
        "$71,000 por a\u00f1o",
        "B\u00fasqueda de salarios: [x](/career/salaries?fromjk=0123456789abcdef)",
    ])
    [r] = parsers.parse_indeed(md)
    assert (r["company"], r["location"], r["pay"], r["pay_hourly_min"]) == (
        "Acme", "Jersey City, NJ", "$71,000 por a\u00f1o", 34.13)


def test_indeed_viewjob_copy_without_fromjk():
    card = ["Acme", "San Mateo, CA", "$62 an hour", "Salary Search: Data Intern salaries in San Mateo, CA"]
    md = "\n".join([
        "[Data Intern](/rc/clk?jk=0123456789abcdef&bb=xyz)", *card,
        "[Data Intern](/viewjob?jk=0f1e2d3c4b5a6978)", *card,               # same card again: dropped
        "[Web Intern](/viewjob?jk=aaaaaaaaaaaaaaaa)", "Bolt", "Remote",      # no twin on the page: kept
    ])
    assert [r["job_id"] for r in parsers.parse_indeed(md)] == ["0123456789abcdef", "aaaaaaaaaaaaaaaa"]
    rows = parse("sf_swe_nolink_indeed_p1.md")
    copy = load("sf_swe_nolink_indeed_p1.md").split("/viewjob?jk=0f1e2d3c4b5a6978")[1].split("### ")[0]
    assert "Salary Search:" in copy and "fromjk=" not in copy
    assert "0f1e2d3c4b5a6978" not in {r["job_id"] for r in rows}
    assert [r["company"] for r in rows].count("roblox") == 1


def test_indeed_viewjob_link_kept_when_ids_agree():
    md = "\n".join([
        "[Data Intern](/viewjob?jk=0123456789abcdef)",
        "Acme",
        "Austin, TX",
        "Salary Search: [x](/career/salaries?fromjk=0123456789abcdef)",
    ])
    assert [r["job_id"] for r in parsers.parse_indeed(md)] == ["0123456789abcdef"]


def test_clean_lines():
    md = "\n".join([
        "*   ### [Data Intern](/rc/clk?jk=0123456789abcdef)",
        "    *   **AT&amp;T** and Fish \\& Chips",
        "![Acme Logo](https://example.com/logo.png)",
        "Snippet text&hellip;",
        "It&#39;s here&#x21;",
        "&unknown; stays",
        "\u00a0  ",
        "",
        "#### Heading",
    ])
    assert parsers.clean_lines(md) == [
        "[Data Intern](/rc/clk?jk=0123456789abcdef)",
        "AT&T and Fish & Chips",
        "Acme Logo",
        "Snippet text\u2026",
        "It's here!",
        "&unknown; stays",
        "Heading",
    ]


# ---------------------------------------------------------------- pay

@pytest.mark.parametrize("pay,hourly", [
    ("$50 an hour", 50),
    ("$62 - $72 an hour", 62),
    ("$107,400 - $158,000 a year", 51.63),
    ("From $105,000 a year", 50.48),
    ("$10,500 a month", 60.58),
    ("$8,000 - $10,000 a month", 46.15),
    ("$1,000 a week", 25),
    ("$200 a day", 25),
    ("$25.18 - $35.19 Per Hour (Employer provided)", 25.18),
    ("$45.00 Per Hour (Employer provided)", 45),
    ("$58K - $98K (Employer provided)", 27.88),       # K without a unit = yearly
    ("$162K - $207K (Glassdoor est.)", 77.88),       # the number; parse_glassdoor drops it for estimates
    ("$7,313 - $12,667 (Employer provided)", 42.19),  # no unit, $300 or more = monthly
    ("$5,000 (Employer provided)", 28.85),
    ("$22 (Employer provided)", 22),                  # no unit, under $300 = hourly
    ("$50 por hora", 50),                             # Spanish page
    ("$7,188 - $12,100 por mes", 41.47),
    ("$71,000 por a\u00f1o", 34.13),
    ("Up to $30 an hour", None),                      # no lower bound
    ("Competitive", None),
    ("", None),
    (None, None),
])
def test_pay_hourly_min(pay, hourly):
    assert parsers.pay_hourly_min(pay) == hourly


def test_round2_is_half_up():
    assert parsers.round2(0.125) == 0.13
    assert parsers.round2(46.154741) == 46.15
    assert parsers.round2(60.5781) == 60.58
