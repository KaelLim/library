#!/usr/bin/env python3
"""產生混合寬高比的測試 PDF，用於驗證 letterbox 修正。

本地既有的 PDF 都是均勻直式，走 fast path，無法重現白邊缺陷。
本腳本產生兩個素材，涵蓋 letterbox slow path 的兩種版面模式：

1. mixed-aspect.pdf —— L,P,P,L,P,P 的 A4 混合檔，使 app.ts:358-359 的
   獨立 max() 算出 842x842 正方形目標，讓每一頁都落入 letterbox slow
   path。因含 landscape 頁（aspect 1.414 > SPREAD_ASPECT_THRESHOLD
   1.3），會觸發 forceSinglePage → 單頁模式。

2. mixed-portrait.pdf —— 全直式但尺寸混合（A4 + US Letter）。每一頁
   同樣落入 letterbox slow path，但**沒有任何頁** aspect 超過 1.3，
   因此 hasLandscape 為 false，維持對開（spread）模式。此素材專門用來
   檢查對開模式下透明 letterbox 與 StPageFlip 書口（fore-edge）之間的
   接縫觀感 —— 該區域先前被白色填滿遮住，改透明後會露出深藍背景。

每頁填飽和色 + 白色內框，讓白邊在 #1a1a2e 深藍背景上清晰可辨。

執行：
    python3 books/tools/make-mixed-fixture.py
輸出：
    books/tests/fixtures/mixed-aspect.pdf
    books/tests/fixtures/mixed-portrait.pdf
"""

from pathlib import Path

import fitz

A4_W, A4_H = 595.276, 841.89
# US Letter —— 與 A4 同為直式但長寬比不同（0.773 vs 0.707），
# 足以超過 ASPECT_MATCH_EPSILON (0.005) 而落入 slow path。
LETTER_W, LETTER_H = 612.0, 792.0

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

# (紙張, RGB) — 全部直式，但 A4 與 Letter 交錯，
# 且前 5 頁的 probe 窗口就能同時看到兩種尺寸。
PORTRAIT_PAGES = [
    ("a4", (1.00, 0.35, 0.25)),
    ("letter", (0.15, 0.45, 0.85)),
    ("letter", (0.20, 0.65, 0.35)),
    ("a4", (0.95, 0.70, 0.10)),
    ("letter", (0.55, 0.30, 0.75)),
    ("letter", (0.10, 0.60, 0.65)),
]

FIXTURES = Path(__file__).resolve().parent.parent / "tests" / "fixtures"
OUT = FIXTURES / "mixed-aspect.pdf"
OUT_PORTRAIT = FIXTURES / "mixed-portrait.pdf"

SIZES = {
    "landscape": (A4_H, A4_W),
    "portrait": (A4_W, A4_H),
    "a4": (A4_W, A4_H),
    "letter": (LETTER_W, LETTER_H),
}

# app.ts:116 ASPECT_MATCH_EPSILON —— 低於此差距會走 fast path，
# 素材必須讓每一頁都超過它才能重現缺陷。
ASPECT_MATCH_EPSILON = 0.005
# app.ts:368 SPREAD_ASPECT_THRESHOLD —— 任一 probe 頁超過即單頁模式。
SPREAD_ASPECT_THRESHOLD = 1.3


def build(pages=PAGES) -> fitz.Document:
    doc = fitz.open()
    for i, (kind, rgb) in enumerate(pages, start=1):
        w, h = SIZES[kind]
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


def _read_sizes(path: Path, pages) -> tuple[list[float], list[float]]:
    """讀回產出的檔案，確認頁數與每頁尺寸和來源定義一致。"""
    doc = fitz.open(path)
    assert doc.page_count == len(pages), f"頁數 {doc.page_count} != {len(pages)}"

    widths, heights = [], []
    for i, (kind, _) in enumerate(pages):
        rect = doc[i].rect
        widths.append(rect.width)
        heights.append(rect.height)
        exp_w, exp_h = SIZES[kind]
        assert abs(rect.width - exp_w) < 0.5 and abs(rect.height - exp_h) < 0.5, (
            f"第 {i + 1} 頁應為 {kind} {exp_w:.0f}x{exp_h:.0f}，"
            f"實際 {rect.width:.0f}x{rect.height:.0f}"
        )
    doc.close()
    return widths, heights


def _assert_all_letterboxed(widths, heights, max_w, max_h) -> None:
    """確認每一頁都落入 slow path —— 沒有一頁的長寬比落在 target 的 epsilon 內。"""
    target_aspect = max_w / max_h
    for i, (w, h) in enumerate(zip(widths, heights), start=1):
        delta = abs(w / h - target_aspect) / target_aspect
        assert delta > ASPECT_MATCH_EPSILON, (
            f"第 {i} 頁長寬比與 target 相差僅 {delta:.4f}，"
            f"低於 ASPECT_MATCH_EPSILON {ASPECT_MATCH_EPSILON} 會走 fast path，"
            f"無法重現 letterbox 缺陷"
        )


def verify(path: Path) -> None:
    """mixed-aspect.pdf：確認方向正確，且獨立 max() 產生近正方形目標。"""
    widths, heights = _read_sizes(path, PAGES)
    for i, (kind, _) in enumerate(PAGES, start=1):
        actual = "landscape" if widths[i - 1] > heights[i - 1] else "portrait"
        assert actual == kind, f"第 {i} 頁應為 {kind}，實際 {actual}"

    max_w, max_h = max(widths), max(heights)
    ratio = max_w / max_h
    assert abs(ratio - 1.0) < 0.01, (
        f"獨立 max() 應產生接近正方形的目標才能重現缺陷，實得 {max_w:.1f}x{max_h:.1f} "
        f"(ratio {ratio:.4f})"
    )
    _assert_all_letterboxed(widths, heights, max_w, max_h)
    print(f"驗證通過：{len(PAGES)} 頁，獨立 max() 目標 = {max_w:.1f}x{max_h:.1f}")


def verify_portrait(path: Path) -> None:
    """mixed-portrait.pdf：確認全直式（維持對開模式）且每頁仍落入 letterbox。"""
    widths, heights = _read_sizes(path, PORTRAIT_PAGES)

    max_aspect = max(w / h for w, h in zip(widths, heights))
    assert max_aspect < SPREAD_ASPECT_THRESHOLD, (
        f"最大長寬比 {max_aspect:.3f} 已達 SPREAD_ASPECT_THRESHOLD "
        f"{SPREAD_ASPECT_THRESHOLD}，會觸發 forceSinglePage，"
        f"本素材就無法驗證對開模式"
    )

    max_w, max_h = max(widths), max(heights)
    _assert_all_letterboxed(widths, heights, max_w, max_h)
    print(
        f"驗證通過：{len(PORTRAIT_PAGES)} 頁全直式（最大 aspect {max_aspect:.3f} "
        f"< {SPREAD_ASPECT_THRESHOLD}，維持對開），"
        f"獨立 max() 目標 = {max_w:.1f}x{max_h:.1f}"
    )


if __name__ == "__main__":
    FIXTURES.mkdir(parents=True, exist_ok=True)

    doc = build()
    doc.save(OUT)
    doc.close()
    print(f"已產生 {OUT} ({OUT.stat().st_size} bytes)")
    verify(OUT)

    doc = build(PORTRAIT_PAGES)
    doc.save(OUT_PORTRAIT)
    doc.close()
    print(f"已產生 {OUT_PORTRAIT} ({OUT_PORTRAIT.stat().st_size} bytes)")
    verify_portrait(OUT_PORTRAIT)
