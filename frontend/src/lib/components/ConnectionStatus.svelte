<script lang="ts">
  import { connectionState, lastError, reconnectAttempts } from '../../stores/websocket';

  let statusConfig = $derived.by(() => {
    switch ($connectionState) {
      case 'connected':
        return {
          color: 'bg-emerald-500',
          text: 'Connected',
          showPing: false,
        };
      case 'connecting':
        return {
          color: 'bg-amber-500',
          text: 'Connecting...',
          showPing: true,
        };
      case 'reconnecting':
        return {
          color: 'bg-amber-500',
          text: `Reconnecting (${$reconnectAttempts})...`,
          showPing: true,
        };
      case 'disconnected':
        return {
          color: 'bg-red-500',
          text: 'Disconnected',
          showPing: false,
        };
      default:
        return {
          color: 'bg-white/30',
          text: 'Unknown',
          showPing: false,
        };
    }
  });

  let showError = $derived($connectionState === 'disconnected' && $lastError);
</script>

<div class="flex items-center gap-2">
  <div class="flex items-center gap-2">
    <span class="relative flex h-2 w-2">
      {#if statusConfig.showPing}
        <span class="animate-ping absolute inline-flex h-full w-full rounded-full {statusConfig.color} opacity-75"></span>
      {/if}
      <span class="relative inline-flex rounded-full h-2 w-2 {statusConfig.color}"></span>
    </span>
    <span class="text-xs text-white/40">{statusConfig.text}</span>
  </div>

  {#if showError}
    <span class="text-xs text-red-400/80" title={$lastError ?? ''}>
      {$lastError}
    </span>
  {/if}
</div>
