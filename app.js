// Configuration object
// Palet warna baru untuk poligon (desain modern)
// Palet warna baru untuk glassmorphism
const CONFIG = {
    DEFAULT_VIEW: [-0.634, 104.392],
    DEFAULT_ZOOM: 15,
    COLORS: {
        'Hak Milik': '#FF6B6B',          // Coral - menonjol
        'Hak Guna Bangunan': '#4ECDC4',  // Turquoise - sejuk
        'Hak Pakai': '#5E72E4',          // Indigo - glassmorphism
        'Hak Pengelolaan': '#FFD166',    // Kuning cerah
        'Wakaf': '#9B5DE5',              // Ungu lembut
        'default': '#A0A0A0'             // Abu-abu
    },
    MOBILE_BREAKPOINT: 768,
    DATA_SOURCE: 'data.json',
    CACHE_NAME: 'land-map-cache-v1'
};

// ... (sisa kode app.js tetap sama, hanya palet warna yang diubah) ...

// Initialize the map
const map = L.map('map').setView(CONFIG.DEFAULT_VIEW, CONFIG.DEFAULT_ZOOM);

// Sidebar toggle functionality
const sidebar = document.getElementById('sidebar');
const toggleButton = document.getElementById('toggleSidebar');

toggleButton.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    map.invalidateSize();
});

// Base layers
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
});

const satelliteLayer = L.tileLayer('http://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
    maxZoom: 20,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    attribution: '© Google Maps'
});

const esriWorldImageryLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri'
});

// Set default layer
osmLayer.addTo(map);

// Layer groups for each type
let polygonLayers = {};

// Utility functions
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function showLoading() {
    const mapContainer = document.getElementById('map');
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'loading-indicator';
    loadingDiv.innerHTML = `
        <div class="loading-content">
            <div class="loading-spinner"></div>
            <p>Memuat data peta...</p>
        </div>
    `;
    mapContainer.appendChild(loadingDiv);
}

function hideLoading() {
    const loadingDiv = document.getElementById('loading-indicator');
    if (loadingDiv) loadingDiv.remove();
}

function showError(message) {
    hideLoading();
    const mapContainer = document.getElementById('map');
    const errorDiv = document.createElement('div');
    errorDiv.id = 'error-indicator';
    errorDiv.innerHTML = `
        <div class="error-content">
            <i class="fas fa-exclamation-triangle"></i>
            <p>${message}</p>
            <button>Refresh Halaman</button>
        </div>
    `;
    mapContainer.appendChild(errorDiv);

    // Add event listener to button
    errorDiv.querySelector('button').addEventListener('click', () => {
        location.reload();
    });
}

function validateCoordinates(coords) {
    if (!Array.isArray(coords)) return false;

    return coords.every(coord => {
        if (Array.isArray(coord[0])) {
            return validateCoordinates(coord);
        } else {
            const [lng, lat] = coord;
            return (
                typeof lat === 'number' && typeof lng === 'number' &&
                lat >= -90 && lat <= 90 &&
                lng >= -180 && lng <= 180
            );
        }
    });
}

function validateGeoJSONData(data) {
    if (!data || !data.features || !Array.isArray(data.features)) {
        throw new Error('Struktur data GeoJSON tidak valid');
    }

    // Filter invalid features
    const validFeatures = data.features.filter(feature => {
        if (!feature.properties || !feature.properties.TIPEHAK) {
            console.warn('Fitur tidak memiliki properti TIPEHAK');
            return false;
        }

        if (!feature.geometry || !validateCoordinates(feature.geometry.coordinates)) {
            console.warn('Fitur memiliki geometri tidak valid');
            return false;
        }

        return true;
    });

    return {
        type: 'FeatureCollection',
        features: validFeatures
    };
}

function formatArea(area) {
    if (area < 10000) {
        return `${Math.round(area * 100) / 100} m²`;
    } else {
        const hectares = area / 10000;
        return `${Math.round(hectares * 100) / 100} ha`;
    }
}

// Clear existing layers properly
function clearLayers() {
    Object.values(polygonLayers).forEach(layerGroup => {
        layerGroup.eachLayer(layer => {
            layer.remove();
        });
        layerGroup.remove();
    });
    polygonLayers = {};
}

// Load and process GeoJSON data with caching
async function loadData() {
    showLoading();

    try {
        // Try to get data from cache
        let data;
        if ('caches' in window) {
            const cache = await caches.open(CONFIG.CACHE_NAME);
            const cachedResponse = await cache.match(CONFIG.DATA_SOURCE);

            if (cachedResponse) {
                data = await cachedResponse.json();
                console.log('Menggunakan data dari cache');
            }
        }

        // If no cached data, fetch from network
        if (!data) {
            const response = await fetch(CONFIG.DATA_SOURCE);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            data = await response.json();

            // Cache the response
            if ('caches' in window) {
                const cache = await caches.open(CONFIG.CACHE_NAME);
                await cache.put(CONFIG.DATA_SOURCE, new Response(JSON.stringify(data)));
            }
        }

        const validatedData = validateGeoJSONData(data);
        processData(validatedData);
        hideLoading();
    } catch (error) {
        console.error('Error loading data:', error);
        showError('Gagal memuat data peta. Silakan refresh halaman.');
    }
}

