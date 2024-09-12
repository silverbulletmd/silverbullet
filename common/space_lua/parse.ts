import { lezerToParseTree } from "$common/markdown_parser/parse_tree.ts";
import {
    type AST as CrudeAST,
    parseTreeToAST,
} from "@silverbulletmd/silverbullet/lib/tree";
import { parser } from "./parse-lua.js";
import { styleTags } from "@lezer/highlight";

const luaStyleTags = styleTags({
    // Identifier: t.variableName,
    // TagIdentifier: t.variableName,
    // GlobalIdentifier: t.variableName,
    // String: t.string,
    // Number: t.number,
    // PageRef: ct.WikiLinkTag,
    // BinExpression: t.operator,
    // TernaryExpression: t.operator,
    // Regex: t.regexp,
    // "where limit select render Order OrderKW and or null as InKW NotKW BooleanKW each all":
    //     t.keyword,
});

export const highlightingQueryParser = parser.configure({
    props: [
        luaStyleTags,
    ],
});

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
    propNames?: string[];
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

function parseChunk(n: CrudeAST): LuaBlock {
    const t = n as [string, ...CrudeAST[]];
    if (t[0] !== "Chunk") {
        throw new Error(`Expected Chunk, got ${t[0]}`);
    }
    return parseBlock(t[1]);
}

function parseBlock(n: CrudeAST): LuaBlock {
    const t = n as [string, ...CrudeAST[]];
    if (t[0] !== "Block") {
        throw new Error(`Expected Block, got ${t[0]}`);
    }
    const statements = t.slice(1).map(parseStatement);
    return { type: "Block", statements };
}

function parseStatement(n: CrudeAST): LuaStatement {
    const t = n as [string, ...CrudeAST[]];
    switch (t[0]) {
        case "Block":
            return parseChunk(t[1]);
        case "Semicolon":
            return { type: "Semicolon" };
        case "Label":
            return { type: "Label", name: t[2][1] as string };
        case "Break":
            return { type: "Break" };
        case "Goto":
            return { type: "Goto", name: t[2][1] as string };
        case "Scope":
            return parseBlock(t[2]);
        case ";":
            return { type: "Semicolon" };
        case "WhileStatement":
            return {
                type: "While",
                condition: parseExpression(t[2]),
                block: parseBlock(t[4]),
            };
        case "RepeatStatement":
            return {
                type: "Repeat",
                block: parseBlock(t[2]),
                condition: parseExpression(t[4]),
            };
        case "IfStatement": {
            const conditions: { condition: LuaExpression; block: LuaBlock }[] =
                [];
            let elseBlock: LuaBlock | undefined = undefined;
            for (let i = 1; i < t.length; i += 4) {
                console.log("Looking at", t[i]);
                if (t[i][0] === "if" || t[i][0] === "elseif") {
                    conditions.push({
                        condition: parseExpression(t[i + 1]),
                        block: parseBlock(t[i + 3]),
                    });
                } else if (t[i][0] === "else") {
                    elseBlock = parseBlock(t[i + 1]);
                } else if (t[i][0] === "end") {
                    break;
                } else {
                    throw new Error(`Unknown if clause type: ${t[i][0]}`);
                }
            }
            return {
                type: "If",
                conditions,
                elseBlock,
            };
        }
        case "ForStatement":
            if (t[2][0] === "ForNumeric") {
                const forNumeric = t[2] as [string, ...CrudeAST[]];
                return {
                    type: "For",
                    name: forNumeric[1][1] as string,
                    start: parseExpression(forNumeric[3]),
                    end: parseExpression(forNumeric[5]),
                    step: forNumeric[6]
                        ? parseExpression(forNumeric[7])
                        : undefined,
                    block: parseBlock(t[4]),
                };
            } else {
                const forGeneric = t[2] as [string, ...CrudeAST[]];
                return {
                    type: "ForIn",
                    names: parseNameList(forGeneric[1]),
                    expressions: parseExpList(forGeneric[3]),
                    block: parseBlock(t[4]),
                };
            }
        case "Function":
            return {
                type: "Function",
                name: parseFunctionName(t[2]),
                body: parseFunctionBody(t[3]),
            };
        case "LocalFunction":
            return {
                type: "LocalFunction",
                name: t[3][1] as string,
                body: parseFunctionBody(t[4]),
            };
        case "FunctionCall":
            return {
                type: "FunctionCallStatement",
                call: parseExpression([
                    "FunctionCall",
                    ...t.slice(1),
                ]) as LuaFunctionCallExpression,
            };
        case "Assign":
            return {
                type: "Assignment",
                variables: (t[1].slice(1) as CrudeAST[]).filter((t) =>
                    t[0] != ","
                ).map(parseLValue),
                expressions: parseExpList(t[3]),
            };
        case "Local":
            return {
                type: "Local",
                names: parseAttNames(t[2]),
                expressions: t[4] ? parseExpList(t[4]) : [],
            };
        default:
            console.error(t);
            throw new Error(`Unknown statement type: ${t[0]}`);
    }
}

