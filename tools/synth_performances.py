#!/usr/bin/env python3
"""Makes synthetic piano performances for testing the page-turn follower.

Usage: python3 tools/synth_performances.py OUT_DIR [--short | --practice | --sections] [NAMES...]
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
    render(inst, out_dir, name, at(total) + TAIL, noise_db, tilt, gain_db, seed)
    page_bars = 4 if short else 8
    turn_beats = [4 * page_bars * k - 1 for k in range(1, total // (4 * page_bars))]
    with open(os.path.join(out_dir, name + ".json"), "w") as f:
        json.dump({"beats": beats[::5].round(3).tolist(), "times": times[::5].round(4).tolist(),
                   "turnBeats": turn_beats, "totalBeats": total, "pause": [pause_at, pause_len],
                   "notes": sorted(played)}, f)


def render(inst, out_dir, name, end_time, noise_db, tilt, gain_db, seed):
    """Synthesize the notes with FluidSynth, then add microphone colour and room noise; writes NAME.wav."""
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
    os.remove(mid)
    end = int(end_time * SR)
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


def noodle(inst, rng, t, seconds, kind):
    """Playing something that isn't the piece. Most kinds stay in the piece's key (C major), which is harder."""
    add = lambda p, a, b, v=80: inst.notes.append(pretty_midi.Note(velocity=v, pitch=p, start=t + a, end=t + b))
    major = [p for p in range(48, 89) if p % 12 in MAJOR]
    if kind == "pent":  # F-sharp pentatonic over F-sharp chords: notes the piece never uses together
        pent = [66, 68, 70, 73, 75, 78, 80, 82, 85, 87]
        k = 0
        while k * 0.125 < seconds:
            add(pent[(k * 3 + rng.randrange(3)) % len(pent)], k * 0.125, (k + 1) * 0.125)
            if k % 8 == 0:
                for q in (42, 49, 54):
                    add(q, k * 0.125, (k + 8) * 0.125, 60)
            k += 1
    elif kind == "scale":  # C major scales up and down, hands an octave apart, like a warm-up
        run = [p for p in major if 60 <= p <= 84]
        seq = run + run[-2:0:-1]
        k = 0
        while k * 0.11 < seconds:
            p = seq[k % len(seq)]
            add(p, k * 0.11, (k + 1) * 0.11)
            add(p - 12, k * 0.11, (k + 1) * 0.11, 65)
            k += 1
    elif kind == "random":  # random notes of C major, with pedal
        k = 0
        while k * 0.2 < seconds:
            add(rng.choice([p for p in major if p >= 60]), k * 0.2, k * 0.2 + 0.6)
            if k % 4 == 0:
                add(rng.choice([p for p in major if p < 60]), k * 0.2, k * 0.2 + 0.8, 65)
            k += 1
    elif kind == "chords":  # block chords in C: I vi IV V, then ii V I
        prog = [(48, [60, 64, 67]), (45, [60, 64, 69]), (41, [60, 65, 69]), (43, [59, 62, 67]), (50, [62, 65, 69]), (43, [59, 62, 65, 67]), (48, [60, 64, 67])]
        k = 0
        while k * 0.9 < seconds:
            bass, ch = prog[k % len(prog)]
            for p in [bass] + ch:
                add(p, k * 0.9, k * 0.9 + 0.85, 70)
            k += 1
    elif kind == "improv":  # broken chords on a progression the piece doesn't use, with a made-up tune on top
        prog = [57, 53, 48, 55]  # Am F C G roots in octave 3-4
        k = 0
        while k * 0.15 < seconds:
            root = prog[(k // 8) % 4] - 12
            third = 3 if root % 12 in (9,) else 4
            pattern = [root, root + 7, root + 12 + third, root + 7]
            add(pattern[k % 4], k * 0.15, k * 0.15 + 0.3, 60)
            if k % 2 == 0:
                add(rng.choice([p for p in major if 67 <= p <= 81]), k * 0.15, k * 0.15 + 0.3, 85)
            k += 1


def practice(name, out_dir, segments, initial_page=1, short=False, base=78, depth=0.05, phase=0.6, mel=90, acc=56, vel_jitter=6,
             timing=0.012, noise_db=-46, tilt=0.2, gain_db=0.0, seed=21):
    """A practice session: segments of ("play", from_beat, to_beat), ("pause", seconds) or ("noodle", seconds)
    (notes that aren't in the piece). The JSON's "track" gives, every 0.05 s, the beat being played (-1: none)."""
    rng = random.Random(seed)
    events, pedals, total = build_score(short)
    beats, times = tempo_map(total, base, depth, phase)
    at = lambda b: float(np.interp(b, beats, times)) - LEAD_IN
    page_beats = 16 if short else 32
    inst = pretty_midi.Instrument(program=0)
    cc = inst.control_changes
    track, t, flips = [], LEAD_IN, []
    def mark(t0, t1, beat_of):
        k = math.ceil(t0 / 0.05)
        while k * 0.05 < t1:
            track.append([round(k * 0.05, 3), beat_of(k * 0.05)])
            k += 1
    mark(0, LEAD_IN, lambda _: -1)
    for seg in segments:
        if seg[0] == "play":
            _, b0, b1 = seg
            off = t - at(b0)
            seg_end = at(b1) + off
            for (sb, db, pitch, role) in events:
                if not (b0 <= sb < b1):
                    continue
                start = at(sb) + off + rng.gauss(0, timing)
                end = min(at(sb + db) + off + 0.02, seg_end + 0.05)
                vel = (mel if role == "mel" else acc) + (6 if sb % 4 == 0 else 0) + rng.gauss(0, vel_jitter)
                inst.notes.append(pretty_midi.Note(velocity=int(max(1, min(127, vel))), pitch=pitch,
                                                   start=max(0.0, start), end=max(start + 0.05, end)))
            for (down, up) in pedals:
                if up <= b0 or down >= b1:
                    continue
                cc += [pretty_midi.ControlChange(64, 127, at(max(down, b0)) + off + 0.03),
                       pretty_midi.ControlChange(64, 0, min(at(up) + off, seg_end))]
            mark(t, seg_end, lambda x: round(float(np.interp(x - off + LEAD_IN, times, beats)), 3))
            t = seg_end
        elif seg[0] == "flip":
            flips.append([round(t, 3), seg[1]])
        elif seg[0] == "pause":
            mark(t, t + seg[1], lambda _: -1)
            t += seg[1]
        elif seg[0] == "noodle":
            noodle(inst, rng, t, seg[1], seg[2] if len(seg) > 2 else "pent")
            mark(t, t + seg[1], lambda _: -1)
            t += seg[1]
    render(inst, out_dir, name, t + TAIL, noise_db, tilt, gain_db, seed)
    mark(t, t + TAIL, lambda _: -1)
    with open(os.path.join(out_dir, name + ".json"), "w") as f:
        json.dump({"track": track, "turnBeats": [page_beats * k - 1 for k in range(1, total // page_beats)],
                   "totalBeats": total, "initialPage": initial_page,
                   "segments": [list(x) for x in segments], "flips": flips}, f)


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
# Practice sessions, all followed with the lesson taught by "ref". Pages are 8 bars (32 beats) long:
# page 1 = beats 0-31, page 2 = 32-63, page 3 = 64-95, page 4 = 96-127. Sections: A A B A, so the
# A theme appears on pages 1, 2 and 4.
PRACTICE = {
    "p_start_mid": dict(initial_page=3, segments=[("play", 64, 112)], seed=31),
    "p_start_mid_no_flip": dict(initial_page=1, segments=[("play", 66, 104)], seed=32),
    "p_repeat_passage": dict(initial_page=2, segments=[("play", 40, 56), ("pause", 1.5), ("play", 40, 56), ("pause", 1.2), ("play", 40, 72)], seed=33),
    "p_jump_back": dict(initial_page=1, segments=[("play", 16, 40), ("play", 22, 44)], seed=34),
    "p_jump_back_flip": dict(initial_page=1, segments=[("play", 16, 40), ("flip", 1), ("play", 22, 44)], seed=39),
    "p_noodle": dict(initial_page=1, segments=[("play", 0, 20), ("pause", 0.6), ("noodle", 5.0), ("pause", 0.8), ("play", 20, 40)], seed=35),
    "p_skip_ahead": dict(initial_page=1, segments=[("play", 0, 12), ("pause", 2.0), ("play", 70, 104)], seed=36),
    "p_repeat_section": dict(initial_page=4, segments=[("play", 96, 122)], seed=37),
    "p_start_mid_fast": dict(initial_page=3, segments=[("play", 64, 112)], base=94, phase=1.9, seed=41),
    "p_repeat_passage_slow": dict(initial_page=2, segments=[("play", 40, 56), ("pause", 1.5), ("play", 40, 56), ("pause", 1.2), ("play", 40, 72)], base=60, phase=2.4, seed=42),
    "p_skip_ahead_noisy": dict(initial_page=1, segments=[("play", 0, 12), ("pause", 2.0), ("play", 70, 104)], noise_db=-33, tilt=0.5, seed=43),
    "p_noodle_scale": dict(initial_page=1, segments=[("play", 0, 20), ("pause", 0.6), ("noodle", 8.0, "scale"), ("pause", 0.8), ("play", 20, 40)], seed=45),
    "p_noodle_random": dict(initial_page=2, segments=[("play", 36, 56), ("pause", 0.6), ("noodle", 8.0, "random"), ("pause", 0.8), ("play", 56, 72)], seed=46),
    "p_noodle_chords": dict(initial_page=3, segments=[("play", 64, 84), ("pause", 0.6), ("noodle", 8.0, "chords"), ("pause", 0.8), ("play", 84, 104)], seed=47),
    "p_noodle_improv": dict(initial_page=1, segments=[("play", 4, 24), ("pause", 0.6), ("noodle", 8.0, "improv"), ("pause", 0.8), ("play", 24, 40)], seed=48),
    "p_warmup_first": dict(initial_page=3, segments=[("noodle", 6.0, "scale"), ("pause", 1.0), ("noodle", 6.0, "chords"), ("pause", 1.2), ("play", 66, 90)], seed=49),
    "p_noodle_fast": dict(initial_page=1, segments=[("play", 0, 20), ("pause", 0.6), ("noodle", 5.0), ("pause", 0.8), ("play", 20, 40)], base=92, seed=44),
    "p_back_over_turn": dict(initial_page=2, segments=[("play", 52, 72), ("pause", 1.5), ("play", 56, 72), ("pause", 1.5), ("play", 56, 76)], seed=38),
}
# Teaching in sections (played like "ref": same tempo, a different day), for tests/sections-eval.js
SECTIONS = {
    "s_teach_a": dict(segments=[("play", 0, 40)], base=74, phase=0.0, mel=88, acc=58, noise_db=-50, tilt=0.0, seed=51),
    "s_teach_b": dict(initial_page=2, segments=[("play", 56, 100)], base=74, phase=0.3, mel=88, acc=58, noise_db=-50, tilt=0.0, seed=52),
    "s_teach_c": dict(initial_page=2, segments=[("play", 36, 70)], base=74, phase=0.6, mel=88, acc=58, noise_db=-50, tilt=0.0, seed=53),
    "s_teach_late": dict(initial_page=3, segments=[("play", 70, 128)], base=74, phase=0.9, mel=88, acc=58, noise_db=-50, tilt=0.0, seed=54),
    "s_teach_cover": dict(initial_page=2, segments=[("play", 50, 110)], base=74, phase=1.2, mel=88, acc=58, noise_db=-50, tilt=0.0, seed=55),
}
SHORT_CASES = {
    "short_teach": dict(base=84, depth=0.04, phase=0.0, mel=88, acc=58, noise_db=-50, seed=11),
    # practice on the short piece (pages are 4 bars = 16 beats): start on page 3, then go back to page 2
    "short_practice": dict(practice=True, initial_page=3, segments=[("play", 33, 60), ("pause", 2.0), ("play", 20, 36)], base=90, phase=0.8, seed=13),
    "short_follow": dict(base=94, depth=0.05, phase=1.2, mel=100, acc=50, noise_db=-42, tilt=0.3, seed=12),
}

if __name__ == "__main__":
    out = sys.argv[1]
    short = "--short" in sys.argv
    only = [a for a in sys.argv[2:] if not a.startswith("--")]
    os.makedirs(out, exist_ok=True)
    if "--sections" in sys.argv:
        for name, cfg in SECTIONS.items():
            if not only or name in only:
                practice(name, out, **cfg)
                print("made", name)
        sys.exit(0)
    if "--practice" in sys.argv:
        for name, cfg in PRACTICE.items():
            if not only or name in only:
                practice(name, out, **cfg)
                print("made", name)
        sys.exit(0)
    for name, cfg in (SHORT_CASES if short else CASES).items():
        if only and name not in only:
            continue
        if cfg.pop("practice", False):
            practice(name, out, short=True, **cfg)
        else:
            perform(name, out, short, **cfg)
        print("made", name)
