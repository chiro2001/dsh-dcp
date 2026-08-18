import { defineTool } from "@deepseek-ai/dsh-tools";
import { CompactionId, isCompactCheckpointSource, toolPairingBalancedAfter, toolPairingBalancedBefore } from "@deepseek-ai/dsh-compaction";
import { deriveEventMessage, foldSurface } from "@deepseek-ai/dsh-session";
import { createUserMessage, freezeMessage } from "@deepseek-ai/dsh-llm/message";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
//#region node_modules/.pnpm/@deepseek-ai+cosmokit@1.8.2/node_modules/@deepseek-ai/cosmokit/lib/index.js
/** Return true when a value is `null` or `undefined`. */
function isNullable(value) {
	return value === null || value === void 0;
}
/** Return true for non-array object values. */
function isPlainObject$1(data) {
	return data && typeof data === "object" && !Array.isArray(data);
}
/** Filter object entries and return a new object. */
function filterKeys(object, filter) {
	return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
/** Map object values while preserving the original key set. */
function mapValues(object, transform) {
	return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
/** Pick selected keys from an object, optionally including `undefined` values. */
function pick$1(source, keys, forced) {
	if (!keys) return { ...source };
	const result = {};
	for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
	return result;
}
/** Test values using `instanceof` with a `toStringTag` fallback. */
function is(type, value) {
	if (arguments.length === 1) return (value) => is(type, value);
	return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
	return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
	return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
/** Binary source detection and base64/hex conversion helpers. */
var Binary;
(function(Binary) {
	Binary.is = isArrayBufferLike;
	Binary.isSource = isArrayBufferSource;
	function fromSource(source) {
		if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
		else return source;
	}
	Binary.fromSource = fromSource;
	function toBase64(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
		let binary = "";
		const bytes = new Uint8Array(source);
		for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
		return btoa(binary);
	}
	Binary.toBase64 = toBase64;
	function fromBase64(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
		return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
	}
	Binary.fromBase64 = fromBase64;
	function toHex(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
		return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
	}
	Binary.toHex = toHex;
	function fromHex(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
		const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
		const buffer = [];
		for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
		return Uint8Array.from(buffer).buffer;
	}
	Binary.fromHex = fromHex;
})(Binary || (Binary = {}));
Binary.fromBase64;
Binary.toBase64;
Binary.fromHex;
Binary.toHex;
/** Deep-clone common JavaScript values while preserving prototypes and cycles. */
function clone$1(source, refs = /* @__PURE__ */ new Map()) {
	if (!source || typeof source !== "object") return source;
	if (is("Date", source)) return new Date(source.valueOf());
	if (is("RegExp", source)) return new RegExp(source.source, source.flags);
	if (isArrayBufferLike(source)) return source.slice(0);
	if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
	const cached = refs.get(source);
	if (cached) return cached;
	if (Array.isArray(source)) {
		const result = [];
		refs.set(source, result);
		source.forEach((value, index) => {
			result[index] = Reflect.apply(clone$1, null, [value, refs]);
		});
		return result;
	}
	const result = Object.create(Object.getPrototypeOf(source));
	refs.set(source, result);
	for (const key of Reflect.ownKeys(source)) {
		const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
		if ("value" in descriptor) descriptor.value = Reflect.apply(clone$1, null, [descriptor.value, refs]);
		Reflect.defineProperty(result, key, descriptor);
	}
	return result;
}
/** Deeply compare arrays, dates, regexps, buffers, and plain object fields. */
function deepEqual(a, b, strict) {
	if (a === b) return true;
	if (!strict && isNullable(a) && isNullable(b)) return true;
	if (typeof a !== typeof b) return false;
	if (typeof a !== "object") return false;
	if (!a || !b) return false;
	function check(test, then) {
		return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
	}
	return check(Array.isArray, (a, b) => a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))) ?? check(is("Date"), (a, b) => a.valueOf() === b.valueOf()) ?? check(is("RegExp"), (a, b) => a.source === b.source && a.flags === b.flags) ?? check(isArrayBufferLike, (a, b) => {
		if (a.byteLength !== b.byteLength) return false;
		const viewA = new Uint8Array(a);
		const viewB = new Uint8Array(b);
		for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
		return true;
	}) ?? Object.keys({
		...a,
		...b
	}).every((key) => deepEqual(a[key], b[key], strict));
}
/** Time constants plus parsing and formatting helpers. */
var Time;
(function(Time) {
	Time.millisecond = 1;
	Time.second = 1e3;
	Time.minute = Time.second * 60;
	Time.hour = Time.minute * 60;
	Time.day = Time.hour * 24;
	Time.week = Time.day * 7;
	let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
	function setTimezoneOffset(offset) {
		timezoneOffset = offset;
	}
	Time.setTimezoneOffset = setTimezoneOffset;
	function getTimezoneOffset() {
		return timezoneOffset;
	}
	Time.getTimezoneOffset = getTimezoneOffset;
	function getDateNumber(date = /* @__PURE__ */ new Date(), offset) {
		if (typeof date === "number") date = new Date(date);
		if (offset === void 0) offset = timezoneOffset;
		return Math.floor((date.valueOf() / Time.minute - offset) / 1440);
	}
	Time.getDateNumber = getDateNumber;
	function fromDateNumber(value, offset) {
		const date = new Date(value * Time.day);
		if (offset === void 0) offset = timezoneOffset;
		return new Date(+date + offset * Time.minute);
	}
	Time.fromDateNumber = fromDateNumber;
	const numeric = /\d+(?:\.\d+)?/.source;
	const timeRegExp = new RegExp(`^${[
		"w(?:eek(?:s)?)?",
		"d(?:ay(?:s)?)?",
		"h(?:our(?:s)?)?",
		"m(?:in(?:ute)?(?:s)?)?",
		"s(?:ec(?:ond)?(?:s)?)?"
	].map((unit) => `(${numeric}${unit})?`).join("")}$`);
	function parseTime(source) {
		const capture = timeRegExp.exec(source);
		if (!capture) return 0;
		return (parseFloat(capture[1]) * Time.week || 0) + (parseFloat(capture[2]) * Time.day || 0) + (parseFloat(capture[3]) * Time.hour || 0) + (parseFloat(capture[4]) * Time.minute || 0) + (parseFloat(capture[5]) * Time.second || 0);
	}
	Time.parseTime = parseTime;
	function parseDate(date) {
		const parsed = parseTime(date);
		if (parsed) date = Date.now() + parsed;
		else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
		else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
		return date ? new Date(date) : /* @__PURE__ */ new Date();
	}
	Time.parseDate = parseDate;
	function format(ms) {
		const abs = Math.abs(ms);
		if (abs >= Time.day - Time.hour / 2) return Math.round(ms / Time.day) + "d";
		else if (abs >= Time.hour - Time.minute / 2) return Math.round(ms / Time.hour) + "h";
		else if (abs >= Time.minute - Time.second / 2) return Math.round(ms / Time.minute) + "m";
		else if (abs >= Time.second) return Math.round(ms / Time.second) + "s";
		return ms + "ms";
	}
	Time.format = format;
	function toDigits(source, length = 2) {
		return source.toString().padStart(length, "0");
	}
	Time.toDigits = toDigits;
	function template(template, time = /* @__PURE__ */ new Date()) {
		return template.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
	}
	Time.template = template;
})(Time || (Time = {}));
//#endregion
//#region node_modules/.pnpm/@deepseek-ai+schemastery@3.18.1/node_modules/@deepseek-ai/schemastery/lib/index.mjs
const kSchema = Symbol.for("schemastery");
const kValidationError = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
	options;
	name = "ValidationError";
	constructor(message, options) {
		let prefix = "$";
		for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
		else if (typeof segment === "number") prefix += "[" + segment + "]";
		else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
		if (prefix.startsWith(".")) prefix = prefix.slice(1);
		super((prefix === "$" ? "" : `${prefix} `) + message);
		this.options = options;
	}
	static is(error) {
		return !!error?.[kValidationError];
	}
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
const Schema = function(options) {
	const schema = function(data, options = {}) {
		return Schema.resolve(data, schema, options)[0];
	};
	if (options.refs) {
		const refs = mapValues(options.refs, (options) => new Schema(options));
		const getRef = (uid) => refs[uid];
		for (const key in refs) {
			const options = refs[key];
			options.sKey = getRef(options.sKey);
			options.inner = getRef(options.inner);
			options.list = options.list && options.list.map(getRef);
			options.dict = options.dict && mapValues(options.dict, getRef);
		}
		return refs[options.uid];
	}
	Object.assign(schema, options);
	if (typeof schema.callback === "string") try {
		schema.callback = new Function("return " + schema.callback)();
	} catch {}
	Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
	Object.setPrototypeOf(schema, Schema.prototype);
	schema.meta ||= {};
	schema.toString = schema.toString.bind(schema);
	return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
	return {
		version: 1,
		vendor: "schemastery",
		validate: (value) => {
			try {
				return { value: Schema.resolve(value, this, {})[0] };
			} catch (error) {
				if (ValidationError.is(error)) return { issues: [{
					message: error.message,
					path: error.options.path
				}] };
				throw error;
			}
		}
	};
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
	if (globalThis.__schemastery_refs__) {
		globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
		return this.uid;
	}
	globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
	globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
	const result = {
		uid: this.uid,
		refs: globalThis.__schemastery_refs__
	};
	globalThis.__schemastery_refs__ = void 0;
	return result;
};
Schema.prototype.set = function set(key, value) {
	this.dict[key] = value;
	return this;
};
Schema.prototype.push = function push(value) {
	this.list.push(value);
	return this;
};
function mergeDesc(original, messages) {
	const result = typeof original === "string" ? { "": original } : { ...original };
	for (const locale in messages) {
		const value = messages[locale];
		if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
		else if (typeof value === "string") result[locale] = value;
	}
	return result;
}
function getInner(value) {
	return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
	return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
	const schema = Schema(this);
	const desc = mergeDesc(schema.meta.description, messages);
	if (Object.keys(desc).length) schema.meta.description = desc;
	if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
		return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
	});
	if (schema.list) schema.list = schema.list.map((inner, index) => {
		return inner.i18n(mapValues(messages, (data = {}) => {
			if (Array.isArray(getInner(data))) return getInner(data)[index];
			if (Array.isArray(data)) return data[index];
			return extractKeys(data);
		}));
	});
	if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
		if (getInner(data)) return getInner(data);
		return extractKeys(data);
	}));
	if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
	return schema;
};
Schema.prototype.extra = function extra(key, value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
};
for (const key of [
	"required",
	"disabled",
	"collapse",
	"hidden",
	"loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
Schema.prototype.deprecated = function deprecated() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "deprecated",
		type: "danger"
	});
	return schema;
};
Schema.prototype.experimental = function experimental() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "experimental",
		type: "warning"
	});
	return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
	const schema = Schema(this);
	const pattern = pick$1(regexp, ["source", "flags"]);
	schema.meta = {
		...schema.meta,
		pattern
	};
	return schema;
};
Schema.prototype.simplify = function simplify(value) {
	if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
	if (isNullable(value)) return value;
	if (this.type === "object" || this.type === "dict") {
		const result = {};
		for (const key in value) {
			const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
			if (this.type === "dict" || !isNullable(item)) result[key] = item;
		}
		if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
		return result;
	} else if (this.type === "array" || this.type === "tuple") {
		const result = [];
		value.forEach((value, index) => {
			const schema = this.type === "array" ? this.inner : this.list[index];
			const item = schema ? schema.simplify(value) : value;
			result.push(item);
		});
		return result;
	} else if (this.type === "intersect") {
		const result = {};
		for (const item of this.list) Object.assign(result, item.simplify(value));
		return result;
	} else if (this.type === "union") for (const schema of this.list) try {
		Schema.resolve(value, schema, {});
		return schema.simplify(value);
	} catch {}
	return value;
};
Schema.prototype.toString = function toString(inline) {
	return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		role,
		extra
	};
	return schema;
};
for (const key of [
	"default",
	"link",
	"comment",
	"description",
	"max",
	"min",
	"step"
]) Object.assign(Schema.prototype, { [key](value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
const resolvers = {};
Schema.extend = function extend(type, resolve) {
	resolvers[type] = resolve;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
	if (!schema) return [data];
	if (options.ignore?.(data, schema)) return [data];
	if (isNullable(data) && schema.type !== "lazy") {
		if (schema.meta.required) throw new ValidationError(`missing required value`, options);
		let current = schema;
		let fallback = schema.meta.default;
		while (current?.type === "intersect" && isNullable(fallback)) {
			current = current.list[0];
			fallback = current?.meta.default;
		}
		if (isNullable(fallback)) return [data];
		data = clone$1(fallback);
	}
	const callback = resolvers[schema.type];
	if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
	try {
		return callback(data, schema, options, strict);
	} catch (error) {
		if (!schema.meta.loose) throw error;
		return [schema.meta.default];
	}
};
Schema.from = function from(source) {
	if (isNullable(source)) return Schema.any();
	else if ([
		"string",
		"number",
		"boolean"
	].includes(typeof source)) return Schema.const(source).required();
	else if (source[kSchema]) return source;
	else if (typeof source === "function") switch (source) {
		case String: return Schema.string().required();
		case Number: return Schema.number().required();
		case Boolean: return Schema.boolean().required();
		case Function: return Schema.function().required();
		default: return Schema.is(source).required();
	}
	else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
	const toJSON = () => {
		if (!schema.inner[kSchema]) {
			schema.inner = schema.builder();
			schema.inner.meta = {
				...schema.meta,
				...schema.inner.meta
			};
		}
		return schema.inner.toJSON();
	};
	const schema = new Schema({
		type: "lazy",
		builder,
		inner: { toJSON }
	});
	return schema;
};
Schema.natural = function natural() {
	return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
	return Schema.number().step(.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
	return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
		const date = new Date(value);
		if (isNaN(+date)) throw new ValidationError(`invalid date "${value}"`, options);
		return date;
	}, true)]);
};
Schema.regExp = function regExp(flag = "") {
	return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
		try {
			return new RegExp(value, flag);
		} catch (e) {
			throw new ValidationError(e.message, options);
		}
	}, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
	return Schema.union([
		Schema.is(ArrayBuffer),
		Schema.is(SharedArrayBuffer),
		Schema.transform(Schema.any(), (value, options) => {
			if (Binary.isSource(value)) return Binary.fromSource(value);
			throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
		}, true),
		...encoding ? [Schema.transform(Schema.string(), (value, options) => {
			try {
				return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
			} catch (e) {
				throw new ValidationError(e.message, options);
			}
		}, true)] : []
	]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
	if (!schema.inner[kSchema]) {
		schema.inner = schema.builder();
		schema.inner.meta = {
			...schema.meta,
			...schema.inner.meta
		};
	}
	return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
	return [data];
});
Schema.extend("never", (data, _, options) => {
	throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
	if (deepEqual(data, value)) return [value];
	throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
	const { max = Infinity, min = -Infinity } = meta;
	if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
	if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
	if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
	if (meta.pattern) {
		const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
		if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
	}
	checkWithinRange(data.length, meta, "string length", options);
	return [data];
});
function decimalShift(data, digits) {
	const str = data.toString();
	if (str.includes("e")) return data * Math.pow(10, digits);
	const index = str.indexOf(".");
	if (index === -1) return data * Math.pow(10, digits);
	const frac = str.slice(index + 1);
	const integer = str.slice(0, index);
	if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
	return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
	step = Math.abs(step);
	if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
	const index = step.toString().indexOf(".");
	const digits = step.toString().slice(index + 1).length;
	return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
	if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
	checkWithinRange(data, meta, "number", options);
	const { step } = meta;
	if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
	return [data];
});
Schema.extend("boolean", (data, _, options) => {
	if (typeof data === "boolean") return [data];
	throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
	let value = 0, keys = [];
	if (typeof data === "number") {
		value = data;
		for (const key in bits) if (data & bits[key]) keys.push(key);
	} else if (Array.isArray(data)) {
		keys = data;
		for (const key of keys) {
			if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
			if (key in bits) value |= bits[key];
		}
	} else throw new ValidationError(`expected number or array but got ${data}`, options);
	if (value === meta.default) return [value];
	return [value, keys];
});
Schema.extend("function", (data, _, options) => {
	if (typeof data === "function") return [data];
	throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
	if (typeof constructor === "function") {
		if (data instanceof constructor) return [data];
		throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
	} else {
		if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
		let prototype = Object.getPrototypeOf(data);
		while (prototype) {
			if (prototype.constructor?.name === constructor) return [data];
			prototype = Object.getPrototypeOf(prototype);
		}
		throw new ValidationError(`expected ${constructor} but got ${data}`, options);
	}
});
function property(data, key, schema, options) {
	try {
		const [value, adapted] = Schema.resolve(data[key], schema, {
			...options,
			path: [...options.path || [], key]
		});
		if (adapted !== void 0) data[key] = adapted;
		return value;
	} catch (e) {
		if (!options?.autofix) throw e;
		delete data[key];
		return schema.meta.default;
	}
}
Schema.extend("array", (data, { inner, meta }, options) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
	return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
	if (!isPlainObject$1(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in data) {
		let rKey;
		try {
			rKey = Schema.resolve(key, sKey, options)[0];
		} catch (error) {
			if (strict) continue;
			throw error;
		}
		result[rKey] = property(data, key, inner, options);
		data[rKey] = data[key];
		if (key !== rKey) delete data[key];
	}
	return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	const result = list.map((inner, index) => property(data, index, inner, options));
	if (strict) return [result];
	result.push(...data.slice(list.length));
	return [result];
});
function merge$1(result, data) {
	for (const key in data) {
		if (key in result) continue;
		result[key] = data[key];
	}
}
Schema.extend("object", (data, { dict }, options, strict) => {
	if (!isPlainObject$1(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in dict) {
		const value = property(data, key, dict[key], options);
		if (!isNullable(value) || key in data) result[key] = value;
	}
	if (!strict) merge$1(result, data);
	return [result];
});
Schema.extend("union", (data, { list, toString }, options, strict) => {
	const messages = [];
	for (const inner of list) try {
		return Schema.resolve(data, inner, options, strict);
	} catch (error) {
		messages.push(error);
	}
	throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString }, options, strict) => {
	if (!list.length) return [data];
	let result;
	for (const inner of list) {
		const value = Schema.resolve(data, inner, options, true)[0];
		if (isNullable(value)) continue;
		if (isNullable(result)) result = value;
		else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
		else if (typeof value === "object") merge$1(result ??= {}, value);
		else if (result !== value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
	}
	if (!strict && isPlainObject$1(data)) merge$1(result, data);
	return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
	const [result, adapted = data] = Schema.resolve(data, inner, options, true);
	if (preserve) return [callback(result)];
	else return [callback(result), callback(adapted)];
});
const formatters = {};
function defineMethod(name, keys, format) {
	formatters[name] = format;
	Object.assign(Schema, { [name](...args) {
		const schema = new Schema({ type: name });
		keys.forEach((key, index) => {
			switch (key) {
				case "sKey":
					schema.sKey = args[index] ?? Schema.string();
					break;
				case "inner":
					schema.inner = Schema.from(args[index]);
					break;
				case "list":
					schema.list = args[index].map(Schema.from);
					break;
				case "dict":
					schema.dict = mapValues(args[index], Schema.from);
					break;
				case "bits":
					schema.bits = {};
					for (const key in args[index]) {
						if (typeof args[index][key] !== "number") continue;
						schema.bits[key] = args[index][key];
					}
					break;
				case "callback": {
					const callback = schema.callback = args[index];
					callback["toJSON"] ||= () => callback.toString();
					break;
				}
				case "constructor": {
					const constructor = schema.constructor = args[index];
					if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
					break;
				}
				default: schema[key] = args[index];
			}
		});
		if (name === "object" || name === "dict") schema.meta.default = {};
		else if (name === "array" || name === "tuple") schema.meta.default = [];
		else if (name === "bitset") schema.meta.default = 0;
		return schema;
	} });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
	if (typeof constructor === "function") return constructor.name;
	else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
	if (Object.keys(dict).length === 0) return "{}";
	return `{ ${Object.entries(dict).map(([key, inner]) => {
		return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
	}).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
	const result = list.map(({ toString: format }) => format()).join(" | ");
	return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
	return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
	"inner",
	"callback",
	"preserve"
], ({ inner }, isInner) => inner.toString(isInner));
//#endregion
//#region src/config.ts
/**
* dsh-dcp v0.1 configuration: schema, defaults, and validation.
*
* @module dsh-dcp/config
*/
const DCP_CONFIG_DEFAULTS = {
	enabled: true,
	debug: false,
	compress: {
		enabled: true,
		mode: "range",
		maxRangesPerCall: 3,
		minNetSavingsTokens: 256,
		retainRecentTurns: 2,
		protectUserMessages: false,
		protectTags: true,
		protectedTools: [
			"subagent",
			"skill",
			"todo_write"
		],
		protectedSources: ["subagent-report", "subagent-settled"]
	},
	references: {
		transport: "marker",
		maxAliasEntries: 32,
		excerptChars: 80
	},
	nudge: {
		enabled: true,
		maxRatio: .8,
		minRatio: .6,
		frequencySteps: 8,
		iterationThreshold: 12
	},
	manualMode: {
		default: false,
		automaticStrategies: true
	},
	strategies: {
		deduplication: {
			enabled: true,
			protectedTools: []
		},
		purgeErrors: {
			enabled: false,
			turns: 4,
			protectedTools: []
		}
	},
	protectedFilePatterns: [],
	subagents: {
		enableCompressionInChild: false,
		readChildSession: false
	}
};
const positiveInt = Schema.number().step(1).min(1);
const stringArray = Schema.array(Schema.string()).max(64);
const Config = Schema.object({
	enabled: Schema.boolean().default(DCP_CONFIG_DEFAULTS.enabled),
	debug: Schema.boolean().default(DCP_CONFIG_DEFAULTS.debug),
	compress: Schema.object({
		enabled: Schema.boolean().default(DCP_CONFIG_DEFAULTS.compress.enabled),
		mode: Schema.union([Schema.const("range")]).default(DCP_CONFIG_DEFAULTS.compress.mode),
		maxRangesPerCall: positiveInt.default(DCP_CONFIG_DEFAULTS.compress.maxRangesPerCall),
		minNetSavingsTokens: positiveInt.default(DCP_CONFIG_DEFAULTS.compress.minNetSavingsTokens),
		retainRecentTurns: positiveInt.default(DCP_CONFIG_DEFAULTS.compress.retainRecentTurns),
		protectUserMessages: Schema.boolean().default(DCP_CONFIG_DEFAULTS.compress.protectUserMessages),
		protectTags: Schema.boolean().default(DCP_CONFIG_DEFAULTS.compress.protectTags),
		protectedTools: stringArray.default(DCP_CONFIG_DEFAULTS.compress.protectedTools),
		protectedSources: stringArray.default(DCP_CONFIG_DEFAULTS.compress.protectedSources)
	}).default(DCP_CONFIG_DEFAULTS.compress),
	references: Schema.object({
		transport: Schema.union([Schema.const("marker"), Schema.const("context-tool")]).default(DCP_CONFIG_DEFAULTS.references.transport),
		maxAliasEntries: positiveInt.default(DCP_CONFIG_DEFAULTS.references.maxAliasEntries),
		excerptChars: positiveInt.default(DCP_CONFIG_DEFAULTS.references.excerptChars)
	}).default(DCP_CONFIG_DEFAULTS.references),
	nudge: Schema.object({
		enabled: Schema.boolean().default(DCP_CONFIG_DEFAULTS.nudge.enabled),
		maxRatio: Schema.number().min(0).max(1).default(DCP_CONFIG_DEFAULTS.nudge.maxRatio),
		minRatio: Schema.number().min(0).max(1).default(DCP_CONFIG_DEFAULTS.nudge.minRatio),
		frequencySteps: positiveInt.default(DCP_CONFIG_DEFAULTS.nudge.frequencySteps),
		iterationThreshold: positiveInt.default(DCP_CONFIG_DEFAULTS.nudge.iterationThreshold)
	}).default(DCP_CONFIG_DEFAULTS.nudge),
	manualMode: Schema.object({
		default: Schema.boolean().default(DCP_CONFIG_DEFAULTS.manualMode.default),
		automaticStrategies: Schema.boolean().default(DCP_CONFIG_DEFAULTS.manualMode.automaticStrategies)
	}).default(DCP_CONFIG_DEFAULTS.manualMode),
	strategies: Schema.object({
		deduplication: Schema.object({
			enabled: Schema.boolean().default(DCP_CONFIG_DEFAULTS.strategies.deduplication.enabled),
			protectedTools: stringArray.default(DCP_CONFIG_DEFAULTS.strategies.deduplication.protectedTools)
		}).default(DCP_CONFIG_DEFAULTS.strategies.deduplication),
		purgeErrors: Schema.object({
			enabled: Schema.boolean().default(DCP_CONFIG_DEFAULTS.strategies.purgeErrors.enabled),
			turns: positiveInt.default(DCP_CONFIG_DEFAULTS.strategies.purgeErrors.turns),
			protectedTools: stringArray.default(DCP_CONFIG_DEFAULTS.strategies.purgeErrors.protectedTools)
		}).default(DCP_CONFIG_DEFAULTS.strategies.purgeErrors)
	}).default(DCP_CONFIG_DEFAULTS.strategies),
	protectedFilePatterns: stringArray.default(DCP_CONFIG_DEFAULTS.protectedFilePatterns),
	subagents: Schema.object({
		enableCompressionInChild: Schema.boolean().default(DCP_CONFIG_DEFAULTS.subagents.enableCompressionInChild),
		readChildSession: Schema.boolean().default(DCP_CONFIG_DEFAULTS.subagents.readChildSession)
	}).default(DCP_CONFIG_DEFAULTS.subagents)
});
/** Resolve user input through the schema and enforce cross-field constraints. */
function resolveConfig(input) {
	const resolved = Config(input);
	if (resolved.nudge.minRatio >= resolved.nudge.maxRatio) throw new Error("dcp config: nudge.minRatio must be strictly below nudge.maxRatio");
	if (resolved.compress.minNetSavingsTokens <= 0) throw new Error("dcp config: compress.minNetSavingsTokens must be positive");
	const raw = input ?? {};
	const references = raw.references;
	if (references?.transport !== void 0 && references.transport !== "marker") throw new Error("dcp config: references.transport only supports \"marker\" in v0.1");
	const subagents = raw.subagents;
	if (subagents?.enableCompressionInChild === true || subagents?.readChildSession === true) throw new Error("dcp config: subagents.enableCompressionInChild/readChildSession are unsupported in v0.1");
	return resolved;
}
const VALID_KEYS = /* @__PURE__ */ new Set([
	"enabled",
	"debug",
	"compress",
	"compress.enabled",
	"compress.mode",
	"compress.maxRangesPerCall",
	"compress.minNetSavingsTokens",
	"compress.retainRecentTurns",
	"compress.protectUserMessages",
	"compress.protectTags",
	"compress.protectedTools",
	"compress.protectedSources",
	"references",
	"references.transport",
	"references.maxAliasEntries",
	"references.excerptChars",
	"nudge",
	"nudge.enabled",
	"nudge.maxRatio",
	"nudge.minRatio",
	"nudge.frequencySteps",
	"nudge.iterationThreshold",
	"manualMode",
	"manualMode.default",
	"manualMode.automaticStrategies",
	"strategies",
	"strategies.deduplication",
	"strategies.deduplication.enabled",
	"strategies.deduplication.protectedTools",
	"strategies.purgeErrors",
	"strategies.purgeErrors.enabled",
	"strategies.purgeErrors.turns",
	"strategies.purgeErrors.protectedTools",
	"protectedFilePatterns",
	"subagents",
	"subagents.enableCompressionInChild",
	"subagents.readChildSession"
]);
function collectKeyPaths(value, prefix = "") {
	const keys = [];
	for (const key of Object.keys(value)) {
		const full = prefix ? `${prefix}.${key}` : key;
		keys.push(full);
		const child = value[key];
		if (child !== null && typeof child === "object" && !Array.isArray(child)) keys.push(...collectKeyPaths(child, full));
	}
	return keys;
}
/** Unknown-key validation for human-authored config documents. */
function unknownConfigKeys(input) {
	return collectKeyPaths(input).filter((key) => !VALID_KEYS.has(key));
}
//#endregion
//#region src/prompts/system.ts
const DCP_GUIDANCE_SECTION = "dcp:guidance";
function renderDcpGuidance(config, manualMode) {
	const lines = [
		"## Dynamic Context Pruning (DCP)",
		"",
		"You may compress closed, completed conversation ranges with the `compress` tool when they are no longer needed verbatim. This frees context for continuing work.",
		"",
		"- Ranges are half-open: `startRef` is included, `endRef` is excluded.",
		"- Only choose ranges that are closed and do not cut an in-flight tool call/result pair.",
		"- Do not compress the current turn, active tool work, protected user instructions, or protected tool outputs.",
		"- Protected content may be appended verbatim after your summary; do not omit it.",
		"- Each completed compression replaces the range with a summary checkpoint marked `<dcp-message-id>bN</dcp-message-id>`.",
		"- If a range is invalid (stale, overlapping, protected, or cuts an open tool pair), retry with a current, closed, safer range.",
		"- If a range is valid but saves too few tokens, do not retry the same small range: choose a LARGER older closed range or write a more compact high-fidelity summary; otherwise leave it uncompressed."
	];
	if (manualMode) lines.push("", "Manual mode is active: do not call `compress` unless explicitly triggered by `/dcp compress`.");
	if (!config.compress.enabled) lines.push("", "Compression is disabled by configuration; do not call `compress`.");
	return lines.join("\n");
}
const BLOCK_REF$1 = /^b([1-9]\d*)$/;
function isBlockRef(value) {
	return typeof value === "string" && BLOCK_REF$1.test(value);
}
function isStringArray(value) {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
function encodeDcpCheckpointSource(compactionId, meta) {
	return {
		kind: "plugin",
		plugin: "compact",
		compactionId,
		dcp: { ...meta }
	};
}
function decodeDcpMeta(source) {
	if (source === null || typeof source !== "object" || Array.isArray(source) || !isCompactCheckpointSource(source)) return {
		ok: false,
		diagnostic: {
			code: "NOT_COMPACT_SOURCE",
			message: "source is not a compaction checkpoint"
		}
	};
	const dcp = source.dcp;
	if (dcp === null || typeof dcp !== "object" || Array.isArray(dcp)) return {
		ok: false,
		diagnostic: {
			code: "MISSING_DCP_META",
			message: "checkpoint source lacks dcp metadata"
		}
	};
	const meta = dcp;
	if (meta.v !== 1) return {
		ok: false,
		diagnostic: {
			code: "UNSUPPORTED_VERSION",
			message: `dcp metadata version ${String(meta.v)} is not supported (expected 1)`
		}
	};
	if (meta.kind !== "summary" && meta.kind !== "expansion") return {
		ok: false,
		diagnostic: {
			code: "INVALID_KIND",
			message: `invalid dcp kind ${String(meta.kind)}`
		}
	};
	if (!isBlockRef(meta.blockRef)) return {
		ok: false,
		diagnostic: {
			code: "INVALID_BLOCK_REF",
			message: "dcp blockRef must be b<positive integer>"
		}
	};
	if (meta.mode !== "range" && meta.mode !== "message") return {
		ok: false,
		diagnostic: {
			code: "INVALID_MODE",
			message: `invalid dcp mode ${String(meta.mode)}`
		}
	};
	if (typeof meta.topic !== "string" || meta.topic.length === 0 || meta.topic.length > 200) return {
		ok: false,
		diagnostic: {
			code: "INVALID_TOPIC",
			message: "dcp topic must be a non-empty string <= 200 chars"
		}
	};
	if (typeof meta.startRef !== "string" || meta.startRef.length === 0 || meta.startRef.length > 32) return {
		ok: false,
		diagnostic: {
			code: "INVALID_START_REF",
			message: "dcp startRef must be a non-empty string"
		}
	};
	if (meta.endRef !== void 0 && (typeof meta.endRef !== "string" || meta.endRef.length === 0)) return {
		ok: false,
		diagnostic: {
			code: "INVALID_END_REF",
			message: "dcp endRef must be a non-empty string"
		}
	};
	if (typeof meta.authorMessageId !== "string" || meta.authorMessageId.length === 0) return {
		ok: false,
		diagnostic: {
			code: "INVALID_AUTHOR",
			message: "dcp authorMessageId must be a non-empty string"
		}
	};
	if (typeof meta.compressCallId !== "string" || meta.compressCallId.length === 0) return {
		ok: false,
		diagnostic: {
			code: "INVALID_CALL",
			message: "dcp compressCallId must be a non-empty string"
		}
	};
	if (!isStringArray(meta.consumedBlockRefs) || !meta.consumedBlockRefs.every(isBlockRef)) return {
		ok: false,
		diagnostic: {
			code: "INVALID_CONSUMED",
			message: "dcp consumedBlockRefs must be an array of b<id>"
		}
	};
	if (!isStringArray(meta.protectedKinds)) return {
		ok: false,
		diagnostic: {
			code: "INVALID_PROTECTED",
			message: "dcp protectedKinds must be a string array"
		}
	};
	if (meta.recompressedFrom !== void 0 && !isBlockRef(meta.recompressedFrom)) return {
		ok: false,
		diagnostic: {
			code: "INVALID_RECOMPRESSED",
			message: "dcp recompressedFrom must be b<id>"
		}
	};
	return {
		ok: true,
		meta: {
			v: 1,
			kind: meta.kind,
			blockRef: meta.blockRef,
			mode: meta.mode,
			topic: meta.topic,
			startRef: meta.startRef,
			...meta.endRef === void 0 ? {} : { endRef: meta.endRef },
			authorMessageId: meta.authorMessageId,
			compressCallId: meta.compressCallId,
			consumedBlockRefs: [...meta.consumedBlockRefs],
			protectedKinds: [...meta.protectedKinds],
			...meta.recompressedFrom === void 0 ? {} : { recompressedFrom: meta.recompressedFrom }
		}
	};
}
//#endregion
//#region src/refs/marker.ts
const ALIAS_RE = /^alias (m\d+)=s(\d+)$/;
function buildBoundaryMarker(ref, turn, step) {
	return `<dcp-boundary ref="${ref}" turn="${turn}" step="${step}" />`;
}
function buildAlias(ref, targetId) {
	return `alias ${ref}=s${targetId}`;
}
/** Logged step-entry marker message (protocol v1, candidate B). */
function buildStepMarkerMessage(ref, turn, step, nudgeText, extraText) {
	const text = [
		buildBoundaryMarker(ref, turn, step),
		nudgeText,
		extraText
	].filter(Boolean).join("\n");
	return createUserMessage({
		content: [{
			type: "text",
			text
		}],
		source: {
			kind: "plugin",
			plugin: "dsh-dcp"
		}
	});
}
function parseAlias(text) {
	const match = ALIAS_RE.exec(text.trim());
	if (!match) return void 0;
	return {
		ref: match[1],
		targetId: match[2]
	};
}
//#endregion
//#region src/protocol/replacements.ts
/**
* Replacement DAG and block-membership reconciliation over the session log.
*
* @module dsh-dcp/protocol/replacements
*/
/** Current block membership derived from surface membership + replacement DAG. */
function reconcileBlockMembership(events) {
	const result = /* @__PURE__ */ new Map();
	const surface = new Set(foldSurface(events).nodes);
	const blocks = [];
	for (const event of events) {
		if (event.type !== "user/message") continue;
		const decoded = decodeDcpMeta(event.data.source);
		if (!decoded.ok) continue;
		blocks.push({
			ref: decoded.meta.blockRef,
			seq: event.seq
		});
		result.set(decoded.meta.blockRef, surface.has(event.seq) ? "active" : "consumed");
	}
	for (const event of events) {
		if (event.type !== "user/message" || event.surfaceOp === "append") continue;
		const decoded = decodeDcpMeta(event.data.source);
		const shadowed = new Set(event.sourceEventSeqs ?? []);
		for (const block of blocks) {
			if (!shadowed.has(block.seq)) continue;
			if (decoded.ok && decoded.meta.kind === "expansion") result.set(block.ref, "expanded");
			else if (!decoded.ok) result.set(block.ref, "absorbed-native");
			else result.set(block.ref, "consumed");
		}
	}
	return result;
}
/** Single-node tool-result rewrites: original seq -> replacement seq. */
function foldPruneReplacements(events) {
	const result = /* @__PURE__ */ new Map();
	for (const event of events) {
		if (event.type !== "tool/result" || event.surfaceOp === "append") continue;
		const sources = event.sourceEventSeqs ?? [];
		if (sources.length === 1) result.set(sources[0], event.seq);
	}
	return result;
}
//#endregion
//#region src/protocol/replay.ts
/**
* Deterministic DCP state replay over the session log (cold + incremental).
*
* @module dsh-dcp/protocol/replay
*/
const BOUNDARY_MARKER = /<dcp-boundary ref="(m\d+)"[^>]*\/>/g;
const BLOCK_REF = /^b([1-9]\d*)$/;
const MESSAGE_REF = /^m(\d+)$/;
function emptyDcpState() {
	return {
		protocolVersion: 1,
		log: [],
		blocks: [],
		activeBlockRefs: [],
		boundaryRefs: [],
		aliases: [],
		pruneReplacements: /* @__PURE__ */ new Map(),
		diagnostics: [],
		maxBlockNumber: 0,
		maxMarkerNumber: 0,
		manualMode: false
	};
}
/** Canonical cold replay: fold the complete log once. */
function reduceDcpState(events, manualDefault = false) {
	const state = emptyDcpState();
	state.log = [...events];
	state.manualMode = manualDefault;
	const surface = foldSurface(events);
	const surfaceSeqs = new Set(surface.nodes);
	const membership = reconcileBlockMembership(events);
	const aliasCandidates = [];
	for (const event of events) {
		if (event.type !== "user/message") continue;
		const decoded = decodeDcpMeta(event.data.source);
		if (decoded.ok) {
			const record = {
				ref: decoded.meta.blockRef,
				seq: event.seq,
				meta: decoded.meta,
				membership: membership.get(decoded.meta.blockRef) ?? "active"
			};
			state.blocks.push(record);
			if (record.membership === "active") state.activeBlockRefs.push(record.ref);
			const blockNumber = Number(BLOCK_REF.exec(decoded.meta.blockRef)?.[1] ?? 0);
			state.maxBlockNumber = Math.max(state.maxBlockNumber, blockNumber);
			state.boundaryRefs.push({
				ref: decoded.meta.blockRef,
				seq: event.seq,
				active: membership.get(decoded.meta.blockRef) === "active"
			});
		} else if (isCompactCheckpointSource(event.data.source)) state.diagnostics.push({
			...decoded.diagnostic,
			seq: event.seq
		});
		if (event.data.source.plugin === "dsh-dcp") {
			const text = event.data.content.filter((block) => block.type === "text").map((block) => block.type === "text" ? block.text : "").join("\n");
			for (const match of event.data.content[0]?.type === "text" ? event.data.content[0].text.matchAll(BOUNDARY_MARKER) : []) {
				const ref = match[1];
				state.boundaryRefs.push({
					ref,
					seq: event.seq,
					active: surfaceSeqs.has(event.seq)
				});
				const markerNumber = Number(MESSAGE_REF.exec(ref)?.[1] ?? 0);
				state.maxMarkerNumber = Math.max(state.maxMarkerNumber, markerNumber);
			}
			for (const line of text.split("\n")) {
				const alias = parseAlias(line);
				if (alias) aliasCandidates.push({
					ref: alias.ref,
					seq: Number(alias.targetId)
				});
			}
		}
	}
	for (const alias of aliasCandidates) if (events[alias.seq] !== void 0) state.aliases.push(alias);
	state.pruneReplacements = foldPruneReplacements(events);
	const pendingCommands = /* @__PURE__ */ new Map();
	for (const event of events) {
		if (event.type === "command/run") {
			if (event.data.name === "dcp" && event.data.args !== void 0) pendingCommands.set(String(event.data.commandId), event.data.args.trim());
		}
		if (event.type === "command/done") {
			const args = pendingCommands.get(String(event.data.commandId));
			if (event.data.kind === "success" && args !== void 0) {
				if (args === "manual on") state.manualMode = true;
				if (args === "manual off") state.manualMode = false;
			}
			pendingCommands.delete(String(event.data.commandId));
		}
	}
	return state;
}
//#endregion
//#region src/compress/schema.ts
function validateCompressArgs(args, maxRanges) {
	const errors = [];
	if (args === null || typeof args !== "object" || Array.isArray(args)) return ["compress arguments must be an object"];
	const record = args;
	if (typeof record.topic !== "string" || record.topic.length === 0) errors.push("topic must be a non-empty string");
	else if (record.topic.length > 200) errors.push("topic must be at most 200 characters");
	if (!Array.isArray(record.content) || record.content.length === 0) {
		errors.push("content must be a non-empty array");
		return errors;
	}
	if (record.content.length > maxRanges) errors.push(`content accepts at most ${maxRanges} range(s)`);
	for (const [index, entry] of record.content.entries()) {
		if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
			errors.push(`content[${index}] must be an object`);
			continue;
		}
		const range = entry;
		if (typeof range.startRef !== "string" || range.startRef.length === 0 || range.startRef.length > 32) errors.push(`content[${index}].startRef must be a non-empty string (<= 32 chars)`);
		if (typeof range.endRef !== "string" || range.endRef.length === 0 || range.endRef.length > 32) errors.push(`content[${index}].endRef must be a non-empty string (<= 32 chars)`);
		if (typeof range.summary !== "string" || range.summary.length === 0) errors.push(`content[${index}].summary must be a non-empty string`);
		else if (range.summary.length > 8e3) errors.push(`content[${index}].summary must be at most 8000 characters`);
	}
	return errors;
}
//#endregion
//#region src/refs/resolver.ts
function resolveBoundaryPosition(surface, boundaryRefs, ref, aliases = []) {
	const record = boundaryRefs.find((entry) => entry.ref === ref);
	if (record && record.active) {
		const position = surface.indexOf(record.seq);
		if (position !== -1) return {
			position,
			seq: record.seq
		};
	}
	const alias = aliases.find((entry) => entry.ref === ref);
	if (alias) {
		const position = surface.indexOf(alias.seq);
		if (position !== -1) return {
			position,
			seq: alias.seq
		};
	}
}
/**
* Half-open range `[startRef, endRef)`: endRef must be a boundary at or after
* startRef, and both markers must be on the current surface.
*/
function resolveRange(surface, boundaryRefs, startRef, endRef, aliases = []) {
	const start = resolveBoundaryPosition(surface, boundaryRefs, startRef, aliases);
	if (!start) return {
		ok: false,
		reason: `startRef ${startRef} is not an active boundary`
	};
	const end = resolveBoundaryPosition(surface, boundaryRefs, endRef, aliases);
	if (!end) return {
		ok: false,
		reason: `endRef ${endRef} is not an active boundary`
	};
	if (start.position >= end.position) return {
		ok: false,
		reason: `startRef ${startRef} must appear before endRef ${endRef}`
	};
	return {
		ok: true,
		startSeq: start.seq,
		endSeq: end.seq,
		startPosition: start.position,
		endPosition: end.position
	};
}
//#endregion
//#region src/protocol/turns.ts
function turnOfSeq(events, seq) {
	let currentTurn;
	for (let index = 0; index <= seq && index < events.length; index++) {
		const event = events[index];
		if (event.type === "turn/start") currentTurn = event.data.turn;
		if (event.type === "turn/end") currentTurn = void 0;
		if (index === seq) {
			if (event.type === "assistant/message" || event.type === "tool/result") return event.data.turn;
			return currentTurn;
		}
	}
}
function maxTurn(events) {
	let current;
	let maximum = 0;
	for (const event of events) {
		if (event.type === "turn/start") current = event.data.turn;
		if (event.type === "turn/end") current = void 0;
		if (current !== void 0) maximum = Math.max(maximum, current);
	}
	return maximum;
}
function openTurnOf(events) {
	let current = null;
	for (const event of events) {
		if (event.type === "turn/start") current = event.data.turn;
		if (event.type === "turn/end") current = null;
	}
	return current;
}
//#endregion
//#region src/protection/patterns.ts
/**
* Glob matching for protected file patterns.
*
* @module dsh-dcp/protection/patterns
*/
function normalizePath(input) {
	return input.replaceAll("\\", "/");
}
function escapeRegExpChar(ch) {
	return /[\\.^$+{}()|[\]]/.test(ch) ? `\\${ch}` : ch;
}
function matchesGlob(inputPath, pattern) {
	if (!pattern) return false;
	const input = normalizePath(inputPath);
	const pat = normalizePath(pattern);
	let regex = "^";
	for (let i = 0; i < pat.length; i++) {
		const ch = pat[i];
		if (ch === "*") {
			if (pat[i + 1] === "*") {
				if (pat[i + 2] === "/") {
					regex += "(?:.*/)?";
					i += 2;
				} else {
					regex += ".*";
					i++;
				}
				continue;
			}
			regex += "[^/]*";
			continue;
		}
		if (ch === "?") {
			regex += "[^/]";
			continue;
		}
		regex += escapeRegExpChar(ch);
	}
	regex += "$";
	return new RegExp(regex).test(input);
}
//#endregion
//#region src/protection/classify.ts
const PROTECT_TAG = /<protect>([\s\S]*?)<\/protect>/gi;
function toolNameOf(session, callId) {
	for (const event of session.events) if (event.type === "tool/call" && String(event.data.callId) === callId) return event.data.name;
}
function filePathsOf$1(tool, args) {
	try {
		const parsed = JSON.parse(args);
		if (tool === "apply_patch" && typeof parsed.patchText === "string") return [...parsed.patchText.matchAll(/\*\*\* (?:Add|Delete|Update) File: ([^\n\r]+)/g)].map((match) => match[1].trim());
		if (typeof parsed.filePath === "string") return [parsed.filePath];
		return [];
	} catch {
		return [];
	}
}
/** Collect verbatim user messages, <protect> tags, protected tool outputs, and prior blocks. */
function collectProtectedAppendix(session, shadowedSeqs, config, priorBlocks = []) {
	const sections = [];
	const kinds = [];
	for (const seq of shadowedSeqs) {
		const event = session.events[seq];
		if (event?.type !== "user/message") continue;
		const text = event.data.content.filter((block) => block.type === "text").map((block) => block.type === "text" ? block.text : "").join("\n");
		if (!text.trim()) continue;
		if (config.compress.protectUserMessages) {
			sections.push(`\nUser message verbatim:\n${text}`);
			kinds.push("user");
		}
		if (config.compress.protectTags) {
			const protectedTexts = [];
			for (const match of text.matchAll(PROTECT_TAG)) {
				const body = match[1]?.trim();
				if (body) protectedTexts.push(body);
			}
			if (protectedTexts.length > 0) {
				sections.push(`\nProtected prompt information verbatim:\n${protectedTexts.join("\n")}`);
				kinds.push("protect-tag");
			}
		}
		const source = event.data.source;
		if (config.compress.protectedSources.includes(source.form ?? "")) {
			sections.push(`\nProtected source ${source.form} verbatim:\n${text}`);
			kinds.push(`source:${source.form}`);
		}
	}
	for (const seq of shadowedSeqs) {
		const event = session.events[seq];
		if (event?.type !== "tool/result") continue;
		const callId = String(event.data.message.source.callId);
		const tool = toolNameOf(session, callId);
		if (!tool) continue;
		const toolCall = session.events.find((candidate) => candidate.type === "tool/call" && String(candidate.data.callId) === callId);
		const args = toolCall?.type === "tool/call" ? toolCall.data.arguments : "";
		const protectedByTool = config.compress.protectedTools.includes(tool);
		const protectedByPath = config.protectedFilePatterns.some((pattern) => filePathsOf$1(tool, args).some((path) => matchesGlob(path, pattern)));
		if (!protectedByTool && !protectedByPath) continue;
		const output = event.data.message.content.flatMap((block) => block.type === "tool-result" ? block.content : []).filter((block) => block.type === "text").map((block) => block.type === "text" ? block.text : "").join("\n");
		if (output.trim()) {
			sections.push(`\nProtected tool ${tool} output verbatim:\n${output}`);
			kinds.push(`tool:${tool}`);
		}
	}
	if (priorBlocks.length > 0) {
		sections.push(`\nIncluded prior blocks:\n${priorBlocks.map((block) => `${block.ref}: ${block.text}`).join("\n")}`);
		kinds.push("prior-blocks");
	}
	return {
		text: sections.join(""),
		kinds: [...new Set(kinds)]
	};
}
/** Hard-protected user forms that must never be shadowed. */
function hardProtectedForm(form) {
	return form === "instructions" || form === "snapshot";
}
//#endregion
//#region src/compress/prepare.ts
/**
* Range preparation: resolve refs, validate cuts/retention, compute net
* savings, and build the checkpoint text.
*
* @module dsh-dcp/compress/prepare
*/
function buildCheckpointText(blockRef, summary, protectedAppendix = "") {
	return `[Compressed conversation section]\n${summary.trim()}${protectedAppendix}\n\n<dcp-message-id>${blockRef}</dcp-message-id>`;
}
function prepareRange(session, tokenMeter, config, state, entry, blockRef, topic) {
	const surface = [...session.surface.nodes];
	const resolved = resolveRange(surface, state.boundaryRefs, entry.startRef, entry.endRef, state.aliases);
	if (!resolved.ok) return {
		ok: false,
		errors: [resolved.reason]
	};
	const shadowedSeqs = surface.slice(resolved.startPosition, resolved.endPosition);
	if (shadowedSeqs.length === 0) return {
		ok: false,
		errors: [`range ${entry.startRef}..${entry.endRef} is empty`]
	};
	if (!toolPairingBalancedBefore(session, resolved.startSeq)) return {
		ok: false,
		errors: [`range start ${entry.startRef} cuts an open tool call/result pair`]
	};
	if (!toolPairingBalancedBefore(session, resolved.endSeq)) return {
		ok: false,
		errors: [`range end ${entry.endRef} cuts an open tool call/result pair`]
	};
	const events = session.events;
	const turns = shadowedSeqs.map((seq) => turnOfSeq(events, seq)).filter((turn) => turn !== void 0);
	const latestTurn = Math.max(0, ...surface.map((seq) => turnOfSeq(events, seq) ?? 0));
	if (Math.max(0, ...turns) > latestTurn - config.compress.retainRecentTurns) return {
		ok: false,
		errors: [`range ${entry.startRef}..${entry.endRef} enters the last ${config.compress.retainRecentTurns} turn(s); choose older content`]
	};
	for (const seq of shadowedSeqs) {
		const event = session.events[seq];
		if (event?.type === "user/message" && hardProtectedForm(event.data.source.form)) return {
			ok: false,
			errors: [`range ${entry.startRef}..${entry.endRef} contains a hard-protected instruction/snapshot node`]
		};
	}
	const consumedBlocks = state.blocks.filter((block) => block.membership === "active" && shadowedSeqs.includes(block.seq));
	const consumedBlockRefs = consumedBlocks.map((block) => block.ref);
	const priorBlocks = consumedBlocks.map((block) => {
		const event = session.events[block.seq];
		const text = event?.type === "user/message" ? event.data.content.filter((content) => content.type === "text").map((content) => content.type === "text" ? content.text : "").join("\n") : "";
		return {
			ref: block.ref,
			text
		};
	});
	const tokensIn = shadowedSeqs.reduce((sum, seq) => {
		const message = deriveEventMessage(events[seq]);
		return sum + (message ? tokenMeter.estimateMessage(message) : 0);
	}, 0);
	const appendix = collectProtectedAppendix(session, shadowedSeqs, config, priorBlocks);
	const checkpointText = buildCheckpointText(blockRef, entry.summary, appendix.text);
	const checkpointMessage = createUserMessage({
		content: [{
			type: "text",
			text: checkpointText
		}],
		source: {
			kind: "plugin",
			plugin: "dsh-dcp"
		}
	});
	const tokensOut = tokenMeter.estimateMessage(checkpointMessage);
	if (tokensIn - tokensOut < config.compress.minNetSavingsTokens) return {
		ok: false,
		errors: [`range ${entry.startRef}..${entry.endRef} saves ~${tokensIn - tokensOut} tokens, below minNetSavingsTokens=${config.compress.minNetSavingsTokens}`]
	};
	return {
		ok: true,
		prepared: {
			entry,
			topic,
			startSeq: resolved.startSeq,
			endSeq: resolved.endSeq,
			startPosition: resolved.startPosition,
			endPosition: resolved.endPosition,
			shadowedSeqs,
			tokensIn,
			tokensOut,
			checkpointText,
			protectedKinds: appendix.kinds,
			consumedBlockRefs,
			blockRef
		}
	};
}
/** Prepare all ranges in surface order, reject overlaps, allocate block refs. */
function prepareBatch(session, tokenMeter, config, state, args, firstBlockNumber) {
	if (args.content.length === 0) return {
		ok: false,
		errors: ["content must not be empty"]
	};
	if (args.content.length > config.compress.maxRangesPerCall) return {
		ok: false,
		errors: [`content accepts at most ${config.compress.maxRangesPerCall} range(s)`]
	};
	const resolved = [];
	for (const entry of args.content) {
		const result = resolveRange([...session.surface.nodes], state.boundaryRefs, entry.startRef, entry.endRef, state.aliases);
		if (!result.ok) return {
			ok: false,
			errors: [result.reason]
		};
		resolved.push({
			entry,
			startPosition: result.startPosition,
			endPosition: result.endPosition
		});
	}
	for (let index = 1; index < resolved.length; index++) {
		const previous = resolved[index - 1];
		const current = resolved[index];
		if (current.startPosition < previous.endPosition) return {
			ok: false,
			errors: [`ranges must be in surface order and non-overlapping: ${previous.entry.startRef}..${previous.entry.endRef} overlaps ${current.entry.startRef}..${current.entry.endRef}`]
		};
	}
	const prepared = [];
	for (const [index, resolvedEntry] of resolved.entries()) {
		const blockRef = `b${firstBlockNumber + index}`;
		const result = prepareRange(session, tokenMeter, config, state, resolvedEntry.entry, blockRef, args.topic);
		if (!result.ok) return {
			ok: false,
			errors: result.errors
		};
		prepared.push(result.prepared);
	}
	return {
		ok: true,
		prepared
	};
}
//#endregion
//#region src/protocol/recovery.ts
/**
* Classify the most recent compaction bracket in an event prefix.
*
* Rules (revised PLAN §6.5):
* - no `compaction/start`                -> none
* - start without end and no replace:
*   - a newer `session/end-seed` proves the bracket belongs to an earlier
*     lifecycle -> stale-orphan-start (not a live lock)
*   - otherwise -> live-orphan-start
* - start + summary, no replace          -> summary-without-replace
* - replace visible, no end              -> recovered-unclosed (surface wins)
* - start..end with replace              -> committed
* - start..end(error) without replace    -> failed-attempt
*/
function classifyCompactionPrefix(events) {
	let bracket;
	let endSeedAfterStart = false;
	for (const event of events) switch (event.type) {
		case "session/end-seed":
			if (bracket !== void 0) endSeedAfterStart = true;
			break;
		case "compaction/start":
			bracket = { startSeq: event.seq };
			endSeedAfterStart = false;
			break;
		case "compaction/summary":
			if (bracket !== void 0) bracket.summarySeq = event.seq;
			break;
		case "compaction/end":
			if (bracket !== void 0) {
				bracket.endSeq = event.seq;
				bracket.endError = event.data.error;
			}
			break;
		case "user/message": if (bracket !== void 0 && event.surfaceOp !== void 0 && event.surfaceOp !== "append" && event.surfaceOp.op === "replace") bracket.replaceSeq = event.seq;
	}
	if (bracket === void 0) return "none";
	if (bracket.endSeq !== void 0) return bracket.replaceSeq === void 0 ? "failed-attempt" : "committed";
	if (bracket.replaceSeq !== void 0) return "recovered-unclosed";
	if (bracket.summarySeq !== void 0) return "summary-without-replace";
	return endSeedAfterStart ? "stale-orphan-start" : "live-orphan-start";
}
//#endregion
//#region src/compress/commit.ts
/** Commit one prepared range. Revalidates positions before the first append. */
function commitRange(session, _tokenMeter, prepared, blockRef, meta) {
	const surface = [...session.surface.nodes];
	const startPosition = surface.indexOf(prepared.startSeq);
	const endPosition = surface.indexOf(prepared.endSeq);
	if (startPosition === -1 || endPosition === -1) throw new Error("compress range changed before commit; retry with current refs");
	if (startPosition !== prepared.startPosition || endPosition !== prepared.endPosition) throw new Error("compress range moved before commit; retry with current refs");
	const classification = classifyCompactionPrefix(session.events);
	if (classification === "live-orphan-start" || classification === "recovered-unclosed") throw new Error("compaction is busy: an unclosed bracket holds the session lock");
	const header = session.requestHeader();
	const provider = header?.config.provider ?? "unknown";
	const model = header?.config.model ?? "unknown";
	const turn = session.surface.nodes.length > 0 ? latestOpenTurn(session) : null;
	session.append("compaction/start", {
		compactionId: meta.compactionId,
		turn
	});
	const summarySeq = session.append("compaction/summary", {
		compactionId: meta.compactionId,
		summary: [{
			type: "text",
			text: prepared.checkpointText
		}],
		shadowedRange: {
			start: prepared.startSeq,
			end: prepared.shadowedSeqs.at(-1) ?? prepared.endSeq
		},
		shadowedSeqs: prepared.shadowedSeqs,
		shadowedTokenCount: prepared.tokensIn,
		provider,
		model
	}).seq;
	const checkpoint = session.append("user/message", createUserMessage({
		content: [{
			type: "text",
			text: prepared.checkpointText
		}],
		source: encodeDcpCheckpointSource(meta.compactionId, {
			v: 1,
			kind: "summary",
			blockRef,
			mode: "range",
			topic: prepared.topic,
			startRef: prepared.entry.startRef,
			endRef: prepared.entry.endRef,
			authorMessageId: meta.authorMessageId,
			compressCallId: meta.compressCallId,
			consumedBlockRefs: prepared.consumedBlockRefs,
			protectedKinds: prepared.protectedKinds
		})
	}), {
		surfaceOp: {
			op: "replace",
			start: prepared.startSeq,
			end: prepared.shadowedSeqs.at(-1) ?? prepared.endSeq
		},
		sourceEventSeqs: [
			prepared.startSeq,
			summarySeq,
			...prepared.shadowedSeqs.slice(1)
		]
	});
	session.append("compaction/end", {
		compactionId: meta.compactionId,
		turn
	});
	return {
		checkpointSeq: checkpoint.seq,
		blockRef
	};
}
function latestOpenTurn(session) {
	let turn = null;
	for (const event of session.events) {
		if (event.type === "turn/start") turn = event.data.turn;
		if (event.type === "turn/end") turn = null;
	}
	return turn;
}
//#endregion
//#region src/compress/inline-cleanup.ts
/**
* Rewrite the model's inline summary arguments inside the author assistant
* message to `[stored in <blockRef>]`, preserving every other block and the
* message identity. Requires an open turn/step (tool execution context).
*/
function cleanupInlineSummary(session, tokenMeter, compressCallId, blockRefsByIndex) {
	let authorSeq;
	let original;
	for (const seq of session.surface.nodes) {
		const event = session.events[seq];
		if (event?.type !== "assistant/message") continue;
		if (event.data.message.content.some((block) => block.type === "tool-call" && block.id === compressCallId)) {
			authorSeq = seq;
			original = event;
			break;
		}
	}
	if (authorSeq === void 0 || original?.type !== "assistant/message") return {
		cleaned: false,
		warning: "author assistant message not found for inline cleanup"
	};
	const message = original.data.message;
	let rewritten = false;
	const content = message.content.map((block) => {
		if (block.type !== "tool-call" || block.id !== compressCallId) return block;
		try {
			const parsed = JSON.parse(block.arguments);
			if (Array.isArray(parsed.content)) {
				for (const [entryIndex, entry] of parsed.content.entries()) if (entry && typeof entry.summary === "string") {
					const ref = blockRefsByIndex[entryIndex];
					if (ref === void 0) continue;
					entry.summary = `[stored in ${ref}]`;
					rewritten = true;
				}
			}
			return {
				...block,
				arguments: JSON.stringify(parsed)
			};
		} catch {
			return block;
		}
	});
	if (!rewritten) return {
		cleaned: false,
		warning: "no inline summary argument found to clean"
	};
	const cleanedMessage = freezeMessage({
		...message,
		content
	});
	session.append("compaction/prune", {
		shadowedRange: {
			start: authorSeq,
			end: authorSeq
		},
		shadowedSeqs: [authorSeq],
		shadowedTokenCount: tokenMeter.estimateMessage(message)
	});
	session.append("assistant/message", {
		turn: original.data.turn,
		step: original.data.step,
		message: cleanedMessage
	}, {
		surfaceOp: {
			op: "replace",
			start: authorSeq,
			end: authorSeq
		},
		sourceEventSeqs: [authorSeq]
	});
	return { cleaned: true };
}
//#endregion
//#region src/compress/pipeline.ts
function findAuthorSeq(session, compressCallId) {
	for (const seq of session.surface.nodes) {
		const event = session.events[seq];
		if (event?.type === "assistant/message" && event.data.message.content.some((block) => block.type === "tool-call" && block.id === compressCallId)) return seq;
	}
}
function executeCompressRange(session, tokenMeter, config, args, meta) {
	const errors = validateCompressArgs(args, config.compress.maxRangesPerCall);
	if (errors.length > 0) throw new Error(errors.join("\n"));
	const state = reduceDcpState(session.events);
	const batch = prepareBatch(session, tokenMeter, config, state, args, state.maxBlockNumber + 1);
	if (!batch.ok) throw new Error(batch.errors.join("\n"));
	const blocks = [];
	const failed = [];
	const blockRefsByIndex = Array.from({ length: args.content.length }, () => void 0);
	const authorSeq = findAuthorSeq(session, meta.compressCallId);
	for (const [index, entry] of args.content.entries()) try {
		const currentState = reduceDcpState(session.events);
		const preparedResult = prepareRange(session, tokenMeter, config, currentState, entry, `b${currentState.maxBlockNumber + 1}`, args.topic);
		if (!preparedResult.ok) throw new Error(preparedResult.errors.join("\n"));
		const prepared = preparedResult.prepared;
		if (authorSeq !== void 0 && prepared.shadowedSeqs.includes(authorSeq)) throw new Error("range includes the current compress call; choose an earlier endRef");
		const committed = commitRange(session, tokenMeter, prepared, prepared.blockRef, {
			...meta,
			compactionId: CompactionId(`${String(meta.compactionId)}-${index}`)
		});
		blocks.push({
			blockRef: prepared.blockRef,
			checkpointSeq: committed.checkpointSeq,
			compressedMessages: prepared.shadowedSeqs.length,
			compressedTokens: prepared.tokensIn - prepared.tokensOut
		});
		blockRefsByIndex[index] = prepared.blockRef;
	} catch (error) {
		failed.push({
			startRef: entry.startRef,
			endRef: entry.endRef,
			error: error instanceof Error ? error.message : String(error)
		});
	}
	const cleanup = blocks.length > 0 ? cleanupInlineSummary(session, tokenMeter, meta.compressCallId, blockRefsByIndex) : {
		cleaned: false,
		warning: "no blocks committed; cleanup skipped"
	};
	return {
		blocks,
		failed,
		...cleanup.cleaned ? {} : { cleanupWarning: cleanup.warning }
	};
}
//#endregion
//#region src/compress/tool.ts
function findAuthorMessageId(session, callId) {
	for (const seq of session.surface.nodes) {
		const event = session.events[seq];
		if (event?.type !== "assistant/message") continue;
		if (event.data.message.content.some((block) => block.type === "tool-call" && block.id === callId)) return String(event.data.message.id);
	}
}
function createCompressTool(ctx, config) {
	return defineTool({
		name: "compress",
		description: "Compress one closed conversation range into a summary checkpoint. Ranges are half-open [startRef, endRef): startRef is included, endRef is excluded. Use boundary refs visible in context (mNNNN). Only closed, tool-pairing-balanced ranges are accepted.",
		parameters: {
			topic: {
				type: "string",
				required: true,
				description: "Short 3-5 word label for the compressed section"
			},
			content: {
				type: "array",
				required: true,
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						startRef: {
							type: "string",
							required: true,
							description: "Inclusive start boundary ref, e.g. m0001"
						},
						endRef: {
							type: "string",
							required: true,
							description: "Exclusive end boundary ref, e.g. m0007"
						},
						summary: {
							type: "string",
							required: true,
							description: "Complete technical summary replacing the range"
						}
					}
				}
			}
		},
		output: {
			schema: { type: "string" },
			render: (_args, value) => [{
				type: "text",
				text: value
			}]
		},
		async execute(args, exec) {
			if (exec.parent !== void 0) throw new Error("compress cannot be executed from a run_code sub-call; use native tool presentation or /dcp compress");
			if (!exec.agent) throw new Error("compress requires an agent session");
			const session = exec.agent.session;
			const callId = String(exec.callId);
			const authorMessageId = findAuthorMessageId(session, callId) ?? "unknown";
			const result = executeCompressRange(session, ctx.tokenMeter, config, args, {
				compactionId: CompactionId(`dcp-${callId}`),
				compressCallId: callId,
				authorMessageId
			});
			const warning = result.cleanupWarning ? ` (cleanup warning: ${result.cleanupWarning})` : "";
			const blockSummary = result.blocks.map((block) => block.blockRef).join(", ");
			return `Compressed ${result.blocks.reduce((sum, block) => sum + block.compressedMessages, 0)} message(s) into ${blockSummary}.${result.failed.length > 0 ? ` ${result.failed.length} range(s) failed: ${result.failed.map((entry) => `${entry.startRef}..${entry.endRef}: ${entry.error}`).join("; ")}` : ""}${warning}`;
		}
	});
}
//#endregion
//#region src/commands/help.ts
/**
* /dcp help
*
* @module dsh-dcp/commands/help
*/
function renderHelp() {
	return [
		"DCP commands:",
		"  /dcp help      show this help",
		"  /dcp context   show token usage breakdown for the current session",
		"  /dcp stats     show DCP statistics",
		"  /dcp manual [on|off|status]",
		"  /dcp sweep     run automatic pruning in a control turn",
		"  /dcp compress [focus]",
		"  /dcp show <bN> [--raw]",
		"  /dcp decompress <bN> [--into-context]",
		"  /dcp recompress <bN>",
		"The model-facing `compress` tool performs range compression."
	].join("\n");
}
//#endregion
//#region src/commands/context.ts
function renderContext(ctx, agent) {
	const session = agent.session;
	const measure = ctx.tokenMeter.measure(session);
	const values = ctx.get("sessionProjections")?.snapshot(session).values ?? {};
	const breakdown = values.contextBreakdown;
	const pressure = values.contextPressure;
	const state = reduceDcpState(session.events);
	return [
		"DCP context:",
		`  surface tokens:  ~${measure.surfaceTokens}`,
		`  message tokens:  ~${breakdown?.messageTokens ?? "n/a"}`,
		`  system tokens:   ~${breakdown?.systemTokens ?? "n/a"}`,
		`  tools tokens:    ~${breakdown?.toolsTokens ?? "n/a"}`,
		`  pressure:        ~${pressure?.pressureTokens ?? "n/a"}`,
		`  projected:       ~${pressure?.projectedTokens ?? "n/a"}`,
		`  active blocks:   ${state.activeBlockRefs.length ? state.activeBlockRefs.join(", ") : "(none)"}`,
		`  boundaries:      ${state.boundaryRefs.filter((entry) => entry.active).length}`
	].join("\n");
}
//#endregion
//#region src/stats/session.ts
function heuristicTokens(text) {
	return Math.max(1, Math.round(text.length / 4));
}
function textOf(message) {
	return message.content.flatMap((block) => block.type === "tool-result" ? block.content : [block]).filter((block) => block.type === "text").map((block) => block.type === "text" ? block.text ?? "" : "").join("\n");
}
function computeSessionStats(events, estimateMessage) {
	const estimate = estimateMessage ?? ((message) => heuristicTokens(textOf(message)));
	let blockCount = 0;
	let pruneReplacements = 0;
	let shadowedTokens = 0;
	let checkpointTokens = 0;
	let pruneTokens = 0;
	let expansionTokens = 0;
	let markerTokens = 0;
	for (let index = 0; index < events.length; index++) {
		const event = events[index];
		switch (event.type) {
			case "compaction/summary": {
				const next = events[index + 1];
				const decoded = next?.type === "user/message" && next.surfaceOp !== "append" ? decodeDcpMeta(next.data.source) : void 0;
				if (decoded?.ok && decoded.meta.kind === "summary") {
					shadowedTokens += event.data.shadowedTokenCount;
					if (next?.type === "user/message") checkpointTokens += estimate(next.data);
					blockCount++;
				}
				break;
			}
			case "compaction/prune": {
				const next = events[index + 1];
				const nextText = next?.type === "tool/result" || next?.type === "assistant/message" ? textOf(next.data.message) : next?.type === "user/message" ? textOf(next.data) : "";
				if (nextText.includes("[duplicate ") || nextText.includes("[errored tool unit removed]")) {
					pruneTokens += event.data.shadowedTokenCount;
					if (next?.type === "tool/result" || next?.type === "assistant/message") checkpointTokens += estimate(next.data.message);
					else if (next?.type === "user/message") checkpointTokens += estimate(next.data);
					pruneReplacements++;
				}
				break;
			}
			case "user/message": {
				const decoded = decodeDcpMeta(event.data.source);
				const text = textOf(event.data);
				if (decoded.ok) {
					if (decoded.meta.kind === "expansion") {
						blockCount++;
						const oldSeq = event.sourceEventSeqs?.[0];
						const old = oldSeq === void 0 ? void 0 : events[oldSeq];
						const oldEstimate = old?.type === "user/message" ? estimate(old.data) : 0;
						expansionTokens += oldEstimate - estimate(event.data);
					}
				}
				if (text.includes("<dcp-boundary")) markerTokens += estimate(event.data);
				break;
			}
		}
	}
	const activeBlockCount = reconcileBlockMembership(events).size;
	return {
		blockCount,
		activeBlockCount,
		pruneReplacements,
		shadowedTokens,
		checkpointTokens,
		pruneTokens,
		expansionTokens,
		markerTokens,
		historyReduction: shadowedTokens + pruneTokens - checkpointTokens + expansionTokens - markerTokens
	};
}
//#endregion
//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/core.js
var _a$1;
function $constructor(name, initializer, params) {
	function init(inst, def) {
		if (!inst._zod) Object.defineProperty(inst, "_zod", {
			value: {
				def,
				constr: _,
				traits: /* @__PURE__ */ new Set()
			},
			enumerable: false
		});
		if (inst._zod.traits.has(name)) return;
		inst._zod.traits.add(name);
		initializer(inst, def);
		const proto = _.prototype;
		const keys = Object.keys(proto);
		for (let i = 0; i < keys.length; i++) {
			const k = keys[i];
			if (!(k in inst)) inst[k] = proto[k].bind(inst);
		}
	}
	const Parent = params?.Parent ?? Object;
	class Definition extends Parent {}
	Object.defineProperty(Definition, "name", { value: name });
	function _(def) {
		var _a;
		const inst = params?.Parent ? new Definition() : this;
		init(inst, def);
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		for (const fn of inst._zod.deferred) fn();
		return inst;
	}
	Object.defineProperty(_, "init", { value: init });
	Object.defineProperty(_, Symbol.hasInstance, { value: (inst) => {
		if (params?.Parent && inst instanceof params.Parent) return true;
		return inst?._zod?.traits?.has(name);
	} });
	Object.defineProperty(_, "name", { value: name });
	return _;
}
var $ZodAsyncError = class extends Error {
	constructor() {
		super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
	}
};
var $ZodEncodeError = class extends Error {
	constructor(name) {
		super(`Encountered unidirectional transform during encode: ${name}`);
		this.name = "ZodEncodeError";
	}
};
(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
const globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
	if (newConfig) Object.assign(globalConfig, newConfig);
	return globalConfig;
}
//#endregion
//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
	const numericValues = Object.values(entries).filter((v) => typeof v === "number");
	return Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
}
function jsonStringifyReplacer(_, value) {
	if (typeof value === "bigint") return value.toString();
	return value;
}
function cached(getter) {
	return { get value() {
		{
			const value = getter();
			Object.defineProperty(this, "value", { value });
			return value;
		}
	} };
}
function nullish(input) {
	return input === null || input === void 0;
}
function cleanRegex(source) {
	const start = source.startsWith("^") ? 1 : 0;
	const end = source.endsWith("$") ? source.length - 1 : source.length;
	return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
	const ratio = val / step;
	const roundedRatio = Math.round(ratio);
	const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1);
	if (Math.abs(ratio - roundedRatio) < tolerance) return 0;
	return ratio - roundedRatio;
}
const EVALUATING = /* @__PURE__*/ Symbol("evaluating");
function defineLazy(object, key, getter) {
	let value = void 0;
	Object.defineProperty(object, key, {
		get() {
			if (value === EVALUATING) return;
			if (value === void 0) {
				value = EVALUATING;
				value = getter();
			}
			return value;
		},
		set(v) {
			Object.defineProperty(object, key, { value: v });
		},
		configurable: true
	});
}
function assignProp(target, prop, value) {
	Object.defineProperty(target, prop, {
		value,
		writable: true,
		enumerable: true,
		configurable: true
	});
}
function mergeDefs(...defs) {
	const mergedDescriptors = {};
	for (const def of defs) {
		const descriptors = Object.getOwnPropertyDescriptors(def);
		Object.assign(mergedDescriptors, descriptors);
	}
	return Object.defineProperties({}, mergedDescriptors);
}
function esc(str) {
	return JSON.stringify(str);
}
function slugify(input) {
	return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
const captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject(data) {
	return typeof data === "object" && data !== null && !Array.isArray(data);
}
const allowsEval = /* @__PURE__*/ cached(() => {
	if (globalConfig.jitless) return false;
	if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) return false;
	try {
		new Function("");
		return true;
	} catch (_) {
		return false;
	}
});
function isPlainObject(o) {
	if (isObject(o) === false) return false;
	const ctor = o.constructor;
	if (ctor === void 0) return true;
	if (typeof ctor !== "function") return true;
	const prot = ctor.prototype;
	if (isObject(prot) === false) return false;
	if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
	return true;
}
function shallowClone(o) {
	if (isPlainObject(o)) return { ...o };
	if (Array.isArray(o)) return [...o];
	if (o instanceof Map) return new Map(o);
	if (o instanceof Set) return new Set(o);
	return o;
}
const propertyKeyTypes = /* @__PURE__*/ new Set([
	"string",
	"number",
	"symbol"
]);
function escapeRegex(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
	const cl = new inst._zod.constr(def ?? inst._zod.def);
	if (!def || params?.parent) cl._zod.parent = inst;
	return cl;
}
function normalizeParams(_params) {
	const params = _params;
	if (!params) return {};
	if (typeof params === "string") return { error: () => params };
	if (params?.message !== void 0) {
		if (params?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
		params.error = params.message;
	}
	delete params.message;
	if (typeof params.error === "string") return {
		...params,
		error: () => params.error
	};
	return params;
}
function optionalKeys(shape) {
	return Object.keys(shape).filter((k) => {
		return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
	});
}
const NUMBER_FORMAT_RANGES = {
	safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
	int32: [-2147483648, 2147483647],
	uint32: [0, 4294967295],
	float32: [-34028234663852886e22, 34028234663852886e22],
	float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
function pick(schema, mask) {
	const currDef = schema._zod.def;
	const checks = currDef.checks;
	if (checks && checks.length > 0) throw new Error(".pick() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const newShape = {};
			for (const key in mask) {
				if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
				if (!mask[key]) continue;
				newShape[key] = currDef.shape[key];
			}
			assignProp(this, "shape", newShape);
			return newShape;
		},
		checks: []
	}));
}
function omit(schema, mask) {
	const currDef = schema._zod.def;
	const checks = currDef.checks;
	if (checks && checks.length > 0) throw new Error(".omit() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const newShape = { ...schema._zod.def.shape };
			for (const key in mask) {
				if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
				if (!mask[key]) continue;
				delete newShape[key];
			}
			assignProp(this, "shape", newShape);
			return newShape;
		},
		checks: []
	}));
}
function extend(schema, shape) {
	if (!isPlainObject(shape)) throw new Error("Invalid input to extend: expected a plain object");
	const checks = schema._zod.def.checks;
	if (checks && checks.length > 0) {
		const existingShape = schema._zod.def.shape;
		for (const key in shape) if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
	}
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const _shape = {
			...schema._zod.def.shape,
			...shape
		};
		assignProp(this, "shape", _shape);
		return _shape;
	} }));
}
function safeExtend(schema, shape) {
	if (!isPlainObject(shape)) throw new Error("Invalid input to safeExtend: expected a plain object");
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const _shape = {
			...schema._zod.def.shape,
			...shape
		};
		assignProp(this, "shape", _shape);
		return _shape;
	} }));
}
function merge(a, b) {
	if (a._zod.def.checks?.length) throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
	return clone(a, mergeDefs(a._zod.def, {
		get shape() {
			const _shape = {
				...a._zod.def.shape,
				...b._zod.def.shape
			};
			assignProp(this, "shape", _shape);
			return _shape;
		},
		get catchall() {
			return b._zod.def.catchall;
		},
		checks: b._zod.def.checks ?? []
	}));
}
function partial(Class, schema, mask) {
	const checks = schema._zod.def.checks;
	if (checks && checks.length > 0) throw new Error(".partial() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const oldShape = schema._zod.def.shape;
			const shape = { ...oldShape };
			if (mask) for (const key in mask) {
				if (!(key in oldShape)) throw new Error(`Unrecognized key: "${key}"`);
				if (!mask[key]) continue;
				shape[key] = Class ? new Class({
					type: "optional",
					innerType: oldShape[key]
				}) : oldShape[key];
			}
			else for (const key in oldShape) shape[key] = Class ? new Class({
				type: "optional",
				innerType: oldShape[key]
			}) : oldShape[key];
			assignProp(this, "shape", shape);
			return shape;
		},
		checks: []
	}));
}
function required(Class, schema, mask) {
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const oldShape = schema._zod.def.shape;
		const shape = { ...oldShape };
		if (mask) for (const key in mask) {
			if (!(key in shape)) throw new Error(`Unrecognized key: "${key}"`);
			if (!mask[key]) continue;
			shape[key] = new Class({
				type: "nonoptional",
				innerType: oldShape[key]
			});
		}
		else for (const key in oldShape) shape[key] = new Class({
			type: "nonoptional",
			innerType: oldShape[key]
		});
		assignProp(this, "shape", shape);
		return shape;
	} }));
}
function aborted(x, startIndex = 0) {
	if (x.aborted === true) return true;
	for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue !== true) return true;
	return false;
}
function explicitlyAborted(x, startIndex = 0) {
	if (x.aborted === true) return true;
	for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue === false) return true;
	return false;
}
function prefixIssues(path, issues) {
	return issues.map((iss) => {
		var _a;
		(_a = iss).path ?? (_a.path = []);
		iss.path.unshift(path);
		return iss;
	});
}
function unwrapMessage(message) {
	return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config) {
	const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
	const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
	rest.path ?? (rest.path = []);
	rest.message = message;
	if (ctx?.reportInput) rest.input = _input;
	return rest;
}
function getLengthableOrigin(input) {
	if (Array.isArray(input)) return "array";
	if (typeof input === "string") return "string";
	return "unknown";
}
function issue(...args) {
	const [iss, input, inst] = args;
	if (typeof iss === "string") return {
		message: iss,
		code: "custom",
		input,
		inst
	};
	return { ...iss };
}
//#endregion
//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/errors.js
const initializer$1 = (inst, def) => {
	inst.name = "$ZodError";
	Object.defineProperty(inst, "_zod", {
		value: inst._zod,
		enumerable: false
	});
	Object.defineProperty(inst, "issues", {
		value: def,
		enumerable: false
	});
	inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
	Object.defineProperty(inst, "toString", {
		value: () => inst.message,
		enumerable: false
	});
};
const $ZodError = $constructor("$ZodError", initializer$1);
const $ZodRealError = $constructor("$ZodError", initializer$1, { Parent: Error });
function flattenError(error, mapper = (issue) => issue.message) {
	const fieldErrors = {};
	const formErrors = [];
	for (const sub of error.issues) if (sub.path.length > 0) {
		fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
		fieldErrors[sub.path[0]].push(mapper(sub));
	} else formErrors.push(mapper(sub));
	return {
		formErrors,
		fieldErrors
	};
}
function formatError(error, mapper = (issue) => issue.message) {
	const fieldErrors = { _errors: [] };
	const processError = (error, path = []) => {
		for (const issue of error.issues) if (issue.code === "invalid_union" && issue.errors.length) issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
		else if (issue.code === "invalid_key") processError({ issues: issue.issues }, [...path, ...issue.path]);
		else if (issue.code === "invalid_element") processError({ issues: issue.issues }, [...path, ...issue.path]);
		else {
			const fullpath = [...path, ...issue.path];
			if (fullpath.length === 0) fieldErrors._errors.push(mapper(issue));
			else {
				let curr = fieldErrors;
				let i = 0;
				while (i < fullpath.length) {
					const el = fullpath[i];
					if (!(i === fullpath.length - 1)) curr[el] = curr[el] || { _errors: [] };
					else {
						curr[el] = curr[el] || { _errors: [] };
						curr[el]._errors.push(mapper(issue));
					}
					curr = curr[el];
					i++;
				}
			}
		}
	};
	processError(error);
	return fieldErrors;
}
//#endregion
//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/parse.js
const _parse = (_Err) => (schema, value, _ctx, _params) => {
	const ctx = _ctx ? {
		..._ctx,
		async: false
	} : { async: false };
	const result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) throw new $ZodAsyncError();
	if (result.issues.length) {
		const e = new ((_params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
		captureStackTrace(e, _params?.callee);
		throw e;
	}
	return result.value;
};
const _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
	const ctx = _ctx ? {
		..._ctx,
		async: true
	} : { async: true };
	let result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) result = await result;
	if (result.issues.length) {
		const e = new ((params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
		captureStackTrace(e, params?.callee);
		throw e;
	}
	return result.value;
};
const _safeParse = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: false
	} : { async: false };
	const result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) throw new $ZodAsyncError();
	return result.issues.length ? {
		success: false,
		error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	} : {
		success: true,
		data: result.value
	};
};
const safeParse$1 = /* @__PURE__*/ _safeParse($ZodRealError);
const _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: true
	} : { async: true };
	let result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) result = await result;
	return result.issues.length ? {
		success: false,
		error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	} : {
		success: true,
		data: result.value
	};
};
const safeParseAsync$1 = /* @__PURE__*/ _safeParseAsync($ZodRealError);
const _encode = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _parse(_Err)(schema, value, ctx);
};
const _decode = (_Err) => (schema, value, _ctx) => {
	return _parse(_Err)(schema, value, _ctx);
};
const _encodeAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _parseAsync(_Err)(schema, value, ctx);
};
const _decodeAsync = (_Err) => async (schema, value, _ctx) => {
	return _parseAsync(_Err)(schema, value, _ctx);
};
const _safeEncode = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _safeParse(_Err)(schema, value, ctx);
};
const _safeDecode = (_Err) => (schema, value, _ctx) => {
	return _safeParse(_Err)(schema, value, _ctx);
};
const _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _safeParseAsync(_Err)(schema, value, ctx);
};
const _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
	return _safeParseAsync(_Err)(schema, value, _ctx);
};
//#endregion
//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/regexes.js
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link cuid2} instead.
* See https://github.com/paralleldrive/cuid.
*/
const cuid = /^[cC][0-9a-z]{6,}$/;
const cuid2 = /^[0-9a-z]+$/;
const ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
const xid = /^[0-9a-vA-V]{20}$/;
const ksuid = /^[A-Za-z0-9]{27}$/;
const nanoid = /^[a-zA-Z0-9_-]{21}$/;
/** ISO 8601-1 duration regex. Does not support the 8601-2 extensions like negative durations or fractional/negative components. */
const duration$1 = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
/** A regex for any UUID-like identifier: 8-4-4-4-12 hex pattern */
const guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
/** Returns a regex for validating an RFC 9562/4122 UUID.
*
* @param version Optionally specify a version 1-8. If no version is specified, all versions are supported. */
const uuid = (version) => {
	if (!version) return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
	return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
/** Practical email validation */
const email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
const _emoji$1 = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
function emoji() {
	return new RegExp(_emoji$1, "u");
}
const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
const ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
const cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
const cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
const base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
const base64url = /^[A-Za-z0-9_-]*$/;
const httpProtocol = /^https?$/;
const e164 = /^\+[1-9]\d{6,14}$/;
const dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
const date$1 = /*@__PURE__*/ new RegExp(`^${dateSource}$`);
function timeSource(args) {
	const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
	return typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function time$1(args) {
	return new RegExp(`^${timeSource(args)}$`);
}
function datetime$1(args) {
	const time = timeSource({ precision: args.precision });
	const opts = ["Z"];
	if (args.local) opts.push("");
	if (args.offset) opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
	const timeRegex = `${time}(?:${opts.join("|")})`;
	return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
const string$1 = (params) => {
	const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
	return new RegExp(`^${regex}$`);
};
const integer = /^-?\d+$/;
const number$1 = /^-?\d+(?:\.\d+)?$/;
const lowercase = /^[^A-Z]*$/;
const uppercase = /^[^a-z]*$/;
//#endregion
//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/checks.js
const $ZodCheck = /*@__PURE__*/ $constructor("$ZodCheck", (inst, def) => {
	var _a;
	inst._zod ?? (inst._zod = {});
	inst._zod.def = def;
	(_a = inst._zod).onattach ?? (_a.onattach = []);
});
const numericOriginMap = {
	number: "number",
	bigint: "bigint",
	object: "date"
};
const $ZodCheckLessThan = /*@__PURE__*/ $constructor("$ZodCheckLessThan", (inst, def) => {
	$ZodCheck.init(inst, def);
	const origin = numericOriginMap[typeof def.value];
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
		if (def.value < curr) {
			if (def.inclusive) bag.maximum = def.value;
			else bag.exclusiveMaximum = def.value;
		}
	});
	inst._zod.check = (payload) => {
		if (def.inclusive ? payload.value <= def.value : payload.value < def.value) return;
		payload.issues.push({
			origin,
			code: "too_big",
			maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
			input: payload.value,
			inclusive: def.inclusive,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckGreaterThan = /*@__PURE__*/ $constructor("$ZodCheckGreaterThan", (inst, def) => {
	$ZodCheck.init(inst, def);
	const origin = numericOriginMap[typeof def.value];
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
		if (def.value > curr) {
			if (def.inclusive) bag.minimum = def.value;
			else bag.exclusiveMinimum = def.value;
		}
	});
	inst._zod.check = (payload) => {
		if (def.inclusive ? payload.value >= def.value : payload.value > def.value) return;
		payload.issues.push({
			origin,
			code: "too_small",
			minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
			input: payload.value,
			inclusive: def.inclusive,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckMultipleOf = /*@__PURE__*/ $constructor("$ZodCheckMultipleOf", (inst, def) => {
	$ZodCheck.init(inst, def);
	inst._zod.onattach.push((inst) => {
		var _a;
		(_a = inst._zod.bag).multipleOf ?? (_a.multipleOf = def.value);
	});
	inst._zod.check = (payload) => {
		if (typeof payload.value !== typeof def.value) throw new Error("Cannot mix number and bigint in multiple_of check.");
		if (typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0) return;
		payload.issues.push({
			origin: typeof payload.value,
			code: "not_multiple_of",
			divisor: def.value,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckNumberFormat = /*@__PURE__*/ $constructor("$ZodCheckNumberFormat", (inst, def) => {
	$ZodCheck.init(inst, def);
	def.format = def.format || "float64";
	const isInt = def.format?.includes("int");
	const origin = isInt ? "int" : "number";
	const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.format = def.format;
		bag.minimum = minimum;
		bag.maximum = maximum;
		if (isInt) bag.pattern = integer;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (isInt) {
			if (!Number.isInteger(input)) {
				payload.issues.push({
					expected: origin,
					format: def.format,
					code: "invalid_type",
					continue: false,
					input,
					inst
				});
				return;
			}
			if (!Number.isSafeInteger(input)) {
				if (input > 0) payload.issues.push({
					input,
					code: "too_big",
					maximum: Number.MAX_SAFE_INTEGER,
					note: "Integers must be within the safe integer range.",
					inst,
					origin,
					inclusive: true,
					continue: !def.abort
				});
				else payload.issues.push({
					input,
					code: "too_small",
					minimum: Number.MIN_SAFE_INTEGER,
					note: "Integers must be within the safe integer range.",
					inst,
					origin,
					inclusive: true,
					continue: !def.abort
				});
				return;
			}
		}
		if (input < minimum) payload.issues.push({
			origin: "number",
			input,
			code: "too_small",
			minimum,
			inclusive: true,
			inst,
			continue: !def.abort
		});
		if (input > maximum) payload.issues.push({
			origin: "number",
			input,
			code: "too_big",
			maximum,
			inclusive: true,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckMaxLength = /*@__PURE__*/ $constructor("$ZodCheckMaxLength", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = (payload) => {
		const val = payload.value;
		return !nullish(val) && val.length !== void 0;
	});
	inst._zod.onattach.push((inst) => {
		const curr = inst._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
		if (def.maximum < curr) inst._zod.bag.maximum = def.maximum;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (input.length <= def.maximum) return;
		const origin = getLengthableOrigin(input);
		payload.issues.push({
			origin,
			code: "too_big",
			maximum: def.maximum,
			inclusive: true,
			input,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckMinLength = /*@__PURE__*/ $constructor("$ZodCheckMinLength", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = (payload) => {
		const val = payload.value;
		return !nullish(val) && val.length !== void 0;
	});
	inst._zod.onattach.push((inst) => {
		const curr = inst._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
		if (def.minimum > curr) inst._zod.bag.minimum = def.minimum;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (input.length >= def.minimum) return;
		const origin = getLengthableOrigin(input);
		payload.issues.push({
			origin,
			code: "too_small",
			minimum: def.minimum,
			inclusive: true,
			input,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckLengthEquals = /*@__PURE__*/ $constructor("$ZodCheckLengthEquals", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = (payload) => {
		const val = payload.value;
		return !nullish(val) && val.length !== void 0;
	});
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.minimum = def.length;
		bag.maximum = def.length;
		bag.length = def.length;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		const length = input.length;
		if (length === def.length) return;
		const origin = getLengthableOrigin(input);
		const tooBig = length > def.length;
		payload.issues.push({
			origin,
			...tooBig ? {
				code: "too_big",
				maximum: def.length
			} : {
				code: "too_small",
				minimum: def.length
			},
			inclusive: true,
			exact: true,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckStringFormat = /*@__PURE__*/ $constructor("$ZodCheckStringFormat", (inst, def) => {
	var _a, _b;
	$ZodCheck.init(inst, def);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.format = def.format;
		if (def.pattern) {
			bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
			bag.patterns.add(def.pattern);
		}
	});
	if (def.pattern) (_a = inst._zod).check ?? (_a.check = (payload) => {
		def.pattern.lastIndex = 0;
		if (def.pattern.test(payload.value)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: def.format,
			input: payload.value,
			...def.pattern ? { pattern: def.pattern.toString() } : {},
			inst,
			continue: !def.abort
		});
	});
	else (_b = inst._zod).check ?? (_b.check = () => {});
});
const $ZodCheckRegex = /*@__PURE__*/ $constructor("$ZodCheckRegex", (inst, def) => {
	$ZodCheckStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		def.pattern.lastIndex = 0;
		if (def.pattern.test(payload.value)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "regex",
			input: payload.value,
			pattern: def.pattern.toString(),
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckLowerCase = /*@__PURE__*/ $constructor("$ZodCheckLowerCase", (inst, def) => {
	def.pattern ?? (def.pattern = lowercase);
	$ZodCheckStringFormat.init(inst, def);
});
const $ZodCheckUpperCase = /*@__PURE__*/ $constructor("$ZodCheckUpperCase", (inst, def) => {
	def.pattern ?? (def.pattern = uppercase);
	$ZodCheckStringFormat.init(inst, def);
});
const $ZodCheckIncludes = /*@__PURE__*/ $constructor("$ZodCheckIncludes", (inst, def) => {
	$ZodCheck.init(inst, def);
	const escapedRegex = escapeRegex(def.includes);
	const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
	def.pattern = pattern;
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.includes(def.includes, def.position)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "includes",
			includes: def.includes,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckStartsWith = /*@__PURE__*/ $constructor("$ZodCheckStartsWith", (inst, def) => {
	$ZodCheck.init(inst, def);
	const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
	def.pattern ?? (def.pattern = pattern);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.startsWith(def.prefix)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "starts_with",
			prefix: def.prefix,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckEndsWith = /*@__PURE__*/ $constructor("$ZodCheckEndsWith", (inst, def) => {
	$ZodCheck.init(inst, def);
	const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
	def.pattern ?? (def.pattern = pattern);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.endsWith(def.suffix)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "ends_with",
			suffix: def.suffix,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckOverwrite = /*@__PURE__*/ $constructor("$ZodCheckOverwrite", (inst, def) => {
	$ZodCheck.init(inst, def);
	inst._zod.check = (payload) => {
		payload.value = def.tx(payload.value);
	};
});
//#endregion
//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/doc.js
var Doc = class {
	constructor(args = []) {
		this.content = [];
		this.indent = 0;
		if (this) this.args = args;
	}
	indented(fn) {
		this.indent += 1;
		fn(this);
		this.indent -= 1;
	}
	write(arg) {
		if (typeof arg === "function") {
			arg(this, { execution: "sync" });
			arg(this, { execution: "async" });
			return;
		}
		const lines = arg.split("\n").filter((x) => x);
		const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
		const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
		for (const line of dedented) this.content.push(line);
	}
	compile() {
		const F = Function;
		const args = this?.args;
		const lines = [...(this?.content ?? [``]).map((x) => `  ${x}`)];
		return new F(...args, lines.join("\n"));
	}
};
//#endregion
//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/versions.js
const version = {
	major: 4,
	minor: 4,
	patch: 3
};
//#endregion
//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/schemas.js
const $ZodType = /*@__PURE__*/ $constructor("$ZodType", (inst, def) => {
	var _a;
	inst ?? (inst = {});
	inst._zod.def = def;
	inst._zod.bag = inst._zod.bag || {};
	inst._zod.version = version;
	const checks = [...inst._zod.def.checks ?? []];
	if (inst._zod.traits.has("$ZodCheck")) checks.unshift(inst);
	for (const ch of checks) for (const fn of ch._zod.onattach) fn(inst);
	if (checks.length === 0) {
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		inst._zod.deferred?.push(() => {
			inst._zod.run = inst._zod.parse;
		});
	} else {
		const runChecks = (payload, checks, ctx) => {
			let isAborted = aborted(payload);
			let asyncResult;
			for (const ch of checks) {
				if (ch._zod.def.when) {
					if (explicitlyAborted(payload)) continue;
					if (!ch._zod.def.when(payload)) continue;
				} else if (isAborted) continue;
				const currLen = payload.issues.length;
				const _ = ch._zod.check(payload);
				if (_ instanceof Promise && ctx?.async === false) throw new $ZodAsyncError();
				if (asyncResult || _ instanceof Promise) asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
					await _;
					if (payload.issues.length === currLen) return;
					if (!isAborted) isAborted = aborted(payload, currLen);
				});
				else {
					if (payload.issues.length === currLen) continue;
					if (!isAborted) isAborted = aborted(payload, currLen);
				}
			}
			if (asyncResult) return asyncResult.then(() => {
				return payload;
			});
			return payload;
		};
		const handleCanaryResult = (canary, payload, ctx) => {
			if (aborted(canary)) {
				canary.aborted = true;
				return canary;
			}
			const checkResult = runChecks(payload, checks, ctx);
			if (checkResult instanceof Promise) {
				if (ctx.async === false) throw new $ZodAsyncError();
				return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
			}
			return inst._zod.parse(checkResult, ctx);
		};
		inst._zod.run = (payload, ctx) => {
			if (ctx.skipChecks) return inst._zod.parse(payload, ctx);
			if (ctx.direction === "backward") {
				const canary = inst._zod.parse({
					value: payload.value,
					issues: []
				}, {
					...ctx,
					skipChecks: true
				});
				if (canary instanceof Promise) return canary.then((canary) => {
					return handleCanaryResult(canary, payload, ctx);
				});
				return handleCanaryResult(canary, payload, ctx);
			}
			const result = inst._zod.parse(payload, ctx);
			if (result instanceof Promise) {
				if (ctx.async === false) throw new $ZodAsyncError();
				return result.then((result) => runChecks(result, checks, ctx));
			}
			return runChecks(result, checks, ctx);
		};
	}
	defineLazy(inst, "~standard", () => ({
		validate: (value) => {
			try {
				const r = safeParse$1(inst, value);
				return r.success ? { value: r.data } : { issues: r.error?.issues };
			} catch (_) {
				return safeParseAsync$1(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
			}
		},
		vendor: "zod",
		version: 1
	}));
});
const $ZodString = /*@__PURE__*/ $constructor("$ZodString", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string$1(inst._zod.bag);
	inst._zod.parse = (payload, _) => {
		if (def.coerce) try {
			payload.value = String(payload.value);
		} catch (_) {}
		if (typeof payload.value === "string") return payload;
		payload.issues.push({
			expected: "string",
			code: "invalid_type",
			input: payload.value,
			inst
		});
		return payload;
	};
});
const $ZodStringFormat = /*@__PURE__*/ $constructor("$ZodStringFormat", (inst, def) => {
	$ZodCheckStringFormat.init(inst, def);
	$ZodString.init(inst, def);
});
const $ZodGUID = /*@__PURE__*/ $constructor("$ZodGUID", (inst, def) => {
	def.pattern ?? (def.pattern = guid);
	$ZodStringFormat.init(inst, def);
});
const $ZodUUID = /*@__PURE__*/ $constructor("$ZodUUID", (inst, def) => {
	if (def.version) {
		const v = {
			v1: 1,
			v2: 2,
			v3: 3,
			v4: 4,
			v5: 5,
			v6: 6,
			v7: 7,
			v8: 8
		}[def.version];
		if (v === void 0) throw new Error(`Invalid UUID version: "${def.version}"`);
		def.pattern ?? (def.pattern = uuid(v));
	} else def.pattern ?? (def.pattern = uuid());
	$ZodStringFormat.init(inst, def);
});
const $ZodEmail = /*@__PURE__*/ $constructor("$ZodEmail", (inst, def) => {
	def.pattern ?? (def.pattern = email);
	$ZodStringFormat.init(inst, def);
});
const $ZodURL = /*@__PURE__*/ $constructor("$ZodURL", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		try {
			const trimmed = payload.value.trim();
			if (!def.normalize && def.protocol?.source === httpProtocol.source) {
				if (!/^https?:\/\//i.test(trimmed)) {
					payload.issues.push({
						code: "invalid_format",
						format: "url",
						note: "Invalid URL format",
						input: payload.value,
						inst,
						continue: !def.abort
					});
					return;
				}
			}
			const url = new URL(trimmed);
			if (def.hostname) {
				def.hostname.lastIndex = 0;
				if (!def.hostname.test(url.hostname)) payload.issues.push({
					code: "invalid_format",
					format: "url",
					note: "Invalid hostname",
					pattern: def.hostname.source,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			}
			if (def.protocol) {
				def.protocol.lastIndex = 0;
				if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) payload.issues.push({
					code: "invalid_format",
					format: "url",
					note: "Invalid protocol",
					pattern: def.protocol.source,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			}
			if (def.normalize) payload.value = url.href;
			else payload.value = trimmed;
			return;
		} catch (_) {
			payload.issues.push({
				code: "invalid_format",
				format: "url",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
const $ZodEmoji = /*@__PURE__*/ $constructor("$ZodEmoji", (inst, def) => {
	def.pattern ?? (def.pattern = emoji());
	$ZodStringFormat.init(inst, def);
});
const $ZodNanoID = /*@__PURE__*/ $constructor("$ZodNanoID", (inst, def) => {
	def.pattern ?? (def.pattern = nanoid);
	$ZodStringFormat.init(inst, def);
});
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
* See https://github.com/paralleldrive/cuid.
*/
const $ZodCUID = /*@__PURE__*/ $constructor("$ZodCUID", (inst, def) => {
	def.pattern ?? (def.pattern = cuid);
	$ZodStringFormat.init(inst, def);
});
const $ZodCUID2 = /*@__PURE__*/ $constructor("$ZodCUID2", (inst, def) => {
	def.pattern ?? (def.pattern = cuid2);
	$ZodStringFormat.init(inst, def);
});
const $ZodULID = /*@__PURE__*/ $constructor("$ZodULID", (inst, def) => {
	def.pattern ?? (def.pattern = ulid);
	$ZodStringFormat.init(inst, def);
});
const $ZodXID = /*@__PURE__*/ $constructor("$ZodXID", (inst, def) => {
	def.pattern ?? (def.pattern = xid);
	$ZodStringFormat.init(inst, def);
});
const $ZodKSUID = /*@__PURE__*/ $constructor("$ZodKSUID", (inst, def) => {
	def.pattern ?? (def.pattern = ksuid);
	$ZodStringFormat.init(inst, def);
});
const $ZodISODateTime = /*@__PURE__*/ $constructor("$ZodISODateTime", (inst, def) => {
	def.pattern ?? (def.pattern = datetime$1(def));
	$ZodStringFormat.init(inst, def);
});
const $ZodISODate = /*@__PURE__*/ $constructor("$ZodISODate", (inst, def) => {
	def.pattern ?? (def.pattern = date$1);
	$ZodStringFormat.init(inst, def);
});
const $ZodISOTime = /*@__PURE__*/ $constructor("$ZodISOTime", (inst, def) => {
	def.pattern ?? (def.pattern = time$1(def));
	$ZodStringFormat.init(inst, def);
});
const $ZodISODuration = /*@__PURE__*/ $constructor("$ZodISODuration", (inst, def) => {
	def.pattern ?? (def.pattern = duration$1);
	$ZodStringFormat.init(inst, def);
});
const $ZodIPv4 = /*@__PURE__*/ $constructor("$ZodIPv4", (inst, def) => {
	def.pattern ?? (def.pattern = ipv4);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.format = `ipv4`;
});
const $ZodIPv6 = /*@__PURE__*/ $constructor("$ZodIPv6", (inst, def) => {
	def.pattern ?? (def.pattern = ipv6);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.format = `ipv6`;
	inst._zod.check = (payload) => {
		try {
			new URL(`http://[${payload.value}]`);
		} catch {
			payload.issues.push({
				code: "invalid_format",
				format: "ipv6",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
const $ZodCIDRv4 = /*@__PURE__*/ $constructor("$ZodCIDRv4", (inst, def) => {
	def.pattern ?? (def.pattern = cidrv4);
	$ZodStringFormat.init(inst, def);
});
const $ZodCIDRv6 = /*@__PURE__*/ $constructor("$ZodCIDRv6", (inst, def) => {
	def.pattern ?? (def.pattern = cidrv6);
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		const parts = payload.value.split("/");
		try {
			if (parts.length !== 2) throw new Error();
			const [address, prefix] = parts;
			if (!prefix) throw new Error();
			const prefixNum = Number(prefix);
			if (`${prefixNum}` !== prefix) throw new Error();
			if (prefixNum < 0 || prefixNum > 128) throw new Error();
			new URL(`http://[${address}]`);
		} catch {
			payload.issues.push({
				code: "invalid_format",
				format: "cidrv6",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
function isValidBase64(data) {
	if (data === "") return true;
	if (/\s/.test(data)) return false;
	if (data.length % 4 !== 0) return false;
	try {
		atob(data);
		return true;
	} catch {
		return false;
	}
}
const $ZodBase64 = /*@__PURE__*/ $constructor("$ZodBase64", (inst, def) => {
	def.pattern ?? (def.pattern = base64);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.contentEncoding = "base64";
	inst._zod.check = (payload) => {
		if (isValidBase64(payload.value)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "base64",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
function isValidBase64URL(data) {
	if (!base64url.test(data)) return false;
	const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
	return isValidBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
}
const $ZodBase64URL = /*@__PURE__*/ $constructor("$ZodBase64URL", (inst, def) => {
	def.pattern ?? (def.pattern = base64url);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.contentEncoding = "base64url";
	inst._zod.check = (payload) => {
		if (isValidBase64URL(payload.value)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "base64url",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodE164 = /*@__PURE__*/ $constructor("$ZodE164", (inst, def) => {
	def.pattern ?? (def.pattern = e164);
	$ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
	try {
		const tokensParts = token.split(".");
		if (tokensParts.length !== 3) return false;
		const [header] = tokensParts;
		if (!header) return false;
		const parsedHeader = JSON.parse(atob(header));
		if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT") return false;
		if (!parsedHeader.alg) return false;
		if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm)) return false;
		return true;
	} catch {
		return false;
	}
}
const $ZodJWT = /*@__PURE__*/ $constructor("$ZodJWT", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		if (isValidJWT(payload.value, def.alg)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "jwt",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodNumber = /*@__PURE__*/ $constructor("$ZodNumber", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = inst._zod.bag.pattern ?? number$1;
	inst._zod.parse = (payload, _ctx) => {
		if (def.coerce) try {
			payload.value = Number(payload.value);
		} catch (_) {}
		const input = payload.value;
		if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) return payload;
		const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : void 0 : void 0;
		payload.issues.push({
			expected: "number",
			code: "invalid_type",
			input,
			inst,
			...received ? { received } : {}
		});
		return payload;
	};
});
const $ZodNumberFormat = /*@__PURE__*/ $constructor("$ZodNumberFormat", (inst, def) => {
	$ZodCheckNumberFormat.init(inst, def);
	$ZodNumber.init(inst, def);
});
const $ZodUnknown = /*@__PURE__*/ $constructor("$ZodUnknown", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload) => payload;
});
const $ZodNever = /*@__PURE__*/ $constructor("$ZodNever", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, _ctx) => {
		payload.issues.push({
			expected: "never",
			code: "invalid_type",
			input: payload.value,
			inst
		});
		return payload;
	};
});
function handleArrayResult(result, final, index) {
	if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
	final.value[index] = result.value;
}
const $ZodArray = /*@__PURE__*/ $constructor("$ZodArray", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!Array.isArray(input)) {
			payload.issues.push({
				expected: "array",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		payload.value = Array(input.length);
		const proms = [];
		for (let i = 0; i < input.length; i++) {
			const item = input[i];
			const result = def.element._zod.run({
				value: item,
				issues: []
			}, ctx);
			if (result instanceof Promise) proms.push(result.then((result) => handleArrayResult(result, payload, i)));
			else handleArrayResult(result, payload, i);
		}
		if (proms.length) return Promise.all(proms).then(() => payload);
		return payload;
	};
});
function handlePropertyResult(result, final, key, input, isOptionalIn, isOptionalOut) {
	const isPresent = key in input;
	if (result.issues.length) {
		if (isOptionalIn && isOptionalOut && !isPresent) return;
		final.issues.push(...prefixIssues(key, result.issues));
	}
	if (!isPresent && !isOptionalIn) {
		if (!result.issues.length) final.issues.push({
			code: "invalid_type",
			expected: "nonoptional",
			input: void 0,
			path: [key]
		});
		return;
	}
	if (result.value === void 0) {
		if (isPresent) final.value[key] = void 0;
	} else final.value[key] = result.value;
}
function normalizeDef(def) {
	const keys = Object.keys(def.shape);
	for (const k of keys) if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
	const okeys = optionalKeys(def.shape);
	return {
		...def,
		keys,
		keySet: new Set(keys),
		numKeys: keys.length,
		optionalKeys: new Set(okeys)
	};
}
function handleCatchall(proms, input, payload, ctx, def, inst) {
	const unrecognized = [];
	const keySet = def.keySet;
	const _catchall = def.catchall._zod;
	const t = _catchall.def.type;
	const isOptionalIn = _catchall.optin === "optional";
	const isOptionalOut = _catchall.optout === "optional";
	for (const key in input) {
		if (key === "__proto__") continue;
		if (keySet.has(key)) continue;
		if (t === "never") {
			unrecognized.push(key);
			continue;
		}
		const r = _catchall.run({
			value: input[key],
			issues: []
		}, ctx);
		if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
		else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
	}
	if (unrecognized.length) payload.issues.push({
		code: "unrecognized_keys",
		keys: unrecognized,
		input,
		inst
	});
	if (!proms.length) return payload;
	return Promise.all(proms).then(() => {
		return payload;
	});
}
const $ZodObject = /*@__PURE__*/ $constructor("$ZodObject", (inst, def) => {
	$ZodType.init(inst, def);
	if (!Object.getOwnPropertyDescriptor(def, "shape")?.get) {
		const sh = def.shape;
		Object.defineProperty(def, "shape", { get: () => {
			const newSh = { ...sh };
			Object.defineProperty(def, "shape", { value: newSh });
			return newSh;
		} });
	}
	const _normalized = cached(() => normalizeDef(def));
	defineLazy(inst._zod, "propValues", () => {
		const shape = def.shape;
		const propValues = {};
		for (const key in shape) {
			const field = shape[key]._zod;
			if (field.values) {
				propValues[key] ?? (propValues[key] = /* @__PURE__ */ new Set());
				for (const v of field.values) propValues[key].add(v);
			}
		}
		return propValues;
	});
	const isObject$1 = isObject;
	const catchall = def.catchall;
	let value;
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject$1(input)) {
			payload.issues.push({
				expected: "object",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		payload.value = {};
		const proms = [];
		const shape = value.shape;
		for (const key of value.keys) {
			const el = shape[key];
			const isOptionalIn = el._zod.optin === "optional";
			const isOptionalOut = el._zod.optout === "optional";
			const r = el._zod.run({
				value: input[key],
				issues: []
			}, ctx);
			if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
			else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
		}
		if (!catchall) return proms.length ? Promise.all(proms).then(() => payload) : payload;
		return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
	};
});
const $ZodObjectJIT = /*@__PURE__*/ $constructor("$ZodObjectJIT", (inst, def) => {
	$ZodObject.init(inst, def);
	const superParse = inst._zod.parse;
	const _normalized = cached(() => normalizeDef(def));
	const generateFastpass = (shape) => {
		const doc = new Doc([
			"shape",
			"payload",
			"ctx"
		]);
		const normalized = _normalized.value;
		const parseStr = (key) => {
			const k = esc(key);
			return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
		};
		doc.write(`const input = payload.value;`);
		const ids = Object.create(null);
		let counter = 0;
		for (const key of normalized.keys) ids[key] = `key_${counter++}`;
		doc.write(`const newResult = {};`);
		for (const key of normalized.keys) {
			const id = ids[key];
			const k = esc(key);
			const schema = shape[key];
			const isOptionalIn = schema?._zod?.optin === "optional";
			const isOptionalOut = schema?._zod?.optout === "optional";
			doc.write(`const ${id} = ${parseStr(key)};`);
			if (isOptionalIn && isOptionalOut) doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
			else if (!isOptionalIn) doc.write(`
        const ${id}_present = ${k} in input;
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          if (${id}.value === undefined) {
            newResult[${k}] = undefined;
          } else {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
			else doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
		}
		doc.write(`payload.value = newResult;`);
		doc.write(`return payload;`);
		const fn = doc.compile();
		return (payload, ctx) => fn(shape, payload, ctx);
	};
	let fastpass;
	const isObject$2 = isObject;
	const jit = !globalConfig.jitless;
	const fastEnabled = jit && allowsEval.value;
	const catchall = def.catchall;
	let value;
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject$2(input)) {
			payload.issues.push({
				expected: "object",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
			if (!fastpass) fastpass = generateFastpass(def.shape);
			payload = fastpass(payload, ctx);
			if (!catchall) return payload;
			return handleCatchall([], input, payload, ctx, value, inst);
		}
		return superParse(payload, ctx);
	};
});
function handleUnionResults(results, final, inst, ctx) {
	for (const result of results) if (result.issues.length === 0) {
		final.value = result.value;
		return final;
	}
	const nonaborted = results.filter((r) => !aborted(r));
	if (nonaborted.length === 1) {
		final.value = nonaborted[0].value;
		return nonaborted[0];
	}
	final.issues.push({
		code: "invalid_union",
		input: final.value,
		inst,
		errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	});
	return final;
}
const $ZodUnion = /*@__PURE__*/ $constructor("$ZodUnion", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0);
	defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
	defineLazy(inst._zod, "values", () => {
		if (def.options.every((o) => o._zod.values)) return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
	});
	defineLazy(inst._zod, "pattern", () => {
		if (def.options.every((o) => o._zod.pattern)) {
			const patterns = def.options.map((o) => o._zod.pattern);
			return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
		}
	});
	const first = def.options.length === 1 ? def.options[0]._zod.run : null;
	inst._zod.parse = (payload, ctx) => {
		if (first) return first(payload, ctx);
		let async = false;
		const results = [];
		for (const option of def.options) {
			const result = option._zod.run({
				value: payload.value,
				issues: []
			}, ctx);
			if (result instanceof Promise) {
				results.push(result);
				async = true;
			} else {
				if (result.issues.length === 0) return result;
				results.push(result);
			}
		}
		if (!async) return handleUnionResults(results, payload, inst, ctx);
		return Promise.all(results).then((results) => {
			return handleUnionResults(results, payload, inst, ctx);
		});
	};
});
const $ZodIntersection = /*@__PURE__*/ $constructor("$ZodIntersection", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		const left = def.left._zod.run({
			value: input,
			issues: []
		}, ctx);
		const right = def.right._zod.run({
			value: input,
			issues: []
		}, ctx);
		if (left instanceof Promise || right instanceof Promise) return Promise.all([left, right]).then(([left, right]) => {
			return handleIntersectionResults(payload, left, right);
		});
		return handleIntersectionResults(payload, left, right);
	};
});
function mergeValues(a, b) {
	if (a === b) return {
		valid: true,
		data: a
	};
	if (a instanceof Date && b instanceof Date && +a === +b) return {
		valid: true,
		data: a
	};
	if (isPlainObject(a) && isPlainObject(b)) {
		const bKeys = Object.keys(b);
		const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
		const newObj = {
			...a,
			...b
		};
		for (const key of sharedKeys) {
			const sharedValue = mergeValues(a[key], b[key]);
			if (!sharedValue.valid) return {
				valid: false,
				mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
			};
			newObj[key] = sharedValue.data;
		}
		return {
			valid: true,
			data: newObj
		};
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return {
			valid: false,
			mergeErrorPath: []
		};
		const newArray = [];
		for (let index = 0; index < a.length; index++) {
			const itemA = a[index];
			const itemB = b[index];
			const sharedValue = mergeValues(itemA, itemB);
			if (!sharedValue.valid) return {
				valid: false,
				mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
			};
			newArray.push(sharedValue.data);
		}
		return {
			valid: true,
			data: newArray
		};
	}
	return {
		valid: false,
		mergeErrorPath: []
	};
}
function handleIntersectionResults(result, left, right) {
	const unrecKeys = /* @__PURE__ */ new Map();
	let unrecIssue;
	for (const iss of left.issues) if (iss.code === "unrecognized_keys") {
		unrecIssue ?? (unrecIssue = iss);
		for (const k of iss.keys) {
			if (!unrecKeys.has(k)) unrecKeys.set(k, {});
			unrecKeys.get(k).l = true;
		}
	} else result.issues.push(iss);
	for (const iss of right.issues) if (iss.code === "unrecognized_keys") for (const k of iss.keys) {
		if (!unrecKeys.has(k)) unrecKeys.set(k, {});
		unrecKeys.get(k).r = true;
	}
	else result.issues.push(iss);
	const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
	if (bothKeys.length && unrecIssue) result.issues.push({
		...unrecIssue,
		keys: bothKeys
	});
	if (aborted(result)) return result;
	const merged = mergeValues(left.value, right.value);
	if (!merged.valid) throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
	result.value = merged.data;
	return result;
}
const $ZodEnum = /*@__PURE__*/ $constructor("$ZodEnum", (inst, def) => {
	$ZodType.init(inst, def);
	const values = getEnumValues(def.entries);
	const valuesSet = new Set(values);
	inst._zod.values = valuesSet;
	inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
	inst._zod.parse = (payload, _ctx) => {
		const input = payload.value;
		if (valuesSet.has(input)) return payload;
		payload.issues.push({
			code: "invalid_value",
			values,
			input,
			inst
		});
		return payload;
	};
});
const $ZodLiteral = /*@__PURE__*/ $constructor("$ZodLiteral", (inst, def) => {
	$ZodType.init(inst, def);
	if (def.values.length === 0) throw new Error("Cannot create literal schema with no valid values");
	const values = new Set(def.values);
	inst._zod.values = values;
	inst._zod.pattern = new RegExp(`^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$`);
	inst._zod.parse = (payload, _ctx) => {
		const input = payload.value;
		if (values.has(input)) return payload;
		payload.issues.push({
			code: "invalid_value",
			values: def.values,
			input,
			inst
		});
		return payload;
	};
});
const $ZodTransform = /*@__PURE__*/ $constructor("$ZodTransform", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
		const _out = def.transform(payload.value, payload);
		if (ctx.async) return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => {
			payload.value = output;
			payload.fallback = true;
			return payload;
		});
		if (_out instanceof Promise) throw new $ZodAsyncError();
		payload.value = _out;
		payload.fallback = true;
		return payload;
	};
});
function handleOptionalResult(result, input) {
	if (input === void 0 && (result.issues.length || result.fallback)) return {
		issues: [],
		value: void 0
	};
	return result;
}
const $ZodOptional = /*@__PURE__*/ $constructor("$ZodOptional", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	inst._zod.optout = "optional";
	defineLazy(inst._zod, "values", () => {
		return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, void 0]) : void 0;
	});
	defineLazy(inst._zod, "pattern", () => {
		const pattern = def.innerType._zod.pattern;
		return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		if (def.innerType._zod.optin === "optional") {
			const input = payload.value;
			const result = def.innerType._zod.run(payload, ctx);
			if (result instanceof Promise) return result.then((r) => handleOptionalResult(r, input));
			return handleOptionalResult(result, input);
		}
		if (payload.value === void 0) return payload;
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodExactOptional = /*@__PURE__*/ $constructor("$ZodExactOptional", (inst, def) => {
	$ZodOptional.init(inst, def);
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
	inst._zod.parse = (payload, ctx) => {
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodNullable = /*@__PURE__*/ $constructor("$ZodNullable", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
	defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
	defineLazy(inst._zod, "pattern", () => {
		const pattern = def.innerType._zod.pattern;
		return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
	});
	defineLazy(inst._zod, "values", () => {
		return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, null]) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		if (payload.value === null) return payload;
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodDefault = /*@__PURE__*/ $constructor("$ZodDefault", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		if (payload.value === void 0) {
			payload.value = def.defaultValue;
			/**
			* $ZodDefault returns the default value immediately in forward direction.
			* It doesn't pass the default value into the validator ("prefault"). There's no reason to pass the default value through validation. The validity of the default is enforced by TypeScript statically. Otherwise, it's the responsibility of the user to ensure the default is valid. In the case of pipes with divergent in/out types, you can specify the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.   */
			return payload;
		}
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => handleDefaultResult(result, def));
		return handleDefaultResult(result, def);
	};
});
function handleDefaultResult(payload, def) {
	if (payload.value === void 0) payload.value = def.defaultValue;
	return payload;
}
const $ZodPrefault = /*@__PURE__*/ $constructor("$ZodPrefault", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		if (payload.value === void 0) payload.value = def.defaultValue;
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodNonOptional = /*@__PURE__*/ $constructor("$ZodNonOptional", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "values", () => {
		const v = def.innerType._zod.values;
		return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => handleNonOptionalResult(result, inst));
		return handleNonOptionalResult(result, inst);
	};
});
function handleNonOptionalResult(payload, inst) {
	if (!payload.issues.length && payload.value === void 0) payload.issues.push({
		code: "invalid_type",
		expected: "nonoptional",
		input: payload.value,
		inst
	});
	return payload;
}
const $ZodCatch = /*@__PURE__*/ $constructor("$ZodCatch", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => {
			payload.value = result.value;
			if (result.issues.length) {
				payload.value = def.catchValue({
					...payload,
					error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
					input: payload.value
				});
				payload.issues = [];
				payload.fallback = true;
			}
			return payload;
		});
		payload.value = result.value;
		if (result.issues.length) {
			payload.value = def.catchValue({
				...payload,
				error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
				input: payload.value
			});
			payload.issues = [];
			payload.fallback = true;
		}
		return payload;
	};
});
const $ZodPipe = /*@__PURE__*/ $constructor("$ZodPipe", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "values", () => def.in._zod.values);
	defineLazy(inst._zod, "optin", () => def.in._zod.optin);
	defineLazy(inst._zod, "optout", () => def.out._zod.optout);
	defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") {
			const right = def.out._zod.run(payload, ctx);
			if (right instanceof Promise) return right.then((right) => handlePipeResult(right, def.in, ctx));
			return handlePipeResult(right, def.in, ctx);
		}
		const left = def.in._zod.run(payload, ctx);
		if (left instanceof Promise) return left.then((left) => handlePipeResult(left, def.out, ctx));
		return handlePipeResult(left, def.out, ctx);
	};
});
function handlePipeResult(left, next, ctx) {
	if (left.issues.length) {
		left.aborted = true;
		return left;
	}
	return next._zod.run({
		value: left.value,
		issues: left.issues,
		fallback: left.fallback
	}, ctx);
}
const $ZodReadonly = /*@__PURE__*/ $constructor("$ZodReadonly", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
	defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then(handleReadonlyResult);
		return handleReadonlyResult(result);
	};
});
function handleReadonlyResult(payload) {
	payload.value = Object.freeze(payload.value);
	return payload;
}
const $ZodCustom = /*@__PURE__*/ $constructor("$ZodCustom", (inst, def) => {
	$ZodCheck.init(inst, def);
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, _) => {
		return payload;
	};
	inst._zod.check = (payload) => {
		const input = payload.value;
		const r = def.fn(input);
		if (r instanceof Promise) return r.then((r) => handleRefineResult(r, payload, input, inst));
		handleRefineResult(r, payload, input, inst);
	};
});
function handleRefineResult(result, payload, input, inst) {
	if (!result) {
		const _iss = {
			code: "custom",
			input,
			inst,
			path: [...inst._zod.def.path ?? []],
			continue: !inst._zod.def.abort
		};
		if (inst._zod.def.params) _iss.params = inst._zod.def.params;
		payload.issues.push(issue(_iss));
	}
}
//#endregion
//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/registries.js
var _a;
var $ZodRegistry = class {
	constructor() {
		this._map = /* @__PURE__ */ new WeakMap();
		this._idmap = /* @__PURE__ */ new Map();
	}
	add(schema, ..._meta) {
		const meta = _meta[0];
		this._map.set(schema, meta);
		if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
		return this;
	}
	clear() {
		this._map = /* @__PURE__ */ new WeakMap();
		this._idmap = /* @__PURE__ */ new Map();
		return this;
	}
	remove(schema) {
		const meta = this._map.get(schema);
		if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
		this._map.delete(schema);
		return this;
	}
	get(schema) {
		const p = schema._zod.parent;
		if (p) {
			const pm = { ...this.get(p) ?? {} };
			delete pm.id;
			const f = {
				...pm,
				...this._map.get(schema)
			};
			return Object.keys(f).length ? f : void 0;
		}
		return this._map.get(schema);
	}
	has(schema) {
		return this._map.has(schema);
	}
};
function registry() {
	return new $ZodRegistry();
}
(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
const globalRegistry = globalThis.__zod_globalRegistry;
//#endregion
//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/api.js
// @__NO_SIDE_EFFECTS__
function _string(Class, params) {
	return new Class({
		type: "string",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _email(Class, params) {
	return new Class({
		type: "string",
		format: "email",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _guid(Class, params) {
	return new Class({
		type: "string",
		format: "guid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuid(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv4(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v4",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv6(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v6",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv7(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v7",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _url(Class, params) {
	return new Class({
		type: "string",
		format: "url",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _emoji(Class, params) {
	return new Class({
		type: "string",
		format: "emoji",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _nanoid(Class, params) {
	return new Class({
		type: "string",
		format: "nanoid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link _cuid2} instead.
* See https://github.com/paralleldrive/cuid.
*/
// @__NO_SIDE_EFFECTS__
function _cuid(Class, params) {
	return new Class({
		type: "string",
		format: "cuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cuid2(Class, params) {
	return new Class({
		type: "string",
		format: "cuid2",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ulid(Class, params) {
	return new Class({
		type: "string",
		format: "ulid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _xid(Class, params) {
	return new Class({
		type: "string",
		format: "xid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ksuid(Class, params) {
	return new Class({
		type: "string",
		format: "ksuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ipv4(Class, params) {
	return new Class({
		type: "string",
		format: "ipv4",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ipv6(Class, params) {
	return new Class({
		type: "string",
		format: "ipv6",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cidrv4(Class, params) {
	return new Class({
		type: "string",
		format: "cidrv4",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cidrv6(Class, params) {
	return new Class({
		type: "string",
		format: "cidrv6",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _base64(Class, params) {
	return new Class({
		type: "string",
		format: "base64",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _base64url(Class, params) {
	return new Class({
		type: "string",
		format: "base64url",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _e164(Class, params) {
	return new Class({
		type: "string",
		format: "e164",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _jwt(Class, params) {
	return new Class({
		type: "string",
		format: "jwt",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDateTime(Class, params) {
	return new Class({
		type: "string",
		format: "datetime",
		check: "string_format",
		offset: false,
		local: false,
		precision: null,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDate(Class, params) {
	return new Class({
		type: "string",
		format: "date",
		check: "string_format",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoTime(Class, params) {
	return new Class({
		type: "string",
		format: "time",
		check: "string_format",
		precision: null,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDuration(Class, params) {
	return new Class({
		type: "string",
		format: "duration",
		check: "string_format",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _number(Class, params) {
	return new Class({
		type: "number",
		checks: [],
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _int(Class, params) {
	return new Class({
		type: "number",
		check: "number_format",
		abort: false,
		format: "safeint",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _unknown(Class) {
	return new Class({ type: "unknown" });
}
// @__NO_SIDE_EFFECTS__
function _never(Class, params) {
	return new Class({
		type: "never",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _lt(value, params) {
	return new $ZodCheckLessThan({
		check: "less_than",
		...normalizeParams(params),
		value,
		inclusive: false
	});
}
// @__NO_SIDE_EFFECTS__
function _lte(value, params) {
	return new $ZodCheckLessThan({
		check: "less_than",
		...normalizeParams(params),
		value,
		inclusive: true
	});
}
// @__NO_SIDE_EFFECTS__
function _gt(value, params) {
	return new $ZodCheckGreaterThan({
		check: "greater_than",
		...normalizeParams(params),
		value,
		inclusive: false
	});
}
// @__NO_SIDE_EFFECTS__
function _gte(value, params) {
	return new $ZodCheckGreaterThan({
		check: "greater_than",
		...normalizeParams(params),
		value,
		inclusive: true
	});
}
// @__NO_SIDE_EFFECTS__
function _multipleOf(value, params) {
	return new $ZodCheckMultipleOf({
		check: "multiple_of",
		...normalizeParams(params),
		value
	});
}
// @__NO_SIDE_EFFECTS__
function _maxLength(maximum, params) {
	return new $ZodCheckMaxLength({
		check: "max_length",
		...normalizeParams(params),
		maximum
	});
}
// @__NO_SIDE_EFFECTS__
function _minLength(minimum, params) {
	return new $ZodCheckMinLength({
		check: "min_length",
		...normalizeParams(params),
		minimum
	});
}
// @__NO_SIDE_EFFECTS__
function _length(length, params) {
	return new $ZodCheckLengthEquals({
		check: "length_equals",
		...normalizeParams(params),
		length
	});
}
// @__NO_SIDE_EFFECTS__
function _regex(pattern, params) {
	return new $ZodCheckRegex({
		check: "string_format",
		format: "regex",
		...normalizeParams(params),
		pattern
	});
}
// @__NO_SIDE_EFFECTS__
function _lowercase(params) {
	return new $ZodCheckLowerCase({
		check: "string_format",
		format: "lowercase",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uppercase(params) {
	return new $ZodCheckUpperCase({
		check: "string_format",
		format: "uppercase",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _includes(includes, params) {
	return new $ZodCheckIncludes({
		check: "string_format",
		format: "includes",
		...normalizeParams(params),
		includes
	});
}
// @__NO_SIDE_EFFECTS__
function _startsWith(prefix, params) {
	return new $ZodCheckStartsWith({
		check: "string_format",
		format: "starts_with",
		...normalizeParams(params),
		prefix
	});
}
// @__NO_SIDE_EFFECTS__
function _endsWith(suffix, params) {
	return new $ZodCheckEndsWith({
		check: "string_format",
		format: "ends_with",
		...normalizeParams(params),
		suffix
	});
}
// @__NO_SIDE_EFFECTS__
function _overwrite(tx) {
	return new $ZodCheckOverwrite({
		check: "overwrite",
		tx
	});
}
// @__NO_SIDE_EFFECTS__
function _normalize(form) {
	return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
}
// @__NO_SIDE_EFFECTS__
function _trim() {
	return /* @__PURE__ */ _overwrite((input) => input.trim());
}
// @__NO_SIDE_EFFECTS__
function _toLowerCase() {
	return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function _toUpperCase() {
	return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function _slugify() {
	return /* @__PURE__ */ _overwrite((input) => slugify(input));
}
// @__NO_SIDE_EFFECTS__
function _array(Class, element, params) {
	return new Class({
		type: "array",
		element,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _refine(Class, fn, _params) {
	return new Class({
		type: "custom",
		check: "custom",
		fn,
		...normalizeParams(_params)
	});
}
// @__NO_SIDE_EFFECTS__
function _superRefine(fn, params) {
	const ch = /* @__PURE__ */ _check((payload) => {
		payload.addIssue = (issue$2) => {
			if (typeof issue$2 === "string") payload.issues.push(issue(issue$2, payload.value, ch._zod.def));
			else {
				const _issue = issue$2;
				if (_issue.fatal) _issue.continue = false;
				_issue.code ?? (_issue.code = "custom");
				_issue.input ?? (_issue.input = payload.value);
				_issue.inst ?? (_issue.inst = ch);
				_issue.continue ?? (_issue.continue = !ch._zod.def.abort);
				payload.issues.push(issue(_issue));
			}
		};
		return fn(payload.value, payload);
	}, params);
	return ch;
}
// @__NO_SIDE_EFFECTS__
function _check(fn, params) {
	const ch = new $ZodCheck({
		check: "custom",
		...normalizeParams(params)
	});
	ch._zod.check = fn;
	return ch;
}
//#endregion
//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/to-json-schema.js
function initializeContext(params) {
	let target = params?.target ?? "draft-2020-12";
	if (target === "draft-4") target = "draft-04";
	if (target === "draft-7") target = "draft-07";
	return {
		processors: params.processors ?? {},
		metadataRegistry: params?.metadata ?? globalRegistry,
		target,
		unrepresentable: params?.unrepresentable ?? "throw",
		override: params?.override ?? (() => {}),
		io: params?.io ?? "output",
		counter: 0,
		seen: /* @__PURE__ */ new Map(),
		cycles: params?.cycles ?? "ref",
		reused: params?.reused ?? "inline",
		external: params?.external ?? void 0
	};
}
function process(schema, ctx, _params = {
	path: [],
	schemaPath: []
}) {
	var _a;
	const def = schema._zod.def;
	const seen = ctx.seen.get(schema);
	if (seen) {
		seen.count++;
		if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
		return seen.schema;
	}
	const result = {
		schema: {},
		count: 1,
		cycle: void 0,
		path: _params.path
	};
	ctx.seen.set(schema, result);
	const overrideSchema = schema._zod.toJSONSchema?.();
	if (overrideSchema) result.schema = overrideSchema;
	else {
		const params = {
			..._params,
			schemaPath: [..._params.schemaPath, schema],
			path: _params.path
		};
		if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
		else {
			const _json = result.schema;
			const processor = ctx.processors[def.type];
			if (!processor) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
			processor(schema, ctx, _json, params);
		}
		const parent = schema._zod.parent;
		if (parent) {
			if (!result.ref) result.ref = parent;
			process(parent, ctx, params);
			ctx.seen.get(parent).isParent = true;
		}
	}
	const meta = ctx.metadataRegistry.get(schema);
	if (meta) Object.assign(result.schema, meta);
	if (ctx.io === "input" && isTransforming(schema)) {
		delete result.schema.examples;
		delete result.schema.default;
	}
	if (ctx.io === "input" && "_prefault" in result.schema) (_a = result.schema).default ?? (_a.default = result.schema._prefault);
	delete result.schema._prefault;
	return ctx.seen.get(schema).schema;
}
function extractDefs(ctx, schema) {
	const root = ctx.seen.get(schema);
	if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
	const idToSchema = /* @__PURE__ */ new Map();
	for (const entry of ctx.seen.entries()) {
		const id = ctx.metadataRegistry.get(entry[0])?.id;
		if (id) {
			const existing = idToSchema.get(id);
			if (existing && existing !== entry[0]) throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
			idToSchema.set(id, entry[0]);
		}
	}
	const makeURI = (entry) => {
		const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
		if (ctx.external) {
			const externalId = ctx.external.registry.get(entry[0])?.id;
			const uriGenerator = ctx.external.uri ?? ((id) => id);
			if (externalId) return { ref: uriGenerator(externalId) };
			const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
			entry[1].defId = id;
			return {
				defId: id,
				ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}`
			};
		}
		if (entry[1] === root) return { ref: "#" };
		const defUriPrefix = `#/${defsSegment}/`;
		const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
		return {
			defId,
			ref: defUriPrefix + defId
		};
	};
	const extractToDef = (entry) => {
		if (entry[1].schema.$ref) return;
		const seen = entry[1];
		const { ref, defId } = makeURI(entry);
		seen.def = { ...seen.schema };
		if (defId) seen.defId = defId;
		const schema = seen.schema;
		for (const key in schema) delete schema[key];
		schema.$ref = ref;
	};
	if (ctx.cycles === "throw") for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (seen.cycle) throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
	}
	for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (schema === entry[0]) {
			extractToDef(entry);
			continue;
		}
		if (ctx.external) {
			const ext = ctx.external.registry.get(entry[0])?.id;
			if (schema !== entry[0] && ext) {
				extractToDef(entry);
				continue;
			}
		}
		if (ctx.metadataRegistry.get(entry[0])?.id) {
			extractToDef(entry);
			continue;
		}
		if (seen.cycle) {
			extractToDef(entry);
			continue;
		}
		if (seen.count > 1) {
			if (ctx.reused === "ref") {
				extractToDef(entry);
				continue;
			}
		}
	}
}
function finalize(ctx, schema) {
	const root = ctx.seen.get(schema);
	if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
	const flattenRef = (zodSchema) => {
		const seen = ctx.seen.get(zodSchema);
		if (seen.ref === null) return;
		const schema = seen.def ?? seen.schema;
		const _cached = { ...schema };
		const ref = seen.ref;
		seen.ref = null;
		if (ref) {
			flattenRef(ref);
			const refSeen = ctx.seen.get(ref);
			const refSchema = refSeen.schema;
			if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
				schema.allOf = schema.allOf ?? [];
				schema.allOf.push(refSchema);
			} else Object.assign(schema, refSchema);
			Object.assign(schema, _cached);
			if (zodSchema._zod.parent === ref) for (const key in schema) {
				if (key === "$ref" || key === "allOf") continue;
				if (!(key in _cached)) delete schema[key];
			}
			if (refSchema.$ref && refSeen.def) for (const key in schema) {
				if (key === "$ref" || key === "allOf") continue;
				if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) delete schema[key];
			}
		}
		const parent = zodSchema._zod.parent;
		if (parent && parent !== ref) {
			flattenRef(parent);
			const parentSeen = ctx.seen.get(parent);
			if (parentSeen?.schema.$ref) {
				schema.$ref = parentSeen.schema.$ref;
				if (parentSeen.def) for (const key in schema) {
					if (key === "$ref" || key === "allOf") continue;
					if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) delete schema[key];
				}
			}
		}
		ctx.override({
			zodSchema,
			jsonSchema: schema,
			path: seen.path ?? []
		});
	};
	for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
	const result = {};
	if (ctx.target === "draft-2020-12") result.$schema = "https://json-schema.org/draft/2020-12/schema";
	else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
	else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
	else if (ctx.target === "openapi-3.0") {}
	if (ctx.external?.uri) {
		const id = ctx.external.registry.get(schema)?.id;
		if (!id) throw new Error("Schema is missing an `id` property");
		result.$id = ctx.external.uri(id);
	}
	Object.assign(result, root.def ?? root.schema);
	const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
	if (rootMetaId !== void 0 && result.id === rootMetaId) delete result.id;
	const defs = ctx.external?.defs ?? {};
	for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (seen.def && seen.defId) {
			if (seen.def.id === seen.defId) delete seen.def.id;
			defs[seen.defId] = seen.def;
		}
	}
	if (ctx.external) {} else if (Object.keys(defs).length > 0) {
		if (ctx.target === "draft-2020-12") result.$defs = defs;
		else result.definitions = defs;
	}
	try {
		const finalized = JSON.parse(JSON.stringify(result));
		Object.defineProperty(finalized, "~standard", {
			value: {
				...schema["~standard"],
				jsonSchema: {
					input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
					output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
				}
			},
			enumerable: false,
			writable: false
		});
		return finalized;
	} catch (_err) {
		throw new Error("Error converting schema to JSON.");
	}
}
function isTransforming(_schema, _ctx) {
	const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
	if (ctx.seen.has(_schema)) return false;
	ctx.seen.add(_schema);
	const def = _schema._zod.def;
	if (def.type === "transform") return true;
	if (def.type === "array") return isTransforming(def.element, ctx);
	if (def.type === "set") return isTransforming(def.valueType, ctx);
	if (def.type === "lazy") return isTransforming(def.getter(), ctx);
	if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") return isTransforming(def.innerType, ctx);
	if (def.type === "intersection") return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
	if (def.type === "record" || def.type === "map") return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
	if (def.type === "pipe") {
		if (_schema._zod.traits.has("$ZodCodec")) return true;
		return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
	}
	if (def.type === "object") {
		for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
		return false;
	}
	if (def.type === "union") {
		for (const option of def.options) if (isTransforming(option, ctx)) return true;
		return false;
	}
	if (def.type === "tuple") {
		for (const item of def.items) if (isTransforming(item, ctx)) return true;
		if (def.rest && isTransforming(def.rest, ctx)) return true;
		return false;
	}
	return false;
}
/**
* Creates a toJSONSchema method for a schema instance.
* This encapsulates the logic of initializing context, processing, extracting defs, and finalizing.
*/
const createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
	const ctx = initializeContext({
		...params,
		processors
	});
	process(schema, ctx);
	extractDefs(ctx, schema);
	return finalize(ctx, schema);
};
const createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
	const { libraryOptions, target } = params ?? {};
	const ctx = initializeContext({
		...libraryOptions ?? {},
		target,
		io,
		processors
	});
	process(schema, ctx);
	extractDefs(ctx, schema);
	return finalize(ctx, schema);
};
//#endregion
//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/json-schema-processors.js
const formatMap = {
	guid: "uuid",
	url: "uri",
	datetime: "date-time",
	json_string: "json-string",
	regex: ""
};
const stringProcessor = (schema, ctx, _json, _params) => {
	const json = _json;
	json.type = "string";
	const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
	if (typeof minimum === "number") json.minLength = minimum;
	if (typeof maximum === "number") json.maxLength = maximum;
	if (format) {
		json.format = formatMap[format] ?? format;
		if (json.format === "") delete json.format;
		if (format === "time") delete json.format;
	}
	if (contentEncoding) json.contentEncoding = contentEncoding;
	if (patterns && patterns.size > 0) {
		const regexes = [...patterns];
		if (regexes.length === 1) json.pattern = regexes[0].source;
		else if (regexes.length > 1) json.allOf = [...regexes.map((regex) => ({
			...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
			pattern: regex.source
		}))];
	}
};
const numberProcessor = (schema, ctx, _json, _params) => {
	const json = _json;
	const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema._zod.bag;
	if (typeof format === "string" && format.includes("int")) json.type = "integer";
	else json.type = "number";
	const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
	const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
	const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
	if (exMin) {
		if (legacy) {
			json.minimum = exclusiveMinimum;
			json.exclusiveMinimum = true;
		} else json.exclusiveMinimum = exclusiveMinimum;
	} else if (typeof minimum === "number") json.minimum = minimum;
	if (exMax) {
		if (legacy) {
			json.maximum = exclusiveMaximum;
			json.exclusiveMaximum = true;
		} else json.exclusiveMaximum = exclusiveMaximum;
	} else if (typeof maximum === "number") json.maximum = maximum;
	if (typeof multipleOf === "number") json.multipleOf = multipleOf;
};
const neverProcessor = (_schema, _ctx, json, _params) => {
	json.not = {};
};
const enumProcessor = (schema, _ctx, json, _params) => {
	const def = schema._zod.def;
	const values = getEnumValues(def.entries);
	if (values.every((v) => typeof v === "number")) json.type = "number";
	if (values.every((v) => typeof v === "string")) json.type = "string";
	json.enum = values;
};
const literalProcessor = (schema, ctx, json, _params) => {
	const def = schema._zod.def;
	const vals = [];
	for (const val of def.values) if (val === void 0) {
		if (ctx.unrepresentable === "throw") throw new Error("Literal `undefined` cannot be represented in JSON Schema");
	} else if (typeof val === "bigint") {
		if (ctx.unrepresentable === "throw") throw new Error("BigInt literals cannot be represented in JSON Schema");
		else vals.push(Number(val));
	} else vals.push(val);
	if (vals.length === 0) {} else if (vals.length === 1) {
		const val = vals[0];
		json.type = val === null ? "null" : typeof val;
		if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") json.enum = [val];
		else json.const = val;
	} else {
		if (vals.every((v) => typeof v === "number")) json.type = "number";
		if (vals.every((v) => typeof v === "string")) json.type = "string";
		if (vals.every((v) => typeof v === "boolean")) json.type = "boolean";
		if (vals.every((v) => v === null)) json.type = "null";
		json.enum = vals;
	}
};
const customProcessor = (_schema, ctx, _json, _params) => {
	if (ctx.unrepresentable === "throw") throw new Error("Custom types cannot be represented in JSON Schema");
};
const transformProcessor = (_schema, ctx, _json, _params) => {
	if (ctx.unrepresentable === "throw") throw new Error("Transforms cannot be represented in JSON Schema");
};
const arrayProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	const { minimum, maximum } = schema._zod.bag;
	if (typeof minimum === "number") json.minItems = minimum;
	if (typeof maximum === "number") json.maxItems = maximum;
	json.type = "array";
	json.items = process(def.element, ctx, {
		...params,
		path: [...params.path, "items"]
	});
};
const objectProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	json.type = "object";
	json.properties = {};
	const shape = def.shape;
	for (const key in shape) json.properties[key] = process(shape[key], ctx, {
		...params,
		path: [
			...params.path,
			"properties",
			key
		]
	});
	const allKeys = new Set(Object.keys(shape));
	const requiredKeys = new Set([...allKeys].filter((key) => {
		const v = def.shape[key]._zod;
		if (ctx.io === "input") return v.optin === void 0;
		else return v.optout === void 0;
	}));
	if (requiredKeys.size > 0) json.required = Array.from(requiredKeys);
	if (def.catchall?._zod.def.type === "never") json.additionalProperties = false;
	else if (!def.catchall) {
		if (ctx.io === "output") json.additionalProperties = false;
	} else if (def.catchall) json.additionalProperties = process(def.catchall, ctx, {
		...params,
		path: [...params.path, "additionalProperties"]
	});
};
const unionProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const isExclusive = def.inclusive === false;
	const options = def.options.map((x, i) => process(x, ctx, {
		...params,
		path: [
			...params.path,
			isExclusive ? "oneOf" : "anyOf",
			i
		]
	}));
	if (isExclusive) json.oneOf = options;
	else json.anyOf = options;
};
const intersectionProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const a = process(def.left, ctx, {
		...params,
		path: [
			...params.path,
			"allOf",
			0
		]
	});
	const b = process(def.right, ctx, {
		...params,
		path: [
			...params.path,
			"allOf",
			1
		]
	});
	const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
	json.allOf = [...isSimpleIntersection(a) ? a.allOf : [a], ...isSimpleIntersection(b) ? b.allOf : [b]];
};
const nullableProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const inner = process(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	if (ctx.target === "openapi-3.0") {
		seen.ref = def.innerType;
		json.nullable = true;
	} else json.anyOf = [inner, { type: "null" }];
};
const nonoptionalProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	process(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
};
const defaultProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	json.default = JSON.parse(JSON.stringify(def.defaultValue));
};
const prefaultProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	if (ctx.io === "input") json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
};
const catchProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	let catchValue;
	try {
		catchValue = def.catchValue(void 0);
	} catch {
		throw new Error("Dynamic catch values are not supported in JSON Schema");
	}
	json.default = catchValue;
};
const pipeProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	const inIsTransform = def.in._zod.traits.has("$ZodTransform");
	const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
	process(innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = innerType;
};
const readonlyProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	json.readOnly = true;
};
const optionalProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	process(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
};
//#endregion
//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/iso.js
const ZodISODateTime = /*@__PURE__*/ $constructor("ZodISODateTime", (inst, def) => {
	$ZodISODateTime.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function datetime(params) {
	return /* @__PURE__ */ _isoDateTime(ZodISODateTime, params);
}
const ZodISODate = /*@__PURE__*/ $constructor("ZodISODate", (inst, def) => {
	$ZodISODate.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function date(params) {
	return /* @__PURE__ */ _isoDate(ZodISODate, params);
}
const ZodISOTime = /*@__PURE__*/ $constructor("ZodISOTime", (inst, def) => {
	$ZodISOTime.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function time(params) {
	return /* @__PURE__ */ _isoTime(ZodISOTime, params);
}
const ZodISODuration = /*@__PURE__*/ $constructor("ZodISODuration", (inst, def) => {
	$ZodISODuration.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function duration(params) {
	return /* @__PURE__ */ _isoDuration(ZodISODuration, params);
}
//#endregion
//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/errors.js
const initializer = (inst, issues) => {
	$ZodError.init(inst, issues);
	inst.name = "ZodError";
	Object.defineProperties(inst, {
		format: { value: (mapper) => formatError(inst, mapper) },
		flatten: { value: (mapper) => flattenError(inst, mapper) },
		addIssue: { value: (issue) => {
			inst.issues.push(issue);
			inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
		} },
		addIssues: { value: (issues) => {
			inst.issues.push(...issues);
			inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
		} },
		isEmpty: { get() {
			return inst.issues.length === 0;
		} }
	});
};
const ZodRealError = /*@__PURE__*/ $constructor("ZodError", initializer, { Parent: Error });
//#endregion
//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/parse.js
const parse = /* @__PURE__ */ _parse(ZodRealError);
const parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
const safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
const safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
const encode = /* @__PURE__ */ _encode(ZodRealError);
const decode = /* @__PURE__ */ _decode(ZodRealError);
const encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
const decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
const safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
const safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
const safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
const safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
//#endregion
//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/schemas.js
const _installedGroups = /* @__PURE__ */ new WeakMap();
function _installLazyMethods(inst, group, methods) {
	const proto = Object.getPrototypeOf(inst);
	let installed = _installedGroups.get(proto);
	if (!installed) {
		installed = /* @__PURE__ */ new Set();
		_installedGroups.set(proto, installed);
	}
	if (installed.has(group)) return;
	installed.add(group);
	for (const key in methods) {
		const fn = methods[key];
		Object.defineProperty(proto, key, {
			configurable: true,
			enumerable: false,
			get() {
				const bound = fn.bind(this);
				Object.defineProperty(this, key, {
					configurable: true,
					writable: true,
					enumerable: true,
					value: bound
				});
				return bound;
			},
			set(v) {
				Object.defineProperty(this, key, {
					configurable: true,
					writable: true,
					enumerable: true,
					value: v
				});
			}
		});
	}
}
const ZodType = /*@__PURE__*/ $constructor("ZodType", (inst, def) => {
	$ZodType.init(inst, def);
	Object.assign(inst["~standard"], { jsonSchema: {
		input: createStandardJSONSchemaMethod(inst, "input"),
		output: createStandardJSONSchemaMethod(inst, "output")
	} });
	inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
	inst.def = def;
	inst.type = def.type;
	Object.defineProperty(inst, "_def", { value: def });
	inst.parse = (data, params) => parse(inst, data, params, { callee: inst.parse });
	inst.safeParse = (data, params) => safeParse(inst, data, params);
	inst.parseAsync = async (data, params) => parseAsync(inst, data, params, { callee: inst.parseAsync });
	inst.safeParseAsync = async (data, params) => safeParseAsync(inst, data, params);
	inst.spa = inst.safeParseAsync;
	inst.encode = (data, params) => encode(inst, data, params);
	inst.decode = (data, params) => decode(inst, data, params);
	inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
	inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
	inst.safeEncode = (data, params) => safeEncode(inst, data, params);
	inst.safeDecode = (data, params) => safeDecode(inst, data, params);
	inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
	inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
	_installLazyMethods(inst, "ZodType", {
		check(...chks) {
			const def = this.def;
			return this.clone(mergeDefs(def, { checks: [...def.checks ?? [], ...chks.map((ch) => typeof ch === "function" ? { _zod: {
				check: ch,
				def: { check: "custom" },
				onattach: []
			} } : ch)] }), { parent: true });
		},
		with(...chks) {
			return this.check(...chks);
		},
		clone(def, params) {
			return clone(this, def, params);
		},
		brand() {
			return this;
		},
		register(reg, meta) {
			reg.add(this, meta);
			return this;
		},
		refine(check, params) {
			return this.check(refine(check, params));
		},
		superRefine(refinement, params) {
			return this.check(superRefine(refinement, params));
		},
		overwrite(fn) {
			return this.check(/* @__PURE__ */ _overwrite(fn));
		},
		optional() {
			return optional(this);
		},
		exactOptional() {
			return exactOptional(this);
		},
		nullable() {
			return nullable(this);
		},
		nullish() {
			return optional(nullable(this));
		},
		nonoptional(params) {
			return nonoptional(this, params);
		},
		array() {
			return array(this);
		},
		or(arg) {
			return union([this, arg]);
		},
		and(arg) {
			return intersection(this, arg);
		},
		transform(tx) {
			return pipe(this, transform(tx));
		},
		default(d) {
			return _default(this, d);
		},
		prefault(d) {
			return prefault(this, d);
		},
		catch(params) {
			return _catch(this, params);
		},
		pipe(target) {
			return pipe(this, target);
		},
		readonly() {
			return readonly(this);
		},
		describe(description) {
			const cl = this.clone();
			globalRegistry.add(cl, { description });
			return cl;
		},
		meta(...args) {
			if (args.length === 0) return globalRegistry.get(this);
			const cl = this.clone();
			globalRegistry.add(cl, args[0]);
			return cl;
		},
		isOptional() {
			return this.safeParse(void 0).success;
		},
		isNullable() {
			return this.safeParse(null).success;
		},
		apply(fn) {
			return fn(this);
		}
	});
	Object.defineProperty(inst, "description", {
		get() {
			return globalRegistry.get(inst)?.description;
		},
		configurable: true
	});
	return inst;
});
/** @internal */
const _ZodString = /*@__PURE__*/ $constructor("_ZodString", (inst, def) => {
	$ZodString.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
	const bag = inst._zod.bag;
	inst.format = bag.format ?? null;
	inst.minLength = bag.minimum ?? null;
	inst.maxLength = bag.maximum ?? null;
	_installLazyMethods(inst, "_ZodString", {
		regex(...args) {
			return this.check(/* @__PURE__ */ _regex(...args));
		},
		includes(...args) {
			return this.check(/* @__PURE__ */ _includes(...args));
		},
		startsWith(...args) {
			return this.check(/* @__PURE__ */ _startsWith(...args));
		},
		endsWith(...args) {
			return this.check(/* @__PURE__ */ _endsWith(...args));
		},
		min(...args) {
			return this.check(/* @__PURE__ */ _minLength(...args));
		},
		max(...args) {
			return this.check(/* @__PURE__ */ _maxLength(...args));
		},
		length(...args) {
			return this.check(/* @__PURE__ */ _length(...args));
		},
		nonempty(...args) {
			return this.check(/* @__PURE__ */ _minLength(1, ...args));
		},
		lowercase(params) {
			return this.check(/* @__PURE__ */ _lowercase(params));
		},
		uppercase(params) {
			return this.check(/* @__PURE__ */ _uppercase(params));
		},
		trim() {
			return this.check(/* @__PURE__ */ _trim());
		},
		normalize(...args) {
			return this.check(/* @__PURE__ */ _normalize(...args));
		},
		toLowerCase() {
			return this.check(/* @__PURE__ */ _toLowerCase());
		},
		toUpperCase() {
			return this.check(/* @__PURE__ */ _toUpperCase());
		},
		slugify() {
			return this.check(/* @__PURE__ */ _slugify());
		}
	});
});
const ZodString = /*@__PURE__*/ $constructor("ZodString", (inst, def) => {
	$ZodString.init(inst, def);
	_ZodString.init(inst, def);
	inst.email = (params) => inst.check(/* @__PURE__ */ _email(ZodEmail, params));
	inst.url = (params) => inst.check(/* @__PURE__ */ _url(ZodURL, params));
	inst.jwt = (params) => inst.check(/* @__PURE__ */ _jwt(ZodJWT, params));
	inst.emoji = (params) => inst.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
	inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
	inst.uuid = (params) => inst.check(/* @__PURE__ */ _uuid(ZodUUID, params));
	inst.uuidv4 = (params) => inst.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
	inst.uuidv6 = (params) => inst.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
	inst.uuidv7 = (params) => inst.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
	inst.nanoid = (params) => inst.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
	inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
	inst.cuid = (params) => inst.check(/* @__PURE__ */ _cuid(ZodCUID, params));
	inst.cuid2 = (params) => inst.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
	inst.ulid = (params) => inst.check(/* @__PURE__ */ _ulid(ZodULID, params));
	inst.base64 = (params) => inst.check(/* @__PURE__ */ _base64(ZodBase64, params));
	inst.base64url = (params) => inst.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
	inst.xid = (params) => inst.check(/* @__PURE__ */ _xid(ZodXID, params));
	inst.ksuid = (params) => inst.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
	inst.ipv4 = (params) => inst.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
	inst.ipv6 = (params) => inst.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
	inst.cidrv4 = (params) => inst.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
	inst.cidrv6 = (params) => inst.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
	inst.e164 = (params) => inst.check(/* @__PURE__ */ _e164(ZodE164, params));
	inst.datetime = (params) => inst.check(datetime(params));
	inst.date = (params) => inst.check(date(params));
	inst.time = (params) => inst.check(time(params));
	inst.duration = (params) => inst.check(duration(params));
});
function string(params) {
	return /* @__PURE__ */ _string(ZodString, params);
}
const ZodStringFormat = /*@__PURE__*/ $constructor("ZodStringFormat", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	_ZodString.init(inst, def);
});
const ZodEmail = /*@__PURE__*/ $constructor("ZodEmail", (inst, def) => {
	$ZodEmail.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodGUID = /*@__PURE__*/ $constructor("ZodGUID", (inst, def) => {
	$ZodGUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodUUID = /*@__PURE__*/ $constructor("ZodUUID", (inst, def) => {
	$ZodUUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodURL = /*@__PURE__*/ $constructor("ZodURL", (inst, def) => {
	$ZodURL.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodEmoji = /*@__PURE__*/ $constructor("ZodEmoji", (inst, def) => {
	$ZodEmoji.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodNanoID = /*@__PURE__*/ $constructor("ZodNanoID", (inst, def) => {
	$ZodNanoID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link ZodCUID2} instead.
* See https://github.com/paralleldrive/cuid.
*/
const ZodCUID = /*@__PURE__*/ $constructor("ZodCUID", (inst, def) => {
	$ZodCUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodCUID2 = /*@__PURE__*/ $constructor("ZodCUID2", (inst, def) => {
	$ZodCUID2.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodULID = /*@__PURE__*/ $constructor("ZodULID", (inst, def) => {
	$ZodULID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodXID = /*@__PURE__*/ $constructor("ZodXID", (inst, def) => {
	$ZodXID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodKSUID = /*@__PURE__*/ $constructor("ZodKSUID", (inst, def) => {
	$ZodKSUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodIPv4 = /*@__PURE__*/ $constructor("ZodIPv4", (inst, def) => {
	$ZodIPv4.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodIPv6 = /*@__PURE__*/ $constructor("ZodIPv6", (inst, def) => {
	$ZodIPv6.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodCIDRv4 = /*@__PURE__*/ $constructor("ZodCIDRv4", (inst, def) => {
	$ZodCIDRv4.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodCIDRv6 = /*@__PURE__*/ $constructor("ZodCIDRv6", (inst, def) => {
	$ZodCIDRv6.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodBase64 = /*@__PURE__*/ $constructor("ZodBase64", (inst, def) => {
	$ZodBase64.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodBase64URL = /*@__PURE__*/ $constructor("ZodBase64URL", (inst, def) => {
	$ZodBase64URL.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodE164 = /*@__PURE__*/ $constructor("ZodE164", (inst, def) => {
	$ZodE164.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodJWT = /*@__PURE__*/ $constructor("ZodJWT", (inst, def) => {
	$ZodJWT.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodNumber = /*@__PURE__*/ $constructor("ZodNumber", (inst, def) => {
	$ZodNumber.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
	_installLazyMethods(inst, "ZodNumber", {
		gt(value, params) {
			return this.check(/* @__PURE__ */ _gt(value, params));
		},
		gte(value, params) {
			return this.check(/* @__PURE__ */ _gte(value, params));
		},
		min(value, params) {
			return this.check(/* @__PURE__ */ _gte(value, params));
		},
		lt(value, params) {
			return this.check(/* @__PURE__ */ _lt(value, params));
		},
		lte(value, params) {
			return this.check(/* @__PURE__ */ _lte(value, params));
		},
		max(value, params) {
			return this.check(/* @__PURE__ */ _lte(value, params));
		},
		int(params) {
			return this.check(int(params));
		},
		safe(params) {
			return this.check(int(params));
		},
		positive(params) {
			return this.check(/* @__PURE__ */ _gt(0, params));
		},
		nonnegative(params) {
			return this.check(/* @__PURE__ */ _gte(0, params));
		},
		negative(params) {
			return this.check(/* @__PURE__ */ _lt(0, params));
		},
		nonpositive(params) {
			return this.check(/* @__PURE__ */ _lte(0, params));
		},
		multipleOf(value, params) {
			return this.check(/* @__PURE__ */ _multipleOf(value, params));
		},
		step(value, params) {
			return this.check(/* @__PURE__ */ _multipleOf(value, params));
		},
		finite() {
			return this;
		}
	});
	const bag = inst._zod.bag;
	inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
	inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
	inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? .5);
	inst.isFinite = true;
	inst.format = bag.format ?? null;
});
function number(params) {
	return /* @__PURE__ */ _number(ZodNumber, params);
}
const ZodNumberFormat = /*@__PURE__*/ $constructor("ZodNumberFormat", (inst, def) => {
	$ZodNumberFormat.init(inst, def);
	ZodNumber.init(inst, def);
});
function int(params) {
	return /* @__PURE__ */ _int(ZodNumberFormat, params);
}
const ZodUnknown = /*@__PURE__*/ $constructor("ZodUnknown", (inst, def) => {
	$ZodUnknown.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => void 0;
});
function unknown() {
	return /* @__PURE__ */ _unknown(ZodUnknown);
}
const ZodNever = /*@__PURE__*/ $constructor("ZodNever", (inst, def) => {
	$ZodNever.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
	return /* @__PURE__ */ _never(ZodNever, params);
}
const ZodArray = /*@__PURE__*/ $constructor("ZodArray", (inst, def) => {
	$ZodArray.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
	inst.element = def.element;
	_installLazyMethods(inst, "ZodArray", {
		min(n, params) {
			return this.check(/* @__PURE__ */ _minLength(n, params));
		},
		nonempty(params) {
			return this.check(/* @__PURE__ */ _minLength(1, params));
		},
		max(n, params) {
			return this.check(/* @__PURE__ */ _maxLength(n, params));
		},
		length(n, params) {
			return this.check(/* @__PURE__ */ _length(n, params));
		},
		unwrap() {
			return this.element;
		}
	});
});
function array(element, params) {
	return /* @__PURE__ */ _array(ZodArray, element, params);
}
const ZodObject = /*@__PURE__*/ $constructor("ZodObject", (inst, def) => {
	$ZodObjectJIT.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
	defineLazy(inst, "shape", () => {
		return def.shape;
	});
	_installLazyMethods(inst, "ZodObject", {
		keyof() {
			return _enum(Object.keys(this._zod.def.shape));
		},
		catchall(catchall) {
			return this.clone({
				...this._zod.def,
				catchall
			});
		},
		passthrough() {
			return this.clone({
				...this._zod.def,
				catchall: unknown()
			});
		},
		loose() {
			return this.clone({
				...this._zod.def,
				catchall: unknown()
			});
		},
		strict() {
			return this.clone({
				...this._zod.def,
				catchall: never()
			});
		},
		strip() {
			return this.clone({
				...this._zod.def,
				catchall: void 0
			});
		},
		extend(incoming) {
			return extend(this, incoming);
		},
		safeExtend(incoming) {
			return safeExtend(this, incoming);
		},
		merge(other) {
			return merge(this, other);
		},
		pick(mask) {
			return pick(this, mask);
		},
		omit(mask) {
			return omit(this, mask);
		},
		partial(...args) {
			return partial(ZodOptional, this, args[0]);
		},
		required(...args) {
			return required(ZodNonOptional, this, args[0]);
		}
	});
});
function object(shape, params) {
	const def = {
		type: "object",
		shape: shape ?? {},
		...normalizeParams(params)
	};
	return new ZodObject(def);
}
const ZodUnion = /*@__PURE__*/ $constructor("ZodUnion", (inst, def) => {
	$ZodUnion.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
	inst.options = def.options;
});
function union(options, params) {
	return new ZodUnion({
		type: "union",
		options,
		...normalizeParams(params)
	});
}
const ZodIntersection = /*@__PURE__*/ $constructor("ZodIntersection", (inst, def) => {
	$ZodIntersection.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
	return new ZodIntersection({
		type: "intersection",
		left,
		right
	});
}
const ZodEnum = /*@__PURE__*/ $constructor("ZodEnum", (inst, def) => {
	$ZodEnum.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
	inst.enum = def.entries;
	inst.options = Object.values(def.entries);
	const keys = new Set(Object.keys(def.entries));
	inst.extract = (values, params) => {
		const newEntries = {};
		for (const value of values) if (keys.has(value)) newEntries[value] = def.entries[value];
		else throw new Error(`Key ${value} not found in enum`);
		return new ZodEnum({
			...def,
			checks: [],
			...normalizeParams(params),
			entries: newEntries
		});
	};
	inst.exclude = (values, params) => {
		const newEntries = { ...def.entries };
		for (const value of values) if (keys.has(value)) delete newEntries[value];
		else throw new Error(`Key ${value} not found in enum`);
		return new ZodEnum({
			...def,
			checks: [],
			...normalizeParams(params),
			entries: newEntries
		});
	};
});
function _enum(values, params) {
	const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
	return new ZodEnum({
		type: "enum",
		entries,
		...normalizeParams(params)
	});
}
const ZodLiteral = /*@__PURE__*/ $constructor("ZodLiteral", (inst, def) => {
	$ZodLiteral.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
	inst.values = new Set(def.values);
	Object.defineProperty(inst, "value", { get() {
		if (def.values.length > 1) throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
		return def.values[0];
	} });
});
function literal(value, params) {
	return new ZodLiteral({
		type: "literal",
		values: Array.isArray(value) ? value : [value],
		...normalizeParams(params)
	});
}
const ZodTransform = /*@__PURE__*/ $constructor("ZodTransform", (inst, def) => {
	$ZodTransform.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
	inst._zod.parse = (payload, _ctx) => {
		if (_ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
		payload.addIssue = (issue$1) => {
			if (typeof issue$1 === "string") payload.issues.push(issue(issue$1, payload.value, def));
			else {
				const _issue = issue$1;
				if (_issue.fatal) _issue.continue = false;
				_issue.code ?? (_issue.code = "custom");
				_issue.input ?? (_issue.input = payload.value);
				_issue.inst ?? (_issue.inst = inst);
				payload.issues.push(issue(_issue));
			}
		};
		const output = def.transform(payload.value, payload);
		if (output instanceof Promise) return output.then((output) => {
			payload.value = output;
			payload.fallback = true;
			return payload;
		});
		payload.value = output;
		payload.fallback = true;
		return payload;
	};
});
function transform(fn) {
	return new ZodTransform({
		type: "transform",
		transform: fn
	});
}
const ZodOptional = /*@__PURE__*/ $constructor("ZodOptional", (inst, def) => {
	$ZodOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
	return new ZodOptional({
		type: "optional",
		innerType
	});
}
const ZodExactOptional = /*@__PURE__*/ $constructor("ZodExactOptional", (inst, def) => {
	$ZodExactOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
	return new ZodExactOptional({
		type: "optional",
		innerType
	});
}
const ZodNullable = /*@__PURE__*/ $constructor("ZodNullable", (inst, def) => {
	$ZodNullable.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
	return new ZodNullable({
		type: "nullable",
		innerType
	});
}
const ZodDefault = /*@__PURE__*/ $constructor("ZodDefault", (inst, def) => {
	$ZodDefault.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
	inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
	return new ZodDefault({
		type: "default",
		innerType,
		get defaultValue() {
			return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
		}
	});
}
const ZodPrefault = /*@__PURE__*/ $constructor("ZodPrefault", (inst, def) => {
	$ZodPrefault.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
	return new ZodPrefault({
		type: "prefault",
		innerType,
		get defaultValue() {
			return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
		}
	});
}
const ZodNonOptional = /*@__PURE__*/ $constructor("ZodNonOptional", (inst, def) => {
	$ZodNonOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
	return new ZodNonOptional({
		type: "nonoptional",
		innerType,
		...normalizeParams(params)
	});
}
const ZodCatch = /*@__PURE__*/ $constructor("ZodCatch", (inst, def) => {
	$ZodCatch.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
	inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
	return new ZodCatch({
		type: "catch",
		innerType,
		catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
	});
}
const ZodPipe = /*@__PURE__*/ $constructor("ZodPipe", (inst, def) => {
	$ZodPipe.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
	inst.in = def.in;
	inst.out = def.out;
});
function pipe(in_, out) {
	return new ZodPipe({
		type: "pipe",
		in: in_,
		out
	});
}
const ZodReadonly = /*@__PURE__*/ $constructor("ZodReadonly", (inst, def) => {
	$ZodReadonly.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
	return new ZodReadonly({
		type: "readonly",
		innerType
	});
}
const ZodCustom = /*@__PURE__*/ $constructor("ZodCustom", (inst, def) => {
	$ZodCustom.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
	return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
	return /* @__PURE__ */ _superRefine(fn, params);
}
//#endregion
//#region src/stats/domain.ts
async function syncDomainStats(store, sessionId, events, estimateMessage) {
	const eventCount = events.length;
	const existing = store.read(sessionId);
	if (existing !== void 0 && existing.eventCount >= eventCount) return existing;
	const record = {
		v: 1,
		eventCount,
		ledger: computeSessionStats(events, estimateMessage),
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
	await store.write(sessionId, record);
	return record;
}
async function syncStatsWithStatus(store, sessionId, events, estimateMessage) {
	const observedCursor = events.length;
	if (store === void 0) return {
		status: "unavailable",
		reason: "storageDomain not wired",
		observedCursor
	};
	const existing = store.read(sessionId);
	if (existing !== void 0 && existing.eventCount > observedCursor) return {
		status: "stale",
		reason: `stored cursor ${existing.eventCount} ahead of observed ${observedCursor}`,
		record: existing,
		aggregate: aggregateDomainStats(store),
		observedCursor
	};
	try {
		return {
			status: "current",
			record: await syncDomainStats(store, sessionId, events, estimateMessage),
			aggregate: aggregateDomainStats(store),
			observedCursor
		};
	} catch (error) {
		return {
			status: "stale",
			reason: error instanceof Error ? error.message : String(error),
			record: existing,
			aggregate: aggregateDomainStats(store),
			observedCursor
		};
	}
}
function aggregateDomainStats(store) {
	const records = store.list === void 0 ? [] : [...store.list()];
	const ledger = {
		blockCount: 0,
		activeBlockCount: 0,
		pruneReplacements: 0,
		shadowedTokens: 0,
		checkpointTokens: 0,
		pruneTokens: 0,
		expansionTokens: 0,
		markerTokens: 0,
		historyReduction: 0
	};
	for (const [, record] of records) {
		ledger.blockCount += record.ledger.blockCount;
		ledger.activeBlockCount += record.ledger.activeBlockCount;
		ledger.pruneReplacements += record.ledger.pruneReplacements;
		ledger.shadowedTokens += record.ledger.shadowedTokens;
		ledger.checkpointTokens += record.ledger.checkpointTokens;
		ledger.pruneTokens += record.ledger.pruneTokens;
		ledger.expansionTokens += record.ledger.expansionTokens;
		ledger.markerTokens += record.ledger.markerTokens;
		ledger.historyReduction += record.ledger.historyReduction;
	}
	return {
		sessionCount: records.length,
		ledger
	};
}
//#endregion
//#region src/stats/domain-store.ts
const ledgerSchema = object({
	blockCount: number(),
	activeBlockCount: number(),
	pruneReplacements: number(),
	shadowedTokens: number(),
	checkpointTokens: number(),
	pruneTokens: number(),
	expansionTokens: number(),
	markerTokens: number(),
	historyReduction: number()
});
const recordSchema = object({
	v: literal(1),
	eventCount: number().int().nonnegative(),
	ledger: ledgerSchema,
	updatedAt: string()
}).refine((record) => record.ledger.historyReduction === record.ledger.shadowedTokens + record.ledger.pruneTokens - record.ledger.checkpointTokens + record.ledger.expansionTokens - record.ledger.markerTokens, { message: "ledger historyReduction equation mismatch" });
const dcpStatsDomainSpec = defineDomain({
	name: "dcp_stats",
	version: 1,
	tables: { sessions: domainTable(recordSchema) }
});
async function openDcpStatsStore(ctx) {
	const facility = ctx.get("storageDomain");
	if (facility === void 0) return void 0;
	const domain = await facility.open(dcpStatsDomainSpec);
	const table = domain.table("sessions");
	return {
		store: {
			read: (sessionId) => table.get(sessionId),
			write: (sessionId, record) => table.put(sessionId, record),
			list: () => table.entries()
		},
		close: () => domain.close()
	};
}
const dcpStatsStores = /* @__PURE__ */ new WeakMap();
function registerDcpStatsStore(ctx, store) {
	dcpStatsStores.set(ctx, store);
}
function unregisterDcpStatsStore(ctx) {
	dcpStatsStores.delete(ctx);
}
function getDcpStatsStore(ctx) {
	return dcpStatsStores.get(ctx);
}
async function syncToDomain(ctx, sessionId, events, estimateMessage) {
	return syncStatsWithStatus(getDcpStatsStore(ctx), sessionId, events, estimateMessage);
}
//#endregion
//#region src/commands/stats.ts
function renderStats(ctx, agent) {
	const stats = computeSessionStats(agent.session.events, (message) => ctx.tokenMeter.estimateMessage(message));
	const measure = ctx.tokenMeter.measure(agent.session);
	return [
		"DCP statistics:",
		`  blocks (hist/act):  ${stats.blockCount} / ${stats.activeBlockCount}`,
		`  shadowed tokens:   ~${stats.shadowedTokens}`,
		`  checkpoint tokens: ~${stats.checkpointTokens}`,
		`  prune tokens:      ~${stats.pruneTokens}`,
		`  expansion delta:   ~${stats.expansionTokens}`,
		`  marker tokens:     ~${stats.markerTokens}`,
		`  history reduction: ~${stats.historyReduction}` + (stats.historyReduction < 0 ? " (overhead)" : ""),
		`  prune replacements: ${stats.pruneReplacements}`,
		`  current surface:   ~${measure.surfaceTokens}`
	].join("\n");
}
async function renderDomainStats(ctx, agent) {
	const result = await syncToDomain(ctx, String(agent.session.id), agent.session.events, (message) => ctx.tokenMeter.estimateMessage(message));
	if (result.status === "unavailable") return [`persistent domain: unavailable (${result.reason ?? "storageDomain not wired"})`];
	if (result.status === "stale") {
		const aggregate = result.aggregate;
		return [
			`persistent domain: stale (${result.reason ?? "sync failed"})`,
			...aggregate === void 0 ? [] : [`  sessions (old view): ${aggregate.sessionCount}`, `  blocks (old view):   ${aggregate.ledger.blockCount}`],
			`  observed cursor: ${result.observedCursor}`
		];
	}
	if (!result.record || !result.aggregate) return ["persistent domain: current (unexpected missing data)"];
	return [
		"persistent domain: current (single-process scope)",
		`  sessions:          ${result.aggregate?.sessionCount ?? 0}`,
		`  blocks:            ${result.aggregate?.ledger.blockCount ?? 0}`,
		`  history reduction: ~${result.aggregate?.ledger.historyReduction ?? 0}`,
		`  last sync:         ${result.record.updatedAt}`
	];
}
//#endregion
//#region src/commands/manual.ts
function currentManualMode(agent, config) {
	return reduceDcpState(agent.session.events, config.manualMode.default).manualMode;
}
function manualResult(current, rawArg) {
	const arg = rawArg?.toLowerCase();
	if (arg === "on") return {
		text: "Manual mode is now ON.",
		next: true
	};
	if (arg === "off") return {
		text: "Manual mode is now OFF.",
		next: false
	};
	if (arg === "status") return {
		text: `Manual mode is ${current ? "ON" : "OFF"}.`,
		next: current
	};
	return {
		text: `Usage: /dcp manual [on|off|status]. Current: ${current ? "ON" : "OFF"}.`,
		next: current
	};
}
//#endregion
//#region src/strategies/control.ts
const DCP_CONTROL_PREFIX = "<dcp-control>";
function controlMessage(kind) {
	return createUserMessage({
		content: [{
			type: "text",
			text: `${DCP_CONTROL_PREFIX}${kind}`
		}],
		source: {
			kind: "plugin",
			plugin: "dsh-dcp"
		}
	});
}
function isDcpControlMessage(message) {
	return message.content.some((block) => block.type === "text" && block.text?.startsWith("<dcp-control>"));
}
function parseControl(message) {
	const text = message.content.find((block) => block.type === "text" && block.text?.startsWith("<dcp-control>"))?.text;
	if (!text) return void 0;
	const body = text.slice(13).trim();
	if (body === "sweep") return { kind: "sweep" };
	const expand = /^expand (b\d+)$/.exec(body);
	if (expand) return {
		kind: "expand",
		arg: expand[1]
	};
	const recompress = /^recompress (b\d+)$/.exec(body);
	if (recompress) return {
		kind: "recompress",
		arg: recompress[1]
	};
}
//#endregion
//#region src/commands/sweep.ts
function scheduleSweep(agent) {
	agent.followup(controlMessage("sweep"));
	return { text: "Sweep scheduled in a control turn (no model request)." };
}
//#endregion
//#region src/commands/compress.ts
const TRIGGER = [
	"<compress triggered manually>",
	"Manual mode trigger received. You must now use the compress tool.",
	"Find the most significant completed conversation content that can be compressed into a high-fidelity technical summary.",
	"Choose safe, closed, tool-pairing-balanced ranges and return after compress with a brief explanation."
].join("\n\n");
function scheduleCompress(agent, focus) {
	const prompt = focus?.trim() ? `${TRIGGER}\n\nAdditional user focus:\n${focus.trim()}` : TRIGGER;
	agent.followup(createUserMessage({
		content: [{
			type: "text",
			text: prompt
		}],
		source: {
			kind: "plugin",
			plugin: "dsh-dcp"
		}
	}));
	return { text: "Compression triggered; the model will select closed ranges in the next turn." };
}
//#endregion
//#region src/commands/recovery.ts
function checkpointTextOf(session, seq) {
	const event = session.events[seq];
	if (event?.type !== "user/message") return "";
	return event.data.content.filter((block) => block.type === "text").map((block) => block.type === "text" ? block.text : "").join("\n");
}
function collectLeafSeqs(events, seq) {
	const event = events[seq];
	if (!event || event.type !== "user/message" || event.surfaceOp === "append") return [seq];
	const shadowed = (event.sourceEventSeqs ?? []).filter((candidate) => events[candidate]?.type !== "compaction/summary");
	const leaves = [];
	for (const candidate of shadowed) {
		const child = events[candidate];
		if (child?.type === "user/message" && child.surfaceOp !== "append") leaves.push(...collectLeafSeqs(events, candidate));
		else leaves.push(candidate);
	}
	return leaves;
}
function transcriptOf(session, seqs) {
	return seqs.map((seq) => {
		const message = deriveEventMessage(session.events[seq]);
		if (!message) return "";
		const text = message.content.filter((block) => block.type === "text").map((block) => block.type === "text" ? block.text : "").join("\n");
		return `--- leaf ${seq} (${message.role}) ---\n${text}`;
	}).filter(Boolean).join("\n\n");
}
function renderBlockShow(session, state, ref, raw) {
	const block = state.blocks.find((candidate) => candidate.ref === ref);
	if (!block) return `Compression ${ref} does not exist.`;
	const lines = [
		`Block ${ref}:`,
		`  mode:      ${block.meta.mode}`,
		`  topic:     ${block.meta.topic}`,
		`  status:    ${block.membership}`,
		`  summary:`,
		checkpointTextOf(session, block.seq)
	];
	if (raw) {
		const leaves = collectLeafSeqs([...session.events], block.seq);
		lines.push("", `Original leaf nodes (${leaves.length}):`, transcriptOf(session, leaves));
	}
	return lines.join("\n");
}
function appendRecoveryBracket(session, tokenMeter, targetSeq, newRef, text, meta) {
	const turn = openTurnOf(session.events);
	if (turn === null) throw new Error("recovery mutation requires an open turn (control turn)");
	const target = session.events[targetSeq];
	const header = session.requestHeader();
	const provider = header?.config.provider ?? "unknown";
	const model = header?.config.model ?? "unknown";
	const shadowedTokenCount = target?.type === "user/message" ? tokenMeter.estimateMessage(target.data) : 0;
	const compactionId = meta.compactionId;
	session.append("compaction/start", {
		compactionId,
		turn
	});
	session.append("compaction/summary", {
		compactionId,
		summary: [{
			type: "text",
			text
		}],
		shadowedRange: {
			start: targetSeq,
			end: targetSeq
		},
		shadowedSeqs: [targetSeq],
		shadowedTokenCount,
		provider,
		model
	});
	session.append("user/message", createUserMessage({
		content: [{
			type: "text",
			text
		}],
		source: encodeDcpCheckpointSource(compactionId, {
			v: 1,
			kind: meta.kind,
			blockRef: meta.blockRef,
			mode: "range",
			topic: meta.kind === "expansion" ? "semantic expansion" : "recompression",
			startRef: meta.startRef,
			endRef: meta.blockRef,
			authorMessageId: "dcp-command",
			compressCallId: `dcp-${meta.kind}-${meta.blockRef}`,
			consumedBlockRefs: meta.consumedBlockRefs,
			protectedKinds: [],
			...meta.recompressedFrom === void 0 ? {} : { recompressedFrom: meta.recompressedFrom }
		})
	}), {
		surfaceOp: {
			op: "replace",
			start: targetSeq,
			end: targetSeq
		},
		sourceEventSeqs: [targetSeq]
	});
	session.append("compaction/end", {
		compactionId,
		turn
	});
}
function applyExpansion(session, tokenMeter, blockRef) {
	const state = reduceDcpState(session.events);
	const block = state.blocks.find((candidate) => candidate.ref === blockRef && candidate.membership === "active" && candidate.meta.kind === "summary");
	if (!block) return {
		ok: false,
		error: `${blockRef} is not an active summary block`
	};
	const transcript = transcriptOf(session, collectLeafSeqs([...session.events], block.seq));
	const newRef = `b${state.maxBlockNumber + 1}`;
	const text = `[Expanded block ${blockRef}]\n\n${transcript}`;
	appendRecoveryBracket(session, tokenMeter, block.seq, newRef, text, {
		compactionId: CompactionId(`dcp-expand-${blockRef}`),
		kind: "expansion",
		blockRef: newRef,
		consumedBlockRefs: [blockRef],
		startRef: blockRef
	});
	return {
		ok: true,
		text: `Expanded ${blockRef} into ${newRef} (quoted transcript).`
	};
}
function applyRecompress(session, tokenMeter, blockRef) {
	const state = reduceDcpState(session.events);
	const oldBlock = state.blocks.find((candidate) => candidate.ref === blockRef);
	const expansion = state.blocks.find((candidate) => candidate.meta.kind === "expansion" && candidate.meta.consumedBlockRefs.includes(blockRef) && candidate.membership === "active");
	if (!oldBlock || !expansion) return {
		ok: false,
		error: `${blockRef} has no active semantic expansion to recompress`
	};
	const oldText = checkpointTextOf(session, oldBlock.seq);
	const newRef = `b${state.maxBlockNumber + 1}`;
	const text = buildCheckpointText(newRef, oldText);
	appendRecoveryBracket(session, tokenMeter, expansion.seq, newRef, text, {
		compactionId: CompactionId(`dcp-recompress-${blockRef}`),
		kind: "summary",
		blockRef: newRef,
		consumedBlockRefs: [expansion.ref],
		recompressedFrom: blockRef,
		startRef: blockRef
	});
	return {
		ok: true,
		text: `Re-applied compression ${blockRef} as ${newRef}.`
	};
}
//#endregion
//#region src/commands/index.ts
function registerDcpCommands(ctx, config) {
	ctx.commands.register({
		name: "dcp",
		description: "DCP context management",
		input: { hint: "help|context" },
		async handler(invocation) {
			const tokens = invocation.rawInput.trim().split(/\s+/).filter(Boolean);
			const subcommand = (tokens[0] ?? "help").toLowerCase();
			switch (subcommand) {
				case "help": return {
					kind: "success",
					text: renderHelp()
				};
				case "context": return {
					kind: "success",
					text: renderContext(ctx, invocation.agent)
				};
				case "stats": return {
					kind: "success",
					text: `${renderStats(ctx, invocation.agent)}\n\n${(await renderDomainStats(ctx, invocation.agent)).join("\n")}`
				};
				case "manual": return {
					kind: "success",
					text: manualResult(currentManualMode(invocation.agent, config), tokens[1]).text
				};
				case "sweep": return {
					kind: "success",
					text: scheduleSweep(invocation.agent).text
				};
				case "compress": {
					const focus = tokens.slice(1).join(" ");
					return {
						kind: "success",
						text: scheduleCompress(invocation.agent, focus).text
					};
				}
				case "show": {
					const ref = tokens[1]?.toLowerCase();
					if (!ref || !/^b\d+$/.test(ref)) return {
						kind: "error",
						text: "Usage: /dcp show <bN> [--raw]"
					};
					const state = reduceDcpState(invocation.agent.session.events);
					return {
						kind: "success",
						text: renderBlockShow(invocation.agent.session, state, ref, tokens.includes("--raw"))
					};
				}
				case "decompress": {
					const ref = tokens[1]?.toLowerCase();
					if (!ref || !/^b\d+$/.test(ref)) return {
						kind: "error",
						text: "Usage: /dcp decompress <bN> [--into-context]"
					};
					if (tokens.includes("--into-context")) {
						invocation.agent.followup(controlMessage(`expand ${ref}`));
						return {
							kind: "success",
							text: `${ref} will be expanded into quoted context in a control turn.`
						};
					}
					const state = reduceDcpState(invocation.agent.session.events);
					return {
						kind: "success",
						text: `${renderBlockShow(invocation.agent.session, state, ref, true)}\n\nNote: model context is unchanged (raw show only). Use --into-context to expand.`
					};
				}
				case "recompress": {
					const ref = tokens[1]?.toLowerCase();
					if (!ref || !/^b\d+$/.test(ref)) return {
						kind: "error",
						text: "Usage: /dcp recompress <bN>"
					};
					invocation.agent.followup(controlMessage(`recompress ${ref}`));
					return {
						kind: "success",
						text: `${ref} will be re-compressed in a control turn.`
					};
				}
				default: return {
					kind: "error",
					text: `Unknown /dcp subcommand "${subcommand}". Use /dcp help.`
				};
			}
		}
	});
	ctx.commands.register({
		name: "dcp-compress",
		description: "Trigger DCP manual compression",
		input: { hint: "[focus]" },
		async handler(invocation) {
			const focus = invocation.rawInput.trim();
			return {
				kind: "success",
				text: scheduleCompress(invocation.agent, focus).text
			};
		}
	});
}
//#endregion
//#region src/strategies/deduplication.ts
function sortValue(value) {
	if (Array.isArray(value)) return value.map(sortValue);
	if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== void 0 && entry !== null).toSorted(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, sortValue(entry)]));
	return value;
}
function canonicalJson(args) {
	try {
		return JSON.stringify(sortValue(JSON.parse(args)));
	} catch {
		return args;
	}
}
function filePathsOf(tool, args) {
	try {
		const parsed = JSON.parse(args);
		if (typeof parsed.filePath === "string") return [parsed.filePath];
		return [];
	} catch {
		return [];
	}
}
function dedupCandidates(session, config) {
	const events = session.events;
	const calls = /* @__PURE__ */ new Map();
	for (const event of events) if (event.type === "tool/call") calls.set(String(event.data.callId), {
		tool: event.data.name,
		args: event.data.arguments
	});
	const latestTurn = maxTurn(events);
	const results = [];
	for (const seq of session.surface.nodes) {
		const event = events[seq];
		if (event?.type !== "tool/result") continue;
		if (event.surfaceOp !== "append") continue;
		const callId = String(event.data.message.source.callId);
		const call = calls.get(callId);
		if (!call) continue;
		if ((turnOfSeq(events, seq) ?? 0) > latestTurn - config.compress.retainRecentTurns) continue;
		if (config.strategies.deduplication.protectedTools.includes(call.tool)) continue;
		if (config.protectedFilePatterns.some((pattern) => filePathsOf(call.tool, call.args).some((path) => matchesGlob(path, pattern)))) continue;
		results.push({
			seq,
			callId,
			tool: call.tool
		});
	}
	const groups = /* @__PURE__ */ new Map();
	for (const result of results) {
		const call = calls.get(result.callId);
		const signature = `${call.tool}::${canonicalJson(call.args)}`;
		const group = groups.get(signature) ?? [];
		group.push(result);
		groups.set(signature, group);
	}
	const targets = [];
	for (const group of groups.values()) {
		if (group.length <= 1) continue;
		const ordered = group.toSorted((left, right) => left.seq - right.seq);
		targets.push(...ordered.slice(0, -1));
	}
	return targets;
}
function applyDeduplication(session, tokenMeter, config) {
	let replaced = 0;
	let tokensSaved = 0;
	for (const target of dedupCandidates(session, config)) {
		const event = session.events[target.seq];
		if (event?.type !== "tool/result") continue;
		const tokens = tokenMeter.estimateMessage(event.data.message);
		const pruned = freezeMessage({
			...event.data.message,
			content: [{
				...event.data.message.content[0],
				content: [{
					type: "text",
					text: `[duplicate ${target.tool} output removed; a newer identical call supersedes it]`
				}]
			}]
		});
		session.append("compaction/prune", {
			shadowedRange: {
				start: target.seq,
				end: target.seq
			},
			shadowedSeqs: [target.seq],
			shadowedTokenCount: tokens
		});
		session.append("tool/result", {
			...event.data,
			message: pruned
		}, {
			surfaceOp: {
				op: "replace",
				start: target.seq,
				end: target.seq
			},
			sourceEventSeqs: [target.seq]
		});
		replaced++;
		tokensSaved += tokens;
	}
	return {
		replaced,
		tokensSaved
	};
}
//#endregion
//#region src/strategies/purge-errors.ts
function purgeTargets(session, tokenMeter, config) {
	const events = session.events;
	const calls = /* @__PURE__ */ new Map();
	for (const event of events) if (event.type === "tool/call") calls.set(String(event.data.callId), event.data.name);
	const latestTurn = maxTurn(events);
	const targets = [];
	for (const seq of session.surface.nodes) {
		const event = events[seq];
		if (event?.type !== "tool/result" || !event.data.message.content[0]?.isError) continue;
		if (event.surfaceOp !== "append") continue;
		const callId = String(event.data.message.source.callId);
		if ((turnOfSeq(events, seq) ?? 0) > latestTurn - config.strategies.purgeErrors.turns) continue;
		const tool = calls.get(callId) ?? "unknown";
		if (config.strategies.purgeErrors.protectedTools.includes(tool)) continue;
		const assistantSeq = [...session.surface.nodes].find((candidate) => {
			const candidateEvent = events[candidate];
			return candidateEvent?.type === "assistant/message" && candidateEvent.data.message.content.some((block) => block.type === "tool-call" && block.id === callId);
		});
		if (assistantSeq === void 0) continue;
		const assistantEvent = events[assistantSeq];
		if (assistantEvent?.type !== "assistant/message") continue;
		if (assistantEvent.data.message.content.filter((block) => block.type === "tool-call").length !== 1) continue;
		if (!toolPairingBalancedBefore(session, assistantSeq) || !toolPairingBalancedAfter(session, seq)) continue;
		const errorText = event.data.message.content.flatMap((block) => block.type === "tool-result" ? block.content : []).filter((block) => block.type === "text").map((block) => block.type === "text" ? block.text : "").join("\n") || "tool failed (no error text)";
		const tokensIn = tokenMeter.estimateMessage(assistantEvent.data.message) + tokenMeter.estimateMessage(event.data.message);
		targets.push({
			assistantSeq,
			resultSeq: seq,
			tool,
			errorText,
			tokensIn
		});
	}
	return targets;
}
function applyPurgeErrors(session, tokenMeter, config) {
	let purged = 0;
	let tokensSaved = 0;
	for (const target of purgeTargets(session, tokenMeter, config)) {
		const checkpointText = `[errored tool unit removed]\ntool: ${target.tool}\nerror: ${target.errorText}`;
		const checkpoint = createUserMessage({
			content: [{
				type: "text",
				text: checkpointText
			}],
			source: {
				kind: "plugin",
				plugin: "dsh-dcp"
			}
		});
		const tokensOut = tokenMeter.estimateMessage(checkpoint);
		if (tokensOut >= target.tokensIn) continue;
		session.append("compaction/prune", {
			shadowedRange: {
				start: target.assistantSeq,
				end: target.resultSeq
			},
			shadowedSeqs: [target.assistantSeq, target.resultSeq],
			shadowedTokenCount: target.tokensIn
		});
		session.append("user/message", checkpoint, {
			surfaceOp: {
				op: "replace",
				start: target.assistantSeq,
				end: target.resultSeq
			},
			sourceEventSeqs: [target.assistantSeq, target.resultSeq]
		});
		purged++;
		tokensSaved += target.tokensIn - tokensOut;
	}
	return {
		purged,
		tokensSaved
	};
}
//#endregion
//#region src/strategies/index.ts
function applyAutomaticStrategies(session, tokenMeter, config, manualActive = false) {
	if (manualActive && !config.manualMode.automaticStrategies) return {
		deduplicated: 0,
		purged: 0,
		tokensSaved: 0
	};
	const dedup = config.strategies.deduplication.enabled ? applyDeduplication(session, tokenMeter, config) : {
		replaced: 0,
		tokensSaved: 0
	};
	const purge = config.strategies.purgeErrors.enabled ? applyPurgeErrors(session, tokenMeter, config) : {
		purged: 0,
		tokensSaved: 0
	};
	return {
		deduplicated: dedup.replaced,
		purged: purge.purged,
		tokensSaved: dedup.tokensSaved + purge.tokensSaved
	};
}
//#endregion
//#region src/prompts/nudge.ts
function computeNudge(session, measure, config) {
	let markerCount = 0;
	let lastNudgeMarker = 0;
	let lastNudgeSeq = -1;
	let lastCompressionSeq = -1;
	for (const event of session.events) {
		if (event.type !== "user/message") continue;
		const text = event.data.content.filter((block) => block.type === "text").map((block) => block.type === "text" ? block.text : "").join("\n");
		if (text.includes("<dcp-boundary")) markerCount++;
		if (text.includes("DCP compression recommended")) {
			lastNudgeMarker = markerCount;
			lastNudgeSeq = event.seq;
		}
		if (decodeDcpMeta(event.data.source).ok) lastCompressionSeq = event.seq;
	}
	let stepsSinceNudge = markerCount - lastNudgeMarker;
	const armed = lastNudgeMarker === 0 ? markerCount > 0 : lastCompressionSeq > lastNudgeSeq;
	const contextWindow = session.requestContext()?.contextWindow;
	if (!config.nudge.enabled) return {
		armed,
		stepsSinceNudge
	};
	const ratio = contextWindow === void 0 ? void 0 : measure.totalTokens / contextWindow;
	if (ratio !== void 0 && ratio <= config.nudge.minRatio) stepsSinceNudge = 0;
	if (ratio !== void 0 && ratio > config.nudge.maxRatio && armed && stepsSinceNudge >= config.nudge.frequencySteps) return {
		text: `DCP compression recommended: context is at ${Math.round(ratio * 100)}% of the model window. Compress a closed range to free space.`,
		armed,
		stepsSinceNudge
	};
	if (ratio === void 0 && armed && stepsSinceNudge >= config.nudge.iterationThreshold) return {
		text: "DCP compression recommended: long-running step chain without pressure data. Compress a closed range to keep context bounded.",
		armed,
		stepsSinceNudge
	};
	return {
		armed,
		stepsSinceNudge
	};
}
//#endregion
//#region src/refs/alias.ts
/**
* For every inactive marker without an existing alias, find the native
* replacement node that shadowed it and emit `alias ref=s<seq>` lines,
* capped by `maxEntries`.
*/
function collectNativeAliases(session, state, maxEntries) {
	const aliasLines = [];
	const emitted = new Set(state.aliases.map((alias) => alias.ref));
	const replacements = /* @__PURE__ */ new Map();
	for (const event of session.events) {
		if (event.type !== "user/message" || event.surfaceOp === "append") continue;
		if (decodeDcpMeta(event.data.source).ok) continue;
		for (const seq of event.sourceEventSeqs ?? []) replacements.set(seq, event.seq);
	}
	for (const marker of state.boundaryRefs) {
		if (marker.active || emitted.has(marker.ref)) continue;
		if (aliasLines.length >= maxEntries) break;
		const replacementSeq = replacements.get(marker.seq);
		if (replacementSeq !== void 0) aliasLines.push(buildAlias(marker.ref, String(replacementSeq)));
	}
	return aliasLines;
}
//#endregion
//#region src/index.ts
const name = "dsh-dcp";
const inject = [
	"sessions",
	"tokenMeter",
	"systemPrompt",
	"tools",
	"commands"
];
function apply(ctx, config) {
	const resolved = resolveConfig(config);
	const logger = ctx.logger("dsh-dcp");
	if (!resolved.enabled) {
		logger.info("dsh-dcp disabled by config");
		return;
	}
	const unknown = unknownConfigKeys(config);
	if (unknown.length > 0) logger.warn("dcp config contains unknown keys: %s", unknown.join(", "));
	ctx.systemPrompt.section({
		name: DCP_GUIDANCE_SECTION,
		order: 190,
		text: () => renderDcpGuidance(resolved, resolved.manualMode.default)
	});
	if (resolved.compress.enabled) ctx.tools.register(createCompressTool(ctx, resolved));
	registerDcpCommands(ctx, resolved);
	ctx.on("agent/pre-step", async ({ agent, messages, turn, step, signal }, next) => {
		const decision = await next();
		if (signal.aborted) return decision;
		const state = reduceDcpState(agent.session.events, resolved.manualMode.default);
		if (messages.some(isDcpControlMessage)) {
			for (const message of messages) {
				const control = parseControl(message);
				if (!control) continue;
				if (control.kind === "sweep") applyAutomaticStrategies(agent.session, ctx.tokenMeter, resolved, state.manualMode);
				if (control.kind === "expand" && control.arg) {
					const result = applyExpansion(agent.session, ctx.tokenMeter, control.arg);
					if (!result.ok) ctx.logger("dsh-dcp").warn("control expand failed: %s", result.error);
				}
				if (control.kind === "recompress" && control.arg) {
					const result = applyRecompress(agent.session, ctx.tokenMeter, control.arg);
					if (!result.ok) ctx.logger("dsh-dcp").warn("control recompress failed: %s", result.error);
				}
			}
			return {
				kind: "enter",
				messages: []
			};
		}
		if (decision.kind === "enter") {
			applyAutomaticStrategies(agent.session, ctx.tokenMeter, resolved, state.manualMode);
			const currentState = reduceDcpState(agent.session.events, resolved.manualMode.default);
			const ref = `m${String(currentState.maxMarkerNumber + 1).padStart(4, "0")}`;
			const nudge = computeNudge(agent.session, ctx.tokenMeter.measure(agent.session), resolved);
			const aliasLines = collectNativeAliases(agent.session, currentState, resolved.references.maxAliasEntries);
			return {
				kind: "enter",
				messages: [buildStepMarkerMessage(ref, turn, step, nudge.text, aliasLines.length > 0 ? aliasLines.join("\n") : void 0), ...decision.messages]
			};
		}
		return decision;
	});
	ctx.get("settings")?.register?.("dcp", Config);
	ctx.inject(["storageDomain"], async (child) => {
		try {
			const handle = await openDcpStatsStore(child);
			if (!handle) return async () => {};
			registerDcpStatsStore(ctx, handle.store);
			return async () => {
				unregisterDcpStatsStore(ctx);
				await handle.close();
			};
		} catch (error) {
			logger.warn("dcp stats domain unavailable: %s", error instanceof Error ? error.message : String(error));
			return async () => {};
		}
	});
	if (resolved.debug) logger.info("dsh-dcp initialized", { transport: resolved.references.transport });
}
//#endregion
export { Config, apply, inject, name };
