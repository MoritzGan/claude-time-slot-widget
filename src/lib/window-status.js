'use strict';

const DEFAULT_WINDOW_RULES = [
  {
    id: 'peak-hours-default',
    label: 'Peak',
    color: '#ff6b6b',
    timezone: 'America/Los_Angeles',
    startTime: '05:00',
    endTime: '11:00',
    weekdays: [1, 2, 3, 4, 5],
    priority: 1,
    enabled: true
  }
];

const DEFAULT_OFF_PEAK = {
  label: 'Off-Peak',
  color: '#30d0a5'
};

function parseTimeString(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) {
    throw new Error(`Invalid time string: ${value}`);
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new Error(`Invalid time string: ${value}`);
  }

  return { hour, minute, totalMinutes: hour * 60 + minute };
}

function getFormatter(timeZone, options = {}) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    ...options
  });
}

function getZonedParts(date, timeZone) {
  const formatter = getFormatter(timeZone);
  const parts = formatter.formatToParts(date);
  const data = {};

  for (const part of parts) {
    if (part.type !== 'literal') {
      data[part.type] = part.value;
    }
  }

  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };

  return {
    year: Number(data.year),
    month: Number(data.month),
    day: Number(data.day),
    hour: Number(data.hour),
    minute: Number(data.minute),
    second: Number(data.second),
    weekday: weekdayMap[data.weekday],
    timeZoneName: new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'short'
    }).formatToParts(date).find((part) => part.type === 'timeZoneName')?.value || timeZone
  };
}

function makeUtcFromLocal(localParts) {
  return Date.UTC(
    localParts.year,
    localParts.month - 1,
    localParts.day,
    localParts.hour || 0,
    localParts.minute || 0,
    localParts.second || 0
  );
}

function getTimeZoneOffset(date, timeZone) {
  const zoned = getZonedParts(date, timeZone);
  return makeUtcFromLocal(zoned) - date.getTime();
}

function zonedTimeToUtc(localParts, timeZone) {
  const localTimestamp = makeUtcFromLocal(localParts);
  let guess = new Date(localTimestamp);

  for (let index = 0; index < 3; index += 1) {
    const offset = getTimeZoneOffset(guess, timeZone);
    const nextGuess = new Date(localTimestamp - offset);
    if (nextGuess.getTime() === guess.getTime()) {
      return nextGuess;
    }
    guess = nextGuess;
  }

  return guess;
}

function normalizeRule(rule, index = 0) {
  const start = parseTimeString(rule.startTime);
  const end = parseTimeString(rule.endTime);
  const weekdays = Array.isArray(rule.weekdays)
    ? Array.from(new Set(rule.weekdays.map(Number))).sort((left, right) => left - right)
    : [];

  return {
    id: rule.id || `rule-${index + 1}`,
    label: String(rule.label || 'Peak'),
    color: String(rule.color || '#ff6b6b'),
    timezone: String(rule.timezone || 'America/Los_Angeles'),
    weekdays,
    enabled: rule.enabled !== false,
    priority: Number.isFinite(rule.priority) ? rule.priority : 0,
    startTime: rule.startTime,
    endTime: rule.endTime,
    startMinutes: start.totalMinutes,
    endMinutes: end.totalMinutes
  };
}

function isRuleActiveAt(date, rule) {
  if (!rule.enabled || !rule.weekdays.length) {
    return false;
  }

  const local = getZonedParts(date, rule.timezone);
  const currentMinutes = local.hour * 60 + local.minute;
  const isOvernight = rule.startMinutes >= rule.endMinutes;

  if (!isOvernight) {
    return (
      rule.weekdays.includes(local.weekday) &&
      currentMinutes >= rule.startMinutes &&
      currentMinutes < rule.endMinutes
    );
  }

  const currentDayActive = rule.weekdays.includes(local.weekday) && currentMinutes >= rule.startMinutes;
  const previousWeekday = (local.weekday + 6) % 7;
  const previousDayCarry = rule.weekdays.includes(previousWeekday) && currentMinutes < rule.endMinutes;
  return currentDayActive || previousDayCarry;
}

function addUtcDays(year, month, day, dayOffset) {
  const utc = new Date(Date.UTC(year, month - 1, day + dayOffset));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate()
  };
}

