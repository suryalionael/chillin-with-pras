#!/usr/bin/env python3
"""Build content.json — the master content model for the redesign."""
import json, glob, re
from html.parser import HTMLParser

OBSERVE_ORDER = ["the-wall", "small-town-hospitality", "fox-on-the-beach",
    "detox-diet---an-exercise-in", "my-guitar-gently-weeps", "the-long-goodbye",
    "great-white", "the-forbidden-fruit", "life-cycle",
    "game-is-no-walk-in-the-park", "satday-nite-lites",
    "fun-dining-in-the-big-apple", "street-music",
    "an-introspection-of-introve", "exhibit-starman", "mend-my-broken-heart",
    "comic-conned", "cross-country-chillin", "creatures-of-habit",
    "bamboo-music", "gone-fishing", "of-golden-bridges-longing",
    "frozen-in-time", "south-of-south-of-the-borde",
    "artificial-worlds-and-natur", "morocco-moments", "unfinished-business",
    "finding-fado", "focus-on-havana", "desert-life"]

SHOW_ORDER = ["carvin-pumpkin", "windows-to-the-world",
    "bringing-bagong-back", "the-artists-den", "food-for-thought"]

DATELINES = {
    "the-wall": "April 2012", "small-town-hospitality": "May 28, 2012",
    "fox-on-the-beach": "August 2012", "detox-diet---an-exercise-in": "September 2012",
    "my-guitar-gently-weeps": "September 2012", "the-long-goodbye": "December 2012",
    "great-white": "December 24, 2012", "the-forbidden-fruit": "March 2013",
    "life-cycle": "Spring 2013", "game-is-no-walk-in-the-park": "June 2013",
    "satday-nite-lites": "June 15, 2013", "fun-dining-in-the-big-apple": "July 2013",
    "street-music": "July 28, 2013", "an-introspection-of-introve": "September 2013",
    "exhibit-starman": "November 2013", "mend-my-broken-heart": "December 2013",
    "comic-conned": "January 2014", "cross-country-chillin": "February 2014",
    "creatures-of-habit": "February 2014", "bamboo-music": "June 2014",
    "gone-fishing": "September 2014", "of-golden-bridges-longing": "October 2014",
    "frozen-in-time": "December 2014", "south-of-south-of-the-borde": "April 2015",
    "artificial-worlds-and-natur": "November 2015", "morocco-moments": "March 2016",
    "unfinished-business": "June 2016", "finding-fado": "September 2016",
    "focus-on-havana": "December 2016", "desert-life": "August 2017",
}

# Verbatim in-article section markers worth styling as subheads (exact strings)
SUBHEADS = {
    "the-wall": ["The Inspiration", "The Process", "The Cost", "The Result"],
    "focus-on-havana": ["Landmarks and Landscapes", "Street-scenes and Social life",
                        "Walls and Windows", "Time-travel", "Shapes and Silhouoettes",
                        "Sunsets and Night Shots"],
}


class FullParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.blocks = []
        self.in_main = False
        self.main_depth = 0
        self.in_rich = False
        self.rich_depth = 0
        self.cur = None
        self.title = None
        self.t_done = False
        self.h2d = 0
        self.in_h2p = False
        self.tparts = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "div" and a.get("id") == "main":
            self.in_main = True
            self.main_depth = 1
            self.rich_depth = 1
            return
        if not self.in_main:
            return
        self.main_depth += 1
        cls = a.get("class", "").split()
        if tag == "h2" and "title" in cls:
            self.in_h2p = True
            self.tparts = []
        elif self.in_h2p:
            self.h2d += 1
        elif tag == "div" and "RichTextElement" in cls:
            self.in_rich = True
            self.rich_depth = self.main_depth
        elif self.in_rich:
            if tag == "p":
                self.flush_p()
                self.cur = {"type": "p", "text": [], "style": a.get("style", "")}
                self.pd = self.main_depth
            elif tag == "img":
                self.flush_p()
                self.blocks.append({"type": "img", "src": a.get("src", ""),
                                    "alt": a.get("alt", ""),
                                    "width": a.get("width"), "height": a.get("height")})

    def flush_p(self):
        if self.cur and self.cur["type"] == "p":
            text = "".join(self.cur["text"])
            text = re.sub(r"\s+", " ", text).strip()
            if text:
                self.blocks.append({"type": "p", "text": text, "style": self.cur["style"]})
        self.cur = None

    def handle_endtag(self, tag):
        if not self.in_main:
            return
        if tag == "p" and self.cur and self.cur["type"] == "p":
            self.flush_p()
        if tag == "h2":
            if self.in_h2p:
                self.title = "".join(self.tparts).strip()
                self.in_h2p = False
        elif self.in_h2p:
            self.h2d -= 1
        if tag == "div":
            self.main_depth -= 1
            if self.main_depth == 0:
                self.in_main = False
            if self.in_rich and self.main_depth < self.rich_depth:
                self.in_rich = False

    def handle_data(self, data):
        if self.in_h2p:
            self.tparts.append(data)
        if self.cur and self.cur["type"] == "p":
            self.cur["text"].append(data)

    def handle_startendtag(self, tag, attrs):
        a = dict(attrs)
        if tag == "img" and self.in_rich:
            self.flush_p()
            self.blocks.append({"type": "img", "src": a.get("src", ""),
                                "alt": a.get("alt", ""),
                                "width": a.get("width"), "height": a.get("height")})
        elif tag == "br" and self.cur and self.cur["type"] == "p":
            self.cur["text"].append(" ")