// Process and display data
function processData(data) {
    console.time('processData');

    // Clear existing layers
    clearLayers();

    // Get unique tipe hak values
    const tipeHakSet = new Set();
    data.features.forEach(feature => {
        const tipeHak = feature.properties.TIPEHAK;
        if (tipeHak && tipeHak !== 'Hak Guna Usaha') {
            tipeHakSet.add(tipeHak);
        }
    });

    // Create layer groups for each type
    tipeHakSet.forEach(tipeHak => {
        polygonLayers[tipeHak] = L.layerGroup().addTo(map);
    });

    // Process each feature
    data.features.forEach((feature, index) => {
        const properties = feature.properties || {};
        const tipeHak = properties.TIPEHAK || 'Unknown';

        // Skip unwanted types
        if (tipeHak === 'Hak Guna Usaha') return;

        const color = CONFIG.COLORS[tipeHak] || CONFIG.COLORS.default;

        try {
            // Create polygon
            const polygon = L.geoJSON(feature, {
                style: {
                    color: color,
                    weight: 2,
                    opacity: 0.8,
                    fillOpacity: 0.4
                },
                onEachFeature: (feature, layer) => {
                    // Calculate area
                    const area = turf.area(feature.geometry);
                    const formattedArea = formatArea(area);

                    // Create popup content
                    const popupContent = `
                        <div class="popup-content">
                            <h3><i class="fas fa-map-marker-alt"></i> Informasi Lahan</h3>
                            <div class="popup-details">
                                <p><strong>Kelurahan:</strong> ${properties.KELURAHAN || '-'}</p>
                                <p><strong>Kecamatan:</strong> ${properties.KECAMATAN || '-'}</p>
                                <p><strong>Tipe Hak:</strong>
                                   <span style="color: ${color}; font-weight: bold;">${tipeHak}</span></p>
                                <p><strong>Luas:</strong> ${formattedArea}</p>
                            </div>
                        </div>
                    `;

                    layer.bindPopup(popupContent, {
                        maxWidth: 300,
                        className: 'custom-popup'
                    });

                    // Hover effects
                    layer.on('mouseover', function() {
                        this.setStyle({
                            weight: 3,
                            fillOpacity: 0.6
                        });
                    });

                    layer.on('mouseout', function() {
                        this.setStyle({
                            weight: 2,
                            fillOpacity: 0.4
                        });
                    });
                }
            });

            // Add to appropriate layer group
            if (polygonLayers[tipeHak]) {
                polygonLayers[tipeHak].addLayer(polygon);
            }
        } catch (error) {
            console.warn(`Error processing feature ${index}:`, error);
        }
    });

    // Update UI controls
    updateFilterControls(Array.from(tipeHakSet));
    updateLegend(Array.from(tipeHakSet));

    // Fit map to bounds
    if (data.features.length > 0) {
        try {
            const group = L.featureGroup(Object.values(polygonLayers));
            if (group.getBounds().isValid()) {
                map.fitBounds(group.getBounds(), {
                    padding: [50, 50],
                    animate: true,
                    duration: 1
                });
            }
        } catch (error) {
            console.warn('Error fitting bounds:', error);
        }
    }

    console.timeEnd('processData');
}

// Update filter checkboxes
function updateFilterControls(tipeHakValues) {
    const filterContainer = document.getElementById('tipeHakFilter');
    if (!filterContainer) return;

    filterContainer.innerHTML = '';

    tipeHakValues.sort().forEach(value => {
        const checkboxItem = document.createElement('div');
        checkboxItem.className = 'checkbox-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `filter-${value.replace(/\s+/g, '-')}`;
        checkbox.value = value;
        checkbox.checked = true;
        checkbox.setAttribute('aria-label', `Toggle ${value} layer`);

        const label = document.createElement('label');
        label.htmlFor = checkbox.id;
        label.textContent = value;

        checkboxItem.appendChild(checkbox);
        checkboxItem.appendChild(label);
        filterContainer.appendChild(checkboxItem);

        // Add change event
        checkbox.addEventListener('change', (e) => {
            const layer = polygonLayers[value];
            if (layer) {
                if (e.target.checked) {
                    map.addLayer(layer);
                } else {
                    map.removeLayer(layer);
                }
            }
        });
    });
}

// Update legend
function updateLegend(tipeHakValues) {
    const legendContainer = document.getElementById('legendContent');
    if (!legendContainer) return;

    legendContainer.innerHTML = '';

    tipeHakValues.sort().forEach(value => {
        const legendItem = document.createElement('div');
        legendItem.className = 'legend-item';

        const colorBox = document.createElement('div');
        colorBox.className = 'legend-color';
        colorBox.style.backgroundColor = CONFIG.COLORS[value] || CONFIG.COLORS.default;

        const label = document.createElement('span');
        label.textContent = value;

        legendItem.appendChild(colorBox);
        legendItem.appendChild(label);
        legendContainer.appendChild(legendItem);
    });
}

// Base map switcher
document.getElementById('baseMapSelector')?.addEventListener('change', (e) => {
    const selectedMap = e.target.value;

    // Remove all base layers
    [osmLayer, satelliteLayer, esriWorldImageryLayer].forEach(layer => {
        map.removeLayer(layer);
    });

    // Add selected layer
    switch (selectedMap) {
        case 'osm':
            osmLayer.addTo(map);
            break;
        case 'satellite':
            satelliteLayer.addTo(map);
            break;
        case 'esri':
            esriWorldImageryLayer.addTo(map);
            break;
    }
});

// Auto-collapse sidebar on mobile
function handleResize() {
    if (window.innerWidth <= CONFIG.MOBILE_BREAKPOINT && !sidebar.classList.contains('collapsed')) {
        sidebar.classList.add('collapsed');
    }
}

// Add event listeners
window.addEventListener('resize', debounce(handleResize, 250));
document.addEventListener('DOMContentLoaded', loadData);
handleResize();

// Keyboard accessibility
toggleButton?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleButton.click();
    }
});

// Global error handling
window.addEventListener('error', (e) => {
    console.error('Error:', e.error);
    showError(`Terjadi kesalahan: ${e.error.message}`);
});

window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled rejection:', e.reason);
    showError(`Terjadi kesalahan: ${e.reason.message}`);
    e.preventDefault();
});
