<script lang="ts">
  import { fetchActivityStats, fetchGenreStats, type ActivityStats, type ActivityEvent, type GenreStats } from '../../../stores/api';

  interface Props {
    wsUrl: string;
  }

  let { wsUrl }: Props = $props();

  let stats = $state<ActivityStats | null>(null);
  let genreStats = $state<GenreStats | null>(null);
  let recentActivity = $state<ActivityEvent[]>([]);
  let expanded = $state(false);
  let ws: WebSocket | null = null;
  let connected = $state(false);

  // Fetch initial stats
  async function loadStats() {
    try {
      const [activityData, genreData] = await Promise.all([
        fetchActivityStats(),
        fetchGenreStats().catch(() => null),
      ]);
      stats = activityData;
      recentActivity = activityData.recentActivity || [];
      genreStats = genreData;
    } catch (err) {
      console.warn('Failed to load activity stats:', err);
    }
  }

  // Connect to WebSocket for live updates
  function connectWebSocket() {
    if (ws) return;

    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        connected = true;
        // Subscribe to activity feed
        ws?.send(JSON.stringify({ type: 'subscribe_activity' }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'activity') {
            // Add new activity to the front
            const newEvent: ActivityEvent = {
              contentType: msg.contentType,
              timestamp: msg.timestamp,
            };
            recentActivity = [newEvent, ...recentActivity.slice(0, 19)];

            // Update today's count
            if (stats) {
              stats = { ...stats, todayFiles: stats.todayFiles + 1 };
            }
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onclose = () => {
        connected = false;
        ws = null;
        // Reconnect after delay
        setTimeout(connectWebSocket, 5000);
      };

      ws.onerror = () => {
        ws?.close();
      };
    } catch {
      // Ignore connection errors
    }
  }

  function disconnect() {
    if (ws) {
      ws.send(JSON.stringify({ type: 'unsubscribe_activity' }));
      ws.close();
      ws = null;
    }
  }

  $effect(() => {
    loadStats();
    connectWebSocket();

    // Refresh stats periodically
    const interval = setInterval(loadStats, 60000);

    return () => {
      clearInterval(interval);
      disconnect();
    };
  });

  function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    if (hours >= 1) {
      return `${hours}h`;
    }
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m`;
  }

  function formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  }

  function getContentIcon(contentType: string): string {
    switch (contentType.toLowerCase()) {
      case 'music': return '';
      case 'speech': return '';
      case 'podcast': return '';
      default: return '';
    }
  }

  function getContentLabel(contentType: string): string {
    switch (contentType.toLowerCase()) {
      case 'music': return 'Music track';
      case 'speech': return 'Speech audio';
      case 'podcast': return 'Podcast episode';
      default: return 'Audio file';
    }
  }
</script>

<div class="activity-panel" class:expanded>
  <button class="panel-header" onclick={() => (expanded = !expanded)}>
    <div class="header-stats">
      <span class="stat-main">
        {#if stats}
          {stats.todayFiles} processed today
        {:else}
          Loading...
        {/if}
      </span>
      {#if connected}
        <span class="live-dot" title="Live updates active"></span>
      {/if}
    </div>
    <svg
      class="expand-icon"
      class:rotated={expanded}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  </button>

  {#if expanded && stats}
    <div class="panel-content">
      <div class="stats-grid">
        <div class="stat-item">
          <span class="stat-value">{stats.weekFiles}</span>
          <span class="stat-label">this week</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{stats.totalFiles.toLocaleString()}</span>
          <span class="stat-label">all time</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{formatDuration(stats.totalDurationSeconds)}</span>
          <span class="stat-label">audio processed</span>
        </div>
      </div>

      {#if stats.totalFiles > 0}
        <div class="content-breakdown">
          {#if stats.contentBreakdown.music > 0}
            <span class="content-tag music" title="Music">
               {Math.round((stats.contentBreakdown.music / stats.totalFiles) * 100)}%
            </span>
          {/if}
          {#if stats.contentBreakdown.speech > 0}
            <span class="content-tag speech" title="Speech">
               {Math.round((stats.contentBreakdown.speech / stats.totalFiles) * 100)}%
            </span>
          {/if}
          {#if stats.contentBreakdown.podcast > 0}
            <span class="content-tag podcast" title="Podcast">
               {Math.round((stats.contentBreakdown.podcast / stats.totalFiles) * 100)}%
            </span>
          {/if}
        </div>
      {/if}

      {#if genreStats && genreStats.topGenres.length > 0}
        <div class="genre-section">
          <div class="section-label">Top genres (user-confirmed)</div>
          <div class="genre-bars">
            {#each genreStats.topGenres.slice(0, 4) as genre}
              <div class="genre-bar-row">
                <span class="genre-name">{genre.genre}</span>
                <div class="genre-bar-track">
                  <div class="genre-bar-fill" style="width: {genre.percentage}%"></div>
                </div>
                <span class="genre-percent">{genre.percentage}%</span>
              </div>
            {/each}
          </div>
          {#if genreStats.totalConfirmed > 0}
            <div class="genre-total">{genreStats.totalConfirmed} genres confirmed</div>
          {/if}
        </div>
      {/if}

      {#if recentActivity.length > 0}
        <div class="activity-feed">
          <div class="feed-label">Recent activity</div>
          {#each recentActivity.slice(0, 5) as event}
            <div class="activity-item">
              <span class="activity-icon">{getContentIcon(event.contentType)}</span>
              <span class="activity-text">{getContentLabel(event.contentType)} processed</span>
              <span class="activity-time">{formatTimeAgo(event.timestamp)}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .activity-panel {
    position: fixed;
    bottom: 70px;
    left: 16px;
    background: rgba(16, 20, 32, 0.95);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    min-width: 180px;
    max-width: 260px;
    z-index: 100;
    font-family: 'Outfit', sans-serif;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    transition: all 0.2s ease;
  }

  .activity-panel.expanded {
    min-width: 240px;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 10px 14px;
    background: none;
    border: none;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.8);
    font-size: 12px;
    font-weight: 400;
    text-align: left;
  }

  .panel-header:hover {
    color: rgba(255, 255, 255, 1);
  }

  .header-stats {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .stat-main {
    font-weight: 500;
  }

  .live-dot {
    width: 6px;
    height: 6px;
    background: rgba(80, 210, 160, 0.9);
    border-radius: 50%;
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(0.9); }
  }

  .expand-icon {
    transition: transform 0.2s ease;
    opacity: 0.5;
  }

  .expand-icon.rotated {
    transform: rotate(180deg);
  }

  .panel-content {
    padding: 0 14px 14px;
    animation: fadeIn 0.2s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    padding-bottom: 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    margin-bottom: 10px;
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .stat-value {
    font-size: 14px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.9);
  }

  .stat-label {
    font-size: 9px;
    color: rgba(255, 255, 255, 0.4);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .content-breakdown {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    margin-bottom: 10px;
  }

  .content-tag {
    font-size: 10px;
    padding: 3px 8px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.7);
  }

  .content-tag.music {
    background: rgba(100, 180, 255, 0.15);
    color: rgba(100, 180, 255, 0.9);
  }

  .content-tag.speech {
    background: rgba(180, 130, 255, 0.15);
    color: rgba(180, 130, 255, 0.9);
  }

  .content-tag.podcast {
    background: rgba(210, 160, 80, 0.15);
    color: rgba(230, 180, 100, 0.9);
  }

  .genre-section {
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    margin-bottom: 10px;
  }

  .section-label {
    font-size: 9px;
    color: rgba(255, 255, 255, 0.35);
    text-transform: uppercase;
    letter-spacing: 0.3px;
    margin-bottom: 8px;
  }

  .genre-bars {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .genre-bar-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .genre-name {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.7);
    width: 70px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .genre-bar-track {
    flex: 1;
    height: 4px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 2px;
    overflow: hidden;
  }

  .genre-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, rgba(100, 180, 255, 0.6), rgba(100, 180, 255, 0.9));
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .genre-percent {
    font-size: 9px;
    color: rgba(255, 255, 255, 0.5);
    width: 28px;
    text-align: right;
  }

  .genre-total {
    font-size: 9px;
    color: rgba(255, 255, 255, 0.35);
    text-align: center;
    margin-top: 6px;
  }

  .activity-feed {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .feed-label {
    font-size: 9px;
    color: rgba(255, 255, 255, 0.35);
    text-transform: uppercase;
    letter-spacing: 0.3px;
    margin-bottom: 2px;
  }

  .activity-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.6);
  }

  .activity-icon {
    font-size: 12px;
  }

  .activity-text {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .activity-time {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.35);
    white-space: nowrap;
  }

  /* Mobile responsiveness - Tablet */
  @media (max-width: 768px) {
    .activity-panel {
      bottom: 60px;
      left: 12px;
      min-width: 160px;
      max-width: 220px;
    }

    .panel-header {
      padding: 8px 12px;
      font-size: 11px;
    }

    .panel-content {
      padding: 0 12px 12px;
    }

    .stat-value {
      font-size: 12px;
    }

    .stat-label {
      font-size: 8px;
    }
  }

  /* Mobile responsiveness - Small screens (hide panel) */
  @media (max-width: 480px) {
    .activity-panel {
      display: none;
    }
  }
</style>
