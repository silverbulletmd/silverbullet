import { lezerToParseTree } from "$common/markdown_parser/parse_tree.ts";
import {
    cleanTree,
    type ParseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import { parser } from "./parse-lua.js";
import { styleTags } from "@lezer/highlight";
import type {
    LuaAttName,
    LuaBlock,
    LuaExpression,
    LuaFunctionBody,
    LuaFunctionCallExpression,
    LuaFunctionName,
    LuaLValue,
    LuaPrefixExpression,
    LuaStatement,
    LuaTableField,
} from "./ast.ts";

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

function parseChunk(t: ParseTree): LuaBlock {
    if (t.type !== "Chunk") {
        throw new Error(`Expected Chunk, got ${t.type}`);
    }
    return parseBlock(t.children![0]);
}

function parseBlock(t: ParseTree): LuaBlock {
    if (t.type !== "Block") {
        throw new Error(`Expected Block, got ${t.type}`);
    }
    const statements = t.children!.map(parseStatement);
    return { type: "Block", statements, from: t.from, to: t.to };
}

function parseStatement(t: ParseTree): LuaStatement {
    switch (t.type) {
        case "Block":
            return parseChunk(t.children![0]);
        case "Semicolon":
            return { type: "Semicolon", from: t.from, to: t.to };
        case "Label":
            return {
                type: "Label",
                name: t.children![1].children![0].text!,
                from: t.from,
                to: t.to,
            };
        case "Break":
            return { type: "Break", from: t.from, to: t.to };
        case "Goto":
            return {
                type: "Goto",
                name: t.children![1].children![0].text!,
                from: t.from,
                to: t.to,
            };
        case "Scope":
            return parseBlock(t.children![1]);
        case ";":
            return { type: "Semicolon", from: t.from, to: t.to };
        case "WhileStatement":
            return {
                type: "While",
                condition: parseExpression(t.children![1]),
                block: parseBlock(t.children![3]),
            };
        case "RepeatStatement":
            return {
                type: "Repeat",
                block: parseBlock(t.children![1]),
                condition: parseExpression(t.children![3]),
            };
        case "IfStatement": {
            const conditions: {
                condition: LuaExpression;
                block: LuaBlock;
                from?: number;
                to?: number;
            }[] = [];
            let elseBlock: LuaBlock | undefined = undefined;
            for (let i = 0; i < t.children!.length; i += 4) {
                console.log("Looking at", t.children![i]);
                const child = t.children![i];
                if (
                    child.children![0].text === "if" ||
                    child.children![0].text === "elseif"
                ) {
                    conditions.push({
                        condition: parseExpression(t.children![i + 1]),
                        block: parseBlock(t.children![i + 3]),
                        from: child.from,
                        to: child.to,
                    });
                } else if (child.children![0].text === "else") {
                    elseBlock = parseBlock(t.children![i + 1]);
                } else if (child.children![0].text === "end") {
                    break;
                } else {
                    throw new Error(
                        `Unknown if clause type: ${child.children![0].text}`,
                    );
                }
            }
            return {
                type: "If",
                conditions,
                elseBlock,
                from: t.from,
                to: t.to,
            };
        }
        case "ForStatement":
            if (t.children![1].type === "ForNumeric") {
                const forNumeric = t.children![1];
                return {
                    type: "For",
                    name: forNumeric.children![0].children![0].text!,
                    start: parseExpression(forNumeric.children![2]),
                    end: parseExpression(forNumeric.children![4]),
                    step: forNumeric.children![5]
                        ? parseExpression(forNumeric.children![6])
                        : undefined,
                    block: parseBlock(t.children![3]),
                    from: t.from,
                    to: t.to,
                };
            } else {
                const forGeneric = t.children![1];
                return {
                    type: "ForIn",
                    names: parseNameList(forGeneric.children![0]),
                    expressions: parseExpList(forGeneric.children![2]),
                    block: parseBlock(t.children![3]),
                    from: t.from,
                    to: t.to,
                };
            }
        case "Function":
            return {
                type: "Function",
                name: parseFunctionName(t.children![1]),
                body: parseFunctionBody(t.children![2]),
                from: t.from,
                to: t.to,
            };
        case "LocalFunction":
            return {
                type: "LocalFunction",
                name: t.children![2].children![0].text!,
                body: parseFunctionBody(t.children![3]),
            };
        case "FunctionCall":
            return {
                type: "FunctionCallStatement",
                call: parseExpression(
                    {
                        type: "FunctionCall",
                        children: t.children!,
                        from: t.from,
                        to: t.to,
                    },
                ) as LuaFunctionCallExpression,
            };
        case "Assign":
            return {
                type: "Assignment",
                variables: t.children![0].children!.filter((t) =>
                    t.type !== ","
                ).map(
                    parseLValue,
                ),
                expressions: parseExpList(t.children![2]),
                from: t.from,
                to: t.to,
            };
        case "Local":
            return {
                type: "Local",
                names: parseAttNames(t.children![1]),
                expressions: t.children![3] ? parseExpList(t.children![3]) : [],
                from: t.from,
                to: t.to,
            };
        case "ReturnStatement": {
            const expressions = t.children![1]
                ? parseExpList(t.children![1])
                : [];
            return { type: "Return", expressions, from: t.from, to: t.to };
        }
        case "break":
            return { type: "Break", from: t.from, to: t.to };
        default:
            console.error(t);
            throw new Error(`Unknown statement type: ${t.children![0].text}`);
    }
}

function parseAttNames(t: ParseTree): LuaAttName[] {
    if (t.type !== "AttNameList") {
        throw new Error(`Expected AttNameList, got ${t.type}`);
    }
    return t.children!.filter((t) => t.type !== ",").map(parseAttName);
}

function parseAttName(t: ParseTree): LuaAttName {
    if (t.type !== "AttName") {
        throw new Error(`Expected AttName, got ${t.type}`);
    }
    return {
        type: "AttName",
        name: t.children![0].children![0].text!,
        attribute: t.children![1].children![1]
            ? t.children![1].children![1].children![0].text!
            : undefined,
        from: t.from,
        to: t.to,
    };
}

function parseLValue(t: ParseTree): LuaLValue {
    switch (t.type) {
        case "Name":
            return {
                type: "Variable",
                name: t.children![0].text!,
                from: t.from,
                to: t.to,
            };
        case "Property":
            return {
                type: "PropertyAccess",
                object: parsePrefixExpression(t.children![0]),
                property: t.children![2].children![0].text!,
                from: t.from,
                to: t.to,
            };
        case "MemberExpression":
            return {
                type: "TableAccess",
                object: parsePrefixExpression(t.children![0]),
                key: parseExpression(t.children![2]),
                from: t.from,
                to: t.to,
            };
        default:
            console.error(t);
            throw new Error(`Unknown lvalue type: ${t.type}`);
    }
}

function parseFunctionName(t: ParseTree): LuaFunctionName {
    if (t.type !== "FuncName") {
        throw new Error(`Expected FunctionName, got ${t.type}`);
    }
    const propNames: string[] = [];
    let colonName: string | undefined = undefined;
    for (let i = 0; i < t.children!.length; i += 2) {
        const prop = t.children![i];
        propNames.push(prop.children![0].text!);
        if (t.children![i + 1] && t.children![i + 1].type === ":") {
            colonName = t.children![i + 2].children![0].text!;
            break;
        }
    }
    return {
        type: "FunctionName",
        propNames,
        colonName,
        from: t.from,
        to: t.to,
    };
}

function parseNameList(t: ParseTree): string[] {
    if (t.type !== "NameList") {
        throw new Error(`Expected NameList, got ${t.type}`);
    }
    return t.children!.filter((t) => t.type === "Name").map((t) =>
        t.children![0].text!
    );
}

function parseExpList(t: ParseTree): LuaExpression[] {
    if (t.type !== "ExpList") {
        throw new Error(`Expected ExpList, got ${t.type}`);
    }
    return t.children!.filter((t) => t.type !== ",").map(parseExpression);
}

function parseExpression(t: ParseTree): LuaExpression {
    switch (t.type) {
        case "LiteralString": {
            let cleanString = t.children![0].text!;
            // Remove quotes etc
            cleanString = cleanString.slice(1, -1);
            return {
                type: "String",
                value: cleanString,
                from: t.from,
                to: t.to,
            };
        }
        case "Number":
            return {
                type: "Number",
                value: parseFloat(t.children![0].text!),
                from: t.from,
                to: t.to,
            };
        case "BinaryExpression":
            return {
                type: "Binary",
                operator: t.children![1].children![0].text!,
                left: parseExpression(t.children![0]),
                right: parseExpression(t.children![2]),
                from: t.from,
                to: t.to,
            };
        case "UnaryExpression":
            return {
                type: "Unary",
                operator: t.children![0].children![0].text!,
                argument: parseExpression(t.children![1]),
                from: t.from,
                to: t.to,
            };
        case "Property":
            return {
                type: "PropertyAccess",
                object: parsePrefixExpression(t.children![0]),
                property: t.children![2].children![0].text!,
                from: t.from,
                to: t.to,
            };

        case "Parens":
            return parseExpression(t.children![1]);
        case "FunctionCall": {
            if (t.children![1].type === ":") {
                return {
                    type: "FunctionCall",
                    prefix: parsePrefixExpression(t.children![0]),
                    name: t.children![2].children![0].text!,
                    args: parseFunctionArgs(t.children!.slice(3)),
                    from: t.from,
                    to: t.to,
                };
            }
            return {
                type: "FunctionCall",
                prefix: parsePrefixExpression(t.children![0]),
                args: parseFunctionArgs(t.children!.slice(1)),
                from: t.from,
                to: t.to,
            };
        }
        case "FunctionDef": {
            const body = parseFunctionBody(t.children![1]);
            return {
                type: "FunctionDefinition",
                body,
                from: t.from,
                to: t.to,
            };
        }
        case "Name":
            return {
                type: "Variable",
                name: t.children![0].text!,
                from: t.from,
                to: t.to,
            };
        case "Ellipsis":
            return { type: "Variable", name: "...", from: t.from, to: t.to };
        case "true":
            return { type: "Boolean", value: true, from: t.from, to: t.to };
        case "false":
            return { type: "Boolean", value: false, from: t.from, to: t.to };
        case "TableConstructor":
            return {
                type: "TableConstructor",
                fields: t.children!.slice(1, -1).filter((t) =>
                    ["FieldExp", "FieldProp", "FieldDynamic"].includes(t.type!)
                ).map(parseTableField),
                from: t.from,
                to: t.to,
            };
        case "nil":
            return { type: "Nil", from: t.from, to: t.to };
        default:
            console.error(t);
            throw new Error(`Unknown expression type: ${t.type}`);
    }
}

function parseFunctionArgs(ts: ParseTree[]): LuaExpression[] {
    console.log("Parsing function args", JSON.stringify(ts, null, 2));
    return ts.filter((t) => ![",", "(", ")"].includes(t.type!)).map(
        parseExpression,
    );
}

function parseFunctionBody(t: ParseTree): LuaFunctionBody {
    if (t.type !== "FuncBody") {
        throw new Error(`Expected FunctionBody, got ${t.type}`);
    }
    return {
        type: "FunctionBody",
        parameters: t.children![1].children!.filter((t) =>
            ["Name", "Ellipsis"].includes(t.type!)
        )
            .map((t) => t.children![0].text!),
        block: parseBlock(t.children![3]),
        from: t.from,
        to: t.to,
    };
}

function parsePrefixExpression(t: ParseTree): LuaPrefixExpression {
    switch (t.type) {
        case "Name":
            return {
                type: "Variable",
                name: t.children![0].text!,
                from: t.from,
                to: t.to,
            };
        case "Property":
            return {
                type: "PropertyAccess",
                object: parsePrefixExpression(t.children![0]),
                property: t.children![2].children![0].text!,
                from: t.from,
                to: t.to,
            };
        case "MemberExpression":
            return {
                type: "TableAccess",
                object: parsePrefixExpression(t.children![0]),
                key: parseExpression(t.children![2]),
                from: t.from,
                to: t.to,
            };
        case "Parens":
            return {
                type: "Parenthesized",
                expression: parseExpression(t.children![1]),
                from: t.from,
                to: t.to,
            };
        default:
            console.error(t);
            throw new Error(`Unknown prefix expression type: ${t.type}`);
    }
}

function parseTableField(t: ParseTree): LuaTableField {
    switch (t.type) {
        case "FieldExp":
            return {
                type: "ExpressionField",
                value: parseExpression(t.children![0]),
                from: t.from,
                to: t.to,
            };
        case "FieldProp":
            return {
                type: "PropField",
                key: t.children![0].children![0].text!,
                value: parseExpression(t.children![2]),
                from: t.from,
                to: t.to,
            };
        case "FieldDynamic":
            return {
                type: "DynamicField",
                key: parseExpression(t.children![1]),
                value: parseExpression(t.children![4]),
                from: t.from,
                to: t.to,
            };
        default:
            console.error(t);
            throw new Error(`Unknown table field type: ${t.type}`);
    }
}

export function parse(s: string): LuaBlock {
    const t = parseToCrudeAST(s);
    console.log("Clean tree", JSON.stringify(t, null, 2));
    const result = parseChunk(t);
    console.log("Parsed AST", JSON.stringify(result, null, 2));
    return result;
}

export function parseToCrudeAST(t: string): ParseTree {
    return cleanTree(lezerToParseTree(t, parser.parse(t).topNode), true);
}
