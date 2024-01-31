import { AST } from "$sb/lib/tree.ts";
import { evalQueryExpression } from "$sb/lib/query_expression.ts";
import { expressionToKvQueryExpression } from "$sb/lib/parse-query.ts";
import { FunctionMap } from "$sb/types.ts";

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
  return "" + result;
}

async function renderEachDirective(
  ast: AST,
  value: any[],
  variables: Record<string, any>,
  functionMap: FunctionMap,
): Promise<string> {
  const [_, expression, ...body] = ast;
  const expr = expressionToKvQueryExpression(expression);
  const values = await evalQueryExpression(
    expr,
    value,
    variables,
    functionMap,
  );
  return await Promise.all(values.map(async (itemValue: any) => {
    return await renderTemplate(
      ["Document", ...body],
      itemValue,
      variables,
      functionMap,
    );
  })).then((results) => results.join(""));
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
  const [_, name, expression, ...body] = ast;
  const expr = expressionToKvQueryExpression(expression);
  const val = await evalQueryExpression(
    expr,
    value,
    variables,
    functionMap,
  );
  const newGlobalVariables = { ...variables, [name as any]: val };
  return await renderTemplate(
    ["Document", ...body],
    value,
    newGlobalVariables,
    functionMap,
  );
}
