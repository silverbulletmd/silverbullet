type ASTPosition = {
  from?: number;
  to?: number;
};

export type LuaBlock = {
  type: "Block";
  statements: LuaStatement[];
} & ASTPosition;

// STATEMENTS
export type LuaReturnStatement = {
  type: "Return";
  expressions: LuaExpression[];
} & ASTPosition;

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
} & ASTPosition;

export type LuaLabelStatement = {
  type: "Label";
  name: string;
} & ASTPosition;

export type LuaBreakStatement = {
  type: "Break";
} & ASTPosition;

export type LuaGotoStatement = {
  type: "Goto";
  name: string;
} & ASTPosition;

export type LuaWhileStatement = {
  type: "While";
  condition: LuaExpression;
  block: LuaBlock;
} & ASTPosition;

export type LuaRepeatStatement = {
  type: "Repeat";
  block: LuaBlock;
  condition: LuaExpression;
} & ASTPosition;

export type LuaIfStatement = {
  type: "If";
  conditions: { condition: LuaExpression; block: LuaBlock }[];
  elseBlock?: LuaBlock;
} & ASTPosition;

export type LuaForStatement = {
  type: "For";
  name: string;
  start: LuaExpression;
  end: LuaExpression;
  step?: LuaExpression;
  block: LuaBlock;
} & ASTPosition;

export type LuaForInStatement = {
  type: "ForIn";
  names: string[];
  expressions: LuaExpression[];
  block: LuaBlock;
} & ASTPosition;

export type LuaFunctionStatement = {
  type: "Function";
  name: LuaFunctionName;
  body: LuaFunctionBody;
} & ASTPosition;

export type LuaLocalFunctionStatement = {
  type: "LocalFunction";
  name: string;
  body: LuaFunctionBody;
} & ASTPosition;

export type LuaFunctionName = {
  type: "FunctionName";
  propNames: string[];
  colonName?: string;
} & ASTPosition;

export type LuaFunctionBody = {
  type: "FunctionBody";
  parameters: string[];
  block: LuaBlock;
} & ASTPosition;

export type LuaAssignmentStatement = {
  type: "Assignment";
  variables: LuaLValue[];
  expressions: LuaExpression[];
} & ASTPosition;

export type LuaLValue =
  | LuaVariable
  | LuaPropertyAccessExpression
  | LuaTableAccessExpression;

export type LuaLocalStatement = {
  type: "Local";
  names: LuaAttName[];
  expressions?: LuaExpression[];
} & ASTPosition;

export type LuaAttName = {
  type: "AttName";
  name: string;
  attribute?: string;
} & ASTPosition;

export type LuaFunctionCallStatement = {
  type: "FunctionCallStatement";
  call: LuaFunctionCallExpression;
} & ASTPosition;

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
  | LuaFunctionDefinition;

export type LuaNilLiteral = {
  type: "Nil";
} & ASTPosition;

export type LuaBooleanLiteral = {
  type: "Boolean";
  value: boolean;
} & ASTPosition;

export type LuaNumberLiteral = {
  type: "Number";
  value: number;
} & ASTPosition;

export type LuaStringLiteral = {
  type: "String";
  value: string;
} & ASTPosition;

export type LuaPrefixExpression =
  | LuaVariableExpression
  | LuaParenthesizedExpression
  | LuaFunctionCallExpression;

export type LuaParenthesizedExpression = {
  type: "Parenthesized";
  expression: LuaExpression;
} & ASTPosition;

export type LuaVariableExpression =
  | LuaVariable
  | LuaPropertyAccessExpression
  | LuaTableAccessExpression;

export type LuaVariable = {
  type: "Variable";
  name: string;
} & ASTPosition;

export type LuaPropertyAccessExpression = {
  type: "PropertyAccess";
  object: LuaPrefixExpression;
  property: string;
} & ASTPosition;

export type LuaTableAccessExpression = {
  type: "TableAccess";
  object: LuaPrefixExpression;
  key: LuaExpression;
} & ASTPosition;

export type LuaFunctionCallExpression = {
  type: "FunctionCall";
  prefix: LuaPrefixExpression;
  name?: string;
  args: LuaExpression[];
} & ASTPosition;

export type LuaBinaryExpression = {
  type: "Binary";
  operator: string;
  left: LuaExpression;
  right: LuaExpression;
} & ASTPosition;

export type LuaUnaryExpression = {
  type: "Unary";
  operator: string;
  argument: LuaExpression;
} & ASTPosition;

export type LuaTableConstructor = {
  type: "TableConstructor";
  fields: LuaTableField[];
} & ASTPosition;

export type LuaTableField =
  | LuaDynamicField
  | LuaPropField
  | LuaExpressionField;

export type LuaDynamicField = {
  type: "DynamicField";
  key: LuaExpression;
  value: LuaExpression;
} & ASTPosition;

export type LuaPropField = {
  type: "PropField";
  key: string;
  value: LuaExpression;
} & ASTPosition;

export type LuaExpressionField = {
  type: "ExpressionField";
  value: LuaExpression;
} & ASTPosition;

export type LuaFunctionDefinition = {
  type: "FunctionDefinition";
  body: LuaFunctionBody;
} & ASTPosition;
