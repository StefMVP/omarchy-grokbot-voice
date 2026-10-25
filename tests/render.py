#!/usr/bin/env python3
from __future__ import annotations

import os
from pathlib import Path
import sys

os.environ["QT_QPA_PLATFORM"] = "offscreen"
os.environ["QT_QUICK_BACKEND"] = "software"

from PySide6.QtCore import QUrl
from PySide6.QtGui import QColor, QGuiApplication, QImage, QPainter
from PySide6.QtQuick import QQuickView
from PySide6.QtTest import QTest

WIDTH = 312
PAD = 20
GAP = 16
BG = QColor("#101315")

BASE = {
    "surface": QColor("#1f1f1f"),
    "ink": QColor("#f69412"),
    "text": QColor("#f5f5f5"),
    "textSecondary": QColor(245, 245, 245, 138),
    "buttonFill": QColor(245, 245, 245, 10),
    "buttonIcon": QColor(245, 245, 245, 163),
    "danger": QColor("#cf2b35"),
    "fontFamily": "sans-serif",
}

STATES = [
    {"status": "calling", "connecting": True, "dots": 2},
    {"status": "live", "seconds": 12, "connecting": False},
    {"status": "live", "seconds": 3, "connecting": True, "dots": 1},
    {"status": "live", "seconds": 47, "muted": True},
    {"status": "stopping", "connecting": True},
    {"status": "live", "audioUnavailable": True},
    {"status": "ended"},
    {"status": "error", "errorText": "debug port closed"},
]


def render(app: QGuiApplication, card_path: Path) -> list[QImage]:
    shots: list[QImage] = []
    for state in STATES:
        view = QQuickView()
        view.setColor(QColor("transparent"))
        view.setSource(QUrl.fromLocalFile(str(card_path)))
        if view.status() != QQuickView.Status.Ready:
            for error in view.errors():
                print(error.toString(), file=sys.stderr)
            raise SystemExit(1)
        root = view.rootObject()
        for key, value in BASE.items():
            root.setProperty(key, value)
        for key, value in state.items():
            root.setProperty(key, value)
        view.setResizeMode(QQuickView.SizeRootObjectToView)
        view.resize(WIDTH, 68)
        view.show()
        QTest.qWait(240)
        shots.append(view.grabWindow())
    return shots


def main() -> int:
    here = Path(__file__).resolve().parent
    out = here / "out" / "preview.png"
    out.parent.mkdir(parents=True, exist_ok=True)

    app = QGuiApplication(sys.argv)
    shots = render(app, here.parent / "Card.qml")

    width = WIDTH + PAD * 2
    height = PAD * 2 + sum(image.height() for image in shots) + GAP * (len(shots) - 1)
    canvas = QImage(width, height, QImage.Format.Format_ARGB32)
    canvas.fill(BG)

    painter = QPainter(canvas)
    y = PAD
    for image in shots:
        painter.drawImage(PAD, y, image)
        y += image.height() + GAP
    painter.end()

    if not canvas.save(str(out)):
        print("could not save", out, file=sys.stderr)
        return 1
    print(f"{out} {canvas.width()}x{canvas.height()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
