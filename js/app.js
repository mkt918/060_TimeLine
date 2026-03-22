/**
 * app.js - メインアプリケーションロジック
 * ファイルインポート、パーサー→地図・統計への連携制御
 */

const App = (() => {
  let currentData = null;
  let currentStats = null;
  let originalDateRange = { min: null, max: null }; // 全データの日付範囲を保持
  let dateFilter = { start: null, end: null };
  let durationThreshold = 5; // 滞在時間の閾値（分）
  let excludeHomeWork = true; // 自宅・仕事(タグ)を除外するか
  let exclusionPoints = []; // 座標ベースの除外地点 [{lat, lng, radius}]

  /**
   * アプリ初期化
   */
  function init() {
    // 地図初期化
    TimelineMap.init('map');

    // イベントリスナー設定
    setupFileInput();
    setupDragDrop();
    setupDateFilter();

    console.log('✅ Timeline Analyzer 初期化完了');
  }

  /**
   * ファイル入力の設定
   */
  function setupFileInput() {
    const fileInput = document.getElementById('file-input');
    const importBtn = document.getElementById('import-btn');

    if (importBtn) {
      importBtn.addEventListener('click', () => fileInput?.click());
    }

    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
      });
    }
  }

  /**
   * ドラッグ&ドロップの設定
   */
  function setupDragDrop() {
    const dropZone = document.getElementById('drop-zone');
    if (!dropZone) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    dropZone.addEventListener('dragenter', () => dropZone.classList.add('drag-over'));
    dropZone.addEventListener('dragover', () => dropZone.classList.add('drag-over'));
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
      dropZone.classList.remove('drag-over');
      handleFiles(e.dataTransfer.files);
    });
  }

  /**
   * 日付フィルターの設定
   */
  function setupDateFilter() {
    const startInput = document.getElementById('filter-start');
    const endInput = document.getElementById('filter-end');
    const filterBtn = document.getElementById('filter-apply');
    const resetBtn = document.getElementById('filter-reset');

    if (filterBtn) {
      filterBtn.addEventListener('click', () => {
        const startInput = document.getElementById('filter-start');
        const endInput = document.getElementById('filter-end');
        const durInput = document.getElementById('filter-duration');
        const hwInput = document.getElementById('exclude-home-work');

        dateFilter.start = startInput?.value ? new Date(startInput.value + 'T00:00:00') : null;
        dateFilter.end = endInput?.value ? new Date(endInput.value + 'T23:59:59') : null;
        durationThreshold = parseInt(durInput?.value || '0');
        excludeHomeWork = hwInput?.checked || false;

        // 座標ベースの除外地点を更新
        exclusionPoints = [];
        const homeCoords = parseCoordsInput(document.getElementById('home-coords')?.value);
        const workCoords = parseCoordsInput(document.getElementById('work-coords')?.value);
        if (homeCoords) exclusionPoints.push({ ...homeCoords, radius: 500 });
        if (workCoords) exclusionPoints.push({ ...workCoords, radius: 500 });

        applyFilter();
      });
    }

    function parseCoordsInput(val) {
      if (!val) return null;
      const parts = val.split(/[,\s]+/).map(p => parseFloat(p.trim()));
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return { lat: parts[0], lng: parts[1] };
      }
      return null;
    }

    const durInput = document.getElementById('filter-duration');
    const durValueDisplay = document.getElementById('duration-value');
    if (durInput && durValueDisplay) {
      durInput.addEventListener('input', (e) => {
        durValueDisplay.textContent = `${e.target.value}分〜`;
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (startInput) startInput.value = '';
        if (endInput) endInput.value = '';
        dateFilter = { start: null, end: null };
        applyFilter();
      });
    }
  }

  /**
   * ファイル群を処理
   */
  async function handleFiles(fileList) {
    if (!fileList || fileList.length === 0) return;

    showLoading(true);
    hideWelcome();

    try {
      const results = [];
      const fileNames = [];

      for (const file of fileList) {
        if (!file.name.endsWith('.json')) {
          console.warn(`⚠️ スキップ: ${file.name}（JSON以外）`);
          continue;
        }
        fileNames.push(file.name);
        const text = await readFile(file);
        // UIスレッドにレンダリングの隙を与える
        const json = await new Promise((resolve, reject) => {
          setTimeout(() => {
            try { resolve(JSON.parse(text)); }
            catch (e) { reject(e); }
          }, 0);
        });
        const result = await new Promise((resolve) => {
          setTimeout(() => resolve(TimelineParser.parse(json)), 0);
        });
        results.push(result);
        console.log(`📄 ${file.name}: ${result.activities.length}件の移動, ${result.places.length}件の場所 (${result.format})`);
      }

      if (results.length === 0) {
        showError('JSONファイルが見つかりませんでした。');
        showLoading(false);
        return;
      }

      // 結果をマージ
      currentData = results.length === 1 ? results[0] : TimelineParser.mergeResults(results);

      // ファイル情報表示
      updateFileInfo(fileNames, currentData);

      // 表示を更新
      renderData(currentData);

      showLoading(false);
      showSuccess(`${fileNames.length}個のファイルを読み込みました（移動: ${currentData.activities.length}件, 場所: ${currentData.places.length}件）`);

    } catch (err) {
      console.error('❌ ファイル読み込みエラー:', err);
      showError(`ファイルの読み込みに失敗しました: ${err.message}`);
      showLoading(false);
      // データが無い場合はウェルカム画面を復帰
      if (!currentData) {
        showWelcome();
      }
    }
  }

  /**
   * データを地図・統計に反映
   */
  function renderData(data) {
    // 地図をクリア＆再描画
    TimelineMap.clear();
    TimelineMap.drawActivities(data.activities);
    TimelineMap.drawPlaces(data.places);
    TimelineMap.fitToData();

    // 統計計算＆表示
    currentStats = TimelineStats.calculate(data);
    TimelineStats.render(currentStats);

    // 日付フィルターの範囲設定（全データの範囲を保持し、フィルター時も変えない）
    if (currentStats.minDate && currentStats.maxDate && !originalDateRange.min) {
      originalDateRange.min = currentStats.minDate;
      originalDateRange.max = currentStats.maxDate;
    }
    if (originalDateRange.min && originalDateRange.max) {
      const startInput = document.getElementById('filter-start');
      const endInput = document.getElementById('filter-end');
      if (startInput) startInput.min = formatDateInput(originalDateRange.min);
      if (endInput) endInput.max = formatDateInput(originalDateRange.max);
    }

    // サイドパネルを表示
    document.getElementById('sidebar')?.classList.remove('hidden');
    document.getElementById('filter-panel')?.classList.remove('hidden');
  }

  /**
   * 日付フィルターを適用
   */
  function applyFilter() {
    if (!currentData) return;

    if (dateFilter.start || dateFilter.end || durationThreshold > 0 || excludeHomeWork) {
          // 滞在の判定・フィルタリング
    const filteredPlaces = currentData.places.filter(p => {
      // 日付フィルター
      if (dateFilter.start && p.startDate < dateFilter.start) return false;
      if (dateFilter.end && p.endDate > dateFilter.end) return false;

      // 滞在時間フィルター
      const durationMin = p.durationMs / 60000;
      if (durationMin < durationThreshold) return false;

      // 自宅・仕事フィルター (タグベース)
      if (excludeHomeWork && (p.semanticType === 'HOME' || p.semanticType === 'WORK')) return false;

      // 座標ベースの除外 (半径500m)
      for (const ep of exclusionPoints) {
        if (TimelineParser.haversineDistance(p.lat, p.lng, ep.lat, ep.lng) < ep.radius) {
          return false;
        }
      }

      return true;
    });

    // 移動のフィルタリング
    const filteredActivities = currentData.activities.filter(a => {
      // 日付フィルター
      if (dateFilter.start && a.startDate < dateFilter.start) return false;
      if (dateFilter.end && a.endDate > dateFilter.end) return false;

      // 座標ベースの除外 (開始点または終了点が半径500m以内なら除外)
      for (const ep of exclusionPoints) {
        if (a.startLat !== null && a.startLng !== null) {
          if (TimelineParser.haversineDistance(a.startLat, a.startLng, ep.lat, ep.lng) < ep.radius) return false;
        }
        if (a.endLat !== null && a.endLng !== null) {
          if (TimelineParser.haversineDistance(a.endLat, a.endLng, ep.lat, ep.lng) < ep.radius) return false;
        }
      }

      return true;
    });

    renderData({
      activities: filteredActivities,
      places: filteredPlaces,
      format: currentData.format
    });
    } else {
      renderData(currentData);
    }
  }

  // --- UI ヘルパー ---

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  function showLoading(show) {
    const el = document.getElementById('loading');
    if (el) el.classList.toggle('hidden', !show);
  }

  function hideWelcome() {
    const el = document.getElementById('welcome');
    if (el) el.classList.add('hidden');
  }

  function showWelcome() {
    const el = document.getElementById('welcome');
    if (el) el.classList.remove('hidden');
  }

  function showError(msg) {
    showToast(msg, 'error');
  }

  function showSuccess(msg) {
    showToast(msg, 'success');
  }

  function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    container.appendChild(toast);

    // フェードイン
    requestAnimationFrame(() => toast.classList.add('show'));

    // 自動消去
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function updateFileInfo(fileNames, data) {
    const el = document.getElementById('file-info');
    if (!el) return;
    el.innerHTML = `
      <div class="text-xs text-gray-400">
        <span class="font-medium">${fileNames.length}ファイル</span> 読み込み済み
        (フォーマット: ${data.format})
      </div>
    `;
    el.classList.remove('hidden');
  }

  function formatDateInput(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  return { init };
})();

// DOMContentLoaded で初期化
document.addEventListener('DOMContentLoaded', App.init);
