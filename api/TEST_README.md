# Backend Testing Guide

## Overview

This test suite provides comprehensive coverage for the backend API, focusing on:
- Shared utilities (auth, rate limiting, validation)
- Integration tests for main handlers
- Regression prevention for critical bugs

## Running Tests

### All Tests
```bash
cd api
npm test
```

### Watch Mode (for development)
```bash
npm test -- --watch
```

### Coverage Report
```bash
npm test -- --coverage
```

### Run Specific Test File
```bash
npm test -- auth.test.js
npm test -- SaveChart/index.test.js
```

### Run Tests Matching Pattern
```bash
npm test -- --testNamePattern="should not reference undefined userId"
```

## Test Structure

```
api/
├── jest.config.js              # Jest configuration
├── shared/
│   ├── auth.test.js           # Authentication tests
│   ├── rateLimiter.test.js    # Rate limiter tests
│   └── validation.test.js     # Validation tests
└── SaveChart/
    └── index.test.js          # SaveChart integration tests
```

## Coverage Thresholds

Current minimum coverage requirements:
- Statements: 50%
- Branches: 40%
- Functions: 50%
- Lines: 50%

These are intentionally low for initial setup. Increase them as test coverage improves.

## Key Test Cases

### 1. Authentication (auth.test.js)
- ✅ Parses base64-encoded client principal
- ✅ Handles ALLOW_ANONYMOUS flag correctly
- ✅ Falls back to individual headers
- ✅ Rejects unauthenticated requests in production

### 2. Rate Limiting (rateLimiter.test.js)
- ✅ Uses atomic findOneAndUpdate with $inc
- ✅ Correctly reads result.value (not result.count)
- ✅ Aligns windows to time boundaries
- ✅ Calculates accurate retryAfter values
- ✅ Fails open on database errors

### 3. Validation (validation.test.js)
- ✅ Validates chart payloads
- ✅ Validates UUIDs
- ✅ Validates permissions arrays
- ✅ Sanitizes inputs correctly

### 4. SaveChart Integration (SaveChart/index.test.js)
- ✅ **CRITICAL:** Verifies no undefined userId references
- ✅ Tests successful create and update paths
- ✅ Tests authentication rejection
- ✅ Tests rate limit enforcement
- ✅ Tests validation errors
- ✅ Tests error handling

## Regression Tests

### Bug: Undefined userId Reference
**Test:** `SaveChart/index.test.js` - "should not reference undefined userId variable"

This test specifically catches the bug where:
```javascript
// ❌ WRONG (causes ReferenceError)
logInfo('Chart created successfully', {
    userId,  // undefined variable
    chartId
});

// ✅ CORRECT
logInfo('Chart created successfully', {
    userId: effectiveUserId,  // properly scoped
    chartId
});
```

**Why this matters:**
- Bug caused 500 errors on successful operations
- Data was saved but user saw error response
- Silent failure that only appears in production

**Prevention:**
- Test verifies logInfo is called with correct userId
- Runs on every commit via CI/CD
- Fails immediately if userId is undefined

### Bug: Rate Limiter result.value
**Test:** `rateLimiter.test.js` - "should use atomic findOneAndUpdate with $inc"

Verifies the rate limiter correctly reads `result.value.count` instead of `result.count`.

### Bug: Window Start Alignment
**Test:** `rateLimiter.test.js` - "should align windows to boundaries"

Verifies time windows are aligned to fixed boundaries, ensuring accurate retryAfter values.

## Adding New Tests

### For a new shared utility:
```javascript
// api/shared/myUtility.test.js
const { myFunction } = require('./myUtility');

describe('MyUtility', () => {
  it('should do something', () => {
    const result = myFunction('input');
    expect(result).toBe('expected');
  });
});
```

### For a new function handler:
```javascript
// api/MyFunction/index.test.js
const myFunction = require('./index');

jest.mock('../shared/auth');
jest.mock('../shared/cosmos');

describe('MyFunction', () => {
  let mockContext, mockRequest;

  beforeEach(() => {
    mockContext = { res: null };
    mockRequest = { /* ... */ };
  });

  it('should handle request', async () => {
    await myFunction(mockContext, mockRequest);
    expect(mockContext.res.status).toBe(200);
  });
});
```

## CI/CD Integration

### GitHub Actions Example:
```yaml
- name: Run Backend Tests
  run: |
    cd api
    npm ci
    npm test -- --ci --coverage
```

### Pre-commit Hook:
```bash
#!/bin/sh
cd api && npm test
```

## Debugging Tests

### Run with verbose output:
```bash
npm test -- --verbose
```

### Run single test:
```bash
npm test -- --testNamePattern="should create chart"
```

### Debug in VS Code:
Add to `.vscode/launch.json`:
```json
{
  "type": "node",
  "request": "launch",
  "name": "Jest Current File",
  "program": "${workspaceFolder}/api/node_modules/.bin/jest",
  "args": ["${fileBasename}", "--runInBand"],
  "cwd": "${workspaceFolder}/api",
  "console": "integratedTerminal"
}
```

## Common Issues

### "Cannot find module"
```bash
cd api && npm install
```

### "MongoDB connection failed"
Tests use mocks - no real database needed. If you see this error, check that mocks are properly set up.

### "Timeout"
Increase timeout in jest.config.js:
```javascript
testTimeout: 30000  // 30 seconds
```

## Next Steps

1. **Expand Coverage:**
   - Add tests for GetChart, DeleteChart, ShareChart
   - Add tests for authorization.js
   - Add tests for logger.js

2. **Integration Tests:**
   - End-to-end tests with real database (test environment)
   - API contract tests
   - Load testing for rate limiter

3. **Continuous Improvement:**
   - Gradually increase coverage thresholds
   - Add performance benchmarks
   - Add security-focused tests

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Testing Best Practices](https://testingjavascript.com/)
- [Azure Functions Testing](https://learn.microsoft.com/en-us/azure/azure-functions/functions-test-a-function)
