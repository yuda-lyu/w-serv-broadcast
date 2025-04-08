/*!
 * w-serv-broadcast-client v1.0.15
 * (c) 2018-2021 yuda-lyu(semisphere)
 * Released under the MIT License.
 */
!function(t,e){"object"==typeof exports&&"undefined"!=typeof module?module.exports=e():"function"==typeof define&&define.amd?define(e):(t="undefined"!=typeof globalThis?globalThis:t||self)["w-serv-broadcast-client"]=e()}(this,(function(){"use strict";var t=Array.isArray,e="object"==typeof global&&global&&global.Object===Object&&global,n="object"==typeof self&&self&&self.Object===Object&&self,r=e||n||Function("return this")(),o=r.Symbol,i=Object.prototype,u=i.hasOwnProperty,c=i.toString,a=o?o.toStringTag:void 0;var f=Object.prototype.toString;var l=o?o.toStringTag:void 0;function s(t){return null==t?void 0===t?"[object Undefined]":"[object Null]":l&&l in Object(t)?function(t){var e=u.call(t,a),n=t[a];try{t[a]=void 0;var r=!0}catch(t){}var o=c.call(t);return r&&(e?t[a]=n:delete t[a]),o}(t):function(t){return f.call(t)}(t)}function p(t){return null!=t&&"object"==typeof t}function v(t){return"symbol"==typeof t||p(t)&&"[object Symbol]"==s(t)}var h=/\.|\[(?:[^[\]]*|(["'])(?:(?!\1)[^\\]|\\.)*?\1)\]/,y=/^\w*$/;function b(t){var e=typeof t;return null!=t&&("object"==e||"function"==e)}function _(t){if(!b(t))return!1;var e=s(t);return"[object Function]"==e||"[object GeneratorFunction]"==e||"[object AsyncFunction]"==e||"[object Proxy]"==e}var d,j=r["__core-js_shared__"],g=(d=/[^.]+$/.exec(j&&j.keys&&j.keys.IE_PROTO||""))?"Symbol(src)_1."+d:"";var O=Function.prototype.toString;var m=/^\[object .+?Constructor\]$/,x=Function.prototype,w=Object.prototype,A=x.toString,S=w.hasOwnProperty,C=RegExp("^"+A.call(S).replace(/[\\^$.*+?()[\]{}|]/g,"\\$&").replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g,"$1.*?")+"$");function E(t){return!(!b(t)||(e=t,g&&g in e))&&(_(t)?C:m).test(function(t){if(null!=t){try{return O.call(t)}catch(t){}try{return t+""}catch(t){}}return""}(t));var e}function P(t,e){var n=function(t,e){return null==t?void 0:t[e]}(t,e);return E(n)?n:void 0}var T=P(Object,"create");var z=Object.prototype.hasOwnProperty;var N=Object.prototype.hasOwnProperty;function $(t){var e=-1,n=null==t?0:t.length;for(this.clear();++e<n;){var r=t[e];this.set(r[0],r[1])}}function F(t,e){for(var n,r,o=t.length;o--;)if((n=t[o][0])===(r=e)||n!=n&&r!=r)return o;return-1}$.prototype.clear=function(){this.__data__=T?T(null):{},this.size=0},$.prototype.delete=function(t){var e=this.has(t)&&delete this.__data__[t];return this.size-=e?1:0,e},$.prototype.get=function(t){var e=this.__data__;if(T){var n=e[t];return"__lodash_hash_undefined__"===n?void 0:n}return z.call(e,t)?e[t]:void 0},$.prototype.has=function(t){var e=this.__data__;return T?void 0!==e[t]:N.call(e,t)},$.prototype.set=function(t,e){var n=this.__data__;return this.size+=this.has(t)?0:1,n[t]=T&&void 0===e?"__lodash_hash_undefined__":e,this};var I=Array.prototype.splice;function k(t){var e=-1,n=null==t?0:t.length;for(this.clear();++e<n;){var r=t[e];this.set(r[0],r[1])}}k.prototype.clear=function(){this.__data__=[],this.size=0},k.prototype.delete=function(t){var e=this.__data__,n=F(e,t);return!(n<0)&&(n==e.length-1?e.pop():I.call(e,n,1),--this.size,!0)},k.prototype.get=function(t){var e=this.__data__,n=F(e,t);return n<0?void 0:e[n][1]},k.prototype.has=function(t){return F(this.__data__,t)>-1},k.prototype.set=function(t,e){var n=this.__data__,r=F(n,t);return r<0?(++this.size,n.push([t,e])):n[r][1]=e,this};var L=P(r,"Map");function M(t,e){var n,r,o=t.__data__;return("string"==(r=typeof(n=e))||"number"==r||"symbol"==r||"boolean"==r?"__proto__"!==n:null===n)?o["string"==typeof e?"string":"hash"]:o.map}function U(t){var e=-1,n=null==t?0:t.length;for(this.clear();++e<n;){var r=t[e];this.set(r[0],r[1])}}U.prototype.clear=function(){this.size=0,this.__data__={hash:new $,map:new(L||k),string:new $}},U.prototype.delete=function(t){var e=M(this,t).delete(t);return this.size-=e?1:0,e},U.prototype.get=function(t){return M(this,t).get(t)},U.prototype.has=function(t){return M(this,t).has(t)},U.prototype.set=function(t,e){var n=M(this,t),r=n.size;return n.set(t,e),this.size+=n.size==r?0:1,this};function B(t,e){if("function"!=typeof t||null!=e&&"function"!=typeof e)throw new TypeError("Expected a function");var n=function(){var r=arguments,o=e?e.apply(this,r):r[0],i=n.cache;if(i.has(o))return i.get(o);var u=t.apply(this,r);return n.cache=i.set(o,u)||i,u};return n.cache=new(B.Cache||U),n}B.Cache=U;var W,R,q,D=/[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|$))/g,G=/\\(\\)?/g,V=(W=function(t){var e=[];return 46===t.charCodeAt(0)&&e.push(""),t.replace(D,(function(t,n,r,o){e.push(r?o.replace(G,"$1"):n||t)})),e},R=B(W,(function(t){return 500===q.size&&q.clear(),t})),q=R.cache,R),H=V;var J=o?o.prototype:void 0,K=J?J.toString:void 0;function Q(e){if("string"==typeof e)return e;if(t(e))return function(t,e){for(var n=-1,r=null==t?0:t.length,o=Array(r);++n<r;)o[n]=e(t[n],n,t);return o}(e,Q)+"";if(v(e))return K?K.call(e):"";var n=e+"";return"0"==n&&1/e==-1/0?"-0":n}function X(t){return null==t?"":Q(t)}function Y(e,n){return t(e)?e:function(e,n){if(t(e))return!1;var r=typeof e;return!("number"!=r&&"symbol"!=r&&"boolean"!=r&&null!=e&&!v(e))||y.test(e)||!h.test(e)||null!=n&&e in Object(n)}(e,n)?[e]:H(X(e))}function Z(t){if("string"==typeof t||v(t))return t;var e=t+"";return"0"==e&&1/t==-1/0?"-0":e}function tt(t,e,n){var r=null==t?void 0:function(t,e){for(var n=0,r=(e=Y(e,t)).length;null!=t&&n<r;)t=t[Z(e[n++])];return n&&n==r?t:void 0}(t,e);return void 0===r?n:r}function et(t,e){for(var n=-1,r=null==t?0:t.length;++n<r&&!1!==e(t[n],n,t););return t}var nt,rt=function(t,e,n){for(var r=-1,o=Object(t),i=n(t),u=i.length;u--;){var c=i[nt?u:++r];if(!1===e(o[c],c,o))break}return t};function ot(t){return p(t)&&"[object Arguments]"==s(t)}var it=Object.prototype,ut=it.hasOwnProperty,ct=it.propertyIsEnumerable,at=ot(function(){return arguments}())?ot:function(t){return p(t)&&ut.call(t,"callee")&&!ct.call(t,"callee")},ft=at;var lt="object"==typeof exports&&exports&&!exports.nodeType&&exports,st=lt&&"object"==typeof module&&module&&!module.nodeType&&module,pt=st&&st.exports===lt?r.Buffer:void 0,vt=(pt?pt.isBuffer:void 0)||function(){return!1},ht=/^(?:0|[1-9]\d*)$/;function yt(t,e){var n=typeof t;return!!(e=null==e?9007199254740991:e)&&("number"==n||"symbol"!=n&&ht.test(t))&&t>-1&&t%1==0&&t<e}function bt(t){return"number"==typeof t&&t>-1&&t%1==0&&t<=9007199254740991}var _t={};_t["[object Float32Array]"]=_t["[object Float64Array]"]=_t["[object Int8Array]"]=_t["[object Int16Array]"]=_t["[object Int32Array]"]=_t["[object Uint8Array]"]=_t["[object Uint8ClampedArray]"]=_t["[object Uint16Array]"]=_t["[object Uint32Array]"]=!0,_t["[object Arguments]"]=_t["[object Array]"]=_t["[object ArrayBuffer]"]=_t["[object Boolean]"]=_t["[object DataView]"]=_t["[object Date]"]=_t["[object Error]"]=_t["[object Function]"]=_t["[object Map]"]=_t["[object Number]"]=_t["[object Object]"]=_t["[object RegExp]"]=_t["[object Set]"]=_t["[object String]"]=_t["[object WeakMap]"]=!1;var dt="object"==typeof exports&&exports&&!exports.nodeType&&exports,jt=dt&&"object"==typeof module&&module&&!module.nodeType&&module,gt=jt&&jt.exports===dt&&e.process,Ot=function(){try{var t=jt&&jt.require&&jt.require("util").types;return t||gt&&gt.binding&&gt.binding("util")}catch(t){}}(),mt=Ot&&Ot.isTypedArray,xt=mt?function(t){return function(e){return t(e)}}(mt):function(t){return p(t)&&bt(t.length)&&!!_t[s(t)]},wt=xt,At=Object.prototype.hasOwnProperty;function St(e,n){var r=t(e),o=!r&&ft(e),i=!r&&!o&&vt(e),u=!r&&!o&&!i&&wt(e),c=r||o||i||u,a=c?function(t,e){for(var n=-1,r=Array(t);++n<t;)r[n]=e(n);return r}(e.length,String):[],f=a.length;for(var l in e)!n&&!At.call(e,l)||c&&("length"==l||i&&("offset"==l||"parent"==l)||u&&("buffer"==l||"byteLength"==l||"byteOffset"==l)||yt(l,f))||a.push(l);return a}var Ct=Object.prototype;var Et=function(t,e){return function(n){return t(e(n))}}(Object.keys,Object),Pt=Et,Tt=Object.prototype.hasOwnProperty;function zt(t){if(n=(e=t)&&e.constructor,e!==("function"==typeof n&&n.prototype||Ct))return Pt(t);var e,n,r=[];for(var o in Object(t))Tt.call(t,o)&&"constructor"!=o&&r.push(o);return r}function Nt(t){return null!=t&&bt(t.length)&&!_(t)}function $t(t){return Nt(t)?St(t):zt(t)}var Ft=function(t,e){return function(n,r){if(null==n)return n;if(!Nt(n))return t(n,r);for(var o=n.length,i=e?o:-1,u=Object(n);(e?i--:++i<o)&&!1!==r(u[i],i,u););return n}}((function(t,e){return t&&rt(t,e,$t)})),It=Ft;function kt(t){return t}function Lt(e,n){var r;return(t(e)?et:It)(e,"function"==typeof(r=n)?r:kt)}var Mt=/\s/;var Ut=/^\s+/;function Bt(t){return t?t.slice(0,function(t){for(var e=t.length;e--&&Mt.test(t.charAt(e)););return e}(t)+1).replace(Ut,""):t}var Wt=/^[-+]0x[0-9a-f]+$/i,Rt=/^0b[01]+$/i,qt=/^0o[0-7]+$/i,Dt=parseInt;function Gt(t){if("number"==typeof t)return t;if(v(t))return NaN;if(b(t)){var e="function"==typeof t.valueOf?t.valueOf():t;t=b(e)?e+"":e}if("string"!=typeof t)return 0===t?t:+t;t=Bt(t);var n=Rt.test(t);return n||qt.test(t)?Dt(t.slice(2),n?2:8):Wt.test(t)?NaN:+t}var Vt=1/0;function Ht(t){return t?(t=Gt(t))===Vt||t===-1/0?17976931348623157e292*(t<0?-1:1):t==t?t:0:0===t?t:0}function Jt(t){var e=Ht(t),n=e%1;return e==e?n?e-n:e:0}function Kt(t){return"[object String]"===Object.prototype.toString.call(t)}function Qt(t){return!(!Kt(t)||""===t)}function Xt(t){return t!=t}function Yt(t){let e=!1;if(Qt(t))e=!isNaN(Number(t));else if(function(t){return"[object Number]"===Object.prototype.toString.call(t)}(t)){if(Xt(t))return!1;e=!0}return e}function Zt(t){if(!Yt(t))return 0;return Ht(t)}function te(t){return!!Yt(t)&&(t=Zt(t),"number"==typeof(e=t)&&e==Jt(e));var e}var ee=r.isFinite,ne=Math.min;var re=function(t){var e=Math[t];return function(t,n){if(t=Gt(t),(n=null==n?0:ne(Jt(n),292))&&ee(t)){var r=(X(t)+"e").split("e");return+((r=(X(e(r[0]+"e"+(+r[1]+n)))+"e").split("e"))[0]+"e"+(+r[1]-n))}return e(t)}}("round"),oe=re;function ie(t){if(!Yt(t))return 0;t=Zt(t);let e=oe(t);return"0"===String(e)?0:e}let ue="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".split(""),ce=ue.length;function ae(){let t=arguments.length>0&&void 0!==arguments[0]?arguments[0]:32,e=[];var n;t=te(n=t)&&ie(n)>0?ie(t):32;for(let n=0;n<t;n++)e[n]=ue[0|Math.random()*ce];return e.join("")}function fe(t){return t&&t.__esModule&&Object.prototype.hasOwnProperty.call(t,"default")?t.default:t}var le={exports:{}};!function(t){var e=Object.prototype.hasOwnProperty,n="~";function r(){}function o(t,e,n){this.fn=t,this.context=e,this.once=n||!1}function i(t,e,r,i,u){if("function"!=typeof r)throw new TypeError("The listener must be a function");var c=new o(r,i||t,u),a=n?n+e:e;return t._events[a]?t._events[a].fn?t._events[a]=[t._events[a],c]:t._events[a].push(c):(t._events[a]=c,t._eventsCount++),t}function u(t,e){0==--t._eventsCount?t._events=new r:delete t._events[e]}function c(){this._events=new r,this._eventsCount=0}Object.create&&(r.prototype=Object.create(null),(new r).__proto__||(n=!1)),c.prototype.eventNames=function(){var t,r,o=[];if(0===this._eventsCount)return o;for(r in t=this._events)e.call(t,r)&&o.push(n?r.slice(1):r);return Object.getOwnPropertySymbols?o.concat(Object.getOwnPropertySymbols(t)):o},c.prototype.listeners=function(t){var e=n?n+t:t,r=this._events[e];if(!r)return[];if(r.fn)return[r.fn];for(var o=0,i=r.length,u=new Array(i);o<i;o++)u[o]=r[o].fn;return u},c.prototype.listenerCount=function(t){var e=n?n+t:t,r=this._events[e];return r?r.fn?1:r.length:0},c.prototype.emit=function(t,e,r,o,i,u){var c=n?n+t:t;if(!this._events[c])return!1;var a,f,l=this._events[c],s=arguments.length;if(l.fn){switch(l.once&&this.removeListener(t,l.fn,void 0,!0),s){case 1:return l.fn.call(l.context),!0;case 2:return l.fn.call(l.context,e),!0;case 3:return l.fn.call(l.context,e,r),!0;case 4:return l.fn.call(l.context,e,r,o),!0;case 5:return l.fn.call(l.context,e,r,o,i),!0;case 6:return l.fn.call(l.context,e,r,o,i,u),!0}for(f=1,a=new Array(s-1);f<s;f++)a[f-1]=arguments[f];l.fn.apply(l.context,a)}else{var p,v=l.length;for(f=0;f<v;f++)switch(l[f].once&&this.removeListener(t,l[f].fn,void 0,!0),s){case 1:l[f].fn.call(l[f].context);break;case 2:l[f].fn.call(l[f].context,e);break;case 3:l[f].fn.call(l[f].context,e,r);break;case 4:l[f].fn.call(l[f].context,e,r,o);break;default:if(!a)for(p=1,a=new Array(s-1);p<s;p++)a[p-1]=arguments[p];l[f].fn.apply(l[f].context,a)}}return!0},c.prototype.on=function(t,e,n){return i(this,t,e,n,!1)},c.prototype.once=function(t,e,n){return i(this,t,e,n,!0)},c.prototype.removeListener=function(t,e,r,o){var i=n?n+t:t;if(!this._events[i])return this;if(!e)return u(this,i),this;var c=this._events[i];if(c.fn)c.fn!==e||o&&!c.once||r&&c.context!==r||u(this,i);else{for(var a=0,f=[],l=c.length;a<l;a++)(c[a].fn!==e||o&&!c[a].once||r&&c[a].context!==r)&&f.push(c[a]);f.length?this._events[i]=1===f.length?f[0]:f:u(this,i)}return this},c.prototype.removeAllListeners=function(t){var e;return t?(e=n?n+t:t,this._events[e]&&u(this,e)):(this._events=new r,this._eventsCount=0),this},c.prototype.off=c.prototype.removeListener,c.prototype.addListener=c.prototype.on,c.prefixed=n,c.EventEmitter=c,t.exports=c}(le);var se=fe(le.exports);function pe(t){return"[object Object]"===Object.prototype.toString.call(t)}function ve(t){return"[object Array]"===Object.prototype.toString.call(t)}function he(t){return!!function(t){return"[object Undefined]"===Object.prototype.toString.call(t)}(t)||(!!function(t){return"[object Null]"===Object.prototype.toString.call(t)}(t)||(!!function(t){if(pe(t)){for(let e in t)return!1;return!0}return!1}(t)||(!!function(t){return!(!Kt(t)||""!==t)}(t)||(!!function(t){return!!ve(t)&&0===t.length}(t)||!!Xt(t)))))}return function(t){let e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:{};if(function(t){if(pe(t)){for(let e in t)return!0;return!1}return!1}(t)||(console.log("instWConverClient is not an effective object, and set instWConverClient to an EventEmitter"),t=new se),r="emit",!pe(n=t)||!Qt(r)&&!Yt(r)||!(r in n))throw new Error("instWConverClient is not an EventEmitter");var n,r;let o=tt(e,"timePolling");var i;te(i=o)&&ie(i)>=0||(o=2e3),o=ie(o);let u=tt(t,"clientId");Qt(u)||(u=ae());let c=function(e){for(var n=arguments.length,r=new Array(n>1?n-1:0),o=1;o<n;o++)r[o-1]=arguments[o];setTimeout((()=>{t.emit(e,...r)}),1)},a=!1,f=!1,l=setInterval((()=>{t.execute("[sys:polling]",{clientId:u},(function(t){})).then((function(t){!1===a&&(a=!0,c("openOnce")),!1===f&&c("open"),f=!0,function(t){return!(!ve(t)||0===t.length||1===t.length&&he(t[0]))}(t)&&Lt(t,(t=>{let e=tt(t,"data",null);c("broadcast",e)}))})).catch((function(t){f=!1,c("error",t)}))}),o);return t.clearBroadcast=()=>{clearInterval(l)},t}}));
//# sourceMappingURL=w-serv-broadcast-client.umd.js.map
