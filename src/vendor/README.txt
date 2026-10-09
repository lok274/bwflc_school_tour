Local PDF dependencies (loaded only when generating a workbook PDF)

pdf-lib 1.17.1: https://registry.npmjs.org/pdf-lib/-/pdf-lib-1.17.1.tgz
@pdf-lib/fontkit 1.1.1: https://registry.npmjs.org/@pdf-lib/fontkit/-/fontkit-1.1.1.tgz
Only adaptation: pako import redirected to the local adapter.
pako 1.0.11: https://registry.npmjs.org/pako/-/pako-1.0.11.tgz
Noto Sans HK Regular: static TrueType at weight 400, instantiated with fontTools 4.61.1 from
https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/Variable/TTF/Subset/NotoSansHK-VF.ttf
The variable-font axes are removed at build time. Runtime embeds this static Regular font through the official pdf-lib/fontkit interfaces.
OTF CFF subsetting in fontkit 1.1.1 produces invalid fonts; the static TTF avoids that reader compatibility failure.
Font copyright (c) 2014-2021 Adobe (http://www.adobe.com/), Reserved Font Name Source.
Font is licensed under OFL-1.1; pdf-lib and fontkit under MIT; pako MIT/Zlib. See accompanying license files and retained bundle notices.
Source maps omitted (not runtime assets). No CDN or runtime data fetch.
Upstream VF SHA256 70172afd2cf0e045182787219b949e7798253982a36e364114757c09efd55477
Static TTF SHA256 92f0e0c00110ed218ebca7adfa5599a3cac039eb0a25c9178e8475df6d67f1cd

fontkit-1.1.1.js SHA256 fd2f6e0daa293cf860ef2ef18bd56a9e61cef9a3a2b1af20051c13d88b54f9c3
fontkit-LICENSE.txt SHA256 a6d98f9c1cea70e2d05a08e468d21684205afc45f4a2cb513584c06050893f21
noto-sans-hk-regular.js SHA256 36fefb0bfc4ef7cb878a8324a7ac9cc7c053c74d53471833b0f11724222d243f
NotoSansHK-LICENSE.txt SHA256 6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2
pako-1.0.11.js SHA256 a900f5ace912ca664496f80b896fcc7865c438335b25b7d874d72fb3bf9504de
pako-LICENSE.txt SHA256 a04665b3b2de56c66730c1f720f528175739e4104f79073614aa611da1e85539
pdf-lib-1.17.1.js SHA256 a4eb247afbb2d445e4b0e2ed1e4bee9dd8c7f3a26f5965b9e11afb615d4c53f5
pdf-lib-LICENSE.txt SHA256 f2c9fc00fdb66eb99ac156ba52d734af66d8d309f65753ae809ad34ee2883bcb
