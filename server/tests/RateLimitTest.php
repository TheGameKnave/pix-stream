<?php

use PHPUnit\Framework\TestCase;

class RateLimitTest extends TestCase
{
    private const BUCKET = 'test';
    private const WINDOW = 600;

    protected function setUp(): void
    {
        global $rateLimitDir;
        $rateLimitDir = TEST_CONFIG . '/ratelimit';
        $_SERVER['REMOTE_ADDR'] = '203.0.113.7';
        clearRateLimit(self::BUCKET);
    }

    protected function tearDown(): void
    {
        clearRateLimit(self::BUCKET);
    }

    public function testNotLimitedWithNoFailures(): void
    {
        $this->assertFalse(isRateLimited(self::BUCKET, 3, self::WINDOW));
    }

    public function testNotLimitedBelowThreshold(): void
    {
        recordRateLimitFailure(self::BUCKET, self::WINDOW);
        recordRateLimitFailure(self::BUCKET, self::WINDOW);
        $this->assertFalse(isRateLimited(self::BUCKET, 3, self::WINDOW));
    }

    public function testLimitedAtThreshold(): void
    {
        for ($i = 0; $i < 3; $i++) {
            recordRateLimitFailure(self::BUCKET, self::WINDOW);
        }
        $this->assertTrue(isRateLimited(self::BUCKET, 3, self::WINDOW));
    }

    public function testClearResetsFailures(): void
    {
        for ($i = 0; $i < 3; $i++) {
            recordRateLimitFailure(self::BUCKET, self::WINDOW);
        }
        clearRateLimit(self::BUCKET);
        $this->assertFalse(isRateLimited(self::BUCKET, 3, self::WINDOW));
    }

    public function testOldFailuresExpire(): void
    {
        $stale = [time() - self::WINDOW - 10, time() - self::WINDOW - 5];
        file_put_contents(rateLimitFile(self::BUCKET), json_encode($stale));
        $this->assertFalse(isRateLimited(self::BUCKET, 1, self::WINDOW));
    }

    public function testFailuresAreScopedPerIp(): void
    {
        for ($i = 0; $i < 3; $i++) {
            recordRateLimitFailure(self::BUCKET, self::WINDOW);
        }
        $this->assertTrue(isRateLimited(self::BUCKET, 3, self::WINDOW));

        $_SERVER['REMOTE_ADDR'] = '198.51.100.9';
        $this->assertFalse(isRateLimited(self::BUCKET, 3, self::WINDOW));
        clearRateLimit(self::BUCKET);
    }

    public function testRetryAfterIsPositiveAndBounded(): void
    {
        recordRateLimitFailure(self::BUCKET, self::WINDOW);
        $retry = rateLimitRetryAfter(self::BUCKET, self::WINDOW);
        $this->assertGreaterThanOrEqual(1, $retry);
        $this->assertLessThanOrEqual(self::WINDOW, $retry);
    }

    public function testMalformedBucketFileTreatedAsEmpty(): void
    {
        file_put_contents(rateLimitFile(self::BUCKET), 'not json');
        $this->assertFalse(isRateLimited(self::BUCKET, 1, self::WINDOW));
    }
}
