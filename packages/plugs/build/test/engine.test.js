var $hVExJ$jestglobals = require("@jest/globals");
var $hVExJ$handlebars = require("handlebars");
var $hVExJ$yaml = require("yaml");
var $hVExJ$lezerlr = require("@lezer/lr");

function $parcel$interopDefault(a) {
  return a && a.__esModule ? a.default : a;
}

function $255163dfff8c42fb$export$6dd7a1b2f91e0e12(tree) {
    if (!tree.children) return;
    for (let child of tree.children){
        if (child.parent) // Already added parent pointers before
        return;
        child.parent = tree;
        $255163dfff8c42fb$export$6dd7a1b2f91e0e12(child);
    }
}
function $255163dfff8c42fb$export$7bbc263cafa7dd78(tree) {
    delete tree.parent;
    if (!tree.children) return;
    for (let child of tree.children)$255163dfff8c42fb$export$7bbc263cafa7dd78(child);
}
function $255163dfff8c42fb$export$6dcbc6776594ee95(tree, matchFn) {
    let node = tree.parent;
    while(node){
        if (matchFn(node)) return node;
        node = node.parent;
    }
    return null;
}
function $255163dfff8c42fb$export$dddeb721bf64f8df(tree, nodeType) {
    return $255163dfff8c42fb$export$b86407c733c9fe3(tree, (n)=>n.type === nodeType
    );
}
function $255163dfff8c42fb$export$b86407c733c9fe3(tree, matchFn) {
    if (matchFn(tree)) return [
        tree
    ];
    let results = [];
    if (tree.children) for (let child of tree.children)results = [
        ...results,
        ...$255163dfff8c42fb$export$b86407c733c9fe3(child, matchFn)
    ];
    return results;
}
function $255163dfff8c42fb$export$90b8ac453fa63932(tree, substituteFn) {
    if (tree.children) {
        let children = tree.children.slice();
        for (let child of children){
            let subst = substituteFn(child);
            if (subst !== undefined) {
                let pos = tree.children.indexOf(child);
                if (subst) tree.children.splice(pos, 1, subst);
                else // null = delete
                tree.children.splice(pos, 1);
            } else $255163dfff8c42fb$export$90b8ac453fa63932(child, substituteFn);
        }
    }
}
function $255163dfff8c42fb$export$4d49acedd23f9b0a(tree, matchFn) {
    return $255163dfff8c42fb$export$b86407c733c9fe3(tree, matchFn)[0];
}
function $255163dfff8c42fb$export$80a8b4335833eeeb(tree, nodeType) {
    return $255163dfff8c42fb$export$b86407c733c9fe3(tree, (n)=>n.type === nodeType
    )[0];
}
function $255163dfff8c42fb$export$a41716fb83443983(tree, pos) {
    if (pos < tree.from || pos > tree.to) return null;
    if (!tree.children) return tree;
    for (let child of tree.children){
        let n = $255163dfff8c42fb$export$a41716fb83443983(child, pos);
        if (n && n.text !== undefined) // Got a text node, let's return its parent
        return tree;
        else if (n) // Got it
        return n;
    }
    return null;
}
function $255163dfff8c42fb$export$f21c5276b1e9847a(tree) {
    let pieces = [];
    if (tree.text !== undefined) return tree.text;
    for (let child of tree.children)pieces.push($255163dfff8c42fb$export$f21c5276b1e9847a(child));
    return pieces.join("");
}


