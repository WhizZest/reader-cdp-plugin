import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { wr_hash } from './wr-hash.mjs';

describe('wr_hash', () => {
  describe('documented test cases (cross-validated with browser)', () => {
    it('"42557145" (numeric)', () => {
      assert.equal(wr_hash('42557145'), 'f343248072895ed9f34f408');
    });
    it('"14" (numeric)', () => {
      assert.equal(wr_hash('14'), 'aab325601eaab3238922e53');
    });
    it('"50" (numeric)', () => {
      assert.equal(wr_hash('50'), 'c0c320a0232c0c7c76d365a');
    });
    it('"test" (non-numeric)', () => {
      assert.equal(wr_hash('test'), '09842f60874657374098bf5');
    });
  });

  describe('type coercion', () => {
    it('number input is converted to string', () => {
      assert.equal(wr_hash(50), wr_hash('50'));
    });
    it('non-string non-number input is returned as-is', () => {
      assert.equal(wr_hash(null), null);
      assert.equal(wr_hash(undefined), undefined);
    });
  });

  describe('edge cases', () => {
    it('empty string returns empty string', () => {
      assert.equal(wr_hash(''), '');
    });
    it('single digit', () => {
      const result = wr_hash('7');
      assert.equal(typeof result, 'string');
      assert.ok(result.length >= 20);
    });
    it('very long numeric string (multi-chunk)', () => {
      const result = wr_hash('12345678901234567890');
      assert.equal(typeof result, 'string');
      assert.ok(result.length >= 20);
    });
    it('non-numeric with special characters', () => {
      const result = wr_hash('hello world!');
      assert.equal(typeof result, 'string');
      assert.ok(result.length >= 20);
    });
  });

  describe('determinism', () => {
    it('same input produces same output', () => {
      const a = wr_hash('42557145');
      const b = wr_hash('42557145');
      assert.equal(a, b);
    });
    it('different inputs produce different outputs', () => {
      assert.notEqual(wr_hash('50'), wr_hash('51'));
    });
  });
});