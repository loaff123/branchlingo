# BranchLingo

BranchLingo creates reproducible exercise inputs for every reachable ICU MessageFormat selector arm within domains you declare. It explains arms those domains cannot reach and verifies every witness with a pinned FormatJS runtime.

It does not judge translation quality, cover every full execution path, or promise a minimum test suite. Domains are independent: if your application correlates two variables, the declared Cartesian product can include combinations your application never produces.

## Runtime and installation

Version 0.1.0 supports exactly **Linux x64, Node 24.19.0, V8 13.6.233.17-node.51, ICU 78.3, CLDR 48.0, Unicode 17.0**. A different runtime is rejected with `unsupported-runtime` and exit 2. Packs are deliberately not portable across ICU versions. No bypass flag exists.

Clone the source with the supported Node version active:

```sh
git clone https://github.com/loaff123/branchlingo.git
cd branchlingo
npm ci --ignore-scripts
npm run check
node bin/branchlingo.mjs --help
```

The package is also installable from a locally built tarball:

```sh
npm pack --ignore-scripts

# In another project, replace the path below with your actual tarball path:
npm install --ignore-scripts /absolute/path/to/branchlingo/branchlingo-0.1.0.tgz
npx --no-install branchlingo --help
```

These commands may fetch pinned npm dependencies during installation. Generation, analysis, replay, and explanation do not access the network. The package is not published to npm; install from this source or a locally built tarball. Do not use `npm install branchlingo` from the registry.

## Worked example

The included `examples/files.json` contains:

```text
{mode, select, summary {{n, plural, =1 {Exactly one} one {Category one} other {# files}}} other {{mode, select, summary {Unreachable} other {All files}}}}
```

`examples/manifest.json` explicitly binds `mode` to `all` or `summary`, and `n` to integers 0 through 3. It references the same catalog bytes for English, French, and Japanese. The source SHA-256 is already recorded; after editing your own catalog, update its hash using `sha256sum catalog.json`.

Run from a fresh directory or choose new output filenames:

```sh
node bin/branchlingo.mjs generate examples/manifest.json --out exercise-pack.json
node bin/branchlingo.mjs replay exercise-pack.json --manifest examples/manifest.json --out replay-report.json
node bin/branchlingo.mjs explain exercise-pack.json --manifest examples/manifest.json
```

The result is 10 cases covering 16 reachable arm occurrences out of 21:

- English: 5 of 7 arms, 3 cases. `summary/0` renders `0 files`; `summary/1` renders `Exactly one`; `all/0` renders `All files`
- French: 6 of 7 arms, 4 cases. Zero additionally reaches `one` and renders `Category one`; `summary/2` renders `2 files`
- Japanese: 5 of 7 arms, 3 cases

The nested `summary` arm cannot be reached inside a parent that already requires `mode=all`. English `=1` shadows the only `one` match in this domain. Japanese has no `one` match. These are informational findings, not translation defects. A required `other` may also be unreachable: `{s,select,only{chosen}other{never}}` with the sole domain value `only` reaches only the first arm.

Replay requires the original manifest and catalog bytes separately. Changing a runtime field in the pack, such as `icu`, makes replay return `mismatch` (exit 4), even if rendered text might happen to match. Regenerate on a newly supported profile rather than editing a pack.

## Inputs and support

The JSON schemas in `schemas/` define record shapes; semantic validation is stricter. Catalogs contain an array of `{id,text}` messages. Manifests explicitly list catalog IDs, relative paths, locales, expected SHA-256 hashes, and contracts keyed by message ID. The example is a complete template.

- Supported: literals, plain placeholders, `select`, cardinal `plural`, `selectordinal`, signed safe-integer offsets, canonical signed safe-integer exact labels, and parser-recognized `#`
- String enums: 1–256 unique strings, each at most 4,096 UTF-16 units and 16 KiB UTF-8
- Numeric domains: closed nonnegative safe-integer ranges, at most 10,001 values
- Sample bindings: a string or nonnegative safe integer, for variables never used as selectors
- Every syntactic variable must be bound; bindings unused across all catalogs for that message are errors. Every render receives the complete contract
- Rejected: number/date/time formats, skeletons, rich-text tags, MF2, arbitrary plural category names, custom formatters, coercion, unknown locales, extensions/private-use locales, duplicate JSON keys, malformed UTF-8, BOM, lone surrogates, negative zero, and non-integer or unsafe JSON numeric values
- Exact labels `=01`, `=+1`, and `=-0` are rejected. Offsets affect plural category selection and pound rendering, but not exact matching

Apostrophes and pound scope follow the pinned parser. A `#` inside a nested `select` body is literal, even within a plural; nested plural establishes its own pound value. Positions use zero-based UTF-16 offsets and one-based code-point columns, not byte or grapheme offsets.