function parseAttNames(n: CrudeAST): LuaAttName[] {
    const t = n as [string, ...CrudeAST[]];
    if (t[0] !== "AttNameList") {
        throw new Error(`Expected AttNameList, got ${t[0]}`);
    }
    return t.slice(1).filter((t) => t[0] !== ",").map(parseAttName);
}

function parseAttName(n: CrudeAST): LuaAttName {
    const t = n as [string, ...CrudeAST[]];
    if (t[0] !== "AttName") {
        throw new Error(`Expected AttName, got ${t[0]}`);
    }
    return {
        type: "AttName",
        name: t[1][1] as string,
        attribute: t[2][2] ? t[2][2][1] as string : undefined,
    };
}

function parseLValue(n: CrudeAST): LuaLValue {
    const t = n as [string, ...CrudeAST[]];
    switch (t[0]) {
        case "Name":
            return { type: "Variable", name: t[1] as string };
        case "Property":
            return {
                type: "PropertyAccess",
                object: parsePrefixExpression(t[1]),
                property: t[3][1] as string,
            };
        case "MemberExpression":
            return {
                type: "TableAccess",
                object: parsePrefixExpression(t[1]),
                key: parseExpression(t[3]),
            };
        default:
            console.error(t);
            throw new Error(`Unknown lvalue type: ${t[0]}`);
    }
}

function parseFunctionName(n: CrudeAST): LuaFunctionName {
    const t = n as [string, ...CrudeAST[]];
    if (t[0] !== "FuncName") {
        throw new Error(`Expected FunctionName, got ${t[0]}`);
    }
    const propNames: string[] = [];
    let colonName: string | undefined = undefined;
    for (let i = 1; i < t.length; i += 2) {
        propNames.push(t[i][1] as string);
        if (t[i + 1] && t[i + 1][0] === ":") {
            colonName = t[i + 2][1] as string;
            break;
        }
    }
    return { type: "FunctionName", propNames, colonName };
}

function parseNameList(n: CrudeAST): string[] {
    const t = n as [string, ...CrudeAST[]];
    if (t[0] !== "NameList") {
        throw new Error(`Expected NameList, got ${t[0]}`);
    }
    return t.slice(1).filter((t) => t[0] === "Name").map((t) => t[1] as string);
}

function parseExpList(n: CrudeAST): LuaExpression[] {
    const t = n as [string, ...CrudeAST[]];
    if (t[0] !== "ExpList") {
        throw new Error(`Expected ExpList, got ${t[0]}`);
    }
    return t.slice(1).filter((t) => t[0] !== ",").map(parseExpression);
}

