import * as path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, 'src/test/unit/vscodeMock.ts'),
    },
  },
  test: {
    include: ['src/test/unit/**/*.test.ts'],
    environment: 'node',
  },
});
