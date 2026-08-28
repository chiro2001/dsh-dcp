import { describe, expect, it } from 'vitest'
import { buildCheckpointText } from '../../src/compress/prepare.js'

describe('buildCheckpointText (checkpoint sanitization)', () => {
  it('strips a leading blockRef marker that matches the assigned block', () => {
    expect(buildCheckpointText('b3', '[b3] foo')).toBe(
      '[Compressed conversation section]\nfoo\n\n<dcp-message-id>b3</dcp-message-id>',
    )
  })

  it('strips any leading [bN] marker, not only the current blockRef', () => {
    expect(buildCheckpointText('b4', '[b99] content')).toBe(
      '[Compressed conversation section]\ncontent\n\n<dcp-message-id>b4</dcp-message-id>',
    )
  })

  it('strips a marker concatenated directly to the summary text', () => {
    expect(buildCheckpointText('b2', '[b2]foo')).toBe(
      '[Compressed conversation section]\nfoo\n\n<dcp-message-id>b2</dcp-message-id>',
    )
  })

  it('keeps ordinary summary text unchanged', () => {
    expect(buildCheckpointText('b1', 'plain summary')).toBe(
      '[Compressed conversation section]\nplain summary\n\n<dcp-message-id>b1</dcp-message-id>',
    )
  })

  it('appends protected appendix after the sanitized summary', () => {
    expect(buildCheckpointText('b5', '[b5] summary text', '\n\nProtected notes')).toBe(
      '[Compressed conversation section]\nsummary text\n\nProtected notes\n\n<dcp-message-id>b5</dcp-message-id>',
    )
  })
})
