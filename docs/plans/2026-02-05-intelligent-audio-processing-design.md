# AudioLevel Intelligent - Design Document

**Date**: 2026-02-05
**Status**: Approved for implementation

## Vision

A hands-off audio processor that analyzes, detects problems, tries multiple processing approaches, and delivers the best result automatically. Users drop files, watch the sphere animate, and download optimized audio.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                    │
│   Existing UI unchanged — particle sphere, drop zone, download button   │
│   + Extended report panel (problems found, approaches tested, winner)   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              BACKEND                                     │
│                                                                          │
│  ┌─────────────┐    ┌──────────────────┐    ┌─────────────────────┐    │
│  │  Analyze    │───▶│ Generate         │───▶│ Process Candidates  │    │
│  │  (FFprobe,  │    │ Candidates       │    │ (Parallel FFmpeg)   │    │
│  │  SoX, FFmpeg)│    │ (2-4 strategies) │    │                     │    │
│  └─────────────┘    └──────────────────┘    └──────────┬──────────┘    │
│                                                         │               │
│                                                         ▼               │
│                      ┌──────────────────┐    ┌─────────────────────┐    │
│                      │ Return Winner    │◀───│ Evaluate & Score    │    │
│                      │ + Report         │    │ (ViSQOL, loudnorm)  │    │
│                      └──────────────────┘    └─────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Tool Stack (Server-Constrained: 4 vCPU, 8GB RAM, No GPU)

| Layer | Tool | Purpose |
|-------|------|---------|
| **Analysis** | FFprobe | Metadata (duration, sample rate, channels, bit depth) |
| | SoX `stats` | RMS, peak, DC offset, silence ratio |
| | FFmpeg `loudnorm` (pass 1) | LUFS, LRA, true peak |
| | FFmpeg `aspectralstats` | Spectral features (mud, sibilance detection) |
| | FFmpeg `silencedetect` | Silence segments for content classification |
| **Processing** | FFmpeg filters | Full processing chain |
| | `dynaudnorm` | Volume leveling for speech (no pumping) |
| | `acompressor` | Gentle compression for music (when needed) |
| | `anlmdn` | Noise reduction |
| | `loudnorm` | Final loudness normalization |
| **Evaluation** | ViSQOL | Perceptual quality scoring |
| | pyloudnorm | Precise LUFS measurement |

---

## Content Classification (Heuristic-Based)

```typescript
interface ContentClassification {
  type: 'speech' | 'music' | 'podcast_mixed' | 'unknown';
  confidence: number;  // 0-1
}

function classifyContent(metrics: AnalysisMetrics): ContentClassification {
  const {
    silenceRatio,      // From silencedetect
    spectralFlatness,  // From aspectralstats
    rmsVariance,       // From sox stats
    zeroCrossingRate,  // Derived from spectral data
  } = metrics;

  // Speech indicators
  const speechScore = 
    (silenceRatio > 0.15 ? 0.3 : 0) +      // Pauses between phrases
    (rmsVariance > 0.4 ? 0.3 : 0) +         // Variable loudness
    (zeroCrossingRate > 0.1 ? 0.2 : 0) +    // High ZCR
    (spectralFlatness > 0.5 ? 0.2 : 0);     // Noise-like spectrum

  // Music indicators
  const musicScore =
    (silenceRatio < 0.05 ? 0.3 : 0) +       // Continuous sound
    (rmsVariance < 0.2 ? 0.3 : 0) +          // Steady loudness
    (spectralFlatness < 0.3 ? 0.4 : 0);      // Tonal content

  if (speechScore > 0.7) {
    return { type: 'speech', confidence: speechScore };
  }
  if (musicScore > 0.7) {
    return { type: 'music', confidence: musicScore };
  }
  if (speechScore > 0.4 && musicScore > 0.4) {
    return { type: 'podcast_mixed', confidence: 0.6 };
  }
  return { type: 'unknown', confidence: 0.5 };
}
```

---

## Problem Detection

