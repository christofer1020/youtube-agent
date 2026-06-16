#!/usr/bin/env python3
"""
backend.py — YouTube Interest Profiler (engine only)
=====================================================

A pure data engine. It does NOT render any HTML. It:

  1. Opens YouTube in a real Chrome session (you log in by hand).
  2. Scrapes your recommended feed (and, on request, your Watch History).
  3. Sends the video titles to Groq (Llama 3) for a psychological taste profile.
  4. Writes the result to  data.json  next to this file.

The front-end (index.html / style.css / app.js) reads data.json and draws the
Windows 95 desktop UI. Backend and front-end are fully decoupled — the only
contract between them is the shape of data.json described below.

----------------------------------------------------------------------------
data.json contract — exactly what the front-end reads
----------------------------------------------------------------------------
{
  "generated_at": "14 Jun 2026  12:16",
  "source":       "feed + history",
  "video_count":  42,
  "titles":       ["...", "..."],                  # raw scraped titles
  "profile": {
    "dominant_theme":      "string",
    "personality_summary": "string",
    "watch_style":         "Deep Diver | Casual Browser | Learning-Focused | Entertainment-Seeker",
    "hidden_passion":      "string",
    "sample_titles":       ["...", "...", "..."],
    "top_interests": [
      { "category": "string", "confidence": 0-100, "reason": "string", "emoji": "🎮" }
    ]
  }
}
----------------------------------------------------------------------------

Quick start
-----------
    pip install undetected-chromedriver selenium groq
    export GROQ_API_KEY="gsk_..."   # or put it in a .env file (see README)

    python backend.py                    # scrape + analyse -> data.json -> open UI
    python backend.py --sample           # write a demo data.json -> open UI (no Chrome, no Groq)

The UI is served automatically: once the analysis finishes, this script starts a
local http.server on port 8000 and opens http://localhost:8000 in your browser.
Leave it running and press Ctrl+C when you're done.
"""

import os
import re
import sys
import json
import time
import argparse
import threading
import webbrowser
import functools
import http.server
import socketserver
from pathlib import Path
from datetime import datetime

# ── Paths & configuration ────────────────────────────────────────────────────
HERE          = Path(__file__).parent
OUT_JSON      = HERE / "data.json"

# Read the key from the GROQ_API_KEY environment variable (set it in .env — never hardcode it here).
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
MODEL         = "llama-3.3-70b-versatile"
TARGET_VIDEOS = 25
HISTORY_TARGET = 40
SCROLL_PAUSE  = 2.0
MAX_RETRIES   = 3


# ── Lazy imports (so --sample works without Chrome/Groq installed) ────────────
def _require_selenium():
    try:
        import undetected_chromedriver as uc
        from selenium.webdriver.common.by import By
        return uc, By
    except Exception as e:
        sys.exit(f"❌  Selenium stack missing: {e}\n    pip install undetected-chromedriver selenium")


def _groq_client():
    try:
        from groq import Groq
    except ImportError:
        sys.exit("❌  Groq SDK missing.  pip install groq")
    if not GROQ_API_KEY:
        sys.exit("❌  No Groq API key found.\n    Set it with:  export GROQ_API_KEY=\"gsk_...\"\n    Or create a .env file with:  GROQ_API_KEY=gsk_...")
    return Groq(api_key=GROQ_API_KEY)


# ── Browser launch ────────────────────────────────────────────────────────────
def launch_driver():
    uc, _ = _require_selenium()
    print("  🚀  Launching a clean Chrome session…")
    options = uc.ChromeOptions()
    options.add_argument("--start-maximized")
    options.add_argument("--no-first-run")
    options.add_argument("--no-default-browser-check")
    return uc.Chrome(options=options, use_subprocess=True)


