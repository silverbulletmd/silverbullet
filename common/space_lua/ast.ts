export type LuaBlock = {
    type: "Block";
    statements: LuaStatement[];
};

// STATEMENTS
export type LuaReturnStatement = {
    type: "Return";
    expressions: LuaExpression[];
};

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
};

export type LuaLabelStatement = {
    type: "Label";
    name: string;
};

export type LuaBreakStatement = {
    type: "Break";
};

export type LuaGotoStatement = {
    type: "Goto";
    name: string;
};

export type LuaWhileStatement = {
    type: "While";
    condition: LuaExpression;
    block: LuaBlock;
};

export type LuaRepeatStatement = {
    type: "Repeat";
    block: LuaBlock;
    condition: LuaExpression;
};

export type LuaIfStatement = {
    type: "If";
    conditions: { condition: LuaExpression; block: LuaBlock }[];
    elseBlock?: LuaBlock;
};

export type LuaForStatement = {
    type: "For";
    name: string;
    start: LuaExpression;
    end: LuaExpression;
    step?: LuaExpression;
    block: LuaBlock;
};

export type LuaForInStatement = {
    type: "ForIn";
    names: string[];
    expressions: LuaExpression[];
    block: LuaBlock;
};

export type LuaFunctionStatement = {
    type: "Function";
    name: LuaFunctionName;
    body: LuaFunctionBody;
};

export type LuaLocalFunctionStatement = {
    type: "LocalFunction";
    name: string;
    body: LuaFunctionBody;
};

export type LuaFunctionName = {
    type: "FunctionName";
    propNames: string[];
    colonName?: string;
};

export type LuaFunctionBody = {
    type: "FunctionBody";
    parameters: string[];
    block: LuaBlock;
};

export type LuaAssignmentStatement = {
    type: "Assignment";
    variables: LuaLValue[];
    expressions: LuaExpression[];
};

export type LuaLValue =
    | LuaVariable
    | LuaPropertyAccessExpression
    | LuaTableAccessExpression;

export type LuaLocalStatement = {
    type: "Local";
    names: LuaAttName[];
    expressions?: LuaExpression[];
};

export type LuaAttName = {
    type: "AttName";
    name: string;
    attribute?: string;
};

export type LuaFunctionCallStatement = {
    type: "FunctionCallStatement";
    call: LuaFunctionCallExpression;
};

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
};

export type LuaBooleanLiteral = {
    type: "Boolean";
    value: boolean;
};

export type LuaNumberLiteral = {
    type: "Number";
    value: number;
};

export type LuaStringLiteral = {
    type: "String";
    value: string;
};

export type LuaPrefixExpression =
    | LuaVariableExpression
    | LuaParenthesizedExpression
    | LuaFunctionCallExpression;

export type LuaParenthesizedExpression = {
    type: "Parenthesized";
    expression: LuaExpression;
};

export type LuaVariableExpression =
    | LuaVariable
    | LuaPropertyAccessExpression
    | LuaTableAccessExpression;

export type LuaVariable = {
    type: "Variable";
    name: string;
};

export type LuaPropertyAccessExpression = {
    type: "PropertyAccess";
    object: LuaPrefixExpression;
    property: string;
};

export type LuaTableAccessExpression = {
    type: "TableAccess";
    object: LuaPrefixExpression;
    key: LuaExpression;
};

export type LuaFunctionCallExpression = {
    type: "FunctionCall";
    prefix: LuaPrefixExpression;
    name?: string;
    args: LuaExpression[];
};

export type LuaBinaryExpression = {
    type: "Binary";
    operator: string;
    left: LuaExpression;
    right: LuaExpression;
};

export type LuaUnaryExpression = {
    type: "Unary";
    operator: string;
    argument: LuaExpression;
};

export type LuaTableConstructor = {
    type: "TableConstructor";
    fields: LuaTableField[];
};

export type LuaTableField =
    | LuaDynamicField
    | LuaPropField
    | LuaExpressionField;

export type LuaDynamicField = {
    type: "DynamicField";
    key: LuaExpression;
    value: LuaExpression;
};

export type LuaPropField = {
    type: "PropField";
    key: string;
    value: LuaExpression;
};

export type LuaExpressionField = {
    type: "ExpressionField";
    value: LuaExpression;
};

export type LuaFunctionDefinition = {
    type: "FunctionDefinition";
    body: LuaFunctionBody;
};
