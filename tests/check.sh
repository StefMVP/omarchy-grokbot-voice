#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
node node_modules/eslint/bin/eslint.js .
shellcheck bin/grokbot-voice bin/grokbot-voice-call tests/check.sh
node --check bin/grokbot-voice-daemon
node --test tests/*.test.mjs
qmllint Card.qml Menu.qml VoiceLevels.qml
omarchy plugin validate .
python3 tests/render.py
python3 tests/levels.py
