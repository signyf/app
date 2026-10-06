const { Solar, HolidayUtil, I18n } = require("lunar-javascript");

I18n.setLanguage("chs");

function asList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item);
}

function unique(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

function getAlmanac(year, month, day) {
  const solar = Solar.fromYmd(year, month, day);
  const lunar = solar.getLunar();
  const reminders = [
    ...asList(lunar.getFestivals()),
    ...asList(lunar.getOtherFestivals()),
  ];

  const holiday = HolidayUtil.getHoliday(year, month, day);
  if (holiday) {
    const name = holiday.getName();
    reminders.push(holiday.isWork() ? `${name}（调休上班）` : name);
  }

  return {
    gregorian: `${year}年${month}月${day}日 星期${solar.getWeekInChinese()}`,
    lunar: `${lunar.getYearInChinese()}年${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
    yi: asList(lunar.getDayYi()),
    ji: asList(lunar.getDayJi()),
    festivals: unique(reminders),
  };
}

function formatActivities(items) {
  if (!items || !items.length) return "无";
  return items.join("、");
}

module.exports = {
  formatActivities,
  getAlmanac,
};
