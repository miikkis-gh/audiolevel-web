# Processing Estimator Design

**Date**: 2026-02-05  
**Status**: Approved  
**Purpose**: Skip or reduce candidate evaluation for files similar to previously processed ones

## Problem

The intelligent processing pipeline generates 3+ candidates for every file, executes all in parallel, then picks the winner. For similar files (e.g., a batch of podcast episodes), this is wasteful—the same candidate typically wins.

## Solution

Add an estimation step that compares incoming files against historical outcomes. If a similar file was processed before, predict the winner and either skip evaluation entirely or run a reduced candidate set.

## Data Model

### ProcessingOutcome (stored in JSON)

```typescript
interface Fingerprint {
  integratedLufs: number;
  loudnessRange: number;
  silenceRatio: number;
  spectralCentroid: number;
  spectralFlatness: number;
}

interface ProcessingOutcome {
  fingerprint: Fingerprint;
  winnerCandidateId: string;
  winnerAggressiveness: 'conservative' | 'balanced' | 'aggressive';
  contentType: ContentType;
  timestamp: number;
  wasPredicted?: boolean;
  predictionCorrect?: boolean;
}
```

### Storage

- File: `data/processing-history.json`
- Format: Array of `ProcessingOutcome` records
- Max entries: 10,000 (prune oldest when exceeded)

## Similarity Algorithm

### Metric Normalization

Each metric is normalized to 0-1 scale using known ranges:

| Metric | Min | Max | Unit |
|--------|-----|-----|------|
| integratedLufs | -60 | 0 | dB LUFS |
| loudnessRange | 0 | 30 | dB |
| silenceRatio | 0 | 1 | ratio |
| spectralCentroid | 100 | 8000 | Hz |
| spectralFlatness | 0 | 1 | ratio |

### Distance Calculation

Euclidean distance across normalized metrics:

```typescript
function computeDistance(a: Fingerprint, b: Fingerprint): number {
  const metrics = ['integratedLufs', 'loudnessRange', 'silenceRatio', 
                   'spectralCentroid', 'spectralFlatness'];
  
  let sumSquares = 0;
  for (const metric of metrics) {
    const normA = normalize(a[metric], RANGES[metric]);
    const normB = normalize(b[metric], RANGES[metric]);
    sumSquares += (normA - normB) ** 2;
  }
  
  return Math.sqrt(sumSquares) / Math.sqrt(metrics.length); // 0-1 scale
}
```

### Confidence Tiers

| Distance | Tier | Action |
|----------|------|--------|
| < 0.05 | High | Skip evaluation, use cached winner |
| 0.05 - 0.15 | Moderate | Run 2 candidates: predicted winner + alternative |
| > 0.15 | Low | Full evaluation (current behavior) |

Thresholds are configurable via environment variables.

## Pipeline Integration

### Flow

```
Analyze → Check History → [branch by confidence]
               │
    ┌──────────┼──────────────┐
    │          │              │
  High      Moderate        Low
    │          │              │
Use cached  2 candidates   Full pipeline
    │          │              │
    └──────────┴──────────────┘
               │
         Execute & Evaluate
               │
         Record Outcome
```

### New Service: processingEstimator.ts

```typescript
// Load/save history
function loadHistory(): ProcessingOutcome[]
function saveOutcome(outcome: ProcessingOutcome): void

// Find similar historical files
function findSimilar(fingerprint: Fingerprint): SimilarMatch | null

interface SimilarMatch {
  confidence: 'high' | 'moderate';
  predictedWinner: string;
  distance: number;
  matchCount: number;
}

// Extract fingerprint from analysis
function extractFingerprint(metrics: AnalysisMetrics): Fingerprint
```

### Changes to intelligentProcessor.ts

After `analyzeAudio()`:

1. Extract fingerprint from metrics
2. Call `findSimilar(fingerprint)`
3. Based on confidence tier:
   - High: Set winner directly, skip candidate execution
   - Moderate: Generate only 2 candidates (predicted + alternative)
   - Low/None: Proceed with full pipeline
4. After processing: Call `saveOutcome()` with result

## Accuracy Tracking

### Logging

```
[estimator] Prediction HIT: predicted="conservative-speech", distance=0.032, tier=high
[estimator] Prediction MISS: predicted="conservative-speech", actual="balanced-speech", distance=0.12, tier=moderate
```

### Stats

```typescript
interface EstimatorStats {
  totalPredictions: number;
  highConfidenceHits: number;
  highConfidenceMisses: number;
  moderateConfidenceHits: number;
  moderateConfidenceMisses: number;
  lastUpdated: number;
}
```

Stats stored in `data/estimator-stats.json` for periodic review.

## File Structure

### New Files

```
backend/src/
├── services/
│   └── processingEstimator.ts
├── types/
│   └── estimator.ts
    
data/
├── processing-history.json
└── estimator-stats.json
```

### Modified Files

- `backend/src/services/intelligentProcessor.ts` - Add estimation check
- `backend/src/config/env.ts` - Add threshold config

## Configuration

New environment variables:

```bash
# Estimator settings
ESTIMATOR_HISTORY_PATH=data/processing-history.json
ESTIMATOR_HIGH_THRESHOLD=0.05
ESTIMATOR_MODERATE_THRESHOLD=0.15
ESTIMATOR_MAX_HISTORY=10000
ESTIMATOR_ENABLED=true
```

## Future Enhancements (not in v1)

- Add content type as hard filter (only match within same type)
- Adaptive thresholds based on accuracy stats
- Frontend badge showing "Estimated from similar file"
- Weighted metrics (some may matter more than others)

## Testing

- Unit tests for distance calculation and normalization
- Unit tests for tier classification
- Integration test with mock history file
- Accuracy tracking validation
