// This file was generated by lezer-generator. You probably shouldn't edit it.
import {LRParser} from "@lezer/lr"
const spec_Identifier = {__proto__:null,where:10, null:26, and:38, or:40, limit:48, select:60, render:64}
export const parser = LRParser.deserialize({
  version: 14,
  states: "'UOVQPOOOmQPO'#C^QOQPOOOtQPO'#CuOOQO'#DO'#DOOyQPO,58xO!QQPO'#C`O!lQPO'#CsO!qQPO'#CyO!vQQO'#C{O!{QPO,59aOOQO-E6|-E6|OOQO'#Cf'#CfO#dQPO'#CjOOQO'#Cc'#CcO#xQPO'#CbOOQO'#Ck'#CkO!QQPO'#CmOOQO'#Cb'#CbO%VQPO,58zOOQO,59_,59_O%qQPO'#DeOOQO,59e,59eOOQO,59g,59gOOQO'#Cw'#CwOOQO1G.{1G.{O&YQPO'#DVO&bQPO,59UO&gQPO,59WO!QQPO,59]O&lQPO,59XO!QQPO,59YO!QQPO,59YO&wQPO'#DQO&|QPO,5:PO#dQPO'#DPO'eQPO,59qOOQO1G.p1G.pOOQO1G.r1G.rOOQO1G.w1G.wOOQO1G.s1G.sOOQO1G.t1G.tO'mQPO1G.tOOQO,59l,59lOOQO-E7O-E7OOOQO,59k,59kOOQO-E6}-E6}",
  stateData: "(c~OwOS~ORPO~OTUOhVOjROnWOpXO~OuQX~P[ORYO~OuQa~P[OR`OW^OX^OZ[O[^O]^Ox]O}aO~OWdO~OReO~OqgO~OlhOTiahiajianiapiauia~OW^OX^OZ[O[^O]^Ox]O~OfmO|lO!PmO!QmO!RmO!SmO!TmO!UmO!VmO!WmOTUXcUXdUXhUXjUXnUXpUXuUX!OUX~OcoOdpOTSahSajSanSapSauSa~OzqOT!XXh!XXj!XXn!XXp!XXu!XX~OzsO{yX~O{uO~ORvO~OcoOdpO!OxO~OR{O~OzqOT!Xah!Xaj!Xan!Xap!Xau!Xa~OzsO{ya~OcoOTbidbihbijbinbipbiubi!Obi~OjZflRf~",
  goto: "$Z!YPP!ZP!^P!b!qPP#OPPP#O#X#`#g#gPP#gP!^P!^P#nP!^P!^PP#q#w#}PPPP$TPPPPPPPPPPPPP$WRQOTSPTQcUQnaQwmQyoRzpYbUamopQj]R}s_^U]amopsZ_UamopZ`UamopZbUamopRiYQTPRZTQtjR!OtQreR|rRk]RfW",
  nodeNames: "⚠ Program Query Identifier WhereClause where Expression Value Number String Bool BooleanKW Regex null List LVal Attribute ParenthesizedExpression LogicalExpression and or BinExpression InKW LimitClause limit OrderClause Order OrderDirection OrderKW SelectClause select RenderClause render PageRef",
  maxTerm: 55,
  skippedNodes: [0],
  repeatNodeCount: 3,
  tokenData: "3f~RxX^#opq#oqr$drs$wxy%oyz%t|}%y}!O&O!O!P&a!P!Q&f!Q![(d!^!_(l!_!`(y!`!a)W!c!}&O!}#O)e#P#Q*b#R#S&O#T#U*g#U#W&O#W#X+z#X#Y&O#Y#Z,c#Z#]&O#]#^.s#^#c&O#c#d/o#d#h&O#h#i2f#i#o&O#y#z#o$f$g#o#BY#BZ#o$IS$I_#o$Ip$Iq$w$Iq$Ir$w$I|$JO#o$JT$JU#o$KV$KW#o&FU&FV#o~#tYw~X^#opq#o#y#z#o$f$g#o#BY#BZ#o$IS$I_#o$I|$JO#o$JT$JU#o$KV$KW#o&FU&FV#o~$gP!_!`$j~$oP!S~#r#s$r~$wO!W~~$zWOr$wrs%ds$Ip$w$Ip$Iq%d$Iq$Ir%d$Ir;'S$w;'S;=`%i<%lO$w~%iOX~~%lP;=`<%l$w~%tO}~~%yO!O~~&OOz~~&TSR~}!O&O!c!}&O#R#S&O#T#o&O~&fO|~~&kX[~OY&fZ]&f^!P&f!P!Q'W!Q#O&f#O#P']#P;'S&f;'S;=`(^<%lO&f~']O[~~'`RO;'S&f;'S;=`'i;=`O&f~'nY[~OY&fZ]&f^!P&f!P!Q'W!Q#O&f#O#P']#P;'S&f;'S;=`(^;=`<%l&f<%lO&f~(aP;=`<%l&f~(iPW~!Q![(d~(qP!P~!_!`(t~(yO!Q~~)OP!R~#r#s)R~)WO!V~~)]P!U~!_!`)`~)eO!T~R)jPxP!}#O)mQ)pTO#P)m#P#Q*P#Q;'S)m;'S;=`*[<%lO)mQ*SP#P#Q*VQ*[OqQQ*_P;=`<%l)m~*gO{~~*lUR~}!O&O!c!}&O#R#S&O#T#g&O#g#h+O#h#o&O~+TUR~}!O&O!c!}&O#R#S&O#T#V&O#V#W+g#W#o&O~+nSl~R~}!O&O!c!}&O#R#S&O#T#o&O~,PUR~}!O&O!c!}&O#R#S&O#T#X&O#X#Y*g#Y#o&O~,hTR~}!O&O!c!}&O#R#S&O#T#U,w#U#o&O~,|UR~}!O&O!c!}&O#R#S&O#T#`&O#`#a-`#a#o&O~-eUR~}!O&O!c!}&O#R#S&O#T#g&O#g#h-w#h#o&O~-|UR~}!O&O!c!}&O#R#S&O#T#X&O#X#Y.`#Y#o&O~.gSZ~R~}!O&O!c!}&O#R#S&O#T#o&O~.xUR~}!O&O!c!}&O#R#S&O#T#b&O#b#c/[#c#o&O~/cSf~R~}!O&O!c!}&O#R#S&O#T#o&O~/tUR~}!O&O!c!}&O#R#S&O#T#f&O#f#g0W#g#o&O~0]UR~}!O&O!c!}&O#R#S&O#T#W&O#W#X0o#X#o&O~0tUR~}!O&O!c!}&O#R#S&O#T#X&O#X#Y1W#Y#o&O~1]UR~}!O&O!c!}&O#R#S&O#T#f&O#f#g1o#g#o&O~1tTR~pq2T}!O&O!c!}&O#R#S&O#T#o&O~2WP#U#V2Z~2^P#m#n2a~2fOj~~2kUR~}!O&O!c!}&O#R#S&O#T#f&O#f#g2}#g#o&O~3SUR~}!O&O!c!}&O#R#S&O#T#i&O#i#j-w#j#o&O",
  tokenizers: [0, 1],
  topRules: {"Program":[0,1]},
  specialized: [{term: 3, get: value => spec_Identifier[value] || -1}],
  tokenPrec: 334
})
