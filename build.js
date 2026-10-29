import { mkdir, copyFile } from 'node:fs/promises';

const files = ['index.html', 'style.css', 'app.js', 'memories.js', 'engine.js', 'server.js', 'package.json', 'build.js', 'verify-model.js', 'README.md', 'LICENSE', 'tests/engine.test.js', 'tests/server.test.js'];
await mkdir(new URL('./dist/', import.meta.url), { recursive: true });
await mkdir(new URL('./dist/tests/', import.meta.url), { recursive: true });
for (const file of files) await copyFile(new URL(file, import.meta.url), new URL(`dist/${file}`, import.meta.url));
console.log('Built Last Witness in dist/. Run node dist/server.js to play.');
