<script lang="ts">
  let status = $state('Ready');
</script>

<main class="min-h-screen flex flex-col items-center justify-center p-8">
  <div class="max-w-2xl w-full">
    <h1 class="text-4xl font-bold text-center mb-2">AudioLevel</h1>
    <p class="text-gray-600 text-center mb-8">
      Free audio normalization with industry-standard presets
    </p>

    <div class="bg-white rounded-lg shadow-lg p-8">
      <div
        class="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-primary-500 transition-colors cursor-pointer"
      >
        <svg
          class="w-12 h-12 mx-auto mb-4 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <p class="text-gray-600">
          Drag & drop your audio file here, or click to browse
        </p>
        <p class="text-sm text-gray-400 mt-2">
          Supports WAV, MP3, FLAC, AAC, OGG (max 100MB)
        </p>
      </div>

      <p class="text-center text-sm text-gray-500 mt-4">
        Status: {status}
      </p>
    </div>

    <p class="text-center text-xs text-gray-400 mt-8">
      Files are automatically deleted after 15 minutes. No account required.
    </p>
  </div>
</main>