## CLI

```text
branchlingo generate manifest.json --out pack.json [--json] [--fail-on-unreachable]
branchlingo replay pack.json --manifest manifest.json --out report.json [--json]
branchlingo explain pack.json --manifest manifest.json [--json]
```

`--json` writes machine-readable result JSON to stdout. Other progress and errors go to stderr. `explain` first performs full replay and then prints escaped text. Unknown options fail. `--fail-on-unreachable` exits 1 only after successfully creating a complete pack.

Outputs are **create-only**. There is no `--force`. Choose a new path rather than overwriting inputs or existing results. The CLI uses an exclusive same-directory temporary file, syncs its bytes, then atomically hard-links it into the requested absent destination. A concurrent writer wins or loses without being clobbered. This requires a filesystem supporting hard links. Directory sync is best-effort; power-loss durability is not guaranteed.

Exit codes: 0 complete/verified; 1 complete with requested unreachable policy; 2 invalid input/CLI/unsupported profile; 3 incomplete resource/time/worker termination; 4 input/runtime/render/tamper mismatch; 5 I/O/internal failure. Failed generation never installs a pack. Replay may install a report of any status.

Only explicit regular files are read. Catalog paths must remain relative to the manifest directory without `..`, URL schemes, or symlink components. The CLI rejects directories, devices, FIFOs, and input/output aliases. It is not a hardened filesystem sandbox against another process concurrently replacing ancestor directories. Source hashes prevent accepting altered catalog bytes; they are not a signature or authorship proof.

Packs contain source identifiers, relative catalog paths, complete argument values, and rendered text. Choose non-sensitive samples and review a pack before sharing it.

## JavaScript API

```js
import { readFile } from 'node:fs/promises';
import { analyzeCatalog, generateCases, replayCases } from 'branchlingo';

const manifestBytes = await readFile('examples/manifest.json');
const catalog = await readFile('examples/files.json');
const catalogsById = new Map(['en', 'fr', 'ja'].map(id => [id, catalog]));
const result = await analyzeCatalog({ manifestBytes, catalogsById });
if (result.status !== 'analyzed') throw new Error(JSON.stringify(result));
const pack = await generateCases(result.analysis);
if (pack.status !== 'complete') throw new Error(JSON.stringify(pack));
const report = await replayCases({
  packBytes: new TextEncoder().encode(JSON.stringify(pack)),
  manifestBytes,
  catalogsById
});
console.log(report.status); // verified
```

These functions return promises. The API copies ordinary `Uint8Array` inputs synchronously before asynchronous work, rejects shared-memory buffers, and freezes returned data. The analysis handle is opaque and valid only in its creating process. A forged or deserialized handle is rejected. Caller-supplied JavaScript getters, proxies, and custom Map/typed-array iterators are ordinary caller code, not an untrusted-code sandbox; the validated security boundary is the snapshotted JSON bytes. The API accepts no paths, ASTs, formatters, callbacks, or executable manifests.

Each API operation uses an isolated worker with a 256 MiB old-generation V8 heap limit and 30-second watchdog. Controlled structures have a conservative 64 MiB allocation estimate; native/V8 overhead means this is not a total-RSS guarantee. Other caps include 2 MiB total input bytes, 32 selector levels, 50,000 AST nodes, 10,000 arms/cases, 100,000 aggregate domain values, 10 million dispatch/mask/render work units, 1 MiB original output, 2 MiB marked output, 32 MiB aggregate rendering, and 16 MiB serialized packs. The manifest can only lower its seven documented limits. Exceeding a cap produces `incomplete`, never a partial coverage certificate.

See [the exact profile and digest contract](docs/profile.md) for replay semantics, limits, and deterministic IDs. The four runtime dependencies and full license notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Verification and scope

`npm test` exercises strict parsing, immutable byte boundaries, finite masks, hostile replay, resources, filesystem/CLI behavior, and an independent tiny-domain Cartesian oracle. Oracle interpretation and tracing are separate from production; the pinned parser and native Intl are intentionally shared dependencies. Manual parser-sensitive expectations supplement that shared dependency. `npm run check` additionally runs hard-boundary checks, real heap/watchdog fault injection, kernel network-denial CLI/API checks, and a clean tarball install. The full check requires Linux libseccomp, Python 3, and an npm cache populated by `npm ci`; install-time traffic is outside the offline runtime claim. The CI workflow runs these checks on the exact supported Node version.

The project complements FormatJS linting and broader catalog validation such as i18n-check or Weblate. It makes no claim that those tools have a bug or that branch coverage establishes linguistic correctness.

Original source: MIT. Dependencies retain their own licenses.
