#!/usr/bin/env python3
import os
from pathlib import Path
import unittest

os.environ["QT_QPA_PLATFORM"] = "offscreen"
os.environ["QT_QUICK_BACKEND"] = "software"

from PySide6.QtCore import QPoint, Qt, QUrl
from PySide6.QtGui import QGuiApplication
from PySide6.QtQuick import QQuickView
from PySide6.QtTest import QTest

APP = QGuiApplication([])


class Presentation(unittest.TestCase):
    def setUp(self):
        self.view = QQuickView()
        self.view.setSource(QUrl.fromLocalFile(str(Path(__file__).resolve().parent.parent / "Card.qml")))
        self.assertEqual(self.view.status(), QQuickView.Status.Ready)
        self.card = self.view.rootObject()
        self.card.setProperty("status", "live")
        self.view.setResizeMode(QQuickView.SizeRootObjectToView)
        self.view.resize(round(self.card.width()), round(self.card.height()))
        self.view.show()
        QTest.qWait(80)

    def tearDown(self):
        self.view.close()
        self.view.deleteLater()
        APP.processEvents()

    def wave_pixels(self):
        image = self.view.grabWindow()
        return [(x, y) for x in range(12, 208) for y in range(10, image.height() - 10)
                if image.pixelColor(x, y).name() == "#f69412"]

    def test_silence_is_a_flat_line_and_speech_uses_the_panel_height(self):
        pixels = self.wave_pixels()
        self.assertGreaterEqual(len({x for x, _ in pixels}), 190)
        self.assertLessEqual(len({y for _, y in pixels}), 2)
        self.card.setProperty("peak", 0.5)
        QTest.qWait(600)
        self.assertGreaterEqual(len({y for _, y in self.wave_pixels()}), 50)
        self.card.setProperty("peak", 0)
        QTest.qWait(150)
        self.assertLessEqual(len({y for _, y in self.wave_pixels()}), 2)

    def test_hangup_fires_on_press_before_release(self):
        calls = []
        self.card.hangUp.connect(lambda: calls.append(True))
        point = QPoint(round(self.card.width()) - 34, round(self.card.height()) // 2)
        QTest.mousePress(self.view, Qt.MouseButton.LeftButton, Qt.KeyboardModifier.NoModifier, point)
        self.assertEqual(calls, [True])
        QTest.mouseRelease(self.view, Qt.MouseButton.LeftButton, Qt.KeyboardModifier.NoModifier, point)


if __name__ == "__main__":
    unittest.main()
