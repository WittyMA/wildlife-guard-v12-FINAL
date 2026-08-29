import { describe, it, expect } from 'vitest';

/**
 * Firebase Credentials Validation Test
 * Validates that Firebase credentials are properly configured
 */

describe('Firebase Credentials Validation', () => {
  it('should have FIREBASE_PROJECT_ID environment variable', () => {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    expect(projectId).toBeDefined();
    expect(projectId).toBe('wildlife-security-camera');
    expect(projectId?.length).toBeGreaterThan(0);
  });

  it('should have FIREBASE_PRIVATE_KEY_ID environment variable', () => {
    const privateKeyId = process.env.FIREBASE_PRIVATE_KEY_ID;
    expect(privateKeyId).toBeDefined();
    expect(privateKeyId).toBe('49411abe896b4bd55dae3b8b5c526ec89e3f3b0c');
    expect(privateKeyId?.length).toBeGreaterThan(0);
  });

  it('should have FIREBASE_PRIVATE_KEY environment variable', () => {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;
    expect(privateKey).toBeDefined();
    expect(privateKey).toContain('BEGIN PRIVATE KEY');
    expect(privateKey).toContain('END PRIVATE KEY');
  });

  it('should have FIREBASE_CLIENT_EMAIL environment variable', () => {
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    expect(clientEmail).toBeDefined();
    expect(clientEmail).toContain('firebase-adminsdk');
    expect(clientEmail).toContain('@');
    expect(clientEmail).toContain('iam.gserviceaccount.com');
  });

  it('should validate private key format', () => {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;
    expect(privateKey).toBeDefined();

    if (privateKey) {
      // Check PEM format
      expect(privateKey.includes('BEGIN PRIVATE KEY')).toBe(true);
      expect(privateKey.includes('END PRIVATE KEY')).toBe(true);

      // Check that it's not just the headers
      expect(privateKey.length).toBeGreaterThan(100);
    }
  });

  it('should validate email format', () => {
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    expect(clientEmail).toBeDefined();

    if (clientEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      expect(emailRegex.test(clientEmail)).toBe(true);
    }
  });

  it('should validate project ID format', () => {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    expect(projectId).toBeDefined();

    if (projectId) {
      // Firebase project IDs are typically lowercase with hyphens
      expect(/^[a-z0-9-]+$/.test(projectId)).toBe(true);
    }
  });

  it('should validate private key ID format', () => {
    const privateKeyId = process.env.FIREBASE_PRIVATE_KEY_ID;
    expect(privateKeyId).toBeDefined();

    if (privateKeyId) {
      // Private key IDs are typically hex strings
      expect(/^[a-f0-9]+$/.test(privateKeyId)).toBe(true);
    }
  });

  it('should have all required credentials together', () => {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const privateKeyId = process.env.FIREBASE_PRIVATE_KEY_ID;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

    expect(projectId).toBeDefined();
    expect(privateKeyId).toBeDefined();
    expect(privateKey).toBeDefined();
    expect(clientEmail).toBeDefined();

    // All should be non-empty
    expect(projectId?.length).toBeGreaterThan(0);
    expect(privateKeyId?.length).toBeGreaterThan(0);
    expect(privateKey?.length).toBeGreaterThan(0);
    expect(clientEmail?.length).toBeGreaterThan(0);
  });

  it('should validate credentials consistency', () => {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

    // Client email should contain project ID
    expect(clientEmail).toContain(projectId);
  });

  it('should validate private key length', () => {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;
    expect(privateKey).toBeDefined();

    if (privateKey) {
      // RSA private keys are typically at least 1500 characters when PEM encoded
      expect(privateKey.length).toBeGreaterThan(1000);
    }
  });

  it('should validate private key ID length', () => {
    const privateKeyId = process.env.FIREBASE_PRIVATE_KEY_ID;
    expect(privateKeyId).toBeDefined();

    if (privateKeyId) {
      // Private key IDs are typically 40 character hex strings (SHA1)
      expect(privateKeyId.length).toBeGreaterThanOrEqual(32);
      expect(privateKeyId.length).toBeLessThanOrEqual(64);
    }
  });

  it('should not have placeholder values', () => {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const privateKeyId = process.env.FIREBASE_PRIVATE_KEY_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

    expect(projectId).not.toBe('YOUR_PROJECT_ID');
    expect(projectId).not.toBe('your-project-id');
    expect(privateKeyId).not.toBe('YOUR_PRIVATE_KEY_ID');
    expect(clientEmail).not.toBe('YOUR_CLIENT_EMAIL');
  });
});
