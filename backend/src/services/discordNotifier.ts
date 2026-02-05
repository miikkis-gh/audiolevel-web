/**
 * Discord Notifier Service
 *
 * Sends notifications to Discord webhook for errors, alerts, and monitoring.
 * Fire-and-forget - failures don't affect application flow.
 *
 * @module services/discordNotifier
 */

import { env } from '../config/env';
import { logger } from '../utils/logger';
import { getHourlyActivity, getActivityStats } from './activityStats';
import { getGenreStats } from './genreStats';
import { AppError, ERROR_MESSAGES } from '../middleware/errorHandler';

interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
}

/**
 * Send a Discord embed notification
 */
async function sendEmbed(embed: DiscordEmbed): Promise<void> {
  const webhookUrl = env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    return; // Silently skip if no webhook configured
  }

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch (err) {
    logger.warn({ err }, 'Failed to send Discord notification');
  }
}

/**
 * Notify about a job processing failure
 */
export async function notifyJobFailure(
  jobId: string,
  fileName: string,
  error: string,
  attemptsMade?: number,
  errorCode?: string
): Promise<void> {
  // Look up hint from error code if available
  const errorInfo = errorCode ? ERROR_MESSAGES[errorCode] : undefined;
  const hint = errorInfo?.hint;

  const fields: DiscordEmbed['fields'] = [
    { name: 'Job ID', value: jobId, inline: true },
    { name: 'File', value: fileName.substring(0, 100) || 'Unknown', inline: true },
    { name: 'Attempts', value: String(attemptsMade || 1), inline: true },
  ];

  // Add error code if available
  if (errorCode) {
    fields.push({ name: 'Code', value: `\`${errorCode}\``, inline: true });
  }

  // Add error message
  fields.push({ name: 'Error', value: error.substring(0, 1000) || 'Unknown error' });

  // Add hint if available
  if (hint) {
    fields.push({ name: '💡 Hint', value: hint });
  }

  const embed: DiscordEmbed = {
    title: '❌ Job Processing Failed',
    color: 0xef4444, // Red
    fields,
    footer: { text: 'AudioLevel Error Monitor' },
    timestamp: new Date().toISOString(),
  };

  await sendEmbed(embed);
}

/**
 * Notify about an application/server error
 */
export async function notifyServerError(
  error: Error | string,
  context?: {
    endpoint?: string;
    method?: string;
    userId?: string;
    code?: string;
  }
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : error;
  const errorStack = error instanceof Error ? error.stack?.substring(0, 500) : undefined;

  // Extract code and hint from AppError or context
  const errorCode = error instanceof AppError ? error.code : context?.code;
  const hint = error instanceof AppError ? error.hint : (errorCode ? ERROR_MESSAGES[errorCode]?.hint : undefined);

  const fields: { name: string; value: string; inline?: boolean }[] = [];

  // Add endpoint first if available
  if (context?.endpoint) {
    fields.push({ name: 'Endpoint', value: `${context.method || 'GET'} ${context.endpoint}`, inline: true });
  }

  // Add error code if available
  if (errorCode) {
    fields.push({ name: 'Code', value: `\`${errorCode}\``, inline: true });
  }

  // Add error message
  fields.push({ name: 'Error', value: errorMessage.substring(0, 1000) || 'Unknown error' });

  // Add hint if available
  if (hint) {
    fields.push({ name: '💡 Hint', value: hint });
  }

  // Add stack trace last
  if (errorStack) {
    fields.push({ name: 'Stack Trace', value: `\`\`\`\n${errorStack}\n\`\`\`` });
  }

  const embed: DiscordEmbed = {
    title: '🔥 Server Error',
    color: 0xdc2626, // Darker red
    fields,
    footer: { text: 'AudioLevel Error Monitor' },
    timestamp: new Date().toISOString(),
  };

  await sendEmbed(embed);
}

/**
 * Notify about a startup event (useful for monitoring restarts)
 */
export async function notifyServerStart(): Promise<void> {
  const embed: DiscordEmbed = {
    title: '🚀 Server Started',
    color: 0x22c55e, // Green
    fields: [
      { name: 'Environment', value: env.NODE_ENV, inline: true },
      { name: 'Port', value: String(env.PORT), inline: true },
      { name: 'Max Concurrent Jobs', value: String(env.MAX_CONCURRENT_JOBS), inline: true },
    ],
    footer: { text: 'AudioLevel Monitor' },
    timestamp: new Date().toISOString(),
  };

  await sendEmbed(embed);
}

