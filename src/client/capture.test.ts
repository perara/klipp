// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { failedRequests, recentErrors, resetCapture, startCapture } from './capture.js';

describe('startCapture', () => {
  it('keeps what an error says, and names objects without opening them', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    startCapture();
    console.error('Sign-in failed', { email: 'kari@example.com', password: 'hunter2' }, [1, 2]);
    console.error(new TypeError('x is undefined'), 404, null, () => 'secret');
    console.error(document.createElement('button'));
    expect(recentErrors()).toEqual([
      'Sign-in failed [Object] [array(2)]',
      'TypeError: x is undefined 404 null [function]',
      '<button>',
    ]);
    expect(quiet).toHaveBeenCalledTimes(3);
    resetCapture();
    expect(recentErrors()).toEqual([]);
    expect(failedRequests()).toEqual([]);
    console.error('New session');
    expect(recentErrors()).toEqual(['New session']);
    quiet.mockRestore();
  });
});