function $88d466d5aaf7a497$export$87cc1c28aef74af1(text, n, offset = 0) {
    let children = [];
    let nodeText;
    let child = n.firstChild;
    while(child){
        children.push($88d466d5aaf7a497$export$87cc1c28aef74af1(text, child));
        child = child.nextSibling;
    }
    if (children.length === 0) children = [
        {
            from: n.from + offset,
            to: n.to + offset,
            text: text.substring(n.from, n.to)
        }, 
    ];
    else {
        let newChildren = [];
        let index = n.from;
        for (let child of children){
            let s = text.substring(index, child.from);
            if (s) newChildren.push({
                from: index + offset,
                to: child.from + offset,
                text: s
            });
            newChildren.push(child);
            index = child.to;
        }
        let s = text.substring(index, n.to);
        if (s) newChildren.push({
            from: index + offset,
            to: n.to + offset,
            text: s
        });
        children = newChildren;
    }
    let result = {
        type: n.name,
        from: n.from + offset,
        to: n.to + offset
    };
    if (children.length > 0) result.children = children;
    if (nodeText) result.text = nodeText;
    return result;
}
function $88d466d5aaf7a497$export$98e6a39c04603d36(language, text) {
    let tree = $88d466d5aaf7a497$export$87cc1c28aef74af1(text, language.parser.parse(text).topNode);
    // replaceNodesMatching(tree, (n): MarkdownTree | undefined | null => {
    //   if (n.type === "FencedCode") {
    //     let infoN = findNodeMatching(n, (n) => n.type === "CodeInfo");
    //     let language = infoN!.children![0].text;
    //     let textN = findNodeMatching(n, (n) => n.type === "CodeText");
    //     let text = textN!.children![0].text!;
    //
    //     console.log(language, text);
    //     switch (language) {
    //       case "yaml":
    //         let parsed = StreamLanguage.define(yaml).parser.parse(text);
    //         let subTree = treeToAST(text, parsed.topNode, n.from);
    //         // console.log(JSON.stringify(subTree, null, 2));
    //         subTree.type = "yaml";
    //         return subTree;
    //     }
    //   }
    //   return;
    // });
    return tree;
}





