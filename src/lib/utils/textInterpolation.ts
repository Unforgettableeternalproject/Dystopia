// textInterpolation — expands template variables in dialogue text and DM context strings.
//
// Supported variables:
//   {user}     — player name
//   {time}     — full formatted time  "AD 1498-06-12 21:23"
//   {date}     — date only            "AD 1498-06-12"
//   {hour}     — time only            "21:23"
//   {period}   — time period label    "休息時段"
//   {location} — current location name
//   {region}   — region name

export interface InterpolationContext {
  playerName:   string;
  formattedTime: string;   // "AD 1498-06-12 21:23"
  formattedDate: string;   // "AD 1498-06-12"
  formattedHour: string;   // "21:23"
  periodLabel:  string;
  locationName: string;
  regionName:   string;
}

const VARS: Array<[RegExp, keyof InterpolationContext]> = [
  [/\{user\}/gi,     'playerName'],
  [/\{time\}/gi,     'formattedTime'],
  [/\{date\}/gi,     'formattedDate'],
  [/\{hour\}/gi,     'formattedHour'],
  [/\{period\}/gi,   'periodLabel'],
  [/\{location\}/gi, 'locationName'],
  [/\{region\}/gi,   'regionName'],
];

/**
 * Replace all recognised {variable} tokens in `text` with live game values.
 * Unknown tokens are left as-is.
 */
export function interpolate(text: string, ctx: InterpolationContext): string {
  let result = text;
  for (const [pattern, key] of VARS) {
    result = result.replace(pattern, ctx[key]);
  }
  return result;
}
