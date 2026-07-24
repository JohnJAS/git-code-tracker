# Packaged Version Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ZIP-installed trackers record the release version and keep release metadata consistent.

**Architecture:** The source installer carries an explicit build-time version marker. The build script copies source into each distributed skill and replaces that marker using the root package version. The installer therefore never inspects the target project's package metadata. The release workflow stages the lockfile updated by `npm version`.

**Tech Stack:** Node.js ESM, Node test runner, GitHub Actions.

---

### Task 1: Prove the packaged installer behavior

**Files:**
- Modify: `test/install.test.js`

- [x] **Step 1: Write the failing test**

```js
test("built installer records the release version", async () => {
  const repoRoot = await fakeRepo();
  await runBuild();
  const { installIntoRepo: installBuilt } = await importBuiltInstaller();

  await installBuilt(repoRoot);

  const config = JSON.parse(await fs.readFile(configPath(repoRoot), "utf8"));
  assert.equal(config.installedVersion, packageVersion);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `node --test test/install.test.js`

Expected: failure because the built installer reads the target project's missing `package.json` and writes `0.1.0`.

### Task 2: Inject the distribution version at build time

**Files:**
- Modify: `src/cli/install.js`
- Modify: `scripts/build.js`

- [x] **Step 1: Add an explicit source marker**

```js
const PACKAGED_VERSION = "__AI_CODE_TRACKER_VERSION__";
```

Use `PACKAGED_VERSION` when writing `installedVersion` and remove the read of `path.join(repoRoot, "package.json")`.

- [x] **Step 2: Replace the marker in every copied `lib/cli/install.js`**

```js
const packageVersion = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8")).version;
const marker = "__AI_CODE_TRACKER_VERSION__";
const installer = path.join(dest, "cli", "install.js");
const content = await fs.readFile(installer, "utf8");
await fs.writeFile(installer, content.replaceAll(marker, packageVersion), "utf8");
```

Fail the build if the root version is absent or a copied installer does not contain the marker.

- [x] **Step 3: Run the installer test to verify it passes**

Run: `node --test test/install.test.js`

Expected: PASS.

### Task 3: Preserve lockfile version updates in releases

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `package-lock.json`

- [x] **Step 1: Stage the lockfile with release files**

```sh
git add package.json package-lock.json .opencode .claude .cac
```

- [x] **Step 2: Synchronize the current lockfile**

Run: `npm install --package-lock-only --ignore-scripts`

Expected: the root `version` and `packages[""] .version` in `package-lock.json` both become `1.0.4` without dependency changes.

- [x] **Step 3: Run full verification**

Run: `npm test && npm run build && npm run package`

Expected: tests pass; all three built installers include the release version; release ZIP is created.