# ── Scraping ──────────────────────────────────────────────────────────────────
def _collect_titles(driver, By, target, max_scrolls, label):
    titles, scrolls = set(), 0
    selector = "#video-title, #video-title-link, a.yt-simple-endpoint"
    while len(titles) < target and scrolls < max_scrolls:
        for el in driver.find_elements(By.CSS_SELECTOR, selector):
            try:
                t = el.get_attribute("title") or el.text
                if t and len(t) > 3:
                    titles.add(t.strip())
            except Exception:
                pass
        if len(titles) >= target:
            break
        driver.execute_script("window.scrollBy(0, window.innerHeight * 1.5)")
        time.sleep(SCROLL_PAUSE)
        scrolls += 1
        print(f"     → {len(titles)} {label} titles  (scroll {scrolls})", end="\r")
    print(f"\n  ✓  Collected {len(titles)} {label} titles.\n")
    return list(titles)[:target]


def scrape_feed_titles(driver, target=TARGET_VIDEOS):
    _, By = _require_selenium()
    print(f"  🔍  Scrolling the YouTube feed for ~{target} titles…")
    return _collect_titles(driver, By, target, max_scrolls=35, label="feed")


def scrape_history_titles(driver, target=HISTORY_TARGET):
    _, By = _require_selenium()
    print("  📼  Switching to Watch History for a deeper read…")
    driver.get("https://www.youtube.com/feed/history")
    time.sleep(3)
    return _collect_titles(driver, By, target, max_scrolls=20, label="history")


# ── AI analysis ───────────────────────────────────────────────────────────────
SYSTEM_INSTRUCTION = """
You are an elite AI Interest Profiler and Detective.
Your goal is not just to summarize, but to psychoanalyze the user based on their YouTube watch history.

RULES:
1. FILTER NOISE: Ignore one-off, random videos (e.g. a single science video in a gaming feed). Focus on repeating patterns and genres.
2. CONNECT THE DOTS: Find hidden connections.
   - If you see [Gaming] + [Tech], suggest he is a "Power User".
   - If you see [Anime] + [Cooking/Travel], suggest he is interested in Japanese Culture/Language.
   - If you see [FromSoftware games] + [Challenge runs], suggest similar "Masocore" titles.
3. PERSONALITY: Be witty, observant, and insightful. Avoid corporate/robotic language.
4. DETECT PASSION: Identify one "Hidden Passion" the user might not even realize they are developing.
5. OUTPUT: Return valid JSON only (no markdown, no backticks).
""".strip()


def analyze_interests(titles, source="feed"):
    print("  🤖  Analyzing patterns with Llama 3…")
    client = _groq_client()
    titles_block = "\n".join(f"- {t}" for t in titles)

    user_prompt = f"""
Analyze these video titles and build a psychological profile of the viewer:

{titles_block}

Respond with this exact JSON structure:
{{
  "top_interests": [ {{"category": "Name", "confidence": 0-100, "reason": "Deep insight", "emoji": "🎮"}} ],
  "personality_summary": "Three sentences, conversational tone. Point out the connection between genres.",
  "dominant_theme": "The core vibe",
  "watch_style": "Deep Diver | Casual Browser | Learning-Focused | Entertainment-Seeker",
  "sample_titles": ["Pick 3 titles that represent the core interest"],
  "hidden_passion": "Explain the subtle connection you found."
}}
""".strip()

    resp = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_INSTRUCTION},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=2048,
        temperature=0.6,
    )
    raw = resp.choices[0].message.content.strip()
    raw = re.sub(r"```json|```", "", raw).strip()
    try:
        return json.loads(raw)
    except Exception as e:
        print(f"  ⚠️  Could not parse model JSON ({e}); writing a minimal profile.")
        return {
            "top_interests": [],
            "personality_summary": "The model returned an unparseable response. Try running again.",
            "dominant_theme": "Mixed",
            "watch_style": "Casual Browser",
            "sample_titles": titles[:3],
            "hidden_passion": "N/A",
        }


# ── Payload assembly + write ──────────────────────────────────────────────────
def build_payload(profile, titles, source):
    return {
        "generated_at": datetime.now().strftime("%d %b %Y  %H:%M"),
        "source": source,
        "video_count": len(titles),
        "titles": titles,
        "profile": profile,
    }


def save_json(payload, path=OUT_JSON):
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  💾  Wrote {path.name}  ({payload['video_count']} videos analysed).")


