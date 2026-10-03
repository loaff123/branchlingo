import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  PROFILE, buildInput, concreteOracle, generatedFixtures,
  assertPackMatchesOracle, utf16Position, sha256,
} from './oracle.mjs';

const representativeBytes = await readFile(new URL('./fixtures/representative.json', import.meta.url));
const { fixtures } = JSON.parse(representativeBytes);
const LOCALES = ['en', 'fr', 'ja', 'ru', 'pl', 'ar'];
const RANDOM_SEED = 0x4b1d730a;
const RANDOM_FIXTURES = 48;

async function exerciseBundle(input, expected, { replay = true } = {}) {
  const { analyzeCatalog, generateCases, replayCases } = await import('../src/index.mjs');
  const analysis = await analyzeCatalog(input);
  assert.equal(analysis.status, 'analyzed', JSON.stringify(analysis));
  const pack = await generateCases(analysis.analysis);
  assert.equal(pack.status, 'complete', JSON.stringify(pack));
  assertPackMatchesOracle(pack, expected);
  assert.deepEqual(analysis.arms, pack.arms, 'analysis and generation arm records agree');
  if (replay) {
    const report = await replayCases({ ...input, packBytes: Buffer.from(JSON.stringify(pack)) });
    assert.equal(report.status, 'verified', JSON.stringify(report));
    assert.equal(report.inputMatch, true);
    assert.equal(report.runtimeMatch, true);
    assert.deepEqual(report.recomputedCounts, pack.counts);
    assert.deepEqual(new Set(report.verifiedCaseIds), new Set(pack.cases.map(({ id }) => id)));
    assert.deepEqual(report.diagnostics, []);
  }
  return pack;
}

test('independent Cartesian oracle: all frozen fixture locales and manual expectations', async (t) => {
  assert.equal(sha256(representativeBytes), '9e3ada22e7c4b45c6d6553683d1d1a3ded0f88a91717e5ccad6756e726e3517c', 'unaltered pre-implementation fixture bytes');
  assert.equal(fixtures.length, 12, 'freeze fixture inventory');
  let assignments = 0;
  let scopes = 0;
  let manualChecks = 0;
  const expected = [];
  for (const fixture of fixtures) {
    for (const locale of fixture.locales) {
      const oracle = concreteOracle({ ...fixture, locale, catalogId: `representative-${locale}` });
      assignments += oracle.assignments.length;
      scopes++;
      for (const expectation of fixture.manual ?? []) {
        if (expectation.locale && expectation.locale !== locale) continue;
        const tuple = oracle.assignments.find(({ values }) =>
          Object.keys(expectation.arguments).every((name) => values[name] === expectation.arguments[name]));
        assert.ok(tuple, `${fixture.id}/${locale}: manual tuple is in declared domain`);
        assert.equal(tuple.output, expectation.output, `${fixture.id}/${locale}: manual output`);
        assert.deepEqual(tuple.labels, expectation.labels, `${fixture.id}/${locale}: manual trace labels`);
        manualChecks++;
      }
      if (fixture.expectedArms !== undefined) assert.equal(oracle.arms.length, fixture.expectedArms);
      if (fixture.expectedReachable?.[locale] !== undefined) {
        assert.equal(oracle.reachableIds.size, fixture.expectedReachable[locale], `${fixture.id}/${locale}`);
      }
      if (fixture.expectedLabels) assert.deepEqual(oracle.arms.map((arm) => arm.label), fixture.expectedLabels);
      expected.push(oracle);
    }
  }
  assert.equal(scopes, 29, 'actual fixture-locale pairs');
  assert.equal(assignments, 239, 'actual fully enumerated assignments, including samples');
  assert.equal(manualChecks, 21, 'manual concrete render/trace expectations');
  const input = buildInput(fixtures, LOCALES, 'representative');
  // Source bytes participate in identities. Attach their independently computed hashes only after constructing the catalog.
  for (const oracle of expected) oracle.setCatalogSha256(sha256(input.catalogsById.get(oracle.catalogId)));
  const pack = await exerciseBundle(input, expected);
  const { analyzeCatalog, generateCases } = await import('../src/index.mjs');
  const repeated = await generateCases((await analyzeCatalog(input)).analysis);
  assert.deepEqual(repeated, pack, 'identical inputs yield an identical complete pack');
  t.diagnostic(`fixture SHA-256 ${sha256(representativeBytes)}; ${fixtures.length} frozen fixtures; ${scopes} locale scopes; ${assignments} Cartesian assignments; ${manualChecks} manual checks`);
});


