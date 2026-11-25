import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, RequestError } from '../js/engine/index.js';
import { rankSubstitutes } from '../js/engine/substitution.js';
import { isAnchoredLift } from '../js/engine/exercise-max.js';
import { allSetGroups } from '../js/engine/blocks.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const defs = {
  exercises: JSON.parse(readFileSync(join(root, 'js', 'data', 'exercises.seed.json'), 'utf8')).exercises,
  styles: JSON.parse(readFileSync(join(root, 'js', 'data', 'styles.json'), 'utf8')).styles,
  splits: JSON.parse(readFileSync(join(root, 'js', 'data', 'splits.json'), 'utf8')).splits,
  equipment: JSON.parse(readFileSync(join(root, 'js', 'data', 'equipment.json'), 'utf8')).profiles,
  landmarks: JSON.parse(readFileSync(join(root, 'js', 'data', 'landmarks.json'), 'utf8')).landmarks,
  progression: JSON.parse(readFileSync(join(root, 'js', 'data', 'progression.json'), 'utf8')),
  substitutionWeights: JSON.parse(readFileSync(join(root, 'js', 'data', 'substitution-weights.json'), 'utf8'))
};

test('unanchored lifts prescribe varying RIR by style/role with intensityOf1RM null (#47)', () => {
  const bb = generate({
    schemaVersion: 1, styleId: 'bodybuilding', daysPerWeek: 4, blockWeeks: 1,
    equipmentProfile: 'commercial-gym', sessionMinutes: 60, seed: 42,
    athlete: { skillLevel: 2 }, history: []
  }, defs);
  const pl = generate({
    schemaVersion: 1, styleId: 'powerlifting', daysPerWeek: 4, blockWeeks: 1,
    equipmentProfile: 'commercial-gym', sessionMinutes: 60, seed: 42,
    athlete: { skillLevel: 2 }, history: []
  }, defs);

  const byId = new Map(defs.exercises.map((e) => [e.id, e]));
  const bbGroups = bb.weeks[0].sessions.flatMap(allSetGroups);
  const plGroups = pl.weeks[0].sessions.flatMap(allSetGroups);

  const bbUnanchored = bbGroups.filter((g) => !isAnchoredLift(byId.get(g.exerciseId)));
  const plUnanchored = plGroups.filter((g) => !isAnchoredLift(byId.get(g.exerciseId)));
  assert.ok(bbUnanchored.length > 0 && plUnanchored.length > 0);
  assert.ok(bbUnanchored.every((g) => g.intensityOf1RM === null));
  assert.ok(bbUnanchored.some((g) => g.rir === 1));
  assert.ok(plUnanchored.some((g) => g.rir === 2.5));
});

test('athlete.avoidJoints filters selection & substitutes and fails closed on unknown joints (#48)', () => {
  assert.throws(() => generate({
    schemaVersion: 1, styleId: 'strength', daysPerWeek: 3, blockWeeks: 1,
    equipmentProfile: 'commercial-gym', sessionMinutes: 60, seed: 7,
    athlete: { skillLevel: 2, avoidJoints: ['rotator_cuff_vibes'] }, history: []
  }, defs), RequestError);

  const prog = generate({
    schemaVersion: 1, styleId: 'strength', daysPerWeek: 3, blockWeeks: 1,
    equipmentProfile: 'commercial-gym', sessionMinutes: 60, seed: 7,
    athlete: { skillLevel: 2, avoidJoints: ['shoulder'] }, history: []
  }, defs);

  const byId = new Map(defs.exercises.map((e) => [e.id, e]));
  const allGroups = prog.weeks[0].sessions.flatMap(allSetGroups);
  for (const g of allGroups) {
    const ex = byId.get(g.exerciseId);
    assert.equal((ex.jointLoad ?? []).includes('shoulder'), false, `${ex.id} loads shoulder`);
  }

  const squat = byId.get('back-squat');
  const profile = defs.equipment.find((p) => p.id === 'commercial-gym');
  const subs = rankSubstitutes(squat, defs.exercises, defs.substitutionWeights, profile, 5, { avoidJoints: ['knee'] });
  for (const s of subs) {
    assert.equal((s.exercise.jointLoad ?? []).includes('knee'), false);
  }
});