| Problem | Detection Method | Threshold |
|---------|------------------|-----------|
| **Clipping** | `astats` Flat_factor, Peak count | Flat_factor > 0 or peaks > 100 |
| **Noise floor** | RMS of quiet segments | > -50 dB |
| **DC offset** | `sox stats` DC offset | > 0.01 |
| **Low loudness** | `loudnorm` integrated LUFS | < -24 LUFS |
| **Excessive LRA** | `loudnorm` LRA | Speech: > 15, Music: > 20 |
| **Sibilance** | 5-8kHz energy ratio | > 6dB above neighbors |
| **Muddiness** | 200-500Hz energy ratio | > 4dB above curve |
| **Stereo imbalance** | L/R RMS difference | > 3dB |
| **Silence padding** | `silencedetect` | > 0.5s at start/end |

---

## Processing Chains

### Correct Processing Order (Professional Standard)

1. DC offset removal / High-pass (cleanup)
2. Noise reduction (before compression)
3. Corrective EQ (cut problems)
4. De-esser (speech only)
5. Leveling — `dynaudnorm` for speech, gentle `acompressor` for music (if needed)
6. Loudness normalization (always last, single limiter)

### Speech Chain

```
highpass=f=80,
[IF noise] anlmdn=s=7,
[IF mud] equalizer=f=300:t=q:w=1:g=-2,
[IF sibilance] deesser=i=0.4:m=0.5:f=5500:s=o,
dynaudnorm=f=150:g=15:p=0.95:b=1,
loudnorm=I=-16:TP=-1.5:LRA=11
```

### Music Chain

```
highpass=f=30,
[IF noise] anlmdn=s=2,
[IF LRA > 20] acompressor=threshold=-6dB:ratio=1.5:attack=50:release=500:knee=8,
loudnorm=I=-14:TP=-1:LRA=11
```

**Key Music Principles:**
- Most music needs NO compression (already compressed in mix)
- Only compress if LRA > 20 (genuinely excessive dynamic range)
- Max 1-2 dB gain reduction
- Ratio 1.5:1, attack 50ms, release 500ms (preserve transients, avoid pumping)
- Let `loudnorm` handle loudness — that's its job

---

## Candidate Generation

| Candidate | Speech | Music |
|-----------|--------|-------|
| **A. Conservative** | Minimal: highpass + loudnorm only | Minimal: highpass + loudnorm only |
| **B. Balanced** | Full chain with dynaudnorm | Noise reduction + loudnorm (no compression) |
| **C. Aggressive** | Stronger noise reduction (s=10) | Light compression (1.5:1, 1-2dB) if LRA > 15 |
| **D. Content-optimized** | Podcast preset + detected fixes | Streaming preset + detected fixes |

---

## Evaluation & Winner Selection

### Metrics

- Integrated LUFS (target compliance)
- LRA (dynamic range preserved)
- True Peak (safety)
- ViSQOL score (perceptual quality vs original — degradation check only)

### Scoring Weights

```typescript
const WEIGHTS = {
  speech: {
    loudnessAccuracy: 0.25,
    dynamicRange: 0.15,
    peakSafety: 0.10,
    noiseReduction: 0.25,
    quality: 0.25,
  },
  music: {
    loudnessAccuracy: 0.20,
    dynamicRange: 0.30,  // Preserve dynamics (important!)
    peakSafety: 0.10,
    noiseReduction: 0.10,
    quality: 0.30,       // Perceptual quality (important!)
  },
};
```

### Winner Selection Logic

```typescript
function pickWinner(candidates: CandidateScore[], contentType: string): CandidateScore {
  // 1. Safety filter
  const safe = candidates.filter(c => c.metrics.truePeak <= -0.5);
  
  // 2. Quality filter (reject severe degradation only)
  const quality = safe.filter(c => c.metrics.visqol >= 3.0);
  
  // 3. Fallback to conservative if all rejected
  if (quality.length === 0) {
    return candidates.find(c => c.name === 'Conservative')!;
  }
  
  // 4. Sort by weighted score
  const sorted = quality.sort((a, b) => b.totalScore - a.totalScore);
  
  // 5. Prefer conservative on ties (within 5%) — "less is more"
  if (sorted.length >= 2) {
    const diff = (sorted[0].totalScore - sorted[1].totalScore) / sorted[0].totalScore;
    if (diff < 0.05) {
      const conservative = sorted.find(c => c.name === 'Conservative');
      if (conservative) return conservative;
    }
  }
  
  return sorted[0];
}
```

---

## Output Quality Standards

