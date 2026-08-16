/**
 * /dcp help
 *
 * @module dsh-dcp/commands/help
 */

export function renderHelp(): string {
  return [
    'DCP commands:',
    '  /dcp help      show this help',
    '  /dcp context   show token usage breakdown for the current session',
    '  /dcp stats     show DCP statistics (M4)',
    '  /dcp manual    toggle manual mode (M3)',
    '  /dcp sweep     run automatic pruning (M3)',
    '  /dcp compress  trigger a compression turn (M4)',
    '  /dcp decompress <bN> / recompress <bN> (M4)',
    'The model-facing `compress` tool performs range compression.',
  ].join('\n')
}
