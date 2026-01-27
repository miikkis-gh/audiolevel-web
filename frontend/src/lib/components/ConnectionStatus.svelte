<script lang="ts">
  import { connectionState, lastError, reconnectAttempts } from '../../stores/websocket';

  let statusColor = $derived.by(() => {
    switch ($connectionState) {
      case 'connected':
        return 'bg-green-500';
      case 'connecting':
      case 'reconnecting':
        return 'bg-yellow-500';
      case 'disconnected':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  });

  let statusText = $derived.by(() => {
    switch ($connectionState) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'reconnecting':
        return `Reconnecting (${$reconnectAttempts})...`;
      case 'disconnected':
        return 'Disconnected';
      default:
        return 'Unknown';
    }
  });

  let showError = $derived($connectionState === 'disconnected' && $lastError);
</script>

<div class="flex items-center gap-2">
  <div class="flex items-center gap-1.5">
    <span class="relative flex h-2.5 w-2.5">
      {#if $connectionState === 'connecting' || $connectionState === 'reconnecting'}
        <span class="animate-ping absolute inline-flex h-full w-full rounded-full {statusColor} opacity-75"></span>
      {/if}
      <span class="relative inline-flex rounded-full h-2.5 w-2.5 {statusColor}"></span>
    </span>
    <span class="text-xs text-gray-500 dark:text-gray-400">{statusText}</span>
  </div>

  {#if showError}
    <span class="text-xs text-red-500 dark:text-red-400" title={$lastError ?? ''}>
      {$lastError}
    </span>
  {/if}
</div>
