#!/usr/bin/env python3
from array import array
from contextlib import ExitStack
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import os
import math
import threading

ROOT = Path(__file__).resolve().parent.parent
ENV = {**os.environ, "QT_QPA_PLATFORM": "offscreen", "QT_QUICK_BACKEND": "software"}


def run(*args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=10, **kwargs).stdout


def stop(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def main():
    with ExitStack() as cleanup:
        directory = Path(cleanup.enter_context(tempfile.TemporaryDirectory(prefix="voice-levels-")))
        for source, target in [("VoiceLevels.qml", "VoiceLevels.qml"), ("Card.qml", "Card.qml"),
                               ("tests/levels.qml", "shell.qml"), ("lib/call.js", "lib/call.js")]:
            (directory / target).parent.mkdir(exist_ok=True)
            shutil.copyfile(ROOT / source, directory / target)
        log = cleanup.enter_context((directory / "shell.log").open("w+"))
        shell = subprocess.Popen(["quickshell", "-p", str(directory), "--no-color"], env=ENV, stdout=log, stderr=log)
        cleanup.callback(stop, shell)

        def ipc(command, *args):
            return run("quickshell", "ipc", "--pid", str(shell.pid), "call", "test", command, *args, env=ENV)

        def state():
            if shell.poll() is not None:
                log.seek(0)
                raise AssertionError(log.read())
            try:
                return json.loads(ipc("state"))
            except (subprocess.CalledProcessError, json.JSONDecodeError):
                return None

        def expect(predicate, label):
            deadline = time.monotonic() + 5
            last = None
            while time.monotonic() < deadline:
                last = state()
                if last is not None and predicate(last):
                    return last
                time.sleep(0.05)
            raise AssertionError(f"{label}: {last}")

        sink = f"voice-levels-{os.getpid()}"
        run("pw-cli", "create-node", "adapter", "{ factory.name = support.null-audio-sink "
            f"node.name = {sink} media.class = Audio/Sink audio.position = [ MONO ] "
            "object.linger = true priority.session = 0 }")
        nodes = json.loads(run("pw-dump"))
        sink_id = next(n["id"] for n in nodes if n.get("info", {}).get("props", {}).get("node.name") == sink)
        cleanup.callback(run, "pw-cli", "destroy", str(sink_id))

        def stream(binary, record=False):
            properties = f"{{ application.process.binary = {binary} stream.capture.sink = true }}"
            process = subprocess.Popen(["pw-cat", "-r" if record else "-p", "--raw", "--rate", "48000",
                                        "--channels", "1", "--format", "f32", "--latency", "20ms",
                                        "--target", sink, "-P", properties, "/dev/null" if record else "-"],
                                       stdin=subprocess.DEVNULL if record else subprocess.PIPE,
                                       stdout=subprocess.DEVNULL, stderr=log, bufsize=0)
            if not record:
                process.amplitude = 0
                def write_tone():
                    phase = 0
                    try:
                        while process.poll() is None:
                            samples = array("f", (process.amplitude * math.sin(2 * math.pi * 440 * (phase + i) / 48000) for i in range(960)))
                            phase += 960
                            process.stdin.write(samples.tobytes())
                            process.stdin.flush()
                    except (BrokenPipeError, ValueError):
                        pass
                writer = threading.Thread(target=write_tone, daemon=True)
                writer.start()
                cleanup.callback(writer.join, 5)
            cleanup.callback(stop, process)
            return process

        def feed(process, amplitude):
            process.amplitude = amplitude

        expect(lambda s: s["peak"] == 0 and max(s["levels"]) == 0, "idle silence")
        output = stream("voice-level-test")
        feed(output, 0)
        expect(lambda s: s["output"] and s["peak"] == 0, "silent playback")
        feed(output, 0.01)
        quiet = expect(lambda s: 0.1 < s["peak"] < 0.3 and max(s["levels"]) > 0, "quiet playback")
        feed(output, 0.3)
        expect(lambda s: s["peak"] > quiet["peak"] * 2 and max(s["levels"]) > 0.8, "loud playback")
        ipc("mute", "true")
        feed(output, 0.3)
        expect(lambda s: s["peak"] > 0.6, "speaker remains visible while microphone is muted")
        feed(output, 0)
        expect(lambda s: s["peak"] == 0 and max(s["levels"]) == 0, "return to silence")
        stop(output)
        expect(lambda s: not s["output"] and s["peak"] == 0, "output stream removal")
        unrelated = stream("voice-other-test")
        feed(unrelated, 0.3)
        expect(lambda s: not s["output"] and s["peak"] == 0, "unrelated playback ignored")
        capture = stream("voice-level-test", record=True)
        ipc("mute", "false")
        expect(lambda s: s["input"] and s["source"], "microphone stream connected")
        feed(unrelated, 0.3)
        expect(lambda s: s["input"] and s["source"] and s["peak"] > 0.6 and max(s["levels"]) > 0.8, "call microphone route")
        ipc("mute", "true")
        expect(lambda s: s["peak"] == 0 and max(s["levels"]) == 0, "microphone mute")
        ipc("mute", "false")
        feed(unrelated, 0.3)
        expect(lambda s: s["peak"] > 0.6, "microphone unmute")
        ipc("enable", "false")
        def monitors_released(state):
            if state["input"] or state["output"] or state["peak"] != 0:
                return False
            return not any(n.get("info", {}).get("props", {}).get("application.process.id") in [shell.pid, str(shell.pid)]
                           and n.get("info", {}).get("props", {}).get("node.name") == "quickshell-peak-monitor"
                           for n in json.loads(run("pw-dump")))
        expect(monitors_released, "close releases monitors")
        stop(capture)
        stop(unrelated)
        print("PipeWire: silence, loudness, routing, mute and monitor release passed")


if __name__ == "__main__":
    main()
