module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/tests/extension/**/*.test.js'],
    // Le script extension.js utilise `imports.gi`/`imports.ui` (GJS) : mocks fournis par setupFiles.
    setupFiles: ['<rootDir>/tests/extension/gjs-mocks.js'],
    // Un seul worker : les mocks GJS sont globaux (module cache partagé).
    maxWorkers: 1,
    clearMocks: true,
    restoreMocks: true,
};
