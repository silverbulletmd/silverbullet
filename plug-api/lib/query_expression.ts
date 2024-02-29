import { FunctionMap, QueryExpression } from "../types.ts";

export function evalQueryExpression(
  val: QueryExpression,
  obj: any,
  variables: Record<string, any>,
  functionMap: FunctionMap,
): Promise<any> | any {
  const [type, op1] = val;

  switch (type) {
    // Logical operators
    case "and": {
      const op1Val = evalQueryExpression(
        op1,
        obj,
        variables,
        functionMap,
      );
      if (op1Val instanceof Promise) {
        return op1Val.then((v) =>
          v &&
          evalQueryExpression(val[2], obj, variables, functionMap)
        );
      } else if (op1Val) {
        return evalQueryExpression(val[2], obj, variables, functionMap);
      } else {
        return false;
      }
    }
    case "or": {
      const op1Val = evalQueryExpression(
        op1,
        obj,
        variables,
        functionMap,
      );
      if (op1Val instanceof Promise) {
        return op1Val.then((v) =>
          v ||
          evalQueryExpression(val[2], obj, variables, functionMap)
        );
      } else if (op1Val) {
        return true;
      } else {
        return evalQueryExpression(val[2], obj, variables, functionMap);
      }
    }
    // Value types
    case "null":
      return null;
    // TODO: Add this to the actualy query syntax
    case "not": {
      const val = evalQueryExpression(op1, obj, variables, functionMap);
      if (val instanceof Promise) {
        return val.then((v) => !v);
      } else {
        return !val;
      }
    }
    case "number":
    case "string":
    case "boolean":
      return op1;
    case "regexp":
      return [op1, val[2]];
    case "attr": {
      const attributeVal = obj;
      if (val.length === 3) {
        const attributeVal = evalQueryExpression(
          val[1],
          obj,
          variables,
          functionMap,
        );
        if (attributeVal instanceof Promise) {
          return attributeVal.then((v) => v[val[2]]);
        } else if (attributeVal) {
          return attributeVal[val[2]];
        } else {
          return null;
        }
      } else if (!val[1]) {
        return obj;
      } else {
        let attrVal = attributeVal[val[1]];
        const func = functionMap[val[1]];
        if (attrVal === undefined && func !== undefined) {
          // Fallback to function call, if one is defined with this name
          attrVal = func(variables);
        }
        return attrVal;
      }
    }
    case "global": {
      return variables[op1];
    }
    case "array": {
      const argValues = op1.map((v) =>
        evalQueryExpression(v, obj, variables, functionMap)
      );
      // Check if any arg value is a promise, and if so wait for it
      const waitForPromises: Promise<void>[] = [];
      for (let i = 0; i < argValues.length; i++) {
        if (argValues[i] instanceof Promise) {
          // Wait and replace in-place
          waitForPromises.push(argValues[i].then((v: any) => argValues[i] = v));
        }
      }
      if (waitForPromises.length > 0) {
        return Promise.all(waitForPromises).then(() => argValues);
      } else {
        return argValues;
      }
    }
    case "object": {
      const objEntries: [string, any][] = op1.map((
        [key, expr],
      ) => [key, evalQueryExpression(expr, obj, variables, functionMap)]);
      // Check if any arg value is a promise, and if so wait for it
      const waitForPromises: Promise<void>[] = [];
      for (let i = 0; i < objEntries.length; i++) {
        if (objEntries[i][1] instanceof Promise) {
          // Wait and replace in-place
          waitForPromises.push(
            objEntries[i][1].then((v: any) => objEntries[i] = v),
          );
        }
      }
      if (waitForPromises.length > 0) {
        return Promise.all(waitForPromises).then(() =>
          Object.fromEntries(objEntries)
        );
      } else {
        return Object.fromEntries(objEntries);
      }
    }
    case "pageref": {
      const readPageFunction = functionMap.readPage;
      if (!readPageFunction) {
        throw new Error(`No readPage function defined`);
      }
      return readPageFunction(op1);
    }
    case "query": {
      const parsedQuery = val[1];
      const queryFunction = functionMap.$query;
      if (!queryFunction) {
        throw new Error(`No $query function defined`);
      }
      return queryFunction(parsedQuery, variables);
    }
    case "call": {
      const fn = functionMap[op1];
      if (!fn) {
        throw new Error(`Unknown function: ${op1}`);
      }
      const argValues = val[2].map((v) =>
        evalQueryExpression(v, obj, variables, functionMap)
      );
      // Check if any arg value is a promise, and if so wait for it
      const waitForPromises: Promise<void>[] = [];
      for (let i = 0; i < argValues.length; i++) {
        if (argValues[i] instanceof Promise) {
          // Wait and replace in-place
          waitForPromises.push(argValues[i].then((v: any) => argValues[i] = v));
        }
      }
      if (waitForPromises.length > 0) {
        return Promise.all(waitForPromises).then(() => fn(...argValues));
      } else {
        return fn(...argValues);
      }
    }
    case "-": {
      if (val.length == 2) { // only unary minus
        const val = evalQueryExpression(op1, obj, variables, functionMap);
        return -val;
      }
    }
  }

  // Binary operators, here we can pre-calculate the two operand values
  const val1 = evalQueryExpression(
    op1,
    obj,
    variables,
    functionMap,
  );
  const val2 = evalQueryExpression(
    val[2],
    obj,
    variables,
    functionMap,
  );

  const val3 = val[3]
    ? evalQueryExpression(
      val[3],
      obj,
      variables,
      functionMap,
    )
    : undefined;

  if (
    val1 instanceof Promise || val2 instanceof Promise ||
    val3 instanceof Promise
  ) {
    return Promise.all([val1, val2, val3]).then(([v1, v2, v3]) =>
      evalSimpleExpression(type, v1, v2, v3)
    );
  } else {
    return evalSimpleExpression(type, val1, val2, val3);
  }
}
function evalSimpleExpression(type: string, val1: any, val2: any, val3: any) {
  switch (type) {
    case "+":
      return val1 + val2;
    case "-":
      return val1 - val2;
    case "*":
      return val1 * val2;
    case "/":
      return val1 / val2;
    case "%":
      return val1 % val2;
    case "=": {
      if (Array.isArray(val1) && !Array.isArray(val2)) {
        // Record property is an array, and value is a scalar: find the value in the array
        return val1.includes(val2);
      } else if (Array.isArray(val1) && Array.isArray(val2)) {
        // Record property is an array, and value is an array: compare the arrays
        return val1.length === val2.length &&
          val1.every((v) => val2.includes(v));
      }
      return val1 == val2;
    }
    case "!=": {
      if (Array.isArray(val1) && !Array.isArray(val2)) {
        // Record property is an array, and value is a scalar: find the value in the array
        return !val1.includes(val2);
      } else if (Array.isArray(val1) && Array.isArray(val2)) {
        // Record property is an array, and value is an array: compare the arrays
        return !(val1.length === val2.length &&
          val1.every((v) => val2.includes(v)));
      }
      return val1 != val2;
    }
    case "=~": {
      if (!Array.isArray(val2)) {
        throw new Error(`Invalid regexp: ${val2}`);
      }
      const r = new RegExp(val2[0], val2[1]);
      return r.test(val1);
    }
    case "!=~": {
      if (!Array.isArray(val2)) {
        throw new Error(`Invalid regexp: ${val2}`);
      }
      const r = new RegExp(val2[0], val2[1]);
      return !r.test(val1);
    }
    case "<":
      return val1 < val2;
    case "<=":
      return val1 <= val2;
    case ">":
      return val1 > val2;
    case ">=":
      return val1 >= val2;
    case "in":
      return val2.includes(val1);
    case "?":
      return val1 ? val2 : val3;
    default:
      throw new Error(`Unupported operator: ${type}`);
  }
}