const $d85524f23de2149a$export$8f49e4af10703ce3 = $hVExJ$lezerlr.LRParser.deserialize({
    version: 13,
    states: "&fOVQPOOOmQQO'#C^QOQPOOOtQPO'#C`OyQQO'#CkO!OQPO'#CmO!TQPO'#CnO!YQPO'#CoOOQO'#Cp'#CpO!_QQO,58xO!fQQO'#CcO#TQQO'#CaOOQO'#Ca'#CaOOQO,58z,58zO#lQPO,59VOOQO,59X,59XO#qQQO'#D`OOQO,59Y,59YOOQO,59Z,59ZOOQO-E6n-E6nO$YQQO,58}OtQPO,58|O$qQQO1G.qO%]QPO'#CrO%bQQO,59zOOQO'#Cg'#CgOOQO'#Ci'#CiO$YQQO'#CjOOQO'#Cd'#CdOOQO1G.i1G.iOOQO1G.h1G.hOOQO'#Cl'#ClOOQO7+$]7+$]OOQO,59^,59^OOQO-E6p-E6pO%yQPO'#C|O&RQPO,59UO$YQQO'#CqO&WQPO,59hOOQO1G.p1G.pOOQO,59],59]OOQO-E6o-E6o",
    stateData: "&`~OiOS~ORPO~OjRO|SO!QTO!RUO!TVO~OgQX~P[ORYO~O}^O~OX_O~OR`O~OYbO~OgQa~P[OkdOsdOtdOudOvdOwdOxdOydOzdO~O{eOgTXjTX|TX!QTX!RTX!TTX~ORfO~OqgOg!SXj!SX|!SX!Q!SX!R!SX!T!SX~OXlOYlO[lOliOmiOnjOokO~O!OoO!PoOg_ij_i|_i!Q_i!R_i!T_i~ORqO~OqgOg!Saj!Sa|!Sa!Q!Sa!R!Sa!T!Sa~OquOrpX~OrwO~OquOrpa~O",
    goto: "#d!TPP!UP!X!]!`!c!iPP!rP!r!r!X!w!X!X!X!z#Q#WPPPPPPPPP#^PPPPPPPPPPPPPPPPP#aRQOTWPXR]RR[RQZRRneQmdQskRxuVldkuRpfQXPRcXQvsRyvQh`RrhRtkRaU",
    nodeNames: "⚠ Program Query Name WhereClause LogicalExpr AndExpr FilterExpr Value Number String Bool Regex Null List OrderClause Order LimitClause SelectClause RenderClause",
    maxTerm: 51,
    skippedNodes: [
        0
    ],
    repeatNodeCount: 3,
    tokenData: "Ap~R}X^$Opq$Oqr$srs%W|}%r}!O%w!P!Q&Y!Q!['P!^!_'X!_!`'f!`!a's!c!}%w!}#O(Q#P#Q(V#R#S%w#T#U([#U#V*q#V#W%w#W#X+m#X#Y%w#Y#Z-i#Z#]%w#]#^/y#^#`%w#`#a0u#a#b%w#b#c3Y#c#d5U#d#f%w#f#g7i#g#h:e#h#i=a#i#k%w#k#l?]#l#o%w#y#z$O$f$g$O#BY#BZ$O$IS$I_$O$Ip$Iq%W$Iq$Ir%W$I|$JO$O$JT$JU$O$KV$KW$O&FU&FV$O~$TYi~X^$Opq$O#y#z$O$f$g$O#BY#BZ$O$IS$I_$O$I|$JO$O$JT$JU$O$KV$KW$O&FU&FV$O~$vP!_!`$y~%OPu~#r#s%R~%WOy~~%ZUOr%Wrs%ms$Ip%W$Ip$Iq%m$Iq$Ir%m$Ir~%W~%rOY~~%wOq~P%|SRP}!O%w!c!}%w#R#S%w#T#o%w~&_V[~OY&YZ]&Y^!P&Y!P!Q&t!Q#O&Y#O#P&y#P~&Y~&yO[~~&|PO~&Y~'UPX~!Q!['P~'^Pk~!_!`'a~'fOs~~'kPt~#r#s'n~'sOx~~'xPw~!_!`'{~(QOv~~(VOo~~([Or~R(aWRP}!O%w!c!}%w#R#S%w#T#b%w#b#c(y#c#g%w#g#h)u#h#o%wR)OURP}!O%w!c!}%w#R#S%w#T#W%w#W#X)b#X#o%wR)iS{QRP}!O%w!c!}%w#R#S%w#T#o%wR)zURP}!O%w!c!}%w#R#S%w#T#V%w#V#W*^#W#o%wR*eS!PQRP}!O%w!c!}%w#R#S%w#T#o%wR*vURP}!O%w!c!}%w#R#S%w#T#m%w#m#n+Y#n#o%wR+aS}QRP}!O%w!c!}%w#R#S%w#T#o%wR+rURP}!O%w!c!}%w#R#S%w#T#X%w#X#Y,U#Y#o%wR,ZURP}!O%w!c!}%w#R#S%w#T#g%w#g#h,m#h#o%wR,rURP}!O%w!c!}%w#R#S%w#T#V%w#V#W-U#W#o%wR-]S!OQRP}!O%w!c!}%w#R#S%w#T#o%wR-nTRP}!O%w!c!}%w#R#S%w#T#U-}#U#o%wR.SURP}!O%w!c!}%w#R#S%w#T#`%w#`#a.f#a#o%wR.kURP}!O%w!c!}%w#R#S%w#T#g%w#g#h.}#h#o%wR/SURP}!O%w!c!}%w#R#S%w#T#X%w#X#Y/f#Y#o%wR/mSmQRP}!O%w!c!}%w#R#S%w#T#o%wR0OURP}!O%w!c!}%w#R#S%w#T#b%w#b#c0b#c#o%wR0iSzQRP}!O%w!c!}%w#R#S%w#T#o%wR0zURP}!O%w!c!}%w#R#S%w#T#]%w#]#^1^#^#o%wR1cURP}!O%w!c!}%w#R#S%w#T#a%w#a#b1u#b#o%wR1zURP}!O%w!c!}%w#R#S%w#T#]%w#]#^2^#^#o%wR2cURP}!O%w!c!}%w#R#S%w#T#h%w#h#i2u#i#o%wR2|S!QQRP}!O%w!c!}%w#R#S%w#T#o%wR3_URP}!O%w!c!}%w#R#S%w#T#i%w#i#j3q#j#o%wR3vURP}!O%w!c!}%w#R#S%w#T#`%w#`#a4Y#a#o%wR4_URP}!O%w!c!}%w#R#S%w#T#`%w#`#a4q#a#o%wR4xSnQRP}!O%w!c!}%w#R#S%w#T#o%wR5ZURP}!O%w!c!}%w#R#S%w#T#f%w#f#g5m#g#o%wR5rURP}!O%w!c!}%w#R#S%w#T#W%w#W#X6U#X#o%wR6ZURP}!O%w!c!}%w#R#S%w#T#X%w#X#Y6m#Y#o%wR6rURP}!O%w!c!}%w#R#S%w#T#f%w#f#g7U#g#o%wR7]S|QRP}!O%w!c!}%w#R#S%w#T#o%wR7nURP}!O%w!c!}%w#R#S%w#T#X%w#X#Y8Q#Y#o%wR8VURP}!O%w!c!}%w#R#S%w#T#b%w#b#c8i#c#o%wR8nURP}!O%w!c!}%w#R#S%w#T#W%w#W#X9Q#X#o%wR9VURP}!O%w!c!}%w#R#S%w#T#X%w#X#Y9i#Y#o%wR9nURP}!O%w!c!}%w#R#S%w#T#f%w#f#g:Q#g#o%wR:XS!TQRP}!O%w!c!}%w#R#S%w#T#o%wR:jURP}!O%w!c!}%w#R#S%w#T#X%w#X#Y:|#Y#o%wR;RURP}!O%w!c!}%w#R#S%w#T#`%w#`#a;e#a#o%wR;jURP}!O%w!c!}%w#R#S%w#T#X%w#X#Y;|#Y#o%wR<RURP}!O%w!c!}%w#R#S%w#T#V%w#V#W<e#W#o%wR<jURP}!O%w!c!}%w#R#S%w#T#h%w#h#i<|#i#o%wR=TS!RQRP}!O%w!c!}%w#R#S%w#T#o%wR=fURP}!O%w!c!}%w#R#S%w#T#f%w#f#g=x#g#o%wR=}URP}!O%w!c!}%w#R#S%w#T#i%w#i#j>a#j#o%wR>fURP}!O%w!c!}%w#R#S%w#T#X%w#X#Y>x#Y#o%wR?PSlQRP}!O%w!c!}%w#R#S%w#T#o%wR?bURP}!O%w!c!}%w#R#S%w#T#[%w#[#]?t#]#o%wR?yURP}!O%w!c!}%w#R#S%w#T#X%w#X#Y@]#Y#o%wR@bURP}!O%w!c!}%w#R#S%w#T#f%w#f#g@t#g#o%wR@yURP}!O%w!c!}%w#R#S%w#T#X%w#X#YA]#Y#o%wRAdSjQRP}!O%w!c!}%w#R#S%w#T#o%w",
    tokenizers: [
        0,
        1
    ],
    topRules: {
        "Program": [
            0,
            1
        ]
    },
    tokenPrec: 0
});


