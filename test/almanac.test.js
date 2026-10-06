const test = require("node:test");
const assert = require("node:assert/strict");
const { Solar } = require("lunar-javascript");
const { formatActivities, getAlmanac } = require("../src/lib/almanac");

test("fixed dates expose lunar text, 宜忌 and festivals from lunar-javascript", () => {
  const national = getAlmanac(2024, 10, 1);
  const lunar = Solar.fromYmd(2024, 10, 1).getLunar();
  assert.equal(national.gregorian, "2024年10月1日 星期二");
  assert.equal(national.lunar, "二〇二四年八月廿九");
  assert.deepEqual(national.festivals, ["国庆节"]);
  assert.deepEqual(national.yi, lunar.getDayYi());
  assert.deepEqual(national.ji, lunar.getDayJi());
  assert.ok(national.yi.length > 0);
  assert.ok(national.ji.length > 0);

  const spring = getAlmanac(2024, 2, 10);
  assert.equal(spring.gregorian, "2024年2月10日 星期六");
  assert.equal(spring.lunar, "二〇二四年正月初一");
  assert.deepEqual(spring.festivals, ["春节"]);
  assert.equal(spring.festivals.includes("国际气象节"), false);

  assert.deepEqual(getAlmanac(2024, 2, 9).festivals, ["除夕"]);
  assert.deepEqual(getAlmanac(2024, 9, 17).festivals, ["中秋节"]);
  assert.ok(getAlmanac(2024, 4, 4).festivals.includes("清明节"));
  assert.deepEqual(getAlmanac(2024, 10, 12).festivals, ["国庆节（调休上班）"]);
  assert.deepEqual(getAlmanac(2025, 1, 28).festivals, ["除夕", "春节"]);
  assert.equal(getAlmanac(2023, 3, 22).lunar, "二〇二三年闰二月初一");

  const housingDay = getAlmanac(2026, 10, 5);
  const housingLunar = Solar.fromYmd(2026, 10, 5).getLunar();
  assert.equal(housingDay.gregorian, "2026年10月5日 星期一");
  assert.equal(housingDay.lunar, "二〇二六年八月廿五");
  assert.deepEqual(housingDay.festivals, ["国庆节"]);
  assert.equal(housingDay.festivals.includes("世界住房日"), false);
  assert.deepEqual(housingDay.yi, housingLunar.getDayYi());
  assert.deepEqual(housingDay.ji, housingLunar.getDayJi());
});

test("人日 comes from the library's traditional lunar festivals", () => {
  const renri = getAlmanac(2024, 2, 16);
  assert.equal(renri.lunar, "二〇二四年正月初七");
  assert.ok(renri.festivals.includes("人日"));
});

test("formatActivities lists every activity and does not truncate", () => {
  assert.equal(formatActivities([]), "无");
  assert.equal(formatActivities(["祭祀", "出行"]), "祭祀、出行");
  const many = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛"];
  assert.equal(formatActivities(many), many.join("、"));
  assert.equal(formatActivities(many).includes("等"), false);
  const day = getAlmanac(2026, 10, 6);
  assert.equal(formatActivities(day.yi), day.yi.join("、"));
  assert.equal(formatActivities(day.ji), day.ji.join("、"));
  assert.equal(formatActivities(day.yi).endsWith("等"), false);
  assert.equal(formatActivities(day.ji).endsWith("等"), false);
  assert.ok(day.yi.length > 6);
});
