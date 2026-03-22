<?php

use PHPUnit\Framework\TestCase;

class AuthTest extends TestCase
{
    private string $passwordFile;

    protected function setUp(): void
    {
        // Override the global $passwordFile to use our test config dir
        global $passwordFile;
        $this->passwordFile = TEST_CONFIG . '/.password';
        $passwordFile = $this->passwordFile;

        // Clean up
        if (file_exists($this->passwordFile)) {
            unlink($this->passwordFile);
        }

        // Reset session
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_destroy();
        }
        $_SESSION = [];
    }

    protected function tearDown(): void
    {
        if (file_exists($this->passwordFile)) {
            unlink($this->passwordFile);
        }
    }

    public function testPasswordExistsReturnsFalseWhenNoFile(): void
    {
        $this->assertFalse(passwordExists());
    }

    public function testPasswordExistsReturnsFalseForEmptyFile(): void
    {
        file_put_contents($this->passwordFile, '');
        $this->assertFalse(passwordExists());
    }

    public function testSetPasswordCreatesHashFile(): void
    {
        setPassword('testpass123');
        $this->assertTrue(passwordExists());

        $hash = trim(file_get_contents($this->passwordFile));
        $this->assertTrue(password_verify('testpass123', $hash));
    }

    public function testVerifyPasswordReturnsTrueForCorrectPassword(): void
    {
        setPassword('mypassword');
        $this->assertTrue(verifyPassword('mypassword'));
    }

    public function testVerifyPasswordReturnsFalseForWrongPassword(): void
    {
        setPassword('mypassword');
        $this->assertFalse(verifyPassword('wrongpassword'));
    }

    public function testVerifyPasswordReturnsFalseWhenNoPasswordSet(): void
    {
        $this->assertFalse(verifyPassword('anything'));
    }

    public function testIsAuthenticatedReturnsFalseByDefault(): void
    {
        $this->assertFalse(isAuthenticated());
    }

    public function testStartSessionSetsAdminFlag(): void
    {
        startSession();
        $this->assertTrue(isAuthenticated());
    }

    public function testDestroySessionClearsAuth(): void
    {
        startSession();
        $this->assertTrue(isAuthenticated());

        destroySession();
        $this->assertFalse(isAuthenticated());
    }
}
