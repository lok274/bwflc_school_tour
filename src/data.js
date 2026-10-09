const attractionImage = (filename) => new URL(`../public/images/attractions/${filename}`, import.meta.url).href;

export const TRIP_BOOKLET = Object.freeze({
  title: "學習交流團團刊",
  url: new URL("../public/documents/trip-booklet-2026.pdf", import.meta.url).href,
  filename: "2026-11-05至07-學習交流團團刊.pdf",
  pageCount: 20,
  sizeLabel: "約 6 MB"
});

export const TRIP_DATA = Object.freeze({
  title: "尋根非遺，尋找嶺南平民飲食文化智慧暨港莞學生學習交流",
  shortTitle: "戶外學習日旅程助手",
  startAt: "2026-11-05T00:00:00+08:00",
  endAt: "2026-11-07T23:59:59+08:00",
  dateLabel: "2026年11月5日至7日",
  duration: "三天兩夜",
  booklet: TRIP_BOOKLET,
  hotels: [
    { name: "東莞帝豪花園酒店", address: "東莞市大朗鎮美景中路769號", phone: "0769 83122222", dial: "+8676983122222" },
    { name: "順德聯塑萬怡酒店", address: "佛山市順德區龍江鎮文華路11號", phone: "0757 29383888", dial: "+8675729383888" }
  ],
  learning: {
    tasks: [
      { title: "旅途中分組分享", text: "介紹景點、回顧當天行程，並準備簡單問答。" },
      { title: "個人圖文文章", text: "題目自擬，約 600 字並配圖片，結合姊妹學校交流、嶺南文化及國家情懷。" },
      { title: "小組短片", text: "拍攝活動花絮，剪輯成約 2 分鐘影片，包含景點介紹及組員感想。" },
      { title: "個人 AI 融合圖片", text: "拍攝數張有當地特色、包含自己或同學的照片，旅程後用 AI 工具把照片特色融合成一張圖片。作品提交方式見團刊第 14 頁。" }
    ],
    cardNote: "「旅途回憶」可選取各景點相片，填寫必需的姓名、班別及學號，下載 AI 融合圖片素材包。解壓後，把相片及生成指令交給你使用的 AI 工具製作，再按團刊提交作品。網站不會自動上傳或提交課業。",
    reflections: [
      "第一日：交流時認識了甚麼？哪些活動或學習方式最令你留下印象？",
      "第二日：參觀故居及體驗倫教糕後，如何在日常生活實踐對國家與社會的責任？",
      "第三日：傳統文化如何連結身份認同？年輕人可以如何兼顧保護與創新？",
      "回程後：三天最大的得著、做得好的地方，以及下一次想改善甚麼？"
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
    intro: "東莞松山湖未來學校位於松山湖科學城，是重視創新教育及跨學科學習的公辦完全中學。團刊記錄，本校在 2024 年曾到訪交流，並與該校締結姊妹學校關係。是次到訪可從校園設施、課堂體驗及學生分享，了解彼此的學習生活與教育方式。",
    observe: "留意校園設施如何支援協作與探究，了解同學的學習生活。",
    prompt: "你想從姊妹學校同學身上了解甚麼？你又可以分享哪些香港校園經驗？",
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
    intro: "紀念館位於孫中山故鄉翠亨村，以故居及周邊展示區呈現他的成長、愛國思想與革命實踐。故居是一座中西合璧的兩層磚木建築，亦連結翠亨村的生活史。參觀時可把人物生平放回當時社會環境，思考個人經歷如何形成改變時代的志向。",
    observe: "比較西式拱門與嶺南磚木結構，留意家具、生活用品及翠亨民俗展區。",
    prompt: "從孫中山的經歷出發，你可以如何在生活中實踐對國家與社會的責任？",
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
    intro: "倫教糕是順德傳統米製糕點，以潔白晶亮、爽軟帶韌和自然發酵的微酸甜味見稱，其製作技藝已列入佛山市級非物質文化遺產。研學活動會把浸米、磨漿、調味、發酵、蒸煮和冷卻等步驟連起來，讓學生從味道背後看見經驗、科學與工匠精神。",
    observe: "了解大米、白糖及天然糕種的作用，觀察發酵氣泡與蒸熟後的糕體孔洞。",
    prompt: "哪一個製作步驟最影響倫教糕的口感？用觀察到的證據說明。",
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
    intro: "沙灣古鎮始建於南宋，保存石巷、傳統建築，以及磚雕、木雕、石雕和灰塑等嶺南工藝。團刊亦介紹廣東音樂《賽龍奪錦》、飄色、醒獅及姜撞奶等文化特色。走進古鎮，可同時觀察有形的建築與工藝，以及靠人們實踐和傳授而延續的非物質文化。",
    observe: "找出一項建築工藝，再認識一項廣東音樂、民俗或飲食文化。",
    prompt: "沙灣有哪些物質及非物質文化遺產？保護傳統時，可以如何加入新意？",
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
    intro: "留耕堂又名何氏大宗祠，是沙灣具代表性的宗祠建築，名稱寄託把善德留給後人的意思。建築沿中軸對稱展開，集合石柱、木構、磚雕、木雕、石雕及灰塑，被視為觀察嶺南宗祠藝術與宗族文化的重要場所。參觀時既看裝飾，也要理解空間背後的禮序。",
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
