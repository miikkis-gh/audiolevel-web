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
  attemptsMade?: number
): Promise<void> {
  const embed: DiscordEmbed = {
    title: '❌ Job Processing Failed',
    color: 0xef4444, // Red
    fields: [
      { name: 'Job ID', value: jobId, inline: true },
      { name: 'File', value: fileName.substring(0, 100) || 'Unknown', inline: true },
      { name: 'Attempts', value: String(attemptsMade || 1), inline: true },
      { name: 'Error', value: error.substring(0, 1000) || 'Unknown error' },
    ],
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
  }
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : error;
  const errorStack = error instanceof Error ? error.stack?.substring(0, 500) : undefined;

  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: 'Error', value: errorMessage.substring(0, 1000) || 'Unknown error' },
  ];

  if (context?.endpoint) {
    fields.push({ name: 'Endpoint', value: `${context.method || 'GET'} ${context.endpoint}`, inline: true });
  }

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