# ── Demo payload (matches the front-end's built-in fallback) ──────────────────
def sample_payload():
    titles = [
        "I beat Elden Ring at level 1 (no hits, no summons)",
        "Why Sekiro's combat is the best ever designed",
        "Building a $2,000 small form-factor PC in 2026",
        "Frieren is the best anime of the decade — here's why",
        "How to make tonkotsu ramen broth from scratch (18 hrs)",
        "Lo-fi beats to code / study to — 24/7 radio",
        "The hidden lore of Bloodborne explained",
        "Tokyo at night: a walking tour through Shinjuku",
        "I tried living like a Japanese minimalist for 30 days",
        "Optimising Linux for low-latency gaming",
        "Every Dark Souls boss ranked from worst to best",
        "Learning Japanese with anime — does it actually work?",
        "Mechanical keyboard sound test (40 switches)",
        "Authentic gyoza at home — the technique nobody shows you",
        "Cyberpunk 2077 photo-mode masterclass",
        "Why I switched my whole setup to a tiling window manager",
        "A quiet day in a Kyoto tea house (ASMR)",
        "Soulslike beginners guide: stop dodging, start parrying",
    ]
    profile = {
        "dominant_theme": "The Nocturnal Power-User",
        "watch_style": "Deep Diver",
        "personality_summary": (
            "You don't just play games, you study them — the Souls deep-dives sit right "
            "next to PC-tuning guides, which is the signature of someone who treats their "
            "hobbies like systems to master. The anime and the ramen tutorials aren't a "
            "separate lane; they're the same curiosity pointed at Japan. Late-night lo-fi "
            "ties the whole thing together: this is a focused, build-it-yourself kind of mind."
        ),
        "hidden_passion": (
            "Your anime picks lean toward slow, atmospheric, distinctly Japanese stories, "
            "and they keep landing next to ramen, gyoza and Tokyo walking tours. That's not "
            "a coincidence — under the gaming is a quietly growing pull toward Japanese "
            "culture and language. You're closer to booking a Kyoto trip than you think."
        ),
        "sample_titles": [
            "I beat Elden Ring at level 1 (no hits, no summons)",
            "Learning Japanese with anime — does it actually work?",
            "How to make tonkotsu ramen broth from scratch (18 hrs)",
        ],
        "top_interests": [
            {"category": "Soulslike Mastery", "confidence": 95, "emoji": "⚔️",
             "reason": "Not casual playthroughs — challenge runs, lore breakdowns and boss rankings. You want to *understand* the design, not just clear it."},
            {"category": "PC Building & Tuning", "confidence": 88, "emoji": "🖥️",
             "reason": "SFF builds, Linux latency tweaks, tiling window managers. Classic power-user signal: the setup is part of the hobby."},
            {"category": "Japanese Culture", "confidence": 80, "emoji": "🎌",
             "reason": "Atmospheric anime plus Tokyo tours and minimalism experiments. This is curiosity about a place, not just a genre."},
            {"category": "Cooking (Japanese)", "confidence": 72, "emoji": "🍜",
             "reason": "Ramen, gyoza, technique-first videos. You cook the things you watch — the interest is hands-on, not passive."},
            {"category": "Focus & Ambient Audio", "confidence": 64, "emoji": "🎧",
             "reason": "Lo-fi radios and ASMR tea houses. Background fuel for long, deep sessions on everything else."},
        ],
    }
    return build_payload(profile, titles, "sample data")


