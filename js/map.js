/**
 * map.js - Leaflet地図制御モジュール
 * 移動ルートと滞在場所を地図上に表示
 */

const TimelineMap = (() => {
  let map = null;
  let routeLayers = null;
  let placeLayers = null;
  let allBounds = null;

  /**
   * 地図を初期化
   */
  function init(containerId) {
    map = L.map(containerId, {
      center: [35.6812, 139.7671], // 東京駅デフォルト
      zoom: 12,
      zoomControl: true,
    });

    // OpenStreetMapタイル
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    routeLayers = L.layerGroup().addTo(map);
    placeLayers = L.layerGroup().addTo(map);

    return map;
  }

  /**
   * すべてのレイヤーをクリア
   */
  function clear() {
    routeLayers.clearLayers();
    placeLayers.clearLayers();
    allBounds = null;
  }

  /**
   * 移動ルートを描画
   */
  function drawActivities(activities) {
    for (const act of activities) {
      const points = buildRoutePoints(act);
      if (points.length < 2) continue;

      // ポリライン描画
      const polyline = L.polyline(points, {
        color: act.color,
        weight: 3,
        opacity: 0.8,
        smoothFactor: 1,
      });

      // ポップアップ
      const startStr = act.startDate ? formatDateTime(act.startDate) : '不明';
      const endStr = act.endDate ? formatDateTime(act.endDate) : '不明';
      const distStr = act.distance > 0 ? formatDistance(act.distance) : '不明';
      const durStr = act.durationMs > 0 ? formatDuration(act.durationMs) : '不明';

      polyline.bindPopup(`
        <div class="popup-content">
          <div class="font-bold text-sm mb-1">${act.label}</div>
          <div class="text-xs text-gray-600">
            <div>📅 ${startStr}</div>
            <div>→ ${endStr}</div>
            <div>📏 距離: ${distStr}</div>
            <div>⏱ 時間: ${durStr}</div>
          </div>
        </div>
      `);

      routeLayers.addLayer(polyline);

      // 境界を更新
      expandBounds(points);
    }
  }

  /**
   * 滞在場所をマーカーで表示
   */
  function drawPlaces(places) {
    for (const place of places) {
      if (place.lat === null || place.lng === null) continue;

      // カスタムアイコン作成
      const icon = L.divIcon({
        className: 'custom-marker',
        html: `<div class="marker-pin"></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 24],
        popupAnchor: [0, -24],
      });

      const marker = L.marker([place.lat, place.lng], { icon });

      const startStr = place.startDate ? formatDateTime(place.startDate) : '不明';
      const durStr = place.durationMs > 0 ? formatDuration(place.durationMs) : '不明';

      marker.bindPopup(`
        <div class="popup-content">
          <div class="font-bold text-sm mb-1">📍 ${escapeHtml(place.name)}</div>
          <div class="text-xs text-gray-600">
            ${place.address ? `<div>🏠 ${escapeHtml(place.address)}</div>` : ''}
            <div>📅 ${startStr}</div>
            <div>⏱ 滞在: ${durStr}</div>
            ${place.semanticType ? `<div>🏷 ${escapeHtml(place.semanticType)}</div>` : ''}
          </div>
        </div>
      `);

      placeLayers.addLayer(marker);

      expandBounds([[place.lat, place.lng]]);
    }
  }

  /**
   * データ全体にフィット
   */
  function fitToData() {
    if (allBounds && allBounds.isValid()) {
      map.fitBounds(allBounds, { padding: [30, 30] });
    }
  }

  /**
   * ルートポイントを構築
   */
  function buildRoutePoints(activity) {
    const points = [];

    if (activity.startLat !== null && activity.startLng !== null) {
      points.push([activity.startLat, activity.startLng]);
    }

    if (activity.waypoints && activity.waypoints.length > 0) {
      for (const wp of activity.waypoints) {
        if (wp.lat !== null && wp.lng !== null) {
          points.push([wp.lat, wp.lng]);
        }
      }
    }

    if (activity.endLat !== null && activity.endLng !== null) {
      points.push([activity.endLat, activity.endLng]);
    }

    return points;
  }

  /**
   * 境界を拡張
   */
  function expandBounds(points) {
    if (!allBounds) {
      allBounds = L.latLngBounds(points);
    } else {
      allBounds.extend(points);
    }
  }

  /**
   * ユーティリティ: 日時フォーマット
   */
  function formatDateTime(date) {
    if (!date) return '';
    return date.toLocaleString('ja-JP', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  }

  /**
   * ユーティリティ: 距離フォーマット
   */
  function formatDistance(meters) {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(1)} km`;
    }
    return `${Math.round(meters)} m`;
  }

  /**
   * ユーティリティ: 時間フォーマット
   */
  function formatDuration(ms) {
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) {
      return `${hours}時間${minutes}分`;
    }
    return `${minutes}分`;
  }

  // HTMLエスケープはUtils.escapeHtmlを使用
  const escapeHtml = Utils.escapeHtml;

  /**
   * 指定座標にズームして移動
   */
  function panTo(lat, lng, zoom = 16) {
    if (map) {
      map.setView([lat, lng], zoom);
    }
  }

  // 公開API
  return {
    init,
    clear,
    drawActivities,
    drawPlaces,
    fitToData,
    panTo,
    formatDistance,
    formatDuration,
    formatDateTime,
  };
})();