/**
 * Notify about high error rate or system issues
 */
export async function notifyAlert(
  title: string,
  message: string,
  severity: 'warning' | 'critical' = 'warning'
): Promise<void> {
  const embed: DiscordEmbed = {
    title: severity === 'critical' ? `🚨 ${title}` : `⚠️ ${title}`,
    description: message,
    color: severity === 'critical' ? 0xdc2626 : 0xf59e0b, // Red or amber
    footer: { text: 'AudioLevel Alert' },
    timestamp: new Date().toISOString(),
  };

  await sendEmbed(embed);
}

/**
 * Generate QuickChart URL for activity graph
 */
function generateChartUrl(labels: string[], data: number[]): string {
  const chartConfig = {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Files Processed',
          data,
          backgroundColor: 'rgba(80, 210, 180, 0.7)',
          borderColor: 'rgba(80, 210, 180, 1)',
          borderWidth: 1,
        },
      ],
    },
    options: {
      plugins: {
        title: {
          display: true,
          text: 'Activity - Last 6 Hours',
          color: '#ffffff',
          font: { size: 16 },
        },
        legend: { display: false },
      },
      scales: {
        x: {
          ticks: { color: '#cccccc' },
          grid: { color: 'rgba(255,255,255,0.1)' },
        },
        y: {
          beginAtZero: true,
          ticks: { color: '#cccccc', stepSize: 1 },
          grid: { color: 'rgba(255,255,255,0.1)' },
        },
      },
    },
  };

  const encoded = encodeURIComponent(JSON.stringify(chartConfig));
  return `https://quickchart.io/chart?c=${encoded}&backgroundColor=%230f0f1a&width=600&height=300`;
}

/**
 * Format duration in human readable format
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

/**
 * Post 6-hour activity report with chart to Discord
 */
export async function postActivityReport(): Promise<void> {
  const webhookUrl = env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    return;
  }

  try {
    // Get activity data
    const [hourlyData, stats, genreStats] = await Promise.all([
      getHourlyActivity(6),
      getActivityStats(),
      getGenreStats().catch(() => null),
    ]);

    const labels = hourlyData.map((d) => d.hour);
    const data = hourlyData.map((d) => d.count);
    const totalInPeriod = data.reduce((sum, n) => sum + n, 0);

    // Generate chart URL
    const chartUrl = generateChartUrl(labels, data);

    // Build fields array
    const fields: { name: string; value: string; inline?: boolean }[] = [
      { name: 'Last 6 Hours', value: String(totalInPeriod), inline: true },
      { name: 'Today', value: String(stats.todayFiles), inline: true },
      { name: 'This Week', value: String(stats.weekFiles), inline: true },
      { name: 'Total Files', value: String(stats.totalFiles), inline: true },
      { name: 'Total Duration', value: formatDuration(stats.totalDurationSeconds), inline: true },
      {
        name: 'Content Mix',
        value: `🎵 ${stats.contentBreakdown.music} | 🎙️ ${stats.contentBreakdown.speech} | 🎧 ${stats.contentBreakdown.podcast}`,
        inline: true,
      },
    ];

    // Add genre stats if available
    if (genreStats && genreStats.topGenres.length > 0) {
      const topGenresText = genreStats.topGenres
        .slice(0, 5)
        .map((g) => `${g.genre}: ${g.percentage}%`)
        .join(' | ');
      fields.push({
        name: '🎸 Top Genres',
        value: topGenresText,
        inline: false,
      });

      if (genreStats.todayConfirmed > 0) {
        fields.push({
          name: 'Genres Confirmed',
          value: `Today: ${genreStats.todayConfirmed} | Total: ${genreStats.totalConfirmed}`,
          inline: true,
        });
      }
    }

    // Build embed with image
    const embed = {
      title: '📊 Activity Report',
      color: 0x50d2b4, // Teal
      image: { url: chartUrl },
      fields,
      footer: { text: 'AudioLevel Stats' },
      timestamp: new Date().toISOString(),
    };

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });

    logger.info('Posted activity report to Discord');
  } catch (err) {
    logger.error({ err }, 'Failed to post activity report to Discord');
  }
}
