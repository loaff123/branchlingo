# formatjs-mf1-finite-v1

## Claim and proof

Every contract specifies independent, immutable finite variable domains. Each selector reads exactly one variable. A local arm mask contains exactly those domain values dispatched to that arm by the pinned semantics. The mask intersections along an arm's ancestor chain are necessary and sufficient for reaching it: any reaching tuple satisfies every constraint, and one surviving value chosen independently per variable reaches the arm by structural induction.

The claim concerns arm occurrences within the declared Cartesian product. It is not all-input testing, full execution-path coverage, a minimum suite, translation quality, or proof of real-world variable independence. No downsampling or inferred correlations occur.

`select` checks the exact own key then `other`. Plural/ordinal checks the own literal key `=${n}` before the native category of `n-offset`, then falls back to `other`. Negative exact labels can be syntactically valid but unreachable for nonnegative input domains. Ancestor masks on the same variable intersect; siblings restore prior constraints. Explanations show the full constraint chain, not a minimum unsatisfiable subset.

## Canonical encoding and identity

Canonical JSON sorts record keys in UTF-16 code-unit order, preserves arrays, uses JSON string escaping, and writes safe integers in ordinary decimal. No Unicode normalization or trimming occurs. File/source hashes use original bytes, not normalized JSON.

Arm ID is SHA-256 of canonical `[profile,catalogId,catalogContentSHA,messageId,canonicalLocale,selectorStartUtf16,bodyStartUtf16,label]`.

Case ID is SHA-256 of canonical `[profile,catalogId,catalogContentSHA,messageId,canonicalLocale,arguments]`, where arguments is the sorted array of `{name,value}` records exactly as stored in a case. Witnesses use the minimum surviving integer or first UTF-16-sorted string per variable. Identical tuples are deduplicated within their catalog/message/locale scope. Literal-only messages receive one smoke case.

Constraint mask digest is SHA-256 of canonical `[domainKind,canonicalDomainValues,unsigned32BitWords]`. Local counts and digests describe each ancestor's local mask; reachability and `emptyVariables` result from the path intersections. Unused high bits in the final word are zero. Bit index corresponds to canonical domain order.

An arm's `bodySpan` includes its opening and closing braces, excluding its label. `selectorSpan` spans the whole selector. End offsets are exclusive. Offsets count UTF-16 units; columns count Unicode code points, with LF advancing lines and CR counting as a column. Options are enumerated by source positions, not JavaScript numeric-key ordering.

## Runtime fingerprints

Generation requires the exact runtime in the README and exact installed package code/metadata/license identity. The pack records Node, V8, ICU, CLDR, Unicode, OS/architecture, tool version/build digest, lock digest, four package versions/integrities/entry hashes, and requested/canonical/resolved locale values.

Build digest is SHA-256 of canonical `[relativeFileName,fileSHA256]` pairs for the explicitly named production sources, package metadata, normative bundle schema, and runtime lock. It does not include machine paths, timestamps, tests, or user input files. The bundled `runtime-lock.json` preserves the producer's pinned lock independently of a consumer's dependency tree.

Each locale's behavior digest covers resolved formatter/cardinal/ordinal/number options, source-ordered selector dispatch outcomes, and sorted adjusted-number/number-format-output pairs. The fixed baseline includes 0, 1, 2, 3, 11, 21, and 1000. The fingerprint is additional evidence, not permission to skip exact runtime identity. Unknown locales are refused before native fallback.

## Rendering and replay

Each final witness is rendered from the original uninstrumented source with actual IntlMessageFormat. A separate cloned AST adds literal markers to every arm without changing selector semantics. Marker prefix is a run of U+E000 longer than any such run in the complete original output, followed by U+E001; the 64-character arm ID ends with U+E002. Extraction checks known IDs and requires exact restoration of the original output. Output and marker bounds are checked before marked AST/output allocation.

Replay treats the pack as untrusted JSON. The caller supplies original manifest and catalog bytes separately. Replay validates shape, raw hashes and normalized manifest, exact runtime/profile, then reparses sources and recomputes the entire arm set, IDs, masks, constraints, classifications, deterministic witnesses, case IDs/arguments, and structural counts. Any missing or forged claim fails before rendering cases. Only then does each deduplicated case undergo original/marked actual rendering once, followed by exact text/hash/trace and complete arm-coverage checks.

`verified` establishes correspondence to supplied original input bytes. It does not authenticate who created those bytes or the pack. A fully self-consistent different input needs the caller's separate original inputs; hashes are not signatures.

## Resource accounting

Domains are described and checked before expansion. Aggregate estimates use BigInt and count each catalog-message-locale occurrence, including shared source bytes/contracts. Dispatch work is the sum of domain sizes for all selectors. Mask work is that dispatch count plus two times `ceil(domainSize/32)` per arm: one local-mask count intersection and one ancestor-path intersection. Pack render work is the sum of `(2 × original AST nodes + total arm markers)` per final deduplicated case. Preflight uses the larger undeduplicated witness bound.

The controlled allocation estimate includes source/AST/domain structures, selector dispatch/number-output storage, masks, ancestor evidence, and candidate argument records. Conservative bounds can reject an input before an absolute hard ceiling is reached. They are safety limits, not performance guarantees or RSS measurements.

Byte limits separately cover original/marked/aggregate output and final serialization. Strict source decoding and a context-aware bounded MF1 grammar guard run before the recursive pinned parser. The postparse AST walk is iterative. Any invalid construct, exhausted budget, worker exit, or watchdog expiry prevents a complete pack. Diagnostic/replay reports never carry a coverage certificate.

The optional manifest `limits` object must contain all seven keys defined by its schema. Values only lower dispatchEvaluations, maskWordOps, astNodes, arms, witnessCases, renderWork, and packBytes. It cannot increase hard limits or change heap/watchdog settings.
