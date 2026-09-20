#!/usr/bin/env python3
"""Extract structured content from downloaded Sandvox HTML pages."""
import os, re, json, glob
from html.parser import HTMLParser

BASES = ["_Media", "../_Media"]


class ContentParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_main = False
        self.in_rich = 0
        self.main_depth = 0
        self.rich_depth = 0
        self.blocks = []          # ordered list of p / img / heading blocks
        self.cur_p = []
        self.in_p = False
        self.p_style = ""
        self.title = None
        self.in_title_h2 = False
        self.title_parts = []
        self.h2_depth = 0
        self.img_stack = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        classes = a.get("class", "").split()
        if tag == "div" and a.get("id") == "main":
            self.in_main = True
            self.main_depth = 1
            return
        if self.in_main:
            self.main_depth += 1
        if tag == "div" and "RichTextElement" in classes:
            self.in_rich += 1
        if self.in_rich:
            self.rich_depth += 1
        if tag == "h2" and "title" in classes and self.in_main:
            self.in_title_h2 = True
            self.h2_depth = 1
            self.title_parts = []
        if self.in_title_h2:
            self.h2_depth += 1
        if tag == "p" and self.in_rich:
            self.in_p = True
            self.cur_p = []
            self.p_style = a.get("style", "")
        if tag == "img" and self.in_rich:
            src = a.get("src", "")
            self.img_stack.append((src, a.get("alt", ""), a.get("width"), a.get("height")))

    def handle_endtag(self, tag):
        if tag == "div" and self.in_main:
            self.main_depth -= 1
            if self.main_depth == 0:
                self.in_main = False
            return
        if tag == "div" and self.in_rich:
            self.rich_depth -= 1
            if self.rich_depth == 0:
                self.in_rich = 0
        if tag == "h2" and self.in_title_h2:
            self.in_title_h2 = False
        if tag == "p" and self.in_rich and self.in_p:
            text = "".join(self.cur_p).strip()
            text = re.sub(r"[ \t]+", " ", text)
            if text:
                self.blocks.append({"type": "p", "text": text, "style": self.p_style})
            self.in_p = False

    def handle_data(self, data):
        if self.in_p:
            self.cur_p.append(data)
        if self.in_title_h2:
            self.title_parts.append(data)

    def handle_startendtag(self, tag, attrs):
        if tag == "img" and self.in_rich:
            a = dict(attrs)
            src = a.get("src", "")
            self.img_stack.append((src, a.get("alt", ""), a.get("width"), a.get("height")))
        if tag in ("br", "hr"):
            if self.in_p:
                self.cur_p.append(" ")

    # python html.parser converts <br /> to handle_starttag br normally, so handle here too
    def close(self):
        super().close()
        # flush flushed images: images appear inside div wrappers, we captured on startendtag


def extract(fp):
    html = open(fp, encoding="utf-8", errors="replace").read()
    # normalize <br/> occurrences that got unquoted
    parser = ContentParser()
    parser.feed(html)
    parser.close()
    data = {"file": os.path.basename(fp), "title": "".join(parser.title_parts).strip(),
            "blocks": [], "images": []}
    # merge img_stack into block sequence at correct positions: simplest: append images when seen, order preserved by parser events
    return data


class FullParser(HTMLParser):
    """Ordered block extraction from #main-content."""
    def __init__(self):
        super().__init__()
        self.blocks = []
        self.in_main = False
        self.main_depth = 0
        self.in_rich = False
        self.rich_depth = 0
        self.cur = None          # current block
        self.title = None
        self.t_done = False
        self.h2d = 0
        self.pd = 0
        self.in_h2p = False
        self.tparts = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "div" and a.get("id") == "main":
            self.in_main = True
            self.main_depth = 1
            self.rich_depth = 1
            self.cur = None
            return
        if not self.in_main:
            # title lives in h2 in main-content
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
            # main-content ends
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


def main():
    out = {"home": {}, "sections": {}, "articles": []}
    files = sorted(glob.glob("html/observe/*.html")) + sorted(glob.glob("html/show/*.html"))
    for fp in files:
        html = open(fp, encoding="utf-8", errors="replace").read()
        p = FullParser()
        p.feed(html)
        p.close()
        rel = fp.replace("html/", "").replace(".html", "")
        section = "observe" if "/observe/" in fp else "show"
        entry = {"path": rel, "section": section, "title": p.title, "blocks": p.blocks}
        out["articles"].append(entry)
        json.dump(entry, open(f"out/{os.path.basename(fp)}.json", "w"), indent=2)
    json.dump(out, open("out/all.json", "w"), indent=2)
    # print summary
    for e in out["articles"]:
        imgs = [b for b in e["blocks"] if b["type"] == "img"]
        paras = [b for b in e["blocks"] if b["type"] == "p"]
        print(f"{e['path']:55s} | {len(paras):3d}p {len(imgs):2d}img | {e['title']}")


if __name__ == "__main__":
    os.makedirs("out", exist_ok=True)
    main()