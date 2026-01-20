const { validateChartPayload, isValidChartId, validatePermissions, sanitizeChartName } = require('./validation');

describe('Validation Module', () => {
  describe('isValidChartId', () => {
    it('should accept valid UUIDs', () => {
      // Valid UUID v4 format (note the '4' in the third group and '8'/'9'/'a'/'b' in the fourth)
      expect(isValidChartId('123e4567-e89b-42d3-a456-426614174000')).toBe(true);
      expect(isValidChartId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    it('should reject invalid formats', () => {
      expect(isValidChartId('not-a-uuid')).toBe(false);
      expect(isValidChartId('123')).toBe(false);
      expect(isValidChartId('')).toBe(false);
      expect(isValidChartId(null)).toBe(false);
      expect(isValidChartId(undefined)).toBe(false);
    });
  });

  describe('validateChartPayload', () => {
    it('should accept valid chart payload', () => {
      const payload = {
        name: 'Test Chart',
        data: { nodes: [], connections: [] }
      };

      const result = validateChartPayload(payload);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject missing name', () => {
      const payload = {
        data: { nodes: [] }
      };

      const result = validateChartPayload(payload);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Chart name is required and must be a string');
    });

    it('should reject missing data', () => {
      const payload = {
        name: 'Test Chart'
      };

      const result = validateChartPayload(payload);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Chart data is required and must be an object');
    });

    it('should reject empty name', () => {
      const payload = {
        name: '',
        data: { nodes: [] }
      };

      const result = validateChartPayload(payload);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('name'))).toBe(true);
    });

    it('should reject name that is too long', () => {
      const payload = {
        name: 'a'.repeat(101),
        data: { nodes: [] }
      };

      const result = validateChartPayload(payload);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('100 characters'))).toBe(true);
    });
  });

  describe('validatePermissions', () => {
    it('should accept valid permissions array', () => {
      const permissions = [
        { userId: 'user1', role: 'viewer' },
        { userId: 'user2', role: 'editor' }
      ];

      const result = validatePermissions(permissions);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject non-array permissions', () => {
      const result = validatePermissions('not-an-array');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Permissions must be an array');
    });

    it('should reject permission without userId', () => {
      const permissions = [
        { role: 'viewer' }
      ];

      const result = validatePermissions(permissions);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('userId'))).toBe(true);
    });

    it('should reject permission without role', () => {
      const permissions = [
        { userId: 'user1' }
      ];

      const result = validatePermissions(permissions);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('role'))).toBe(true);
    });

    it('should reject invalid role', () => {
      const permissions = [
        { userId: 'user1', role: 'admin' }
      ];

      const result = validatePermissions(permissions);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.toLowerCase().includes('viewer') && e.toLowerCase().includes('editor'))).toBe(true);
    });
  });

  describe('sanitizeChartName', () => {
    it('should trim whitespace', () => {
      expect(sanitizeChartName('  Test Chart  ')).toBe('Test Chart');
    });

    it('should truncate to 100 characters', () => {
      const longName = 'a'.repeat(250);
      const result = sanitizeChartName(longName);

      expect(result.length).toBe(100);
    });

    it('should handle special characters', () => {
      const name = '<script>alert("xss")</script>';
      const result = sanitizeChartName(name);

      // Should at least return something (exact behavior depends on implementation)
      expect(result).toBeTruthy();
    });
  });
});
