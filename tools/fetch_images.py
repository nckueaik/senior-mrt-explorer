"""從維基共享資源找開放授權圖片，下載 960px 縮圖到 img/，並輸出作者與授權。

用法：python -I tools/fetch_images.py            （列出候選）
      python -I tools/fetch_images.py --download  （下載 CHOSEN 指定的檔案）
只接受 CC0、公有領域、CC BY、CC BY-SA。
"""
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "senior-mrt-explorer/0.1 (personal non-commercial project)"}
OK_LICENSE = re.compile(r"^(CC0|Public domain|PD|CC BY(-SA)? [\d.]+)", re.I)

SEARCH = {
    "xinzhuang-ciyou": "新莊慈祐宮",
    "xianse-temple": "Xianse Temple Sanchong",
    "dihua-street": "Dihua Street Taipei",
    "tfam": "Taipei Fine Arts Museum",
    "shilin-residence": "Shilin Official Residence garden",
    "railway-dept": "Railway Department Park Taipei",
    "cks-hall": "Chiang Kai-shek Memorial Hall",
    "longshan-temple": "Lungshan Temple Manka",
    "beitou-museum": "Beitou Hot Spring Museum",
    "tamsui-riverside": "Tamsui waterfront",
}

# 人工挑選後填入：spot id -> Commons 檔名（File: 後面的部分）
CHOSEN = {
    "xinzhuang-ciyou": "Xinzhuang Temple of Goddess of Mercy-01.2025-01-05.jpg",
    "xianse-temple": "Roof of the Sanchong Xianse Temple-03.2025-01-22.jpg",
    "dihua-street": "DiHua Street Sec.1, Taipei (at YongChang Street).jpg",
    "tfam": "Taipei Fine Arts Museum 20230910.jpg",
    "shilin-residence": "Rose Garden, Shilin Official Residence 02 20251129.jpg",
    "railway-dept": "Building No. 4, 8, 9 of National Taiwan Museum Railway Department Park-02.2024-05-18.jpg",
    "cks-hall": "Chiang Kai-shek Memorial Hall 2009 amk.JPG",
    "longshan-temple": "Taipei Taiwan Mengjia-Longshan-Temple-02.jpg",
    "beitou-museum": "Beitou Hot Spring Museum, Taipei, Taiwan.jpg",
    "tamsui-riverside": "Danshui waterfront.jpg",
}


def fetch(url):
    for wait in (3, 10, 30, 60):
        time.sleep(wait)  # 維基共享資源有流量限制，慢慢來
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
    raise RuntimeError("維基共享資源持續回應 429，請稍後再試")


def api(params):
    return json.loads(fetch(API + "?" + urllib.parse.urlencode({**params, "format": "json"})))


def strip_html(s):
    return re.sub(r"<[^>]+>", "", s or "").strip()


def info(titles):
    data = api({
        "action": "query", "titles": "|".join(titles), "prop": "imageinfo",
        "iiprop": "url|extmetadata|size", "iiurlwidth": 960,
    })
    out = []
    for p in data["query"]["pages"].values():
        ii = (p.get("imageinfo") or [None])[0]
        if not ii:
            continue
        meta = ii.get("extmetadata", {})
        out.append({
            "title": p["title"],
            "license": strip_html(meta.get("LicenseShortName", {}).get("value")),
            "author": strip_html(meta.get("Artist", {}).get("value")),
            "thumb": ii.get("thumburl"),
            "page": ii.get("descriptionurl"),
            "w": ii.get("width"), "h": ii.get("height"),
        })
    return out


def candidates(q):
    res = api({"action": "query", "list": "search", "srsearch": q, "srnamespace": 6, "srlimit": 12})
    titles = [r["title"] for r in res["query"]["search"] if re.search(r"\.(jpe?g|png)$", r["title"], re.I)]
    return [c for c in info(titles) if OK_LICENSE.match(c["license"]) and c["w"] >= c["h"]] if titles else []


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    if "--download" in sys.argv:
        credits = {}
        (ROOT / "img").mkdir(exist_ok=True)
        for sid, title in CHOSEN.items():
            c = info([f"File:{title}"])[0]
            assert OK_LICENSE.match(c["license"]), c
            dest = ROOT / "img" / f"{sid}.jpg"
            dest.write_bytes(fetch(c["thumb"]))
            credits[sid] = {"src": f"img/{sid}.jpg", "author": c["author"], "license": c["license"], "source": c["page"]}
            print(sid, c["license"], c["author"])
        (ROOT / "tools" / "raw" / "image-credits.json").write_text(json.dumps(credits, ensure_ascii=False, indent=1), encoding="utf-8")
        return
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    for sid, q in SEARCH.items():
        if only and sid not in only:
            continue
        print(f"\n## {sid}  ({q})")
        for c in candidates(q)[:6]:
            print(f"  {c['title'][5:]} | {c['license']} | {c['author'][:40]} | {c['w']}x{c['h']}")


if __name__ == "__main__":
    main()
