'use strict';

function normalizeUsageBucket(bucket) {
  if (!bucket || typeof bucket !== 'object') {
    return null;
  }

  return {
    utilization: typeof bucket.utilization === 'number' ? bucket.utilization : 0,
    resetsAt: bucket.resets_at || null
  };
}

function normalizeUsagePayload(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};

  return {
    fiveHour: normalizeUsageBucket(data.five_hour),
    sevenDay: normalizeUsageBucket(data.seven_day),
    authState: 'connected',
    fetchedAt: new Date().toISOString()
  };
}

module.exports = {
  normalizeUsageBucket,
  normalizeUsagePayload
};
