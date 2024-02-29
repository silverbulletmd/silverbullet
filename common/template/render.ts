import { AST } from "../../plug-api/lib/tree.ts";
import { evalQueryExpression } from "$sb/lib/query_expression.ts";
import { expressionToKvQueryExpression } from "$sb/lib/parse-query.ts";
import { FunctionMap } from "../../plug-api/types.ts";
import { jsonToMDTable } from "../../plugs/template/util.ts";

export async function renderTemplate(
  ast: AST,
  value: any,
  variables: Record<string, any>,
  functionMap: FunctionMap,
): Promise<string> {
  const [_, ...elements] = ast;
  const renderedElements = await Promise.all(
    elements.map((e) =>
      renderTemplateElement(e, value, variables, functionMap)
    ),
  );
  return renderedElements.join("");
}

async function renderTemplateElement(
  ast: AST,
  value: any,
  variables: Record<string, any>,
  functionMap: FunctionMap,
): Promise<string> {
  const [type, ...children] = ast;
  switch (type) {
    case "TemplateElement":
      return (await Promise.all(
        children.map((c) =>
          renderTemplateElement(c, value, variables, functionMap)
        ),
      )).join("");
    case "ExpressionDirective":
      return await renderExpressionDirective(
        ast,
        value,
        variables,
        functionMap,
      );
    case "EachDirective":
      return await renderEachDirective(
        ast,
        value,
        variables,
        functionMap,
      );
    case "EachVarDirective":
      return await renderEachVarDirective(
        ast,
        value,
        variables,
        functionMap,
      );
    case "IfDirective":
      return await renderIfDirective(ast, value, variables, functionMap);
    case "LetDirective":
      return await renderLetDirective(ast, value, variables, functionMap);
    case "Text":
      return children[0] as string;
    default:
      throw new Error(`Unknown template element type ${type}`);
  }
}

async function renderExpressionDirective(
  ast: AST,
  value: any,
  variables: Record<string, any>,
  functionMap: FunctionMap,
): Promise<string> {
  const [_, expression] = ast;
  const expr = expressionToKvQueryExpression(expression);
  const result = await evalQueryExpression(
    expr,
    value,
    variables,
    functionMap,
  );

  if (
    Array.isArray(result) && result.length > 0 && typeof result[0] === "object"
  ) {
    // If result is an array of objects, render as a markdown table
    try {
      return jsonToMDTable(result);
    } catch (e: any) {
      console.error(
        `Error rendering expression directive: ${e.message} for value ${
          JSON.stringify(result)
        }`,
      );
      return JSON.stringify(result);
    }
  } else if (typeof result === "object" && result.constructor === Object) {
    // if result is a plain object, render as a markdown table
    return jsonToMDTable([result]);
  } else if (Array.isArray(result)) {
    // Not-object array
    return JSON.stringify(result);
  } else {
    return "" + result;
  }
}

async function renderEachVarDirective(
  ast: AST,
  value: any[],
  variables: Record<string, any>,
  functionMap: FunctionMap,
): Promise<string> {
  const [_eachVarDirective, name, expression, template] = ast;
  const expr = expressionToKvQueryExpression(expression);
  const values = await evalQueryExpression(
    expr,
    value,
    variables,
    functionMap,
  );
  if (!Array.isArray(values)) {
    throw new Error(
      `Expecting a list expression for #each var directive, instead got ${values}`,
    );
  }
  const resultPieces: string[] = [];
  for (const itemValue of values) {
    const localVariables = { ...variables, [name as any]: itemValue };
    try {
      resultPieces.push(
        await renderTemplate(
          template,
          value,
          localVariables,
          functionMap,
        ),
      );
    } catch (e: any) {
      throw new Error(
        `Error rendering #each directive: ${e.message} for item ${
          JSON.stringify(itemValue)
        }`,
      );
    }
  }
  return resultPieces.join("");
}

async function renderEachDirective(
  ast: AST,
  value: any[],
  variables: Record<string, any>,
  functionMap: FunctionMap,
): Promise<string> {
  const [_eachDirective, expression, template] = ast;
  const expr = expressionToKvQueryExpression(expression);
  const values = await evalQueryExpression(
    expr,
    value,
    variables,
    functionMap,
  );
  if (!Array.isArray(values)) {
    throw new Error(
      `Expecting a list expression for #each directive, instead got ${values}`,
    );
  }
  const resultPieces: string[] = [];
  for (const itemValue of values) {
    try {
      resultPieces.push(
        await renderTemplate(
          template,
          itemValue,
          variables,
          functionMap,
        ),
      );
    } catch (e: any) {
      throw new Error(
        `Error rendering #each directive: ${e.message} for item ${
          JSON.stringify(itemValue)
        }`,
      );
    }
  }
  return resultPieces.join("");
}

async function renderIfDirective(
  ast: AST,
  value: any,
  variables: Record<string, any>,
  functionMap: FunctionMap,
) {
  const [_, expression, trueTemplate, falseTemplate] = ast;
  const expr = expressionToKvQueryExpression(expression);
  const condVal = await evalQueryExpression(
    expr,
    value,
    variables,
    functionMap,
  );
  if (
    !Array.isArray(condVal) && condVal ||
    (Array.isArray(condVal) && condVal.length > 0)
  ) {
    return renderTemplate(trueTemplate, value, variables, functionMap);
  } else {
    return falseTemplate
      ? renderTemplate(falseTemplate, value, variables, functionMap)
      : "";
  }
}

async function renderLetDirective(
  ast: AST,
  value: any,
  variables: Record<string, any>,
  functionMap: FunctionMap,
) {
  const [_letDirective, name, expression, template] = ast;
  const expr = expressionToKvQueryExpression(expression);
  const val = await evalQueryExpression(
    expr,
    value,
    variables,
    functionMap,
  );
  const newVariables = { ...variables, [name as any]: val };
  return await renderTemplate(
    template,
    value,
    newVariables,
    functionMap,
  );
}
