import { describe, it, expect, afterEach } from 'bun:test';
import {
  resolveGatewayUpdaterFeedBaseUrl,
  resolveGatewayReleaseLatestUrl,
  GATEWAY_UPDATER_FEED_PATH_PREFIX,
} from '../release.ts';

describe('release feed config', () => {
  const prev = process.env.ORIGINCOWORKS_GATEWAY_URL;

  afterEach(() => {
    if (prev === undefined) delete process.env.ORIGINCOWORKS_GATEWAY_URL;
    else process.env.ORIGINCOWORKS_GATEWAY_URL = prev;
  });

  it('points updater feed at gateway release prefix', () => {
    process.env.ORIGINCOWORKS_GATEWAY_URL = 'http://127.0.0.1:8847';
    expect(resolveGatewayUpdaterFeedBaseUrl()).toBe(
      `http://127.0.0.1:8847${GATEWAY_UPDATER_FEED_PATH_PREFIX}`,
    );
    expect(resolveGatewayReleaseLatestUrl()).toBe(
      'http://127.0.0.1:8847/api/desktop/release/latest',
    );
  });

  it('strips trailing slashes on gateway base', () => {
    expect(resolveGatewayUpdaterFeedBaseUrl('http://gw.test/')).toBe(
      `http://gw.test${GATEWAY_UPDATER_FEED_PATH_PREFIX}`,
    );
  });
});
