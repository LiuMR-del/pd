import { getPalette } from '@pd/palettes';
import { generatePattern, presetOptions } from '@pd/pattern-core';
import { describeResult, makeTestImage } from '../src/lib/self-test';

// Same input as the home page's developer self-test, run directly in Node; the summary line should
// match what WeChat DevTools shows (except the timing).
const started = Date.now();
const result = generatePattern(makeTestImage(), getPalette('MARD', 221), { ...presetOptions('cartoon', 'balanced'), longSide: 48 });
console.log(describeResult(result, Date.now() - started));
