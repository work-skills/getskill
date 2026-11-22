/** 布尔开关：不消费下一个 token（如 `getskill --json search pdf`）。 */
const BOOLEAN_FLAGS = new Set([
    'json',
    'force',
    'all',
    'prune',
    'keep-cache',
    'help',
    'brief',
    'categories'
]);

export function parseCommandOptions(rawArgs: string[]): {
    positionals: string[];
    options: Record<string, string | boolean>;
} {
    const positionals: string[] = [];
    const options: Record<string, string | boolean> = {};

    for (let index = 0; index < rawArgs.length; index += 1) {
        const token = rawArgs[index];

        if (!token.startsWith('-')) {
            positionals.push(token);
            continue;
        }

        if (token.startsWith('--')) {
            const eqIndex = token.indexOf('=');
            if (eqIndex > -1) {
                const key = token.slice(2, eqIndex);
                const value = token.slice(eqIndex + 1);
                options[key] = BOOLEAN_FLAGS.has(key)
                    ? value !== 'false'
                    : value;
                continue;
            }

            const key = token.slice(2);
            if (BOOLEAN_FLAGS.has(key)) {
                options[key] = true;
                continue;
            }

            const nextToken = rawArgs[index + 1];
            if (nextToken && !nextToken.startsWith('-')) {
                options[key] = nextToken;
                index += 1;
            } else {
                options[key] = true;
            }
            continue;
        }

        if (token === '-V') {
            const nextToken = rawArgs[index + 1];
            if (nextToken && !nextToken.startsWith('-')) {
                options.version = nextToken;
                index += 1;
            } else {
                options.version = true;
            }
        }
    }

    return { positionals, options };
}
