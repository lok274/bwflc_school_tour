import { activityDateLabels } from "./app-settings.js";

const activityDates = Object.freeze({ startAt: "2026-11-05T00:00:00+08:00", endAt: "2026-11-07T23:59:59+08:00" });
const activityLabels = activityDateLabels(activityDates.startAt, activityDates.endAt);
const attractionImage = (filename) => new URL(`../public/images/attractions/${filename}`, import.meta.url).href;
const introductionImage = (filename, alt, width, height) => ({
  url: new URL(`../public/images/introduction/${filename}`, import.meta.url).href, alt, width, height
});

export const TRIP_BOOKLET = Object.freeze({
  title: "學習交流團團刊",
  url: new URL("../public/documents/trip-booklet-2026.pdf", import.meta.url).href,
  filename: `${activityLabels.filenamePrefix}-學習交流團團刊.pdf`
});

export const TRIP_DATA = Object.freeze({
  title: "尋根非遺，尋找嶺南平民飲食文化智慧暨港莞學生學習交流",
  shortTitle: "戶外學習日旅程助手",
  ...activityDates,
  ...activityLabels,
  duration: "三天兩夜",
  booklet: TRIP_BOOKLET,
  itineraryIntroduction: {
    "title": "行程介紹",
    "pages": [
      {
        "heading": "行程介紹",
        "sections": [
          {
            "title": "東莞市",
            "image": introductionImage("dongguan-map.png", "團刊中的東莞市地圖", 448, 328),
            "paragraphs": [
              "東莞市，簡稱莞，是中華人民共和國廣東省下轄地級市，位於廣東省中南部，是粵港澳大灣區的涵蓋城市之一。地處中國華南地區、廣東省中南部、珠江口東岸，西北接廣州市，南接深圳市，東北接惠州市，地處東江下游，珠江三角洲東部沖積平原區與粵中低山丘陵區交接帶，南部為羅浮山余脈，地勢東南高、西北低。",
              "東江沿北邊市界往西流至石龍鎮分成多支幹流及水道注入獅子洋。是中國大陸4個不設區的地級市之一。東莞市屬亞熱帶季風氣候，長夏無冬，雨量充沛。截至2022年10月，全市海域面積82.57平方公里。東莞市下轄4個街道、28個鎮，總面積2542.67平方千米，截至2022年末，東莞市常住人口1043.7萬人，其中城鎮人口962.81萬人，城鎮化率92.25%。市人民政府駐南城街道。",
              "東莞為「廣東四小虎」之一，為珠江三角洲重要的商業、高科技產業、服務業、旅遊業、工業化城市，更是國際加工業的重要一員，有「世界工廠」之稱。"
            ]
          },
          {
            "title": "中山市",
            "image": introductionImage("zhongshan-statue.jpg", "團刊中的孫中山雕像", 315, 420),
            "paragraphs": [
              "中山市，簡稱中山，舊稱香山，是中華人民共和國廣東省下轄地級市，位於廣東省中南部，同為粵港澳大灣區的涵蓋城市之一。地處中國華南地區、廣東省中南部、珠江口西岸，北連廣州市順谷區與番禺區，西接江門市，南鄰珠海市，隔珠江口與深圳、香港相望。地處珠江三角洲沖積平原南部，地勢中部高聳、四周平緩，五桂山橫亘中部。珠江水系多條水道於境內穿流而過注入伶仃洋。與東莞相同，中山亦是中國大陸4個不設區的地級市之一。中山市屬亞熱帶季風氣候，氣候溫和，光照充足，雨量充沛。截至2022年末，全市下轄8個街道、15個鎮，總面積1783.67平方千米，常住人口443.84萬人，城鎮化率達86%以上。市人民政府駐東區街道。",
              "中山同為「廣東四小虎」之一，是珠江三角洲西岸重要的製造業、高新技術產業、現代服務業與文化旅遊城市，亦是偉大民主革命先行者孫中山先生的故鄉。"
            ]
          }
        ]
      },
      {
        "sections": [
          {
            "title": "孫中山故居",
            "image": introductionImage("sun-yat-sen-residence.jpg", "團刊中的孫中山故居建築", 400, 266),
            "paragraphs": [
              "孫中山故居紀念館位於廣東省中山市南朗街道翠亨村，為國家5A級旅遊景區及國家一級博物館。景區以孫中山先生的故居本體為核心，包含孫中山紀念館、翠亨民俗展區及農耕文化展示區，是紀念這位偉大民主革命先行者的重要文化地標。",
              "故居主樓建於1892年，由孫中山先生親自設計並主持興建。建築外觀別具一格，將西式古典拱門樓房設計與嶺南傳統的磚木結構完美融合，展現出獨特的「中西合璧」風貌。主樓內部格局則嚴格保留了19世紀末孫中山先生與家人生活時的原貌，陳列著當年使用過的傢俱與生活用品，客廳與臥室皆散發濃厚的歷史氣息。",
              "除了故居本體之外，園區內的孫中山紀念館系統性地展出其革命生涯的珍貴文物、親筆手稿與歷史照片，重現其推翻帝制、建立共和的宏偉歷程。同時，周邊復原的翠亨村民居與農耕展區，精準再現了珠江三角洲傳統鄉村的民俗風情與農耕生活，讓遊行者在緬懷革命先烈的同時，也能深度體會19世紀末廣東鄉土的文化底蘊。"
            ]
          },
          {
            "title": "留耕堂",
            "image": introductionImage("liugeng-hall.png", "團刊中的留耕堂正門", 480, 270),
            "paragraphs": [
              "留耕堂點選即可開啟側邊面板，查看更多資訊，又稱何氏大宗祠，位於廣東省廣州市番禺區沙灣古鎮內，始建於元代至元二十四年（1287年），後歷經多次毀建與擴建，現存建築主要為清代康熙年間重修後的格局，是沙灣何氏家族的宗祠，亦為廣東省省級文物保護單位。",
              "堂名「留耕」取自「陰德下濟，雙桂聯芳；造物不測，留有餘地」之意，寄語後代積德行善、耕讀傳家。留耕堂建築面積達3000多平方米，採用典型的嶺南五進深布局，由牌坊、山門、儀門、天井、享堂及後寢等組成。建築規模宏大、結構嚴謹，展現出極高的禮制等級與家族權勢。",
              "留耕堂堪稱嶺南建築藝術與傳統工藝的寶庫。祠內集結了極為精湛的木雕、石雕、磚雕、灰塑與壁畫，不論是兩側廊廡的雕花樑架，還是高聳的石柱與功名牌坊，無不體現出清代嶺南民間工藝的卓越成就，具有極高的歷史、藝術與科學價值。"
            ]
          }
        ]
      },
      {
        "sections": [
          {
            "title": "沙灣古鎮",
            "image": introductionImage("shawan-town.jpg", "團刊中的沙灣古鎮建築屋頂", 480, 252),
            "paragraphs": [
              "沙灣古鎮點選即可開啟側邊面板，查看更多資訊位於中國廣東省廣州市番禺區，始建於南宋時期，至今已有800多年歷史，是珠江三角洲地區保存相對完整且極具嶺南水鄉特色的古村落，亦獲評為國家4A級旅遊景区與中國歷史文化名鎮。",
              "古鎮以「物質文化遺產」與「非物質文化遺產」並重而聞名。建築方面，街巷依水而建，錯落有致，保留了大量明、清及民國時期的古建築，如著名的留耕堂（何氏大宗祠）。鎮內隨處可見精美的木雕、磚雕、石雕與灰塑，充分展現了嶺南建築藝術的獨特韻味。",
              "文化底蘊方面，沙灣是廣東音樂的發源地之一，孕育了名曲《賽龍奪錦》，並保留著飄色、醒獅等豐富的民俗活動。此外，這裡也是嶺南甜品「姜撞奶」的發源地，沙灣牛奶甜品以濃郁香甜著稱。古鎮完美融合了傳統建築、民間藝術與道地美食，是體現廣府文化的經典地標。"
            ]
          },
          {
            "title": "倫教糕博物館",
            "image": introductionImage("lunjiao-cake.jpg", "團刊中的倫教糕", 329, 246),
            "paragraphs": [
              "倫教糕是廣東佛山順德的傳統特色糕點，始創於明代隆慶年間，至今已有四百多年歷史。這款糕點由順德倫教鎮小販梁佩懸在機緣巧合下創製：他在蒸煮稻米糕點時不慎失手，卻意外發現發酵後的米漿蒸熟後色澤晶瑩、質感爽滑，風味大增，隨後經不斷改進，形成了這道流傳至今的嶺南名吃。",
              "倫教糕以優質大米、白糖及天然糕種為原料，看似簡單，實則極考驗工藝。製作時需將大米磨成細漿，經自然發酵後加入糖水調和，再倒入炊具蒸熟。其最大的特色在於糕體色澤潔白如玉，橫切面呈現出均勻細密的花白糕孔，口感清甜微酸、彈韌爽口，且「冷吃比熱吃更顯爽脆」。",
              "作為順德美食與嶺南飲食文化的重要代表，倫教糕不僅獲列入非物質文化遺產，更深受文人墨客喜愛。名家咸豐年間便有詩讚其「純白如玉，晶瑩如水晶」，如今它更隨廣府文化遠播海外，成為承載順德「食在順德」美譽的一張亮麗名片"
            ]
          }
        ]
      },
      {
        "heading": "姊妹學校介紹",
        "sections": [
          {
            "title": "松山湖未來學校",
            "image": introductionImage("future-school-logo.png", "團刊中的松山湖未來學校標誌", 303, 303),
            "gallery": [
              introductionImage("future-school-group.jpg", "團刊中的校際交流合照", 320, 240),
              introductionImage("future-school-visit.jpg", "團刊中的校際交流參觀活動", 400, 267),
              introductionImage("future-school-craft.jpg", "團刊中的課堂手作體驗", 400, 267)
            ],
            "paragraphs": [
              "東莞市松山湖未來學校，位於大灣區綜合性國家科學中心先行啟動區（松山湖科學城）南部濱湖片區，總用地面積約98203平方米，是東莞市政府與中國教科院合作共建的現代化、國際化、創新型的公辦完全中學，粵港澳大灣區首個未來學校實體樣板校。學校計畫於2022年9月正式開學，規劃辦學規模約3600人。學校圍繞21世紀5C核心素養，聚焦創新人才培養關鍵能力，從辦學機制、課程實施、學習方式、評價方式等方面實施立體化綜合變革，探索適應未來社會需求的創新人才培養新模式，辦一所激發潛能、傳遞溫暖、創造美好的未來學校，打造東莞教育高品質發展創新示範校，未來創新人才培養基地、未來教育創新實踐基地、未來教育師資孵化中心。",
              "2024年3月29日，本校師生約100人到訪松山湖未來學校，師生共同到校園不同地方參觀，並了解學校的校園環境。同時，學生到三個不同地點進行課堂體驗,分別製作麥稈畫、鐵絲陀螺及中藥香囊。活動氣氛良好。",
              "於2024年4月21及22日,本校獲松山湖未來學校邀請本校校長及老師出席由北京師範大學中國教育創新研究院主辦,松山湖未來學校承辦的「數智時代的中小學科學教育論壇」。本校於當更正式與松山湖未來學校締結成姊妹學校，同時更成為由松山湖未來學校牽引的「創造教育聯盟」合作學校之一,亦是聯盟內六十多所學校中第一所參與的香港中學。聯盟旨於共同邁向創新教育,積極培養創新人才,分享成功經驗。"
            ]
          }
        ]
      }
    ]
  },
  itinerary: [
    {
      day: 1,
      date: "11月5日 星期四",
      theme: "港莞交流",
      route: ["佛教黃鳳翎中學", "東莞松山湖未來學校", "酒店"],
      summary: "由佛教黃鳳翎中學出發，前往東莞松山湖未來學校進行校際學習交流，完成首日行程後入住酒店。"
    },
    {
      day: 2,
      date: "11月6日 星期五",
      theme: "歷史與非遺",
      route: ["酒店", "孫中山故居紀念館", "歡姐倫教糕博物館及製作體驗", "酒店"],
      summary: "從近代中國歷史走到順德飲食非遺，透過參觀及親手製作倫教糕，理解文化傳承。"
    },
    {
      day: 3,
      date: "11月7日 星期六",
      theme: "嶺南古鎮",
      route: ["酒店", "沙灣古鎮", "留耕堂", "香港"],
      summary: "走進嶺南古鎮與宗祠建築，觀察古街巷、民間藝術與宗族文化，然後返回香港。"
    }
  ]
});

