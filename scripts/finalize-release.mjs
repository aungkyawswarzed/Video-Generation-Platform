import { readdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const dir = path.resolve('release');
const manifest = JSON.parse(
  await readFile(
    path.join(dir, 'win-unpacked', 'resources', 'licenses', 'BUILD-MANIFEST.json'),
    'utf8',
  ),
);
for (const [name, expected] of [
  ['node.exe', manifest.nodeSha256],
  ['ffmpeg.exe', manifest.ffmpegBinarySha256],
]) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(
    path.join(dir, 'win-unpacked', 'resources', 'runtime', name),
  ))
    hash.update(chunk);
  if (hash.digest('hex') !== expected)
    throw new Error(`Packaged ${name} no longer matches its verified runtime manifest.`);
}
await copyFile('desktop/WINDOWS-README.txt', path.join(dir, 'READ-ME-FIRST.txt'));
const lines = [];
for (const name of (await readdir(dir))
  .filter((name) => /^Frame-Studio-.*Windows-x64\.(exe|zip)$/.test(name))
  .sort()) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path.join(dir, name))) hash.update(chunk);
  lines.push(`${hash.digest('hex')}  ${name}`);
}
if (lines.length < 2) throw new Error('Both the Windows installer and no-install ZIP must exist.');
await writeFile(path.join(dir, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
console.log(`Windows release ready:\n${lines.join('\n')}`);
