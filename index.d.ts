export type Status = 'invalid' | 'incomplete' | 'mismatch';
export interface Diagnostic { readonly code: string; readonly message: string; readonly catalogId: string | null; readonly messageId: string | null; readonly armId: string | null }
export interface Failure { readonly kind: 'branchlingo-diagnostic-report'; readonly schemaVersion: 1; readonly status: Status; readonly diagnostics: readonly Diagnostic[] }
export interface Inputs { readonly manifestBytes: Uint8Array; readonly catalogsById: ReadonlyMap<string, Uint8Array> }
declare const handleBrand: unique symbol;
export interface AnalysisHandle { readonly [handleBrand]: never }
export interface Counts { readonly messages: number; readonly arms: number; readonly reachable: number; readonly unreachable: number; readonly cases: number; readonly dispatchEvaluations: number; readonly maskWordOps: number; readonly renderWork: number }
export interface Position { readonly offsetUtf16: number; readonly line: number; readonly columnCodePoints: number }
export interface Span { readonly start: Position; readonly end: Position }
export interface Constraint { readonly ancestorArmId: string; readonly variable: string; readonly allowedCount: number; readonly maskSha256: string }
export interface Arm { readonly id: string; readonly catalogId: string; readonly messageId: string; readonly locale: string; readonly variable: string; readonly selectorType: 'select' | 'plural' | 'selectordinal'; readonly label: string; readonly selectorSpan: Span; readonly bodySpan: Span; readonly localAllowedCount: number; readonly constraints: readonly Constraint[]; readonly classification: 'reachable' | 'unreachable'; readonly witnessCaseId: string | null; readonly emptyVariables: readonly string[] }
export interface ExerciseCase { readonly id: string; readonly catalogId: string; readonly messageId: string; readonly locale: string; readonly arguments: readonly {readonly name: string; readonly value: string | number}[]; readonly output: string; readonly outputSha256: string; readonly trace: readonly string[] }
export type Json = null | boolean | number | string | readonly Json[] | {readonly [key: string]: Json};
export interface Analysis { readonly status: 'analyzed'; readonly analysis: AnalysisHandle; readonly counts: Counts; readonly arms: readonly Arm[]; readonly runtime: Json }
export interface Pack { readonly kind: 'branchlingo-exercise-pack'; readonly schemaVersion: 1; readonly status: 'complete'; readonly coverageClaim: 'every-reachable-arm-in-declared-finite-cartesian-domains'; readonly manifestSha256: string; readonly manifest: Json; readonly sources: readonly Json[]; readonly runtime: Json; readonly counts: Counts; readonly arms: readonly Arm[]; readonly cases: readonly ExerciseCase[] }
export interface ReplayReport { readonly kind: 'branchlingo-replay-report'; readonly schemaVersion: 1; readonly status: 'verified' | Status; readonly packSha256: string; readonly inputMatch: boolean; readonly runtimeMatch: boolean; readonly recomputedCounts: Counts | null; readonly verifiedCaseIds: readonly string[]; readonly diagnostics: readonly Diagnostic[] }
export function analyzeCatalog(input: Inputs): Promise<Analysis | Failure>;
export function generateCases(analysis: AnalysisHandle): Promise<Pack | Failure>;
export function replayCases(input: Inputs & {readonly packBytes: Uint8Array}): Promise<ReplayReport | Failure>;
