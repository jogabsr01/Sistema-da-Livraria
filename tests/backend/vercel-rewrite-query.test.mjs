import test from 'node:test';
import assert from 'node:assert/strict';
import { forwardToHandler } from '../../api/v1/[...slug].js';

test('Vercel rewrite capture is removed without changing body or legitimate query parameters', async () => {
  const previous = process.env.VERCEL;
  process.env.VERCEL = '1';
  try {
    for (const route of ['niches/save', 'operations/list', 'notifications/list', 'schedules/list']) {
      const request = new Request(`https://example.test/api/v1/${route}?match=${route}&offset=2`, { method: 'POST', body: '{"test":true}' });
      await forwardToHandler(request, async forwarded => {
        const url = new URL(forwarded.url);
        assert.equal(url.searchParams.has('match'), false);
        assert.equal(url.searchParams.get('offset'), '2');
        assert.equal(await forwarded.text(), '{"test":true}');
      });
    }
    for (const query of ['match=other', 'match=niches/list&match=niches/list']) {
      await forwardToHandler(new Request(`https://example.test/api/v1/niches/list?${query}`), async forwarded => {
        assert.equal(new URL(forwarded.url).searchParams.has('match'), true);
      });
    }
  } finally {
    if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous;
  }
});