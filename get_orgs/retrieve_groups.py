#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
retrieve_groups_fixed.py
-----------------------

A Playwright scraper that:

* Opens the Dartmouth Groups club‑signup page in a **visible** Chromium window.
* Dismisses the cookie‑consent banner (if it appears).
* Waits until elements with class `list-group-item` are present.
* For each element it tries to read an `aria-label` **on the element itself
  or on any child element** (the usual location is the <a> inside the <li>).
* If no `aria‑label` is found it falls back to the element’s visible text.
* Writes one label per line to `aria_labels.txt`.
* Leaves the browser open for you to inspect; press ENTER to exit.

Prerequisites
-------------
    pip install --upgrade playwright
    playwright install chromium

Run
---
    python retrieve_groups_fixed.py
"""

import asyncio
import logging
import sys
from pathlib import Path

from playwright.async_api import (
    async_playwright,
    TimeoutError as PlaywrightTimeoutError,
)

# ----------------------------------------------------------------------
# Configuration ---------------------------------------------------------
# ----------------------------------------------------------------------
URL = "https://dartmouthgroups.dartmouth.edu/club_signup?view=all&"
OUTPUT_FILE = Path("aria_labels.txt")

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

MAX_WAIT_MS = 60_000          # time we wait for the list to appear
POST_LOAD_PAUSE = 0.5         # tiny pause after the list appears (animation safety)


# ----------------------------------------------------------------------
# Helper: dismiss cookie banner -------------------------------------------------
# ----------------------------------------------------------------------
async def dismiss_cookie_banner(page) -> None:
    """Click the “Accept / I Agree / Got it / Close” button if the banner appears."""
    selectors = [
        "button:has-text('Accept')",
        "button:has-text('I Agree')",
        "button:has-text('Got it')",
        "button:has-text('Close')",
    ]
    for sel in selectors:
        try:
            btn = await page.wait_for_selector(sel, timeout=5_000)
            await btn.click()
            logging.info(f"Cookie banner dismissed via selector `{sel}`.")
            await asyncio.sleep(1)               # let the page settle
            return
        except PlaywrightTimeoutError:
            continue
    logging.info("No cookie banner detected (or it vanished on its own).")


# ----------------------------------------------------------------------
# Core scraper ------------------------------------------------------------
# ----------------------------------------------------------------------
async def scrape() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )

    async with async_playwright() as p:
        # --------------------------------------------------------------
        # 0️⃣ Launch a **visible** Chromium instance (headless=False)
        # --------------------------------------------------------------
        browser = await p.chromium.launch(
            headless=False,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--start-maximized",
            ],
        )
        context = await browser.new_context(
            user_agent=USER_AGENT,
            viewport={"width": 1440, "height": 900},
            ignore_https_errors=True,
        )
        page = await context.new_page()

        # --------------------------------------------------------------
        # 1️⃣ Navigate – wait for network idle, no hard timeout
        # --------------------------------------------------------------
        try:
            await page.goto(URL, wait_until="networkidle", timeout=0)
            logging.info(f"Navigated to {URL}")
        except Exception as exc:
            logging.error(f"Navigation failed: {exc}")
            await browser.close()
            sys.exit(1)

        # --------------------------------------------------------------
        # 2️⃣ Dismiss the cookie banner
        # --------------------------------------------------------------
        await dismiss_cookie_banner(page)

        # --------------------------------------------------------------
        # 3️⃣ Wait for at least one .list-group-item to appear
        # --------------------------------------------------------------
        try:
            await page.wait_for_selector(".list-group-item", timeout=MAX_WAIT_MS)
            logging.info("List items are now present in the DOM.")
        except PlaywrightTimeoutError:
            logging.error(
                f"Timed out after {MAX_WAIT_MS/1000:.0f}s waiting for '.list-group-item'."
            )
            await browser.close()
            sys.exit(1)

        # Small pause so any fade‑in animation finishes
        await asyncio.sleep(POST_LOAD_PAUSE)

        # --------------------------------------------------------------
        # 4️⃣ Grab all matching elements
        # --------------------------------------------------------------
        items = await page.query_selector_all(".list-group-item")
        logging.info(f"Found {len(items)} elements with class 'list-group-item'.")

        # --------------------------------------------------------------
        # 5️⃣ Extract aria‑label (or fallback text) from each element
        # --------------------------------------------------------------
        labels = []
        for idx, el in enumerate(items, start=1):
            # First try the element itself
            aria = await el.get_attribute("aria-label")

            # If the element doesn't have it, look for a descendant with the attribute
            if not aria:
                # `.query_selector` returns the *first* matching descendant
                desc = await el.query_selector("[aria-label]")
                if desc:
                    aria = await desc.get_attribute("aria-label")

            # Final fallback: use the visible text of the element
            if not aria:
                aria = (await el.inner_text()).strip()

            # Save the cleaned value
            if aria:
                labels.append(aria)
            else:
                # This would be very unusual – print a debug line just in case
                logging.debug(f"Element #{idx} yielded no aria‑label nor text.")

            # ---- DEBUG: print a short HTML snippet for the first 3 items ----
            if idx <= 3:
                outer = await el.evaluate("el => el.outerHTML")
                snippet = outer[:200] + ("…" if len(outer) > 200 else "")
                logging.info(f"Item #{idx} HTML snippet:\n{snippet}")

        # --------------------------------------------------------------
        # 6️⃣ Write the labels to a UTF‑8 text file
        # --------------------------------------------------------------
        OUTPUT_FILE.write_text("\n".join(labels), encoding="utf-8")
        logging.info(f"Wrote {len(labels)} aria‑label values → {OUTPUT_FILE}")

        # --------------------------------------------------------------
        # 7️⃣ Keep the browser window open for manual inspection
        # --------------------------------------------------------------
        print("\n=== DONE ===")
        print("The Chrome window is still open.")
        print("Close it manually when you’re finished, or press ENTER here to quit.")
        input(">> ")

        await browser.close()


def main() -> None:
    try:
        asyncio.run(scrape())
    except KeyboardInterrupt:
        sys.exit("\nInterrupted by user.")


if __name__ == "__main__":
    main()