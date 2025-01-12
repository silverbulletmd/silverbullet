type ASTContext = {
  ctx: ASTCtx;
};

export type ASTCtx = {
  from?: number;
  to?: number;
} & Record<string, any>;

export type LuaBlock = {
  type: "Block";
  statements: LuaStatement[];
} & ASTContext;

// STATEMENTS
export type LuaReturnStatement = {
  type: "Return";
  expressions: LuaExpression[];
} & ASTContext;

export type LuaStatement =
  | LuaSemicolonStatement
  | LuaLabelStatement
  | LuaBreakStatement
  | LuaGotoStatement
  | LuaReturnStatement
  | LuaBlock
  | LuaWhileStatement
  | LuaRepeatStatement
  | LuaIfStatement
  | LuaForStatement
  | LuaForInStatement
  | LuaFunctionStatement
  | LuaLocalFunctionStatement
  | LuaAssignmentStatement
  | LuaLocalStatement
  | LuaFunctionCallStatement;

export type LuaSemicolonStatement = {
  type: "Semicolon";
} & ASTContext;

export type LuaLabelStatement = {
  type: "Label";
  name: string;
} & ASTContext;

export type LuaBreakStatement = {
  type: "Break";
} & ASTContext;

export type LuaGotoStatement = {
  type: "Goto";
  name: string;
} & ASTContext;

export type LuaWhileStatement = {
  type: "While";
  condition: LuaExpression;
  block: LuaBlock;
} & ASTContext;

export type LuaRepeatStatement = {
  type: "Repeat";
  block: LuaBlock;
  condition: LuaExpression;
} & ASTContext;

export type LuaIfStatement = {
  type: "If";
  conditions: { condition: LuaExpression; block: LuaBlock }[];
  elseBlock?: LuaBlock;
} & ASTContext;

export type LuaForStatement = {
  type: "For";
  name: string;
  start: LuaExpression;
  end: LuaExpression;
  step?: LuaExpression;
  block: LuaBlock;
} & ASTContext;

export type LuaForInStatement = {
  type: "ForIn";
  names: string[];
  expressions: LuaExpression[];
  block: LuaBlock;
} & ASTContext;

export type LuaFunctionStatement = {
  type: "Function";
  name: LuaFunctionName;
  body: LuaFunctionBody;
} & ASTContext;

export type LuaLocalFunctionStatement = {
  type: "LocalFunction";
  name: string;
  body: LuaFunctionBody;
} & ASTContext;

export type LuaFunctionName = {
  type: "FunctionName";
  propNames: string[];
  colonName?: string;
} & ASTContext;

export type LuaFunctionBody = {
  type: "FunctionBody";
  parameters: string[];
  block: LuaBlock;
} & ASTContext;

export type LuaAssignmentStatement = {
  type: "Assignment";
  variables: LuaLValue[];
  expressions: LuaExpression[];
} & ASTContext;

export type LuaLValue =
  | LuaVariable
  | LuaPropertyAccessExpression
  | LuaTableAccessExpression;

export type LuaLocalStatement = {
  type: "Local";
  names: LuaAttName[];
  expressions?: LuaExpression[];
} & ASTContext;

export type LuaAttName = {
  type: "AttName";
  name: string;
  attribute?: string;
} & ASTContext;

export type LuaFunctionCallStatement = {
  type: "FunctionCallStatement";
  call: LuaFunctionCallExpression;
} & ASTContext;

// EXPRESSIONS
export type LuaExpression =
  | LuaNilLiteral
  | LuaBooleanLiteral
  | LuaNumberLiteral
  | LuaStringLiteral
  | LuaPrefixExpression
  | LuaBinaryExpression
  | LuaUnaryExpression
  | LuaTableConstructor
  | LuaFunctionDefinition
  | LuaQueryExpression;

export type LuaNilLiteral = {
  type: "Nil";
} & ASTContext;

export type LuaBooleanLiteral = {
  type: "Boolean";
  value: boolean;
} & ASTContext;

export type LuaNumberLiteral = {
  type: "Number";
  value: number;
} & ASTContext;

export type LuaStringLiteral = {
  type: "String";
  value: string;
} & ASTContext;

export type LuaPrefixExpression =
  | LuaVariableExpression
  | LuaParenthesizedExpression
  | LuaFunctionCallExpression;

export type LuaParenthesizedExpression = {
  type: "Parenthesized";
  expression: LuaExpression;
} & ASTContext;

export type LuaVariableExpression =
  | LuaVariable
  | LuaPropertyAccessExpression
  | LuaTableAccessExpression;

export type LuaVariable = {
  type: "Variable";
  name: string;
} & ASTContext;

export type LuaPropertyAccessExpression = {
  type: "PropertyAccess";
  object: LuaPrefixExpression;
  property: string;
} & ASTContext;

export type LuaTableAccessExpression = {
  type: "TableAccess";
  object: LuaPrefixExpression;
  key: LuaExpression;
} & ASTContext;

export type LuaFunctionCallExpression = {
  type: "FunctionCall";
  prefix: LuaPrefixExpression;
  name?: string;
  args: LuaExpression[];
} & ASTContext;

export type LuaBinaryExpression = {
  type: "Binary";
  operator: string;
  left: LuaExpression;
  right: LuaExpression;
} & ASTContext;

export type LuaUnaryExpression = {
  type: "Unary";
  operator: string;
  argument: LuaExpression;
} & ASTContext;

export type LuaTableConstructor = {
  type: "TableConstructor";
  fields: LuaTableField[];
} & ASTContext;

export type LuaTableField =
  | LuaDynamicField
  | LuaPropField
  | LuaExpressionField;

export type LuaDynamicField = {
  type: "DynamicField";
  key: LuaExpression;
  value: LuaExpression;
} & ASTContext;

export type LuaPropField = {
  type: "PropField";
  key: string;
  value: LuaExpression;
} & ASTContext;

export type LuaExpressionField = {
  type: "ExpressionField";
  value: LuaExpression;
} & ASTContext;

export type LuaFunctionDefinition = {
  type: "FunctionDefinition";
  body: LuaFunctionBody;
} & ASTContext;

// Query stuff
export type LuaQueryExpression = {
  type: "Query";
  clauses: LuaQueryClause[];
} & ASTContext;

export type LuaQueryClause =
  | LuaFromClause
  | LuaWhereClause
  | LuaLimitClause
  | LuaOrderByClause
  | LuaSelectClause;

export type LuaFromClause = {
  type: "From";
  name: string;
  expression: LuaExpression;
} & ASTContext;

export type LuaWhereClause = {
  type: "Where";
  expression: LuaExpression;
} & ASTContext;

export type LuaLimitClause = {
  type: "Limit";
  limit: LuaExpression;
  offset?: LuaExpression;
} & ASTContext;

export type LuaOrderByClause = {
  type: "OrderBy";
  orderBy: LuaOrderBy[];
} & ASTContext;

export type LuaOrderBy = {
  type: "Order";
  expression: LuaExpression;
  direction: "asc" | "desc";
} & ASTContext;

export type LuaSelectClause = {
  type: "Select";
  tableConstructor: LuaTableConstructor;
} & ASTContext;
