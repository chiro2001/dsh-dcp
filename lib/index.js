import { defineTool } from "@deepseek-ai/dsh-tools";
import { CompactionId, isCompactCheckpointSource, toolPairingBalancedBefore } from "@deepseek-ai/dsh-compaction";
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
		"- If the requested range is invalid or would not save enough tokens, the tool returns no-op guidance; retry with a smaller or safer range."
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
	if (!isCompactCheckpointSource(source)) return {
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
const BOUNDARY_MARKER = /<dcp-boundary ref="(m\d{4})"[^>]*\/>/g;
const BLOCK_REF = /^b([1-9]\d*)$/;
const MESSAGE_REF = /^m(\d{4})$/;
function emptyDcpState() {
	return {
		protocolVersion: 1,
		log: [],
		blocks: [],
		activeBlockRefs: [],
		boundaryRefs: [],
		pruneReplacements: /* @__PURE__ */ new Map(),
		diagnostics: [],
		maxBlockNumber: 0,
		maxMarkerNumber: 0,
		manualMode: false
	};
}
/** Canonical cold replay: fold the complete log once. */
function reduceDcpState(events) {
	const state = emptyDcpState();
	state.log = [...events];
	const surface = foldSurface(events);
	const surfaceSeqs = new Set(surface.nodes);
	const membership = reconcileBlockMembership(events);
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
		} else state.diagnostics.push({
			...decoded.diagnostic,
			seq: event.seq
		});
		if (event.data.source.plugin === "dsh-dcp") for (const match of event.data.content[0]?.type === "text" ? event.data.content[0].text.matchAll(BOUNDARY_MARKER) : []) {
			const ref = match[1];
			state.boundaryRefs.push({
				ref,
				seq: event.seq,
				active: surfaceSeqs.has(event.seq)
			});
			const markerNumber = Number(MESSAGE_REF.exec(ref)?.[1] ?? 0);
			state.maxMarkerNumber = Math.max(state.maxMarkerNumber, markerNumber);
		}
	}
	state.pruneReplacements = foldPruneReplacements(events);
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
function resolveBoundaryPosition(surface, boundaryRefs, ref) {
	const record = boundaryRefs.find((entry) => entry.ref === ref);
	if (!record || !record.active) return void 0;
	const position = surface.indexOf(record.seq);
	if (position === -1) return void 0;
	return {
		position,
		seq: record.seq
	};
}
/**
* Half-open range `[startRef, endRef)`: endRef must be a boundary at or after
* startRef, and both markers must be on the current surface.
*/
function resolveRange(surface, boundaryRefs, startRef, endRef) {
	const start = resolveBoundaryPosition(surface, boundaryRefs, startRef);
	if (!start) return {
		ok: false,
		reason: `startRef ${startRef} is not an active boundary`
	};
	const end = resolveBoundaryPosition(surface, boundaryRefs, endRef);
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
//#region src/protection/classify.ts
const PROTECT_TAG = /<protect>([\s\S]*?)<\/protect>/gi;
/** Collect verbatim user messages and <protect> tags from shadowed nodes. */
function collectProtectedAppendix(session, shadowedSeqs, config) {
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
	}
	return {
		text: sections.join(""),
		kinds: [...new Set(kinds)]
	};
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
function prepareRange(session, tokenMeter, config, state, entry, blockRef, topic) {
	const surface = [...session.surface.nodes];
	const resolved = resolveRange(surface, state.boundaryRefs, entry.startRef, entry.endRef);
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
	const activeBlockSeqs = new Set(state.blocks.filter((block) => block.membership === "active").map((block) => block.seq));
	for (const seq of shadowedSeqs) if (activeBlockSeqs.has(seq)) return {
		ok: false,
		errors: [`range ${entry.startRef}..${entry.endRef} contains active compression block; nesting lands in M2`]
	};
	const tokensIn = shadowedSeqs.reduce((sum, seq) => {
		const message = deriveEventMessage(events[seq]);
		return sum + (message ? tokenMeter.estimateMessage(message) : 0);
	}, 0);
	const appendix = collectProtectedAppendix(session, shadowedSeqs, config);
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
			protectedKinds: appendix.kinds
		}
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
			consumedBlockRefs: [],
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
function cleanupInlineSummary(session, tokenMeter, compressCallId, blockRef) {
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
				for (const entry of parsed.content) if (entry && typeof entry.summary === "string") {
					entry.summary = `[stored in ${blockRef}]`;
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
function executeCompressRange(session, tokenMeter, config, args, meta) {
	const errors = validateCompressArgs(args, config.compress.maxRangesPerCall);
	if (errors.length > 0) throw new Error(errors.join("\n"));
	if (args.content.length !== 1) throw new Error("multiple ranges land in M2; send one range at a time");
	const state = reduceDcpState(session.events);
	const blockRef = `b${state.maxBlockNumber + 1}`;
	const preparedResult = prepareRange(session, tokenMeter, config, state, args.content[0], blockRef, args.topic);
	if (!preparedResult.ok) throw new Error(preparedResult.errors.join("\n"));
	const prepared = preparedResult.prepared;
	const committed = commitRange(session, tokenMeter, prepared, blockRef, meta);
	const cleanup = cleanupInlineSummary(session, tokenMeter, meta.compressCallId, blockRef);
	return {
		blockRef,
		checkpointSeq: committed.checkpointSeq,
		compressedMessages: prepared.shadowedSeqs.length,
		compressedTokens: prepared.tokensIn - prepared.tokensOut,
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
			return `Compressed ${result.compressedMessages} message(s) into ${result.blockRef}.${warning}`;
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
		"  /dcp stats     show DCP statistics (M4)",
		"  /dcp manual    toggle manual mode (M3)",
		"  /dcp sweep     run automatic pruning (M3)",
		"  /dcp compress  trigger a compression turn (M4)",
		"  /dcp decompress <bN> / recompress <bN> (M4)",
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
//#region src/commands/index.ts
function registerDcpCommands(ctx, _config) {
	ctx.commands.register({
		name: "dcp",
		description: "DCP context management",
		input: { hint: "help|context" },
		async handler(invocation) {
			const subcommand = (invocation.rawInput.trim().split(/\s+/).find(Boolean) ?? "help").toLowerCase();
			switch (subcommand) {
				case "help": return {
					kind: "success",
					text: renderHelp()
				};
				case "context": return {
					kind: "success",
					text: renderContext(ctx, invocation.agent)
				};
				default: return {
					kind: "error",
					text: `Unknown /dcp subcommand "${subcommand}". Use /dcp help.`
				};
			}
		}
	});
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
	const unknown = unknownConfigKeys(config);
	if (unknown.length > 0) logger.warn("dcp config contains unknown keys: %s", unknown.join(", "));
	ctx.systemPrompt.section({
		name: DCP_GUIDANCE_SECTION,
		order: 190,
		text: () => renderDcpGuidance(resolved, resolved.manualMode.default)
	});
	if (resolved.compress.enabled) ctx.tools.register(createCompressTool(ctx, resolved));
	registerDcpCommands(ctx, resolved);
	ctx.get("settings")?.register?.("dcp", Config);
	if (resolved.debug) logger.info("dsh-dcp initialized", { transport: resolved.references.transport });
}
//#endregion
export { Config, apply, inject, name };
