import { goalsJustReached, milestonesJustReached, paydayJustDone } from '../src/math/moments';

const goal = (id: number, saved: number, target = 1000) => ({ id, name: `g${id}`, saved, target });

describe('moments', () => {
  it('fires for a goal that crosses its target', () => {
    expect(goalsJustReached([goal(1, 900)], [goal(1, 1000)]).map((g) => g.id)).toEqual([1]);
  });

  it('stays quiet on the first load, even for a goal already done', () => {
    expect(goalsJustReached(null, [goal(1, 1200)])).toEqual([]);
  });

  it('stays quiet for a goal that was already done, or still short', () => {
    expect(goalsJustReached([goal(1, 1000), goal(2, 100)], [goal(1, 1100), goal(2, 500)])).toEqual(
      []
    );
  });

  it('ignores a goal that is new since the last load', () => {
    expect(goalsJustReached([], [goal(3, 1000)])).toEqual([]);
  });

  it('ignores a goal with no target', () => {
    expect(goalsJustReached([goal(1, 0, 0)], [goal(1, 10, 0)])).toEqual([]);
  });

  it('fires payday only on the change to done', () => {
    expect(paydayJustDone(false, true)).toBe(true);
    expect(paydayJustDone(null, true)).toBe(false);
    expect(paydayJustDone(true, true)).toBe(false);
    expect(paydayJustDone(false, false)).toBe(false);
  });

  it('reports only milestones that are new', () => {
    expect(milestonesJustReached(['a'], ['a', 'b'])).toEqual(['b']);
    expect(milestonesJustReached(null, ['a', 'b'])).toEqual([]);
  });
});
