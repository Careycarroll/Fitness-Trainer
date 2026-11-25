import test from 'node:test';
import assert from 'node:assert/strict';
import { defs } from '../js/engine/defs.js';
import { generate } from '../js/engine/index.js';
import { canTransition, nextFeasiblePoses } from '../js/engine/mobilityDomain.js';
import { allSetGroups } from '../js/engine/blocks.js';

test('all predefined mobility flows follow feasible position transitions (#65)', () => {
  const byId = new Map(defs.exercises.map((e) => [e.id, e]));
  assert.ok(defs.mobilityFlows.length >= 10);

  for (const flow of defs.mobilityFlows) {
    for (let i = 1; i < flow.poses.length; i++) {
      const prev = byId.get(flow.poses[i - 1].exerciseId);
      const curr = byId.get(flow.poses[i].exerciseId);
      assert.ok(prev && curr, `missing pose in flow ${flow.id}`);
      assert.equal(
        canTransition(prev.position, curr.position),
        true,
        `${flow.id}: ${prev.id} (${prev.position}) -> ${curr.id} (${curr.position}) is infeasible`
      );
    }
  }
});

test('mobility styles generate deterministic flow sessions without fatigue budget (#65)', () => {
  for (const styleId of ['yoga', 'pilates', 'flexibility']) {
    const req = {
      schemaVersion: 1,
      styleId,
      daysPerWeek: 3,
      blockWeeks: 1,
      equipmentProfile: 'home-garage',
      sessionMinutes: 30,
      seed: 20261125,
      athlete: { skillLevel: 2 },
      history: []
    };
    const p1 = generate(req, defs);
    const p2 = generate(req, defs);
    assert.equal(JSON.stringify(p1), JSON.stringify(p2));
    assert.equal(p1.domain, 'mobility');
    const sess = p1.weeks[0].sessions[0];
    assert.equal(sess.fatigueUsed, null);
    assert.equal(sess.fatigueBudget, null);
    assert.equal(sess.blocks[0].blockType, 'flow');
    assert.ok(allSetGroups(sess).every((g) => g.holdSeconds > 0));
  }
});

test('nextFeasiblePoses returns only poses reachable from current position (#65)', () => {
  const plank = defs.exercises.find((e) => e.id === 'flow-high-plank');
  const next = nextFeasiblePoses(plank, defs.exercises);
  assert.ok(next.length > 0);
  assert.ok(next.every((e) => canTransition(plank.position, e.position)));
  assert.equal(next.some((e) => e.id === 'pilates-hundred'), false); // supine cannot follow plank directly

  const cobra = defs.exercises.find((e) => e.id === 'cobra-pose');
  const fromCobra = nextFeasiblePoses(cobra, defs.exercises);
  assert.equal(fromCobra.some((e) => e.id === 'childs-pose'), true);
});
