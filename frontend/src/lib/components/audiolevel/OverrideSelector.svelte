<script lang="ts">
  import { OVERRIDE_TYPES, PROFILE_COLORS, type OverrideType } from './constants';

  interface Props {
    currentType: string;
    onSelect: (override: OverrideType) => void;
  }

  let { currentType, onSelect }: Props = $props();
</script>

<div class="override-picker">
  <div class="override-picker-label">Reprocess as</div>
  {#each OVERRIDE_TYPES as ot (ot.key)}
    {@const optPC = PROFILE_COLORS[ot.label] || [80, 210, 180]}
    {@const isCurrent = ot.label === currentType}
    <button
      class="override-option"
      class:current={isCurrent}
      style={isCurrent
        ? `border-color: rgba(${optPC[0]},${optPC[1]},${optPC[2]},.15); background: rgba(${optPC[0]},${optPC[1]},${optPC[2]},.04)`
        : ''}
      onclick={() => !isCurrent && onSelect(ot)}
      disabled={isCurrent}
    >
      <span
        class="override-option-label"
        style={isCurrent ? `color: rgba(${optPC[0]},${optPC[1]},${optPC[2]},.7)` : ''}
      >
        {ot.label}
      </span>
      <span class="override-option-target">{ot.target}</span>
    </button>
  {/each}
</div>

<style>
  .override-picker {
    margin-top: 10px;
    padding: 10px 0;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
  }

  .override-picker-label {
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 500;
    font-size: 10px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.2);
    margin-bottom: 8px;
  }

  .override-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-radius: 10px;
    border: none;
    width: 100%;
    background: rgba(255, 255, 255, 0.02);
    cursor: pointer;
    transition: all 0.15s ease;
    margin-bottom: 4px;
  }

  .override-option:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .override-option:focus-visible {
    outline: 2px solid rgba(80, 210, 180, 0.5);
    outline-offset: 1px;
  }

  .override-option.current {
    border: 1px solid rgba(80, 210, 180, 0.15);
    background: rgba(80, 210, 180, 0.04);
  }

  .override-option-label {
    font-family: 'Outfit', sans-serif;
    font-weight: 400;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
  }

  .override-option.current .override-option-label {
    color: rgba(80, 210, 180, 0.7);
  }

  .override-option-target {
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 300;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.24);
  }
</style>