test('manual worked example fixes every source-order branch path independently of the parser', (t) => {
  const fixture = fixtures.find(({ id }) => id === 'worked');
  let checks = 0;
  for (const locale of fixture.locales) {
    const oracle = concreteOracle({ ...fixture, locale, catalogId: `worked-manual-${locale}` });
    for (const assignment of oracle.assignments) {
      const { mode, n } = assignment.values;
      const route = mode === 'all' ? [4, 6] : n === 1 ? [0, 1] : locale === 'fr' && n === 0 ? [0, 2] : [0, 3];
      const output = mode === 'all' ? 'All files' : n === 1 ? 'Exactly one' : locale === 'fr' && n === 0 ? 'Category one' : `${n} files`;
      assert.deepEqual(assignment.visited.map((arm) => oracle.arms.indexOf(arm)), route);
      assert.equal(assignment.output, output);
      checks++;
    }
  }
  assert.equal(checks, 24);
  t.diagnostic('24 additional concrete assignments repeat the worked fixture with independently specified source-order paths');
});

test('independent oracle source coordinates count UTF-16 offsets and code-point columns', (t) => {
  assert.deepEqual(utf16Position('😀{x}', 2), { offsetUtf16: 2, line: 1, columnCodePoints: 2 });
  assert.deepEqual(utf16Position('😀\r\n{x}', 4), { offsetUtf16: 4, line: 2, columnCodePoints: 1 });
  assert.deepEqual(utf16Position('😀\r{x}', 3), { offsetUtf16: 3, line: 1, columnCodePoints: 3 });
  const oracle = concreteOracle({ id: 'coordinates', catalogId: 'coordinates-en', locale: 'en', text: '😀\r\n{x,select,a{A}other{B}}', variables: [{ name: 'x', domain: { kind: 'string-enum', values: ['a', 'b'] } }] });
  assert.deepEqual(oracle.arms.map(({ label, selectorSpan, bodySpan }) => ({ label, selectorSpan, bodySpan })), [
    { label: 'a', selectorSpan: { start: { offsetUtf16: 4, line: 2, columnCodePoints: 1 }, end: { offsetUtf16: 27, line: 2, columnCodePoints: 24 } }, bodySpan: { start: { offsetUtf16: 15, line: 2, columnCodePoints: 12 }, end: { offsetUtf16: 18, line: 2, columnCodePoints: 15 } } },
    { label: 'other', selectorSpan: { start: { offsetUtf16: 4, line: 2, columnCodePoints: 1 }, end: { offsetUtf16: 27, line: 2, columnCodePoints: 24 } }, bodySpan: { start: { offsetUtf16: 23, line: 2, columnCodePoints: 20 }, end: { offsetUtf16: 26, line: 2, columnCodePoints: 23 } } },
  ]);
  assert.equal(oracle.assignments.length, 2);
  t.diagnostic('one additional coordinate fixture; two concrete Cartesian assignments');
});

test('seeded tiny generated messages match every actual formatter trace in six locales', async (t) => {
  const random = generatedFixtures(RANDOM_SEED, RANDOM_FIXTURES, LOCALES);
  assert.equal(random.length, RANDOM_FIXTURES);
  assert.deepEqual(generatedFixtures(RANDOM_SEED, RANDOM_FIXTURES, LOCALES), random, 'reproducible seed');
  const input = buildInput(random, LOCALES, 'seeded');
  const expected = [];
  let assignments = 0;
  for (const fixture of random) for (const locale of LOCALES) {
    const oracle = concreteOracle({ ...fixture, locale, catalogId: `seeded-${locale}`, catalogSha256: sha256(input.catalogsById.get(`seeded-${locale}`)) });
    assignments += oracle.assignments.length;
    expected.push(oracle);
  }
  assert.equal(expected.length, 288);
  assert.equal(assignments, 2880, '48 messages × 6 locales × 2 strings × 5 integers');
  await exerciseBundle(input, expected);
  t.diagnostic(`seed=0x${RANDOM_SEED.toString(16)}; ${RANDOM_FIXTURES} generated messages; ${expected.length} locale scopes; ${assignments} complete Cartesian assignments; profile=${PROFILE}`);
});
