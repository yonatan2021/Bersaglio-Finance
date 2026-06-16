import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        // Use forks instead of threads as it's often more stable for memory-heavy tests
        pool: 'forks',
        // Run files sequentially to keep memory usage low
        fileParallelism: false,
        // Enable isolation to ensure memory is cleared between test files
        isolate: true,
        // Increase timeout for scraper-related tests
        testTimeout: 60000,
    },
});
