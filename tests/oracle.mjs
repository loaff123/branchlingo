/**
 * Independent, deliberately exponential test oracle. No production modules are imported.
 * Every tiny Cartesian tuple is interpreted concretely and compared to the pinned actual
 * formatter twice: original source and separately instrumented AST. The parser and native
 * Intl behavior are shared dependencies, not independent parser/CLDR implementations.
 * Instrumentation uses absent single Unicode scalars, deliberately unlike the product's
 * run-length P/Q/R protocol. Manual fixtures constrain parser-sensitive semantics.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parse } from '@formatjs/icu-messageformat-parser';
import IntlMessageFormat from 'intl-messageformat';

export const PROFILE = 'formatjs-mf1-finite-v1';
const PARSER_OPTIONS = Object.freeze({ captureLocation: true, ignoreTag: false, requiresOtherClause: true, shouldParseSkeletons: false });
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const compareStrings = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function utf16Position(text, offsetUtf16) {
  assert.ok(Number.isInteger(offsetUtf16) && offsetUtf16 >= 0 && offsetUtf16 <= text.length);
  let line = 1;
  let columnCodePoints = 1;
  for (const character of text.slice(0, offsetUtf16)) {
    if (character === '\n') { line++; columnCodePoints = 1; }
    else columnCodePoints++;
  }
  return { offsetUtf16, line, columnCodePoints };
}

function sourceSpan(text, location) {
  assert.ok(location, 'the pinned parser must retain locations');
  const start = utf16Position(text, location.start.offset);
  const end = utf16Position(text, location.end.offset);
  assert.deepEqual([location.start.line, location.start.column], [start.line, start.columnCodePoints]);
  assert.deepEqual([location.end.line, location.end.column], [end.line, end.columnCodePoints]);
  return { start, end };
}

function bindingValues({ domain }) {
  if (domain.kind === 'sample') return [domain.value];
  if (domain.kind === 'string-enum') return [...domain.values].sort(compareStrings);
  assert.equal(domain.kind, 'integer-range');
  assert.ok(domain.max - domain.min <= 100, 'test-only Cartesian oracle refuses large numeric domains');
  return Array.from({ length: domain.max - domain.min + 1 }, (_, index) => domain.min + index);
}

function allArguments(bindings) {
  const sorted = [...bindings].sort((a, b) => compareStrings(a.name, b.name));
  let tuples = [Object.create(null)];
  for (const binding of sorted) {
    const next = [];
    for (const tuple of tuples) for (const value of bindingValues(binding)) {
      const copy = Object.assign(Object.create(null), tuple);
      Object.defineProperty(copy, binding.name, { value, enumerable: true, configurable: true, writable: true });
      next.push(copy);
    }
    tuples = next;
    assert.ok(tuples.length <= 10000, 'test-only Cartesian tuple cap');
  }
  return tuples;
}

const argumentPairs = (values) => Object.keys(values).sort(compareStrings).map((name) => [name, values[name]]);
const tupleKey = (values) => JSON.stringify(argumentPairs(values));

export function buildInput(fixtures, locales, prefix) {
  const catalogsById = new Map();
  const catalogs = [];
  for (const locale of locales) {
    const messages = fixtures.filter((fixture) => fixture.locales.includes(locale)).map(({ id, text }) => ({ id, text }));
    if (!messages.length) continue;
    const id = `${prefix}-${locale}`;
    const bytes = Buffer.from(JSON.stringify({ kind: 'branchlingo-catalog', schemaVersion: 1, messages }));
    catalogsById.set(id, bytes);
    catalogs.push({ id, locale, path: `${id}.json`, sha256: sha256(bytes) });
  }
  const manifest = { kind: 'branchlingo-manifest', schemaVersion: 1, profile: PROFILE, catalogs,
    contracts: fixtures.map(({ id: messageId, variables }) => ({ messageId, variables })) };
  return { manifestBytes: Buffer.from(JSON.stringify(manifest)), catalogsById };
}

export function concreteOracle({ id: messageId, text, variables, locale, catalogId, catalogSha256 = '' }) {
  const ast = parse(text, PARSER_OPTIONS);
  const number = new Intl.NumberFormat(locale);
  const cardinal = new Intl.PluralRules(locale, { type: 'cardinal' });
  const ordinal = new Intl.PluralRules(locale, { type: 'ordinal' });
  const arms = [];
  const armByNode = new WeakMap();
  const sortedBindings = [...variables].sort((a, b) => compareStrings(a.name, b.name));

  function chosenLabel(node, values) {
    const argument = values[node.value];
    if (node.type === 5) return own(node.options, argument) ? argument : 'other';
    assert.equal(node.type, 6);
    const exact = `=${argument}`;
    if (own(node.options, exact)) return exact;
    const category = (node.pluralType === 'ordinal' ? ordinal : cardinal).select(argument - node.offset);
    return own(node.options, category) ? category : 'other';
  }

  function inspect(nodes, ancestors = []) {
    for (const node of nodes) {
      assert.ok([0, 1, 5, 6, 7].includes(node.type), `oracle intentionally excludes AST type ${node.type}`);
      if (node.type !== 5 && node.type !== 6) continue;
      const labelMap = new Map();
      armByNode.set(node, labelMap);
      const labels = Object.keys(node.options).sort((a, b) => node.options[a].location.start.offset - node.options[b].location.start.offset);
      for (const label of labels) {
        const option = node.options[label];
        const selectorSpan = sourceSpan(text, node.location);
        const bodySpan = sourceSpan(text, option.location);
        assert.equal(text[bodySpan.start.offsetUtf16], '{');
        assert.equal(text[bodySpan.end.offsetUtf16 - 1], '}');
        const arm = { catalogId, messageId, locale, variable: node.value,
          selectorType: node.type === 5 ? 'select' : node.pluralType === 'ordinal' ? 'selectordinal' : 'plural',
          label, selectorSpan, bodySpan, ancestors: [...ancestors], node };
        Object.defineProperty(arm, 'id', { enumerable: true, get: () => sha256(JSON.stringify([
          PROFILE, catalogId, catalogSha256, messageId, locale,
          selectorSpan.start.offsetUtf16, bodySpan.start.offsetUtf16, label,
        ])) });
        const binding = variables.find(({ name }) => name === node.value);
        assert.ok(binding, `missing oracle binding ${node.value}`);
        arm.localAllowedCount = bindingValues(binding).filter((value) => {
          const values = Object.create(null);
          Object.defineProperty(values, node.value, { value, enumerable: true });
          return chosenLabel(node, values) === label;
        }).length;
        labelMap.set(label, arm);
        arms.push(arm);
        inspect(option.value, [...ancestors, arm]);
      }
    }
  }
  inspect(ast);

  function interpret(nodes, values, currentPluralValue, visited) {
    let output = '';
    for (const node of nodes) {
      if (node.type === 0) output += node.value;
      else if (node.type === 1) { assert.ok(own(values, node.value)); output += String(values[node.value]); }
      else if (node.type === 7) output += currentPluralValue === undefined ? '#' : number.format(currentPluralValue);
      else {
        const label = chosenLabel(node, values);
        visited.push(armByNode.get(node).get(label));
        // The pinned formatter resets plural context when entering select, as does its parser.
        const plural = node.type === 6 ? values[node.value] - node.offset : undefined;
        output += interpret(node.options[label].value, values, plural, visited);
      }
    }
    return output;
  }

  function formatMarked(values, original) {
    const originalCharacters = new Set(original);
    const symbolForArm = new Map();
    const armForSymbol = new Map();
    let codePoint = 0xf0000;
    for (const arm of arms) {
      while (originalCharacters.has(String.fromCodePoint(codePoint))) codePoint++;
      assert.ok(codePoint < 0xffffe, 'test marker scalar space exhausted');
      const symbol = String.fromCodePoint(codePoint++);
      symbolForArm.set(arm, symbol);
      armForSymbol.set(symbol, arm);
    }
    function clone(nodes) {
      return nodes.map((node) => {
        if (node.type !== 5 && node.type !== 6) return { ...node };
        const options = Object.create(null);
        for (const label of Object.keys(node.options)) {
          const option = node.options[label];
          const marker = symbolForArm.get(armByNode.get(node).get(label));
          Object.defineProperty(options, label, { enumerable: true, configurable: true, writable: true,
            value: { ...option, value: [{ type: 0, value: marker }, ...clone(option.value)] } });
        }
        return { ...node, options };
      });
    }
    const marked = new IntlMessageFormat(clone(ast), locale, undefined, PARSER_OPTIONS).format(values);
    assert.equal(typeof marked, 'string');
    const visited = [];
    let stripped = '';
    for (const character of marked) {
      if (armForSymbol.has(character)) visited.push(armForSymbol.get(character));
      else stripped += character;
    }
    assert.equal(stripped, original, `${catalogId}/${messageId}: instrumented formatter restores exact output`);
    return visited;
  }

  const formatter = new IntlMessageFormat(text, locale, undefined, PARSER_OPTIONS);
  const assignments = allArguments(sortedBindings).map((values) => {
    const visited = [];
    const interpreted = interpret(ast, values, undefined, visited);
    const output = formatter.format(values);
    assert.equal(typeof output, 'string');
    const context = `${catalogId}/${messageId}/${tupleKey(values)}`;
    assert.equal(interpreted, output, `${context}: concrete interpretation agrees with original actual formatter`);
    const marked = formatMarked(values, output);
    assert.deepEqual(marked.map((arm) => arm.bodySpan), visited.map((arm) => arm.bodySpan), `${context}: actual marked trace agrees with interpretation`);
    return { values, arguments: argumentPairs(values).map(([name, value]) => ({ name, value })), output,
      labels: visited.map((arm) => arm.label), visited,
      get trace() { return visited.map((arm) => arm.id); },
      get caseId() { return sha256(JSON.stringify([PROFILE, catalogId, catalogSha256, messageId, locale, argumentPairs(values).map(([name, value]) => ({ name, value }))])); } };
  });

  return { catalogId, messageId, locale, text, arms, assignments,
    setCatalogSha256(value) { catalogSha256 = value; },
    get reachableIds() { return new Set(assignments.flatMap(({ trace }) => trace)); } };
}

export function assertPackMatchesOracle(pack, scopes) {
  let totalArms = 0;
  let totalReachable = 0;
  let totalCases = 0;
  const expectedAllCases = new Set();
  for (const oracle of scopes) {
    const context = `${oracle.catalogId}/${oracle.messageId}/${oracle.locale}`;
    const sameScope = (item) => item.catalogId === oracle.catalogId && item.messageId === oracle.messageId && item.locale === oracle.locale;
    const actualArms = pack.arms.filter(sameScope);
    const actualCases = pack.cases.filter(sameScope);
    assert.equal(actualArms.length, oracle.arms.length, `${context}: all syntactic occurrences retained`);
    const reachable = oracle.reachableIds;
    const expectedCases = new Map();
    for (let index = 0; index < oracle.arms.length; index++) {
      const expected = oracle.arms[index];
      const actual = actualArms[index];
      for (const key of ['id', 'catalogId', 'messageId', 'locale', 'variable', 'selectorType', 'label', 'selectorSpan', 'bodySpan', 'localAllowedCount']) {
        assert.deepEqual(actual[key], expected[key], `${context}: source-order arm ${index} ${key}`);
      }
      assert.equal(actual.classification, reachable.has(expected.id) ? 'reachable' : 'unreachable', `${context}: exact Cartesian arm classification`);
      const witness = oracle.assignments.find(({ trace }) => trace.includes(expected.id));
      if (witness) {
        assert.equal(actual.witnessCaseId, witness.caseId, `${context}: canonical first concrete witness`);
        expectedCases.set(witness.caseId, witness);
      } else assert.equal(actual.witnessCaseId, null, `${context}: no witness for unreachable arm`);
    }
    if (oracle.arms.length === 0) expectedCases.set(oracle.assignments[0].caseId, oracle.assignments[0]);
    assert.equal(actualCases.length, expectedCases.size, `${context}: deterministic whole-tuple witness deduplication`);
    const actualIds = new Set();
    for (const actual of actualCases) {
      assert.ok(!actualIds.has(actual.id), `${context}: no duplicate cases`);
      actualIds.add(actual.id);
      const expected = expectedCases.get(actual.id);
      assert.ok(expected, `${context}: case must be a deterministic canonical witness`);
      assert.deepEqual(actual.arguments, expected.arguments, `${context}: complete canonical arguments`);
      assert.equal(actual.output, expected.output, `${context}: actual original formatter output`);
      assert.equal(actual.outputSha256, sha256(expected.output), `${context}: exact UTF-8 output digest`);
      assert.deepEqual(actual.trace, expected.trace, `${context}: actual independently marked trace`);
      expectedAllCases.add(actual.id);
    }
    totalArms += oracle.arms.length;
    totalReachable += reachable.size;
    totalCases += expectedCases.size;
  }
  assert.equal(pack.arms.length, totalArms, 'no invented or omitted arm scopes');
  assert.equal(pack.cases.length, totalCases, 'no invented or omitted case scopes');
  assert.equal(expectedAllCases.size, totalCases, 'case IDs do not collide between scopes');
  assert.equal(pack.counts.messages, scopes.length, 'actual message-locale scope count');
  assert.equal(pack.counts.arms, totalArms);
  assert.equal(pack.counts.reachable, totalReachable);
  assert.equal(pack.counts.unreachable, totalArms - totalReachable);
  assert.equal(pack.counts.cases, totalCases);
}

export function generatedFixtures(seed, count, locales) {
  // Mulberry32: deterministic unsigned 32-bit state, recorded in the test diagnostic.
  let state = seed >>> 0;
  function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  }
  const integer = (maximum) => Math.floor(random() * maximum);
  const pick = (items) => items[integer(items.length)];
  const shuffle = (items) => {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index--) {
      const other = integer(index + 1);
      [copy[index], copy[other]] = [copy[other], copy[index]];
    }
    return copy;
  };
  return Array.from({ length: count }, (_, index) => {
    let selectors = 0;
    function message(depth) {
      if (depth >= 3 || selectors >= 4) return pick(['', 'L', '😀', "'{quoted}'", "don't", '\ue000\ue001\ue002', '#']);
      selectors++;
      const kind = integer(3);
      let prefix;
      let labels;
      if (kind === 0) {
        prefix = 's,select,';
        labels = shuffle([...pick([['a'], ['a', 'b'], ['b'], ['other', 'a']]).filter((value) => value !== 'other'), 'other']);
      } else {
        prefix = `n,${kind === 1 ? 'plural' : 'selectordinal'},offset:${pick([-2, -1, 0, 1, 2])} `;
        labels = shuffle(['other', ...shuffle(['one', 'two', 'few', 'many', 'zero']).slice(0, integer(3)), ...shuffle(['=0', '=1', '=2', '=-1']).slice(0, integer(2))]);
      }
      return `{${prefix}${labels.map((label) => {
        const body = random() < 0.55 ? message(depth + 1) : pick(['', 'same', '#', kind === 0 ? '#' : "'#'", '{s}', '{n}', '\ue000\ue000\ue001payload\ue002']);
        return `${label}{${body}}`;
      }).join('')}}`;
    }
    const first = message(0);
    const second = selectors < 4 && random() < 0.6 ? `|${message(0)}` : '';
    return { id: `random-${String(index).padStart(3, '0')}`, locales: [...locales], text: `😀{s}:{n}|${first}${second}`,
      variables: [{ name: 's', domain: { kind: 'string-enum', values: ['b', 'a'] } }, { name: 'n', domain: { kind: 'integer-range', min: 0, max: 4 } }] };
  });
}