const $4ba3510c824e3aea$export$c5be9092dbf465c = self.syscall;


async function $2780e5830b4782c9$export$c3455d2d4767a60b(unfiltered = false) {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("space.listPages", unfiltered);
}
async function $2780e5830b4782c9$export$126f79da5c357ad(name) {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("space.readPage", name);
}
async function $2780e5830b4782c9$export$7ed3b3f07f54e00c(name, text) {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("space.writePage", name, text);
}
async function $2780e5830b4782c9$export$2e9858c25869c949(name) {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("space.deletePage", name);
}



function $11a7e2bff790f35a$export$7945ba8eb1c827e6() {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("editor.getCurrentPage");
}
function $11a7e2bff790f35a$export$5e830c5f3cd8a610(newName) {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("editor.setPage", newName);
}
function $11a7e2bff790f35a$export$c72d34660a162238() {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("editor.getText");
}
function $11a7e2bff790f35a$export$da3f040fb23d21f() {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("editor.getCursor");
}
function $11a7e2bff790f35a$export$ca798a7e6e94638c() {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("editor.getSelection");
}
function $11a7e2bff790f35a$export$f6e36f80a8190133(from, to) {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("editor.setSelection", from, to);
}
function $11a7e2bff790f35a$export$a1544dad697b423d() {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("editor.save");
}
function $11a7e2bff790f35a$export$ff7962acd6052c28(name, pos) {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("editor.navigate", name, pos);
}
function $11a7e2bff790f35a$export$da22d4a5076a7905() {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("editor.reloadPage");
}
function $11a7e2bff790f35a$export$a238cfe4a10e6279(url) {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("editor.openUrl", url);
}
function $11a7e2bff790f35a$export$4f02334034b5dd8c(message) {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("editor.flashNotification", message);
}
function $11a7e2bff790f35a$export$83b9d7a71bc0a208(label, options, helpText = "", placeHolder = "") {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("editor.filterBox", label, options, helpText, placeHolder);
}
function $11a7e2bff790f35a$export$53ed0b99a5f8822e(html, script, flex = 1) {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("editor.showRhs", html, script, flex);
}
function $11a7e2bff790f35a$export$f19f28e8a128fabe() {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("editor.hideRhs");
}
function $11a7e2bff790f35a$export$dcf0ace441f4b3a4(html, script, flex = 1) {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("editor.showLhs", html, script, flex);
}
function $11a7e2bff790f35a$export$1be2ad20c6324dcf() {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("editor.hideLhs");
}
function $11a7e2bff790f35a$export$6ebe231c70cc6efb(html, script, flex = 1) {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("editor.showBhs", html, script, flex);
}
function $11a7e2bff790f35a$export$a7a5aa8ba1cd9dc3() {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("editor.hideBhs");
}
function $11a7e2bff790f35a$export$f1124a4ce9f9bf29(text, pos) {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("editor.insertAtPos", text, pos);
}
function $11a7e2bff790f35a$export$54cb80d99fa58e48(from, to, text) {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("editor.replaceRange", from, to, text);
}
function $11a7e2bff790f35a$export$185d1f0722e636b2(pos) {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("editor.moveCursor", pos);
}
function $11a7e2bff790f35a$export$df659347c0c138a9(text) {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("editor.insertAtCursor", text);
}
function $11a7e2bff790f35a$export$c4c1b7dbe675fa50(re) {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("editor.matchBefore", re);
}
function $11a7e2bff790f35a$export$635e15bbd66f01ea(change) {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("editor.dispatch", change);
}
function $11a7e2bff790f35a$export$195ba6d62321b933(message, defaultValue = "") {
    return $4ba3510c824e3aea$export$c5be9092dbf465c("editor.prompt", message, defaultValue);
}


