# AudioLevel Mastering Chain

Technical documentation for the audio mastering pipeline used for music content.

## Overview

The mastering chain is a **two-pass** FFmpeg filter pipeline that analyzes input audio characteristics and applies adaptive processing to achieve broadcast-ready loudness levels while preserving audio quality.

**Target Output:** -9 LUFS integrated loudness, -0.5 dBTP true peak

## Two-Pass Processing

The loudnorm filter uses **linear mode** with two-pass processing to eliminate the "pumping" artifact caused by dynamic gain adjustment:

1. **Pass 1 (Measurement):** Runs the audio through the processing chain with `loudnorm` in measurement mode (`print_format=json`) to calculate the required gain adjustment
2. **Pass 2 (Processing):** Applies the full chain with `loudnorm` in linear mode (`linear=true`) using the measured values, applying constant gain instead of real-time gain riding

This prevents mid/high frequency pumping when bass content triggers gain changes.

## Signal Flow

```
Input Audio
    │
    ▼
┌─────────────────────────────────────────┐
│  1. ANALYSIS                            │
│  EBU R128 loudness + dynamics metrics   │
└─────────────────────────────────────────┘
    │
    ├─────────────────────────────────────────────────────────┐
    │                                                         │
    ▼                                                         │
┌─────────────────────────────────────────┐                   │
│  2. HIGHPASS FILTER (always)            │                   │
│  25 Hz cutoff - removes subsonic rumble │                   │
└─────────────────────────────────────────┘                   │
    │                                                         │
    ▼                                                         │
┌─────────────────────────────────────────┐                   │
│  3. COMPRESSOR (conditional)            │                   │
│  Enabled if: crest > 10 AND LRA > 5     │                   │
└─────────────────────────────────────────┘                   │
    │                                                         │
    ▼                                                         │
┌─────────────────────────────────────────┐                   │
│  4. HIGH SHELF (always)                 │                   │
│  +1.5 dB at 8 kHz - restores air        │                   │
└─────────────────────────────────────────┘                   │
    │                                                         │
    ▼                                                         │
┌─────────────────────────────────────────┐                   │
│  5. SATURATION (conditional)            │                   │
│  Enabled if: LUFS < -16 AND TP < -1.5   │                   │
└─────────────────────────────────────────┘                   │
    │                                                         │
    ▼                                                         │
┌─────────────────────────────────────────┐                   │
│  6a. LOUDNORM - PASS 1 (measurement)    │                   │
│  print_format=json → measured values    │───────────────────┤
└─────────────────────────────────────────┘                   │
    │                                                         │
    │  measured_I, measured_TP, measured_LRA,                 │
    │  measured_thresh, offset                                │
    │                                                         │
    ▼                                                         │
┌─────────────────────────────────────────┐                   │
│  6b. LOUDNORM - PASS 2 (linear mode)    │◄──────────────────┘
│  linear=true + measured values          │   (re-read input)
│  Constant gain, no pumping              │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  7. LIMITER                             │
│  True-peak limiting at -0.63 dBTP       │
└─────────────────────────────────────────┘
    │
    ▼
Output Audio (48kHz)
```

## Stage Details

### 1. Analysis

Before processing, the input audio is analyzed using FFmpeg's `ebur128` and `astats` filters:

```bash
ffmpeg -i input.wav -af "ebur128=peak=true,astats=metadata=1:measure_overall=1" -f null -
```

**Metrics extracted:**

| Metric | Description | Use |
|--------|-------------|-----|
| Integrated LUFS | Overall loudness (EBU R128) | Saturation decision |
| LRA (Loudness Range) | Dynamic range in LU | Compression decision |
| True Peak (dBTP) | Maximum inter-sample peak | Saturation decision |
| RMS Level (dB) | Average signal level | Crest factor calculation |
| Peak Level (dB) | Maximum sample peak | Crest factor calculation |
| Crest Factor | Peak - RMS (dynamics indicator) | Compression decision |

---

### 2. Highpass Filter

**FFmpeg filter:** `highpass=f=25`

Always applied to remove subsonic content below 25 Hz that can:
- Waste headroom
- Cause speaker excursion issues
- Introduce DC offset problems

This is a gentle 12 dB/octave rolloff that doesn't affect audible bass.

---

### 3. Compressor (Conditional)

