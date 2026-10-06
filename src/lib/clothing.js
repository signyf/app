const RAIN = new Set([51, 53, 55, 61, 63, 65, 80, 81, 82]);
const FREEZING = new Set([56, 57, 66, 67]);
const SNOW = new Set([71, 73, 75, 77, 85, 86]);
const THUNDER = new Set([95, 96, 99]);

function temperatureAdvice(temperature) {
  if (temperature >= 30) return "天气炎热，宜穿短袖";
  if (temperature >= 25) return "天气偏热，短袖即可";
  if (temperature >= 19) return "气温舒适，薄长袖合适";
  if (temperature >= 12) return "天气微凉，建议加外套";
  if (temperature >= 5) return "天气偏冷，宜穿毛衣";
  if (temperature >= -2) return "天气寒冷，注意保暖";
  return "气温很低，宜穿羽绒服";
}

function conditionAdvice(weatherCode, uvIndex) {
  if (THUNDER.has(weatherCode)) return "有雷雨，记得带伞";
  if (SNOW.has(weatherCode)) return "有降雪，注意防滑";
  if (FREEZING.has(weatherCode)) return "有冻雨，注意防滑";
  if (RAIN.has(weatherCode)) return "有降雨，记得带伞";
  if (typeof uvIndex === "number" && uvIndex >= 8) return "紫外线很强，注意防晒";
  if (typeof uvIndex === "number" && uvIndex >= 6) return "紫外线较强，注意防晒";
  return "";
}

function clothingTip({ temperature, weatherCode, uvIndex } = {}) {
  if (typeof temperature !== "number" || Number.isNaN(temperature)) return "";
  const base = temperatureAdvice(temperature);
  const extra = conditionAdvice(weatherCode, uvIndex);
  return extra ? `${base}，${extra}` : base;
}

function outdoorAdvice(uvIndex) {
  if (typeof uvIndex !== "number" || !Number.isFinite(uvIndex) || uvIndex < 0) return "暂无紫外线";
  if (uvIndex < 3) return "适合外出";
  if (uvIndex < 6) return "可以外出，注意防晒";
  if (uvIndex < 8) return "中午少出门，戴帽并涂防晒";
  if (uvIndex < 11) return "不适合长时间在外晒";
  return "不适合外出暴晒";
}

module.exports = { clothingTip, outdoorAdvice };
