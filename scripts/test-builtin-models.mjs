import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'factory-model-test-'));
const require = createRequire(import.meta.url);
try {
  execFileSync(process.execPath, [join(root, 'apps/web/node_modules/typescript/bin/tsc'),
    '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node', '--strict', '--skipLibCheck',
    '--rootDir', root, '--outDir', temporary,
    ...['apps/api/src/canvas.ts', 'apps/api/src/model-assets.ts', 'apps/web/src/canvas/types.ts', 'shared/builtin-models.ts'].map((f) => join(root, f)),
  ], { cwd: root, stdio: 'inherit' });
  const { createCanvasNode, parseModel3DProps } = require(join(temporary, 'apps/web/src/canvas/types.js'));
  const { validateCanvasPatch, applyCanvasPatch } = require(join(temporary, 'apps/api/src/canvas.js'));
  const { listModelAssets, modelAssetContentResponse } = require(join(temporary, 'apps/api/src/model-assets.js'));
  const { builtinModels, findBuiltinModel } = require(join(temporary, 'shared/builtin-models.js'));
  const patch = (node) => validateCanvasPatch({ expectedRevision: 0, upsertNodes: [node], deleteNodeIds: [] });
  for (const model of builtinModels) {
    const bytes = readFileSync(join(root, 'apps/web/public', model.contentPath));
    assert.equal(bytes.length, model.byteSize);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), model.sha256);
    assert.equal(bytes.readUInt32LE(0), 0x46546c67);
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    const names = gltf.nodes.map((n) => n.name);
    assert.equal(names.length, new Set(names).size, 'independent parts need unique, stable names');
    assert.ok(names.every((n) => typeof n === 'string' && n.length > 0));
    assert.equal(names.length, model.inspection.nodeCount);
    assert.ok(gltf.nodes.some((n) => n.extras?.inspectionShell));
    assert.equal(gltf.nodes.filter((n) => n.extras?.explodeOffset).length, 8);
    assert.ok(gltf.nodes.filter((n) => n.extras?.category === 'flow').length > 300);
    assert.equal(gltf.animations.length, model.inspection.animationCount);
    assert.equal(gltf.animations[0].channels.length, 420);
    assert.ok(!gltf.buffers.some((b) => b.uri));
    assert.ok(!gltf.images.some((b) => b.uri));
    // Sample every animation accessor: finite values and exact loop seams, not only clip metadata.
    const binary = bytes.subarray(28 + bytes.readUInt32LE(12));
    function accessor(index) {
      const a = gltf.accessors[index], v = gltf.bufferViews[a.bufferView];
      assert.equal(a.componentType, 5126);
      const width = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
      const values = [];
      for (let i = 0; i < a.count * width; i++) values.push(binary.readFloatLE((v.byteOffset || 0) + (a.byteOffset || 0) + i * 4));
      assert.ok(values.every(Number.isFinite));
      return { values, width };
    }
    for (const sampler of gltf.animations[0].samplers) {
      const time = accessor(sampler.input).values;
      assert.equal(time[0], 0); assert.equal(time.at(-1), 12);
      const { values, width } = accessor(sampler.output);
      const first = values.slice(0, width), last = values.slice(-width);
      if (width === 4) {
        assert.ok(Math.abs(Math.abs(first.reduce((sum, n, i) => sum + n * last[i], 0)) - 1) < 0.00001, `rotation seam accessor ${sampler.output}`);
      } else {
        for (let i = 0; i < width; i++) assert.ok(Math.abs(first[i] - last[i]) < 0.00001, `loop seam accessor ${sampler.output}`);
      }
    }
    const node = createCanvasNode('model-3d', 0, 0, 1);
    node.resourceRefs = [model.id]; node.props = { ...node.props, ...model.defaults };
    for (const shellMode of ['original', 'solid', 'hidden']) {
      node.props.presentation = { ...node.props.presentation, shellMode, explosion: 0.65 };
      assert.deepEqual(patch(node).upsertNodes[0].props, parseModel3DProps(node.props).value);
    }
    for (const change of [{ explosion: -1 }, { explosion: 1.1 }, { explosion: NaN }, { showFlow: 'true' }, { lighting: 'external' }, { shellMode: 'xray' }]) {
      const bad = { ...node, props: { ...node.props, presentation: { ...node.props.presentation, ...change } } };
      assert.equal(parseModel3DProps(bad.props).ok, false);
      assert.throws(() => patch(bad));
    }
    for (const showControlPanel of [true, false]) {
      const configured = { ...node, props: { ...node.props, showControlPanel } };
      assert.deepEqual(patch(configured).upsertNodes[0].props, parseModel3DProps(configured.props).value);
      assert.equal(parseModel3DProps(configured.props).value.showControlPanel, showControlPanel);
    }
    for (const showControlPanel of ['true', 1, null, {}]) {
      const bad = { ...node, props: { ...node.props, showControlPanel } };
      assert.equal(parseModel3DProps(bad.props).ok, false);
      assert.throws(() => patch(bad));
    }
    const legacy = { ...node.props }; delete legacy.presentation; delete legacy.showControlPanel; delete legacy.modelInstances;
    assert.equal(parseModel3DProps(legacy).value.showControlPanel, false);
    assert.deepEqual(parseModel3DProps(legacy).value.modelInstances, []);
    assert.equal(patch({ ...node, props: legacy }).upsertNodes[0].props.showControlPanel, false);
    assert.equal(parseModel3DProps(legacy).value.presentation.lighting, 'standard');

    const instanceTransform = {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };
    const batchNode = {
      ...node,
      props: {
        ...node.props,
        modelInstances: [
          { id: 'primary', assetId: model.id, label: '主模型', transform: instanceTransform, visible: true },
          { id: 'copy-2', assetId: model.id, label: '重复实例', transform: { ...instanceTransform, position: [2.5, 0, 0] }, visible: true },
        ],
      },
      resourceRefs: [model.id],
    };
    assert.equal(parseModel3DProps(batchNode.props).value.modelInstances.length, 2);
    assert.equal(patch(batchNode).upsertNodes[0].props.modelInstances.length, 2);
    assert.throws(() => patch({ ...batchNode, resourceRefs: [model.id, model.id] }), /list each model resource ID exactly once/);
    assert.throws(() => patch({ ...batchNode, resourceRefs: [model.id, 'builtin:missing'] }), /must reference the same model assets/);
    const duplicateInstanceId = {
      ...batchNode,
      props: {
        ...batchNode.props,
        modelInstances: batchNode.props.modelInstances.map((instance) => ({ ...instance, id: 'duplicate' })),
      },
    };
    assert.equal(parseModel3DProps(duplicateInstanceId.props).ok, false);
    assert.throws(() => patch(duplicateInstanceId), /duplicate instance id/);
    const tooManyInstances = {
      ...batchNode,
      props: {
        ...batchNode.props,
        modelInstances: Array.from({ length: 33 }, (_, index) => ({
          id: `copy-${index}`,
          assetId: model.id,
          label: `模型 ${index + 1}`,
          transform: instanceTransform,
          visible: true,
        })),
      },
    };
    assert.equal(parseModel3DProps(tooManyInstances.props).ok, false);
    assert.throws(() => patch(tooManyInstances), /at most 32 model instances/);
    // A bundled demo can be listed and resolved without customer object storage.
    const listed = await listModelAssets({ DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }) } }, 'project-a');
    assert.ok(listed.some((m) => m.id === model.id && m.projectId === 'project-a'));
    const response = await modelAssetContentResponse(new Request('https://local.test/content'), {}, 'project-a', model.id);
    assert.equal(response.status, 307); assert.equal(response.headers.get('location'), model.contentPath);
    await assert.rejects(() => modelAssetContentResponse(new Request('https://local.test/content'), {}, 'project-a', 'builtin:missing'), /not in the catalog/);
    assert.equal(findBuiltinModel('builtin:missing'), undefined);
    await assert.rejects(() => applyCanvasPatch({ DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } }, 'project-a', 'user-a', patch({ ...node, resourceRefs: ['builtin:missing'] })), /does not belong to project/);
  }
  console.log('PASS: packaged GLB hash, animation seams, unique parts, embedded resources, legacy single-model compatibility, batch-instance schema, invalid settings and unknown resources.');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
