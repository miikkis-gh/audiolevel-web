<script lang="ts">
  interface Props {
    visible: boolean;
    onClose: () => void;
  }

  let { visible, onClose }: Props = $props();

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  const techStack = [
    { name: 'FFmpeg', role: 'The audio wizard doing all the heavy lifting', icon: '🎬', url: 'https://ffmpeg.org' },
    { name: 'SoX', role: 'Sound eXchange for spectral analysis', icon: '📊', url: 'https://sox.sourceforge.net' },
    { name: 'ViSQOL', role: 'Perceptual quality scoring (when available)', icon: '👂', url: 'https://github.com/google/visqol' },
    { name: 'Bun', role: 'Speedy runtime for backend & frontend', icon: '🥟', url: 'https://bun.sh' },
    { name: 'Hono', role: 'Lightweight API framework', icon: '🔥', url: 'https://hono.dev' },
    { name: 'SvelteKit', role: 'Reactive UI with minimal overhead', icon: '🧡', url: 'https://svelte.dev' },
    { name: 'Redis + BullMQ', role: 'Job queue for processing pipeline', icon: '📨', url: 'https://redis.io' },
    { name: 'WebGL', role: 'That fancy particle sphere you see', icon: '✨', url: 'https://www.khronos.org/webgl/' },
  ];
</script>

{#if visible}
  <div
    class="about-backdrop"
    onclick={handleBackdropClick}
    onkeydown={handleKeyDown}
    role="presentation"
  >
    <div class="about-modal" role="dialog" aria-label="About AudioLevel" tabindex="-1">
      <button class="about-close" onclick={onClose} aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <div class="about-header">
        <h2>AudioLevel</h2>
        <p class="about-tagline">Intelligent audio normalization for humans</p>
      </div>

      <div class="about-section">
        <h3>What's inside the sphere?</h3>
        <p class="about-intro">
          Behind that mesmerizing particle animation, a whole orchestra of tools
          works together to make your audio sound just right.
        </p>

        <ul class="tech-list">
          {#each techStack as tech}
            <li>
              <a href={tech.url} target="_blank" rel="noopener noreferrer" class="tech-link">
                <span class="tech-icon">{tech.icon}</span>
                <span class="tech-name">{tech.name}</span>
                <span class="tech-role">{tech.role}</span>
                <svg class="tech-external" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </li>
          {/each}
        </ul>
      </div>

      <div class="about-section about-flow">
        <h3>The magic formula</h3>
        <div class="flow-diagram">
          <span class="flow-step">Analyze</span>
          <span class="flow-arrow">→</span>
          <span class="flow-step">Generate candidates</span>
          <span class="flow-arrow">→</span>
          <span class="flow-step">Process in parallel</span>
          <span class="flow-arrow">→</span>
          <span class="flow-step">Pick winner</span>
        </div>
        <p class="flow-note">
          Multiple processing approaches compete. The best one wins.<br />
          Less is more — we prefer conservative processing when results tie.
        </p>
      </div>

      <div class="about-footer">
        <a
          href="https://github.com/miikkis-gh/audiolevel-web"
          target="_blank"
          rel="noopener noreferrer"
          class="github-link"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
          <span>View on GitHub</span>
        </a>
        <div class="creator">
          Made with <span class="heart">♥</span> by <strong>miikkis</strong>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .about-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(4, 5, 8, 0.75);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 0.2s ease-out;
  }

  .about-modal {
    position: relative;
    width: 480px;
    max-width: calc(100vw - 48px);
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    background: rgba(12, 16, 28, 0.96);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 24px;
    padding: 32px;
    animation: modalIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .about-modal::-webkit-scrollbar {
    width: 4px;
  }

  .about-modal::-webkit-scrollbar-track {
    background: transparent;
  }

  .about-modal::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.08);
    border-radius: 4px;
  }

  .about-close {
    position: absolute;
    top: 16px;
    right: 16px;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: none;
    background: rgba(255, 255, 255, 0.06);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s ease;
    color: rgba(255, 255, 255, 0.4);
  }

  .about-close:hover {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.6);
  }

  .about-header {
    text-align: center;
    margin-bottom: 28px;
  }

  .about-header h2 {
    font-family: 'Outfit', sans-serif;
    font-weight: 300;
    font-size: 28px;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.9);
    margin: 0 0 8px 0;
  }

  .about-tagline {
    font-family: 'Outfit', sans-serif;
    font-weight: 300;
    font-size: 14px;
    color: rgba(80, 210, 180, 0.7);
    margin: 0;
  }

  .about-section {
    margin-bottom: 24px;
  }

  .about-section h3 {
    font-family: 'Outfit', sans-serif;
    font-weight: 400;
    font-size: 13px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.5);
    margin: 0 0 12px 0;
  }

  .about-intro {
    font-family: 'Outfit', sans-serif;
    font-weight: 300;
    font-size: 14px;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.6);
    margin: 0 0 16px 0;
  }

  .tech-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .tech-list li {
    list-style: none;
  }

  .tech-link {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 10px;
    transition: all 0.2s ease;
    text-decoration: none;
    color: inherit;
  }

  .tech-link:hover {
    background: rgba(80, 210, 180, 0.08);
    transform: translateX(4px);
  }

  .tech-link:hover .tech-name {
    color: rgba(80, 210, 180, 0.95);
  }

  .tech-link:hover .tech-external {
    opacity: 1;
    color: rgba(80, 210, 180, 0.7);
  }

  .tech-external {
    margin-left: auto;
    opacity: 0;
    transition: opacity 0.2s ease;
    color: rgba(255, 255, 255, 0.3);
    flex-shrink: 0;
  }

  .tech-icon {
    font-size: 16px;
    width: 24px;
    text-align: center;
  }

  .tech-name {
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 500;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.85);
    min-width: 80px;
  }

  .tech-role {
    font-family: 'Outfit', sans-serif;
    font-weight: 300;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.4);
  }

  .about-flow {
    padding: 16px;
    background: rgba(80, 210, 180, 0.04);
    border: 1px solid rgba(80, 210, 180, 0.1);
    border-radius: 14px;
  }

  .flow-diagram {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-bottom: 12px;
  }

  .flow-step {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    font-weight: 400;
    color: rgba(80, 210, 180, 0.9);
    padding: 6px 10px;
    background: rgba(80, 210, 180, 0.1);
    border-radius: 6px;
  }

  .flow-arrow {
    color: rgba(80, 210, 180, 0.4);
    font-size: 14px;
  }

  .flow-note {
    font-family: 'Outfit', sans-serif;
    font-weight: 300;
    font-size: 12px;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.45);
    text-align: center;
    margin: 0;
  }

  .about-footer {
    margin-top: 28px;
    padding-top: 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .github-link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    border-radius: 30px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.75);
    font-family: 'Outfit', sans-serif;
    font-weight: 400;
    font-size: 13px;
    text-decoration: none;
    transition: all 0.2s ease;
  }

  .github-link:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.2);
    color: rgba(255, 255, 255, 0.95);
  }

  .creator {
    font-family: 'Outfit', sans-serif;
    font-weight: 300;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.4);
  }

  .creator strong {
    font-weight: 500;
    color: rgba(255, 255, 255, 0.65);
  }

  .heart {
    color: rgba(255, 100, 120, 0.8);
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes modalIn {
    from {
      opacity: 0;
      transform: scale(0.95) translateY(10px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }
</style>