**FFmpeg filter:** `acompressor=threshold=-18dB:ratio=2.5:attack=50:release=200`

**Enabled when:**
- Crest factor > 10 dB (high peak-to-average ratio)
- AND Loudness Range (LRA) > 5 LU (significant dynamic variation)

**Parameters:**

| Parameter | Value | Purpose |
|-----------|-------|---------|
| Threshold | -18 dB | Engage on moderate-loud signals |
| Ratio | 2.5:1 | Gentle compression |
| Attack | 50 ms | Preserve transient punch (kick, snare snap) |
| Release | 200 ms | Smooth gain recovery |

**Rationale:** Only compress audio that has excessive dynamics. The 50ms attack allows more of the initial transient to pass through before gain reduction engages, preserving perceived impact. Well-mastered content or already-compressed audio passes through unchanged.

---

### 4. High Shelf (Always)

**FFmpeg filter:** `treble=g=1.5:f=8000:t=s`

**Parameters:**

| Parameter | Value | Purpose |
|-----------|-------|---------|
| g | 1.5 dB | Subtle boost |
| f | 8000 Hz | Shelf starts at 8 kHz |
| t | s | Shelf type (not peaking) |

**Rationale:** Restores air and presence to all material. Applied after compression (if enabled) to compensate for any high-frequency loss from gain reduction, and before saturation to ensure the top end is present before harmonic enhancement.

---

### 5. Saturation (Conditional)

**FFmpeg filter:** `asoftclip=type=quintic`

**Enabled when:**
- Integrated LUFS < -16 (genuinely quiet source material)
- AND True Peak < -1.5 dBTP (headroom available)

**Effect:** Applies quintic soft clipping, which:
- Has a gentler knee than tanh, producing fewer odd harmonics
- Adds harmonic warmth/density with more transparent sound
- Gently limits peaks without sounding "crunchy" on transients

**Rationale:** The conservative -16 LUFS threshold ensures only genuinely quiet material (demos, rough mixes, older recordings) gets harmonic enhancement. Well-produced modern music typically lands between -14 and -8 LUFS, avoiding unnecessary coloration.

---

### 6. Loudness Normalization (Two-Pass)

The loudnorm filter runs in **two passes** to eliminate pumping artifacts:

#### Pass 1: Measurement

**FFmpeg filter:** `loudnorm=I=-9:TP=-1.0:LRA=5:print_format=json`

Runs with `-f null -` output to measure the audio without producing a file. Outputs JSON with:

```json
{
  "input_i": "-18.52",
  "input_tp": "-0.30",
  "input_lra": "5.80",
  "input_thresh": "-28.73",
  "target_offset": "0.21"
}
```

#### Pass 2: Linear Processing

**FFmpeg filter:**
```
loudnorm=I=-9:TP=-1.0:LRA=5:measured_I=-18.52:measured_TP=-0.30:measured_LRA=5.80:measured_thresh=-28.73:offset=0.21:linear=true
```

**Parameters:**

| Parameter | Value | Purpose |
|-----------|-------|---------|
| I (Integrated) | -9 LUFS | Target loudness |
| TP (True Peak) | -1.0 dBTP | Peak ceiling (pre-limiter) |
| LRA | 5 LU | Target loudness range |
| measured_* | from pass 1 | Pre-calculated measurements |
| offset | from pass 1 | Gain offset to apply |
| linear | true | **Apply constant gain (critical!)** |

**Why two-pass?**
- Single-pass loudnorm uses dynamic gain adjustment that reacts to content in real-time
- This causes audible "pumping" when bass content triggers gain reduction that affects mid/high frequencies
- Linear mode applies a constant gain calculated from the full-file analysis, eliminating pumping
- Trade-off: Processing time roughly doubles, but audio quality is significantly improved

**Notes:**
- Uses EBU R128 algorithm for broadcast-standard loudness
- The -1.0 dBTP ceiling leaves 0.5 dB headroom for the final limiter
- LRA target of 5 LU maintains reasonable dynamics for streaming

---

### 7. True-Peak Limiter

**FFmpeg filter:** `alimiter=limit=0.93:attack=0.5:release=20:level=false`

**Parameters:**

