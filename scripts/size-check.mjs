import { stat } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';

const MAX_BYTES = 16777216;
const target = fileURLToPath(new URL('../dist-single/index.html', import.meta.url));

let info;
try {
  info = await stat(target);
} catch {
  console.error('size-check: dist-single/index.html is missing — run the single-file build first.');
  process.exit(1);
}

const mb = (info.size / 1048576).toFixed(2);

if (info.size > MAX_BYTES) {
  console.error(
    `size-check: dist-single/index.html is ${mb} MB (${info.size} bytes), over the ${(
      MAX_BYTES / 1048576
    ).toFixed(2)} MB limit.`
  );
  process.exit(1);
}

console.log(`size-check: dist-single/index.html is ${mb} MB (${info.size} bytes) — OK.`);
