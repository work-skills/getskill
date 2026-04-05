module.exports = {
    root: true,
    env: {
        node: true,
        es2021: true
    },
    extends: ['eslint:recommended', 'prettier'],
    parserOptions: {
        ecmaVersion: 'latest'
    },
    ignorePatterns: [
        'node_modules/',
        'coverage/',
        'dist/',
        '*.tgz',
        'clawhub/',
        'Claw-CLI/'
    ],
    overrides: [
        {
            files: ['**/*.ts'],
            parser: '@typescript-eslint/parser',
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module'
            },
            plugins: ['@typescript-eslint'],
            extends: ['plugin:@typescript-eslint/recommended']
        },
        {
            files: ['tests/**/*.test.{js,ts}'],
            globals: {
                describe: 'readonly',
                it: 'readonly',
                expect: 'readonly'
            }
        }
    ],
    rules: {
        'no-console': 'off'
    }
};
