# Jest Modern Native ESM Specialization

Running Jest with native ECMAScript Modules (ESM) requires specific Node.js flags and module transformation parameters.

---

## 1. Native ESM Configuration

To execute Jest in pure ESM mode without bundling into CommonJS:

```json
// package.json
{
  "type": "module",
  "scripts": {
    "test:jest": "NODE_OPTIONS='--experimental-vm-modules' jest"
  }
}
```

```javascript
// jest.config.js
export default {
  testEnvironment: "node",
  transform: {},
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
};
```

---

## 2. Dynamic Import & Mocking in Native ESM

In Jest Native ESM, standard `jest.mock()` behavior differs from CommonJS due to static ESM module graph evaluation:

```typescript
import { jest } from "@jest/globals";

// Use unstable_mockModule for native ESM
jest.unstable_mockModule("../src/database.js", () => ({
  connect: jest.fn().mockResolvedValue(true),
}));

// Dynamic import after mocking
const { connect } = await import("../src/database.js");
const { AppService } = await import("../src/app-service.js");

describe("AppService ESM", () => {
  it("initializes database connection", async () => {
    const service = new AppService();
    await service.start();
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
```
