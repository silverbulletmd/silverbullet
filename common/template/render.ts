import { AST } from "$sb/lib/tree.ts";
import { evalQueryExpression } from "$sb/lib/query_expression.ts";
import { expressionToKvQueryExpression } from "$sb/lib/parse-query.ts";
import { FunctionMap } from "$sb/types.ts";

export async function renderTemplate(
  ast: AST,
  value: any,
  globalVariables: Record<string, any>,
  functionMap: FunctionMap,
): Promise<string> {
  const [_, ...elements] = ast;
  const renderedElements = await Promise.all(
    elements.map((e) =>
      renderTemplateElement(e, value, globalVariables, functionMap)
    ),
  );
  return renderedElements.join("");
}

async function renderTemplateElement(
  ast: AST,
  value: any,
  globalVariables: Record<string, any>,
  functionMap: FunctionMap,
): Promise<string> {
  const [type, ...children] = ast;
  switch (type) {
    case "TemplateElement":
      return (await Promise.all(
        children.map((c) =>
          renderTemplateElement(c, value, globalVariables, functionMap)
        ),
      )).join("");
    case "ExpressionDirective":
      return await renderExpressionDirective(
        ast,
        value,
        globalVariables,
        functionMap,
      );
    case "EachDirective":
      return await renderEachDirective(
        ast,
        value,
        globalVariables,
        functionMap,
      );
    case "IfDirective":
      return await renderIfDirective(ast, value, globalVariables, functionMap);
    case "LetDirective":
      return await renderLetDirective(ast, value, globalVariables, functionMap);
    case "Text":
      return children[0] as string;
    default:
      throw new Error(`Unknown template element type ${type}`);
  }
}

async function renderExpressionDirective(
  ast: AST,
  value: any,
  globalVariables: Record<string, any>,
  functionMap: FunctionMap,
): Promise<string> {
  const [_, expression] = ast;
  const expr = expressionToKvQueryExpression(expression);
  return "" +
    await evalQueryExpression(expr, value, globalVariables, functionMap);
}

async function renderEachDirective(
  ast: AST,
  value: any[],
  globalVariables: Record<string, any>,
  functionMap: FunctionMap,
): Promise<string> {
  const [_, expression, ...body] = ast;
  const expr = expressionToKvQueryExpression(expression);
  const values = await evalQueryExpression(
    expr,
    value,
    globalVariables,
    functionMap,
  );
  console.log("Got values", values);
  return await Promise.all(values.map(async (itemValue: any) => {
    return await renderTemplate(
      ["Document", ...body],
      itemValue,
      globalVariables,
      functionMap,
    );
  })).then((results) => results.join(""));
}

async function renderIfDirective(
  ast: AST,
  value: any,
  globalVariables: Record<string, any>,
  functionMap: FunctionMap,
) {
  const [_, expression, trueTemplate, falseTemplate] = ast;
  const expr = expressionToKvQueryExpression(expression);
  const condVal = await evalQueryExpression(
    expr,
    value,
    globalVariables,
    functionMap,
  );
  if (
    !Array.isArray(condVal) && condVal ||
    (Array.isArray(condVal) && condVal.length > 0)
  ) {
    return renderTemplate(trueTemplate, value, globalVariables, functionMap);
  } else {
    return falseTemplate
      ? renderTemplate(falseTemplate, value, globalVariables, functionMap)
      : "";
  }
}

async function renderLetDirective(
  ast: AST,
  value: any,
  globalVariables: Record<string, any>,
  functionMap: FunctionMap,
) {
  const [_, name, expression, ...body] = ast;
  const expr = expressionToKvQueryExpression(expression);
  const val = await evalQueryExpression(
    expr,
    value,
    globalVariables,
    functionMap,
  );
  const newGlobalVariables = { ...globalVariables, [name as any]: val };
  return await renderTemplate(
    ["Document", ...body],
    value,
    newGlobalVariables,
    functionMap,
  );
}
