import { writable, get } from 'svelte/store';
import type { HistoryItem } from '../lib/components/DownloadHistory.svelte';

const STORAGE_KEY = 'audiolevel_history';
const FILE_RETENTION_MS = 15 * 60 * 1000; // 15 minutes

// Load from localStorage
function loadHistory(): HistoryItem[] {
  if (typeof window === 'undefined') return [];

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const items: HistoryItem[] = JSON.parse(stored);
    // Filter out expired items
    const now = Date.now();
    return items.filter((item) => item.expiresAt > now);
  } catch {
    return [];
  }
}

// Save to localStorage
function saveHistory(items: HistoryItem[]): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (e) {
    console.error('Failed to save history:', e);
  }
}

// Create store
export const downloadHistory = writable<HistoryItem[]>(loadHistory());

// Subscribe to changes and persist
downloadHistory.subscribe((items) => {
  saveHistory(items);
});

// Add item to history
export function addToHistory(item: Omit<HistoryItem, 'createdAt' | 'expiresAt'>): void {
  const now = Date.now();
  const newItem: HistoryItem = {
    ...item,
    createdAt: now,
    expiresAt: now + FILE_RETENTION_MS,
  };

  downloadHistory.update((items) => {
    // Remove any existing item with same ID
    const filtered = items.filter((i) => i.id !== item.id);
    return [newItem, ...filtered];
  });
}

// Remove item from history
export function removeFromHistory(id: string): void {
  downloadHistory.update((items) => items.filter((item) => item.id !== id));
}

// Clear all history
export function clearHistory(): void {
  downloadHistory.set([]);
}

// Clean up expired items (call periodically)
export function cleanupExpired(): void {
  const now = Date.now();
  downloadHistory.update((items) => items.filter((item) => item.expiresAt > now));
}

// Get item by ID
export function getHistoryItem(id: string): HistoryItem | undefined {
  return get(downloadHistory).find((item) => item.id === id);
}
