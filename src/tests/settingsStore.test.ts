import { describe, it, expect } from 'vitest';
import { normalizeSettings, DEFAULT_SETTINGS, UI_SCALE_MIN, UI_SCALE_MAX, SETTINGS_VERSION } from '../lib/stores/settingsStore';

describe('normalizeSettings()', () => {
  it('非物件輸入 → 預設值', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('oops')).toEqual(DEFAULT_SETTINGS);
  });

  it('缺欄位補預設、版本更新為目前版本', () => {
    expect(normalizeSettings({ version: 0 })).toEqual({ ...DEFAULT_SETTINGS, version: SETTINGS_VERSION });
  });

  it('uiScale 合法值保留', () => {
    expect(normalizeSettings({ uiScale: 1.3 }).uiScale).toBe(1.3);
  });

  it('uiScale 超出範圍會夾限', () => {
    expect(normalizeSettings({ uiScale: 10 }).uiScale).toBe(UI_SCALE_MAX);
    expect(normalizeSettings({ uiScale: 0.1 }).uiScale).toBe(UI_SCALE_MIN);
  });

  it('uiScale 非數值 → 預設', () => {
    expect(normalizeSettings({ uiScale: 'abc' }).uiScale).toBe(DEFAULT_SETTINGS.uiScale);
  });
});
