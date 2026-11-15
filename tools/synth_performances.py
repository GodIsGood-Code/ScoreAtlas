#!/usr/bin/env python3
"""Makes synthetic piano performances for testing the page-turn follower.

Usage: python3 tools/synth_performances.py OUT_DIR [--short]
Needs numpy, pretty_midi, and fluidsynth with the FluidR3 GM soundfont
(apt-get install fluidsynth fluid-soundfont-gm; pip install pretty_midi).

The piece: 32 bars of 4/4 in A A B A form, a melody over broken chords, sustain pedal changed every bar.
Each performance is the same music played differently (tempo, rubato, voicing, mistakes, pauses, noise).
For each one this writes a WAV and a JSON with its beat-to-time map, so tests know exactly where in the
music every moment of audio is. --short makes a 16-bar version (A B) for browser tests.
"""
import json
import math
import os
import random
import subprocess
import sys
import wave

import numpy as np
import pretty_midi

SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2"
SR = 48000
LEAD_IN = 1.5  # seconds of silence before the music starts
TAIL = 2.5

# chord name: (bass root MIDI note, third above root in semitones)
CHORDS = {"C": (48, 4), "Am": (45, 3), "F": (41, 4), "G": (43, 4), "Dm": (50, 3), "Em": (52, 3), "E7": (52, 4)}
A = ["C", "Am", "F", "G", "C", "Am", ("Dm", "G"), "C"]
B = ["F", "G", "Em", "Am", "Dm", "G", "E7", "Am"]
MAJOR = {0, 2, 4, 5, 7, 9, 11}
RHYTHMS = [[2, 1, 1], [1, 1, 1, 1], [1, 1, 2], [3, 1], [1.5, 0.5, 1, 1], [1, 0.5, 0.5, 2]]


def chord_tones(name):
    root, third = CHORDS[name]
    pcs = {root % 12, (root + third) % 12, (root + 7) % 12}
    if name == "E7":
        pcs.add((root + 10) % 12)
    return pcs


def accompaniment(name, start_beat, beats):
    root, third = CHORDS[name]
    pattern = [root, root + 7, root + third + 12, root + 7, root + 12, root + 7, root + third + 12, root + 7]
    return [(start_beat + 0.5 * i, 0.5, pattern[i], "acc") for i in range(int(beats * 2))]


def melody(chords, rng, start_beat):
    notes, prev = [], 76
    for bar, ch in enumerate(chords):
        names = ch if isinstance(ch, tuple) else (ch, ch)
        rhythm = rng.choice(RHYTHMS)
        beat = 0.0
        for dur in rhythm:
            name = names[0] if beat < 2 else names[1]
            tones = chord_tones(name)
            scale = MAJOR | ({8} if name == "E7" else set())
            if beat in (0.0, 2.0) or dur >= 2:
                cands = [p for p in range(67, 85) if p % 12 in tones and abs(p - prev) <= 7] or [prev]
            else:
                cands = [p for p in range(67, 85) if p % 12 in scale and 1 <= abs(p - prev) <= 2] or [prev]
            pitch = rng.choice(cands)
            notes.append((start_beat + 4 * bar + beat, dur, pitch, "mel"))
            prev = pitch
            beat += dur
    return notes


def build_score(short=False):
    rng = random.Random(7)
    a_mel = melody(A, rng, 0)
    b_mel = melody(B, rng, 0)
    form = [("A", A, a_mel), ("B", B, b_mel)] if short else [("A", A, a_mel), ("A", A, a_mel), ("B", B, b_mel), ("A", A, a_mel)]
    events, pedals = [], []
    for s, (_, chords, mel) in enumerate(form):
        base = 32 * s
        events += [(base + b, d, p, r) for (b, d, p, r) in mel]
        for bar, ch in enumerate(chords):
            start = base + 4 * bar
            if isinstance(ch, tuple):
                events += accompaniment(ch[0], start, 2) + accompaniment(ch[1], start + 2, 2)
                pedals += [(start + 0.08, start + 1.94), (start + 2.08, start + 3.94)]
            else:
                events += accompaniment(ch, start, 4)
                pedals.append((start + 0.08, start + 3.94))
    total = 32 * len(form)
    # end on a held tonic chord
    events += [(total - 4, 4, 60, "mel"), (total - 4, 4, 48, "acc")]
    return events, pedals, total


def tempo_map(total, base, depth, phase, ritard=0.18, pause_at=None, pause_len=0.0):
    step = 0.01
    beats = np.arange(0, total + 1 + step, step)
    times = np.zeros_like(beats)
    t = LEAD_IN
    times[0] = t
    for i in range(1, len(beats)):
        b = beats[i - 1]
        bpm = base * (1 + depth * math.sin(2 * math.pi * b / 16 + phase))
        pos = b % 32
        if pos > 29:
            bpm *= 1 - ritard * (pos - 29) / 3
        t += step * 60 / bpm
        if pause_at is not None and beats[i - 1] < pause_at <= beats[i]:
            t += pause_len
        times[i] = t
    return beats, times


