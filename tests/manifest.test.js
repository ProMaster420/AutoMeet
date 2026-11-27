import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('manifest is MV3 and every referenced file exists', () => {
  assert.equal(manifest.manifest_version, 3);
  const files = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap((c) => c.js),
  ];
  for (const f of files) assert.ok(fs.existsSync(path.join(root, f)), `missing ${f}`);
});

test('permissions stay minimal', () => {
  assert.deepEqual([...manifest.permissions].sort(), ['alarms', 'identity', 'identity.email', 'notifications', 'offscreen', 'storage']);
  assert.equal(manifest.host_permissions, undefined);
});

test('offscreen sound player and chime exist', () => {
  for (const f of ['src/offscreen/offscreen.html', 'src/offscreen/offscreen.js', 'sounds/chime.wav']) {
    assert.ok(fs.existsSync(path.join(root, f)), `missing ${f}`);
  }
});
