// Tests for src/core/utils/geometry.js — pure layout math, no DOM.
// Run: node --test tests/js/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    topologicalSort, dbscan, inferFontStyle,
    intervalRelation, orderBlocksAllen, computeVoronoi,
} from '../../src/core/utils/geometry.js';

// PDF coordinates: y grows UPWARD (yMax = top edge of the page is the largest y).

const block = (xMin, xMax, yMin, yMax, name) => ({ xMin, xMax, yMin, yMax, name });

test('topologicalSort: empty input returns empty array', () => {
    assert.deepEqual(topologicalSort([]), []);
});

test('topologicalSort: single column reads top to bottom', () => {
    const bottom = block(50, 500, 100, 200, 'bottom');
    const middle = block(50, 500, 300, 400, 'middle');
    const top = block(50, 500, 500, 600, 'top');
    const order = topologicalSort([bottom, top, middle]).map(b => b.name);
    assert.deepEqual(order, ['top', 'middle', 'bottom']);
});

test('topologicalSort: two columns — left column before right column', () => {
    const leftTop = block(50, 250, 500, 600, 'L1');
    const leftBottom = block(50, 250, 300, 400, 'L2');
    const rightTop = block(300, 500, 500, 600, 'R1');
    const rightBottom = block(300, 500, 300, 400, 'R2');
    const order = topologicalSort([rightBottom, leftBottom, rightTop, leftTop]).map(b => b.name);
    assert.ok(order.indexOf('L1') < order.indexOf('L2'), `L1 before L2 in ${order}`);
    assert.ok(order.indexOf('R1') < order.indexOf('R2'), `R1 before R2 in ${order}`);
    assert.ok(order.indexOf('L1') < order.indexOf('R1'), `left column first in ${order}`);
});

test('topologicalSort: never loses blocks, even with cyclic constraints', () => {
    // Heavily overlapping blocks can produce cycles; the fallback must append
    // anything the topological pass could not place.
    const blocks = [
        block(0, 100, 0, 100, 'a'),
        block(50, 150, 50, 150, 'b'),
        block(25, 125, 25, 125, 'c'),
    ];
    assert.equal(topologicalSort(blocks).length, 3);
});

test('dbscan: two vertical stacks form two clusters', () => {
    // Horizontal distance is penalized 20x, so two side-by-side stacks split.
    const stack = (x, n) => Array.from({ length: n }, (_, i) =>
        ({ x, y: i * 12, width: 80, height: 10 }));
    const points = [...stack(0, 5), ...stack(300, 5)];
    const { clusters, noise } = dbscan(points, 30, 2);
    assert.equal(clusters.length, 2);
    assert.equal(noise.length, 0);
    assert.equal(clusters[0].length + clusters[1].length, 10);
});

test('dbscan: isolated point is noise', () => {
    const points = [
        { x: 0, y: 0, width: 50, height: 10 },
        { x: 0, y: 12, width: 50, height: 10 },
        { x: 0, y: 24, width: 50, height: 10 },
        { x: 5000, y: 5000, width: 10, height: 10 },
    ];
    const { noise } = dbscan(points, 30, 2);
    assert.equal(noise.length, 1);
    assert.equal(noise[0], 3);
});

test('inferFontStyle: detects bold, italic, oblique, plain', () => {
    assert.deepEqual(inferFontStyle('Helvetica-Bold'), { isBold: true, isItalic: false });
    assert.deepEqual(inferFontStyle('Times-Italic'), { isBold: false, isItalic: true });
    assert.deepEqual(inferFontStyle('Courier-Oblique'), { isBold: false, isItalic: true });
    assert.deepEqual(inferFontStyle('BoldItalicFont'), { isBold: true, isItalic: true });
    assert.deepEqual(inferFontStyle('Helvetica'), { isBold: false, isItalic: false });
    assert.deepEqual(inferFontStyle(null), { isBold: false, isItalic: false });
});

test('intervalRelation: before / after / overlaps', () => {
    assert.equal(intervalRelation({ yMin: 0, yMax: 10 }, { yMin: 10, yMax: 20 }), 'before');
    assert.equal(intervalRelation({ yMin: 10, yMax: 20 }, { yMin: 0, yMax: 10 }), 'after');
    assert.equal(intervalRelation({ yMin: 0, yMax: 15 }, { yMin: 10, yMax: 20 }), 'overlaps');
});

test('orderBlocksAllen: higher block (larger y) sorts first', () => {
    const top = { xMin: 0, yMin: 100, yMax: 120, name: 'top' };
    const bottom = { xMin: 0, yMin: 0, yMax: 20, name: 'bottom' };
    const order = orderBlocksAllen([bottom, top]).map(b => b.name);
    assert.deepEqual(order, ['top', 'bottom']);
});

test('orderBlocksAllen: overlapping rows tie-break left first', () => {
    const left = { xMin: 0, yMin: 0, yMax: 20, name: 'left' };
    const right = { xMin: 100, yMin: 5, yMax: 25, name: 'right' };
    const order = orderBlocksAllen([right, left]).map(b => b.name);
    assert.deepEqual(order, ['left', 'right']);
});

test('computeVoronoi: stub returns empty array', () => {
    assert.deepEqual(computeVoronoi([{ x: 1, y: 2 }]), []);
});
