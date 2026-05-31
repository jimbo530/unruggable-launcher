#!/usr/bin/env python3
"""Fix share buttons on all tasern.quest HTML pages — remove broken ones, add clean one."""
import os

SHARE_LINE = '  <a href="#" onclick="event.preventDefault();var u=window.location.href;window.open(&quot;https://x.com/intent/tweet?text=&quot;+encodeURIComponent(&quot;Check out the Unrugable Launcher \u2014 permanent liquidity, carbon retirement, zero rug risk.\\n\\n&quot;+u),&quot;_blank&quot;)" style="color:var(--gold);font-weight:bold;font-size:11px">Share</a>'

DIRS = ["/var/www/tasern", "/var/www/tasern/launcher"]

for d in DIRS:
    if not os.path.isdir(d):
        continue
    for page in sorted(os.listdir(d)):
        if not page.endswith(".html"):
            continue
        path = os.path.join(d, page)
        with open(path, "r") as f:
            lines = f.readlines()

        if not any("<nav>" in l for l in lines):
            continue

        # Step 1: Remove any existing share button lines
        clean = []
        skip_until_share_end = False
        for line in lines:
            stripped = line.strip()
            # Multi-line broken share: line has onclick + preventDefault but no closing >Share</a>
            if 'onclick="event.preventDefault' in stripped and "Share</a>" not in stripped:
                skip_until_share_end = True
                continue
            if skip_until_share_end:
                if "Share</a>" in stripped or "</a>" in stripped:
                    skip_until_share_end = False
                continue
            # Single-line share button (good or bad)
            if "Share</a>" in stripped and "onclick" in stripped:
                continue
            clean.append(line)

        # Step 2: Insert share button before </div>\n</nav>
        result = []
        inserted = False
        for i, line in enumerate(clean):
            if not inserted and line.strip() == "</div>" and i + 1 < len(clean) and "</nav>" in clean[i + 1]:
                result.append(SHARE_LINE + "\n")
                inserted = True
            result.append(line)

        with open(path, "w") as f:
            f.writelines(result)
        rel = os.path.relpath(path, "/var/www/tasern")
        status = "added" if inserted else "no nav-links div found"
        print(f"  {rel}: {status}")
