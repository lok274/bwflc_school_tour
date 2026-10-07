const attractionImage = (filename) => new URL(`../public/images/attractions/${filename}`, import.meta.url).href;

export const TRIP_DATA = Object.freeze({
  title: "尋根非遺 尋找嶺南平民飲食文化智慧暨港莞學生學習交流",
  shortTitle: "戶外學習日旅程助手",
  startAt: "2026-11-05T00:00:00+08:00",
  endAt: "2026-11-07T23:59:59+08:00",
  dateLabel: "2026年11月5日至7日",
  duration: "三天兩夜",
  itinerary: [
    {
      day: 1,
      date: "11月5日 星期四",
      theme: "港莞交流",
      route: ["香港", "東莞松山湖未來學校", "酒店"],
      summary: "由香港出發，前往東莞松山湖未來學校進行校際學習交流，完成首日行程後入住酒店。"
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
    intro: "東莞松山湖未來學校位於松山湖科學城，是一所面向未來教育的公辦完全中學。校園重視創新人才培養、跨學科學習和科技素養。是次到訪的核心不是一般觀光，而是與姊妹學校學生交流，從校園空間、學習方式和彼此分享中理解大灣區教育發展。",
    observe: "留意校園空間怎樣支援協作、探究和科技學習。",
    prompt: "選一項你想帶回香港校園的學習設計，記下原因。",
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
    observe: "比較建築外觀與室內布局中的中式和西式元素。",
    prompt: "哪一段成長經歷最能解釋孫中山日後的選擇？",
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
    observe: "留意米漿發酵後的氣泡、香氣和糕體孔洞。",
    prompt: "哪一個步驟最影響口感？用觀察到的證據說明。",
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
    intro: "沙灣古鎮始建於南宋，擁有八百多年歷史，保存石階石巷、明清至民國建築，以及磚雕、木雕、石雕和灰塑等嶺南工藝。這裡亦孕育廣東音樂、飄色、龍獅和魚燈等民間文化。穿行街巷時，可觀察建築、社區生活與非遺如何共同延續地方記憶。",
    observe: "找出一處鑊耳屋、灰塑或磚雕，描述它的形狀與用途。",
    prompt: "古鎮要保留居民生活，同時接待遊客，兩者可以怎樣平衡？",
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
    observe: "從入口走向主堂，記錄空間高度、柱列和裝飾的變化。",
    prompt: "建築布局如何讓人感受到宗族秩序與共同記憶？",
    address: "廣州市番禺區沙灣鎮大巷涌64號沙灣古鎮內",
    source: { label: "廣州市政府文化介紹", url: "https://www.gz.gov.cn/zt/ddgzjpwhlyxlx/ddgzyy/content/post_8754577.html" },
    geo: { lat: 22.904861, lng: 113.333645, radiusM: 150, coordSystem: "GCJ02", sourceUrl: "https://www.amap.com/place/B0FFH6RD76" }
  }
]);

export const BUILTIN_CHECKLIST = Object.freeze([
  { id: "documents-valid", group: "證件", label: "檢查香港身份證及回鄉證／卡在旅程期間有效" },
  { id: "documents-pack", group: "證件", label: "出發日把身份證及回鄉證／卡放入隨身袋" },
  { id: "health", group: "健康", label: "按實際情況完成紙本健康申報及準備個人藥物" },
  { id: "insurance", group: "健康", label: "了解個人綜合旅遊保險保障及緊急安排" },
  { id: "camera", group: "學習任務", label: "準備可拍攝的裝置並確認有足夠電量與容量" },
  { id: "reflection", group: "學習任務", label: "閱讀五個景點的觀察重點及學習提示" }
]);
