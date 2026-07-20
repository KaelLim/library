#!/usr/bin/env python3
"""產生混合寬高比的測試 PDF，用於驗證 letterbox 修正。

本地既有的 PDF 都是均勻直式，走 fast path，無法重現白邊缺陷。
本腳本產生 L,P,P,L,P,P 的 A4 混合檔，使 app.ts:355-356 的獨立
max() 算出 842x842 正方形目標，讓每一頁都落入 letterbox slow path。

每頁填飽和色 + 白色內框，讓白邊在 #1a1a2e 深藍背景上清晰可辨。

執行：
    python3 books/tools/make-mixed-fixture.py
輸出：
    books/tests/fixtures/mixed-aspect.pdf
"""

from pathlib import Path

import fitz

A4_W, A4_H = 595.276, 841.89

# (方向, RGB) — 順序刻意混合，且以 landscape 開頭，
# 使前 5 頁的 probe 窗口就能看到兩種方向。
PAGES = [
    ("landscape", (1.00, 0.35, 0.25)),
    ("portrait", (0.15, 0.45, 0.85)),
    ("portrait", (0.20, 0.65, 0.35)),
    ("landscape", (0.95, 0.70, 0.10)),
    ("portrait", (0.55, 0.30, 0.75)),
    ("portrait", (0.10, 0.60, 0.65)),
]

OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "mixed-aspect.pdf"


def build() -> fitz.Document:
    doc = fitz.open()
    for i, (kind, rgb) in enumerate(PAGES, start=1):
        w, h = (A4_H, A4_W) if kind == "landscape" else (A4_W, A4_H)
        page = doc.new_page(width=w, height=h)
        page.draw_rect(fitz.Rect(0, 0, w, h), color=rgb, fill=rgb)
        page.draw_rect(fitz.Rect(12, 12, w - 12, h - 12), color=(1, 1, 1), width=6)
        page.insert_text(
            fitz.Point(w / 2 - 60, h / 2 + 40), str(i), fontsize=160, color=(1, 1, 1)
        )
        page.insert_text(
            fitz.Point(40, h - 40),
            f"{kind} {int(w)}x{int(h)}",
            fontsize=22,
            color=(1, 1, 1),
        )
    return doc


def verify(path: Path) -> None:
    """讀回產出的檔案，確認頁面尺寸與 PAGES 一致。"""
    doc = fitz.open(path)
    assert doc.page_count == len(PAGES), f"頁數 {doc.page_count} != {len(PAGES)}"

    widths, heights = [], []
    for i, (kind, _) in enumerate(PAGES):
        rect = doc[i].rect
        widths.append(rect.width)
        heights.append(rect.height)
        actual = "landscape" if rect.width > rect.height else "portrait"
        assert actual == kind, f"第 {i + 1} 頁應為 {kind}，實際 {actual}"
    doc.close()

    max_w, max_h = max(widths), max(heights)
    ratio = max_w / max_h
    assert abs(ratio - 1.0) < 0.01, (
        f"獨立 max() 應產生接近正方形的目標才能重現缺陷，實得 {max_w:.1f}x{max_h:.1f} "
        f"(ratio {ratio:.4f})"
    )
    print(f"驗證通過：{len(PAGES)} 頁，獨立 max() 目標 = {max_w:.1f}x{max_h:.1f}")


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = build()
    doc.save(OUT)
    doc.close()
    print(f"已產生 {OUT} ({OUT.stat().st_size} bytes)")
    verify(OUT)
