"""recipes/any_site.py helpers and the recipes/parse_yelp.py example (offline, no network).

The sample below is written by hand in the shape of a saved Yelp search page; it is not a
copy of one.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "recipes"))
import any_site  # noqa: E402
import parse_yelp  # noqa: E402

NBSP = "\u00a0"
SAMPLE = f"""# Top 10 Best tea Near Example City

## Sponsored Results

*   [![Ad Tea](https://img.example.com/photos/ad.jpg "Ad Tea")](/adredir?ad_business_id=abc&redirect_url=x)

    ### [Ad Tea](/adredir?ad_business_id=abc&redirect_url=x)

    4.5 (174 reviews)

    Somewhere$$Open until 9:00 PM

## All "tea" results near me

*   [![First Tea](https://img.example.com/photos/1.jpg "First Tea")](/biz/first-tea-example?osq=tea)

    ### 1.{NBSP}[First Tea](/biz/first-tea-example?osq=tea)

    4.6 (323 reviews)

    Main St$$Closed until 11:30 AM

    "Good tea." [more](/biz/first-tea-example?hrid=x&osq=tea)

    [

    Bubble Tea

    ](/search?find_desc=Bubble+Tea)

*   ### 2.{NBSP}[Second Tea](/biz/second-tea-example?osq=tea)

    4.1 (1.7k reviews)

    DowntownOpens in 50 min

*   ### 3.{NBSP}[Third Tea](/biz/third-tea-example?osq=tea)

    Old Town$Open until 8:00 PM

*   ### 4.{NBSP}[Fourth Tea](/biz/fourth-tea-example?osq=tea)

    "No rating or area on this one." [more](/biz/fourth-tea-example?hrid=y)
"""


def test_parse_yelp_reads_ranked_results_and_skips_sponsored():
    rows = parse_yelp.parse_yelp(SAMPLE)
    assert rows == [
        {"rank": 1, "name": "First Tea", "url": "https://www.yelp.com/biz/first-tea-example",
         "rating": 4.6, "reviews": 323, "area": "Main St", "price": "$$"},
        {"rank": 2, "name": "Second Tea", "url": "https://www.yelp.com/biz/second-tea-example",
         "rating": 4.1, "reviews": 1700, "area": "Downtown", "price": ""},
        {"rank": 3, "name": "Third Tea", "url": "https://www.yelp.com/biz/third-tea-example",
         "rating": None, "reviews": None, "area": "Old Town", "price": "$"},
        {"rank": 4, "name": "Fourth Tea", "url": "https://www.yelp.com/biz/fourth-tea-example",
         "rating": None, "reviews": None, "area": "", "price": ""},
    ]


def test_review_count():
    assert parse_yelp.review_count("323") == 323
    assert parse_yelp.review_count("1,204") == 1204
    assert parse_yelp.review_count("1.7k") == 1700


def test_parse_yelp_main_writes_json(tmp_path, capsys):
    page = tmp_path / "yelp.md"
    page.write_text(SAMPLE, encoding="utf-8")
    assert parse_yelp.main([str(page)]) == 0
    assert "4 results, saved to" in capsys.readouterr().out
    assert (tmp_path / "yelp.json").exists()
    assert parse_yelp.main([str(tmp_path / "missing.md")]) == 1


def test_link_patterns_count_one_shape_per_result():
    shapes = dict(((host, shape), n) for (host, shape), n in any_site.link_patterns(SAMPLE))
    assert shapes[("", "/biz/<name>")] == 7
    assert shapes[("", "/adredir")] == 2
    assert shapes[("img.example.com", "/photos/<name>")] == 2
    assert shapes[("", "/search")] == 1


def test_headings_page_title_first_then_page_order():
    found = any_site.headings(SAMPLE)
    assert found[:4] == ["# Top 10 Best tea Near Example City", "## Sponsored Results",
                         "### [Ad Tea](/adredir?ad_business_id=abc&redirect_url=x)",
                         '## All "tea" results near me']
    assert any_site.ascii_line(found[4]) == "### 1. [First Tea](/biz/first-tea-example?osq=tea)"
    assert any_site.headings("## Filters\n#### Room\n# 237 properties found\n### Card") == [
        "# 237 properties found", "## Filters", "### Card"]


def test_default_path_is_per_url():
    a = any_site.default_path("https://www.yelp.com/search?find_desc=boba", html=False)
    b = any_site.default_path("https://www.yelp.com/search?find_desc=tea", html=False)
    assert a.parent == ROOT / "out" / "pages"
    assert a.name.startswith("yelp_com_") and a.suffix == ".md"
    assert a != b
    assert any_site.default_path("https://www.booking.com/x", html=True).suffix == ".html"
