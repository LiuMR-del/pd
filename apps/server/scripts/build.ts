import { build } from 'esbuild';

// Bundles the server (including the workspace packages and the generated Prisma client) into
// dist/main.js; npm dependencies stay external and are loaded from node_modules at runtime.
await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  packages: 'external',
  plugins: [
    {
      name: 'bundle-workspace',
      setup(b) {
        b.onResolve({ filter: /^@pd\// }, async (args) => {
          if (args.pluginData === 'ws') return undefined;
          const r = await b.resolve(args.path, { resolveDir: args.resolveDir, kind: args.kind, pluginData: 'ws' });
          return { path: r.path, external: false };
        });
      },
    },
  ],
  logLevel: 'info',
});
