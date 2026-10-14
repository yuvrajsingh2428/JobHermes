// ============================================================
// Unit Tests – FILL Guard Utility
// ============================================================

import { describe, it, expect } from 'vitest';
import { hasFillMarkers } from '../../src/types';

describe('FILL Marker Guard Unit Tests', () => {
  it('detects [FILL] marker in top-level string fields', () => {
    const profile = {
      name: '[FILL]',
      email: 'user@example.com',
    };
    const res = hasFillMarkers(profile);
    expect(res.hasFill).toBe(true);
    expect(res.markerPaths).toContain('name: "[FILL]"');
  });

  it('detects [FILL] marker in nested arrays and objects', () => {
    const profile = {
      name: 'John Doe',
      achievements: [
        'Built framework',
        '[FILL: e.g. Reduced execution time by 50%]',
      ],
    };
    const res = hasFillMarkers(profile);
    expect(res.hasFill).toBe(true);
    expect(res.markerPaths[0]).toContain('achievements[1]');
  });

  it('passes cleanly when no [FILL] markers exist', () => {
    const profile = {
      name: 'Jane Doe',
      email: 'jane@example.com',
      skills: ['Java', 'Selenium'],
      achievements: ['Automated 500 test cases'],
    };
    const res = hasFillMarkers(profile);
    expect(res.hasFill).toBe(false);
    expect(res.markerPaths.length).toBe(0);
  });
});