function collectTransitions(rule, referenceDate) {
  const transitions = [];
  const base = getZonedParts(referenceDate, rule.timezone);
  const isOvernight = rule.startMinutes >= rule.endMinutes;

  for (let offset = 0; offset < 10; offset += 1) {
    const localDate = addUtcDays(base.year, base.month, base.day, offset);
    const weekday = new Date(Date.UTC(localDate.year, localDate.month - 1, localDate.day)).getUTCDay();

    if (rule.weekdays.includes(weekday)) {
      transitions.push({
        at: zonedTimeToUtc(
          {
            ...localDate,
            hour: Math.floor(rule.startMinutes / 60),
            minute: rule.startMinutes % 60,
            second: 0
          },
          rule.timezone
        ),
        nextState: rule.label
      });

      const endDay = isOvernight ? addUtcDays(localDate.year, localDate.month, localDate.day, 1) : localDate;
      transitions.push({
        at: zonedTimeToUtc(
          {
            ...endDay,
            hour: Math.floor(rule.endMinutes / 60),
            minute: rule.endMinutes % 60,
            second: 0
          },
          rule.timezone
        ),
        nextState: null
      });
    }
  }

  return transitions;
}

function formatClock(date, timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function getWeekdayLabel(weekdays) {
  const canonical = weekdays.join(',');
  if (canonical === '1,2,3,4,5') {
    return 'Mon-Fri';
  }

  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return weekdays.map((value) => names[value]).join(', ');
}

function describeWindowRule(rule, systemTimeZone, date = new Date()) {
  const normalizedRule = rule.startMinutes === undefined ? normalizeRule(rule) : rule;
  const currentLocal = getZonedParts(date, normalizedRule.timezone);
  const todayUtc = zonedTimeToUtc(
    {
      year: currentLocal.year,
      month: currentLocal.month,
      day: currentLocal.day,
      hour: Math.floor(normalizedRule.startMinutes / 60),
      minute: normalizedRule.startMinutes % 60,
      second: 0
    },
    normalizedRule.timezone
  );
  const endUtc = zonedTimeToUtc(
    {
      year: currentLocal.year,
      month: currentLocal.month,
      day: currentLocal.day,
      hour: Math.floor(normalizedRule.endMinutes / 60),
      minute: normalizedRule.endMinutes % 60,
      second: 0
    },
    normalizedRule.timezone
  );

  return {
    canonical: `${getWeekdayLabel(normalizedRule.weekdays)} ${normalizedRule.startTime}-${normalizedRule.endTime} ${getZonedParts(date, normalizedRule.timezone).timeZoneName}`,
    local: `${getWeekdayLabel(normalizedRule.weekdays)} ${formatClock(todayUtc, systemTimeZone)}-${formatClock(endUtc, systemTimeZone)} ${getZonedParts(date, systemTimeZone).timeZoneName}`
  };
}

function getWindowStatus({
  date = new Date(),
  rules = DEFAULT_WINDOW_RULES,
  systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
} = {}) {
  const normalizedRules = (rules || [])
    .map((rule, index) => normalizeRule(rule, index))
    .filter((rule) => rule.enabled)
    .sort((left, right) => right.priority - left.priority);

  const activeRule = normalizedRules.find((rule) => isRuleActiveAt(date, rule)) || null;
  const activeTransitions = normalizedRules.flatMap((rule) => collectTransitions(rule, date));
  const nextTransition = activeTransitions
    .filter((transition) => transition.at.getTime() > date.getTime())
    .sort((left, right) => left.at - right.at)[0] || null;

  const primaryRule = activeRule || normalizedRules[0] || normalizeRule(DEFAULT_WINDOW_RULES[0]);
  const ruleDescription = describeWindowRule(primaryRule, systemTimeZone, date);

  return {
    state: activeRule ? activeRule.label : DEFAULT_OFF_PEAK.label,
    color: activeRule ? activeRule.color : DEFAULT_OFF_PEAK.color,
    isPeak: Boolean(activeRule),
    nextChangeAt: nextTransition ? nextTransition.at.toISOString() : null,
    countdownMs: nextTransition ? Math.max(0, nextTransition.at.getTime() - date.getTime()) : null,
    canonicalTimezone: primaryRule.timezone,
    canonicalRange: ruleDescription.canonical,
    localDisplayRange: ruleDescription.local,
    ruleId: activeRule ? activeRule.id : null
  };
}

module.exports = {
  DEFAULT_OFF_PEAK,
  DEFAULT_WINDOW_RULES,
  describeWindowRule,
  getWindowStatus,
  getZonedParts,
  isRuleActiveAt,
  normalizeRule,
  parseTimeString,
  zonedTimeToUtc
};
