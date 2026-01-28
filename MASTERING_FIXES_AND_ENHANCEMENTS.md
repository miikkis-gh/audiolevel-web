# AudioLevel Mastering Pipeline Fixes & Enhancements

This document contains all fixes and enhancements to apply to the mastering pipeline.

---

## 1. Fix LUFS Parsing Bug (CRITICAL)

**File:** `backend/src/services/masteringProcessor.ts`

**Problem:** The regex matches the FIRST occurrence of `I: ... LUFS` from FFmpeg progress lines, which shows `-70 LUFS` placeholder. We need the LAST occurrence from the Summary section.

**Find this code in `analyzeLoudnessForMastering`:**
```typescript
// Parse EBU R128 metrics
const integratedMatch = stderr.match(/I:\s*(-?[\d.]+)\s*LUFS/);
const lraMatch = stderr.match(/LRA:\s*(-?[\d.]+)\s*LU/);
const truePeakMatch = stderr.match(/Peak:\s*(-?[\d.]+)\s*dBFS/);
```

**Replace with:**
```typescript
// Extract Summary section to avoid matching progress line placeholder values (-70 LUFS)
const summaryMatch = stderr.match(/Summary:[\s\S]*$/);
const summarySection = summaryMatch ? summaryMatch[0] : '';

// Parse EBU R128 metrics from Summary section only
const integratedMatch = summarySection.match(/I:\s*(-?[\d.]+)\s*LUFS/);
const lraMatch = summarySection.match(/LRA:\s*(-?[\d.]+)\s*LU/);
const truePeakMatch = summarySection.match(/Peak:\s*(-?[\d.]+)\s*dBFS/);
```

**Also add a sanity check after parsing (before the return statement):**
```typescript
// Sanity check: if LUFS is still -70 or lower, parsing likely failed
if (integratedLufs <= -60) {
  log.warn({ 
    integratedLufs, 
    stderrTail: stderr.slice(-1000) 
  }, 'LUFS parsing may have failed - value suspiciously low');
}
```

---

## 2. Extend AudioJobResult Type

**File:** `backend/src/services/queue.ts`

**Find the `AudioJobResult` interface and extend it:**

```typescript
export interface AudioJobResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  duration?: number;
  // Add these new fields for mastering pipeline metadata:
  processingType?: 'ffmpeg-normalize' | 'mastering-pipeline';
  masteringDecisions?: {
    compressionEnabled: boolean;
    saturationEnabled: boolean;
  };
  filterChain?: string;
  inputAnalysis?: {
    inputLufs: number;
    inputTruePeak: number;
    inputLoudnessRange: number;
  };
  outputAnalysis?: {
    inputLufs: number;
    inputTruePeak: number;
    inputLoudnessRange: number;
  };
}
```

---

## 3. Include Mastering Metadata in Job Result

**File:** `backend/src/services/audioProcessor.ts`

**In the `processMasteringPreset` function, update the return statement to include mastering metadata:**

**Find the success return block (around line where it returns after successful processing):**
```typescript
return {
  success: true,
  outputPath: options.outputPath,
  duration,
  inputAnalysis: masterResult.inputAnalysis ? {
    inputLufs: masterResult.inputAnalysis.integratedLufs,
    inputTruePeak: masterResult.inputAnalysis.truePeak,
    inputLoudnessRange: masterResult.inputAnalysis.lra,
  } : undefined,
  outputAnalysis: masterResult.outputAnalysis ? {
    inputLufs: masterResult.outputAnalysis.integratedLufs,
    inputTruePeak: masterResult.outputAnalysis.truePeak,
    inputLoudnessRange: masterResult.outputAnalysis.lra,
  } : undefined,
};
```

**Replace with:**
```typescript
return {
  success: true,
  outputPath: options.outputPath,
  duration,
  // Identify which processing pipeline was used
  processingType: 'mastering-pipeline',
  // Include mastering decisions for verification
  masteringDecisions: masterResult.decisions,
  // Include filter chain for debugging
  filterChain: masterResult.filterChain,
  // Analysis data
  inputAnalysis: masterResult.inputAnalysis ? {
    inputLufs: masterResult.inputAnalysis.integratedLufs,
    inputTruePeak: masterResult.inputAnalysis.truePeak,
    inputLoudnessRange: masterResult.inputAnalysis.lra,
  } : undefined,
  outputAnalysis: masterResult.outputAnalysis ? {
    inputLufs: masterResult.outputAnalysis.integratedLufs,
    inputTruePeak: masterResult.outputAnalysis.truePeak,
    inputLoudnessRange: masterResult.outputAnalysis.lra,
  } : undefined,
};
```

**Also update the return for non-mastering presets to include processingType:**

Find the return statement in the main `normalizeAudio` function (for non-mastering presets) and add:
```typescript
return {
  success: true,
  outputPath: options.outputPath,
  duration,
  processingType: 'ffmpeg-normalize',  // Add this line
  inputAnalysis: inputAnalysis ?? undefined,
  outputAnalysis: outputAnalysis
    ? {
        inputLufs: outputAnalysis.inputLufs,
        inputTruePeak: outputAnalysis.inputTruePeak,
        inputLoudnessRange: outputAnalysis.inputLoudnessRange,
      }
    : undefined,
};
```