const $c3893eec0c49ec96$var$dateMatchRegex = /(\d{4}\-\d{2}\-\d{2})/g;
function $c3893eec0c49ec96$export$5dc1410f87262ed6(d) {
    return d.toISOString().split("T")[0];
}
async function $c3893eec0c49ec96$export$151bb3c215c78d5a() {
    await $11a7e2bff790f35a$export$df659347c0c138a9($c3893eec0c49ec96$export$5dc1410f87262ed6(new Date()));
}
async function $c3893eec0c49ec96$export$2177dd573df27382() {
    let d = new Date();
    d.setDate(d.getDate() + 1);
    await $11a7e2bff790f35a$export$df659347c0c138a9($c3893eec0c49ec96$export$5dc1410f87262ed6(d));
}


function $9072202279b76d33$export$1e8473eaf75b0d10(query) {
    let n1 = $88d466d5aaf7a497$export$87cc1c28aef74af1(query, $d85524f23de2149a$export$8f49e4af10703ce3.parse(query).topNode);
    // Clean the tree a bit
    $255163dfff8c42fb$export$90b8ac453fa63932(n1, (n)=>{
        if (!n.type) {
            let trimmed = n.text.trim();
            if (!trimmed) return null;
            n.text = trimmed;
        }
    });
    // console.log("Parsed", JSON.stringify(n, null, 2));
    let queryNode = n1.children[0];
    let parsedQuery = {
        table: queryNode.children[0].children[0].text,
        filter: []
    };
    let orderByNode = $255163dfff8c42fb$export$80a8b4335833eeeb(queryNode, "OrderClause");
    if (orderByNode) {
        let nameNode = $255163dfff8c42fb$export$80a8b4335833eeeb(orderByNode, "Name");
        parsedQuery.orderBy = nameNode.children[0].text;
        let orderNode = $255163dfff8c42fb$export$80a8b4335833eeeb(orderByNode, "Order");
        parsedQuery.orderDesc = orderNode ? orderNode.children[0].text === "desc" : false;
    }
    let limitNode = $255163dfff8c42fb$export$80a8b4335833eeeb(queryNode, "LimitClause");
    if (limitNode) {
        let nameNode = $255163dfff8c42fb$export$80a8b4335833eeeb(limitNode, "Number");
        parsedQuery.limit = $9072202279b76d33$var$valueNodeToVal(nameNode);
    }
    let filterNodes = $255163dfff8c42fb$export$dddeb721bf64f8df(queryNode, "FilterExpr");
    for (let filterNode of filterNodes){
        let val = undefined;
        let valNode = filterNode.children[2].children[0];
        val = $9072202279b76d33$var$valueNodeToVal(valNode);
        let f = {
            prop: filterNode.children[0].children[0].text,
            op: filterNode.children[1].text,
            value: val
        };
        parsedQuery.filter.push(f);
    }
    let selectNode = $255163dfff8c42fb$export$80a8b4335833eeeb(queryNode, "SelectClause");
    if (selectNode) {
        // console.log("Select node", JSON.stringify(selectNode));
        parsedQuery.select = [];
        $255163dfff8c42fb$export$dddeb721bf64f8df(selectNode, "Name").forEach((t)=>{
            parsedQuery.select.push(t.children[0].text);
        });
    // let nameNode = findNodeOfType(selectNode, "Number");
    // parsedQuery.limit = +nameNode!.children![0].text!;
    }
    let renderNode = $255163dfff8c42fb$export$80a8b4335833eeeb(queryNode, "RenderClause");
    if (renderNode) {
        let renderNameNode = $255163dfff8c42fb$export$80a8b4335833eeeb(renderNode, "String");
        parsedQuery.render = $9072202279b76d33$var$valueNodeToVal(renderNameNode);
    }
    // console.log(JSON.stringify(queryNode, null, 2));
    return parsedQuery;
}
function $9072202279b76d33$var$valueNodeToVal(valNode) {
    switch(valNode.type){
        case "Number":
            return +valNode.children[0].text;
        case "Bool":
            return valNode.children[0].text === "true";
        case "Null":
            return null;
        case "Name":
            return valNode.children[0].text;
        case "Regex":
            let val = valNode.children[0].text;
            return val.substring(1, val.length - 1);
        case "String":
            let stringVal = valNode.children[0].text;
            return stringVal.substring(1, stringVal.length - 1);
        case "List":
            return $255163dfff8c42fb$export$dddeb721bf64f8df(valNode, "Value").map((t)=>$9072202279b76d33$var$valueNodeToVal(t.children[0])
            );
    }
}
function $9072202279b76d33$export$5884dae03c64f759(parsedQuery, records) {
    let resultRecords = [];
    if (parsedQuery.filter.length === 0) resultRecords = records.slice();
    else recordLoop: for (let record of records){
        const recordAny = record;
        for (let { op: op , prop: prop , value: value  } of parsedQuery.filter)switch(op){
            case "=":
                if (!(recordAny[prop] == value)) continue recordLoop;
                break;
            case "!=":
                if (!(recordAny[prop] != value)) continue recordLoop;
                break;
            case "<":
                if (!(recordAny[prop] < value)) continue recordLoop;
                break;
            case "<=":
                if (!(recordAny[prop] <= value)) continue recordLoop;
                break;
            case ">":
                if (!(recordAny[prop] > value)) continue recordLoop;
                break;
            case ">=":
                if (!(recordAny[prop] >= value)) continue recordLoop;
                break;
            case "=~":
                // TODO: Cache regexps somehow
                if (!new RegExp(value).exec(recordAny[prop])) continue recordLoop;
                break;
            case "!=~":
                if (new RegExp(value).exec(recordAny[prop])) continue recordLoop;
                break;
            case "in":
                if (!value.includes(recordAny[prop])) continue recordLoop;
                break;
        }
        resultRecords.push(recordAny);
    }
    // Now the sorting
    if (parsedQuery.orderBy) resultRecords = resultRecords.sort((a, b)=>{
        const orderBy = parsedQuery.orderBy;
        const orderDesc = parsedQuery.orderDesc;
        if (a[orderBy] === b[orderBy]) return 0;
        if (a[orderBy] < b[orderBy]) return orderDesc ? 1 : -1;
        else return orderDesc ? -1 : 1;
    });
    if (parsedQuery.limit) resultRecords = resultRecords.slice(0, parsedQuery.limit);
    if (parsedQuery.select) resultRecords = resultRecords.map((rec)=>{
        let newRec = {};
        for (let k of parsedQuery.select)newRec[k] = rec[k];
        return newRec;
    });
    return resultRecords;
}
async function $9072202279b76d33$export$b3c659c1456e61b0(parsedQuery, data) {
    if (parsedQuery.render) {
        ($parcel$interopDefault($hVExJ$handlebars)).registerHelper("json", (v)=>JSON.stringify(v)
        );
        ($parcel$interopDefault($hVExJ$handlebars)).registerHelper("niceDate", (ts)=>$c3893eec0c49ec96$export$5dc1410f87262ed6(new Date(ts))
        );
        ($parcel$interopDefault($hVExJ$handlebars)).registerHelper("yaml", (v, prefix)=>{
            if (typeof prefix === "string") {
                let yaml = ($parcel$interopDefault($hVExJ$yaml)).stringify(v).split("\n").join("\n" + prefix).trim();
                if (Array.isArray(v)) return "\n" + prefix + yaml;
                else return yaml;
            } else return ($parcel$interopDefault($hVExJ$yaml)).stringify(v).trim();
        });
        let { text: templateText  } = await $2780e5830b4782c9$export$126f79da5c357ad(parsedQuery.render);
        let template = ($parcel$interopDefault($hVExJ$handlebars)).compile(templateText, {
            noEscape: true
        });
        return template(data);
    }
    return "ERROR";
}


