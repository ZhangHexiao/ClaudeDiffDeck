const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const watch = process.argv.includes('--watch');

const hostOpts = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  external: ['vscode'],
  outfile: 'dist/extension.js',
  sourcemap: true,
  format: 'cjs',
  logLevel: 'info'
};

const webviewOpts = {
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  platform: 'browser',
  target: 'es2020',
  outfile: 'dist/webview.js',
  sourcemap: true,
  format: 'iife',
  logLevel: 'info'
};

function copyStatic() {
  fs.mkdirSync('dist', { recursive: true });
  fs.copyFileSync('src/webview/index.html', 'dist/index.html');
  fs.copyFileSync('src/webview/styles.css', 'dist/styles.css');
}

(async () => {
  if (watch) {
    const hostCtx = await esbuild.context(hostOpts);
    const webCtx = await esbuild.context(webviewOpts);
    copyStatic();
    await Promise.all([hostCtx.watch(), webCtx.watch()]);
    console.log('watching...');
  } else {
    await esbuild.build(hostOpts);
    await esbuild.build(webviewOpts);
    copyStatic();
    console.log('build done');
  }
})().catch(e => { console.error(e); process.exit(1); });