def parse(fp):
    html = open(fp, encoding="utf-8", errors="replace").read()
    p = FullParser()
    p.feed(html)
    p.close()
    return p


def norm_src(src):
    return src.split("/")[-1]


def dateiso(d):
    m = re.match(r"^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}, )?(\d{4})$", d)
    if not m:
        return ""
    months = {n: i + 1 for i, n in enumerate(
        ["January", "February", "March", "April", "May", "June", "July",
         "August", "September", "October", "November", "December"])}
    day = (m.group(2) or "").replace(",", "").strip() or "1"
    return f"{m.group(3)}-{months[m.group(1)]:02d}-{int(day):02d}"


sections = {
    "observe": {
        "key": "observe",
        "title": "To Observe and Report",
        "path": "/to-observe-and-report/",
        "image": "dsc_0260_2_med.jpeg",
        "imageAlt": "DSC 0260 2",
        "imagePos": 2,
        "description": [
            "The blog that talks about nothing and serves nothing.",
            "Worth something, however, are my nonsensical insights on everything trivial, under-appreciated and misunderstood. But enough talking about myself…"
        ],
    },
    "show": {
        "key": "show",
        "title": "To Show and Tell",
        "path": "/to-show-and-tell/",
        "image": "photo_2_2_med.jpeg",
        "imageAlt": "Photo 2 copy",
        "imagePos": 6,
        "description": [
            "Whoever quoted, \"A picture paints a thousand words..\", must've been too lazy to write.",
            "I can live with that.",
            "The evolution of the camera has allowed me to own and operate numerous image-producing contraptions.",
            "From my first Kodak called \"The Handle\" which was an 'instant' similar to a Polaroid, to an Olympus 35mm pocket cam, progessing to a Pentax SLR, then to the digital point-and shoots by Nikon and Canon, to what I now most often carry, which is simply an add-on feature to my cell-phone. The gadgets get smaller while the subjects become ever so diverse.",
            "Diverse as the world may be, but in line with my observations, I capture the most meaningless of all subjects, and then do my best to give them some respectability. Well, I try to…"
        ],
    },
}

articles = []
all_imgs = {}

for order, section in ((OBSERVE_ORDER, "observe"), (SHOW_ORDER, "show")):
    for seq, slug in enumerate(order, start=1):
        fp = f"html/{'observe' if section=='observe' else 'show'}/{slug}.html"
        p = parse(fp)
        blocks = []
        for b in p.blocks:
            if b["type"] == "img":
                n = norm_src(b["src"])
                all_imgs.setdefault(n, {"w": b["width"], "h": b["height"], "alt": b["alt"]})
                blocks.append({"type": "img", "file": n,
                               "alt": b["alt"], "w": b["width"], "h": b["height"]})
            else:
                blocks.append(b)
        # position images to the right page for the section header image (imagePos not needed)
        entry = {
            "path": f"/{'to-observe-and-report' if section=='observe' else 'to-show-and-tell'}/{slug}/",
            "slug": slug,
            "section": "observe" if section == "observe" else "show",
            "title": p.title,
            "order": seq,
        }
        subhead_set = set(SUBHEADS.get(slug, []))
        for blk in blocks:
            if blk["type"] == "p" and blk["text"] in subhead_set:
                blk["subhead"] = True
            entry.setdefault("blocks", []).append(blk)
        entry["dateline"] = DATELINES.get(slug, "")
        entry["dateISO"] = dateiso(entry["dateline"])
        articles.append(entry)

# home page
homep = parse("html/home.html")
home_blocks = []
for b in homep.blocks:
    if b["type"] == "img":
        n = norm_src(b["src"])
        home_blocks.append({"type": "img", "file": n, "alt": b["alt"],
                            "w": b["width"], "h": b["height"]})
    else:
        t = b["text"]
        if " 2 : a person" in t:
            pre, post = t.split(" 2 : a person", 1)
            home_blocks.append({"type": "p", "text": pre.strip()})
            home_blocks.append({"type": "p", "text": "2 : a person " + post.lstrip()})
        else:
            home_blocks.append(b)

content = {
    "site": {
        "title": "Chillin’ with Pras",
        "tagline": "A website thoughtfully crafted with Sandvox",
        "coverTitle": "Observations of a Slacker",
        "copyright": "© Prakoso Sastrowardoyo 2012",
        "author": "Prakoso Sastrowardoyo",
        "originalUrl": "https://www.chillinwithpras.com/",
        "rssPath": "/index.xml",
    },
    "home": {"blocks": home_blocks},
    "sections": sections,
    "articles": articles,
}

with open("content.json", "w", encoding="utf-8") as f:
    json.dump(content, f, indent=2, ensure_ascii=False)

print("home blocks:", len(home_blocks))
imgtotal = sum(1 for a in articles for b in a["blocks"] if b["type"] == "img")
print("articles:", len(articles), "| images in articles:", imgtotal)
print("observe:", sum(1 for a in articles if a["section"] == "observe"),
      "| show:", sum(1 for a in articles if a["section"] == "show"))