def perform(name, out_dir, short, base=76, depth=0.05, phase=0.0, mel=88, acc=58, vel_jitter=6, timing=0.010,
            drop=0.0, wrong=0.0, pedal=True, pause_at=None, pause_len=0.0, noise_db=-50, tilt=0.0, gain_db=0.0, seed=1):
    rng = random.Random(seed)
    events, pedals, total = build_score(short)
    beats, times = tempo_map(total, base, depth, phase, pause_at=pause_at, pause_len=pause_len)
    at = lambda b: float(np.interp(b, beats, times))
    pause_start = at(pause_at) - pause_len if pause_at is not None else None

    inst = pretty_midi.Instrument(program=0)
    played = []
    for (sb, db, pitch, role) in events:
        if rng.random() < drop:
            continue
        if rng.random() < wrong:
            pitch += rng.choice([-2, -1, 1, 2])
        start = at(sb) + rng.gauss(0, timing)
        end = at(sb + db) + 0.02
        if pause_start is not None and sb < pause_at and at(sb + db) > pause_start:
            end = pause_start
        vel = (mel if role == "mel" else acc) + (6 if sb % 4 == 0 else 0) + rng.gauss(0, vel_jitter)
        note = pretty_midi.Note(velocity=int(max(1, min(127, vel))), pitch=pitch,
                                start=max(0.0, start), end=max(start + 0.05, end))
        inst.notes.append(note)
        played.append([round(note.start, 4), pitch, note.velocity, role])
    if pedal:
        for (down, up) in pedals:
            t_down, t_up = at(down), at(up)
            if pause_start is not None and down < pause_at < up:
                inst.control_changes += [pretty_midi.ControlChange(64, 127, t_down), pretty_midi.ControlChange(64, 0, pause_start),
                                         pretty_midi.ControlChange(64, 127, at(pause_at) + 0.1), pretty_midi.ControlChange(64, 0, t_up)]
            else:
                inst.control_changes += [pretty_midi.ControlChange(64, 127, t_down), pretty_midi.ControlChange(64, 0, t_up)]
    pm = pretty_midi.PrettyMIDI()
    pm.instruments.append(inst)
    mid = os.path.join(out_dir, name + ".mid")
    raw = os.path.join(out_dir, name + ".raw.wav")
    pm.write(mid)
    subprocess.run(["fluidsynth", "-ni", "-q", "-g", "0.6", "-r", str(SR), "-F", raw, SF2, mid], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    with wave.open(raw) as w:
        ch = w.getnchannels()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
        x = x.reshape(-1, ch).mean(axis=1)
    os.remove(raw)
    end = int((at(total) + TAIL) * SR)
    x = np.pad(x, (0, max(0, end - len(x))))[:end]
    nprng = np.random.default_rng(seed)
    if tilt:
        X = np.fft.rfft(x)
        f = np.fft.rfftfreq(len(x), 1 / SR)
        X *= np.clip((np.maximum(f, 20) / 1000) ** (0.35 * tilt), 0.25, 4)
        x = np.fft.irfft(X, len(x))
    x *= 10 ** ((-24 + gain_db) / 20) / (np.sqrt(np.mean(x[x != 0] ** 2)) + 1e-12)
    white = nprng.standard_normal(len(x))
    W = np.fft.rfft(white)
    fr = np.fft.rfftfreq(len(x), 1 / SR)
    W[1:] /= np.sqrt(fr[1:])
    W[0] = 0
    pink = np.fft.irfft(W, len(x))
    pink *= 10 ** (noise_db / 20) / np.sqrt(np.mean(pink ** 2))
    y = np.clip(x + pink, -1, 1)
    with wave.open(os.path.join(out_dir, name + ".wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((y * 32767).astype(np.int16).tobytes())
    os.remove(mid)
    page_bars = 4 if short else 8
    turn_beats = [4 * page_bars * k - 1 for k in range(1, total // (4 * page_bars))]
    with open(os.path.join(out_dir, name + ".json"), "w") as f:
        json.dump({"beats": beats[::5].round(3).tolist(), "times": times[::5].round(4).tolist(),
                   "turnBeats": turn_beats, "totalBeats": total, "pause": [pause_at, pause_len],
                   "notes": sorted(played)}, f)


CASES = {
    # name: settings. "ref" performances are used for teaching; the others are followed.
    "ref": dict(base=74, depth=0.05, phase=0.0, mel=88, acc=58, noise_db=-52, seed=1),
    "ref_slow": dict(base=54, depth=0.04, phase=0.5, mel=84, acc=60, noise_db=-52, seed=2),
    "faster": dict(base=86, depth=0.06, phase=1.3, mel=96, acc=52, timing=0.015, noise_db=-45, tilt=0.3, seed=3),
    "slower": dict(base=62, depth=0.07, phase=2.1, mel=80, acc=62, noise_db=-46, tilt=-0.2, seed=4),
    "much_faster": dict(base=88, depth=0.05, phase=0.7, mel=92, acc=56, noise_db=-45, seed=5),  # taught with ref_slow
    "mistakes": dict(base=78, depth=0.05, phase=0.9, drop=0.05, wrong=0.03, timing=0.03, noise_db=-44, seed=6),
    "pause": dict(base=76, depth=0.05, phase=0.4, pause_at=70, pause_len=3.0, noise_db=-46, seed=7),
    "noisy": dict(base=80, depth=0.05, phase=1.7, noise_db=-32, tilt=0.5, seed=8),
    "voicing": dict(base=76, depth=0.06, phase=2.5, mel=112, acc=38, vel_jitter=10, noise_db=-45, seed=9),
    "no_pedal": dict(base=76, depth=0.05, phase=1.1, pedal=False, noise_db=-45, seed=10),
}
SHORT_CASES = {
    "short_teach": dict(base=84, depth=0.04, phase=0.0, mel=88, acc=58, noise_db=-50, seed=11),
    "short_follow": dict(base=94, depth=0.05, phase=1.2, mel=100, acc=50, noise_db=-42, tilt=0.3, seed=12),
}

if __name__ == "__main__":
    out = sys.argv[1]
    short = "--short" in sys.argv
    only = [a for a in sys.argv[2:] if not a.startswith("--")]
    os.makedirs(out, exist_ok=True)
    for name, cfg in (SHORT_CASES if short else CASES).items():
        if only and name not in only:
            continue
        perform(name, out, short, **cfg)
        print("made", name)
