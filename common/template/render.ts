import { AST } from "$sb/lib/tree.ts";
import { evalQueryExpression } from "$sb/lib/query.ts";
import { DataStore } from "../../plugos/lib/datastore.ts";
import {
  astToKvQuery,
  expressionToKvQueryExpression,
} from "$sb/lib/parse-query.ts";

export async function renderTemplate(
  ast: AST,
  value: any,
  globalVariables: Record<string, any>,
  ds: DataStore,
): Promise<string> {
  const [_, ...elements] = ast;
  const renderedElements = await Promise.all(
    elements.map((e) => renderTemplateElement(e, value, globalVariables, ds)),
  );
  return renderedElements.join("");
}

async function renderTemplateElement(
  ast: AST,
  value: any,
  globalVariables: Record<string, any>,
  ds: DataStore,
): Promise<string> {
  const [type, ...children] = ast;
  switch (type) {
    case "TemplateElement":
      return (await Promise.all(
        children.map((c) =>
          renderTemplateElement(c, value, globalVariables, ds)
        ),
      )).join("");
    case "ExpressionDirective":
      return renderExpressionDirective(ast, value, globalVariables, ds);
    case "EachDirective":
      return await renderEachDirective(ast, value, globalVariables, ds);
    case "IfDirective":
      return await renderIfDirective(ast, value, globalVariables, ds);
    case "QueryDirective":
      return await renderQueryDirective(ast, globalVariables, ds);
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
  ds: DataStore,
): string {
  const [_, expression] = ast;
  const expr = expressionToKvQueryExpression(expression);
  return "" + evalQueryExpression(expr, value, globalVariables, ds.functionMap);
}

async function renderEachDirective(
  ast: AST,
  value: any[],
  globalVariables: Record<string, any>,
  ds: DataStore,
): Promise<string> {
  const [_, expression, ...body] = ast;
  const expr = expressionToKvQueryExpression(expression);
  const values = evalQueryExpression(
    expr,
    value,
    globalVariables,
    ds.functionMap,
  );
  return await Promise.all(values.map(async (itemValue: any) => {
    return await renderTemplate(
      ["Document", ...body],
      itemValue,
      globalVariables,
      ds,
    );
  })).then((results) => results.join(""));
}

async function renderQueryDirective(
  ast: AST,
  globalVariables: Record<string, any>,
  ds: DataStore,
): Promise<string> {
  const [_, expression, ...body] = ast;
  const query = astToKvQuery(expression);
  const values = await ds.query(query);
  return await Promise.all(values.map(async (kv) => {
    return await renderTemplate(
      ["Document", ...body],
      kv.value,
      globalVariables,
      ds,
    );
  })).then((results) => results.join(""));
}

function renderIfDirective(
  ast: AST,
  value: any,
  globalVariables: Record<string, any>,
  ds: DataStore,
) {
  const [_, expression, trueTemplate, falseTemplate] = ast;
  const expr = expressionToKvQueryExpression(expression);
  const condVal = evalQueryExpression(
    expr,
    value,
    globalVariables,
    ds.functionMap,
  );
  if (condVal) {
    return renderTemplate(trueTemplate, value, globalVariables, ds);
  } else {
    return falseTemplate
      ? renderTemplate(falseTemplate, value, globalVariables, ds)
      : "";
  }
}
