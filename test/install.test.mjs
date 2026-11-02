import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const script = fs.readFileSync(new URL('../scripts/install.sh', import.meta.url), 'utf8');

test('bash로 실행하면 파일을 쓰기 전에 zsh 사용을 안내한다', () => {
  const r = spawnSync('/bin/bash', ['-c', script], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /zsh로 실행하세요/);
});

test('plist 문자열은 XML 예약 문자를 이스케이프한다', () => {
  const helper = script.split('\n').find((line) => line.startsWith('xml()'));
  const r = spawnSync('/bin/zsh', ['-c', helper + '\nxml "$1"', 'qa', '/가짜 홈/a&b<c>"\''], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '/가짜 홈/a&amp;b&lt;c&gt;&quot;&apos;');
});

test('엔진 경로 탐색은 별칭 대신 실행 파일을 찾는다', () => {
  const r = spawnSync('/bin/zsh', ['-c', 'alias node="echo alias"; whence -p node'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.trim().startsWith('/'));
  assert.ok(!r.stdout.includes('echo alias'));
});
