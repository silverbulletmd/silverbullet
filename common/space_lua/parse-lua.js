// This file was generated by lezer-generator. You probably shouldn't edit it.
import {LRParser} from "@lezer/lr"
const spec_identifier = {__proto__:null,break:16, goto:20, do:24, end:26, while:30, nil:32, true:34, false:36, or:80, and:82, not:104, function:114, query:122, from:129, where:133, order:137, by:139, desc:143, select:147, limit:151, repeat:154, until:156, if:160, then:162, elseif:164, else:166, for:170, in:178, local:188, return:204}
export const parser = LRParser.deserialize({
  version: 14,
  states: "EUO!ZQPOOOOQO'#Cc'#CcO!UQPO'#CaO!bQPOOOOQO'#E{'#E{O!vQQO'#CwO$`QPO'#EzOOQO'#Ez'#EzO$jQPO'#EzOOQO'#E`'#E`O%yQPO'#E_OOQO'#Ev'#EvOOQO'#Eg'#EgO&OQPO'#C_OOQO'#C_'#C_QOQPOOO!UQPO'#CeO&cQPO'#CgO!vQQO'#CjO&jQPO'#DzO!vQQO'#D}O!UQPO'#ESO!UQPO'#EZO&qQPO'#EaO&yQQO'#EeO'aQPO,58{OOQO'#Cq'#CqO!UQPO,59^O!vQQO,59`O(mQQO'#C|O(tQQO'#FQOOQO'#E|'#E|OOQO,59f,59fO!UQPO,59fO({QPO'#ExO,kQPO,59cOOQO'#Dc'#DcOOQO'#Dd'#DdOOQO'#De'#DeO!vQQO'#DaOOQO'#Ex'#ExO,rQPO'#DfO,wQSO'#DjO,|QPO'#EpO-UQPO,5<QO!vQQO,5:yOOQO-E8e-E8eOOQO,58y,58yOOQO,59P,59PO-^QPO,59RO-cQPO,59UO-jQPO,5:fO-oQPO,5:iO-vQPO'#FeOOQO'#EW'#EWO.RQPO'#EVO.WQPO,5:nO.]QPO'#E[O,rQPO,5:uO.hQQO'#EcO0OQPO'#FgOOQO'#Eb'#EbO!UQPO,5:wO1cQPO,5:{O2sQPO'#FROOQO'#EY'#EYOOQO,5;P,5;PO4YQPO,5;POOQO1G.g1G.gOOQO1G.x1G.xO4nQPO1G.zO4uQWO'#ExO7{QWO'#E{O!vQQO'#DOO9^QSO'#DQOOQO'#E}'#E}OOQO,59h,59hO9hQSO,59hOOQO,5;l,5;lO9pQPO,5;lO9uQPO1G/QOOQO1G.}1G.}OOQO'#DX'#DXOOQO'#DY'#DYOOQO'#DZ'#DZOOQO'#D['#D[OOQO'#D^'#D^OOQO'#D_'#D_OOQO'#D`'#D`O!vQQO,59oO!vQQO,59oO!vQQO,59oO!vQQO,59oO!vQQO,59oO!vQQO,59oO!vQQO,59oO!vQQO,59oO!vQQO,59oO;XQPO,59{O<qQQO'#DhOOQO,5:Q,5:QO=bQQO,5:UO=iQPO,5;[OOQO-E8n-E8nOOQO1G0e1G0eOOQO1G.m1G.mO&cQPO1G.pO!vQQO1G0QO=sQPO1G0TO!vQQO,5:pO!UQPO'#EnO>QQPO,5<PO!vQQO,5:qO&cQPO1G0YO!UQPO'#EoO>YQPO,5:vO!UQPO,5:vOOQO1G0a1G0aO!UQPO'#EdOOQO,5:},5:}O!UQPO'#EqO>eQPO,5<RO,rQPO1G0cO!vQQO1G0gO!vQQO'#EiO?xQPO,5;mOOQO1G0k1G0kOOQO7+$f7+$fOA]QQO,59kOBaQPO,59jOBhQQO1G/SOBoQSO1G/SOOQO1G/S1G/SOD_QSO,59{OOQO1G1W1G1WOOQO7+$l7+$lOGRQPO1G/ZOGYQPO1G/ZOIyQPO1G/ZOJQQPO1G/ZOLkQPO1G/ZOLxQPO1G/ZONyQPO1G/ZO!$`QPO1G/ZO!$gQPO1G/ZO!$nQPO'#EzO!$xQPO'#FaOOQO'#Di'#DiO!%QQPO,5:SOOQO'#Dl'#DlOOQO'#Ek'#EkO!%VQQO1G/pOA]QQO'#DmOA]QQO'#DoO!%^QPO'#DqOA]QQO'#DvO!%cQQO'#DxOOQO1G/p1G/pO!&gQPO7+$[O!&lQPO7+%lO!'{QPO7+%oO!(WQPO1G0[OOQO,5;Y,5;YOOQO-E8l-E8lOOQO1G0]1G0]O!(_QPO7+%tOOQO,5;Z,5;ZOOQO-E8m-E8mO!UQPO1G0bOOQO1G0b1G0bO!(dQQO,5;OOOQO,5;],5;]OOQO-E8o-E8oOOQO7+%}7+%}OOQO7+&R7+&RO!(iQPO,5;TOOQO-E8g-E8gO!*OQSO1G/VO!*YQPO1G/UO!+xQSO1G/ZO!,PQSO1G/ZO!-qQSO1G/ZO!-xQSO1G/ZO!/dQSO1G/ZO!/qQSO1G/ZO!1fQSO1G/ZO!3ZQSO1G/ZO!3bQSO1G/ZOOQO,5;S,5;SOOQO7+$n7+$nO!3iQQO7+$nOOQO-E8f-E8fO!3pQQO'#EjO!3{QPO,5;{O&cQPO1G/nOOQO-E8i-E8iOOQO7+%[7+%[O!4TQWO,5:XO!4nQSO,5:XO!5UQSO,5:ZO!%cQQO,5:]O!5lQSO,5:bO!6SQ`O'#ExO!8vQ`O,5:dOOQO<<Gv<<GvO!9aQPO<<IZO!vQQO'#EmOOQO<<IZ<<IZO&cQPO<<IZO!vQQO7+%vOOQO<<I`<<I`OOQO7+%|7+%|OOQO1G0j1G0jOA]QQO7+$pOOQO<<HY<<HYP'fQQO'#EhO!9lQPO,5;UOOQO,5;U,5;UOOQO-E8h-E8hO!9vQPO7+%YOA]QQO1G/sO!9{Q`O'#DtO!:iQQO'#FcOOQO1G/w1G/wOA]QQO1G0OO!;QQ`O,59{OOQO-E8k-E8kOOQOAN>uAN>uO&cQPOAN>uO!;[QPO,5;XO!;cQPOAN>uO!;hQPO<<IbO!;rQSO<<H[OOQO<<Ht<<HtO!;|QSO7+%_OOQO,5:`,5:`O!%cQQO'#ElO!<dQQO,5;}O!>fQ`O1G/ZO!>mQ`O1G/ZO!@_Q`O1G/ZO!@fQ`O1G/ZO!BQQ`O1G/ZO!B_Q`O1G/ZO!BlQ`O1G/ZO!DaQ`O1G/ZO!DhQ`O1G/ZO!DoQSO7+%jO!EVQPOG24aO=sQPO1G0sOOQOG24aG24aO!vQQOAN>|OOQO,5;W,5;WOOQO-E8j-E8jOOQOLD){LD){OOQO7+&_7+&_O!E[QPOG24hOA]QQO'#DaO!%cQQO'#DaOA]QQO,59oO!%cQQO,59oOA]QQO,59oO!%cQQO,59oOA]QQO,59oO!%cQQO,59oOA]QQO,59oO!%cQQO,59oOA]QQO,59oO!%cQQO,59oOA]QQO,59oO!%cQQO,59oOA]QQO,59oO!%cQQO,59oOA]QQO,59oO!%cQQO,59oOA]QQO,59oO!%cQQO,59o",
  stateData: "!Ef~O#hOS#iOSPOS~OSZOUQOWZOY`O[aO_bOlTO!ZfO!ocO!rdO!weO#QgO#YhO#kPO~O#fRP~P]OgkOilOlnOoqOqmO#mjO~O`xOaxObxOcxOdxOlTOqmO!UwO!ZyO!_zO#kPO#mjO#xuO#{tO#|tO$SvO~Og#nXi#nXl#nXo#nXq#nX#m#nX~Ov{O#r$YX~P#zOS#jXU#jXW#jXY#jX[#jX_#jXl#jX!Z#jX!o#jX!r#jX!w#jX#Q#jX#Y#jX#f#jX#k#jX]#jX!p#jX!t#jX!u#jX~P#zO#r}O~O#fRX]RX!pRX!tRX!uRX~P]O]RP~P]O!pRP~P]O!Z!`O#kPO~OS!dO#f#XX]#XX!p#XX!t#XX!u#XX~P!vOU!fO~O`xOaxObxOcxOdxOi!kOlTOqmO!U&kO!ZyO!_zO#kPO#mjO#xuO#{tO#|tO$SvO~Ou!nO~P'fOm!pO~P!vOm#lXx#lXy#lXz#lX!P#lX#v#lX#w#lX#x#lX#y#lX#z#lX#{#lX#|#lX#}#lX$O#lX$P#lX$Q#lX$R#lX[#lX!s#lXS#lXv#lX#f#lXj#lXU#lXW#lXY#lX_#lX!Z#lX!o#lX!r#lX!w#lX#Q#lX#Y#lX#k#lX]#lX!p#lX!t#lX!u#lX~P!bOx#SOy#TOz!{O!P#PO#v!tO#w!uO#x!vO#y!wO#z!wO#{!xO#|!xO#}!yO$O!yO$P!yO$Q!yO$R!zO~Om!sO~P+gOl#VO~O$U#XO~OlTO#kPO~Ov{O#r$Ya~O]#]O~O[#^O~P+gO!p#_O~O!s#`O~P+gOv#bO#r#aO!{$XX~O!{#dO~O[#eO~Og#fOo#hOl#OX~O$[#jOS#WPU#WPW#WPY#WP[#WP_#WPl#WPv#WP!Z#WP!o#WP!r#WP!w#WP#Q#WP#Y#WP#f#WP#k#WP#r#WP]#WP!p#WP!t#WP!u#WP~Ov#lOS$ZXU$ZXW$ZXY$ZX[$ZX_$ZXl$ZX!Z$ZX!o$ZX!r$ZX!w$ZX#Q$ZX#Y$ZX#f$ZX#k$ZX#r$ZX]$ZX!p$ZX!t$ZX!u$ZX~O#r#oOS#TaU#TaW#TaY#Ta[#Ta_#Tal#Ta!Z#Ta!o#Ta!r#Ta!w#Ta#Q#Ta#Y#Ta#f#Ta#k#Ta]#Ta!p#Ta!t#Ta!u#Ta~Ov#pOS#uX#f#uXm#uXU#uXW#uXY#uX[#uX_#uXl#uX!Z#uX!o#uX!r#uX!w#uX#Q#uX#Y#uX#k#uX]#uX!p#uX!t#uX!u#uX~P+gOS#rO#f#Xa]#Xa!p#Xa!t#Xa!u#Xa~Oj#sO~P+gOu#lXx#lXy#lXz#lX!P#lX#s#lX#v#lX#w#lX#x#lX#y#lX#z#lX#{#lX#|#lX#}#lX$O#lX$P#lX$Q#lX$R#lX!b#lX!d#lX!f#lX!k#lX!m#lX$W#lX~P!bOg#oXi#oXl#oXo#oXq#oXx#oXy#oXz#oX!P#oX#m#oX#v#oX#w#oX#x#oX#y#oX#z#oX#{#oX#|#oX#}#oX$O#oX$P#oX$Q#oX$R#oX~O#r#tOu#oX#s#oX~P6eOx&{Oy&}Oz&mO!P&uO#v!tO#w!uO#x!vO#y!wO#z!wO#{!xO#|!xO#}!yO$O!yO$P!yO$Q!yO$R!zO~OutX#stX~P8YOu#xO#s#vO~Om#zO~OlnOqmO#mjO~O$R!zOx!Tay!Taz!Ta!P!Ta#v!Ta#w!Ta#x!Ta#y!Ta#z!Ta#{!Ta#|!Ta#}!Ta$O!Ta$P!Ta$Q!Tav!Ta~Om!Ta[!Ta!s!TaS!Ta#f!Taj!TaU!TaW!TaY!Ta_!Tal!Ta!Z!Ta!o!Ta!r!Ta!w!Ta#Q!Ta#Y!Ta#k!Ta]!Ta!p!Ta!t!Ta!u!Ta~P:QOc$WOlTO#kPOm!]P~O!b$^O!d$_O!f$`O!k$aO!m$bO~O$W$cO~P=POv#da#r#da~P#zO]RP!tRP!uRP~P]Ov#bO!{$Xa~Og#fOo$nOl#Oa~Ov#lOS$ZaU$ZaW$ZaY$Za[$Za_$Zal$Za!Z$Za!o$Za!r$Za!w$Za#Q$Za#Y$Za#f$Za#k$Za#r$Za]$Za!p$Za!t$Za!u$Za~Ov#pOS#ua#f#uam#uaU#uaW#uaY#ua[#ua_#ual#ua!Z#ua!o#ua!r#ua!w#ua#Q#ua#Y#ua#k#ua]#ua!p#ua!t#ua!u#ua~O`xOaxObxOcxOdxOlTOqmO!U&kO!ZyO!_zO#kPO#mjO#xuO#{tO#|tO$SvO~Oj$xO~P+gOu%TO~P'fOu%TO#s%UO~O$R!zOx!Tay!Taz!Ta!P!Ta#v!Ta#w!Ta#x!Ta#y!Ta#z!Ta#{!Ta#|!Ta#}!Ta$O!Ta$P!Ta$Q!Ta!b!Ta!d!Ta!f!Ta!k!Ta!m!Ta$W!Ta~Ou!Ta#s!Ta~PBwO!P#PO#w!uO#x!vO#y!wO#z!wO#{!xO#|!xO#}!yO$O!yO$P!yO$Q!yO$R!zOmwixwiywizwi[wi!swiSwivwi#fwijwiUwiWwiYwi_wilwi!Zwi!owi!rwi!wwi#Qwi#Ywi#kwi]wi!pwi!twi!uwi~O#v!tO~PDiO#vwi~PDiO!P#PO#y!wO#z!wO#{!xO#|!xO#}!yO$O!yO$P!yO$Q!yO$R!zOmwixwiywizwi#vwi#xwi[wi!swiSwivwi#fwijwiUwiWwiYwi_wilwi!Zwi!owi!rwi!wwi#Qwi#Ywi#kwi]wi!pwi!twi!uwi~O#wwi~PGaO#w!uO~PGaO#}!yO$O!yO$P!yO$Q!yO$R!zOmwixwiywizwi#vwi#wwi#xwi#ywi#zwi[wi!swiSwivwi#fwijwiUwiWwiYwi_wilwi!Zwi!owi!rwi!wwi#Qwi#Ywi#kwi]wi!pwi!twi!uwi~O!P#PO#{!xO#|!xO~PJXO!Pwi#{wi#|wi~PJXO$R!zOmwixwiywi[wi!swiSwivwi#fwijwiUwiWwiYwi_wilwi!Zwi!owi!rwi!wwi#Qwi#Ywi#kwi]wi!pwi!twi!uwi~Ozwi!Pwi#vwi#wwi#xwi#ywi#zwi#{wi#|wi#}wi$Owi$Pwi$Qwi~PMVOz!{O!P#PO#v!tO#w!uO#x!vO#y!wO#z!wO#{!xO#|!xO#}!yO$O!yO$P!yO$Q!yO$R!zOmwixwi[wi!swiSwivwi#fwijwiUwiWwiYwi_wilwi!Zwi!owi!rwi!wwi#Qwi#Ywi#kwi]wi!pwi!twi!uwi~Oy#TO~P! vOywi~P! vOv%WOm$TX~P#zOv%WOm$TX~Om%YO~O$W%[O~P=PO!g%`O~O`xOaxObxOcxOdxOlTOqmO!U&lO!ZyO!_zO#kPO#mjO#xuO#{tO#|tO$SvO~O]%dO~OS!nqU!nqW!nqY!nq[!nq_!nql!nq!Z!nq!o!nq!r!nq!w!nq#Q!nq#Y!nq#f!nq#k!nq]!nq!p!nq!t!nq!u!nq~P+gO]%gO!t%fO!u%hO~Ov%iO~P+gO]%jO~O$]%lO~OS#]av#]a#f#]am#]aU#]aW#]aY#]a[#]a_#]al#]a!Z#]a!o#]a!r#]a!w#]a#Q#]a#Y#]a#k#]a]#]a!p#]a!t#]a!u#]a~P+gOusi#ssi~P8YO#r%mO~O!P&uO#w!uO#x!vO#y!wO#z!wO#{!xO#|!xO#}!yO$O!yO$P!yO$Q!yO$R!zOuwixwiywizwi#swi!bwi!dwi!fwi!kwi!mwi$Wwi~O#v!tO~P!*_O#vwi~P!*_O!P&uO#y!wO#z!wO#{!xO#|!xO#}!yO$O!yO$P!yO$Q!yO$R!zOuwixwiywizwi#swi#vwi#xwi!bwi!dwi!fwi!kwi!mwi$Wwi~O#wwi~P!,WO#w!uO~P!,WO#}!yO$O!yO$P!yO$Q!yO$R!zOuwixwiywizwi#swi#vwi#wwi#xwi#ywi#zwi!bwi!dwi!fwi!kwi!mwi$Wwi~O!P&uO#{!xO#|!xO~P!.PO!Pwi#{wi#|wi~P!.PO$R!zOxwiywizwi!Pwi#vwi#wwi#xwi#ywi#zwi#{wi#|wi#}wi$Owi$Pwi$Qwi!bwi!dwi!fwi!kwi!mwi$Wwi~Ouwi#swi~P!0OOz&mO!P&uO#v!tO#w!uO#x!vO#y!wO#z!wO#{!xO#|!xO#}!yO$O!yO$P!yO$Q!yO$R!zOuwixwi#swi!bwi!dwi!fwi!kwi!mwi$Wwi~Oy&}O~P!1pOywi~P!1pOu%nO~P'fOc%qOlTO#kPO~Ov%WOm$Ta~O#r%tO!b#oX!d#oX!f#oX!k#oX!m#oX$W#oX~P6eO!b!aa!d!aa!f!aa!k!aa!m!aa$W!aa~P8YO!b!ca!d!ca!f!ca!k!ca!m!ca$W!ca~P8YO!b!ja!d!ja!f!ja!k!ja!m!ja$W!ja~P8YOv#lXx#lXy#lXz#lX!P#lX!b#lX!d#lX!f#lX!k#lX!m#lX#v#lX#w#lX#x#lX#y#lX#z#lX#{#lX#|#lX#}#lX$O#lX$P#lX$Q#lX$R#lX$W#lX!i#lX~P!bOx&|Oy'OOz&nO!P&vO#v!tO#w!uO#x!vO#y!wO#z!wO#{!xO#|!xO#}!yO$O!yO$P!yO$Q!yO$R!zO~Ov%xO!b!la!d!la!f!la!k!la!m!la$W!la~P!7rO]%{O!t%fO!u%|O~Om#^av#^a~P#zO]&RO~O!i&TOv!hX!b!hX!d!hX!f!hX!k!hX!m!hX$W!hX~P!7rOv&UO!b$VX!d$VX!f$VX!k$VX!m$VX$W$VX~Ov!Ta!i!Ta~PBwO!s&cO~P+gO]&dO~Ov&eO[!xy~P+gOury#sry~P8YO!b!aq!d!aq!f!aq!k!aq!m!aq$W!aq~P8YOv&UO!b$Va!d$Va!f$Va!k$Va!m$Va$W$Va~O!P&vO#w!uO#x!vO#y!wO#z!wO#{!xO#|!xO#}!yO$O!yO$P!yO$Q!yO$R!zOvwixwiywizwi!bwi!dwi!fwi!kwi!mwi$Wwi!iwi~O#v!tO~P!<{O#vwi~P!<{O!P&vO#y!wO#z!wO#{!xO#|!xO#}!yO$O!yO$P!yO$Q!yO$R!zOvwixwiywizwi!bwi!dwi!fwi!kwi!mwi#vwi#xwi$Wwi!iwi~O#wwi~P!>tO#w!uO~P!>tO#}!yO$O!yO$P!yO$Q!yO$R!zOvwixwiywizwi!bwi!dwi!fwi!kwi!mwi#vwi#wwi#xwi#ywi#zwi$Wwi!iwi~O!P&vO#{!xO#|!xO~P!@mO!Pwi#{wi#|wi~P!@mOvwi!iwi~P!0OOz&nO!P&vO#v!tO#w!uO#x!vO#y!wO#z!wO#{!xO#|!xO#}!yO$O!yO$P!yO$Q!yO$R!zOvwixwi!bwi!dwi!fwi!kwi!mwi$Wwi!iwi~Oy'OO~P!BvOywi~P!BvO!b!lq!d!lq!f!lq!k!lq!m!lq$W!lq~P8YO]&hO~O[!x!Z~P+gOP#|~",
  goto: "CY$[PPP$]P${P%YP${P${PP${PPPPPP'v)_P)_PP*}PP,mP'vP._._._PP'}PPP.e/[0X1RP2R3U4['}P5h5h5h'}P6|7V'}P7Y7^P7^P7^PP7bP7^P7^P${PP${PPPP${P7h7h7kP7n${7z${P${7}${8[8_8e8hP8w9W9^9d9k9q9w9}:T:Z:aPPPP:gP:tP>`@UA|BVPPB_BfPPPPPPPPPPPPPBoPBrPBuBxCVQ_OQ!RaQ!TcQ$d#^Q$f#`Q$k#eQ%s%YQ&O%hQ&b%|R&i&cgZO]ac#^#`#e%Y%h%|&c$OSOT]abcdhlnw{}!k!{!|!}#O#P#Q#R#S#T#V#^#_#`#a#d#e#o#p#t$_$a$b%W%Y%`%f%h%i%m%t%x%|&U&c&e&k&l&m&n&o&p&q&r&s&t&u&v&w&x&y&z&{&|&}'OQiQQ!Q`Q!VeQ!ZfS!]g#lQ!gkW!jm#v%U%oQ!rqQ#n!`Q$h#bQ$l#fQ$o#hQ$p#jQ%]$^R%k$nYoRr!i!r%b#mxTbdhlmnw}!k!{!|!}#O#P#Q#R#S#T#_#a#d#o#p#t#v$^$_$a$b%U%`%f%i%m%o%t%x&U&e&k&l&m&n&o&p&q&r&s&t&u&v&w&x&y&z&{&|&}'O$ZSOT]abcdhlmnw{}!k!{!|!}#O#P#Q#R#S#T#V#^#_#`#a#d#e#o#p#t#v$^$_$a$b%U%W%Y%`%f%h%i%m%o%t%x%|&U&c&e&k&l&m&n&o&p&q&r&s&t&u&v&w&x&y&z&{&|&}'O$ZVOT]abcdhlmnw{}!k!{!|!}#O#P#Q#R#S#T#V#^#_#`#a#d#e#o#p#t#v$^$_$a$b%U%W%Y%`%f%h%i%m%o%t%x%|&U&c&e&k&l&m&n&o&p&q&r&s&t&u&v&w&x&y&z&{&|&}'O#rVTbdhlmnw{}!k!{!|!}#O#P#Q#R#S#T#V#_#a#d#o#p#t#v$^$_$a$b%U%W%`%f%i%m%o%t%x&U&e&k&l&m&n&o&p&q&r&s&t&u&v&w&x&y&z&{&|&}'OgWO]ac#^#`#e%Y%h%|&cX!mm#v%U%on!|s!S!U!b!h#u#|$T$U$e$g$u%}&P&jf&o!l$w$y%Q%R%^%_%a&Q&S&aZ&p%c%u&W&_&`r!}s!S!U!b!h#u#|#}$P$T$U$e$g$u%}&P&jj&q!l$w$y$z$|%Q%R%^%_%a&Q&S&a_&r%c%u&W&X&Z&_&`p#Os!S!U!b!h#u#|#}$T$U$e$g$u%}&P&jh&s!l$w$y$z%Q%R%^%_%a&Q&S&a]&t%c%u&W&X&_&`t#Ps!S!U!b!h#u#|#}$O$P$T$U$e$g$u%}&P&jl&u!l$w$y$z${$|%Q%R%^%_%a&Q&S&aa&v%c%u&W&X&Y&Z&_&`v#Qs!S!U!b!h#u#|#}$O$P$Q$T$U$e$g$u%}&P&jn&w!l$w$y$z${$|$}%Q%R%^%_%a&Q&S&ac&x%c%u&W&X&Y&Z&[&_&`x#Rs!S!U!b!h#u#|#}$O$P$Q$R$T$U$e$g$u%}&P&jp&y!l$w$y$z${$|$}%O%Q%R%^%_%a&Q&S&ae&z%c%u&W&X&Y&Z&[&]&_&`|#Rs!S!U!b!h#U#u#|#}$O$P$Q$R$S$T$U$e$g$u%}&P&jt&y!l#y$w$y$z${$|$}%O%P%Q%R%^%_%a&Q&S&ai&z%c%u%y&W&X&Y&Z&[&]&^&_&`!UwTbdhlnw}!k!{!|!}#O#P#Q#R#S#T#_#a#d#o#p%f%i&ez&km#t#v$^$_$a%U%m%o%t%x&k&m&o&q&s&u&w&y&{&}k&l$b%`&U&l&n&p&r&t&v&x&z&|'OQ#WyQ#i![R$s#nR$Y#VT$[#X$]T$Z#X$]Q%v%`R&f&UR!YeR!XeQ!ehQ#[}Q$j#dR$t#oR![fgYO]ac#^#`#e%Y%h%|&cR!agQ!^gR$q#lR#k!]d^Oac#^#`#e%Y%h%|&cR!P]d]Oac#^#`#e%Y%h%|&cR!O]Q#w!oR%V#wQ#q!bR$v#qS%X$V$WR%r%XQ$]#XR%Z$]Q&V%vR&g&VQ%e$fR%z%eQ#c!VR$i#cQ#g!ZR$m#gQ|UR#Z|Q#m!^R$r#mg[O]ac#^#`#e%Y%h%|&cQsTQ!SbQ!UdY!bhn}#d#oQ!hlW!lm#v%U%oQ#UwQ#u!kQ#y&kQ#|!{Q#}!|Q$O!}Q$P#OQ$Q#PQ$R#QQ$S#RQ$T#SQ$U#TQ$e#_Q$g#aQ$u#pQ$w#tQ$y&mQ$z&oQ${&qQ$|&sQ$}&uQ%O&wQ%P&yQ%Q&{Q%R&}Q%^$^Q%_$_Q%a$aQ%c$bS%u%`&UQ%y&lQ%}%fQ&P%iQ&Q%mQ&S%tQ&W&nQ&X&pQ&Y&rQ&Z&tQ&[&vQ&]&xQ&^&zQ&_&|Q&`'OQ&a%xR&j&elRO]ac{#V#^#`#e%W%Y%h%|&c!UrTbdhlnw}!k!{!|!}#O#P#Q#R#S#T#_#a#d#o#p%f%i&ez!im#t#v$^$_$a%U%m%o%t%x&k&m&o&q&s&u&w&y&{&}k%b$b%`&U&l&n&p&r&t&v&x&z&|'OfUO]ac#^#`#e%Y%h%|&c#lVTbdhlmnw}!k!{!|!}#O#P#Q#R#S#T#_#a#d#o#p#t#v$^$_$a$b%U%`%f%i%m%o%t%x&U&e&k&l&m&n&o&p&q&r&s&t&u&v&w&x&y&z&{&|&}'OQ#Y{Q$V#VR%p%WWpRr!i%bR#{!rQ!omV%S#v%U%oZoRr!i!r%bW!ch}#d#oR!qnR$X#VR%w%`R!WegXO]ac#^#`#e%Y%h%|&cR!_g",
  nodeNames: "⚠ Comment Chunk Block ; Label :: Name break Goto goto Scope do end WhileStatement while nil true false Ellipsis Number LiteralString Property . MemberExpression [ ] Parens ( ) FunctionCall : TableConstructor { FieldDynamic FieldProp FieldExp } , BinaryExpression or and CompareOp BitOp BitOp BitOp BitOp Concat ArithOp ArithOp ArithOp UnaryExpression not ArithOp BitOp LenOp FunctionDef function FuncBody ArgList Query query QueryClause FromClause from WhereClause where OrderByClause order by OrderBy desc SelectClause select LimitClause limit RepeatStatement repeat until IfStatement if then elseif else ForStatement for ForNumeric ForGeneric NameList in ExpList Function FuncName LocalFunction local Assign VarList Local AttNameList AttName Attrib ReturnStatement return",
  maxTerm: 151,
  nodeProps: [
    ["group", -14,4,5,8,9,11,14,30,76,79,84,91,93,95,97,"Statement",-3,34,35,36,"Field"]
  ],
  skippedNodes: [0,1],
  repeatNodeCount: 11,
  tokenData: "Dg~RuXY#fYZ$Q[]#f]^$_pq#fqr$grs$rst)Yuv)_vw)dwx)ixy-zyz.Pz{.U{|.Z|}.`}!O.g!O!P/Z!P!Q/p!Q!R0Q!R![1f![!]3j!]!^3w!^!_4O!_!`4b!`!a4j!c!}4|!}#O5_#O#P#w#P#QCl#Q#RCy#R#S4|#T#o4|#o#pDO#p#qDT#q#rDY#r#sD_~#kS#i~XY#f[]#fpq#f#O#P#w~#zQYZ#f]^#f~$VP#h~]^$Y~$_O#h~~$dP#h~YZ$Ym$jP!_!`$mm$rOzmk$uXOY$rZ]$r^r$rrs%bs#O$r#O#P%g#P;'S$r;'S;=`'w<%lO$rk%gO#mkk%jZrs$rwx$r!Q![&]#O#P$r#T#U$r#U#V$r#Y#Z$r#b#c$r#i#j'}#l#m(p#n#o$rk&`ZOY$rZ]$r^r$rrs%bs!Q$r!Q!['R![#O$r#O#P%g#P;'S$r;'S;=`'w<%lO$rk'UZOY$rZ]$r^r$rrs%bs!Q$r!Q![$r![#O$r#O#P%g#P;'S$r;'S;=`'w<%lO$rk'zP;=`<%l$rk(QP#o#p(Tk(WR!Q![(a!c!i(a#T#Z(ak(dS!Q![(a!c!i(a#T#Z(a#q#r$rk(sR!Q![(|!c!i(|#T#Z(|k)PR!Q![$r!c!i$r#T#Z$r~)_O$S~~)dO$P~~)iO#w~k)lXOY)iZ])i^w)iwx%bx#O)i#O#P*X#P;'S)i;'S;=`,i<%lO)ik*[Zrs)iwx)i!Q![*}#O#P)i#T#U)i#U#V)i#Y#Z)i#b#c)i#i#j,o#l#m-b#n#o)ik+QZOY)iZ])i^w)iwx%bx!Q)i!Q![+s![#O)i#O#P*X#P;'S)i;'S;=`,i<%lO)ik+vZOY)iZ])i^w)iwx%bx!Q)i!Q![)i![#O)i#O#P*X#P;'S)i;'S;=`,i<%lO)ik,lP;=`<%l)ik,rP#o#p,uk,xR!Q![-R!c!i-R#T#Z-Rk-US!Q![-R!c!i-R#T#Z-R#q#r)ik-eR!Q![-n!c!i-n#T#Z-nk-qR!Q![)i!c!i)i#T#Z)i~.POl~~.UOm~~.ZO#}~~.`O#{~o.gOvc#s[~.lP#|~}!O.o~.tTP~OY.oZ].o^;'S.o;'S;=`/T<%lO.o~/WP;=`<%l.oo/`Pgi!O!P/co/hP!Pm!O!P/kQ/pOcQ~/uQ$O~!P!Q/{!_!`$m~0QO$Q~~0VUd~!O!P0i!Q![1f!g!h0}!z!{1w#X#Y0}#l#m1w~0lP!Q![0o~0tRd~!Q![0o!g!h0}#X#Y0}~1QQ{|1W}!O1W~1ZP!Q![1^~1cPd~!Q![1^~1kSd~!O!P0i!Q![1f!g!h0}#X#Y0}~1zR!Q![2T!c!i2T#T#Z2T~2YUd~!O!P2l!Q![2T!c!i2T!r!s3^#T#Z2T#d#e3^~2oR!Q![2x!c!i2x#T#Z2x~2}Td~!Q![2x!c!i2x!r!s3^#T#Z2x#d#e3^~3aR{|1W}!O1W!P!Q1W~3oPo~![!]3r~3wOU~_4OOSR#s[o4VQ$[Qzm!^!_4]!_!`$mm4bO#ym~4gP#r~!_!`$mo4qQ$]Qzm!_!`$m!`!a4wm4|O#zm~5RS#k~!Q![4|!c!}4|#R#S4|#T#o4|o5dQik!_!`5j!}#OB[k5mQ!_!`5s!}#O=lk5vP!}#O5yk5|TO#P5y#P#Q6]#Q;'S5y;'S;=`8T<%lO5yk6`VO!_6u!_!`:p!`#P6u#P#Q;t#Q;'S6u;'S;=`=f<%lO6uk6xVO!_7_!_!`8Z!`#P7_#P#Q8s#Q;'S7_;'S;=`=`<%lO7_k7bTO#P5y#P#Q7q#Q;'S5y;'S;=`8T<%lO5yk7tP!_!`7wk7zP!_!`7}k8QP#P#Q%bk8WP;=`<%l5yk8^TO#P8Z#P#Q7q#Q;'S8Z;'S;=`8m<%lO8Zk8pP;=`<%l8Zk8vUO!_5y!_!`9Y!`#P5y#Q;'S5y;'S;=`8T<%lO5yk9]VO!_5y!_!`9r!`#P5y#P#Q6]#Q;'S5y;'S;=`8T<%lO5yk9uTO#P5y#P#Q:U#Q;'S5y;'S;=`8T<%lO5yk:ZV#mkO!_6u!_!`:p!`#P6u#P#Q;t#Q;'S6u;'S;=`=f<%lO6uk:sVO!_8Z!_!`;Y!`#P8Z#P#Q7q#Q;'S8Z;'S;=`8m<%lO8Zk;]TO#P8Z#P#Q;l#Q;'S8Z;'S;=`8m<%lO8Zk;qP#mk!_!`7wk;wVO!_7_!_!`:p!`#P7_#P#Q<^#Q;'S7_;'S;=`=`<%lO7_k<aVO!_5y!_!`9Y!`#P5y#P#Q<v#Q;'S5y;'S;=`8T<%lO5yk<yVO!_8Z!_!`:p!`#P8Z#P#Q<v#Q;'S8Z;'S;=`8m<%lO8Zk=cP;=`<%l7_k=iP;=`<%l6uk=oTO#P=l#P#Q>O#Q;'S=l;'S;=`>z<%lO=lk>RVO!_>h!_!`?Q!`#P>h#P#Q@U#Q;'S>h;'S;=`Al<%lO>hk>kTO#P=l#P#Q7w#Q;'S=l;'S;=`>z<%lO=lk>}P;=`<%l=lk?TTO#P?d#P#Q?|#Q;'S?d;'S;=`?v<%lO?dk?gTO#P?d#P#Q7w#Q;'S?d;'S;=`?v<%lO?dk?yP;=`<%l?dk@RP#mk!_!`7}k@XVO!_=l!_!`@n!`#P=l#P#QAr#Q;'S=l;'S;=`>z<%lO=lk@qTO#P=l#P#QAQ#Q;'S=l;'S;=`>z<%lO=lkAVV#mkO!_>h!_!`?Q!`#P>h#P#Q@U#Q;'S>h;'S;=`Al<%lO>hkAoP;=`<%l>hkAuVO!_?d!_!`?Q!`#P?d#P#QAr#Q;'S?d;'S;=`?v<%lO?doBaT$USO#PBp#P#QCS#Q;'SBp;'S;=`Cf<%lOBpkBsTO#PBp#P#QCS#Q;'SBp;'S;=`Cf<%lOBpkCVTO#PBp#P#Q%b#Q;'SBp;'S;=`Cf<%lOBpkCiP;=`<%lBpoCqPjP#P#QCtnCyO$Wn~DOO$R~~DTOq~~DYO#v~~D_Ou~~DdP#x~!_!`$m",
  tokenizers: [0, 1, 2, 3, 4],
  topRules: {"Chunk":[0,2]},
  dynamicPrecedences: {"128":1},
  specialized: [{term: 119, get: (value) => spec_identifier[value] || -1}],
  tokenPrec: 3791
})
