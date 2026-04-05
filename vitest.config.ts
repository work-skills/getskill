import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            thresholds: {
                lines: 60,
                functions: 60,
                branches: 50,
                statements: 60
            },
            include: ['main.ts', 'lib/**/*.ts']
        }
    }
});
