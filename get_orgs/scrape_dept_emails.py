#!/usr/bin/env python3
"""
final_scraper.py

Corrected for Playwright version compatibility.
The fix: .first (property) instead of .first() (method call).
"""
import asyncio
import json
from pathlib import Path

from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

# --- File Paths ---
BASE_DIR = Path(__file__).parent
TEMPLATE_PATH = BASE_DIR / "dept_template.jsonl"
LINKS_PATH = BASE_DIR / "links.txt"
OUTPUT_PATH = BASE_DIR / "dept_emails.jsonl"

# --- Helper Functions ---

def load_jsonl(path: Path) -> dict:
    data = {}
    for line in path.read_text(encoding="utf8").splitlines():
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
            dept, emails = next(iter(obj.items()))
            data[dept] = list(emails) if isinstance(emails, list) else [emails]
        except (json.JSONDecodeError, StopIteration):
            print(f"⚠️  Skipping malformed line: {line}")
    return data


def write_jsonl(data: dict, path: Path):
    lines = [json.dumps({dept: emails}) for dept, emails in data.items()]
    path.write_text("\n".join(lines), encoding="utf8")
    print(f"\n✅  Output successfully written to {path}")


def parse_links_from_html(file_path: Path) -> list[tuple[str, str]]:
    soup = BeautifulSoup(file_path.read_text(encoding="utf8"), "html.parser")
    pairs = []
    for a_tag in soup.select("a[href]"):
        name = " ".join(a_tag.get_text(strip=True).split())
        url = a_tag["href"]
        if name and url:
            pairs.append((name, url))
    return pairs


async def extract_email_from_page(page, url: str) -> list[str]:
    """
    Navigates to the URL and extracts the email from the `a.social-link-email`
    element's href attribute.
    """
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=20000)
        email_link_locator = page.locator("a.social-link-email")

        if await email_link_locator.count() > 0:
            # *** THE FIX IS HERE ***
            # Use .first (a property) instead of .first() (a method call)
            # This is compatible with older versions of Playwright.
            first_element = email_link_locator.first
            href = await first_element.get_attribute("href")

            if href and href.lower().startswith("mailto:"):
                email = href[7:]
                return [email]
        return []
    except Exception as e:
        print(f"    - An error occurred at {url}: {type(e).__name__} - {e}")
        return []


# --- Main Execution ---

async def main():
    dept_data = load_jsonl(TEMPLATE_PATH)
    link_pairs = parse_links_from_html(LINKS_PATH)
    url_by_name = {name: url for name, url in link_pairs}

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        for dept_name in list(dept_data.keys()):
            normalized_dept_name = " ".join(dept_name.split())

            if normalized_dept_name not in url_by_name:
                print(f"\n▶️  Skipping '{dept_name}': URL not found in links.txt.")
                continue

            url = url_by_name[normalized_dept_name]
            print(f"\n▶️  Processing '{dept_name}' → {url}")

            emails_found = await extract_email_from_page(page, url)

            if emails_found:
                print(f"✅  Email Found: {emails_found[0]}")
                dept_data[dept_name] = emails_found
            else:
                print("⚠️  Email not found using the 'a.social-link-email' selector.")
                dept_data[dept_name] = []

        await browser.close()

    write_jsonl(dept_data, OUTPUT_PATH)


if __name__ == "__main__":
    asyncio.run(main())