import { defineTool } from "@deepseek-ai/dsh-tools";
import { CompactionId, isCompactCheckpointSource, toolPairingBalancedAfter, toolPairingBalancedBefore } from "@deepseek-ai/dsh-compaction";
import { deriveEventMessage, foldSurface } from "@deepseek-ai/dsh-session";
import { createUserMessage, freezeMessage } from "@deepseek-ai/dsh-llm/message";
//#region node_modules/.pnpm/@deepseek-ai+cosmokit@1.8.2/node_modules/@deepseek-ai/cosmokit/lib/index.js
/** Return true when a value is `null` or `undefined`. */
function isNullable(value) {
	return value === null || value === void 0;
}
/** Return true for non-array object values. */
function isPlainObject(data) {
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
function pick(source, keys, forced) {
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
function clone(source, refs = /* @__PURE__ */ new Map()) {
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
			result[index] = Reflect.apply(clone, null, [value, refs]);
		});
		return result;
	}
	const result = Object.create(Object.getPrototypeOf(source));
	refs.set(source, result);
	for (const key of Reflect.ownKeys(source)) {
		const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
		if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
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
	const pattern = pick(regexp, ["source", "flags"]);
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
		data = clone(fallback);
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
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
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
function merge(result, data) {
	for (const key in data) {
		if (key in result) continue;
		result[key] = data[key];
	}
}
Schema.extend("object", (data, { dict }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in dict) {
		const value = property(data, key, dict[key], options);
		if (!isNullable(value) || key in data) result[key] = value;
	}
	if (!strict) merge(result, data);
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
		else if (typeof value === "object") merge(result ??= {}, value);
		else if (result !== value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
	}
	if (!strict && isPlainObject(data)) merge(result, data);
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
function computeSessionStats(events) {
	let blockCount = 0;
	let shadowedTokens = 0;
	let checkpointTokens = 0;
	let pruneReplacements = 0;
	let markerTokens = 0;
	for (let index = 0; index < events.length; index++) {
		const event = events[index];
		switch (event.type) {
			case "compaction/summary": {
				const next = events[index + 1];
				if (next?.type === "user/message" && next.surfaceOp !== "append" && decodeDcpMeta(next.data.source).ok) shadowedTokens += event.data.shadowedTokenCount;
				break;
			}
			case "compaction/prune": {
				const next = events[index + 1];
				const nextText = next?.type === "tool/result" || next?.type === "assistant/message" ? next.data.message.content.flatMap((block) => block.type === "tool-result" ? block.content : [block]).filter((block) => block.type === "text").map((block) => block.type === "text" ? block.text : "").join("\n") : next?.type === "user/message" ? next.data.content.filter((block) => block.type === "text").map((block) => block.type === "text" ? block.text : "").join("\n") : "";
				if (nextText.includes("[duplicate ") || nextText.includes("[errored tool unit removed]")) pruneReplacements++;
				break;
			}
			case "user/message": {
				const text = event.data.content.filter((block) => block.type === "text").map((block) => block.type === "text" ? block.text : "").join("\n");
				if (text.includes("<dcp-boundary ref=")) markerTokens += heuristicTokens(text);
				if (decodeDcpMeta(event.data.source).ok) {
					blockCount++;
					checkpointTokens += heuristicTokens(text);
				}
				break;
			}
		}
	}
	return {
		blockCount,
		shadowedTokens,
		checkpointTokens,
		pruneReplacements,
		markerTokens,
		netSavedTokens: Math.max(0, shadowedTokens - checkpointTokens)
	};
}
//#endregion
//#region src/commands/stats.ts
function renderStats(ctx, agent) {
	const stats = computeSessionStats(agent.session.events);
	const measure = ctx.tokenMeter.measure(agent.session);
	return [
		"DCP statistics:",
		`  blocks:            ${stats.blockCount}`,
		`  shadowed tokens:   ~${stats.shadowedTokens}`,
		`  checkpoint tokens: ~${stats.checkpointTokens}`,
		`  net saved:         ~${stats.netSavedTokens}`,
		`  prune replacements: ${stats.pruneReplacements}`,
		`  marker tokens:     ~${stats.markerTokens}`,
		`  current surface:   ~${measure.surfaceTokens}`
	].join("\n");
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
					text: renderStats(ctx, invocation.agent)
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
			turn: event.data.turn,
			step: event.data.step,
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
	if (resolved.debug) logger.info("dsh-dcp initialized", { transport: resolved.references.transport });
}
//#endregion
export { Config, apply, inject, name };
