#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
get_emails.py
-------------
Extract the official @dartmouth.edu e‑mail address for every organization
listed in `dartmouth_groups.txt`.

Workflow
--------
0️⃣ Go directly to the login URL you supplied (no need to click a “Sign In”
   button first).

1️⃣ Wait until the browser is redirected back to a URL that starts with
   https://dartmouthgroups.dartmouth.edu/club_signup   (login / SSO finished).

2️⃣ For each organization name in `dartmouth_groups.txt`:
   • Build the search URL (search=…).
   • Load the search page.
   • Click the first result (li.list‑group‑item → a).
   • On the detail page read the e‑mail.
     – First try <span class="contact-value">.
     – If that fails, search the whole page (HTML + visible text) for a
       string that ends with @dartmouth.edu.

3️⃣ Write the mapping **incrementally** to `organization_emails.jsonl`
   (NDJSON – one JSON object per line).

Run headed (visible UI) with `--headed` so you can actually type your
credentials; otherwise the script runs head‑less.
"""

import asyncio
import json
import logging
import os
import re
import sys
from pathlib import Path
from urllib.parse import quote

from playwright.async_api import (
    async_playwright,
    TimeoutError as PlaywrightTimeoutError,
)

# ----------------------------------------------------------------------
# -------------------------- CONFIGURATION -----------------------------
# ----------------------------------------------------------------------
INPUT_FILE   = Path("dartmouth_groups.txt")
OUTPUT_JSONL = Path("organization_emails.jsonl")   # NDJSON output

# Search URL template – the part after “search=” will be URL‑encoded.
SEARCH = (
    "https://dartmouthgroups.dartmouth.edu/club_signup?"
    "group_type=&search={}&category_tags=&all_my_groups=all_groups&order=name_asc"
)

# Direct login page (skip the “click Sign In” step)
HOME_URL = "https://dartmouthgroups.dartmouth.edu/login_only"

# Headless vs headed – default is headless. Use `--headed` to see the UI.
HEADLESS_MODE = True

# How long (ms) we will wait for you to finish the manual login.
# 5 minutes = 300 000 ms – increase if you need more time.
MANUAL_LOGIN_TIMEOUT_MS = 300_000

# Realistic User‑Agent – many sites block Playwright’s default UA.
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

# ----------------------------------------------------------------------
def make_search_url(name: str) -> str:
    """
    Convert a human‑readable organization name to the URL the site expects:
    lower‑case, spaces → underscores, then URL‑encode.
    """
    formatted = name.lower().strip().replace(" ", "_")
    return SEARCH.format(quote(formatted))

# ----------------------------------------------------------------------
async def wait_until_back_on_signup(page) -> None:
    """
    After the login flow the site finally redirects to a URL that starts with
    https://dartmouthgroups.dartmouth.edu/club_signup.
    Wait for that condition (or timeout).
    """
    try:
        await page.wait_for_url(
            lambda url: url.startswith(
                "https://dartmouthgroups.dartmouth.edu/club_signup"
            ),
            timeout=MANUAL_LOGIN_TIMEOUT_MS,
        )
        logging.info("Login complete – we are back on the club‑signup page.")
    except PlaywrightTimeoutError:
        logging.warning(
            f"Did not return to the club‑signup page within "
            f"{MANUAL_LOGIN_TIMEOUT_MS/1000:.0f}s. Continuing anyway."
        )

# ----------------------------------------------------------------------
async def is_login_page(page) -> bool:
    """Very simple heuristic – look for the word “login” in URL or title."""
    url   = page.url.lower()
    title = (await page.title()).lower()
    return ("login" in url) or ("login" in title)

# ----------------------------------------------------------------------
async def click_first_result(page) -> bool:
    """
    On the search‑result page click the first <li class="list-group-item">
    (the clickable link is the <a> inside that <li>).
    Returns True on success, False otherwise.
    """
    try:
        await page.wait_for_selector(".list-group-item", timeout=15_000)
        first_link = page.locator(".list-group-item a").first
        await first_link.wait_for(state="visible", timeout=10_000)
        await first_link.click()
        await page.wait_for_load_state("domcontentloaded", timeout=15_000)
        return True
    except PlaywrightTimeoutError:
        logging.warning("No list‑group‑item appeared or could not be clicked.")
        return False
    except Exception as exc:
        logging.error(f"Error while clicking first result: {exc}")
        return False

# ----------------------------------------------------------------------
def find_email_by_regex(text: str) -> str | None:
    """Return the first …@dartmouth.edu match in *text* or None."""
    pattern = r"[a-zA-Z0-9._%+-]+@dartmouth\.edu"
    m = re.search(pattern, text)
    return m.group(0) if m else None

# ----------------------------------------------------------------------
async def extract_email(page) -> str:
    """
    1️⃣ Try the explicit <span class="contact-value"> selector.
    2️⃣ If that fails, scan the whole rendered HTML for an e‑mail.
    3️⃣ If still nothing, scan the visible body text.
    Returns the e‑mail string or a placeholder like "Not Found".
    """
    # ---- fast path – explicit span ----
    try:
        span = page.locator('span.contact-value').first
        await span.wait_for(state="visible", timeout=5_000)
        email = (await span.inner_text()).strip()
        if "@" in email and email.lower().endswith("@dartmouth.edu"):
            return email
    except PlaywrightTimeoutError:
        logging.debug("contact-value span not present – will use regex fallback.")
    except Exception as exc:
        logging.error(f"Error reading contact-value span: {exc}")

    # ---- fallback 1 – raw HTML ----
    try:
        html = await page.content()
        email = find_email_by_regex(html)
        if email:
            return email
    except Exception as exc:
        logging.error(f"Regex over HTML failed: {exc}")

    # ---- fallback 2 – visible text only ----
    try:
        visible = await page.inner_text("body")
        email = find_email_by_regex(visible)
        if email:
            return email
    except Exception as exc:
        logging.error(f"Regex over visible text failed: {exc}")

    return "Not Found"

# ----------------------------------------------------------------------
async def process_one_org(page, org_name: str) -> str:
    """
    Full pipeline for a single organization:
      1️⃣ Build the search URL & navigate.
      2️⃣ If a login page sneaks in, wait for login to finish.
      3️⃣ Click the first result.
      4️⃣ Extract the e‑mail (span + regex fallback).
      5️⃣ Return to the search page for the next organization.
    """
    search_url = make_search_url(org_name)
    logging.info(f"Searching for '{org_name}' → {search_url}")

    # ---- 1️⃣ navigate -------------------------------------------------
    try:
        await page.goto(search_url, wait_until="domcontentloaded", timeout=30_000)
    except PlaywrightTimeoutError:
        logging.error(f"Navigation timeout for {org_name}")
        return "Navigation timeout"

    # ---- 2️⃣ unexpected login page ----------------------------------
    if await is_login_page(page):
        logging.info("Login page detected after navigation – waiting.")
        await wait_until_back_on_signup(page)
        await page.goto(search_url, wait_until="domcontentloaded", timeout=30_000)

    # ---- 3️⃣ click first result ---------------------------------------
    if not await click_first_result(page):
        return "No search result"

    # ---- 4️⃣ extract e‑mail -------------------------------------------
    email = await extract_email(page)

    # ---- 5️⃣ go back to search page ----------------------------------
    await page.go_back()
    await page.wait_for_load_state("domcontentloaded")
    return email

# ----------------------------------------------------------------------
async def main():
    # ------------------- logging ---------------------------------------
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )

    # ------------------- load org list ---------------------------------
    if not INPUT_FILE.is_file():
        logging.error(f"Input file not found: {INPUT_FILE}")
        sys.exit(1)

    org_names = [
        line.strip()
        for line in INPUT_FILE.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]

    logging.info(f"Loaded {len(org_names)} organization names from {INPUT_FILE}")

    # ------------------- open NDJSON file for incremental writes -------
    # We open it once and keep it open, writing each result as we get it.
    out_f = OUTPUT_JSONL.open("w", encoding="utf-8")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=HEADLESS_MODE)
        context = await browser.new_context(user_agent=USER_AGENT)
        page = await context.new_page()

        # ---- 0️⃣ go straight to the login URL -------------------------
        await page.goto(HOME_URL, wait_until="domcontentloaded")
        # ---- 1️⃣ wait until we are back on the club‑signup page --------
        await wait_until_back_on_signup(page)

        # ---- 2️⃣ process each organization -----------------------------
        for idx, org in enumerate(org_names, start=1):
            logging.info(f"[{idx}/{len(org_names)}] Processing: {org}")
            email = await process_one_org(page, org)

            # Live terminal feedback – only print when we really got an email
            if email not in ("Not Found", "No search result", "Navigation timeout"):
                print(f"✅ {org}: {email}")

            # Write incrementally as NDJSON (one line per org)
            obj = {org: email}
            out_f.write(json.dumps(obj, ensure_ascii=False) + "\n")
            out_f.flush()          # make sure it’s on disk even if we crash
            # Polite short pause
            await asyncio.sleep(0.4)

        await browser.close()

    out_f.close()
    logging.info(f"All done – results written incrementally to {OUTPUT_JSONL}")

# ----------------------------------------------------------------------
if __name__ == "__main__":
    # ------------------- CLI flag for headed vs headless -------------
    import argparse

    parser = argparse.ArgumentParser(
        description="Scrape Dartmouth organization e‑mail addresses"
    )
    parser.add_argument(
        "--headed",
        action="store_true",
        help="Run Chromium in headed (visible) mode instead of headless",
    )
    args = parser.parse_args()

    if args.headed:
        HEADLESS_MODE = False

    # Also respect PLAYWRIGHT_HEADLESS env var (0/false → headed)
    if os.getenv("PLAYWRIGHT_HEADLESS") in ("0", "false", "False"):
        HEADLESS_MODE = False

    asyncio.run(main())