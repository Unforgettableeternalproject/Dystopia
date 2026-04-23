/**
 * Parse an item grant string that may include inline template overrides.
 *
 * Format:
 *   "item_id"                                    → regular item
 *   "base_id|name:顯示名稱|desc:描述|content:內文" → template instance
 *
 * Supported override keys:
 *   name    — display name
 *   desc    — description
 *   content — info item content (for reading modal)
 *
 * The first `:` in each segment separates key from value.
 * If there's no `|`, the entire string is treated as a plain item ID.
 */
export function parseItemGrantString(str: string): {
  itemId: string;
  overrides?: { name?: string; description?: string; content?: string };
} {
  if (!str.includes('|')) {
    return { itemId: str };
  }

  const segments = str.split('|');
  const itemId = segments[0].trim();
  const overrides: { name?: string; description?: string; content?: string } = {};
  let hasOverrides = false;

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const colonIdx = seg.indexOf(':');
    if (colonIdx === -1) continue;

    const key = seg.slice(0, colonIdx).trim().toLowerCase();
    const value = seg.slice(colonIdx + 1);

    switch (key) {
      case 'name':
        overrides.name = value;
        hasOverrides = true;
        break;
      case 'desc':
      case 'description':
        overrides.description = value;
        hasOverrides = true;
        break;
      case 'content':
        overrides.content = value;
        hasOverrides = true;
        break;
    }
  }

  return hasOverrides ? { itemId, overrides } : { itemId };
}
