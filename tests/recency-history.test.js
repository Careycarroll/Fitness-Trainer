import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../js/engine/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const defs = {
  exercises: JSON.parse(readFileSync(join(root, 'js', 'data', 'exercises.seed.json'), 'utf8')).exercises,
  styles: JSON.parse(readFileSync(join(root, 'js', 'data', 'styles.json'), 'utf8')).styles,
  splits: JSON.parse(readFileSync(join(root, 'js', 'data', 'splits.json'), 'utf8')).splits,
  equipment: JSON.parse(readFileSync(join(root, 'js', 'data', 'equipment.json'), 'utf8')).profiles,
  landmarks: JSON.parse(readFileSync(join(root, 'js', 'data', 'landmarks.json'), 'utf8')).landmarks,
  progression: JSON.parse(readFileSync(join(root, 'js', 'data', 'progression.json'), 'utf8'))
};

test('generate() keeps empty history deterministic and shifts selection when recent history is heavy', () => {
  const baseReq = {
    schemaVersion: 1,
    styleId: 'bodybuilding',
    daysPerWeek: 4,
    blockWeeks: 1,
    equipmentProfile: 'commercial-gym',
    sessionMinutes: 60,
    seed: 12345,
    athlete: { skillLevel: 2 },
    history: []
  };

  const a = generate(baseReq, defs);
  const b = generate(baseReq, defs);
  assert.equal(JSON.stringify(a), JSON.stringify(b));

  const firstExIds = a.weeks[0].sessions.flatMap((s) =>
    s.blocks.flatMap((blk) => blk.setGroups.map((g) => g.exerciseId))
  );
  // Hammer the exact chosen accessories in recent history to trigger recency penalty
  const heavyHistory = firstExIds.flatMap((id) =>
    Array.from({ length: 8 }, () => ({ exerciseId: id, date: '2026-11-24', rir: 1 }))
  );
  const shifted = generate({ ...baseReq, history: heavyHistory }, defs);
  const shiftedIds = shifted.weeks[0].sessions.flatMap((s) =>
    s.blocks.flatMap((blk) => blk.setGroups.map((g) => g.exerciseId))
  );
  assert.notEqual(JSON.stringify(shiftedIds), JSON.stringify(firstExIds));
});
