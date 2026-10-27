import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupProjects } from '../src/iot/project-groups.ts';
const project = (id, projectType, relatedProjectIds = [], has3dContent = false) => ({ id, name: id, projectType, relatedProjectIds, has3dContent });
test('classifies by project content while preserving both directions of references', () => {
  const groups = groupProjects([
    project('board1', '2d', ['scene1'], true), project('board2', '2d', ['scene2'], true),
    project('scene1', '3d', ['board1']), project('scene2', '3d'),
    project('scene3', '3d', ['board3']), project('board3', '2d'),
    project('model-board', '2d', [], true),
  ]);
  assert.deepEqual(groups.combined.map(p => p.id), ['board1', 'board2', 'model-board']);
  assert.deepEqual(groups.scenes.map(p => p.id), ['scene1', 'scene2', 'scene3']);
  assert.deepEqual(groups.boards.map(p => p.id), ['board3']);
  assert.deepEqual([...groups.incoming.get('scene2')], ['board2']);
  assert.deepEqual([...groups.incoming.get('board3')], ['scene3']);
});
test('retains unavailable references and rejects missing classification data', () => {
  const groups = groupProjects([project('board', '2d', ['missing'], true)]);
  assert.deepEqual(groups.combined.map(p => p.id), ['board']);
  assert.throws(() => groupProjects([{ id: 'bad', name: 'bad', projectType: '2d' }]), /分类信息不完整/);
});
