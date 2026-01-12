#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
get_emails.py
-------------
Simplified scraper that:
  1️⃣ Logs in (you do the sign‑in, the script just waits for the redirect).
  2️⃣ For each organisation in dartmouth_groups.txt:
        – builds the search URL,
        – clicks the first result,
        – waits for the whole page (including iframes) to finish loading,
        – extracts every @dartmouth.edu address that appears anywhere on the page,
        – writes the result incrementally to organization_emails.jsonl.
Run with --headed the first time so you can type your credentials.
"""

import asyncio
import json
import logging
import os
import re
import sys
from pathlib import Path
from urllib.parse import quote

from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError

# ----------------------------------------------------------------------
# -------------------------- CONFIGURATION -----------------------------
# ----------------------------------------------------------------------
INPUT_FILE   = Path("dartmouth_groups.txt")
OUTPUT_FILE  = Path("organization_emails.jsonl")   # NDJSON (one line per org)

SEARCH_URL = (
    "https://dartmouthgroups.dartmouth.edu/club_signup?"
    "group_type=&search={}&category_tags=&all_my_groups=all_groups&order=name_asc"
)

LOGIN_URL = "https://dartmouthgroups.dartmouth.edu/login_only"

HEADLESS_MODE = True                 # set False or use --headed to see the browser
MANUAL_LOGIN_TIMEOUT_MS = 300_000   # 5 min – increase if you need more time

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

# ----------------------------------------------------------------------
def make_search_url(name: str) -> str:
    """Encode a human‑readable organisation name for the search URL."""
    return SEARCH_URL.format(quote(name.lower().strip()))


async def wait_for_login(page) -> None:
    """Wait until the SSO flow redirects back to a club_signup URL."""
    try:
        await page.wait_for_url(
            lambda url: "club_signup" in url,
            timeout=MANUAL_LOGIN_TIMEOUT_MS,
        )
        logging.info("Login complete – ready to start scraping.")
    except PlaywrightTimeoutError:
        logging.warning(
            f"Login did not finish within {MANUAL_LOGIN_TIMEOUT_MS/1000:.0f}s. "
            "Continuing anyway – you may not be logged in."
        )


EMAIL_REGEX = re.compile(r"[a-zA-Z0-9._%+-]+@dartmouth\.edu", re.IGNORECASE)


def extract_emails(text: str) -> list[str]:
    """Return a sorted list of **unique** @dartmouth.edu addresses found in *text*."""
    return sorted(set(EMAIL_REGEX.findall(text)))


async def wait_for_all_frames(page) -> None:
    """
    After navigation, wait for every frame (including iframes) to reach the
    'load' state. This guarantees that the iframe’s HTML is available.
    """
    for frame in page.frames:
        try:
            await frame.wait_for_load_state("load", timeout=10_000)
        except PlaywrightTimeoutError:
            # A frame might be cross‑origin or never finish loading – ignore it.
            pass


async def process_one_org(page, org_name: str) -> list[str]:
    """
    Search → click first result → wait for full page load (incl. iframes)
    → collect all @dartmouth.edu addresses from the main page **and** every iframe.
    """
    search_url = make_search_url(org_name)
    logging.info(f"Searching for '{org_name}' → {search_url}")

    # ------------------------------------------------------------------
    # 1️⃣ Load the search page
    # ------------------------------------------------------------------
    try:
        await page.goto(search_url, wait_until="domcontentloaded", timeout=30_000)
    except PlaywrightTimeoutError:
        logging.warning(f"Timeout loading search page for {org_name}")
        return ["Search page timeout"]

    # ------------------------------------------------------------------
    # 2️⃣ Click the first result
    # ------------------------------------------------------------------
    first_result = page.locator(".list-group-item a").first
    try:
        await first_result.wait_for(timeout=10_000)
        async with page.expect_navigation(wait_until="load", timeout=15_000):
            await first_result.click()
    except PlaywrightTimeoutError:
        logging.warning(f"No result found / click timed out for {org_name}")
        return ["No result / click timeout"]

    # ------------------------------------------------------------------
    # 3️⃣ Wait for everything (including iframes) to be fully loaded
    # ------------------------------------------------------------------
    await page.wait_for_load_state("networkidle", timeout=15_000)
    await wait_for_all_frames(page)          # ensures iframe HTML is ready

    # ------------------------------------------------------------------
    # 4️⃣ Grab HTML from the main page + every iframe
    # ------------------------------------------------------------------
    all_html = await page.content()
    for frame in page.frames:
        # Skip the main frame – we already have its HTML.
        if frame == page.main_frame:
            continue
        try:
            all_html += "\n" + await frame.content()
        except Exception:
            # Cross‑origin frames raise; just ignore them.
            pass

    # ------------------------------------------------------------------
    # 5️⃣ Extract e‑mail addresses
    # ------------------------------------------------------------------
    emails = extract_emails(all_html)

    # OPTIONAL: filter out the address you used to log‑in (if you know it)
    # MY_LOGIN_EMAIL = "somers@dartmouth.edu"
    # emails = [e for e in emails if e.lower() != MY_LOGIN_EMAIL.lower()]

    return emails


# ----------------------------------------------------------------------
async def main():
    # --------------------- Logging ------------------------------------
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(levelname)s - %(message)s",
        datefmt="%H:%M:%S",
    )

    # --------------------- Load org list -------------------------------
    if not INPUT_FILE.is_file():
        logging.error(f"Input file '{INPUT_FILE}' not found.")
        sys.exit(1)

    orgs = [ln.strip() for ln in INPUT_FILE.read_text(encoding="utf-8").splitlines() if ln.strip()]
    logging.info(f"Loaded {len(orgs)} organisation names from {INPUT_FILE}")

    # --------------------- Open output file (incremental) -------------
    out_f = OUTPUT_FILE.open("w", encoding="utf-8")

    # --------------------- Playwright ---------------------------------
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=HEADLESS_MODE)
        context = await browser.new_context(user_agent=USER_AGENT)
        page = await context.new_page()

        # ------- 0️⃣ Go to login page and wait for manual sign‑in ----------
        await page.goto(LOGIN_URL, wait_until="domcontentloaded")
        logging.info("Please sign‑in inside the browser window …")
        await wait_for_login(page)

        # ------- 1️⃣ Process every organisation -------------------------
        for idx, org in enumerate(orgs, start=1):
            logging.info(f"[{idx}/{len(orgs)}] Processing: {org}")
            emails = await process_one_org(page, org)

            # ----- Live terminal feedback --------------------------------
            if emails and not any("timeout" in e.lower() for e in emails):
                print(f"✅ {org} -> {', '.join(emails) if emails else 'No e‑mail found'}")
            else:
                print(f"❌ {org} -> {emails[0] if emails else 'Failed'}")

            # ----- Write incremental JSON line ---------------------------
            out_f.write(json.dumps({org: emails}) + "\n")
            out_f.flush()

            # Polite short pause – prevents hammering the server
            await asyncio.sleep(0.6)

        await browser.close()

    out_f.close()
    logging.info(f"All done – results saved to {OUTPUT_FILE}")


# ----------------------------------------------------------------------
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Scrape Dartmouth org e‑mail addresses.")
    parser.add_argument(
        "--headed",
        action="store_true",
        help="Run Chromium in headed (visible) mode – useful for the first login.",
    )
    args = parser.parse_args()

    if args.headed:
        HEADLESS_MODE = False

    # Also honor the PLAYWRIGHT_HEADLESS env‑var (0/false → headed)
    if os.getenv("PLAYWRIGHT_HEADLESS") in ("0", "false"):
        HEADLESS_MODE = False

    asyncio.run(main())