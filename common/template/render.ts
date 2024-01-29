import { AST } from "$sb/lib/tree.ts";
import { evalQueryExpression } from "$sb/lib/query.ts";
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
      return renderExpressionDirective(
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
    case "Text":
      return children[0] as string;
    default:
      throw new Error(`Unknown template element type ${type}`);
  }
}

function renderExpressionDirective(
  ast: AST,
  value: any,
  globalVariables: Record<string, any>,
  functionMap: FunctionMap,
): string {
  const [_, expression] = ast;
  const expr = expressionToKvQueryExpression(expression);
  return "" + evalQueryExpression(expr, value, globalVariables, functionMap);
}

async function renderEachDirective(
  ast: AST,
  value: any[],
  globalVariables: Record<string, any>,
  functionMap: FunctionMap,
): Promise<string> {
  const [_, expression, ...body] = ast;
  const expr = expressionToKvQueryExpression(expression);
  const values = evalQueryExpression(
    expr,
    value,
    globalVariables,
    functionMap,
  );
  return await Promise.all(values.map(async (itemValue: any) => {
    return await renderTemplate(
      ["Document", ...body],
      itemValue,
      globalVariables,
      functionMap,
    );
  })).then((results) => results.join(""));
}

function renderIfDirective(
  ast: AST,
  value: any,
  globalVariables: Record<string, any>,
  functionMap: FunctionMap,
) {
  const [_, expression, trueTemplate, falseTemplate] = ast;
  const expr = expressionToKvQueryExpression(expression);
  const condVal = evalQueryExpression(
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
