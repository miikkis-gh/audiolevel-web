# Genre Detection & Community Stats Design

## Overview

Add music genre detection heuristics with user confirmation, feeding into community-wide genre statistics.

**Goals:**
1. Personal insight - Show users what genre their music is (AI guess + optional correction)
2. Community stats - Aggregate anonymous genre data shown in Activity Panel
3. Feedback loop - Collect user-confirmed genres for potential future improvements

## Genre Categories

### Broad Categories (AI-guessed)
- Electronic
- Rock
- Hip-Hop
- Pop
- Classical
- Jazz
- Folk/Acoustic
- Other

### Detailed Subcategories (User-selected)

| Broad | Subcategories |
|-------|---------------|
| Electronic | House, Techno, Drum & Bass, Dubstep, Trance, Ambient Electronic |
| Rock | Alternative, Metal, Punk, Indie, Classic Rock |
| Hip-Hop | Rap, Trap, Lo-Fi Hip-Hop, R&B |
| Pop | Synth Pop, Indie Pop, Dance Pop |
| Classical | Orchestral, Chamber, Piano, Film Score |
| Jazz | Smooth Jazz, Bebop, Fusion |
| Folk/Acoustic | Country, Singer-Songwriter, World |
| Other | Podcast Intro, Sound Effects, Experimental |

## Genre Heuristics

Map existing audio analysis signals to genre probabilities:

| Signal | Electronic | Rock | Hip-Hop | Classical | Jazz | Folk |
|--------|------------|------|---------|-----------|------|------|
| High tempo (>130 BPM) | ✓✓ | ✓ | | | | |
| Low tempo (<90 BPM) | | | ✓ | ✓ | ✓ | ✓ |
| High dynamic range (LRA >12) | | ✓ | | ✓✓ | ✓ | |
| Low dynamic range (LRA <6) | ✓ | | ✓✓ | | | |
| High spectral brightness | ✓ | ✓ | | | | |
| Low spectral brightness | | | ✓ | ✓ | ✓ | ✓ |
| Consistent energy | ✓✓ | | ✓ | | | |
| Variable energy | | ✓ | | ✓✓ | ✓✓ | |

Returns: `{ broad: string, confidence: 'low' | 'medium' | 'high' }`

Low confidence shows "What genre is this?" without pre-selection.

## Data Model

### Redis Keys

```
# Per-job genre (temporary, expires with job)
genre:job:{jobId} = { guess: "Electronic", confirmed: "House", confidence: "medium" }

# Aggregate community stats (permanent counters)
stats:genre:broad:{genre}        # e.g., stats:genre:broad:electronic = 1542
stats:genre:detailed:{genre}     # e.g., stats:genre:detailed:house = 387
stats:genre:daily:{date}:{genre} # e.g., stats:genre:daily:2026-02-05:electronic = 23
```

### TypeScript Types

```typescript
interface GenreGuess {
  broad: string;
  detailed?: string;
  confidence: 'low' | 'medium' | 'high';
  confirmedByUser: boolean;
}

interface GenreStats {
  topGenres: { genre: string; count: number }[];
  todayBreakdown: { genre: string; count: number }[];
}
```

## API Endpoints

```
POST /api/genre/confirm
Body: { jobId, broad, detailed? }
Response: { success: true }

GET /api/stats/genres
Response: { topGenres: [...], todayBreakdown: [...] }
```

## UI Components

### Completion Screen Genre Selector

Shows below download button when content type is "music":

- Header: "Sounds like {genre}" or "What genre is this?"
- Broad category chips (radio selection, AI guess pre-selected)
- Expandable subgenre section (optional)
- Confirm button → saves to stats
- Auto-dismisses after 30s or on reset

### Activity Panel Genre Bars

New section in expanded Activity Panel:

```
Today's genres
▓▓▓▓▓▓░░░░ Electronic 58%
▓▓▓░░░░░░░ Hip-Hop 25%
▓▓░░░░░░░░ Rock 17%
```

Only shows when genre data exists. Top 3 genres displayed.

## Data Flow

```
1. Upload → Analyze → genreHeuristics.ts guesses genre
2. Job result includes genreGuess: { broad, confidence }
3. Frontend shows completion screen with genre chips
4. User confirms/changes → POST /api/genre/confirm
5. Redis increments stats counters
6. Activity Panel fetches GET /api/stats/genres
7. Discord 6h report includes top genres
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `backend/src/services/genreHeuristics.ts` | New - heuristic logic |
| `backend/src/services/genreStats.ts` | New - Redis stats |
| `backend/src/routes/stats.ts` | Add genre endpoints |
| `backend/src/services/audioAnalyzer.ts` | Call genre heuristics |
| `frontend/.../GenreSelector.svelte` | New - chip selector UI |
| `frontend/.../AudioLevelUI.svelte` | Add genre to complete screen |
| `frontend/.../ActivityPanel.svelte` | Add genre bars |
| `frontend/src/stores/api.ts` | Add API functions |

## Edge Cases

- Non-music files → genre selector not shown
- Low confidence → show prompt without pre-selection
- User ignores prompt → no stats recorded, doesn't block
- No genre data yet → hide section in Activity Panel
- Subgenre without broad → auto-set parent broad category

## Future Considerations (Not Implemented)

- Audio fingerprinting via AcoustID/MusicBrainz
- Machine learning from user confirmations
- Genre-based processing adjustments
- User accounts with personal genre history
