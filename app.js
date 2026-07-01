(function () {
  'use strict';

  var STORAGE_KEY_MARKERS = 'vancouver-anchorages-markers';
  var STORAGE_KEY_VIEW = 'vancouver-anchorages-view';
  var DEFAULT_CENTER = [49.2937, -123.1200];
  var DEFAULT_ZOOM = 13;
  var MIN_RADIUS = 10;
  var MAX_RADIUS = 1000;
  var DEFAULT_RADIUS = 350;
  var DRAG_THRESHOLD_METERS = 3;

  var CATEGORY_COLORS = {
    anchorage: '#2b6cb0',
    pickupDropoff: '#dd7a1f'
  };
  var CATEGORY_LABELS = {
    anchorage: 'Anchorage',
    pickupDropoff: 'Pick-up / Drop-off'
  };

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

  // ---------- State ----------
  var markers = loadMarkers();
  var editMode = false;
  var drawCategory = null;
  var activeMarkerId = null;
  var pendingNew = null;
  var layers = new Map();
  var currentLocationMarker = null;
  var watchId = null;
  var pendingDeleteId = null;

  // ---------- Map init ----------
  var savedView = loadView();
  var map = L.map('map', { zoomControl: false }).setView(
    savedView ? [savedView.lat, savedView.lng] : DEFAULT_CENTER,
    savedView ? savedView.zoom : DEFAULT_ZOOM
  );

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19,
    subdomains: 'abcd'
  }).addTo(map);

  map.on('moveend', function () {
    persistView(map.getCenter(), map.getZoom());
  });

  // ---------- DOM refs ----------
  var modeToggleBtn = document.getElementById('mode-toggle');
  var editToolbar = document.getElementById('edit-toolbar');
  var drawAnchorageBtn = document.getElementById('draw-anchorage-btn');
  var drawPickupBtn = document.getElementById('draw-pickup-btn');
  var editHint = document.getElementById('edit-hint');
  var locateBtn = document.getElementById('locate-btn');
  var locationMsg = document.getElementById('location-msg');

  var formOverlay = document.getElementById('marker-form-overlay');
  var formTitle = document.getElementById('marker-form-title');
  var labelInput = document.getElementById('marker-label-input');
  var radiusInput = document.getElementById('marker-radius-input');
  var radiusValue = document.getElementById('marker-radius-value');
  var formDeleteBtn = document.getElementById('marker-form-delete');
  var formCancelBtn = document.getElementById('marker-form-cancel');
  var formSaveBtn = document.getElementById('marker-form-save');

  var confirmOverlay = document.getElementById('confirm-overlay');
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
      weight: 2,
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

    var entry = { circle: circle, handle: null };
    layers.set(markerData.id, entry);

    attachCircleInteractions(markerData.id, circle);

    if (editMode) {
      addResizeHandle(markerData.id);
    }

    return entry;
  }

  function redrawSingleMarker(markerId) {
    var entry = layers.get(markerId);
    if (entry) {
      map.removeLayer(entry.circle);
      if (entry.handle) map.removeLayer(entry.handle);
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

  function attachCircleInteractions(markerId, circle) {
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
    modeToggleBtn.textContent = on ? 'View Mode' : 'Edit Mode';
    modeToggleBtn.classList.toggle('active', on);
    editToolbar.classList.toggle('hidden', !on);
    cancelDrawing();
    setEditHint(null);

    layers.forEach(function (entry, markerId) {
      var markerData = markers.find(function (m) { return m.id === markerId; });
      if (on) {
        entry.circle.closePopup();
        entry.circle.unbindPopup();
        addResizeHandle(markerId);
      } else {
        if (markerData) entry.circle.bindPopup(popupContentFor(markerData));
        removeResizeHandle(markerId);
      }
    });

    updateEmptyState();
  }

  modeToggleBtn.addEventListener('click', function () {
    setEditMode(!editMode);
  });

  // ---------- Drawing new markers ----------
  function setEditHint(text) {
    if (text) {
      editHint.textContent = text;
      editHint.classList.add('active');
    } else {
      editHint.textContent = 'Click the map to place a circle';
      editHint.classList.remove('active');
    }
  }

  function startDrawing(category) {
    cancelDrawing();
    drawCategory = category;
    setEditHint('Click the map to place a new ' + CATEGORY_LABELS[category] + ' circle');
  }

  function cancelDrawing() {
    drawCategory = null;
    if (pendingNew) {
      map.removeLayer(pendingNew.circle);
      map.removeLayer(pendingNew.handle);
      pendingNew = null;
    }
    setEditHint(null);
  }

  drawAnchorageBtn.addEventListener('click', function () {
    startDrawing('anchorage');
  });
  drawPickupBtn.addEventListener('click', function () {
    startDrawing('pickupDropoff');
  });

  map.on('click', function (e) {
    if (!editMode || !drawCategory) return;

    var category = drawCategory;
    drawCategory = null;
    setEditHint(null);

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
      radiusValue.textContent = Math.round(clamped) + ' m';
    });

    handle.on('dragend', function () {
      var center = circle.getLatLng();
      var finalRadius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, map.distance(center, handle.getLatLng())));
      circle.setRadius(finalRadius);
      handle.setLatLng(handlePositionFor(center.lat, center.lng, finalRadius));
      radiusInput.value = Math.round(finalRadius);
      radiusValue.textContent = Math.round(finalRadius) + ' m';
    });

    circle.on('mousedown', function (ev) {
      L.DomEvent.stopPropagation(ev);
      map.dragging.disable();
      function onMove(mv) {
        circle.setLatLng(mv.latlng);
        handle.setLatLng(handlePositionFor(mv.latlng.lat, mv.latlng.lng, circle.getRadius()));
      }
      function onUp() {
        map.off('mousemove', onMove);
        map.off('mouseup', onUp);
        map.dragging.enable();
      }
      map.on('mousemove', onMove);
      map.on('mouseup', onUp);
    });

    pendingNew = { circle: circle, handle: handle, category: category };
    activeMarkerId = null;
    openMarkerForm({
      title: 'New ' + CATEGORY_LABELS[category],
      label: '',
      category: category,
      radius: DEFAULT_RADIUS,
      showDelete: false
    });
  });

  // ---------- Marker form (create / edit) ----------
  function openMarkerForm(opts) {
    formTitle.textContent = opts.title;
    labelInput.value = opts.label || '';
    radiusInput.value = opts.radius;
    radiusValue.textContent = Math.round(opts.radius) + ' m';
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
      showDelete: true
    });
  }

  radiusInput.addEventListener('input', function () {
    var val = Number(radiusInput.value);
    radiusValue.textContent = val + ' m';
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
      cancelDrawing();
    } else if (activeMarkerId) {
      var markerData = markers.find(function (m) { return m.id === activeMarkerId; });
      var entry = layers.get(activeMarkerId);
      if (markerData && entry) {
        entry.circle.setRadius(markerData.radiusMeters);
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
      pendingNew = null;
      markers.push(newMarker);
      persistMarkers();
      renderMarker(newMarker);
      updateEmptyState();
    } else if (activeMarkerId) {
      var markerData = markers.find(function (m) { return m.id === activeMarkerId; });
      if (markerData) {
        markerData.label = label;
        markerData.category = category;
        markerData.radiusMeters = radius;
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
    confirmText.textContent = markerData
      ? 'Delete "' + markerData.label + '"? This action cannot be undone.'
      : 'This action cannot be undone.';
    confirmOverlay.classList.remove('hidden');
  });

  confirmCancelBtn.addEventListener('click', function () {
    pendingDeleteId = null;
    confirmOverlay.classList.add('hidden');
  });

  confirmOkBtn.addEventListener('click', function () {
    if (pendingDeleteId) {
      deleteMarker(pendingDeleteId);
    }
    pendingDeleteId = null;
    confirmOverlay.classList.add('hidden');
    activeMarkerId = null;
    closeMarkerForm();
  });

  function deleteMarker(markerId) {
    var entry = layers.get(markerId);
    if (entry) {
      map.removeLayer(entry.circle);
      if (entry.handle) map.removeLayer(entry.handle);
      layers.delete(markerId);
    }
    markers = markers.filter(function (m) { return m.id !== markerId; });
    persistMarkers();
    updateEmptyState();
  }

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

  function startWatching() {
    if (watchId !== null || !('geolocation' in navigator)) return;
    watchId = navigator.geolocation.watchPosition(
      function (pos) {
        updateCurrentLocationMarker(pos.coords.latitude, pos.coords.longitude);
      },
      function () {},
      { enableHighAccuracy: true, maximumAge: 60000 }
    );
  }

  function requestLocation(panTo) {
    if (!('geolocation' in navigator)) {
      locationMsg.dataset.kind = 'geo-error';
      showToast('Geolocation is not available in this browser.', 4000);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        delete locationMsg.dataset.kind;
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
    requestLocation(true);
  });

  // ---------- Init ----------
  renderAll();
  requestLocation(false);
})();