| Aspect | Standard |
|--------|----------|
| **Format** | Process internally as lossless (WAV), encode winner to target format |
| **Sample rate** | Preserve original |
| **Bit depth** | Preserve original |
| **Channels** | Preserve original (mono stays mono) |
| **Loudness** | Speech: -16 LUFS, Music: -14 LUFS |
| **True peak** | Speech: -1.5 dBTP, Music: -1.0 dBTP |
| **Limiting** | Single limiter only (loudnorm's built-in) |

---

## Frontend Changes

Reuse existing report panel, add new sections:

```
Analysis Report
├── Content Type + Confidence        ← existing
├── Detection Signals                ← existing
├── Problems Found                   ← NEW
│   • Noise floor at -42 dB
│   • Dynamic range 18 LRA
├── Processing Applied               ← NEW
│   • Noise reduction (gentle)
│   • Volume leveling
│   • Normalized to -16 LUFS
├── Approaches Tested                ← NEW (collapsible)
│   A. Conservative — Score: 72
│   B. Balanced — Score: 88 ✓
│   C. Aggressive — Score: 81
│   Why B won: Best noise reduction without artifacts
├── Levels (before → after)          ← existing
├── Target Applied                   ← existing
└── Notes                            ← existing
```

---

## New Backend Services

```
backend/src/services/
├── audioAnalyzer.ts        ← NEW: Content classification + problem detection
├── candidateGenerator.ts   ← NEW: Build processing strategies
├── audioProcessor.ts       ← NEW: Execute FFmpeg chains
├── audioEvaluator.ts       ← NEW: Score with ViSQOL + metrics
└── ... existing services
```

---

## API Changes

### Job Result Extended

```typescript
interface JobResult {
  // ... existing fields
  
  // NEW fields
  processingReport?: {
    contentType: string;
    contentConfidence: number;
    problemsDetected: { problem: string; details: string }[];
    processingApplied: string[];
    candidatesTested: { name: string; score: number; isWinner: boolean }[];
    winnerReason: string;
  };
}
```

### New Endpoint

```
GET /api/upload/job/:id/report  → Full processing report
```

---

## Dependencies to Add

```dockerfile
# In Dockerfile
RUN apt-get install -y sox

# Python sidecar (for ViSQOL) — optional, can defer
RUN pip install pyloudnorm visqol
```

---

## Implementation Phases

| Phase | Scope | Files |
|-------|-------|-------|
| **1. Analysis** | Content classification + problem detection | `audioAnalyzer.ts` |
| **2. Processing** | Filter chain builder, candidate generation | `candidateGenerator.ts`, `audioProcessor.ts` |
| **3. Evaluation** | Scoring logic, winner selection | `audioEvaluator.ts` |
| **4. Integration** | Wire into job processor | `normalizationProcessor.ts` |
| **5. Frontend** | Extend report panel | `SingleReport.svelte` |
| **6. Testing** | Unit tests, various audio types | `__tests__/` |

---

## Professional Standards Applied

| Principle | How Applied |
|-----------|-------------|
| Lossless intermediate processing | Process as WAV, encode winner only |
| Preserve sample rate / bit depth | Never downsample |
| Single limiter | Use loudnorm's built-in only |
| Loudness-match A/B comparison | Normalize candidates before scoring |
| Can't fix clipping | Detect, warn, mitigate |
| Preserve mono | Don't upmix |
| Less is more | Prefer conservative on ties |
| Music: minimal compression | Only if LRA > 20, max 1-2dB |
| Speech: avoid pumping | Use dynaudnorm, not heavy compression |
| Correct chain order | Cleanup → Noise → EQ → De-ess → Level → Normalize |

---

## Research Sources

- [iZotope Signal Chain](https://www.izotope.com/en/learn/signal-chain-order-of-operations.html)
- [Sound on Sound Processing Order](https://www.soundonsound.com/sound-advice/q-which-order-mix-processors)
- [Mastering The Mix - Compression](https://www.masteringthemix.com/blogs/learn/mastering-compression-everything-you-need-to-know)
- [Waves - Mastering Compression](https://www.waves.com/8-tips-for-compression-in-mastering)
- [Google ViSQOL](https://github.com/google/visqol)
- [MulderSoft dynaudnorm](https://muldersoft.com/docs/dyauno_readme.html)
- [Just Mastering Philosophy](https://www.justmastering.com/article-masteringphilosophy.php)
- [Sage Audio - Less is More](https://www.sageaudio.com/articles/mixing-less-is-more)
