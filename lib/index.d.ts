import { Context } from "@deepseek-ai/cordis";
//#region src/protocol/source.d.ts
/** DCP owns its producer kind; durable legacy records remain readable. */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dsh-dcp': {
      kind: 'dsh-dcp';
    };
  }
}
//#endregion
//#region node_modules/.pnpm/@deepseek-ai+cosmokit@1.8.5/node_modules/@deepseek-ai/cosmokit/lib/types/types.d.ts
declare function isArrayBufferLike(value: any): value is ArrayBufferLike;
declare function isArrayBufferSource(value: any): value is Binary.Source;
/** Binary source detection and base64/hex conversion helpers. */
declare namespace Binary {
  type Source<T extends ArrayBufferLike = ArrayBufferLike> = T | ArrayBufferView<T>;
  const is: typeof isArrayBufferLike;
  const isSource: typeof isArrayBufferSource;
  function fromSource<T extends ArrayBufferLike>(source: Source<T>): T;
  function toBase64(source: Source): string;
  function fromBase64(source: string): ArrayBuffer | Uint8Array<ArrayBuffer>;
  function toHex(source: Source): string;
  function fromHex(source: string): ArrayBuffer;
}
//#endregion
//#region node_modules/.pnpm/@deepseek-ai+cosmokit@1.8.5/node_modules/@deepseek-ai/cosmokit/lib/types/misc.d.ts
/** String/symbol keyed dictionary type. */
type Dict<T = any, K extends string | symbol = string> = { [key in K]: T; };
//#endregion
//#region node_modules/.pnpm/@deepseek-ai+cosmokit@1.8.5/node_modules/@deepseek-ai/cosmokit/lib/types/volatile.d.ts
/** Shared config references used by schema validators and plugin runtimes. */
/** Recursively readonly data returned by a volatile config reference. */
type VolatileSnapshot<T> = T extends object ? { readonly [K in keyof T]: VolatileSnapshot<T[K]>; } : T;
/** A stable reference; keep the reference, or capture its value for one operation only. */
interface Volatile<T> {
  /** @returns the current immutable snapshot, including undefined for an absent value. */
  get(): VolatileSnapshot<T>;
}
//#endregion
//#region node_modules/.pnpm/@standard-schema+spec@1.1.0/node_modules/@standard-schema/spec/dist/index.d.ts
/** The Standard Typed interface. This is a base type extended by other specs. */
interface StandardTypedV1<Input = unknown, Output = Input> {
  /** The Standard properties. */
  readonly "~standard": StandardTypedV1.Props<Input, Output>;
}
declare namespace StandardTypedV1 {
  /** The Standard Typed properties interface. */
  interface Props<Input = unknown, Output = Input> {
    /** The version number of the standard. */
    readonly version: 1;
    /** The vendor name of the schema library. */
    readonly vendor: string;
    /** Inferred types associated with the schema. */
    readonly types?: Types<Input, Output> | undefined;
  }
  /** The Standard Typed types interface. */
  interface Types<Input = unknown, Output = Input> {
    /** The input type of the schema. */
    readonly input: Input;
    /** The output type of the schema. */
    readonly output: Output;
  }
  /** Infers the input type of a Standard Typed. */
  type InferInput<Schema extends StandardTypedV1> = NonNullable<Schema["~standard"]["types"]>["input"];
  /** Infers the output type of a Standard Typed. */
  type InferOutput<Schema extends StandardTypedV1> = NonNullable<Schema["~standard"]["types"]>["output"];
}
/** The Standard Schema interface. */
interface StandardSchemaV1<Input = unknown, Output = Input> {
  /** The Standard Schema properties. */
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}
declare namespace StandardSchemaV1 {
  /** The Standard Schema properties interface. */
  interface Props<Input = unknown, Output = Input> extends StandardTypedV1.Props<Input, Output> {
    /** Validates unknown input values. */
    readonly validate: (value: unknown, options?: StandardSchemaV1.Options | undefined) => Result<Output> | Promise<Result<Output>>;
  }
  /** The result interface of the validate function. */
  type Result<Output> = SuccessResult<Output> | FailureResult;
  /** The result interface if validation succeeds. */
  interface SuccessResult<Output> {
    /** The typed output value. */
    readonly value: Output;
    /** A falsy value for `issues` indicates success. */
    readonly issues?: undefined;
  }
  interface Options {
    /** Explicit support for additional vendor-specific parameters, if needed. */
    readonly libraryOptions?: Record<string, unknown> | undefined;
  }
  /** The result interface if validation fails. */
  interface FailureResult {
    /** The issues of failed validation. */
    readonly issues: ReadonlyArray<Issue>;
  }
  /** The issue interface of the failure output. */
  interface Issue {
    /** The error message of the issue. */
    readonly message: string;
    /** The path of the issue, if any. */
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }
  /** The path segment interface of the issue. */
  interface PathSegment {
    /** The key representing a path segment. */
    readonly key: PropertyKey;
  }
  /** The Standard types interface. */
  interface Types<Input = unknown, Output = Input> extends StandardTypedV1.Types<Input, Output> {}
  /** Infers the input type of a Standard. */
  type InferInput<Schema extends StandardTypedV1> = StandardTypedV1.InferInput<Schema>;
  /** Infers the output type of a Standard. */
  type InferOutput<Schema extends StandardTypedV1> = StandardTypedV1.InferOutput<Schema>;
}
//#endregion
//#region node_modules/.pnpm/@deepseek-ai+schemastery@3.18.4/node_modules/@deepseek-ai/schemastery/lib/types/index.d.ts
declare const kSchema: unique symbol;
declare global {
  namespace Schemastery {
    /** Convert primitive constructors, constants, and existing schemas into a schema type. */
    type From<X> = X extends string | number | boolean ? Schema<X> : X extends Schema<any, any, SchemaMode> ? X : X extends typeof String ? Schema<string> : X extends typeof Number ? Schema<number> : X extends typeof Boolean ? Schema<boolean> : X extends typeof Function ? Schema<Function, (...args: any[]) => any> : X extends Constructor<infer S> ? Schema<S> : never;
    type TypeS1<X> = X extends Schema<infer S, infer _T, infer _M> ? S : never;
    type Inverse<X> = X extends Schema<infer _S, infer T, infer M> ? (arg: SchemaOutput<T, M>) => void : never;
    /** Input type accepted by a schema-like value. */
    type TypeS<X> = TypeS1<From<X>>;
    /** Output type returned by a schema-like value after validation. */
    type TypeT<X> = ReturnType<From<X>>;
    /** Resolver callback used by custom schema types registered with `Schema.extend()`. */
    type Resolve = (data: any, schema: Schema, options: Options, strict?: boolean) => [any, any?];
    /** Input type accepted by one schema in an intersection. */
    type IntersectS<X> = From<X> extends Schema<infer S, infer _T, infer _M> ? S : never;
    /** Output type returned by one schema in an intersection. */
    type IntersectT<X> = Inverse<From<X>> extends ((arg: infer T) => void) ? T : never;
    type TupleS<X extends readonly any[]> = X extends readonly [infer L, ...infer R] ? [TypeS<L>?, ...TupleS<R>] : any[];
    type TupleT<X extends readonly any[]> = X extends readonly [infer L, ...infer R] ? [TypeT<L>?, ...TupleT<R>] : any[];
    type ObjectS<X extends Dict> = { [K in keyof X]?: TypeS<X[K]> | null; } & Dict;
    type ObjectT<X extends Dict> = { [K in keyof X]: TypeT<X[K]>; } & Dict;
    type Constructor<T = any> = new (...args: any[]) => T;
    /** Static constructor and factory methods exposed by the default `Schema` export. */
    interface Static {
      <T = any>(options: Partial<Schema<T>>): Schema<T>;
      new <T = any>(options: Partial<Schema<T>>): Schema<T>;
      prototype: Schema;
      /** Validate a value against a schema node and return `[output, adaptedInput?]`. */
      resolve: Resolve;
      /** Infer a schema from a primitive value, constructor, or existing schema. */
      from<X = any>(source?: X): From<X>;
      /** Register a resolver for a custom schema `type`. */
      extend(type: string, resolve: Resolve): void;
      /** Accept any value without validation. */
      any<T = any>(): Schema<T>;
      /** Accept only nullable input. */
      never(): Schema<never>;
      /** Accept exactly one constant value. */
      const<const T>(value: T): Schema<T>;
      /** Accept strings, with optional metadata constraints added by instance methods. */
      string(): Schema<string>;
      /** Accept numbers, with optional range and step constraints. */
      number(): Schema<number>;
      /** Accept non-negative integer numbers. */
      natural(): Schema<number>;
      /** Accept a number between 0 and 1 and mark it as a slider. */
      percent(): Schema<number>;
      /** Accept booleans. */
      boolean(): Schema<boolean>;
      /** Accept `Date` instances or parse datetime strings into `Date` objects. */
      date(): Schema<string | Date, Date>;
      /** Accept `RegExp` instances or parse strings into regular expressions. */
      regExp(flag?: string): Schema<string | RegExp, RegExp>;
      /** Accept binary sources and normalize them to `ArrayBufferLike`. */
      arrayBuffer(): Schema<Binary.Source, ArrayBufferLike>;
      arrayBuffer(encoding: 'hex' | 'base64'): Schema<Binary.Source | string, ArrayBufferLike>;
      /** Accept a numeric bitset or string keys and normalize to a number. */
      bitset<K extends string>(bits: Partial<Record<K, number>>): Schema<number | readonly K[], number>;
      /** Accept functions. */
      function(): Schema<Function, (...args: any[]) => any>;
      /** Accept instances of a constructor or objects whose constructor name matches. */
      is(constructor: string): Schema;
      is<T>(constructor: Constructor<T>): Schema<T>;
      /** Accept arrays whose elements match `inner`. */
      array<X>(inner: X): Schema<TypeS<X>[], TypeT<X>[]>;
      /** Accept plain objects with values matching `inner` and optional key schema. */
      dict<X, Y extends Schema<any, string> = Schema<string>>(inner: X, sKey?: Y): Schema<Dict<TypeS<X>, TypeS<Y>>, Dict<TypeT<X>, TypeT<Y>>>;
      /** Accept tuple arrays where each index matches the corresponding schema. */
      tuple<const X extends readonly any[]>(list: X): Schema<TupleS<X>, TupleT<X>>;
      /** Accept plain objects; infer fields from the dictionary, not the enclosing schema's output type. */
      object<X extends Dict>(dict: X): Schema<ObjectS<NoInfer<X>>, ObjectT<NoInfer<X>>>;
      /** Accept values matching at least one schema in `list`. */
      union<const X>(list: readonly X[]): Schema<TypeS<X>, TypeT<X>>;
      /** Accept values matching every schema in `list`, merging object outputs. */
      intersect<const X>(list: readonly X[]): Schema<IntersectS<X>, IntersectT<X>>;
      /** Validate with `inner`, then convert the result with `callback`. */
      transform<X, T>(inner: X, callback: (value: TypeS<X>, options: Schemastery.Options) => T, preserve?: boolean): Schema<TypeS<X>, T>;
      /** Defer construction of a recursive schema until validation or serialization. */
      lazy<X extends Schema<any, any, SchemaMode>>(callback: () => X): X;
      ValidationError: typeof ValidationError;
    }
    /** Runtime validation options shared by all schema calls. */
    interface Options {
      /** Remove invalid object properties instead of throwing when possible. */
      autofix?: boolean;
      /** Skip validation for selected values and schema nodes. */
      ignore?(data: any, schema: Schema): boolean;
      /** Path used to format nested validation errors. */
      path?: (keyof any)[];
    }
    /** UI and validation metadata attached by schema builder methods. */
    interface Meta<T = any> {
      default?: T extends {} ? Partial<T> : T;
      required?: boolean;
      /** Parse this node as a stable config reference; its type and UI metadata remain unchanged. */
      volatile?: boolean;
      disabled?: boolean;
      collapse?: boolean;
      badges?: {
        text: string;
        type: string;
      }[];
      hidden?: boolean;
      loose?: boolean;
      role?: string;
      extra?: any;
      link?: string;
      description?: string | Dict<string>;
      comment?: string;
      pattern?: {
        source: string;
        flags?: string;
      };
      max?: number;
      min?: number;
      step?: number;
    }
  }
  /** Callable schema instance that validates input and returns normalized output. */
  interface Schemastery<S = any, T = S, Mode extends SchemaMode = 'plain'> {
    (data?: S | null, options?: Schemastery.Options): SchemaOutput<T, Mode>;
    new (data?: S | null, options?: Schemastery.Options): SchemaOutput<T, Mode>;
    [kSchema]: true;
    uid: number;
    meta: Schemastery.Meta<T>;
    type: string;
    sKey?: Schema;
    inner?: Schema;
    list?: Schema[];
    dict?: Dict<Schema>;
    bits?: Dict<number>;
    callback?: Function;
    constructor?: string | Function;
    builder?: Function;
    value?: T;
    refs?: Dict<Schema>;
    preserve?: boolean;
    '~standard': StandardSchemaV1.Props;
    /** Format this schema as a compact TypeScript-like type string. */
    toString(inline?: boolean): string;
    /** Serialize this schema, preserving shared and recursive references. */
    toJSON(): Schema<S, T, Mode>;
    /** Mark nullable input as invalid unless a default supplies a fallback. */
    required<R extends boolean = true>(value?: R): Schema<S, T, SetRequired<Mode, R>>;
    /**
     * Parse this config field as a stable reference containing immutable data.
     * @returns a schema whose output supports get(), including when the field is absent.
     */
    volatile(): Schema<NoInfer<S>, NoInfer<T>, Mode extends 'defined' | 'volatile-defined' ? 'volatile-defined' : 'volatile'>;
    /** Hide this schema node from UI renderers. */
    hidden(value?: boolean): Schema<S, T, Mode>;
    /** Return the default value instead of throwing when validation fails. */
    loose(value?: boolean): Schema<S, T, Mode>;
    /** Attach a renderer role and optional role-specific metadata. */
    role(text: string, extra?: any): Schema<S, T, Mode>;
    /** Attach an external documentation link. */
    link(link: string): Schema<S, T, Mode>;
    /** Set the fallback value used for nullable input. */
    default(value: T | NoInfer<Partial<S>>): Schema<S, T, SetRequired<Mode, true>>;
    /** Attach an auxiliary comment for documentation or form UIs. */
    comment(text: string): Schema<S, T, Mode>;
    /** Attach a localized or plain description for documentation or form UIs. */
    description(text: string): Schema<S, T, Mode>;
    /** Mark this schema node as disabled for form UIs. */
    disabled(value?: boolean): Schema<S, T, Mode>;
    /** Request collapsed rendering for nested form UIs. */
    collapse(value?: boolean): Schema<S, T, Mode>;
    /** Add a deprecated badge to this schema node. */
    deprecated(): Schema<S, T, Mode>;
    /** Add an experimental badge to this schema node. */
    experimental(): Schema<S, T, Mode>;
    /** Require strings to match a regular expression. */
    pattern(regexp: RegExp): Schema<S, T, Mode>;
    /** Set an inclusive maximum for numbers or collection lengths. */
    max(value: number): Schema<S, T, Mode>;
    /** Set an inclusive minimum for numbers or collection lengths. */
    min(value: number): Schema<S, T, Mode>;
    /** Set the numeric increment constraint. */
    step(value: number): Schema<S, T, Mode>;
    /** Add or replace an object property schema. */
    set(key: string, value: Schema): Schema<S, T, Mode>;
    /** Append a tuple, union, or intersection member schema. */
    push(value: Schema): Schema<S, T, Mode>;
    /** Remove values equal to schema defaults from normalized output. */
    simplify(value?: any): any;
    /** Return a schema clone with descriptions merged from locale messages. */
    i18n(messages: Dict): Schema<S, T, Mode>;
    /** Attach arbitrary metadata consumed by form renderers and downstream tools. */
    extra<K extends keyof Schemastery.Meta>(key: K, value: Schemastery.Meta[K]): Schema<S, T, Mode>;
  }
}
declare class ValidationError extends TypeError {
  options: Schemastery.Options;
  name: string;
  constructor(message: string, options: Schemastery.Options);
  static is(error: any): error is ValidationError;
}
type SchemaMode = 'plain' | 'defined' | 'volatile' | 'volatile-defined';
type SchemaOutput<T, M extends SchemaMode> = M extends 'volatile' ? Volatile<T | undefined> : M extends 'volatile-defined' ? Volatile<T> : T;
type SetRequired<M extends SchemaMode, R extends boolean> = M extends 'volatile' | 'volatile-defined' ? R extends true ? 'volatile-defined' : 'volatile' : R extends true ? 'defined' : 'plain';
type Schema<S = any, T = S, Mode extends SchemaMode = 'plain'> = Schemastery<S, T, Mode>;
declare const Schema: Schemastery.Static;
//#endregion
//#region src/config.d.ts
interface DcpCompressConfig {
  enabled: boolean;
  mode: 'range';
  maxRangesPerCall: number;
  minNetSavingsTokens: number;
  retainRecentTurns: number;
  protectUserMessages: boolean;
  protectTags: boolean;
  protectedTools: string[];
  protectedSources: string[];
}
interface DcpReferencesConfig {
  transport: 'marker' | 'context-tool';
  granularity: 'turn' | 'step';
  maxAliasEntries: number;
  excerptChars: number;
}
interface DcpNudgeConfig {
  enabled: boolean;
  maxRatio: number;
  minRatio: number;
  frequencySteps: number;
  iterationThreshold: number;
}
interface DcpManualModeConfig {
  default: boolean;
  automaticStrategies: boolean;
}
interface DcpDeduplicationConfig {
  enabled: boolean;
  protectedTools: string[];
}
interface DcpPurgeErrorsConfig {
  enabled: boolean;
  turns: number;
  protectedTools: string[];
}
interface DcpStrategiesConfig {
  deduplication: DcpDeduplicationConfig;
  purgeErrors: DcpPurgeErrorsConfig;
}
interface DcpSubagentsConfig {
  enableCompressionInChild: boolean;
  readChildSession: boolean;
}
interface DcpConfig {
  enabled: boolean;
  debug: boolean;
  compress: DcpCompressConfig;
  references: DcpReferencesConfig;
  nudge: DcpNudgeConfig;
  manualMode: DcpManualModeConfig;
  strategies: DcpStrategiesConfig;
  protectedFilePatterns: string[];
  subagents: DcpSubagentsConfig;
}
declare const Config: Schema<Schemastery.ObjectS<NoInfer<{
  enabled: Schema<boolean, boolean, "defined">;
  debug: Schema<boolean, boolean, "defined">;
  compress: Schema<Schemastery.ObjectS<NoInfer<{
    enabled: Schema<boolean, boolean, "defined">;
    mode: Schema<"range", "range", "defined">;
    maxRangesPerCall: Schema<number, number, "defined">;
    minNetSavingsTokens: Schema<number, number, "defined">;
    retainRecentTurns: Schema<number, number, "defined">;
    protectUserMessages: Schema<boolean, boolean, "defined">;
    protectTags: Schema<boolean, boolean, "defined">;
    protectedTools: Schema<string[], string[], "defined">;
    protectedSources: Schema<string[], string[], "defined">;
  }>>, Schemastery.ObjectT<NoInfer<{
    enabled: Schema<boolean, boolean, "defined">;
    mode: Schema<"range", "range", "defined">;
    maxRangesPerCall: Schema<number, number, "defined">;
    minNetSavingsTokens: Schema<number, number, "defined">;
    retainRecentTurns: Schema<number, number, "defined">;
    protectUserMessages: Schema<boolean, boolean, "defined">;
    protectTags: Schema<boolean, boolean, "defined">;
    protectedTools: Schema<string[], string[], "defined">;
    protectedSources: Schema<string[], string[], "defined">;
  }>>, "defined">;
  references: Schema<Schemastery.ObjectS<NoInfer<{
    transport: Schema<"context-tool" | "marker", "context-tool" | "marker", "defined">;
    granularity: Schema<"step" | "turn", "step" | "turn", "defined">;
    maxAliasEntries: Schema<number, number, "defined">;
    excerptChars: Schema<number, number, "defined">;
  }>>, Schemastery.ObjectT<NoInfer<{
    transport: Schema<"context-tool" | "marker", "context-tool" | "marker", "defined">;
    granularity: Schema<"step" | "turn", "step" | "turn", "defined">;
    maxAliasEntries: Schema<number, number, "defined">;
    excerptChars: Schema<number, number, "defined">;
  }>>, "defined">;
  nudge: Schema<Schemastery.ObjectS<NoInfer<{
    enabled: Schema<boolean, boolean, "defined">;
    maxRatio: Schema<number, number, "defined">;
    minRatio: Schema<number, number, "defined">;
    frequencySteps: Schema<number, number, "defined">;
    iterationThreshold: Schema<number, number, "defined">;
  }>>, Schemastery.ObjectT<NoInfer<{
    enabled: Schema<boolean, boolean, "defined">;
    maxRatio: Schema<number, number, "defined">;
    minRatio: Schema<number, number, "defined">;
    frequencySteps: Schema<number, number, "defined">;
    iterationThreshold: Schema<number, number, "defined">;
  }>>, "defined">;
  manualMode: Schema<Schemastery.ObjectS<NoInfer<{
    default: Schema<boolean, boolean, "defined">;
    automaticStrategies: Schema<boolean, boolean, "defined">;
  }>>, Schemastery.ObjectT<NoInfer<{
    default: Schema<boolean, boolean, "defined">;
    automaticStrategies: Schema<boolean, boolean, "defined">;
  }>>, "defined">;
  strategies: Schema<Schemastery.ObjectS<NoInfer<{
    deduplication: Schema<Schemastery.ObjectS<NoInfer<{
      enabled: Schema<boolean, boolean, "defined">;
      protectedTools: Schema<string[], string[], "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
      enabled: Schema<boolean, boolean, "defined">;
      protectedTools: Schema<string[], string[], "defined">;
    }>>, "defined">;
    purgeErrors: Schema<Schemastery.ObjectS<NoInfer<{
      enabled: Schema<boolean, boolean, "defined">;
      turns: Schema<number, number, "defined">;
      protectedTools: Schema<string[], string[], "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
      enabled: Schema<boolean, boolean, "defined">;
      turns: Schema<number, number, "defined">;
      protectedTools: Schema<string[], string[], "defined">;
    }>>, "defined">;
  }>>, Schemastery.ObjectT<NoInfer<{
    deduplication: Schema<Schemastery.ObjectS<NoInfer<{
      enabled: Schema<boolean, boolean, "defined">;
      protectedTools: Schema<string[], string[], "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
      enabled: Schema<boolean, boolean, "defined">;
      protectedTools: Schema<string[], string[], "defined">;
    }>>, "defined">;
    purgeErrors: Schema<Schemastery.ObjectS<NoInfer<{
      enabled: Schema<boolean, boolean, "defined">;
      turns: Schema<number, number, "defined">;
      protectedTools: Schema<string[], string[], "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
      enabled: Schema<boolean, boolean, "defined">;
      turns: Schema<number, number, "defined">;
      protectedTools: Schema<string[], string[], "defined">;
    }>>, "defined">;
  }>>, "defined">;
  protectedFilePatterns: Schema<string[], string[], "defined">;
  subagents: Schema<Schemastery.ObjectS<NoInfer<{
    enableCompressionInChild: Schema<boolean, boolean, "defined">;
    readChildSession: Schema<boolean, boolean, "defined">;
  }>>, Schemastery.ObjectT<NoInfer<{
    enableCompressionInChild: Schema<boolean, boolean, "defined">;
    readChildSession: Schema<boolean, boolean, "defined">;
  }>>, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
  enabled: Schema<boolean, boolean, "defined">;
  debug: Schema<boolean, boolean, "defined">;
  compress: Schema<Schemastery.ObjectS<NoInfer<{
    enabled: Schema<boolean, boolean, "defined">;
    mode: Schema<"range", "range", "defined">;
    maxRangesPerCall: Schema<number, number, "defined">;
    minNetSavingsTokens: Schema<number, number, "defined">;
    retainRecentTurns: Schema<number, number, "defined">;
    protectUserMessages: Schema<boolean, boolean, "defined">;
    protectTags: Schema<boolean, boolean, "defined">;
    protectedTools: Schema<string[], string[], "defined">;
    protectedSources: Schema<string[], string[], "defined">;
  }>>, Schemastery.ObjectT<NoInfer<{
    enabled: Schema<boolean, boolean, "defined">;
    mode: Schema<"range", "range", "defined">;
    maxRangesPerCall: Schema<number, number, "defined">;
    minNetSavingsTokens: Schema<number, number, "defined">;
    retainRecentTurns: Schema<number, number, "defined">;
    protectUserMessages: Schema<boolean, boolean, "defined">;
    protectTags: Schema<boolean, boolean, "defined">;
    protectedTools: Schema<string[], string[], "defined">;
    protectedSources: Schema<string[], string[], "defined">;
  }>>, "defined">;
  references: Schema<Schemastery.ObjectS<NoInfer<{
    transport: Schema<"context-tool" | "marker", "context-tool" | "marker", "defined">;
    granularity: Schema<"step" | "turn", "step" | "turn", "defined">;
    maxAliasEntries: Schema<number, number, "defined">;
    excerptChars: Schema<number, number, "defined">;
  }>>, Schemastery.ObjectT<NoInfer<{
    transport: Schema<"context-tool" | "marker", "context-tool" | "marker", "defined">;
    granularity: Schema<"step" | "turn", "step" | "turn", "defined">;
    maxAliasEntries: Schema<number, number, "defined">;
    excerptChars: Schema<number, number, "defined">;
  }>>, "defined">;
  nudge: Schema<Schemastery.ObjectS<NoInfer<{
    enabled: Schema<boolean, boolean, "defined">;
    maxRatio: Schema<number, number, "defined">;
    minRatio: Schema<number, number, "defined">;
    frequencySteps: Schema<number, number, "defined">;
    iterationThreshold: Schema<number, number, "defined">;
  }>>, Schemastery.ObjectT<NoInfer<{
    enabled: Schema<boolean, boolean, "defined">;
    maxRatio: Schema<number, number, "defined">;
    minRatio: Schema<number, number, "defined">;
    frequencySteps: Schema<number, number, "defined">;
    iterationThreshold: Schema<number, number, "defined">;
  }>>, "defined">;
  manualMode: Schema<Schemastery.ObjectS<NoInfer<{
    default: Schema<boolean, boolean, "defined">;
    automaticStrategies: Schema<boolean, boolean, "defined">;
  }>>, Schemastery.ObjectT<NoInfer<{
    default: Schema<boolean, boolean, "defined">;
    automaticStrategies: Schema<boolean, boolean, "defined">;
  }>>, "defined">;
  strategies: Schema<Schemastery.ObjectS<NoInfer<{
    deduplication: Schema<Schemastery.ObjectS<NoInfer<{
      enabled: Schema<boolean, boolean, "defined">;
      protectedTools: Schema<string[], string[], "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
      enabled: Schema<boolean, boolean, "defined">;
      protectedTools: Schema<string[], string[], "defined">;
    }>>, "defined">;
    purgeErrors: Schema<Schemastery.ObjectS<NoInfer<{
      enabled: Schema<boolean, boolean, "defined">;
      turns: Schema<number, number, "defined">;
      protectedTools: Schema<string[], string[], "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
      enabled: Schema<boolean, boolean, "defined">;
      turns: Schema<number, number, "defined">;
      protectedTools: Schema<string[], string[], "defined">;
    }>>, "defined">;
  }>>, Schemastery.ObjectT<NoInfer<{
    deduplication: Schema<Schemastery.ObjectS<NoInfer<{
      enabled: Schema<boolean, boolean, "defined">;
      protectedTools: Schema<string[], string[], "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
      enabled: Schema<boolean, boolean, "defined">;
      protectedTools: Schema<string[], string[], "defined">;
    }>>, "defined">;
    purgeErrors: Schema<Schemastery.ObjectS<NoInfer<{
      enabled: Schema<boolean, boolean, "defined">;
      turns: Schema<number, number, "defined">;
      protectedTools: Schema<string[], string[], "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
      enabled: Schema<boolean, boolean, "defined">;
      turns: Schema<number, number, "defined">;
      protectedTools: Schema<string[], string[], "defined">;
    }>>, "defined">;
  }>>, "defined">;
  protectedFilePatterns: Schema<string[], string[], "defined">;
  subagents: Schema<Schemastery.ObjectS<NoInfer<{
    enableCompressionInChild: Schema<boolean, boolean, "defined">;
    readChildSession: Schema<boolean, boolean, "defined">;
  }>>, Schemastery.ObjectT<NoInfer<{
    enableCompressionInChild: Schema<boolean, boolean, "defined">;
    readChildSession: Schema<boolean, boolean, "defined">;
  }>>, "defined">;
}>>, "plain">;
//#endregion
//#region src/index.d.ts
declare const name = "dsh-dcp";
declare const inject: string[];
declare function apply(ctx: Context, config: DcpConfig): void;
//#endregion
export { Config, apply, inject, name };