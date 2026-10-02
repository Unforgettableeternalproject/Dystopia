import { describe, expect, it } from 'vitest';
import { parseNumberToken, parseRestDurationMinutes, resolveRestPreset } from '../lib/utils/restDurationParser';

describe('parseNumberToken', () => {
  it.each([
    ['5', 5], ['1.5', 1.5], ['一', 1], ['兩', 2], ['十', 10], ['十二', 12],
    ['二十', 20], ['四十五', 45], ['零', 0],
  ])('%s → %d', (token, expected) => {
    expect(parseNumberToken(token)).toBe(expected);
  });

  it.each(['一二', '十十', 'abc', '百'])('無法解析 %s', token => {
    expect(parseNumberToken(token)).toBeNull();
  });
});

describe('parseRestDurationMinutes — 時長', () => {
  it.each([
    ['繼續睡覺五個小時', 300],
    ['睡 3 小時', 180],
    ['睡3小時', 180],
    ['休息半小時', 30],
    ['休息半個小時', 30],
    ['睡一個半小時', 90],
    ['睡兩小時半', 150],
    ['睡兩個鐘頭', 120],
    ['小睡四十分鐘', 40],
    ['躺 20 分鐘', 20],
    ['睡一小時二十分鐘', 80],
    ['睡十二個小時', 720],
    ['睡 1.5 小時', 90],
  ])('%s → %d 分鐘', (input, expected) => {
    expect(parseRestDurationMinutes(input)).toBe(expected);
  });

  it.each(['睡覺', '找個地方休息', '睡一下', ''])('未指定時長：%s → null', input => {
    expect(parseRestDurationMinutes(input)).toBeNull();
  });

  it.each(['睡 0 小時', '睡 30 小時', '睡二十五個小時'])('不合理時長忽略：%s → null', input => {
    expect(parseRestDurationMinutes(input)).toBeNull();
  });
});

describe('parseRestDurationMinutes — 睡到 X 點', () => {
  const night = { hour: 22, minute: 0 };

  it('睡到早上六點（22:00 起）→ 8 小時', () => {
    expect(parseRestDurationMinutes('睡到早上六點', night)).toBe(480);
  });

  it('睡到 6 點半（未指定時段，取最近的未來時刻）→ 8.5 小時', () => {
    expect(parseRestDurationMinutes('睡到 6 點半', night)).toBe(510);
  });

  it('睡到下午三點十五分（10:00 起）→ 5 小時 15 分', () => {
    expect(parseRestDurationMinutes('睡到下午三點十五分', { hour: 10, minute: 0 })).toBe(315);
  });

  it('睡到 23 點（22:30 起）→ 30 分鐘', () => {
    expect(parseRestDurationMinutes('睡到23點', { hour: 22, minute: 30 })).toBe(30);
  });

  it('未提供遊戲時間時不解析時刻型描述', () => {
    expect(parseRestDurationMinutes('睡到早上六點')).toBeNull();
  });

  it('分鐘超出 59 視為無效', () => {
    expect(parseRestDurationMinutes('睡到六點七十分', night)).toBeNull();
  });
});

describe('resolveRestPreset', () => {
  const full    = { canFullRest: true,  scuffedMaxMinutes: 480 };
  const scuffed = { canFullRest: false, scuffedMaxMinutes: 30 };

  it('完整休息：落在 10 分鐘～12 小時內才預填，並對齊 10 分鐘刻度', () => {
    expect(resolveRestPreset(300, full)).toBe(300);
    expect(resolveRestPreset(720, full)).toBe(720);
    expect(resolveRestPreset(95, full)).toBe(100);
    expect(resolveRestPreset(4, full)).toBeNull();
    expect(resolveRestPreset(721 + 10, full)).toBeNull();
    expect(resolveRestPreset(null, full)).toBeNull();
    expect(resolveRestPreset(0, full)).toBeNull();
  });

  it('短眠：需等於固定選項且不超過 scuffedMaxMinutes', () => {
    expect(resolveRestPreset(30, scuffed)).toBe(30);
    expect(resolveRestPreset(60, scuffed)).toBeNull();
    expect(resolveRestPreset(45, scuffed)).toBeNull();
    expect(resolveRestPreset(60, { canFullRest: false, scuffedMaxMinutes: 120 })).toBe(60);
  });
});
