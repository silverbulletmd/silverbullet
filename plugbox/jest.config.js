export default {
  extensionsToTreatAsEsm: [".ts"],
  preset: "ts-jest/presets/default-esm", // or other ESM presets
  globals: {
    "ts-jest": {
      useESM: true,
      tsconfig: "<rootDir>/tsconfig.json",
    },
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
};