function parseExpression(n: CrudeAST): LuaExpression {
    const t = n as [string, ...CrudeAST[]];
    switch (t[0]) {
        case "LiteralString": {
            let cleanString = t[1] as string;
            // Remove quotes etc
            cleanString = cleanString.slice(1, -1);
            return { type: "String", value: cleanString };
        }
        case "Number":
            return { type: "Number", value: parseFloat(t[1] as string) };
        case "BinaryExpression":
            return {
                type: "Binary",
                operator: t[2][1] as string,
                left: parseExpression(t[1]),
                right: parseExpression(t[3]),
            };
        case "UnaryExpression":
            return {
                type: "Unary",
                operator: t[1][1] as string,
                argument: parseExpression(t[2]),
            };
        case "Property":
            return {
                type: "PropertyAccess",
                object: parsePrefixExpression(t[1]),
                property: t[3][1] as string,
            };

        case "Parens":
            return parseExpression(t[2]);
        case "FunctionCall": {
            if (t[2][0] === ":") {
                return {
                    type: "FunctionCall",
                    prefix: parsePrefixExpression(t[1]),
                    name: t[3][1] as string,
                    args: parseFunctionArgs(t.slice(4)),
                };
            }
            return {
                type: "FunctionCall",
                prefix: parsePrefixExpression(t[1]),
                args: parseFunctionArgs(t.slice(2)),
            };
        }
        case "FunctionDef": {
            const body = parseFunctionBody(t[2]);
            return {
                type: "FunctionDefinition",
                body,
            };
        }
        case "Name":
            return { type: "Variable", name: t[1] as string };
        case "Ellipsis":
            return { type: "Variable", name: "..." };
        case "true":
            return { type: "Boolean", value: true };
        case "false":
            return { type: "Boolean", value: false };
        case "TableConstructor":
            return {
                type: "TableConstructor",
                fields: t.slice(2, -1).filter((t) =>
                    !(typeof t === "string" ||
                        ["{", "}"].includes(t[1] as string))
                ).map(parseTableField),
            };
        case "nil":
            return { type: "Nil" };
        default:
            console.error(t);
            throw new Error(`Unknown expression type: ${t[0]}`);
    }
}

function parseFunctionArgs(n: CrudeAST[]): LuaExpression[] {
    console.log("Parsing function args", n);
    return n.filter((t) => ![",", "(", ")"].includes(t[0])).map(
        parseExpression,
    );
}

function parseFunctionBody(n: CrudeAST): LuaFunctionBody {
    const t = n as [string, ...CrudeAST[]];
    if (t[0] !== "FuncBody") {
        throw new Error(`Expected FunctionBody, got ${t[0]}`);
    }
    return {
        type: "FunctionBody",
        parameters: (t[2] as CrudeAST[]).slice(1).filter((t) =>
            ["Name", "Ellipsis"].includes(t[0])
        )
            .map((t) => t[1] as string),
        block: parseBlock(t[4]),
    };
}

function parsePrefixExpression(n: CrudeAST): LuaPrefixExpression {
    const t = n as [string, ...CrudeAST[]];
    switch (t[0]) {
        case "Name":
            return { type: "Variable", name: t[1] as string };
        case "Property":
            return {
                type: "PropertyAccess",
                object: parsePrefixExpression(t[1]),
                property: t[3][1] as string,
            };
        case "Parens":
            return { type: "Parenthesized", expression: parseExpression(t[2]) };
        default:
            console.error(t);
            throw new Error(`Unknown prefix expression type: ${t[0]}`);
    }
}

function parseTableField(n: CrudeAST): LuaTableField {
    const t = n as [string, ...CrudeAST[]];
    switch (t[0]) {
        case "FieldExp":
            return {
                type: "ExpressionField",
                value: parseExpression(t[1]),
            };
        case "FieldProp":
            return {
                type: "PropField",
                key: t[1][1] as string,
                value: parseExpression(t[3]),
            };
        case "FieldDynamic":
            return {
                type: "DynamicField",
                key: parseExpression(t[2]),
                value: parseExpression(t[5]),
            };
        default:
            console.error(t);
            throw new Error(`Unknown table field type: ${t[0]}`);
    }
}

export function parse(t: string): LuaBlock {
    const crudeAst = parseToCrudeAST(t);
    console.log("Crude AST", JSON.stringify(crudeAst, null, 2));
    const result = parseChunk(crudeAst);
    console.log("Parsed AST", JSON.stringify(result, null, 2));
    return result;
}

export function parseToCrudeAST(t: string): CrudeAST {
    return parseTreeToAST(lezerToParseTree(t, parser.parse(t).topNode), true);
}
