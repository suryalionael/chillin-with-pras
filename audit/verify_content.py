#!/usr/bin/env python3
"""Verify content fidelity: every paragraph retrieved from the live source
must appear verbatim in the redesign's data model."""
import json, re, glob, os
from html.parser import HTMLParser


class ParaDump(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_main = False
        self.m_depth = 0
        self.in_rich = False
        self.rich_depth = 0
        self.cur = None
        self.paras = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "div" and a.get("id") == "main":
            self.in_main = True
            self.m_depth = 1
            self.rich_depth = 1
            return
        if not self.in_main:
            return
        self.m_depth += 1
        if tag == "div" and "RichTextElement" in a.get("class", "").split():
            self.in_rich = True
            self.rich_depth = self.m_depth
        elif self.in_rich and tag == "p":
            self.cur = []
            self.pd = self.m_depth

    def handle_endtag(self, tag):
        if not self.in_main:
            return
        if tag == "p" and self.cur is not None:
            t = " ".join("".join(self.cur).split()).strip()
            if t:
                self.paras.append(t)
            self.cur = None
        if tag == "div":
            self.m_depth -= 1
            if self.m_depth == 0:
                self.in_main = False
            elif self.in_rich and self.m_depth < self.rich_depth:
                self.in_rich = False

    def handle_data(self, data):
        if self.cur is not None:
            self.cur.append(data)

    def handle_startendtag(self, tag, attrs):
        if tag == "br" and self.cur is not None:
            self.cur.append(" ")


problems = 0

for fp in sorted(glob.glob("html/observe/*.html")) + sorted(glob.glob("html/show/*.html")):
    data = json.load(open("out/" + os.path.basename(fp).replace(".html", "") + ".html.json"))
    p = ParaDump()
    p.feed(open(fp, encoding="utf-8", errors="replace").read())
    p.close()
    mine = [b["text"] for b in data["blocks"] if b["type"] == "p"]
    if mine != p.paras:
        problems += 1
        short = fp.split("/")[-1]
        # find first difference
        for i, (a, b) in enumerate(zip(mine, p.paras)):
            if a != b:
                print(f"DIFF {short} para {i}")
                print("   mine:", a[:80])
                print("   src :", b[:80])
                break
        else:
            print(f"DIFF {short} (length {len(mine)} vs {len(p.paras)})")

# also verify no source paragraph is missing entirely
for fp in sorted(glob.glob("html/observe/*.html")) + sorted(glob.glob("html/show/*.html")):
    data = json.load(open("out/" + os.path.basename(fp).replace(".html", "") + ".html.json"))
    p = ParaDump()
    p.feed(open(fp, encoding="utf-8", errors="replace").read())
    p.close()
    mine = {b["text"] for b in data["blocks"] if b["type"] == "p"}
    for para in p.paras:
        if para not in mine:
            problems += 1
            print(f"MISSING in {fp.split('/')[-1]}: {para[:80]}")

print("problems:", problems)