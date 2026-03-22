/**
 * parser.js - Google Timeline JSONパーサー
 * 旧形式（Semantic Location History）と新形式（Timeline.json）に対応
 */

const TimelineParser = (() => {

  /**
   * JSONフォーマットを自動判別してパースする
   * @param {Object|Array} jsonData - パース済みJSONデータ
   * @returns {{ activities: Array, places: Array, format: string }}
   */
  function parse(jsonData) {
    const format = detectFormat(jsonData);
    switch (format) {
      case 'semantic':
        return { ...parseSemantic(jsonData), format: 'semantic' };
      case 'timeline':
        return { ...parseTimeline(jsonData), format: 'timeline' };
      case 'geo-array':
        return { ...parseGeoArray(jsonData), format: 'geo-array' };
      case 'records':
        return { ...parseRecords(jsonData), format: 'records' };
      default:
        throw new Error('未対応のJSONフォーマットです。Google Takeout または デバイスエクスポートのファイルを使用してください。');
    }
  }

  /**
   * フォーマット判別
   */
  function detectFormat(data) {
    // 旧形式: Semantic Location History（timelineObjects配列）
    if (data.timelineObjects && Array.isArray(data.timelineObjects)) {
      return 'semantic';
    }
    // 新形式: デバイスエクスポート（semanticSegmentsやrawSignals など）
    if (data.semanticSegments || data.rawSignals || data.userLocationProfile) {
      return 'timeline';
    }
    // Records.json（locations配列）
    if (data.locations && Array.isArray(data.locations)) {
      return 'records';
    }
    // 新形式（配列かつ geo: 文字列を含む形式）
    if (Array.isArray(data) && data.length > 0) {
      const first = data[0];
      if (first.startTime && first.endTime && (first.activity || first.visit)) {
        return 'geo-array';
      }
    }
    // 配列形式の場合（複数ファイルマージ済み）
    if (Array.isArray(data)) {
      if (data.length > 0 && (data[0].activitySegment || data[0].placeVisit)) {
        return 'semantic';
      }
    }
    return 'unknown';
  }

  /**
   * latitudeE7 → 通常の緯度に変換
   */
  function e7ToCoord(e7Value) {
    if (e7Value === undefined || e7Value === null) return null;
    return e7Value / 1e7;
  }

  /**
   * 移動手段の日本語ラベル
   */
  function getActivityLabel(type) {
    const labels = {
      'WALKING': '徒歩',
      'ON_FOOT': '徒歩',
      'RUNNING': 'ランニング',
      'IN_PASSENGER_VEHICLE': '車',
      'IN_VEHICLE': '車',
      'DRIVING': '車',
      'IN_BUS': 'バス',
      'IN_TRAIN': '電車',
      'IN_SUBWAY': '地下鉄',
      'IN_TRAM': '路面電車',
      'CYCLING': '自転車',
      'FLYING': '飛行機',
      'SAILING': '船',
      'SKIING': 'スキー',
      'STILL': '静止',
      'UNKNOWN_ACTIVITY_TYPE': '不明',
      'MOTORCYCLING': 'バイク',
    };
    return labels[type] || type || '不明';
  }

  /**
   * 移動手段に対応する色
   */
  function getActivityColor(type) {
    const colors = {
      'WALKING': '#10b981',
      'ON_FOOT': '#10b981',
      'RUNNING': '#f59e0b',
      'IN_PASSENGER_VEHICLE': '#3b82f6',
      'IN_VEHICLE': '#3b82f6',
      'DRIVING': '#3b82f6',
      'IN_BUS': '#6366f1',
      'IN_TRAIN': '#8b5cf6',
      'IN_SUBWAY': '#7c3aed',
      'IN_TRAM': '#a855f7',
      'CYCLING': '#f97316',
      'FLYING': '#ef4444',
      'SAILING': '#06b6d4',
      'MOTORCYCLING': '#ec4899',
    };
    return colors[type] || '#6b7280';
  }

  /**
   * 旧形式（Semantic Location History）をパース
   */
  function parseSemantic(data) {
    const activities = [];
    const places = [];

    const objects = data.timelineObjects || data;
    if (!Array.isArray(objects)) return { activities, places };

    for (const obj of objects) {
      // 移動区間
      if (obj.activitySegment) {
        const seg = obj.activitySegment;
        const activity = {
          type: 'activity',
          activityType: seg.activityType || 'UNKNOWN_ACTIVITY_TYPE',
          label: getActivityLabel(seg.activityType),
          color: getActivityColor(seg.activityType),
          startTime: seg.duration?.startTimestamp || seg.duration?.startTimestampMs,
          endTime: seg.duration?.endTimestamp || seg.duration?.endTimestampMs,
          startLat: e7ToCoord(seg.startLocation?.latitudeE7),
          startLng: e7ToCoord(seg.startLocation?.longitudeE7),
          endLat: e7ToCoord(seg.endLocation?.latitudeE7),
          endLng: e7ToCoord(seg.endLocation?.longitudeE7),
          distance: seg.distance || 0,
          confidence: seg.confidence,
          waypoints: [],
        };

        // ウェイポイント
        if (seg.waypointPath?.waypoints) {
          activity.waypoints = seg.waypointPath.waypoints.map(wp => ({
            lat: e7ToCoord(wp.latE7),
            lng: e7ToCoord(wp.lngE7),
          })).filter(wp => wp.lat !== null && wp.lng !== null);
        }

        // simplifiedRawPath（waypointPathが無い場合のみ使用）
        if (seg.simplifiedRawPath?.points && activity.waypoints.length === 0) {
          activity.waypoints = seg.simplifiedRawPath.points.map(pt => ({
            lat: e7ToCoord(pt.latE7),
            lng: e7ToCoord(pt.lngE7),
            timestamp: pt.timestamp || pt.timestampMs,
          })).filter(pt => pt.lat !== null && pt.lng !== null);
        }

        // 時刻の正規化
        activity.startDate = normalizeTimestamp(activity.startTime);
        activity.endDate = normalizeTimestamp(activity.endTime);
        activity.durationMs = activity.endDate && activity.startDate
          ? activity.endDate.getTime() - activity.startDate.getTime()
          : 0;

        if (activity.startLat !== null && activity.startLng !== null) {
          activities.push(activity);
        }
      }

      // 滞在場所
      if (obj.placeVisit) {
        const visit = obj.placeVisit;
        const loc = visit.location || {};
        const place = {
          type: 'place',
          name: loc.name || loc.address || getActivityLabel(seg.activityType) || '不明な移動',
          placeId: loc.placeId || '',
          address: loc.address || '',
          lat: e7ToCoord(loc.latitudeE7),
          lng: e7ToCoord(loc.longitudeE7),
          startTime: visit.duration?.startTimestamp || visit.duration?.startTimestampMs,
          endTime: visit.duration?.endTimestamp || visit.duration?.endTimestampMs,
          placeConfidence: visit.placeConfidence,
          semanticType: loc.semanticType || '',
          sourceInfo: loc.sourceInfo?.deviceTag || '',
        };

        place.startDate = normalizeTimestamp(place.startTime);
        place.endDate = normalizeTimestamp(place.endTime);
        place.durationMs = place.endDate && place.startDate
          ? place.endDate.getTime() - place.startDate.getTime()
          : 0;

        if (place.lat !== null && place.lng !== null) {
          places.push(place);
        }
      }
    }

    return { activities, places };
  }

  /**
   * 新形式（Timeline.json）をパース
   */
  function parseTimeline(data) {
    const activities = [];
    const places = [];

    // semanticSegments があれば処理
    if (data.semanticSegments && Array.isArray(data.semanticSegments)) {
      for (const seg of data.semanticSegments) {
        // 移動区間（activity）
        if (seg.activity) {
          const act = seg.activity;
          const activity = {
            type: 'activity',
            activityType: act.topCandidate?.type || 'UNKNOWN_ACTIVITY_TYPE',
            label: getActivityLabel(act.topCandidate?.type),
            color: getActivityColor(act.topCandidate?.type),
            startTime: seg.startTime,
            endTime: seg.endTime,
            startLat: null,
            startLng: null,
            endLat: null,
            endLng: null,
            distance: act.distanceMeters || 0,
            waypoints: [],
          };

          // start/end ポイント
          if (seg.startLocation) {
            activity.startLat = seg.startLocation.latLng?.latitude ?? e7ToCoord(seg.startLocation.latitudeE7);
            activity.startLng = seg.startLocation.latLng?.longitude ?? e7ToCoord(seg.startLocation.longitudeE7);
          }
          if (seg.endLocation) {
            activity.endLat = seg.endLocation.latLng?.latitude ?? e7ToCoord(seg.endLocation.latitudeE7);
            activity.endLng = seg.endLocation.latLng?.longitude ?? e7ToCoord(seg.endLocation.longitudeE7);
          }

          // ウェイポイント
          if (act.waypointPath?.waypoints) {
            activity.waypoints = act.waypointPath.waypoints.map(wp => ({
              lat: wp.latLng?.latitude ?? e7ToCoord(wp.latE7),
              lng: wp.latLng?.longitude ?? e7ToCoord(wp.lngE7),
            })).filter(wp => wp.lat !== null && wp.lng !== null);
          }

          activity.startDate = normalizeTimestamp(activity.startTime);
          activity.endDate = normalizeTimestamp(activity.endTime);
          activity.durationMs = activity.endDate && activity.startDate
            ? activity.endDate.getTime() - activity.startDate.getTime()
            : 0;

          if (activity.startLat !== null || activity.endLat !== null) {
            activities.push(activity);
          }
        }

        // 滞在場所（visit）
        if (seg.visit) {
          const v = seg.visit;
          const place = {
            type: 'place',
            name: v.topCandidate?.placeLocation?.name || getActivityLabel(v.topCandidate?.type) || v.topCandidate?.semanticType || '不明な場所',
            placeId: v.topCandidate?.placeId || '',
            address: v.topCandidate?.placeLocation?.address || '',
            lat: v.topCandidate?.placeLocation?.latLng?.latitude ?? null,
            lng: v.topCandidate?.placeLocation?.latLng?.longitude ?? null,
            startTime: seg.startTime,
            endTime: seg.endTime,
            semanticType: v.topCandidate?.semanticType || '',
          };

          place.startDate = normalizeTimestamp(place.startTime);
          place.endDate = normalizeTimestamp(place.endTime);
          place.durationMs = place.endDate && place.startDate
            ? place.endDate.getTime() - place.startDate.getTime()
            : 0;

          if (place.lat !== null && place.lng !== null) {
            places.push(place);
          }
        }
      }
    }

    return { activities, places };
  }

  /**
   * 新形式（配列かつ geo:lat,lng 文字列を含む形式）をパース
   */
  function parseGeoArray(data) {
    const activities = [];
    const places = [];

    if (!Array.isArray(data)) return { activities, places };

    for (const obj of data) {
      const startTime = obj.startTime;
      const endTime = obj.endTime;

      // 移動区間
      if (obj.activity) {
        const act = obj.activity;
        const startCoords = parseGeoString(act.start);
        const endCoords = parseGeoString(act.end);
        
        const activity = {
          type: 'activity',
          activityType: act.topCandidate?.type?.toUpperCase().replace(/ /g, '_') || 'UNKNOWN_ACTIVITY_TYPE',
          label: getActivityLabel(act.topCandidate?.type?.toUpperCase().replace(/ /g, '_')),
          color: getActivityColor(act.topCandidate?.type?.toUpperCase().replace(/ /g, '_')),
          startTime: startTime,
          endTime: endTime,
          startLat: startCoords ? startCoords.lat : null,
          startLng: startCoords ? startCoords.lng : null,
          endLat: endCoords ? endCoords.lat : null,
          endLng: endCoords ? endCoords.lng : null,
          distance: parseFloat(act.distanceMeters) || 0,
          waypoints: [],
        };

        activity.startDate = normalizeTimestamp(activity.startTime);
        activity.endDate = normalizeTimestamp(activity.endTime);
        activity.durationMs = activity.endDate && activity.startDate
          ? activity.endDate.getTime() - activity.startDate.getTime()
          : 0;

        if (activity.startLat !== null || activity.endLat !== null) {
          activities.push(activity);
        }
      }

      // 滞在場所
      if (obj.visit) {
        const v = obj.visit;
        const coords = parseGeoString(v.topCandidate?.placeLocation);
        const place = {
          type: 'place',
          name: v.topCandidate?.placeLocation?.name || v.topCandidate?.semanticType || (v.topCandidate?.placeID ? `場所(${v.topCandidate.placeID.substring(0,6)})` : '不明な場所'),
          placeId: v.topCandidate?.placeID || '',
          address: '', // この形式にはアドレスがない場合が多い
          lat: coords ? coords.lat : null,
          lng: coords ? coords.lng : null,
          startTime: startTime,
          endTime: endTime,
          placeConfidence: v.probability,
          semanticType: v.topCandidate?.semanticType || '',
        };

        place.startDate = normalizeTimestamp(place.startTime);
        place.endDate = normalizeTimestamp(place.endTime);
        place.durationMs = place.endDate && place.startDate
          ? place.endDate.getTime() - place.startDate.getTime()
          : 0;

        if (place.lat !== null && place.lng !== null) {
          places.push(place);
        }
      }
    }

    return { activities, places };
  }

  /**
   * "geo:lat,lng" 文字列をパース
   */
  function parseGeoString(geoStr) {
    if (!geoStr || typeof geoStr !== 'string') return null;
    const match = geoStr.match(/geo:(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (match) {
      return {
        lat: parseFloat(match[1]),
        lng: parseFloat(match[2])
      };
    }
    return null;
  }

  /**
   * Records.json をパース（生の位置データ）
   */
  function parseRecords(data) {
    const activities = [];
    const places = [];

    if (!data.locations || !Array.isArray(data.locations)) {
      return { activities, places };
    }

    // Records.jsonは生のGPSポイント群なので、移動パスとして表示
    const points = data.locations
      .map(loc => ({
        lat: e7ToCoord(loc.latitudeE7) ?? loc.geo?.latitude,
        lng: e7ToCoord(loc.longitudeE7) ?? loc.geo?.longitude,
        timestamp: loc.timestamp || loc.timestampMs,
        accuracy: loc.accuracy,
      }))
      .filter(p => p.lat !== null && p.lng !== null);

    // タイムスタンプを事前変換してからソート（毎回Date生成を避ける）
    for (const pt of points) {
      pt._sortTime = normalizeTimestamp(pt.timestamp)?.getTime() || 0;
    }
    points.sort((a, b) => a._sortTime - b._sortTime);

    if (points.length > 1) {
      // 全体を一つの移動経路として扱う（日ごとに分割）
      let dayGroups = {};
      for (const pt of points) {
        const d = normalizeTimestamp(pt.timestamp);
        if (!d) continue;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (!dayGroups[key]) dayGroups[key] = [];
        dayGroups[key].push(pt);
      }

      for (const [dayKey, dayPoints] of Object.entries(dayGroups)) {
        if (dayPoints.length < 2) continue;
        const firstDate = normalizeTimestamp(dayPoints[0].timestamp);
        const lastDate = normalizeTimestamp(dayPoints[dayPoints.length - 1].timestamp);
        activities.push({
          type: 'activity',
          activityType: 'UNKNOWN_ACTIVITY_TYPE',
          label: '移動記録',
          color: '#6b7280',
          startTime: dayPoints[0].timestamp,
          endTime: dayPoints[dayPoints.length - 1].timestamp,
          startLat: dayPoints[0].lat,
          startLng: dayPoints[0].lng,
          endLat: dayPoints[dayPoints.length - 1].lat,
          endLng: dayPoints[dayPoints.length - 1].lng,
          distance: calcTotalDistance(dayPoints),
          waypoints: dayPoints.map(p => ({ lat: p.lat, lng: p.lng })),
          startDate: firstDate,
          endDate: lastDate,
          durationMs: lastDate && firstDate ? lastDate.getTime() - firstDate.getTime() : 0,
        });
      }
    }

    return { activities, places };
  }

  /**
   * ハーベルサイン公式で2点間の距離(m)を計算
   */
  function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // 地球の半径(m)
    const toRad = (deg) => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * ポイント配列の総距離(m)を計算
   */
  function calcTotalDistance(points) {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += haversineDistance(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
    }
    return total;
  }

  /**
   * タイムスタンプの正規化
   */
  function normalizeTimestamp(ts) {
    if (!ts) return null;
    // ISO 8601 文字列
    if (typeof ts === 'string') {
      const d = new Date(ts);
      return isNaN(d.getTime()) ? null : d;
    }
    // ミリ秒（数値）
    if (typeof ts === 'number') {
      // 13桁ならミリ秒、10桁なら秒
      if (ts > 1e12) return new Date(ts);
      return new Date(ts * 1000);
    }
    return null;
  }

  /**
   * 複数ファイルの結果をマージ
   */
  function mergeResults(resultsArray) {
    const merged = { activities: [], places: [], format: 'merged' };
    for (const result of resultsArray) {
      merged.activities.push(...result.activities);
      merged.places.push(...result.places);
    }
    // 時間順にソート
    merged.activities.sort((a, b) => (a.startDate?.getTime() || 0) - (b.startDate?.getTime() || 0));
    merged.places.sort((a, b) => (a.startDate?.getTime() || 0) - (b.startDate?.getTime() || 0));
    return merged;
  }

  // 公開API
  return {
    parse,
    mergeResults,
    getActivityLabel,
    getActivityColor,
    detectFormat,
    haversineDistance,
  };
})();
