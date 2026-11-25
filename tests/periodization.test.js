import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../js/engine/index.js';
import { allSetGroups } from '../js/engine/blocks.js';

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

test('4-week block ramps intensity monotonically across weeks 1-3 and deloads week 4 (#45)', () => {
  for (const styleId of ['strength', 'powerlifting', 'bodybuilding']) {
    const req = {
      schemaVersion: 1,
      styleId,
      daysPerWeek: 3,
      blockWeeks: 4,
      equipmentProfile: 'commercial-gym',
      sessionMinutes: 60,
      seed: 20260813,
      athlete: { skillLevel: 2 },
      history: []
    };
    const prog = generate(req, defs);
    const progAgain = generate(req, defs);
    assert.equal(JSON.stringify(prog), JSON.stringify(progAgain), `${styleId} must remain deterministic`);

    const mains = prog.weeks.map((w) =>
      allSetGroups(w.sessions[0]).find((g) => g.role === 'main' && g.intensityOf1RM != null)
    );
    if (mains.every(Boolean)) {
      assert.ok(mains[0].intensityOf1RM <= mains[1].intensityOf1RM);
      assert.ok(mains[1].intensityOf1RM <= mains[2].intensityOf1RM);
      assert.ok(mains[3].intensityOf1RM < mains[2].intensityOf1RM, `${styleId} week 4 deload should be lighter`);
      assert.ok(mains[3].rir >= mains[2].rir, `${styleId} week 4 deload RIR should not be harder`);
    }
  }
});
