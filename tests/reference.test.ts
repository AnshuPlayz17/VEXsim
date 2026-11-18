import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { elementsSvg, fieldSpec, fieldSpecMarkdown, layoutSvg, toggleSvg } from '../src/reference/generate';

/**
 * reference/ is generated from the sim's field data. With WRITE_REFERENCE=1
 * (`npm run reference`) this writes the files; otherwise it fails if they are stale.
 */
const files: Record<string, () => string> = {
  'reference/field-spec.json': () => JSON.stringify(fieldSpec(), null, 2) + '\n',
  'reference/field-spec.md': fieldSpecMarkdown,
  'reference/diagrams/starting-layout.svg': layoutSvg,
  'reference/diagrams/elements.svg': elementsSvg,
  'reference/diagrams/toggle.svg': toggleSvg,
};

describe('reference/ files', () => {
  for (const [path, gen] of Object.entries(files)) {
    it(`${path} is up to date`, () => {
      const content = gen();
      if (process.env.WRITE_REFERENCE) {
        mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
        writeFileSync(path, content);
      }
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, 'utf8')).toBe(content);
    });
  }

  it('the spec matches the game manual counts', () => {
    const spec = fieldSpec();
    expect(spec.goals).toHaveLength(9);
    expect(spec.toggles).toHaveLength(4);
    expect(spec.loaders).toHaveLength(4);
    const p = spec.counts.pins;
    expect(p.redYellow + p.blueYellow + p.yellowYellow + p.redBlue).toBe(63);
  });
});
