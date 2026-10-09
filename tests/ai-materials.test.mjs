import test from "node:test";
import assert from "node:assert/strict";
import { createTripAIKit, createDeviceAIKit } from "../src/photos.js";
import { DEVICE_TEST_LOCATION } from "../src/device-test-data.js";
import { CHECK_IN_LOCATIONS, TRIP_DATA } from "../src/data.js";
import { checkedState } from "./helpers/browser-environment.js";
import { jpegHeader } from "./helpers/image-fixtures.js";

const identity = { studentName: "測試同學", className: "測試班", studentNumber: "07" };
const stations = () => CHECK_IN_LOCATIONS.map(attraction => ({ attraction,
  photoRecord: { attractionId: attraction.id, photoId: attraction.id, blob: new Blob([jpegHeader(1200, 900)], { type: "image/jpeg" }) },
  checkIn: checkedState([attraction.id]).checkIns[attraction.id] }));
const options = extra => ({ stations: stations(), ...identity, tripTitle: TRIP_DATA.title, dateLabel: TRIP_DATA.dateLabel, ...extra });

async function entries(file) {
  const bytes = new Uint8Array(await file.arrayBuffer()), view = new DataView(bytes.buffer), items = [];
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true), length = view.getUint16(offset + 26, true);
    const start = offset + 30 + length;
    items.push({ name: new TextDecoder().decode(bytes.slice(offset + 30, start)), bytes: bytes.slice(start, start + size) });
    offset = start + size;
  }
  assert.equal(view.getUint32(offset, true), 0x02014b50);
  return items;
}
async function withImages(action) {
  const previous = { document: globalThis.document, bitmap: globalThis.createImageBitmap };
  let decoded = 0, closed = 0, alive = 0, maxAlive = 0;
  const sizes = [[1200, 900], [600, 1200], [900, 900], [1200, 600], [800, 1200], [1200, 900]], draws = [];
  const context = { fillRect() {}, drawImage(...args) { draws.push(args); } };
  globalThis.document = { createElement: () => ({ getContext: () => context,
    toBlob(callback, type) { callback(new Blob([jpegHeader(1200, 900)], { type })); } }) };
  globalThis.createImageBitmap = async () => {
    const [width, height] = sizes[decoded++]; alive++; maxAlive = Math.max(maxAlive, alive);
    return { width, height, close() { closed++; alive--; } };
  };
  try { await action({ context, draws, counts: () => ({ decoded, closed, alive, maxAlive }) }); }
  finally { globalThis.document = previous.document; globalThis.createImageBitmap = previous.bitmap; }
}

test("六站素材包按行程順序包含六張 JPEG 與 UTF-8 指令，檔名不含個資", () => withImages(async fixture => {
  const archive = await createTripAIKit(options());
  assert.equal(archive.type, "application/zip"); assert.equal(archive.name, "AI融合圖片素材包-6張.zip");
  const files = await entries(archive);
  assert.equal(files.length, 7);
  CHECK_IN_LOCATIONS.forEach((station, index) => assert.equal(files[index].name, `${String(index + 1).padStart(2, "0")}-${station.name}.jpg`));
  assert.equal(files.at(-1).name, "AI融合圖片生成指令.txt");
  const prompt = new TextDecoder().decode(files.at(-1).bytes);
  for (const text of [TRIP_DATA.title, TRIP_DATA.dateLabel, "測試同學", "測試班", '"07"', "自然過渡", "單一畫面", "團刊第 14 頁", "本網站不會上傳", "1080 × 1350"]) assert.ok(prompt.includes(text), text);
  for (const file of files) assert.doesNotMatch(file.name, /測試同學|測試班|07/);
  assert.doesNotMatch(prompt, /GPS|checkedInAt|座標|04:00/);
  assert.deepEqual(fixture.counts(), { decoded: 6, closed: 6, alive: 0, maxAlive: 1 });
  fixture.draws.forEach(args => { assert.equal(args.length, 5); assert.equal(args[1], 0); assert.equal(args[2], 0); assert.equal(args[3], args[0].width); assert.equal(args[4], args[0].height); });
}));