$hVExJ$jestglobals.test("Test parser", ()=>{
    let parsedBasicQuery = $9072202279b76d33$export$1e8473eaf75b0d10(`page`);
    $hVExJ$jestglobals.expect(parsedBasicQuery.table).toBe("page");
    let parsedQuery1 = $9072202279b76d33$export$1e8473eaf75b0d10(`task where completed = false and dueDate <= "{{today}}" order by dueDate desc limit 5`);
    $hVExJ$jestglobals.expect(parsedQuery1.table).toBe("task");
    $hVExJ$jestglobals.expect(parsedQuery1.orderBy).toBe("dueDate");
    $hVExJ$jestglobals.expect(parsedQuery1.orderDesc).toBe(true);
    $hVExJ$jestglobals.expect(parsedQuery1.limit).toBe(5);
    $hVExJ$jestglobals.expect(parsedQuery1.filter.length).toBe(2);
    $hVExJ$jestglobals.expect(parsedQuery1.filter[0]).toStrictEqual({
        op: "=",
        prop: "completed",
        value: false
    });
    $hVExJ$jestglobals.expect(parsedQuery1.filter[1]).toStrictEqual({
        op: "<=",
        prop: "dueDate",
        value: "{{today}}"
    });
    let parsedQuery2 = $9072202279b76d33$export$1e8473eaf75b0d10(`page where name =~ /interview\\/.*/"`);
    $hVExJ$jestglobals.expect(parsedQuery2.table).toBe("page");
    $hVExJ$jestglobals.expect(parsedQuery2.filter.length).toBe(1);
    $hVExJ$jestglobals.expect(parsedQuery2.filter[0]).toStrictEqual({
        op: "=~",
        prop: "name",
        value: "interview\\/.*"
    });
    let parsedQuery3 = $9072202279b76d33$export$1e8473eaf75b0d10(`page where something != null`);
    $hVExJ$jestglobals.expect(parsedQuery3.table).toBe("page");
    $hVExJ$jestglobals.expect(parsedQuery3.filter.length).toBe(1);
    $hVExJ$jestglobals.expect(parsedQuery3.filter[0]).toStrictEqual({
        op: "!=",
        prop: "something",
        value: null
    });
    $hVExJ$jestglobals.expect($9072202279b76d33$export$1e8473eaf75b0d10(`page select name`).select).toStrictEqual([
        "name"
    ]);
    $hVExJ$jestglobals.expect($9072202279b76d33$export$1e8473eaf75b0d10(`page select name, age`).select).toStrictEqual([
        "name",
        "age", 
    ]);
    $hVExJ$jestglobals.expect($9072202279b76d33$export$1e8473eaf75b0d10(`gh-events where type in ["PushEvent", "somethingElse"]`)).toStrictEqual({
        table: "gh-events",
        filter: [
            {
                op: "in",
                prop: "type",
                value: [
                    "PushEvent",
                    "somethingElse"
                ]
            }, 
        ]
    });
    $hVExJ$jestglobals.expect($9072202279b76d33$export$1e8473eaf75b0d10(`something render "template/table"`)).toStrictEqual({
        table: "something",
        filter: [],
        render: "template/table"
    });
});
$hVExJ$jestglobals.test("Test performing the queries", ()=>{
    let data = [
        {
            name: "interview/My Interview",
            lastModified: 1
        },
        {
            name: "interview/My Interview 2",
            lastModified: 2
        },
        {
            name: "Pete",
            age: 38
        },
        {
            name: "Angie",
            age: 28
        }, 
    ];
    $hVExJ$jestglobals.expect($9072202279b76d33$export$5884dae03c64f759($9072202279b76d33$export$1e8473eaf75b0d10(`page where name =~ /interview\\/.*/`), data)).toStrictEqual([
        {
            name: "interview/My Interview",
            lastModified: 1
        },
        {
            name: "interview/My Interview 2",
            lastModified: 2
        }, 
    ]);
    $hVExJ$jestglobals.expect($9072202279b76d33$export$5884dae03c64f759($9072202279b76d33$export$1e8473eaf75b0d10(`page where name =~ /interview\\/.*/ order by lastModified`), data)).toStrictEqual([
        {
            name: "interview/My Interview",
            lastModified: 1
        },
        {
            name: "interview/My Interview 2",
            lastModified: 2
        }, 
    ]);
    $hVExJ$jestglobals.expect($9072202279b76d33$export$5884dae03c64f759($9072202279b76d33$export$1e8473eaf75b0d10(`page where name  =~ /interview\\/.*/ order by lastModified desc`), data)).toStrictEqual([
        {
            name: "interview/My Interview 2",
            lastModified: 2
        },
        {
            name: "interview/My Interview",
            lastModified: 1
        }, 
    ]);
    $hVExJ$jestglobals.expect($9072202279b76d33$export$5884dae03c64f759($9072202279b76d33$export$1e8473eaf75b0d10(`page where age > 30`), data)).toStrictEqual([
        {
            name: "Pete",
            age: 38
        }, 
    ]);
    $hVExJ$jestglobals.expect($9072202279b76d33$export$5884dae03c64f759($9072202279b76d33$export$1e8473eaf75b0d10(`page where age > 28 and age < 38`), data)).toStrictEqual([]);
    $hVExJ$jestglobals.expect($9072202279b76d33$export$5884dae03c64f759($9072202279b76d33$export$1e8473eaf75b0d10(`page where age > 30 select name`), data)).toStrictEqual([
        {
            name: "Pete"
        }
    ]);
    $hVExJ$jestglobals.expect($9072202279b76d33$export$5884dae03c64f759($9072202279b76d33$export$1e8473eaf75b0d10(`page where name in ["Pete"] select name`), data)).toStrictEqual([
        {
            name: "Pete"
        }
    ]);
});


//# sourceMappingURL=engine.test.js.map