export const ATTRACTIONS = Object.freeze([
  {
    id: "future-school",
    day: 1,
    name: "東莞松山湖未來學校",
    city: "東莞",
    image: attractionImage("future-school.webp"),
    alt: "湖畔現代校園與科學學習元素的原創插畫",
    questions: [
      "你期望在參觀姊妹學校校園時，可以參觀到什麼設施？",
      "你期望與姊妹學校學生交流時，可以從他們身上了解到什麼？",
      "你期望與姊妹學校學生交流時，你可以分享什麼給他們？",
      "你期望自己在面對陌生環境和新朋友時，能展現出怎樣的態度？"
    ],
    address: "東莞市松山湖高新技術產業開發區景安路3號",
    source: { label: "學校官方網站", url: "https://www.sshwl.cn/FutureWeb/" },
    geo: { lat: 22.890139, lng: 113.904875, radiusM: 250, coordSystem: "GCJ02", sourceUrl: "https://ditu.amap.com/place/B0HAKZHBA7" }
  },
  {
    id: "sun-yat-sen",
    day: 2,
    name: "孫中山故居紀念館",
    city: "中山",
    image: attractionImage("sun-yat-sen.webp"),
    alt: "翠亨村中西合璧歷史建築庭院的原創插畫",
    questions: [
      "孫中山故居主樓建於1892年，由孫中山先生親自設計並主持興建，建築外觀將西式古典___________樓房設計與嶺南傳統的___________結構融合，展現出「中西合璧」風貌。"
    ],
    questionNumbers: [1],
    address: "中山市南朗街道翠亨大道93號",
    source: { label: "孫中山故居紀念館", url: "https://www.sunyat-sen.org/" },
    geo: { lat: 22.441396, lng: 113.528472, radiusM: 300, coordSystem: "GCJ02", sourceUrl: "https://ditu.amap.com/place/B02F80OT98" }
  },
  {
    id: "lunjiao-cake",
    day: 2,
    name: "歡姐倫教糕博物館",
    city: "佛山順德",
    image: attractionImage("lunjiao-cake.webp"),
    alt: "竹蒸籠、米漿和倫教糕製作場景的原創插畫",
    questions: [
      "倫教糕以優質大米、白糖及___________為原料，糕體色澤潔白如玉，口感清甜微酸、彈韌爽口，且「___________比熱吃更顯爽脆」。"
    ],
    questionNumbers: [3],
    address: "佛山市順德區倫教街道北海大道北50號",
    source: { label: "順德非遺文化介紹", url: "https://www.sdlib.com.cn/home/article/detail/id/121997.html" },
    geo: { lat: 22.881584, lng: 113.205957, radiusM: 250, coordSystem: "GCJ02", sourceUrl: "https://ditu.amap.com/place/B0FFFDWUGO" }
  },
  {
    id: "shawan-town",
    day: 3,
    name: "沙灣古鎮",
    city: "廣州番禺",
    image: attractionImage("shawan-town.webp"),
    alt: "石板古巷、鑊耳屋和嶺南花木的原創插畫",
    questions: [
      "沙灣古鎮始建於___________時期，至今已有800多年歷史，是廣東音樂的發源地之一，孕育了名曲《___________》。",
      "沙灣古鎮在「物質文化遺產」與「非物質文化遺產」方面分別有哪些代表性的特色與文化？"
    ],
    questionNumbers: [2, 4],
    address: "廣州市番禺區沙灣街道大巷涌路64號一帶",
    source: { label: "廣州市文化廣電旅遊局", url: "https://wglj.gz.gov.cn/ztmb/gzhyn/ajjq/4a/content/post_8930793.html" },
    geo: { lat: 22.900653, lng: 113.334288, radiusM: 500, coordSystem: "GCJ02", sourceUrl: "https://ditu.amap.com/place/B0FFF06EOH" }
  },
  {
    id: "liugeng-hall",
    day: 3,
    name: "留耕堂",
    city: "廣州番禺",
    image: attractionImage("liugeng-hall.webp"),
    alt: "對稱宗祠庭院、石木柱和嶺南雕飾的原創插畫",
    observe: "從入口走向主堂，留意柱列、天井，以及木雕、石雕、磚雕、灰塑與壁畫。",
    prompt: "「耕讀傳家」與積德行善的理念，如何透過宗祠空間和裝飾表達？",
    address: "廣州市番禺區沙灣鎮大巷涌64號沙灣古鎮內",
    source: { label: "廣州市政府文化介紹", url: "https://www.gz.gov.cn/zt/ddgzjpwhlyxlx/ddgzyy/content/post_8754577.html" },
    geo: { lat: 22.904861, lng: 113.333645, radiusM: 150, coordSystem: "GCJ02", sourceUrl: "https://www.amap.com/place/B0FFH6RD76" }
  }
]);

