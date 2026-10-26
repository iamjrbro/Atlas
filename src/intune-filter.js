// Small, non-executable subset of Intune filter syntax. Unknown properties,
// operators and missing device data stay indeterminate, including under NOT.
export const UNKNOWN = null;
const not = (a) => (a === null ? null : !a);
export const and = (a, b) =>
  a === false || b === false ? false : a === null || b === null ? null : true;
export const or = (a, b) =>
  a === true || b === true ? true : a === null || b === null ? null : false;
function property(device, name) {
  const fields = {
    devicename: "deviceName",
    manufacturer: "manufacturer",
    model: "model",
    osversion: "osVersion",
    devicecategory: "deviceCategoryDisplayName",
    enrollmentprofilename: "enrollmentProfileName",
  };
  name = name.toLowerCase();
  if (name === "deviceownership")
    return { company: "Corporate", personal: "Personal" }[
      String(device.managedDeviceOwnerType).toLowerCase()
    ];
  const field = Object.hasOwn(fields, name) ? fields[name] : undefined;
  return field && typeof device[field] === "string" && device[field] !== ""
    ? device[field]
    : undefined;
}
export function evaluateFilter(rule, device) {
  try {
    if (typeof rule !== "string" || rule.length > 8192) throw Error();
    const tokens = [];
    const re =
      /\s*(device\.[A-Za-z][A-Za-z0-9]*|-[A-Za-z]+|"(?:[^"\\]|\\.)*"|[()[\],])/y;
    let at = 0;
    while (at < rule.length) {
      if (!rule.slice(at).trim()) break;
      re.lastIndex = at;
      const match = re.exec(rule);
      if (!match || tokens.length >= 512) throw Error();
      tokens.push(match[1]);
      at = re.lastIndex;
    }
    let index = 0;
    const peek = () => tokens[index]?.toLowerCase();
    const take = (value) => {
      if (peek() !== value) throw Error();
      index++;
    };
    function value() {
      if (peek() === "[") {
        take("[");
        const values = [];
        while (peek() !== "]") {
          values.push(value());
          if (peek() !== ",") break;
          take(",");
        }
        take("]");
        if (values.some((v) => typeof v !== "string")) throw Error();
        return values;
      }
      const token = tokens[index++];
      if (!token?.startsWith('"')) throw Error();
      return JSON.parse(token);
    }
    function atom(depth) {
      if (depth > 32) throw Error();
      if (peek() === "-not") {
        take("-not");
        return not(atom(depth + 1));
      }
      if (peek() === "(") {
        take("(");
        const result = expression(depth + 1);
        take(")");
        return result;
      }
      const field = tokens[index++];
      if (!/^device\./i.test(field || "")) throw Error();
      const op = peek();
      index++;
      const expected = value();
      if (
        ![
          "-eq",
          "-ne",
          "-in",
          "-notin",
          "-contains",
          "-notcontains",
          "-startswith",
          "-notstartswith",
          "-endswith",
          "-notendswith",
        ].includes(op)
      )
        throw Error();
      const actual = property(device, field.slice(7));
      if (actual === undefined) return null;
      const a = actual.toLowerCase();
      if (op === "-in" || op === "-notin") {
        if (!Array.isArray(expected)) throw Error();
        const matched = expected.some((v) => v.toLowerCase() === a);
        return op === "-in" ? matched : !matched;
      }
      if (typeof expected !== "string") throw Error();
      const b = expected.toLowerCase();
      const result = op.includes("contains")
        ? a.includes(b)
        : op.includes("startswith")
          ? a.startsWith(b)
          : op.includes("endswith")
            ? a.endsWith(b)
            : a === b;
      return op === "-ne" || op.startsWith("-not") ? !result : result;
    }
    function conjunction(depth) {
      let result = atom(depth);
      while (peek() === "-and") {
        take("-and");
        result = and(result, atom(depth));
      }
      return result;
    }
    function expression(depth) {
      let result = conjunction(depth);
      while (peek() === "-or") {
        take("-or");
        result = or(result, conjunction(depth));
      }
      return result;
    }
    const result = expression(0);
    if (index !== tokens.length || !tokens.length) throw Error();
    return {
      result,
      reason:
        result === null
          ? "Propriedade não coletada ou não suportada pelo avaliador local."
          : "Filtro avaliado sobre propriedades observadas; o Intune reavalia no check-in.",
    };
  } catch {
    return {
      result: null,
      reason: "Sintaxe ou operador não suportado; requer avaliação no Intune.",
    };
  }
}