test("五景點素材包不包含學校，指令對照只有所選照片", () => withImages(async fixture => {
  const archive = await createTripAIKit(options({ stations: stations().slice(1) })), files = await entries(archive);
  assert.equal(archive.name, "AI融合圖片素材包-5張.zip"); assert.equal(files.length, 6);
  assert.equal(files[0].name, "01-東莞松山湖未來學校.jpg");
  assert.ok(files.every(file => !file.name.includes("佛教黃鳳翎")));
  assert.ok(!new TextDecoder().decode(files.at(-1).bytes).includes("佛教黃鳳翎"));
  assert.equal(fixture.counts().maxAlive, 1);
}));

test("裝置素材包只接受獨立測試照片，指令明示測試用途，不假稱正式到訪", () => withImages(async () => {
  const photoRecords = stations().slice(1).map((item, index) => ({ ...item.photoRecord, attractionId: DEVICE_TEST_LOCATION.id, photoId: `test-${index}` }));
  const files = await entries(await createDeviceAIKit({ photoRecords, ...identity }));
  assert.equal(files.length, 6); assert.ok(files[0].name.includes("裝置測試相片1"));
  assert.ok(new TextDecoder().decode(files.at(-1).bytes).includes("並非正式五景點課業或到訪證明"));
  await assert.rejects(createDeviceAIKit({ photoRecords: stations().slice(1).map(item => item.photoRecord), ...identity }), /裝置測試相片/);
}));

test("缺必需景點、調換次序、重複照片與空白身份資料在解碼前拒絕", () => withImages(async fixture => {
  await assert.rejects(createTripAIKit(options({ stations: stations().slice(0, -1) })), /五個必需景點/);
  const swapped = stations().slice(1); [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  await assert.rejects(createTripAIKit(options({ stations: swapped })), /五個必需景點/);
  const duplicate = stations(); duplicate[1].photoRecord.photoId = duplicate[0].photoRecord.photoId;
  await assert.rejects(createTripAIKit(options({ stations: duplicate })), /五個必需景點/);
  for (const field of Object.keys(identity)) await assert.rejects(createTripAIKit(options({ [field]: "  " })), /請填寫/);
  assert.equal(fixture.counts().decoded, 0);
}));

test("超大及損壞圖片不產生素材包，中途失敗釋放當前影像", () => withImages(async fixture => {
  const huge = stations(); huge[0].photoRecord.blob = new Blob([jpegHeader(8193, 100)], { type: "image/jpeg" });
  await assert.rejects(createTripAIKit(options({ stations: huge })), /尺寸/);
  const corrupt = stations(); corrupt[0].photoRecord.blob = new Blob(["invalid"], { type: "image/jpeg" });
  await assert.rejects(createTripAIKit(options({ stations: corrupt })));
  assert.equal(fixture.counts().decoded, 0);
  fixture.context.drawImage = () => { throw Error("draw failed"); };
  await assert.rejects(createTripAIKit(options()), /draw failed/);
  assert.deepEqual(fixture.counts(), { decoded: 1, closed: 1, alive: 0, maxAlive: 1 });
}));

test("工作失效立即停止，不輸出舊資料；HTML 字元只寫進純文字指令", () => withImages(async fixture => {
  await assert.rejects(createTripAIKit(options({ isRelevant: () => false })), /失效/);
  assert.equal(fixture.counts().decoded, 0);
  let calls = 0;
  await assert.rejects(createTripAIKit(options({ isRelevant: () => ++calls < 3 })), /失效/);
  assert.equal(fixture.counts().closed, 1);
  const files = await entries(await createTripAIKit(options({ stations: stations().slice(1), studentName: '"><img src=x>' })));
  const text = new TextDecoder().decode(files.at(-1).bytes);
  assert.ok(text.includes(JSON.stringify('"><img src=x>'))); assert.ok(files.every(file => !file.name.includes("<img")));
}));
