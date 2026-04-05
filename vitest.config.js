const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
    test: {
        environment: 'node',
        globals: true,
        include: ['tests/**/*.test.js'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            thresholds: {
                lines: 60,
                functions: 60,
                branches: 50,
                statements: 60
            },
            include: ['lib/**/*.js', 'main.js']
        }
    }
});
