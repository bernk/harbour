(function () {
  'use strict';

  var STORAGE_KEY_MARKERS = 'vancouver-anchorages-markers';
  var STORAGE_KEY_VIEW = 'vancouver-anchorages-view';
  var STORAGE_KEY_BASEMAP = 'vancouver-anchorages-basemap';
  var STORAGE_KEY_LOG = 'vancouver-anchorages-log';
  var STORAGE_KEY_PASSENGER_COUNT_ENABLED = 'vancouver-anchorages-passenger-count-enabled';
  var STORAGE_KEY_HIDE_BRIEF_ANCHORAGE_VISITS = 'vancouver-anchorages-hide-brief-anchorage-visits';
  var PASSENGER_COUNT_IDLE_MS = 60000;
  var PASSENGER_COUNT_SELECTED_MS = 5000;
  var BRIEF_ANCHORAGE_VISIT_MS = 2 * 60 * 1000;
  var DEFAULT_CENTER = [49.2937, -123.1200];
  var DEFAULT_ZOOM = 13;
  var MIN_RADIUS = 10;
  var MAX_RADIUS = 1000;
  var DEFAULT_RADIUS = 350;
  var DEFAULT_IMPORT_RADIUS = 300;
  var DRAG_THRESHOLD_METERS = 3;

  var CATEGORY_COLORS = {
    anchorage: '#2b6cb0',
    pickupDropoff: '#dd7a1f'
  };
  var CATEGORY_LABELS = {
    anchorage: 'Anchorage',
    pickupDropoff: 'Pick-up / Drop-off'
  };

  var CARTO_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
  var DEFAULT_BASEMAP_KEY = 'light-nolabels';
  // Fixed tile used to render the little map-style preview on each basemap button (Vancouver Harbour @ z12).
  var BASEMAP_PREVIEW_TILE = { z: 12, x: 647, y: 1401 };
  var BASEMAPS = [
    {
      key: 'light-nolabels',
      label: 'Streets',
      url: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
      attribution: CARTO_ATTRIBUTION,
      subdomains: 'abcd'
    },
    {
      key: 'light',
      label: 'Light',
      url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      attribution: CARTO_ATTRIBUTION,
      subdomains: 'abcd'
    },
    {
      key: 'dark',
      label: 'Dark',
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attribution: CARTO_ATTRIBUTION,
      subdomains: 'abcd'
    },
    {
      key: 'dark-nolabels',
      label: 'Dark (no labels)',
      url: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
      attribution: CARTO_ATTRIBUTION,
      subdomains: 'abcd'
    },
    {
      key: 'satellite',
      label: 'Satellite',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
    }
  ];

  function resolveTileUrl(template, s, z, x, y) {
    return template
      .replace('{s}', s)
      .replace('{z}', z)
      .replace('{x}', x)
      .replace('{y}', y)
      .replace('{r}', window.devicePixelRatio > 1 ? '@2x' : '');
  }

  // ---------- Storage helpers ----------
  function loadMarkers() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY_MARKERS);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error('Failed to load markers from localStorage', e);
      return [];
    }
  }

  function persistMarkers() {
    try {
      localStorage.setItem(STORAGE_KEY_MARKERS, JSON.stringify(markers));
    } catch (e) {
      console.error('Failed to save markers to localStorage', e);
    }
  }

  function loadLog() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY_LOG);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error('Failed to load position log from localStorage', e);
      return [];
    }
  }

  function persistLog() {
    try {
      localStorage.setItem(STORAGE_KEY_LOG, JSON.stringify(logEntries));
    } catch (e) {
      console.error('Failed to save position log to localStorage', e);
    }
  }

  function loadView() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY_VIEW);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function persistView(center, zoom) {
    try {
      localStorage.setItem(STORAGE_KEY_VIEW, JSON.stringify({ lat: center.lat, lng: center.lng, zoom: zoom }));
    } catch (e) {
      console.error('Failed to save view to localStorage', e);
    }
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function parseCsv(text) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;

    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }

    return rows.filter(function (r) { return !(r.length === 1 && r[0].trim() === ''); });
  }

  // ---------- State ----------
  var markers = loadMarkers();
  var editMode = false;
  var activeMarkerId = null;
  var pendingNew = null;
  var layers = new Map();
  var currentLocationMarker = null;
  var watchId = null;
  var lastKnownFix = null;
  var trackingMode = false;
  var lastLocateClickAt = 0;
  var LOCATE_DOUBLE_TAP_MS = 2000;
  var geofenceState = null;
  var pendingDeleteId = null;
  var pendingDeleteAll = false;
  var currentSearchMatches = [];
  var searchActiveIndex = -1;
  var logEntries = loadLog();
  var pendingClearLog = false;
  var passengerCountEnabled = loadPassengerCountEnabled();
  var hideBriefAnchorageVisits = loadHideBriefAnchorageVisits();

  // ---------- Map init ----------
  var savedView = loadView();
  var map = L.map('map', { zoomControl: false, attributionControl: false }).setView(
    savedView ? [savedView.lat, savedView.lng] : DEFAULT_CENTER,
    savedView ? savedView.zoom : DEFAULT_ZOOM
  );

  var basemapLayers = {};
  BASEMAPS.forEach(function (b) {
    var opts = { attribution: b.attribution, maxZoom: 19 };
    if (b.subdomains) opts.subdomains = b.subdomains;
    basemapLayers[b.key] = L.tileLayer(b.url, opts);
  });

  function loadBasemap() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY_BASEMAP);
      var known = BASEMAPS.some(function (b) { return b.key === saved; });
      return known ? saved : DEFAULT_BASEMAP_KEY;
    } catch (e) {
      return DEFAULT_BASEMAP_KEY;
    }
  }

  function loadPassengerCountEnabled() {
    try {
      return localStorage.getItem(STORAGE_KEY_PASSENGER_COUNT_ENABLED) === 'true';
    } catch (e) {
      return false;
    }
  }

  function loadHideBriefAnchorageVisits() {
    try {
      return localStorage.getItem(STORAGE_KEY_HIDE_BRIEF_ANCHORAGE_VISITS) === 'true';
    } catch (e) {
      return false;
    }
  }

  var currentBasemap = loadBasemap();
  basemapLayers[currentBasemap].addTo(map);

  map.on('moveend', function () {
    persistView(map.getCenter(), map.getZoom());
  });

  // ---------- One-finger double-tap-drag zoom ----------
  // Double-tap, keep the finger down on the second tap, then drag down to zoom
  // in or up to zoom out (same gesture as Google/Apple Maps). A quick
  // double-tap without dragging still zooms in one level.
  (function () {
    var container = map.getContainer();
    var DOUBLE_TAP_MS = 300;      // max delay between the two taps
    var DOUBLE_TAP_PX = 40;       // max distance between the two taps
    var ZOOM_PER_PX = 1 / 150;    // dragging 150px changes zoom by one level
    var TAP_SLOP_PX = 8;          // movement below this still counts as a tap

    var lastTapTime = 0;
    var lastTapX = 0;
    var lastTapY = 0;
    var zooming = false;
    var dragged = false;
    var startY = 0;
    var startX = 0;
    var startZoom = 0;
    var anchorLatLng = null;
    var savedZoomSnap = map.options.zoomSnap;

    function clampZoom(z) {
      return Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), z));
    }

    function endGesture() {
      if (!zooming) return;
      zooming = false;
      map.options.zoomSnap = savedZoomSnap;
      map.dragging.enable();
    }

    function onTouchStart(e) {
      if (e.touches.length !== 1) {
        // A second finger means a pinch — hand the gesture back to Leaflet.
        endGesture();
        lastTapTime = 0;
        return;
      }
      var t = e.touches[0];
      var now = Date.now();
      var isDoubleTap =
        now - lastTapTime <= DOUBLE_TAP_MS &&
        Math.abs(t.clientX - lastTapX) <= DOUBLE_TAP_PX &&
        Math.abs(t.clientY - lastTapY) <= DOUBLE_TAP_PX;
      lastTapTime = now;
      lastTapX = t.clientX;
      lastTapY = t.clientY;
      if (!isDoubleTap) return;

      zooming = true;
      dragged = false;
      startX = t.clientX;
      startY = t.clientY;
      startZoom = map.getZoom();
      anchorLatLng = map.containerPointToLatLng(
        map.mouseEventToContainerPoint(t)
      );
      savedZoomSnap = map.options.zoomSnap;
      map.options.zoomSnap = 0;
      map.dragging.disable();
      // Keep Leaflet (and synthetic mouse events) out of this touch.
      e.preventDefault();
      e.stopPropagation();
    }

    function onTouchMove(e) {
      if (!zooming || e.touches.length !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      var t = e.touches[0];
      var dy = t.clientY - startY;
      if (!dragged && Math.abs(dy) < TAP_SLOP_PX && Math.abs(t.clientX - startX) < TAP_SLOP_PX) {
        return;
      }
      dragged = true;
      // Drag down = zoom in, drag up = zoom out, anchored on the tapped spot.
      map.setZoomAround(anchorLatLng, clampZoom(startZoom + dy * ZOOM_PER_PX), { animate: false });
    }

    function onTouchEnd(e) {
      if (!zooming) return;
      var wasDragged = dragged;
      endGesture();
      e.preventDefault();
      e.stopPropagation();
      lastTapTime = 0;
      if (!wasDragged) {
        // Plain double-tap: zoom in one level on the tapped spot.
        map.setZoomAround(anchorLatLng, clampZoom(Math.round(map.getZoom()) + 1));
      }
    }

    container.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
    container.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    container.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
    container.addEventListener('touchcancel', endGesture, { capture: true });
  })();

  // ---------- DOM refs ----------
  var modeToggleBtn = document.getElementById('mode-toggle');
  var editToolbar = document.getElementById('edit-toolbar');
  var basemapPicker = document.getElementById('basemap-picker');
  var importCsvBtn = document.getElementById('import-csv-btn');
  var importCsvFile = document.getElementById('import-csv-file');
  var exportCsvBtn = document.getElementById('export-csv-btn');
  var importLogBtn = document.getElementById('import-log-btn');
  var importLogFile = document.getElementById('import-log-file');
  var exportLogBtn = document.getElementById('export-log-btn');
  var deleteAllBtn = document.getElementById('delete-all-btn');
  var versionLabel = document.getElementById('version-label');
  var passengerCountToggle = document.getElementById('passenger-count-toggle');
  var hideBriefAnchorageToggle = document.getElementById('hide-brief-anchorage-toggle');
  var passengerCountOverlay = document.getElementById('passenger-count-overlay');
  var passengerCountTitle = document.getElementById('passenger-count-title');
  var passengerCountGrid = document.getElementById('passenger-count-grid');
  var passengerCountButtons = passengerCountGrid.querySelectorAll('.passenger-count-btn');
  var passengerCountProgressBar = document.getElementById('passenger-count-progress-bar');
  var passengerCountCancelBtn = document.getElementById('passenger-count-cancel');
  var passengerCountLogBtn = document.getElementById('passenger-count-log');
  var locateBtn = document.getElementById('locate-btn');
  var logPositionBtn = document.getElementById('log-position-btn');
  var logNoteBtn = document.getElementById('log-note-btn');
  var logNoteOverlay = document.getElementById('log-note-overlay');
  var logNoteInput = document.getElementById('log-note-input');
  var logNoteCancelBtn = document.getElementById('log-note-cancel');
  var logNoteSaveBtn = document.getElementById('log-note-save');
  var viewLogBtn = document.getElementById('view-log-btn');
  var logOverlay = document.getElementById('log-overlay');
  var logList = document.getElementById('log-list');
  var logClearBtn = document.getElementById('log-clear');
  var logCloseBtn = document.getElementById('log-close');
  var locationMsg = document.getElementById('location-msg');
  var searchInput = document.getElementById('search-input');
  var searchResults = document.getElementById('search-results');

  var formOverlay = document.getElementById('marker-form-overlay');
  var formTitle = document.getElementById('marker-form-title');
  var labelInput = document.getElementById('marker-label-input');
  var coordsInput = document.getElementById('marker-coords-input');
  var radiusInput = document.getElementById('marker-radius-input');
  var formDeleteBtn = document.getElementById('marker-form-delete');
  var formCancelBtn = document.getElementById('marker-form-cancel');
  var formSaveBtn = document.getElementById('marker-form-save');

  var confirmOverlay = document.getElementById('confirm-overlay');
  var confirmTitle = document.getElementById('confirm-title');
  var confirmText = document.getElementById('confirm-text');
  var confirmCancelBtn = document.getElementById('confirm-cancel');
  var confirmOkBtn = document.getElementById('confirm-ok');

  // ---------- Toast ----------
  var toastTimer = null;
  function showToast(msg, duration) {
    locationMsg.textContent = msg;
    locationMsg.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    if (duration) {
      toastTimer = setTimeout(function () {
        locationMsg.classList.add('hidden');
      }, duration);
    }
  }

  // ---------- Geo helpers ----------
  function destinationPoint(lat, lng, distanceMeters, bearingDeg) {
    var R = 6378137;
    var brng = (bearingDeg * Math.PI) / 180;
    var latRad = (lat * Math.PI) / 180;
    var dLat = (distanceMeters * Math.cos(brng)) / R;
    var dLng = (distanceMeters * Math.sin(brng)) / (R * Math.cos(latRad));
    return {
      lat: lat + (dLat * 180) / Math.PI,
      lng: lng + (dLng * 180) / Math.PI
    };
  }

  function handlePositionFor(centerLat, centerLng, radiusMeters) {
    var p = destinationPoint(centerLat, centerLng, radiusMeters, 90);
    return L.latLng(p.lat, p.lng);
  }

  function formatCoords(lat, lng) {
    return lat.toFixed(6) + ', ' + lng.toFixed(6);
  }

  function parseCoords(value) {
    var parts = value.split(',');
    if (parts.length !== 2) return null;
    var lat = parseFloat(parts[0]);
    var lng = parseFloat(parts[1]);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat: lat, lng: lng };
  }

  function categoryColor(category) {
    return CATEGORY_COLORS[category] || CATEGORY_COLORS.anchorage;
  }

  function popupContentFor(markerData) {
    return (
      '<strong>' + escapeHtml(markerData.label) + '</strong><br/>' +
      CATEGORY_LABELS[markerData.category] + '<br/>' +
      'Radius: ' + Math.round(markerData.radiusMeters) + ' m'
    );
  }

  // ---------- Rendering ----------
  function clearAllLayers() {
    layers.forEach(function (entry) {
      map.removeLayer(entry.circle);
      if (entry.handle) map.removeLayer(entry.handle);
      if (entry.moveHandle) map.removeLayer(entry.moveHandle);
    });
    layers.clear();
  }

  function renderAll() {
    clearAllLayers();
    markers.forEach(renderMarker);
    updateEmptyState();
  }

  function renderMarker(markerData) {
    var color = categoryColor(markerData.category);
    var circle = L.circle([markerData.centerLat, markerData.centerLng], {
      radius: markerData.radiusMeters,
      color: color,
      weight: 1,
      fillColor: color,
      fillOpacity: 0.18
    }).addTo(map);

    circle.bindTooltip(markerData.label, {
      permanent: true,
      direction: 'top',
      className: 'marker-label',
      offset: [0, -4]
    });

    if (!editMode) {
      circle.bindPopup(popupContentFor(markerData));
    }

    var entry = { circle: circle, handle: null, moveHandle: null };
    layers.set(markerData.id, entry);

    attachCircleInteractions(markerData.id, circle);

    if (editMode) {
      addResizeHandle(markerData.id);
      addMoveHandle(markerData.id);
    }

    return entry;
  }

  function redrawSingleMarker(markerId) {
    var entry = layers.get(markerId);
    if (entry) {
      map.removeLayer(entry.circle);
      if (entry.handle) map.removeLayer(entry.handle);
      if (entry.moveHandle) map.removeLayer(entry.moveHandle);
      layers.delete(markerId);
    }
    var markerData = markers.find(function (m) { return m.id === markerId; });
    if (markerData) {
      renderMarker(markerData);
    }
  }

  function addResizeHandle(markerId) {
    var entry = layers.get(markerId);
    if (!entry) return;
    var markerData = markers.find(function (m) { return m.id === markerId; });
    if (!markerData) return;
    var pos = handlePositionFor(markerData.centerLat, markerData.centerLng, markerData.radiusMeters);
    var handleIcon = L.divIcon({
      className: 'resize-handle-icon',
      html: '<div class="resize-handle"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
    var handle = L.marker(pos, { icon: handleIcon, draggable: true }).addTo(map);

    handle.on('drag', function () {
      var center = entry.circle.getLatLng();
      var newRadius = map.distance(center, handle.getLatLng());
      var clamped = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, newRadius));
      entry.circle.setRadius(clamped);
    });

    handle.on('dragend', function () {
      var center = entry.circle.getLatLng();
      var finalRadius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, map.distance(center, handle.getLatLng())));
      entry.circle.setRadius(finalRadius);
      handle.setLatLng(handlePositionFor(center.lat, center.lng, finalRadius));
      markerData.radiusMeters = finalRadius;
      persistMarkers();
    });

    entry.handle = handle;
  }

  function removeResizeHandle(markerId) {
    var entry = layers.get(markerId);
    if (entry && entry.handle) {
      map.removeLayer(entry.handle);
      entry.handle = null;
    }
  }

  function addMoveHandle(markerId) {
    var entry = layers.get(markerId);
    if (!entry) return;
    var markerData = markers.find(function (m) { return m.id === markerId; });
    if (!markerData) return;
    var moveIcon = L.divIcon({
      className: 'move-handle-icon',
      html: '<div class="move-handle"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
    var moveHandle = L.marker([markerData.centerLat, markerData.centerLng], {
      icon: moveIcon,
      draggable: true
    }).addTo(map);

    moveHandle.on('drag', function () {
      var newCenter = moveHandle.getLatLng();
      entry.circle.setLatLng(newCenter);
      if (entry.handle) {
        entry.handle.setLatLng(handlePositionFor(newCenter.lat, newCenter.lng, markerData.radiusMeters));
      }
    });

    moveHandle.on('dragend', function () {
      var newCenter = moveHandle.getLatLng();
      markerData.centerLat = newCenter.lat;
      markerData.centerLng = newCenter.lng;
      persistMarkers();
    });

    entry.moveHandle = moveHandle;
  }

  function removeMoveHandle(markerId) {
    var entry = layers.get(markerId);
    if (entry && entry.moveHandle) {
      map.removeLayer(entry.moveHandle);
      entry.moveHandle = null;
    }
  }

  function attachCircleInteractions(markerId, circle) {
    circle.on('click', function (e) {
      L.DomEvent.stopPropagation(e);
    });

    circle.on('mousedown', function (e) {
      if (!editMode) return;
      L.DomEvent.stopPropagation(e);
      var moved = false;
      circle.closePopup();

      function onMouseMove(ev) {
        if (!moved && map.distance(e.latlng, ev.latlng) < DRAG_THRESHOLD_METERS) return;
        moved = true;
        circle.setLatLng(ev.latlng);
        var markerData = markers.find(function (m) { return m.id === markerId; });
        var entry = layers.get(markerId);
        if (entry && entry.handle && markerData) {
          entry.handle.setLatLng(handlePositionFor(ev.latlng.lat, ev.latlng.lng, markerData.radiusMeters));
        }
      }

      function onMouseUp() {
        map.off('mousemove', onMouseMove);
        map.off('mouseup', onMouseUp);
        map.dragging.enable();

        var markerData = markers.find(function (m) { return m.id === markerId; });
        if (!markerData) return;

        if (moved) {
          var finalLatLng = circle.getLatLng();
          markerData.centerLat = finalLatLng.lat;
          markerData.centerLng = finalLatLng.lng;
          persistMarkers();
        } else {
          openEditForm(markerId);
        }
      }

      map.dragging.disable();
      map.on('mousemove', onMouseMove);
      map.on('mouseup', onMouseUp);
    });
  }

  // ---------- Mode toggle ----------
  function setEditMode(on) {
    editMode = on;
    modeToggleBtn.title = on ? 'Close Settings' : 'Settings';
    modeToggleBtn.classList.toggle('active', on);
    editToolbar.classList.toggle('hidden', !on);
    cancelPendingNew();

    layers.forEach(function (entry, markerId) {
      var markerData = markers.find(function (m) { return m.id === markerId; });
      if (on) {
        entry.circle.closePopup();
        entry.circle.unbindPopup();
        addResizeHandle(markerId);
        addMoveHandle(markerId);
      } else {
        if (markerData) entry.circle.bindPopup(popupContentFor(markerData));
        removeResizeHandle(markerId);
        removeMoveHandle(markerId);
      }
    });

    updateEmptyState();
  }

  modeToggleBtn.addEventListener('click', function () {
    setEditMode(!editMode);
  });

  // ---------- Basemap picker ----------
  function updateBasemapButtons() {
    basemapPicker.querySelectorAll('.basemap-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.basemap === currentBasemap);
    });
  }

  function setBasemap(key) {
    if (key === currentBasemap || !basemapLayers[key]) return;
    map.removeLayer(basemapLayers[currentBasemap]);
    basemapLayers[key].addTo(map);
    currentBasemap = key;
    try {
      localStorage.setItem(STORAGE_KEY_BASEMAP, key);
    } catch (e) {
      console.error('Failed to save basemap preference', e);
    }
    updateBasemapButtons();
  }

  BASEMAPS.forEach(function (b) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'basemap-btn';
    btn.dataset.basemap = b.key;
    btn.title = b.label;
    btn.setAttribute('aria-label', b.label);

    var s = b.subdomains ? b.subdomains[0] : 'a';
    var previewUrl = resolveTileUrl(b.url, s, BASEMAP_PREVIEW_TILE.z, BASEMAP_PREVIEW_TILE.x, BASEMAP_PREVIEW_TILE.y);
    var swatch = document.createElement('span');
    swatch.className = 'basemap-swatch';
    swatch.style.backgroundImage = 'url(' + previewUrl + ')';
    btn.appendChild(swatch);

    btn.addEventListener('click', function () { setBasemap(b.key); });
    basemapPicker.appendChild(btn);
  });

  updateBasemapButtons();

  if (window.APP_VERSION) {
    var versionLine = document.createElement('div');
    versionLine.textContent = 'v' + window.APP_VERSION.build + ' · ' + window.APP_VERSION.hash;
    versionLabel.appendChild(versionLine);

    if (window.APP_VERSION.message) {
      var versionMessage = document.createElement('div');
      versionMessage.className = 'version-message';
      versionMessage.textContent = window.APP_VERSION.message;
      versionLabel.appendChild(versionMessage);
    }
  }

  // ---------- Passenger count setting ----------
  passengerCountToggle.checked = passengerCountEnabled;

  passengerCountToggle.addEventListener('change', function () {
    passengerCountEnabled = passengerCountToggle.checked;
    try {
      localStorage.setItem(STORAGE_KEY_PASSENGER_COUNT_ENABLED, String(passengerCountEnabled));
    } catch (e) {
      console.error('Failed to save passenger count preference', e);
    }
  });

  // ---------- Hide brief anchorage visits setting ----------
  hideBriefAnchorageToggle.checked = hideBriefAnchorageVisits;

  hideBriefAnchorageToggle.addEventListener('change', function () {
    hideBriefAnchorageVisits = hideBriefAnchorageToggle.checked;
    try {
      localStorage.setItem(STORAGE_KEY_HIDE_BRIEF_ANCHORAGE_VISITS, String(hideBriefAnchorageVisits));
    } catch (e) {
      console.error('Failed to save hide-brief-anchorage-visits preference', e);
    }
    if (!logOverlay.classList.contains('hidden')) renderLog();
  });

  // ---------- Passenger count prompt ----------
  var passengerCountTimer = null;
  var passengerCountSelectedBtn = null;
  var passengerCountSelectedCount = null;
  var passengerCountOnCommit = null;

  function startPassengerCountCountdown(ms, onExpire) {
    clearTimeout(passengerCountTimer);
    passengerCountProgressBar.style.transition = 'none';
    passengerCountProgressBar.style.width = '100%';
    void passengerCountProgressBar.offsetWidth; // force reflow so the transition below restarts
    passengerCountProgressBar.style.transition = 'width ' + ms + 'ms linear';
    passengerCountProgressBar.style.width = '0%';
    passengerCountTimer = setTimeout(onExpire, ms);
  }

  function closePassengerCountModal() {
    clearTimeout(passengerCountTimer);
    passengerCountTimer = null;
    passengerCountOverlay.classList.add('hidden');
    passengerCountSelectedBtn = null;
    passengerCountSelectedCount = null;
    passengerCountOnCommit = null;
  }

  function commitPassengerCount() {
    if (passengerCountSelectedCount !== null && passengerCountOnCommit) {
      passengerCountOnCommit(passengerCountSelectedCount);
    }
    closePassengerCountModal();
  }

  function openPassengerCountModal(kind, onCommit) {
    passengerCountTitle.textContent = kind === 'depart' ? 'Passengers On' : 'Passengers Off';
    passengerCountSelectedBtn = null;
    passengerCountSelectedCount = null;
    passengerCountOnCommit = onCommit;
    passengerCountButtons.forEach(function (btn) { btn.classList.remove('selected'); });
    passengerCountOverlay.classList.remove('hidden');
    startPassengerCountCountdown(PASSENGER_COUNT_IDLE_MS, closePassengerCountModal);
  }

  passengerCountCancelBtn.addEventListener('click', closePassengerCountModal);
  passengerCountLogBtn.addEventListener('click', commitPassengerCount);

  passengerCountOverlay.addEventListener('click', function (e) {
    if (e.target === passengerCountOverlay) closePassengerCountModal();
  });

  passengerCountButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (passengerCountSelectedBtn) passengerCountSelectedBtn.classList.remove('selected');
      passengerCountSelectedBtn = btn;
      btn.classList.add('selected');
      passengerCountSelectedCount = Number(btn.dataset.count);
      startPassengerCountCountdown(PASSENGER_COUNT_SELECTED_MS, commitPassengerCount);
    });
  });

  // Manual test hook, e.g. from the browser console: testPassengerCount('depart')
  window.testPassengerCount = function (kind) {
    kind = kind === 'depart' ? 'depart' : 'arrive';
    openPassengerCountModal(kind, function (count) {
      console.log('[testPassengerCount] committed count:', count);
    });
  };

  // ---------- Drawing new markers ----------
  function cancelPendingNew() {
    if (pendingNew) {
      map.removeLayer(pendingNew.circle);
      map.removeLayer(pendingNew.handle);
      map.removeLayer(pendingNew.moveHandle);
      pendingNew = null;
    }
  }

  // ---------- CSV import ----------
  function importCsvText(text) {
    var rows = parseCsv(text);
    if (rows.length <= 1) {
      showToast('The CSV has no data rows to import.', 4000);
      return;
    }

    var header = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    var labelIdx = header.indexOf('anchorage');
    var latIdx = header.indexOf('latitude');
    var lngIdx = header.indexOf('longitude');
    var diameterIdx = header.indexOf('diameter');
    var radiusIdx = header.indexOf('radius');

    if (labelIdx === -1 || latIdx === -1 || lngIdx === -1) {
      showToast('CSV must have Anchorage, Latitude, and Longitude columns.', 5000);
      return;
    }

    var imported = 0;
    var skipped = 0;
    var newMarkers = [];

    for (var i = 1; i < rows.length; i++) {
      var cols = rows[i];
      if (cols.length === 1 && cols[0].trim() === '') continue;

      var label = (cols[labelIdx] || '').trim();
      var lat = parseFloat(cols[latIdx]);
      var lng = parseFloat(cols[lngIdx]);
      var radius = DEFAULT_IMPORT_RADIUS;
      if (diameterIdx !== -1 && cols[diameterIdx] !== undefined && cols[diameterIdx].trim() !== '') {
        var parsedDiameter = parseFloat(cols[diameterIdx]);
        if (isFinite(parsedDiameter)) radius = parsedDiameter / 2;
      } else if (radiusIdx !== -1 && cols[radiusIdx] !== undefined && cols[radiusIdx].trim() !== '') {
        var parsedRadius = parseFloat(cols[radiusIdx]);
        if (isFinite(parsedRadius)) radius = parsedRadius;
      }
      radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, radius));

      var valid = label && isFinite(lat) && isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
      if (!valid) {
        skipped++;
        continue;
      }

      newMarkers.push({
        id: uuid(),
        label: label,
        category: 'anchorage',
        centerLat: lat,
        centerLng: lng,
        radiusMeters: radius,
        createdAt: new Date().toISOString()
      });
      imported++;
    }

    if (newMarkers.length > 0) {
      markers = markers.concat(newMarkers);
      persistMarkers();
      renderAll();
    }

    var msg = 'Imported ' + imported + ' point' + (imported === 1 ? '' : 's') + '.';
    if (skipped > 0) {
      msg += ' Skipped ' + skipped + ' invalid row' + (skipped === 1 ? '' : 's') + '.';
    }
    showToast(msg, 5000);
  }

  importCsvBtn.addEventListener('click', function () {
    importCsvFile.value = '';
    importCsvFile.click();
  });

  importCsvFile.addEventListener('change', function () {
    var file = importCsvFile.files && importCsvFile.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      importCsvText(String(e.target.result));
    };
    reader.onerror = function () {
      showToast('Failed to read the CSV file.', 4000);
    };
    reader.readAsText(file);
  });

  // ---------- CSV export ----------
  function csvField(value) {
    var str = String(value);
    if (/[",\n\r]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function buildCsv() {
    var lines = ['Anchorage,Latitude,Longitude,Diameter,Category'];
    markers.forEach(function (m) {
      lines.push([
        csvField(m.label),
        m.centerLat.toFixed(6),
        m.centerLng.toFixed(6),
        Math.round(m.radiusMeters * 2),
        m.category
      ].join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }

  function downloadTextFile(text, filename) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  exportCsvBtn.addEventListener('click', function () {
    if (markers.length === 0) {
      showToast('There are no points to export.', 3000);
      return;
    }
    downloadTextFile(buildCsv(), 'anchorages-' + new Date().toISOString().slice(0, 10) + '.csv');
    showToast('Exported ' + markers.length + ' point' + (markers.length === 1 ? '' : 's') + '.', 4000);
  });

  // ---------- Log CSV import/export ----------
  function buildLogCsv() {
    var lines = ['LoggedAt,Latitude,Longitude,Note,Event,MarkerLabel,MarkerCategory,PassengerCount,Points'];
    logEntries.forEach(function (entry) {
      var pointsField = (entry.points || []).map(function (p) {
        return p.label + ' (' + p.category + ')';
      }).join('; ');
      lines.push([
        csvField(entry.loggedAt),
        typeof entry.lat === 'number' ? entry.lat.toFixed(6) : '',
        typeof entry.lng === 'number' ? entry.lng.toFixed(6) : '',
        csvField(entry.note || ''),
        entry.event || '',
        csvField(entry.marker ? entry.marker.label : ''),
        entry.marker ? entry.marker.category : '',
        typeof entry.passengerCount === 'number' ? entry.passengerCount : '',
        csvField(pointsField)
      ].join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }

  exportLogBtn.addEventListener('click', function () {
    if (logEntries.length === 0) {
      showToast('There are no log entries to export.', 3000);
      return;
    }
    downloadTextFile(buildLogCsv(), 'anchorages-log-' + new Date().toISOString().slice(0, 10) + '.csv');
    showToast('Exported ' + logEntries.length + ' log entr' + (logEntries.length === 1 ? 'y' : 'ies') + '.', 4000);
  });

  function importLogCsvText(text) {
    var rows = parseCsv(text);
    if (rows.length <= 1) {
      showToast('The CSV has no data rows to import.', 4000);
      return;
    }

    var header = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    var loggedAtIdx = header.indexOf('loggedat');
    var latIdx = header.indexOf('latitude');
    var lngIdx = header.indexOf('longitude');
    var noteIdx = header.indexOf('note');
    var eventIdx = header.indexOf('event');
    var markerLabelIdx = header.indexOf('markerlabel');
    var markerCategoryIdx = header.indexOf('markercategory');
    var passengerCountIdx = header.indexOf('passengercount');
    var pointsIdx = header.indexOf('points');

    if (loggedAtIdx === -1) {
      showToast('CSV must have a LoggedAt column.', 5000);
      return;
    }

    var imported = 0;
    var skipped = 0;
    var newEntries = [];

    for (var i = 1; i < rows.length; i++) {
      var cols = rows[i];
      if (cols.length === 1 && cols[0].trim() === '') continue;

      var loggedAtRaw = (cols[loggedAtIdx] || '').trim();
      var loggedAtDate = new Date(loggedAtRaw);
      if (!loggedAtRaw || isNaN(loggedAtDate.getTime())) {
        skipped++;
        continue;
      }

      var lat = latIdx !== -1 ? parseFloat(cols[latIdx]) : NaN;
      var lng = lngIdx !== -1 ? parseFloat(cols[lngIdx]) : NaN;

      var entry = {
        id: uuid(),
        lat: isFinite(lat) ? lat : null,
        lng: isFinite(lng) ? lng : null,
        loggedAt: loggedAtDate.toISOString()
      };

      var note = noteIdx !== -1 ? (cols[noteIdx] || '').trim() : '';
      if (note) entry.note = note;

      var eventVal = eventIdx !== -1 ? (cols[eventIdx] || '').trim() : '';
      if (eventVal === 'arrive' || eventVal === 'depart') {
        var markerLabel = markerLabelIdx !== -1 ? (cols[markerLabelIdx] || '').trim() : '';
        var markerCategory = markerCategoryIdx !== -1 ? (cols[markerCategoryIdx] || '').trim() : '';
        if (markerLabel && (markerCategory === 'anchorage' || markerCategory === 'pickupDropoff')) {
          entry.event = eventVal;
          entry.marker = { label: markerLabel, category: markerCategory };
          var pcRaw = passengerCountIdx !== -1 ? (cols[passengerCountIdx] || '').trim() : '';
          if (pcRaw !== '') {
            var pc = Number(pcRaw);
            if (isFinite(pc)) entry.passengerCount = pc;
          }
        }
      }

      var pointsRaw = pointsIdx !== -1 ? (cols[pointsIdx] || '').trim() : '';
      if (pointsRaw) {
        var points = pointsRaw.split(';').map(function (chunk) {
          var m = chunk.trim().match(/^(.*)\((anchorage|pickupDropoff)\)$/);
          if (!m) return null;
          return { label: m[1].trim(), category: m[2] };
        }).filter(Boolean);
        if (points.length > 0) entry.points = points;
      }

      newEntries.push(entry);
      imported++;
    }

    if (newEntries.length > 0) {
      logEntries = newEntries.concat(logEntries);
      persistLog();
      if (!logOverlay.classList.contains('hidden')) renderLog();
    }

    var msg = 'Imported ' + imported + ' log entr' + (imported === 1 ? 'y' : 'ies') + '.';
    if (skipped > 0) {
      msg += ' Skipped ' + skipped + ' invalid row' + (skipped === 1 ? '' : 's') + '.';
    }
    showToast(msg, 5000);
  }

  importLogBtn.addEventListener('click', function () {
    importLogFile.value = '';
    importLogFile.click();
  });

  importLogFile.addEventListener('change', function () {
    var file = importLogFile.files && importLogFile.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      importLogCsvText(String(e.target.result));
    };
    reader.onerror = function () {
      showToast('Failed to read the CSV file.', 4000);
    };
    reader.readAsText(file);
  });

  map.on('click', function (e) {
    if (!editMode || pendingNew) return;

    var category = 'anchorage';
    var color = categoryColor(category);
    var circle = L.circle(e.latlng, {
      radius: DEFAULT_RADIUS,
      color: color,
      weight: 2,
      fillColor: color,
      fillOpacity: 0.18,
      dashArray: '6,4'
    }).addTo(map);

    var handleIcon = L.divIcon({
      className: 'resize-handle-icon',
      html: '<div class="resize-handle"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
    var handle = L.marker(handlePositionFor(e.latlng.lat, e.latlng.lng, DEFAULT_RADIUS), {
      icon: handleIcon,
      draggable: true
    }).addTo(map);

    handle.on('drag', function () {
      var center = circle.getLatLng();
      var newRadius = map.distance(center, handle.getLatLng());
      var clamped = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, newRadius));
      circle.setRadius(clamped);
      radiusInput.value = Math.round(clamped);
    });

    handle.on('dragend', function () {
      var center = circle.getLatLng();
      var finalRadius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, map.distance(center, handle.getLatLng())));
      circle.setRadius(finalRadius);
      handle.setLatLng(handlePositionFor(center.lat, center.lng, finalRadius));
      radiusInput.value = Math.round(finalRadius);
    });

    var moveIcon = L.divIcon({
      className: 'move-handle-icon',
      html: '<div class="move-handle"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
    var moveHandle = L.marker(e.latlng, { icon: moveIcon, draggable: true }).addTo(map);

    moveHandle.on('drag', function () {
      var newCenter = moveHandle.getLatLng();
      circle.setLatLng(newCenter);
      handle.setLatLng(handlePositionFor(newCenter.lat, newCenter.lng, circle.getRadius()));
    });

    circle.on('mousedown', function (ev) {
      L.DomEvent.stopPropagation(ev);
      map.dragging.disable();
      function onMove(mv) {
        circle.setLatLng(mv.latlng);
        handle.setLatLng(handlePositionFor(mv.latlng.lat, mv.latlng.lng, circle.getRadius()));
        moveHandle.setLatLng(mv.latlng);
      }
      function onUp() {
        map.off('mousemove', onMove);
        map.off('mouseup', onUp);
        map.dragging.enable();
      }
      map.on('mousemove', onMove);
      map.on('mouseup', onUp);
    });

    pendingNew = { circle: circle, handle: handle, moveHandle: moveHandle, category: category };
    activeMarkerId = null;
    openMarkerForm({
      title: 'New ' + CATEGORY_LABELS[category],
      label: '',
      category: category,
      radius: DEFAULT_RADIUS,
      lat: e.latlng.lat,
      lng: e.latlng.lng,
      showDelete: false
    });
  });

  // ---------- Marker form (create / edit) ----------
  function openMarkerForm(opts) {
    formTitle.textContent = opts.title;
    labelInput.value = opts.label || '';
    coordsInput.value = formatCoords(opts.lat, opts.lng);
    coordsInput.classList.remove('input-invalid');
    radiusInput.value = Math.round(opts.radius);
    var radios = document.getElementsByName('category');
    for (var i = 0; i < radios.length; i++) {
      radios[i].checked = radios[i].value === opts.category;
    }
    formDeleteBtn.classList.toggle('hidden', !opts.showDelete);
    formOverlay.classList.remove('hidden');
    labelInput.focus();
  }

  function closeMarkerForm() {
    formOverlay.classList.add('hidden');
  }

  function openEditForm(markerId) {
    var markerData = markers.find(function (m) { return m.id === markerId; });
    if (!markerData) return;
    activeMarkerId = markerId;
    openMarkerForm({
      title: 'Edit Marker',
      label: markerData.label,
      category: markerData.category,
      radius: markerData.radiusMeters,
      lat: markerData.centerLat,
      lng: markerData.centerLng,
      showDelete: true
    });
  }

  function applyLiveCenter(lat, lng) {
    if (pendingNew) {
      pendingNew.circle.setLatLng([lat, lng]);
      pendingNew.moveHandle.setLatLng([lat, lng]);
      pendingNew.handle.setLatLng(handlePositionFor(lat, lng, pendingNew.circle.getRadius()));
    } else if (activeMarkerId) {
      var entry = layers.get(activeMarkerId);
      if (entry) {
        entry.circle.setLatLng([lat, lng]);
        if (entry.moveHandle) entry.moveHandle.setLatLng([lat, lng]);
        if (entry.handle) entry.handle.setLatLng(handlePositionFor(lat, lng, entry.circle.getRadius()));
      }
    }
  }

  coordsInput.addEventListener('input', function () {
    var parsed = parseCoords(coordsInput.value);
    if (!parsed) {
      coordsInput.classList.add('input-invalid');
      return;
    }
    coordsInput.classList.remove('input-invalid');
    applyLiveCenter(parsed.lat, parsed.lng);
  });

  radiusInput.addEventListener('input', function () {
    var raw = Number(radiusInput.value);
    if (!isFinite(raw) || raw <= 0) return;
    var val = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, raw));

    if (pendingNew) {
      pendingNew.circle.setRadius(val);
      var c1 = pendingNew.circle.getLatLng();
      pendingNew.handle.setLatLng(handlePositionFor(c1.lat, c1.lng, val));
    } else if (activeMarkerId) {
      var entry = layers.get(activeMarkerId);
      if (entry) {
        entry.circle.setRadius(val);
        var c2 = entry.circle.getLatLng();
        if (entry.handle) entry.handle.setLatLng(handlePositionFor(c2.lat, c2.lng, val));
      }
    }
  });

  formCancelBtn.addEventListener('click', function () {
    if (pendingNew) {
      cancelPendingNew();
    } else if (activeMarkerId) {
      var markerData = markers.find(function (m) { return m.id === activeMarkerId; });
      var entry = layers.get(activeMarkerId);
      if (markerData && entry) {
        entry.circle.setLatLng([markerData.centerLat, markerData.centerLng]);
        entry.circle.setRadius(markerData.radiusMeters);
        if (entry.moveHandle) {
          entry.moveHandle.setLatLng([markerData.centerLat, markerData.centerLng]);
        }
        if (entry.handle) {
          entry.handle.setLatLng(handlePositionFor(markerData.centerLat, markerData.centerLng, markerData.radiusMeters));
        }
      }
    }
    activeMarkerId = null;
    closeMarkerForm();
  });

  formSaveBtn.addEventListener('click', function () {
    var label = labelInput.value.trim();
    if (!label) {
      labelInput.focus();
      return;
    }
    var category = document.querySelector('input[name="category"]:checked').value;
    var radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, Number(radiusInput.value)));

    if (pendingNew) {
      var center = pendingNew.circle.getLatLng();
      var newMarker = {
        id: uuid(),
        label: label,
        category: category,
        centerLat: center.lat,
        centerLng: center.lng,
        radiusMeters: radius,
        createdAt: new Date().toISOString()
      };
      map.removeLayer(pendingNew.circle);
      map.removeLayer(pendingNew.handle);
      map.removeLayer(pendingNew.moveHandle);
      pendingNew = null;
      markers.push(newMarker);
      persistMarkers();
      renderMarker(newMarker);
      updateEmptyState();
    } else if (activeMarkerId) {
      var markerData = markers.find(function (m) { return m.id === activeMarkerId; });
      var entry = layers.get(activeMarkerId);
      if (markerData && entry) {
        var finalCenter = entry.circle.getLatLng();
        markerData.label = label;
        markerData.category = category;
        markerData.radiusMeters = radius;
        markerData.centerLat = finalCenter.lat;
        markerData.centerLng = finalCenter.lng;
        persistMarkers();
        redrawSingleMarker(markerData.id);
      }
    }

    activeMarkerId = null;
    closeMarkerForm();
  });

  // ---------- Delete ----------
  formDeleteBtn.addEventListener('click', function () {
    if (!activeMarkerId) return;
    var markerData = markers.find(function (m) { return m.id === activeMarkerId; });
    pendingDeleteId = activeMarkerId;
    pendingDeleteAll = false;
    confirmTitle.textContent = 'Delete this marker?';
    confirmText.textContent = markerData
      ? 'Delete "' + markerData.label + '"? This action cannot be undone.'
      : 'This action cannot be undone.';
    confirmOverlay.classList.remove('hidden');
  });

  confirmCancelBtn.addEventListener('click', function () {
    pendingDeleteId = null;
    pendingDeleteAll = false;
    pendingClearLog = false;
    confirmOverlay.classList.add('hidden');
  });

  confirmOkBtn.addEventListener('click', function () {
    if (pendingClearLog) {
      logEntries = [];
      persistLog();
      renderLog();
      pendingClearLog = false;
      confirmOverlay.classList.add('hidden');
      return;
    }
    if (pendingDeleteAll) {
      deleteAllMarkers();
    } else if (pendingDeleteId) {
      deleteMarker(pendingDeleteId);
    }
    pendingDeleteId = null;
    pendingDeleteAll = false;
    confirmOverlay.classList.add('hidden');
    activeMarkerId = null;
    closeMarkerForm();
  });

  function deleteMarker(markerId) {
    var entry = layers.get(markerId);
    if (entry) {
      map.removeLayer(entry.circle);
      if (entry.handle) map.removeLayer(entry.handle);
      if (entry.moveHandle) map.removeLayer(entry.moveHandle);
      layers.delete(markerId);
    }
    markers = markers.filter(function (m) { return m.id !== markerId; });
    persistMarkers();
    updateEmptyState();
  }

  function deleteAllMarkers() {
    clearAllLayers();
    markers = [];
    persistMarkers();
    updateEmptyState();
  }

  deleteAllBtn.addEventListener('click', function () {
    if (markers.length === 0) {
      showToast('There are no points to delete.', 3000);
      return;
    }
    pendingDeleteId = null;
    pendingDeleteAll = true;
    confirmTitle.textContent = 'Delete all points?';
    confirmText.textContent = 'Delete all ' + markers.length + ' saved point' + (markers.length === 1 ? '' : 's') + '? This action cannot be undone.';
    confirmOverlay.classList.remove('hidden');
  });

  // ---------- Empty state ----------
  function updateEmptyState() {
    if (markers.length === 0 && !editMode) {
      showToast('No markers yet — switch to Edit Mode to add an anchorage or pick-up/drop-off location.', 0);
    } else if (locationMsg.dataset.kind !== 'geo-error') {
      locationMsg.classList.add('hidden');
    }
  }

  // ---------- Geolocation ----------
  function updateCurrentLocationMarker(lat, lng) {
    var latlng = [lat, lng];
    if (!currentLocationMarker) {
      var icon = L.divIcon({
        className: 'current-location-icon',
        html: '<div class="current-location-dot"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });
      currentLocationMarker = L.marker(latlng, { icon: icon, interactive: false, zIndexOffset: 1000 }).addTo(map);
      currentLocationMarker.bindTooltip('You are here', { direction: 'top' });
    } else {
      currentLocationMarker.setLatLng(latlng);
    }
  }

  function describeGeoError(err) {
    switch (err.code) {
      case err.PERMISSION_DENIED: return 'permission denied.';
      case err.POSITION_UNAVAILABLE: return 'position unavailable.';
      case err.TIMEOUT: return 'request timed out.';
      default: return 'unknown error.';
    }
  }

  function rememberFix(pos) {
    lastKnownFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now() };
  }

  function startWatching() {
    if (watchId !== null || !('geolocation' in navigator)) return;
    watchId = navigator.geolocation.watchPosition(
      function (pos) {
        rememberFix(pos);
        updateCurrentLocationMarker(pos.coords.latitude, pos.coords.longitude);
        if (trackingMode) {
          map.setView([pos.coords.latitude, pos.coords.longitude], map.getZoom(), { animate: true });
        }
        updateGeofencing(pos.coords.latitude, pos.coords.longitude);
      },
      function () {},
      { enableHighAccuracy: true, maximumAge: 60000 }
    );
  }

  function setTrackingMode(on) {
    trackingMode = on;
    locateBtn.classList.toggle('tracking', on);
    locateBtn.title = on ? 'Stop tracking my location' : 'Locate me';
    if (on) {
      if (lastKnownFix) {
        map.setView([lastKnownFix.lat, lastKnownFix.lng], Math.max(map.getZoom(), 14));
      }
      startWatching();
    }
  }

  map.on('dragstart', function () {
    if (trackingMode) setTrackingMode(false);
  });

  function requestLocation(panTo) {
    if (!('geolocation' in navigator)) {
      locationMsg.dataset.kind = 'geo-error';
      showToast('Geolocation is not available in this browser.', 4000);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        delete locationMsg.dataset.kind;
        rememberFix(pos);
        updateCurrentLocationMarker(pos.coords.latitude, pos.coords.longitude);
        if (panTo) {
          map.setView([pos.coords.latitude, pos.coords.longitude], Math.max(map.getZoom(), 14));
        }
        startWatching();
        updateEmptyState();
      },
      function (err) {
        locationMsg.dataset.kind = 'geo-error';
        showToast('Location unavailable: ' + describeGeoError(err), 5000);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  locateBtn.addEventListener('click', function () {
    var now = Date.now();
    if (trackingMode) {
      setTrackingMode(false);
      lastLocateClickAt = 0;
      return;
    }
    if (now - lastLocateClickAt <= LOCATE_DOUBLE_TAP_MS) {
      lastLocateClickAt = 0;
      setTrackingMode(true);
    } else {
      lastLocateClickAt = now;
      requestLocation(true);
    }
  });

  // ---------- Position log ----------
  function markersContaining(lat, lng) {
    var pos = L.latLng(lat, lng);
    return markers.filter(function (m) {
      return map.distance(pos, L.latLng(m.centerLat, m.centerLng)) <= m.radiusMeters;
    });
  }

  function logGeofenceEvent(kind, marker, lat, lng) {
    var entry = {
      id: uuid(),
      lat: lat,
      lng: lng,
      event: kind,
      marker: { label: marker.label, category: marker.category },
      loggedAt: new Date().toISOString()
    };
    logEntries.unshift(entry);
    persistLog();
    showToast((kind === 'arrive' ? 'Arrive ' : 'Depart ') + marker.label, 4000);

    if (passengerCountEnabled && marker.category === 'pickupDropoff') {
      openPassengerCountModal(kind, function (count) {
        entry.passengerCount = count;
        persistLog();
        if (!logOverlay.classList.contains('hidden')) renderLog();
      });
    }
  }

  function updateGeofencing(lat, lng) {
    var containingIds = {};
    markersContaining(lat, lng).forEach(function (m) { containingIds[m.id] = m; });

    if (geofenceState === null) {
      geofenceState = containingIds;
      return;
    }

    Object.keys(geofenceState).forEach(function (id) {
      if (!containingIds[id]) logGeofenceEvent('depart', geofenceState[id], lat, lng);
    });
    Object.keys(containingIds).forEach(function (id) {
      if (!geofenceState[id]) logGeofenceEvent('arrive', containingIds[id], lat, lng);
    });

    geofenceState = containingIds;
  }

  function formatLogTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return { main: iso, seconds: '' };
    var main = d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
    var seconds = String(d.getSeconds()).padStart(2, '0');
    return { main: main, seconds: seconds };
  }

  function briefAnchorageVisitEntryIds() {
    var hiddenIds = new Set();
    var openArrivals = {};

    for (var i = logEntries.length - 1; i >= 0; i--) {
      var entry = logEntries[i];
      if (!entry.event || entry.marker.category !== 'anchorage') continue;
      var key = entry.marker.label;

      if (entry.event === 'arrive') {
        openArrivals[key] = entry;
      } else if (entry.event === 'depart') {
        var arrival = openArrivals[key];
        if (arrival) {
          var gapMs = new Date(entry.loggedAt).getTime() - new Date(arrival.loggedAt).getTime();
          if (gapMs < BRIEF_ANCHORAGE_VISIT_MS) {
            hiddenIds.add(arrival.id);
            hiddenIds.add(entry.id);
          }
          delete openArrivals[key];
        }
      }
    }

    return hiddenIds;
  }

  function renderLog() {
    logList.innerHTML = '';

    if (logEntries.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'log-empty';
      empty.textContent = 'No positions logged yet.';
      logList.appendChild(empty);
      logClearBtn.classList.add('hidden');
      return;
    }
    logClearBtn.classList.remove('hidden');

    var hiddenIds = hideBriefAnchorageVisits ? briefAnchorageVisitEntryIds() : null;
    var visibleEntries = hiddenIds
      ? logEntries.filter(function (entry) { return !hiddenIds.has(entry.id); })
      : logEntries;

    if (visibleEntries.length === 0) {
      var emptyFiltered = document.createElement('div');
      emptyFiltered.className = 'log-empty';
      emptyFiltered.textContent = 'All entries are hidden brief anchorage visits.';
      logList.appendChild(emptyFiltered);
      return;
    }

    visibleEntries.forEach(function (entry) {
      var item = document.createElement('div');
      item.className = 'log-entry';
      item.title = 'Show on map';

      var hasCoords = typeof entry.lat === 'number' && typeof entry.lng === 'number';

      var time = document.createElement('div');
      time.className = 'log-entry-time';
      var timeParts = formatLogTime(entry.loggedAt);
      var timeMain = document.createElement('span');
      timeMain.textContent = timeParts.main;
      var timeSeconds = document.createElement('span');
      timeSeconds.className = 'log-entry-seconds';
      timeSeconds.textContent = ':' + timeParts.seconds;
      time.appendChild(timeMain);
      time.appendChild(timeSeconds);

      var coords = document.createElement('div');
      coords.className = 'log-entry-coords';
      coords.textContent = hasCoords ? formatCoords(entry.lat, entry.lng) : 'Location unavailable';

      item.appendChild(time);
      item.appendChild(coords);

      if (entry.note) {
        var note = document.createElement('div');
        note.className = 'log-entry-note';
        note.textContent = entry.note;
        item.appendChild(note);
      }

      if (entry.event) {
        var eventRow = document.createElement('div');
        eventRow.className = 'log-entry-points log-entry-event log-entry-event-' + entry.event;
        var eventSwatch = document.createElement('span');
        eventSwatch.className = 'log-point-swatch';
        eventSwatch.style.background = categoryColor(entry.marker.category);
        var eventText = document.createElement('span');
        eventText.textContent = (entry.event === 'arrive' ? 'Arrive ' : 'Depart ') + entry.marker.label;
        if (typeof entry.passengerCount === 'number') {
          eventText.textContent += ' — ' + entry.passengerCount + (entry.passengerCount === 1 ? ' passenger' : ' passengers')
            + (entry.event === 'arrive' ? ' off' : ' on');
        }
        eventRow.appendChild(eventSwatch);
        eventRow.appendChild(eventText);
        item.appendChild(eventRow);
      }

      (entry.points || []).forEach(function (p) {
        var pointRow = document.createElement('div');
        pointRow.className = 'log-entry-points';
        var swatch = document.createElement('span');
        swatch.className = 'log-point-swatch';
        swatch.style.background = categoryColor(p.category);
        var name = document.createElement('span');
        name.textContent = p.label;
        pointRow.appendChild(swatch);
        pointRow.appendChild(name);
        item.appendChild(pointRow);
      });

      if (hasCoords) {
        item.addEventListener('click', function () {
          logOverlay.classList.add('hidden');
          map.setView([entry.lat, entry.lng], Math.max(map.getZoom(), 15));
        });
      } else {
        item.title = '';
        item.classList.add('log-entry-no-coords');
      }

      logList.appendChild(item);
    });
  }

  var LOG_FIX_MAX_AGE_MS = 30000;

  function recordLogEntry(lat, lng) {
    updateCurrentLocationMarker(lat, lng);

    var containing = markersContaining(lat, lng);
    var entry = {
      id: uuid(),
      lat: lat,
      lng: lng,
      points: containing.map(function (m) {
        return { label: m.label, category: m.category };
      }),
      loggedAt: new Date().toISOString()
    };
    logEntries.unshift(entry);
    persistLog();

    var msg = 'Logged ' + formatCoords(lat, lng);
    if (containing.length > 0) {
      msg += ' — ' + containing.map(function (m) { return m.label; }).join(', ');
    }
    showToast(msg, 5000);
  }

  function withCurrentPosition(onPosition, onUnavailable) {
    if (lastKnownFix && Date.now() - lastKnownFix.at <= LOG_FIX_MAX_AGE_MS) {
      onPosition(lastKnownFix.lat, lastKnownFix.lng);
      return;
    }
    if (!('geolocation' in navigator)) {
      locationMsg.dataset.kind = 'geo-error';
      showToast('Geolocation is not available in this browser.', 4000);
      if (onUnavailable) onUnavailable();
      return;
    }
    showToast('Getting position…', 0);
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        delete locationMsg.dataset.kind;
        rememberFix(pos);
        startWatching();
        onPosition(pos.coords.latitude, pos.coords.longitude);
      },
      function (err) {
        locationMsg.dataset.kind = 'geo-error';
        showToast('Location unavailable: ' + describeGeoError(err), 5000);
        if (onUnavailable) onUnavailable();
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  function logCurrentPosition() {
    withCurrentPosition(recordLogEntry);
  }

  logPositionBtn.addEventListener('click', logCurrentPosition);

  function recordLogNote(text, lat, lng) {
    var hasPosition = typeof lat === 'number' && typeof lng === 'number';
    if (hasPosition) updateCurrentLocationMarker(lat, lng);
    var entry = {
      id: uuid(),
      lat: hasPosition ? lat : null,
      lng: hasPosition ? lng : null,
      note: text,
      loggedAt: new Date().toISOString()
    };
    logEntries.unshift(entry);
    persistLog();
    showToast('Logged: ' + text, 4000);
  }

  function openLogNoteForm() {
    logNoteInput.value = '';
    logNoteOverlay.classList.remove('hidden');
    logNoteInput.focus();
  }

  function closeLogNoteForm() {
    logNoteOverlay.classList.add('hidden');
  }

  logNoteBtn.addEventListener('click', openLogNoteForm);

  logNoteCancelBtn.addEventListener('click', closeLogNoteForm);

  logNoteSaveBtn.addEventListener('click', function () {
    var text = logNoteInput.value.trim();
    if (!text) {
      logNoteInput.focus();
      return;
    }
    closeLogNoteForm();
    withCurrentPosition(function (lat, lng) {
      recordLogNote(text, lat, lng);
    }, function () {
      recordLogNote(text, null, null);
    });
  });

  viewLogBtn.addEventListener('click', function () {
    renderLog();
    logOverlay.classList.remove('hidden');
  });

  logCloseBtn.addEventListener('click', function () {
    logOverlay.classList.add('hidden');
  });

  logClearBtn.addEventListener('click', function () {
    pendingClearLog = true;
    confirmTitle.textContent = 'Clear the position log?';
    confirmText.textContent = 'Delete all ' + logEntries.length + ' logged position' + (logEntries.length === 1 ? '' : 's') + '? This action cannot be undone.';
    confirmOverlay.classList.remove('hidden');
  });

  // ---------- Search ----------
  function searchMarkers(query) {
    var q = query.trim().toLowerCase();
    if (!q) return [];
    var startsWith = [];
    var contains = [];
    markers.forEach(function (m) {
      var label = m.label.toLowerCase();
      var idx = label.indexOf(q);
      if (idx === 0) {
        startsWith.push(m);
      } else if (idx > 0) {
        contains.push(m);
      }
    });
    return startsWith.concat(contains).slice(0, 8);
  }

  function updateSearchActiveHighlight() {
    var items = searchResults.querySelectorAll('.search-result-item');
    items.forEach(function (item, idx) {
      item.classList.toggle('active', idx === searchActiveIndex);
    });
  }

  function hideSearchResults() {
    searchResults.classList.add('hidden');
    searchResults.innerHTML = '';
    currentSearchMatches = [];
    searchActiveIndex = -1;
  }

  function selectSearchResult(markerData) {
    var entry = layers.get(markerData.id);
    if (entry) {
      map.fitBounds(entry.circle.getBounds(), { padding: [80, 80], maxZoom: 15 });
      if (!editMode) {
        entry.circle.openPopup();
      }
    } else {
      map.setView([markerData.centerLat, markerData.centerLng], Math.max(map.getZoom(), 15));
    }
    searchInput.value = '';
    hideSearchResults();
    searchInput.blur();
  }

  function renderSearchResults(matches) {
    currentSearchMatches = matches;
    searchActiveIndex = -1;
    searchResults.innerHTML = '';

    if (matches.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'search-result-empty';
      empty.textContent = 'No matching points';
      searchResults.appendChild(empty);
    } else {
      matches.forEach(function (m, idx) {
        var item = document.createElement('div');
        item.className = 'search-result-item';
        item.dataset.index = idx;

        var swatch = document.createElement('span');
        swatch.className = 'search-result-swatch';
        swatch.style.background = categoryColor(m.category);

        var label = document.createElement('span');
        label.className = 'search-result-label';
        label.textContent = m.label;

        var cat = document.createElement('span');
        cat.className = 'search-result-category';
        cat.textContent = CATEGORY_LABELS[m.category];

        item.appendChild(swatch);
        item.appendChild(label);
        item.appendChild(cat);

        item.addEventListener('mousedown', function (e) {
          e.preventDefault();
          selectSearchResult(m);
        });

        searchResults.appendChild(item);
      });
    }

    searchResults.classList.remove('hidden');
  }

  searchInput.addEventListener('input', function () {
    var value = searchInput.value;
    if (!value.trim()) {
      hideSearchResults();
      return;
    }
    renderSearchResults(searchMarkers(value));
  });

  searchInput.addEventListener('focus', function () {
    if (searchInput.value.trim()) {
      renderSearchResults(searchMarkers(searchInput.value));
    }
  });

  searchInput.addEventListener('keydown', function (e) {
    if (searchResults.classList.contains('hidden')) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentSearchMatches.length === 0) return;
      searchActiveIndex = (searchActiveIndex + 1) % currentSearchMatches.length;
      updateSearchActiveHighlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentSearchMatches.length === 0) return;
      searchActiveIndex = (searchActiveIndex - 1 + currentSearchMatches.length) % currentSearchMatches.length;
      updateSearchActiveHighlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (searchActiveIndex >= 0 && currentSearchMatches[searchActiveIndex]) {
        selectSearchResult(currentSearchMatches[searchActiveIndex]);
      } else if (currentSearchMatches.length === 1) {
        selectSearchResult(currentSearchMatches[0]);
      }
    } else if (e.key === 'Escape') {
      searchInput.value = '';
      hideSearchResults();
      searchInput.blur();
    }
  });

  searchInput.addEventListener('blur', function () {
    setTimeout(hideSearchResults, 100);
  });

  // ---------- Init ----------
  renderAll();
  requestLocation(false);

  if (sessionStorage.getItem('__ANCHORAGES_DEBUG__') === '1') {
    window.__importCsvText = importCsvText;
    window.__buildCsv = buildCsv;
  }
})();
