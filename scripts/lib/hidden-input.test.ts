import { describe, expect, it } from 'vitest';
import { applyKeystrokes, type KeystrokeState } from './hidden-input.ts';

const start: KeystrokeState = { value: '', done: false, cancelled: false };

function type(chunks: string[], paste?: () => string): KeystrokeState {
  return chunks.reduce((state, chunk) => applyKeystrokes(state, chunk, paste), start);
}

describe('applyKeystrokes', () => {
  it('збирає символи до Enter', () => {
    expect(type(['ab', 'c', '\r'])).toEqual({ value: 'abc', done: true, cancelled: false });
  });

  it('Backspace стирає останній символ', () => {
    expect(type(['abx', '\u007f', 'c\r']).value).toBe('abc');
    expect(type(['ab', '\b\b\b', 'z\n']).value).toBe('z');
  });

  it('Ctrl+C скасовує й не лишає введеного', () => {
    expect(type(['secret', '\u0003'])).toEqual({ value: '', done: true, cancelled: true });
  });

  it('вставка з bracketed paste дає чистий текст', () => {
    expect(type(['\u001b[200~abc\u001b[201~', '\r']).value).toBe('abc');
  });

  it('Ctrl+V, який термінал не перехопив, бере текст із буфера без переносів', () => {
    expect(type(['\u0016', '\r'], () => 'from-clipboard\r\n').value).toBe('from-clipboard');
  });

  it('без буфера Ctrl+V нічого не додає', () => {
    expect(type(['a\u0016b', '\r']).value).toBe('ab');
  });

  it('ігнорує стрілки й інші керівні символи', () => {
    expect(type(['a\u001b[Db\tc', '\r']).value).toBe('abc');
  });

  it('усе після Enter у тому самому шматку відкидається', () => {
    expect(type(['abc\rdef']).value).toBe('abc');
  });
});