---

## 4. Add Verification Logging to Download Endpoint

**File:** `backend/src/routes/upload.ts`

**Find the download handler (the route for `/job/:id/download`) and add detailed logging.**

**Look for code like:**
```typescript
// Stream the file
return c.body(file.stream(), 200, {
  'Content-Type': contentType,
  'Content-Disposition': `attachment; filename="${downloadFilename}"`,
  'Content-Length': String(fileSize),
});
```

**Add logging BEFORE the return:**
```typescript
// Log download verification details
log.info({
  jobId,
  outputPath: result.outputPath,
  fileSize,
  contentType,
  downloadFilename,
  preset: job.data?.preset,
  processingType: result.processingType,
  masteringDecisions: result.masteringDecisions,
  filterChain: result.filterChain,
}, 'Serving download file');

// Stream the file
return c.body(file.stream(), 200, {
  // ...
});
```

**If the log variable isn't available in that scope, create it at the top of the handler:**
```typescript
const log = createChildLogger({ jobId: id, route: 'download' });
```

---

## 5. Enhance Job Status Endpoint

**File:** `backend/src/routes/upload.ts`

**Find the job status handler (the route for `/job/:id`) and ensure it returns mastering metadata.**

The job result should already include the new fields if the AudioJobResult type is updated and the processor returns them. Verify the response includes:

```typescript
// The response should now include these when available:
return c.json({
  jobId: id,
  status: status.status,
  progress: status.progress,
  result: status.result ? {
    success: status.result.success,
    outputPath: status.result.outputPath,
    duration: status.result.duration,
    processingType: status.result.processingType,
    masteringDecisions: status.result.masteringDecisions,
    filterChain: status.result.filterChain,
    inputAnalysis: status.result.inputAnalysis,
    outputAnalysis: status.result.outputAnalysis,
  } : undefined,
  error: status.error,
});
```

---

## Summary of Changes

| File | Change | Priority |
|------|--------|----------|
| `backend/src/services/masteringProcessor.ts` | Fix LUFS parsing (extract Summary section) | **CRITICAL** |
| `backend/src/services/queue.ts` | Extend AudioJobResult type | High |
| `backend/src/services/audioProcessor.ts` | Return processingType, masteringDecisions, filterChain | High |
| `backend/src/routes/upload.ts` | Add download logging with full metadata | Medium |
| `backend/src/routes/upload.ts` | Verify job status includes mastering metadata | Medium |

---

## Testing After Changes

### 1. Verify LUFS Parsing Fix
```bash
# Upload a file with mastering preset
# Check logs for realistic LUFS values (should be -8 to -20, NOT -70)
docker logs audiolevel-backend 2>&1 | grep "integratedLufs"
```

Expected output:
```
integratedLufs: -12.5  (realistic value, not -70)
lra: 7.2               (non-zero for music)
```

### 2. Verify Download Logging
```bash
# Download a processed file
# Check logs for new download verification entry
docker logs audiolevel-backend 2>&1 | grep "Serving download file"
```

Expected output:
```
INFO: Serving download file
    jobId: "abc123"
    outputPath: "/app/outputs/abc123-output.mp3"
    fileSize: 8123456
    processingType: "mastering-pipeline"
    masteringDecisions: {"compressionEnabled": true, "saturationEnabled": false}
    filterChain: "highpass=f=25,acompressor=...,loudnorm=...,alimiter=..."
```

### 3. Verify Job Status Response
```bash
curl http://localhost:3000/api/upload/job/YOUR_JOB_ID | jq
```

Expected response includes:
```json
{
  "jobId": "abc123",
  "status": "completed",
  "result": {
    "success": true,
    "processingType": "mastering-pipeline",
    "masteringDecisions": {
      "compressionEnabled": true,
      "saturationEnabled": false
    },
    "filterChain": "highpass=f=25,..."
  }
}
```

---

## Claude Code Prompt

```
Apply the following changes to the AudioLevel backend:

1. In backend/src/services/masteringProcessor.ts, fix the LUFS parsing bug in analyzeLoudnessForMastering():
   - Extract the "Summary:" section from stderr before parsing
   - Parse integratedLufs, lra, and truePeak from summarySection instead of raw stderr
   - Add a warning log if LUFS is <= -60 (indicates parsing failure)

2. In backend/src/services/queue.ts, extend the AudioJobResult interface to include:
   - processingType?: 'ffmpeg-normalize' | 'mastering-pipeline'
   - masteringDecisions?: { compressionEnabled: boolean; saturationEnabled: boolean }
   - filterChain?: string

3. In backend/src/services/audioProcessor.ts:
   - Update processMasteringPreset() to return processingType, masteringDecisions, and filterChain
   - Update the non-mastering return to include processingType: 'ffmpeg-normalize'

4. In backend/src/routes/upload.ts:
   - Add detailed logging in the download handler that includes jobId, outputPath, fileSize, preset, processingType, masteringDecisions, and filterChain
   - Ensure the job status endpoint returns the new mastering metadata fields

After making changes, rebuild and test with a file using the mastering preset.
```