| Parameter | Value | Purpose |
|-----------|-------|---------|
| limit | 0.93 (~-0.63 dBTP) | Maximum output level |
| attack | 0.5 ms | Fast attack for transient control |
| release | 20 ms | Quick release to minimize pumping |
| level | false | Don't auto-adjust input gain |

**Rationale:**
- `limit=0.93` corresponds to approximately -0.63 dBTP
- This ensures final output never exceeds -0.5 dBTP after any codec-induced inter-sample peaks
- Fast attack catches transients; quick release maintains punch

---

## Output Encoding

After processing, audio is encoded based on input format:

| Format | Codec | Settings |
|--------|-------|----------|
| WAV | PCM S24LE | 24-bit lossless |
| FLAC | FLAC | Lossless compression |
| MP3 | libmp3lame | 320 kbps CBR |
| AAC/M4A | AAC | 256 kbps |
| OGG | libvorbis | 192 kbps |

All outputs are resampled to **48 kHz** for broadcast compatibility.

---

## Quality Control

After processing, the output is re-analyzed to verify:

| Check | Target | Tolerance |
|-------|--------|-----------|
| Integrated LUFS | -9 LUFS | -10.0 to -8.5 |
| True Peak | < -0.5 dBTP | Hard limit |

Warnings are logged if targets are not met, but processing continues.

---

## Example Filter Chains

### Pass 1 (Measurement)

**Minimal (clean, well-mastered input):**
```
highpass=f=25,treble=g=1.5:f=8000:t=s,loudnorm=I=-9:TP=-1.0:LRA=5:print_format=json
```

**With compression (dynamic input):**
```
highpass=f=25,acompressor=threshold=-18dB:ratio=2.5:attack=50:release=200,treble=g=1.5:f=8000:t=s,loudnorm=I=-9:TP=-1.0:LRA=5:print_format=json
```

**Full chain (quiet, dynamic input):**
```
highpass=f=25,acompressor=threshold=-18dB:ratio=2.5:attack=50:release=200,treble=g=1.5:f=8000:t=s,asoftclip=type=quintic,loudnorm=I=-9:TP=-1.0:LRA=5:print_format=json
```

### Pass 2 (Linear Processing)

After extracting measured values from pass 1, the same pre-loudnorm chain is used with linear loudnorm + limiter:

**Minimal:**
```
highpass=f=25,treble=g=1.5:f=8000:t=s,loudnorm=I=-9:TP=-1.0:LRA=5:measured_I=-18.5:measured_TP=-0.3:measured_LRA=5.8:measured_thresh=-28.7:offset=0.2:linear=true:print_format=summary,alimiter=limit=0.93:attack=0.5:release=20:level=false
```

**With compression:**
```
highpass=f=25,acompressor=threshold=-18dB:ratio=2.5:attack=50:release=200,treble=g=1.5:f=8000:t=s,loudnorm=I=-9:TP=-1.0:LRA=5:measured_I=-18.5:measured_TP=-0.3:measured_LRA=5.8:measured_thresh=-28.7:offset=0.2:linear=true:print_format=summary,alimiter=limit=0.93:attack=0.5:release=20:level=false
```

**Full chain:**
```
highpass=f=25,acompressor=threshold=-18dB:ratio=2.5:attack=50:release=200,treble=g=1.5:f=8000:t=s,asoftclip=type=quintic,loudnorm=I=-9:TP=-1.0:LRA=5:measured_I=-18.5:measured_TP=-0.3:measured_LRA=5.8:measured_thresh=-28.7:offset=0.2:linear=true:print_format=summary,alimiter=limit=0.93:attack=0.5:release=20:level=false
```

*(Note: measured values shown are examples; actual values come from pass 1 output)*

---

## Comparison: Mastering vs Normalization

For non-music content (podcasts, audiobooks, voiceover), a simpler normalization path is used:

| Aspect | Mastering (Music) | Normalization (Speech) |
|--------|-------------------|------------------------|
| Target LUFS | -9 | -16 to -19 (profile-dependent) |
| Highpass | 25 Hz | 25 Hz |
| Compression | Conditional (crest >10, LRA >5) | None |
| High Shelf | Always (+1.5 dB @ 8 kHz) | None |
| Saturation | Conditional (LUFS <-16, TP <-1.5) | None |
| Limiter | Yes (-0.63 dBTP) | No (loudnorm handles peaks) |
| Use case | Songs, mixes | Podcasts, audiobooks, VO |