// School address confirmed by bwflc.edu.hk; WGS84 address point previously checked
// with the Government Address Lookup Service, also used by the isolated device test.
// The supplied Google Maps @ coordinate is a viewport centre, not the address point.
export const DEPARTURE_LOCATION = Object.freeze({
  id: "departure-school",
  day: 1,
  name: "佛教黃鳳翎中學",
  city: "香港",
  image: attractionImage("departure-school.jpg"),
  alt: "佛教黃鳳翎中學的校舍外觀（2014 年拍攝）",
  imageCredit: Object.freeze({ author: "Exploringlife", year: "2014", sourceUrl: "https://commons.wikimedia.org/wiki/File:Buddhist_Wong_Fung_Ling_College.JPG", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/" }),
  observe: "留意出發地點附近的環境，選擇安全位置進行打卡及拍攝。",
  prompt: "出發前想一想：這次旅程最希望學到甚麼？",
  source: Object.freeze({ label: "學校官方網站", url: "https://www.bwflc.edu.hk/index/customIndex.aspx" }),
  address: "香港銅鑼灣東院道 11 號",
  mapUrl: "https://www.google.com/maps/search/%E9%A6%99%E6%B8%AF%E9%8A%85%E9%91%BC%E7%81%A3%E6%9D%B1%E9%99%A2%E9%81%93%E5%8D%81%E4%B8%80%E8%99%9F/@22.2775222,114.1844574,17z?authuser=0&hl=en&entry=ttu&g_ep=EgoyMDI2MTAwNS4wIKXMDSoASAFQAw%3D%3D",
  sourceUrl: "https://www.bwflc.edu.hk/index/customIndex.aspx",
  geo: Object.freeze({ lat: 22.27579, lng: 114.19044, radiusM: 100, coordSystem: "WGS84", sourceUrl: "https://www.bwflc.edu.hk/index/customIndex.aspx" })
});

// All six stops share the detail, check-in and photo workflows.
export const CHECK_IN_LOCATIONS = Object.freeze([DEPARTURE_LOCATION, ...ATTRACTIONS]);
// The school remains available for check-ins/photos, but completion requires only these five attractions.
export const REQUIRED_CHECK_IN_LOCATIONS = ATTRACTIONS;

// Formal and diagnostic AI kits accept one photo per required stop, with the optional school photo.
export const AI_PHOTO_COUNTS = Object.freeze([REQUIRED_CHECK_IN_LOCATIONS.length, CHECK_IN_LOCATIONS.length]);
