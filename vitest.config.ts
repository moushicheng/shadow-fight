import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: {
            'db://': path.resolve(__dirname, 'game/assets/scripts'),
        },
    },
    test: {
        include: ['tests/**/*.test.ts'],
        globals: true,
    },
});
