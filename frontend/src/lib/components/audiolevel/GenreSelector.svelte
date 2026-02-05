<script lang="ts">
  import { BROAD_GENRES, GENRE_SUBCATEGORIES, confirmGenre, type GenreGuess } from '../../../stores/api';

  interface Props {
    jobId: string;
    genreGuess: GenreGuess | null;
    onConfirm?: () => void;
    onDismiss?: () => void;
  }

  let { jobId, genreGuess, onConfirm, onDismiss }: Props = $props();

  let selectedBroad = $state(genreGuess?.broad || '');
  let selectedDetailed = $state('');
  let showSubcategories = $state(false);
  let confirming = $state(false);
  let dismissed = $state(false);

  // Auto-dismiss timer
  let dismissTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    // Set initial selection from guess
    if (genreGuess?.broad && !selectedBroad) {
      selectedBroad = genreGuess.broad;
    }

    // Auto-dismiss after 30 seconds
    dismissTimer = setTimeout(() => {
      if (!dismissed && !confirming) {
        handleDismiss();
      }
    }, 30000);

    return () => {
      if (dismissTimer) clearTimeout(dismissTimer);
    };
  });

  function handleBroadSelect(genre: string) {
    selectedBroad = genre;
    selectedDetailed = ''; // Reset subcategory when changing broad
  }

  function handleDetailedSelect(sub: string) {
    selectedDetailed = sub;
  }

  async function handleConfirm() {
    if (!selectedBroad || confirming) return;

    confirming = true;
    await confirmGenre(jobId, selectedBroad, selectedDetailed || undefined);
    confirming = false;
    dismissed = true;
    onConfirm?.();
  }

  function handleDismiss() {
    dismissed = true;
    onDismiss?.();
  }

  // Get confidence display
  const confidenceLabel = $derived(
    genreGuess?.confidence === 'high'
      ? 'Sounds like'
      : genreGuess?.confidence === 'medium'
        ? 'Probably'
        : 'What genre is this?'
  );

  const showGuessLabel = $derived(genreGuess && genreGuess.confidence !== 'low');

  // Get subcategories for selected broad genre
  const subcategories = $derived(
    selectedBroad ? GENRE_SUBCATEGORIES[selectedBroad] || [] : []
  );
</script>

{#if !dismissed}
  <div class="genre-selector">
    <div class="genre-header">
      {#if showGuessLabel}
        <span class="genre-icon">🎵</span>
        <span class="genre-label">{confidenceLabel} <strong>{genreGuess?.broad}</strong></span>
      {:else}
        <span class="genre-icon">🎵</span>
        <span class="genre-label">What genre is this?</span>
      {/if}
      <button class="dismiss-btn" onclick={handleDismiss} aria-label="Dismiss">×</button>
    </div>

    <div class="genre-chips">
      {#each BROAD_GENRES as genre}
        <button
          class="genre-chip"
          class:selected={selectedBroad === genre}
          onclick={() => handleBroadSelect(genre)}
        >
          {genre}
        </button>
      {/each}
    </div>

    {#if subcategories.length > 0}
      <button
        class="subcategory-toggle"
        onclick={() => (showSubcategories = !showSubcategories)}
      >
        {showSubcategories ? '▾' : '›'} Pick subgenre (optional)
      </button>

      {#if showSubcategories}
        <div class="subcategory-chips">
          {#each subcategories as sub}
            <button
              class="subcategory-chip"
              class:selected={selectedDetailed === sub}
              onclick={() => handleDetailedSelect(sub)}
            >
              {sub}
            </button>
          {/each}
        </div>
      {/if}
    {/if}

    <button
      class="confirm-btn"
      onclick={handleConfirm}
      disabled={!selectedBroad || confirming}
    >
      {confirming ? 'Saving...' : 'Confirm'}
    </button>
  </div>
{/if}

<style>
  .genre-selector {
    margin-top: 16px;
    padding: 14px 16px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    animation: fadeUp 0.4s ease-out;
  }

  .genre-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }

  .genre-icon {
    font-size: 14px;
  }

  .genre-label {
    flex: 1;
    font-family: 'Outfit', sans-serif;
    font-size: 12px;
    font-weight: 400;
    color: rgba(255, 255, 255, 0.6);
  }

  .genre-label strong {
    color: rgba(255, 255, 255, 0.85);
    font-weight: 500;
  }

  .dismiss-btn {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.3);
    font-size: 18px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }

  .dismiss-btn:hover {
    color: rgba(255, 255, 255, 0.6);
  }

  .genre-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 10px;
  }

  .genre-chip {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    font-weight: 400;
    padding: 5px 10px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.03);
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .genre-chip:hover {
    border-color: rgba(255, 255, 255, 0.2);
    color: rgba(255, 255, 255, 0.7);
  }

  .genre-chip.selected {
    border-color: rgba(80, 210, 180, 0.4);
    background: rgba(80, 210, 180, 0.1);
    color: rgba(80, 210, 180, 0.9);
  }

  .subcategory-toggle {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.35);
    cursor: pointer;
    padding: 4px 0;
    margin-bottom: 8px;
  }

  .subcategory-toggle:hover {
    color: rgba(255, 255, 255, 0.5);
  }

  .subcategory-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-bottom: 10px;
    animation: fadeUp 0.2s ease-out;
  }

  .subcategory-chip {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    font-weight: 400;
    padding: 4px 8px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.02);
    color: rgba(255, 255, 255, 0.4);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .subcategory-chip:hover {
    border-color: rgba(255, 255, 255, 0.15);
    color: rgba(255, 255, 255, 0.6);
  }

  .subcategory-chip.selected {
    border-color: rgba(147, 112, 219, 0.4);
    background: rgba(147, 112, 219, 0.1);
    color: rgba(177, 142, 249, 0.9);
  }

  .confirm-btn {
    display: block;
    width: 100%;
    margin-top: 10px;
    padding: 8px 16px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    font-weight: 500;
    border: none;
    border-radius: 8px;
    background: rgba(80, 210, 180, 0.15);
    color: rgba(80, 210, 180, 0.9);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .confirm-btn:hover:not(:disabled) {
    background: rgba(80, 210, 180, 0.25);
  }

  .confirm-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  @keyframes fadeUp {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* Mobile styles */
  @media (max-width: 480px) {
    .genre-selector {
      padding: 12px 14px;
    }

    .genre-chip {
      font-size: 9px;
      padding: 4px 8px;
    }

    .subcategory-chip {
      font-size: 8px;
      padding: 3px 6px;
    }
  }
</style>
