const test = require("node:test");
const assert = require("node:assert/strict");
const { clothingTip, outdoorAdvice, humidityAdvice } = require("../src/lib/clothing");

test("clothing tips follow temperature bands", () => {
  const cases = [
    [30, "天气炎热，宜穿短袖"],
    [29.9, "天气偏热，短袖即可"],
    [25, "天气偏热，短袖即可"],
    [24.9, "气温舒适，薄长袖合适"],
    [19, "气温舒适，薄长袖合适"],
    [18.9, "天气微凉，建议加外套"],
    [12, "天气微凉，建议加外套"],
    [11.9, "天气偏冷，宜穿毛衣"],
    [5, "天气偏冷，宜穿毛衣"],
    [4.9, "天气寒冷，注意保暖"],
    [-2, "天气寒冷，注意保暖"],
    [-2.1, "气温很低，宜穿羽绒服"],
  ];
  for (const [temperature, expected] of cases) {
    assert.equal(clothingTip({ temperature, weatherCode: 0, uvIndex: 1 }), expected);
  }
});

test("rain, snow, freezing rain and strong UV extend the tip", () => {
  assert.equal(
    clothingTip({ temperature: 22, weatherCode: 63, uvIndex: 9 }),
    "气温舒适，薄长袖合适，有降雨，记得带伞",
  );
  assert.equal(
    clothingTip({ temperature: 22, weatherCode: 95, uvIndex: 1 }),
    "气温舒适，薄长袖合适，有雷雨，记得带伞",
  );
  assert.equal(
    clothingTip({ temperature: -1, weatherCode: 73, uvIndex: 0 }),
    "天气寒冷，注意保暖，有降雪，注意防滑",
  );
  assert.equal(
    clothingTip({ temperature: 3, weatherCode: 66, uvIndex: 0 }),
    "天气寒冷，注意保暖，有冻雨，注意防滑",
  );
  assert.equal(
    clothingTip({ temperature: 27, weatherCode: 0, uvIndex: 8 }),
    "天气偏热，短袖即可，紫外线很强，注意防晒",
  );
  assert.equal(
    clothingTip({ temperature: 27, weatherCode: 1, uvIndex: 6 }),
    "天气偏热，短袖即可，紫外线较强，注意防晒",
  );
  assert.equal(
    clothingTip({ temperature: 27, weatherCode: 1, uvIndex: 5.9 }),
    "天气偏热，短袖即可",
  );
  assert.equal(clothingTip({ weatherCode: 61 }), "");
});

test("outdoor advice follows each UV band and does not invent a missing value", () => {
  assert.equal(outdoorAdvice(0), "适合外出");
  assert.equal(outdoorAdvice(2), "适合外出");
  assert.equal(outdoorAdvice(2.9), "适合外出");
  assert.equal(outdoorAdvice(3), "可以外出，注意防晒");
  assert.equal(outdoorAdvice(5), "可以外出，注意防晒");
  assert.equal(outdoorAdvice(5.9), "可以外出，注意防晒");
  assert.equal(outdoorAdvice(6), "中午少出门，戴帽并涂防晒");
  assert.equal(outdoorAdvice(7), "中午少出门，戴帽并涂防晒");
  assert.equal(outdoorAdvice(7.9), "中午少出门，戴帽并涂防晒");
  assert.equal(outdoorAdvice(8), "不适合长时间在外晒");
  assert.equal(outdoorAdvice(10), "不适合长时间在外晒");
  assert.equal(outdoorAdvice(10.9), "不适合长时间在外晒");
  assert.equal(outdoorAdvice(11), "不适合外出暴晒");
  assert.equal(outdoorAdvice(14), "不适合外出暴晒");
  assert.equal(outdoorAdvice(null), "暂无紫外线");
  assert.equal(outdoorAdvice(undefined), "暂无紫外线");
  assert.equal(outdoorAdvice(Number.NaN), "暂无紫外线");
});

test("humidity advice follows each band and does not invent a missing value", () => {
  assert.equal(humidityAdvice(0), "空气干燥，记得多喝水");
  assert.equal(humidityAdvice(29.9), "空气干燥，记得多喝水");
  assert.equal(humidityAdvice(30), "湿度舒适");
  assert.equal(humidityAdvice(59.9), "湿度舒适");
  assert.equal(humidityAdvice(60), "有点潮湿，体感更闷");
  assert.equal(humidityAdvice(79.9), "有点潮湿，体感更闷");
  assert.equal(humidityAdvice(80), "非常潮湿，衣物不易干");
  assert.equal(humidityAdvice(100), "非常潮湿，衣物不易干");
  assert.equal(humidityAdvice(null), "暂无湿度");
  assert.equal(humidityAdvice(undefined), "暂无湿度");
  assert.equal(humidityAdvice(Number.NaN), "暂无湿度");
});
