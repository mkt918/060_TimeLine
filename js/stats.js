/**
 * stats.js - 統計・分析モジュール
 * 移動データから統計情報を算出しUIに反映
 */

const TimelineStats = (() => {

  /**
   * 統計情報を計算
   */
  function calculate(data) {
    const { activities, places } = data;

    const totalDistance = activities.reduce((sum, a) => sum + (a.distance || 0), 0);
    const totalDuration = activities.reduce((sum, a) => sum + (a.durationMs || 0), 0);

    // 移動手段別の集計
    const byActivity = {};
    for (const act of activities) {
      const key = act.activityType || 'UNKNOWN';
      if (!byActivity[key]) {
        byActivity[key] = {
          label: act.label,
          color: act.color,
          count: 0,
          distance: 0,
          durationMs: 0,
        };
      }
      byActivity[key].count++;
      byActivity[key].distance += act.distance || 0;
      byActivity[key].durationMs += act.durationMs || 0;
    }

    // よく訪れた場所
    const placeCount = {};
    for (const p of places) {
      const name = p.name || '不明な場所';
      if (!placeCount[name]) {
        placeCount[name] = { name, count: 0, totalDurationMs: 0, lat: p.lat, lng: p.lng };
      }
      placeCount[name].count++;
      placeCount[name].totalDurationMs += p.durationMs || 0;
    }
    const topPlaces = Object.values(placeCount)
      .sort((a, b) => b.totalDurationMs - a.totalDurationMs)
      .slice(0, 10);

    // 日別の集計
    const byDate = {};
    for (const act of activities) {
      if (!act.startDate) continue;
      const key = formatDateKey(act.startDate);
      if (!byDate[key]) {
        byDate[key] = { date: key, distance: 0, durationMs: 0, count: 0 };
      }
      byDate[key].distance += act.distance || 0;
      byDate[key].durationMs += act.durationMs || 0;
      byDate[key].count++;
    }

    // 日付範囲
    const dates = activities
      .filter(a => a.startDate)
      .map(a => a.startDate);
    const minDate = dates.length > 0 ? new Date(Math.min(...dates.map(d => d.getTime()))) : null;
    const maxDate = dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : null;

    return {
      totalDistance,
      totalDuration,
      activityCount: activities.length,
      placeCount: places.length,
      byActivity,
      topPlaces,
      byDate,
      minDate,
      maxDate,
    };
  }

  /**
   * 統計パネルにデータを表示
   */
  function render(stats) {
    renderOverview(stats);
    renderActivityBreakdown(stats.byActivity);
    renderTopPlaces(stats.topPlaces);
  }

  /**
   * 概要統計を表示
   */
  function renderOverview(stats) {
    const el = document.getElementById('stats-overview');
    if (!el) return;

    const dateRange = stats.minDate && stats.maxDate
      ? `${formatDate(stats.minDate)} ～ ${formatDate(stats.maxDate)}`
      : 'データなし';

    el.innerHTML = `
      <div class="grid grid-cols-2 gap-3">
        <div class="stat-card">
          <div class="stat-value">${formatDistanceShort(stats.totalDistance)}</div>
          <div class="stat-label">総移動距離</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${formatDurationShort(stats.totalDuration)}</div>
          <div class="stat-label">総移動時間</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.activityCount.toLocaleString()}</div>
          <div class="stat-label">移動回数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.placeCount.toLocaleString()}</div>
          <div class="stat-label">訪問場所数</div>
        </div>
      </div>
      <div class="mt-3 text-xs text-gray-400 text-center">${dateRange}</div>
    `;
  }

  /**
   * 移動手段別内訳を表示
   */
  function renderActivityBreakdown(byActivity) {
    const el = document.getElementById('stats-activities');
    if (!el) return;

    const entries = Object.entries(byActivity)
      .sort(([, a], [, b]) => b.distance - a.distance);

    if (entries.length === 0) {
      el.innerHTML = '<div class="text-gray-400 text-sm">データがありません</div>';
      return;
    }

    const totalDist = entries.reduce((s, [, v]) => s + v.distance, 0);

    let html = '<div class="space-y-2">';

    // 棒グラフ風の内訳
    for (const [, val] of entries) {
      const pct = totalDist > 0 ? (val.distance / totalDist * 100) : 0;
      html += `
        <div class="activity-row">
          <div class="flex items-center justify-between mb-1">
            <span class="text-sm font-medium flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-full inline-block" style="background:${val.color}"></span>
              ${val.label}
            </span>
            <span class="text-xs text-gray-400">${formatDistanceShort(val.distance)}</span>
          </div>
          <div class="w-full bg-gray-200 rounded-full h-1.5">
            <div class="h-1.5 rounded-full transition-all duration-500" style="width:${Math.max(pct, 2)}%;background:${val.color}"></div>
          </div>
          <div class="flex justify-between text-xs text-gray-500 mt-0.5">
            <span>${val.count}回</span>
            <span>${formatDurationShort(val.durationMs)}</span>
          </div>
        </div>
      `;
    }

    html += '</div>';
    el.innerHTML = html;
  }

  /**
   * よく訪れた場所を表示
   */
  function renderTopPlaces(topPlaces) {
    const el = document.getElementById('stats-places');
    if (!el) return;

    if (topPlaces.length === 0) {
      el.innerHTML = '<div class="text-gray-400 text-sm">データがありません</div>';
      return;
    }

    let html = '<div class="space-y-1.5">';

    for (let i = 0; i < topPlaces.length; i++) {
      const p = topPlaces[i];
      html += `
        <div class="place-row flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50/5 transition cursor-pointer"
             onclick="TimelineMap.panTo(${p.lat}, ${p.lng})"
             title="${escapeAttr(p.name)}">
          <span class="text-xs font-bold text-gray-400 w-5">${i + 1}</span>
          <div class="flex-1 min-w-0">
            <div class="text-sm truncate font-medium text-gray-800">${escapeHtml(p.name)}</div>
            <div class="text-xs text-gray-500"><span class="font-bold text-blue-600">${formatDurationShort(p.totalDurationMs)}</span> · ${p.count}回訪問</div>
          </div>
        </div>
      `;
    }

    html += '</div>';
    el.innerHTML = html;
  }

  // --- ユーティリティ ---

  function formatDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function formatDate(date) {
    return date.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }

  function formatDistanceShort(m) {
    if (m >= 1000000) return `${Math.round(m / 1000).toLocaleString()} km`;
    if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
    return `${Math.round(m)} m`;
  }

  function formatDurationShort(ms) {
    const totalMin = Math.floor(ms / 60000);
    const hours = Math.floor(totalMin / 60);
    const min = totalMin % 60;
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const h = hours % 24;
      return `${days}日${h}時間`;
    }
    if (hours > 0) return `${hours}h ${min}m`;
    return `${min}m`;
  }

  // HTMLエスケープはUtils共通関数を使用
  const escapeHtml = Utils.escapeHtml;
  const escapeAttr = Utils.escapeAttr;

  return { calculate, render };
})();