# ── Local HTTP server (start / stop helpers) ───────────────────────────────────────
def start_ui_server(port: int = 8000):
    """Start a daemon http.server on `port` and return (server, thread). Non-blocking."""
    handler = functools.partial(
        http.server.SimpleHTTPRequestHandler,
        directory=str(HERE),
    )
    # suppress the default per-request log lines
    handler.log_message = lambda *_: None  # type: ignore[method-assign]

    server = http.server.ThreadingHTTPServer(("", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


def stop_ui_server(server, thread) -> None:
    """Stop serve_forever, release the port, and let the daemon thread exit."""
    server.shutdown()        # break out of serve_forever()
    server.server_close()    # release port 8000 so the next pass can rebind cleanly
    thread.join(timeout=5)   # wait for the server thread to actually finish


def open_browser(port: int = 8000) -> None:
    url = f"http://localhost:{port}"
    print(f"\n  🌐  Server running at {url}")
    print("       Opening your browser now…")
    webbrowser.open_new(url)


# ── Incremental scraping (reuse the same browser session) ──────────────────────────────────────────────────────
def collect_more(driver, titles, retries, used_history):
    """Called on a 'no'. Reuse the SAME logged-in Chrome session — never relaunch.

    Retries 1..MAX_RETRIES scroll the feed further (~10 more titles each pass).
    After that, switch to the Watch History (first ~30 watched) and, on any
    further 'no', keep pulling more. Titles accumulate across every pass.
    Returns (titles, source, used_history).
    """
    if not used_history and retries <= MAX_RETRIES:
        # Bumping the target makes _collect_titles keep scrolling from where the
        # page already is, so each 'no' digs ~10 videos deeper into the feed.
        feed_target = TARGET_VIDEOS + 10 * retries          # 35, 45, 55, …
        print(f"\n  ⬇️   Scrolling the feed for ~10 more videos (target {feed_target})…")
        titles.update(scrape_feed_titles(driver, target=feed_target))
        return titles, "feed", used_history

    # Three feed passes weren't enough → dig into the Watch History instead.
    if not used_history:
        used_history = True
        print("\n  📼  Feed exhausted — switching to your Watch History…")
        titles.update(scrape_history_titles(driver, target=30))   # first ~30 watched
    else:
        hist_target = 30 + 10 * (retries - MAX_RETRIES - 1)       # 40, 50, … later
        print(f"\n  📼  Pulling more Watch History (target {hist_target})…")
        titles.update(scrape_history_titles(driver, target=hist_target))
    return titles, "feed + history", used_history


# ── Argument parsing ──────────────────────────────────────────────────────────
def parse_args():
    parser = argparse.ArgumentParser(description="YouTube Interest Profiler engine.")
    parser.add_argument("--sample", action="store_true",
                        help="Use a demo data.json on each pass (no Chrome, no Groq).")
    return parser.parse_args()


# ── Main feedback loop ──────────────────────────────────────────────────────────
def main(port: int = 8000) -> None:
    args = parse_args()
    sample = args.sample

    server = thread = driver = None
    titles, source = set(), "sample data"
    used_history, retries = False, 0

    try:
        # Launch Chrome + log in exactly ONCE; this session is reused on every 'no'.
        if not sample:
            driver = launch_driver()
            driver.get("https://www.youtube.com")
            input("  Press ENTER once you are logged in → ")
            titles = set(scrape_feed_titles(driver, target=TARGET_VIDEOS))
            source = "feed"

        while True:
            # 1. analyse whatever we've gathered so far and write data.json
            if sample:
                payload = sample_payload()
            else:
                profile = analyze_interests(sorted(titles), source=source)
                payload = build_payload(profile, sorted(titles), source)
            save_json(payload)

            # 2. serve the fresh profile and open the UI tab
            server, thread = start_ui_server(port)
            time.sleep(1)  # let the socket settle before the browser fires
            open_browser(port)

            # 3. block on the verdict
            answer = input("\n  Is the profile accurate? [y/n] → ").strip().lower()

            # 4. release only the UI server — the Chrome session stays open
            stop_ui_server(server, thread)
            server = thread = None

            if answer in ("y", "yes"):
                print("\n  ✅  Profile confirmed — data.json is final. Bye!")
                break

            if sample:
                print("\n  🔁  (sample mode) no live data to pull — re-writing the demo…\n")
                continue

            # 5. NOT accurate: keep the same browser, just gather more and re-loop
            retries += 1
            titles, source, used_history = collect_more(driver, titles, retries, used_history)
    except KeyboardInterrupt:
        print("\n  🛑  Interrupted.")
    finally:
        if server is not None:
            stop_ui_server(server, thread)
        if driver is not None:
            driver.quit()


if __name__ == "__main__":
    main()